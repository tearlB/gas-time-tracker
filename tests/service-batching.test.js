const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createContext(extra) {
  const calls = { getProperties: 0, getProperty: 0, cacheGet: 0, cacheGetAll: [] };
  const propertyValues = { appStorageMode: 'annual', appStorageYearFiles: JSON.stringify({ 2026: 'sheet2026' }) };
  const properties = {
    getProperties() { calls.getProperties += 1; return Object.assign({}, propertyValues); },
    getProperty(key) { calls.getProperty += 1; return propertyValues[key] == null ? null : propertyValues[key]; },
    setProperty(key, value) { propertyValues[key] = String(value); },
    deleteProperty(key) { delete propertyValues[key]; }
  };
  const cacheValues = new Map();
  const cache = {
    get(key) { calls.cacheGet += 1; return cacheValues.has(key) ? cacheValues.get(key) : null; },
    getAll(keys) {
      calls.cacheGetAll.push(keys.slice());
      return keys.reduce((result, key) => { if (cacheValues.has(key)) result[key] = cacheValues.get(key); return result; }, {});
    },
    put(key, value) { cacheValues.set(key, String(value)); },
    putAll(entries) { Object.keys(entries).forEach(key => cacheValues.set(key, String(entries[key]))); },
    remove(key) { cacheValues.delete(key); },
    removeAll(keys) { keys.forEach(key => cacheValues.delete(key)); }
  };
  const context = Object.assign({
    console,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: { formatDate: () => '2026' },
    PropertiesService: { getScriptProperties: () => properties, getUserProperties: () => properties },
    CacheService: { getUserCache: () => cache },
    LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Sheets: { Spreadsheets: {} }
  }, extra || {});
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/code.gs', 'utf8'), context);
  return { context, calls, propertyValues, cacheValues };
}

test('Properties は1回の実行中にまとめて1度だけ読み、書き込みは手元の値にも反映する', () => {
  const { context, calls, propertyValues } = createContext();
  assert.equal(context.isAnnualStorage(), true);
  assert.equal(context.getSpreadsheetIdForYear(2026), 'sheet2026');
  assert.equal(context.sheetCacheEpoch(), '0');
  // 保存先の設定も人ごと（UserProperties）なので、UserProperties を1回だけ読む。
  assert.equal(calls.getProperties, 1);
  assert.equal(calls.getProperty, 0);

  context.clearAppReadCache();
  assert.notEqual(context.sheetCacheEpoch(), '0');
  assert.equal(propertyValues.sheetCacheEpoch, context.sheetCacheEpoch());
  assert.equal(calls.getProperties, 1);
});

test('ロックを取ったあとは他の実行が書いた値を読み直す', () => {
  const { context, calls, propertyValues } = createContext();
  assert.equal(context.isAnnualStorage(), true);
  propertyValues.appStorageMode = 'legacy';
  assert.equal(context.isAnnualStorage(), true);
  context.withUserWriteLock(() => assert.equal(context.isAnnualStorage(), false));
  assert.equal(calls.getProperties, 2);
});

test('Cache は同じスプレッドシートの主なキーを getAll でまとめて読み、同じキーを読み直さない', () => {
  const { context, calls, cacheValues } = createContext();
  context.BUDGET_PLAN_SHEET_NAME = '予実計画';
  const planKey = context.sheetValuesCacheKey('sheetA', '予実計画');
  cacheValues.set(planKey, JSON.stringify([['plan']]));
  cacheValues.set(context.sheetMetaCacheKey('sheetA'), JSON.stringify({ sheets: [] }));

  assert.deepEqual(JSON.parse(JSON.stringify(context.getCachedSheetMeta('sheetA'))), { sheets: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(context.getCachedSheetValues('sheetA', '予実計画'))), [['plan']]);
  assert.equal(context.getCachedSheetMeta('sheetA') != null, true);
  assert.equal(calls.cacheGet, 0);
  assert.equal(calls.cacheGetAll.length, 1);
  assert.ok(calls.cacheGetAll[0].includes(planKey));
  assert.ok(calls.cacheGetAll[0].includes('storage.status.v2'));

  context.putCachedSheetValues('sheetA', '予実計画', [['updated']]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getCachedSheetValues('sheetA', '予実計画'))), [['updated']]);
  context.invalidateCachedSheetMeta('sheetA');
  assert.equal(context.getCachedSheetMeta('sheetA'), null);
  assert.equal(calls.cacheGetAll.length, 1);
});

test('Google Tasks 同期はタスク一覧を1回だけ読み、課題の読み込みはロックの外で行う', () => {
  const events = [];
  const tasks = {
    t1: { id: 't1', title: 'P / 課題A', status: 'needsAction' },
    t2: { id: 't2', title: 'P / 課題B', status: 'needsAction' }
  };
  const Tasks = {
    Tasklists: { get() { throw new Error('Tasklists.get は呼ばない'); } },
    Tasks: {
      get() { throw new Error('Tasks.get は呼ばない'); },
      list(listId, options) { events.push('list:' + listId + ':' + options.showHidden); return { items: Object.values(tasks) }; },
      insert(task) { events.push('insert:' + task.title); return { id: 'new' }; },
      patch(patch, listId, id) { events.push('patch:' + id + ':' + (patch.status || patch.title)); }
    }
  };
  const { context, propertyValues } = createContext({
    Tasks,
    LockService: { getUserLock: () => ({ tryLock: () => { events.push('lock'); return true; }, releaseLock() {} }) }
  });
  vm.runInContext(fs.readFileSync('gas/google_tasks.gs', 'utf8'), context);
  context.Utilities.computeDigest = (_, text) => Array.from(Buffer.from(text)).slice(-8);
  context.Utilities.DigestAlgorithm = {};
  context.Utilities.Charset = {};
  context.projectMonthKey = key => key;
  context.loadProjectWorkspace = () => {
    events.push('workspace');
    return { projects: [{ id: 'p1', name: 'P', status: context.PROJECT_STATUS_ACTIVE, issues: [
      { name: '課題A', periodType: 'week', status: '進行中' },
      { name: '課題B', periodType: 'week', status: '稼働中', done: true },
      { name: '課題C', periodType: 'week', status: '超過' }
    ] }] };
  };
  context.PROJECT_STATUS_ACTIVE = 'active';
  context.projectText = value => String(value || '');
  propertyValues['googleTasks.projectIssues.enabled.v1'] = 'true';
  propertyValues['googleTasks.projectIssues.targetListId.v1'] = 'list1';
  propertyValues['googleTasks.projectIssues.targetListTitle.v1'] = '仕事';
  const keyFor = name => context.googleTasksIdentityPropertyKey('list1\u0000p1\u0000' + name);
  propertyValues[keyFor('課題A')] = 't1';
  propertyValues[keyFor('課題B')] = 't2';

  const result = context.syncProjectIssuesToGoogleTasks('2026-10');
  assert.deepEqual(events, ['workspace', 'lock', 'list:list1:true', 'insert:P / 課題C', 'patch:t2:completed']);
  assert.equal(result.taskListTitle, '仕事');
  assert.equal(result.total, 2);
  assert.equal(result.unchanged, 1);
  assert.equal(result.created, 1);
  assert.equal(result.completed, 1);
  assert.equal(propertyValues[keyFor('課題C')], 'new');
});

test('保存先の状態は設定済みなら長く、未設定やエラーなら短くキャッシュし、手動の再読み込みで消す', () => {
  const puts = [];
  const { context, cacheValues } = createContext();
  const cache = context.CacheService.getUserCache();
  const put = cache.put;
  cache.put = (key, value, ttl) => { puts.push([key, ttl]); put(key, value, ttl); };
  context.loadAppStorageStatus = () => ({ configured: true });
  context.getAppStorageStatus();
  context.loadAppStorageStatus = () => ({ configured: true, error: '確認できません' });
  context.invalidateAppStorageStatusCache();
  context.getAppStorageStatus();
  assert.deepEqual(puts, [['storage.status.v2', 21600], ['storage.status.v2', 60]]);
  assert.ok(cacheValues.has('storage.status.v2'));
  context.clearAppReadCache();
  assert.equal(cacheValues.has('storage.status.v2'), false);
});

test('スプレッドシートが外から編集されていたら、読み込み用のキャッシュを捨てて読み直す', () => {
  let updated = Date.parse('2026-10-16T10:00:00Z');
  let driveCalls = 0;
  const { context, propertyValues, cacheValues } = createContext({
    DriveApp: { getFileById: () => ({ getLastUpdated: () => { driveCalls += 1; return new Date(updated); } }) }
  });
  const reset = () => vm.runInContext('APP_EXTERNAL_CHECKED = {}; APP_CACHE_MEMO = null; APP_CACHE_PREFETCHED = {}; APP_PROPERTY_STORES = {};', context);
  // アプリが 10:00:03 に書き込んだ（Drive の更新時刻 10:00:00 は、アプリ自身の書き込み）。
  propertyValues['appLastWrite:sheetA'] = String(Date.parse('2026-10-16T10:00:03Z'));
  context.putCachedSheetValues('sheetA', '予実計画', [['キャッシュの値']]);
  reset();
  assert.deepEqual(JSON.parse(JSON.stringify(context.getCachedSheetValues('sheetA', '予実計画'))), [['キャッシュの値']], 'アプリ自身の書き込みでは捨てない');
  assert.equal(driveCalls, 1);

  // 10秒以内はもう一度 Drive に確かめない。
  reset();
  context.getCachedSheetValues('sheetA', '予実計画');
  assert.equal(driveCalls, 1);

  // 人が 10:05 にシートを編集した。確認の間隔が過ぎたら、キャッシュを捨てる。
  updated = Date.parse('2026-10-16T10:05:00Z');
  for (const key of Array.from(cacheValues.keys())) if (key.indexOf('ext.') === 0) cacheValues.delete(key);
  reset();
  assert.equal(context.getCachedSheetValues('sheetA', '予実計画'), null, '外からの編集のあとはシートを読み直す');
  assert.equal(propertyValues['appExternalSeen:sheetA'], String(updated));
});

test('保存したファイルは、アプリが最後に書いた時刻を記録する', () => {
  const { context, propertyValues } = createContext({ Sheets: { Spreadsheets: { Values: { update() {} } } } });
  const before = Date.now();
  context.withUserWriteLock(() => context.sheetsValuesUpdate('sheetA', "'予実計画'!A1:B1", [['a', 'b']]));
  assert.ok(Number(propertyValues['appLastWrite:sheetA']) >= before);
});
