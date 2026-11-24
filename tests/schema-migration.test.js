const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// シートの値・開発者メタデータ・Drive のコピーを持つ、小さなスプレッドシートのモック。
function createContext(initialSheets, options) {
  options = options || {};
  const sheets = new Map(Object.entries(initialSheets).map(([title, rows], index) => [title, { sheetId: index + 1, rows: rows.map(r => r.slice()) }]));
  const metadata = (options.metadata || []).map(entry => Object.assign({}, entry));
  const events = [];
  const backups = [];
  const propertyValues = new Map(Object.entries(Object.assign({
    appStorageMode: 'annual',
    appStorageYearFiles: JSON.stringify({ 2026: 'sheet2026' })
  }, options.properties || {})));
  const properties = {
    getProperty: key => propertyValues.has(key) ? propertyValues.get(key) : null,
    setProperty: (key, value) => { propertyValues.set(key, String(value)); },
    deleteProperty: key => { propertyValues.delete(key); }
  };
  const cacheValues = new Map();
  const cache = {
    get: key => cacheValues.has(key) ? cacheValues.get(key) : null,
    getAll: keys => keys.reduce((result, key) => { if (cacheValues.has(key)) result[key] = cacheValues.get(key); return result; }, {}),
    put: (key, value) => { cacheValues.set(key, String(value)); },
    putAll: entries => Object.keys(entries).forEach(key => cacheValues.set(key, String(entries[key]))),
    remove: key => { cacheValues.delete(key); }
  };
  const column = letters => letters.split('').reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
  function coordinates(range) {
    const match = /^'?(.+?)'?!([A-Z]+)(\d+)(?::([A-Z]+)(\d*))?$/.exec(range);
    return {
      title: match[1].replace(/''/g, "'"),
      startColumn: column(match[2]),
      startRow: Number(match[3]) - 1,
      endColumn: match[4] ? column(match[4]) : column(match[2]),
      endRow: match[5] ? Number(match[5]) - 1 : null
    };
  }
  function sheetFor(range) {
    const position = coordinates(range);
    const sheet = sheets.get(position.title);
    if (!sheet) { const err = new Error('Unable to parse range: ' + range); throw err; }
    return { sheet, position };
  }
  const Values = {
    get(id, range) {
      const { sheet, position } = sheetFor(range);
      const end = position.endRow == null ? sheet.rows.length - 1 : position.endRow;
      const values = sheet.rows.slice(position.startRow, end + 1).map(row => {
        const cells = row.slice(position.startColumn, position.endColumn + 1);
        while (cells.length && (cells[cells.length - 1] === '' || cells[cells.length - 1] == null)) cells.pop();
        return cells;
      });
      while (values.length && !values[values.length - 1].length) values.pop();
      return { values };
    },
    batchGet(id, request) { return { valueRanges: request.ranges.map(range => Values.get(id, range)) }; },
    update(body, id, range) {
      const { sheet, position } = sheetFor(range);
      events.push('update:' + position.title);
      body.values.forEach((row, offset) => {
        const target = sheet.rows[position.startRow + offset] || (sheet.rows[position.startRow + offset] = []);
        row.forEach((value, index) => { target[position.startColumn + index] = value; });
      });
    },
    clear(body, id, range) {
      const { sheet, position } = sheetFor(range);
      const end = position.endRow == null ? sheet.rows.length - 1 : position.endRow;
      for (let r = position.startRow; r <= end; r++) {
        const target = sheet.rows[r] || [];
        for (let c = position.startColumn; c <= position.endColumn; c++) target[c] = '';
        sheet.rows[r] = target;
      }
    }
  };
  const context = {
    console,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: { formatDate: () => '2026/10/15 12:00:00' },
    PropertiesService: { getScriptProperties: () => properties, getUserProperties: () => properties },
    CacheService: { getUserCache: () => cache, getScriptCache: () => cache },
    LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    DriveApp: {
      getFileById: () => ({
        getName: () => '2026年 まとめて工数管理さん',
        getParents: () => ({ hasNext: () => false }),
        makeCopy(name) {
          if (options.backupFails) throw new Error('Drive に書き込めません');
          events.push('backup');
          backups.push({ name, sheets: JSON.parse(JSON.stringify(Array.from(sheets))) });
          return { getUrl: () => 'https://example.com/backup/' + backups.length };
        }
      }),
      getRootFolder: () => ({ getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({}) })
    },
    Sheets: {
      Spreadsheets: {
        get: () => ({
          sheets: Array.from(sheets, ([title, entry]) => ({ properties: { sheetId: entry.sheetId, title } })),
          developerMetadata: metadata.map(entry => Object.assign({}, entry))
        }),
        batchUpdate(body) {
          (body.requests || []).forEach(request => {
            if (request.addSheet) { sheets.set(request.addSheet.properties.title, { sheetId: request.addSheet.properties.sheetId, rows: [] }); events.push('addSheet:' + request.addSheet.properties.title); }
            if (request.deleteSheet) for (const [title, entry] of sheets) if (entry.sheetId === request.deleteSheet.sheetId) sheets.delete(title);
            if (request.createDeveloperMetadata) { events.push('metadata:' + request.createDeveloperMetadata.developerMetadata.metadataValue); metadata.push(Object.assign({ metadataId: 500 + metadata.length }, request.createDeveloperMetadata.developerMetadata)); }
            if (request.updateDeveloperMetadata) {
              const id = request.updateDeveloperMetadata.dataFilters[0].developerMetadataLookup.metadataId;
              events.push('metadata:' + request.updateDeveloperMetadata.developerMetadata.metadataValue);
              metadata.filter(entry => entry.metadataId === id).forEach(entry => { entry.metadataValue = request.updateDeveloperMetadata.developerMetadata.metadataValue; });
            }
          });
          return {};
        },
        Values
      }
    }
  };
  vm.createContext(context);
  ['code.gs', 'budget.gs', 'planning.gs', 'projects.gs', 'storage_schema.gs', 'legacy.gs'].forEach(file => {
    vm.runInContext(fs.readFileSync('gas/' + file, 'utf8'), context);
  });
  // 実行ごとにリセットされるグローバル（GAS では1回の呼び出しごとに初期化される）を、テストの区切りで戻す。
  context.__newExecution = () => vm.runInContext('APP_DB_SCHEMA_RUN = {}; APP_PROPERTY_STORES = {}; APP_CACHE_MEMO = null; APP_CACHE_PREFETCHED = {};', context);
  return { context, sheets, metadata, events, backups, propertyValues };
}

// テストは現在の形式番号に合わせて読む（形式を上げてもテストを書き換えなくて済むように）。
const CURRENT = Number(/var APP_DB_SCHEMA_VERSION = (\d+);/.exec(fs.readFileSync('gas/storage_schema.gs', 'utf8'))[1]);
const NEXT = CURRENT + 1;
const PLAN_HEADER_V8 = ['期間種別', '期間キー', '集計キー', '予定工数', 'メモ', '更新日時', '優先順位', '着地見込工数', '当初予定工数', '予定区分', '登録日時', '予定ID', '開始日', '1日上限', '繰越元週', 'カレンダーキー', '完了', '日別予定JSON', 'プロジェクトID', '課題URL', '進捗', '終了日'];

function currentFile() {
  return {
    '予実計画': [PLAN_HEADER_V8, ['week', '2026-W42', '設計', 4, '', '', 1, 4, 4, 'initial', '2026/10/01', 'plan-1']],
    '予定タスク': [['ID', '期間種別', '期間キー', '親タスク', 'サブタスク', '予定工数', '期限', '状態', 'メモ', '並び順', '更新日時', '親予定ID']]
  };
}

test('以前の記録方法で最新形式のファイルは、データを変えずに形式番号だけファイルへ記録する', () => {
  const { context, sheets, metadata, events, backups } = createContext(currentFile(), { properties: { 'appDbSchemaVersion:sheet2026': String(CURRENT) } });
  const before = JSON.stringify(Array.from(sheets));
  const state = context.ensureDatabaseSchema('sheet2026');
  assert.equal(state.repaired, false);
  assert.equal(backups.length, 0);
  assert.equal(JSON.stringify(Array.from(sheets)), before);
  assert.deepEqual(events, ['metadata:' + CURRENT]);
  assert.equal(metadata[0].metadataKey, 'matometeKousuKanri.schemaVersion');
});

test('古い形式のファイルは、書き換える前にバックアップを取り、履歴シートに記録してから形式番号を上げる', () => {
  const { context, sheets, metadata, events, backups } = createContext({
    // 旧形式: 列名が旧名（計画ID・週キー）で、並びも違う。
    '予実計画': [['期間', '週キー', '集計キー', '予定工数', '計画ID'], ['週', '2026-W42', '設計', 4, 'plan-1']],
    '予定タスク': [['ID', '期間種別', '期間キー', '親タスク', 'サブタスク', '予定工数', '期限', '状態', 'メモ', '並び順', '更新日時', '親予定ID']]
  });
  const state = context.ensureDatabaseSchema('sheet2026');
  assert.equal(state.repaired, true);
  assert.equal(events[0], 'backup', 'シートを書き換える前にバックアップする: ' + events.join(','));
  assert.equal(backups.length, 1);
  assert.match(backups[0].name, new RegExp('形式0→' + CURRENT + ' 移行前'));
  assert.deepEqual(JSON.parse(JSON.stringify(backups[0].sheets[0][1].rows[0])), ['期間', '週キー', '集計キー', '予定工数', '計画ID']);
  const plan = sheets.get('予実計画').rows;
  assert.deepEqual(plan[0], PLAN_HEADER_V8);
  assert.equal(plan[1][11], 'plan-1');
  const log = sheets.get('形式変更履歴').rows;
  assert.deepEqual(log[0], ['日時', '変更前の形式', '変更後の形式', 'バックアップ', '内容']);
  assert.deepEqual(log[1].slice(1, 4), ['0', String(CURRENT), 'https://example.com/backup/1']);
  assert.equal(metadata[0].metadataValue, String(CURRENT));
  assert.equal(events[events.length - 1], 'metadata:' + CURRENT, '形式番号は最後に上げる');
});

test('バックアップが作れないときは、シートを書き換えず形式番号も変えない', () => {
  const original = {
    '予実計画': [['期間', '週キー', '集計キー', '予定工数', '計画ID'], ['週', '2026-W42', '設計', 4, 'plan-1']]
  };
  const { context, sheets, metadata } = createContext(original, { backupFails: true });
  const before = JSON.stringify(Array.from(sheets));
  assert.throws(() => context.ensureDatabaseSchema('sheet2026'), /Drive に書き込めません/);
  assert.equal(JSON.stringify(Array.from(sheets)), before);
  assert.equal(metadata.length, 0);
});

test('このアプリより新しい形式のファイルには保存しない（読み込みはできる）', () => {
  const { context, events } = createContext(currentFile(), {
    metadata: [{ metadataId: 1, metadataKey: 'matometeKousuKanri.schemaVersion', metadataValue: '99' }]
  });
  assert.equal(context.loadBudgetPlanRows('sheet2026')[0][11], 'plan-1');
  context.__newExecution();
  assert.throws(
    () => context.withUserWriteLock(() => context.loadBudgetPlanRows('sheet2026')),
    /新しい版のアプリで形式99に更新されています/
  );
  assert.deepEqual(events, []);
});

test('値の変換が要る移行は、正本の並びに直した後で1回だけ実行される', () => {
  const { context, metadata, sheets } = createContext(currentFile(), {
    metadata: [{ metadataId: 1, metadataKey: 'matometeKousuKanri.schemaVersion', metadataValue: String(CURRENT) }]
  });
  let runs = 0;
  vm.runInContext('APP_DB_SCHEMA_VERSION = ' + NEXT + ';', context);
  context.APP_DB_MIGRATIONS.push({ to: NEXT, description: '予定工数を30分単位に丸める', run: () => { runs += 1; } });
  context.ensureDatabaseSchema('sheet2026');
  assert.equal(runs, 1);
  assert.equal(metadata[0].metadataValue, String(NEXT));
  assert.match(sheets.get('形式変更履歴').rows[1][4], new RegExp('形式' + NEXT + ': 予定工数を30分単位に丸める'));
  context.__newExecution();
  context.ensureDatabaseSchema('sheet2026');
  assert.equal(runs, 1, '2回目は実行しない');
});

test('旧形式の列名・並びのシートも、移行前から見出し名で正しく読める', () => {
  const { context } = createContext({
    '予定タスク': [
      ['親タスク', '期間', '週キー', '課題', '予定工数', '期限', '状態', 'メモ', '順序', 'サブタスクID', '更新日時', '親計画ID'],
      ['設計', 'week', '2026-W42', '画面設計', 2, '', 'todo', '', 1, 'task-1', '', 'plan-1']
    ]
  });
  const rows = context.loadPlanningTaskRows('sheet2026');
  assert.deepEqual(JSON.parse(JSON.stringify(rows[0])), ['task-1', 'week', '2026-W42', '設計', '画面設計', 2, '', 'todo', '', 1, '', 'plan-1']);
});

test('読む前にシートを追加するような保存でも、新しい形式のファイルには一切書き込まない', () => {
  const { context, events } = createContext(currentFile(), {
    metadata: [{ metadataId: 1, metadataKey: 'matometeKousuKanri.schemaVersion', metadataValue: '99' }]
  });
  assert.throws(
    () => context.withUserWriteLock(() => context.saveCalendarExclusions('sheet2026', ['event-1'])),
    /新しい版のアプリ/
  );
  assert.deepEqual(events, []);
});

test('アプリが新しく作ったファイルは最新の形式として記録し、バックアップや移行をしない', () => {
  const { context, events, backups } = createContext({});
  context.markDatabaseSchemaCurrent('new-sheet');
  const state = context.ensureDatabaseSchema('new-sheet');
  assert.equal(state.repaired, false);
  assert.equal(backups.length, 0);
  assert.deepEqual(events, ['metadata:' + CURRENT]);
});

test('形式8以降の移行は、列を足すだけで値（重複した予定IDも含む）を変えない', () => {
  const file = currentFile();
  file['予実計画'].push(['week', '2026-W43', '設計', 2, '', '', 1, 2, 2, 'added', '2026/10/08', 'plan-1']);
  const { context, sheets, metadata } = createContext(file, {
    metadata: [{ metadataId: 1, metadataKey: 'matometeKousuKanri.schemaVersion', metadataValue: String(CURRENT) }]
  });
  const before = JSON.parse(JSON.stringify(sheets.get('予実計画').rows.slice(1)));
  vm.runInContext('APP_DB_SCHEMA_VERSION = ' + NEXT + '; BUDGET_PLAN_HEADER.push("新しい列");', context);
  const state = context.ensureDatabaseSchema('sheet2026');
  assert.equal(state.repaired, true);
  const plan = sheets.get('予実計画').rows;
  assert.equal(plan[0][22], '新しい列');
  assert.deepEqual(JSON.parse(JSON.stringify(plan.slice(1))), before);
  assert.equal(metadata[0].metadataValue, String(NEXT));
  assert.match(sheets.get('形式変更履歴').rows[1][4], /値は変えない/);
});

test('形式8以降の移行で知らない列があれば、どのシートも書き換えずに中止する', () => {
  const file = currentFile();
  file['予定タスク'][0].push('自分用メモ');
  const { context, sheets, metadata, events } = createContext(file, {
    metadata: [{ metadataId: 1, metadataKey: 'matometeKousuKanri.schemaVersion', metadataValue: String(CURRENT) }]
  });
  const before = JSON.stringify(Array.from(sheets));
  vm.runInContext('APP_DB_SCHEMA_VERSION = ' + NEXT + '; BUDGET_PLAN_HEADER.push("新しい列");', context);
  assert.throws(() => context.ensureDatabaseSchema('sheet2026'), /M列「自分用メモ」はアプリが使わない列のため、形式の移行を中止しました/);
  assert.equal(JSON.stringify(Array.from(sheets)), before);
  assert.equal(metadata[0].metadataValue, String(CURRENT));
  assert.deepEqual(events, [], 'バックアップも作らない');
});

test('形式8からの移行では、日次シートにサブタスクID列の見出しを足すだけで、既存の行は変えない', () => {
  const daily8 = ['日付', 'タスク名 (PJ名など)', '本日の工数', 'これまでの工数', '予定総工数', '進捗状況', '管理情報', '予定ID', 'プロジェクトID'];
  const file = currentFile();
  file['2026年10月'] = [daily8, ['2026/10/14', '設計 画面', 2, 0, 4, '', '', 'plan-1', 'project-1'], ['2026/10/15', '設計', 1, 2, 10, '完了', '', 'plan-1', '']];
  const { context, sheets, backups, metadata } = createContext(file, {
    metadata: [{ metadataId: 1, metadataKey: 'matometeKousuKanri.schemaVersion', metadataValue: '8' }]
  });
  const before = JSON.parse(JSON.stringify(sheets.get('2026年10月').rows.slice(1)));
  const planBefore = JSON.stringify(sheets.get('予実計画').rows);
  const state = context.ensureDatabaseSchema('sheet2026');
  assert.equal(state.repaired, true);
  assert.equal(backups.length, 1);
  assert.match(backups[0].name, new RegExp('形式8→' + CURRENT + ' 移行前'));
  const daily = sheets.get('2026年10月').rows;
  assert.deepEqual(daily[0], daily8.concat(['サブタスクID']));
  assert.deepEqual(JSON.parse(JSON.stringify(daily.slice(1))), before);
  // 予実計画は、形式11の優先順位の振り直し（G列）だけが変わり、ほかの列は変えない。
  const withoutPriority = rows => JSON.stringify(rows.map(row => row.filter((_, index) => index !== 6)));
  assert.equal(withoutPriority(sheets.get('予実計画').rows), withoutPriority(JSON.parse(planBefore)), '優先順位以外の予実計画は触らない');
  assert.equal(metadata[0].metadataValue, String(CURRENT));
});

test('保存ログ: 書き込んだ保存は成功・失敗を記録し、書く前に止まった保存は記録しない', () => {
  const { context, propertyValues } = createContext(currentFile(), {
    metadata: [{ metadataId: 1, metadataKey: 'matometeKousuKanri.schemaVersion', metadataValue: String(CURRENT) }]
  });
  const log = () => JSON.parse(propertyValues.get('appWriteLog.v1') || '[]');
  context.withUserWriteLock(() => context.sheetsValuesUpdate('sheet2026', "'予実計画'!A2:B2", [['week', '2026-W42']]));
  assert.deepEqual(log().map(entry => [entry.ok, entry.sheets.join(',')]), [[true, '予実計画']]);

  // 予実計画を書いたあと、予定タスクを書く前に失敗した（途中で失敗した保存）。
  assert.throws(() => context.withUserWriteLock(() => {
    context.sheetsValuesUpdate('sheet2026', "'予実計画'!A3:B3", [['week', '2026-W43']]);
    throw new Error('Service invoked too many times');
  }), /too many times/);
  assert.deepEqual(log().map(entry => [entry.ok, entry.sheets.join(',')]), [[true, '予実計画'], [false, '予実計画']]);
  assert.match(log()[1].error, /too many times/);

  // 何も書かずに止まった保存（見出しの点検で止めた場合など）は記録しない。
  assert.throws(() => context.withUserWriteLock(() => { throw new Error('保存を中止しました'); }));
  assert.equal(log().length, 2);

  // 戻す目安は、途中で失敗した保存の前に正常に保存できた時刻。
  const hint = context.appRestoreHint();
  assert.equal(hint.at, log()[0].at);
  assert.equal(hint.failedAfter.at, log()[1].at);
  assert.match(context.appRestoreHintText(), /最後にアプリが正常に保存したのは .*（「予実計画」）です。.*変更履歴/);
});

test('データの点検: 壊れていそうな箇所を一覧にし、シートは変更しない', () => {
  const file = currentFile();
  file['予実計画'].push(['week', '2026-W42', '設計（重複）', 2, '', '', 2, 2, 2, 'initial', '2026/10/01', 'plan-1']);
  file['予実計画'].push(['week', '2026-W43', '', 3, 'メモだけ']);
  file['予定タスク'].push(['task-1', 'week', '2026-W42', '設計', '画面', 2, '', 'todo', '', 1, '', 'plan-1']);
  file['予定タスク'].push(['task-1', 'week', '2026-W42', '消えた予定', '調査', 1, '', 'todo', '', 2, '', 'plan-deleted']);
  file['2026年10月'] = [
    ['日付', 'タスク名 (PJ名など)', '本日の工数', 'これまでの工数', '予定総工数', '進捗状況', '管理情報', '予定ID', 'プロジェクトID', 'サブタスクID'],
    ['2026/10/14', '設計', 2, 0, 4, '', '', 'plan-1', '', ''],
    ['', '日付なし', 1],
    ['2026/09/30', '前の月', 1],
    ['2026/10/15', '設計', '二時間', 0, 4]
  ];
  const { context, sheets } = createContext(file, {
    metadata: [{ metadataId: 1, metadataKey: 'matometeKousuKanri.schemaVersion', metadataValue: String(CURRENT) }]
  });
  const before = JSON.stringify(Array.from(sheets));
  const result = JSON.parse(JSON.stringify(context.checkDataHealth()));
  const found = result.problems.map(problem => problem.sheet + ' ' + problem.cell + ' ' + problem.message);
  assert.deepEqual(found, [
    '予実計画 L3 同じ期間に同じ予定IDの行が重なっています（2行目と）。',
    '予実計画 C4 予定名（集計キー）が空の行があります。',
    '予定タスク A3 サブタスクのIDが重なっています（2行目と）。',
    '予定タスク L3 親の予定（予定ID plan-deleted）が見つかりません。',
    '2026年10月 A3 日付が空か、日付として読めません。',
    '2026年10月 A4 このシートの月ではない日付（2026-09-30）です。',
    '2026年10月 C5 工数が数値ではありません（「二時間」）。'
  ]);
  assert.equal(JSON.stringify(Array.from(sheets)), before, '点検ではシートを変えない');
});

test('予定タスクは読み込みではキャッシュを使い、保存の中ではシートを読み直し、保存後は新しい内容をキャッシュする', () => {
  const file = currentFile();
  file['予定タスク'].push(['task-1', 'week', '2026-W42', '設計', '画面', 2, '', 'todo', '', 1, '', 'plan-1']);
  const { context, sheets } = createContext(file, {
    metadata: [{ metadataId: 1, metadataKey: 'matometeKousuKanri.schemaVersion', metadataValue: String(CURRENT) }]
  });
  let taskReads = 0;
  const get = context.Sheets.Spreadsheets.Values.get;
  context.Sheets.Spreadsheets.Values.get = function(id, range) {
    if (String(range).indexOf('予定タスク') >= 0) taskReads += 1;
    return get.apply(this, arguments);
  };
  assert.equal(context.loadPlanningTaskRows('sheet2026')[0][4], '画面');
  context.__newExecution();
  assert.equal(context.loadPlanningTaskRows('sheet2026')[0][4], '画面');
  assert.equal(taskReads, 1, '2回目はキャッシュから読む');

  // 保存の中では必ずシートを読み直す（人が直接編集していても古い内容で上書きしない）。
  sheets.get('予定タスク').rows[1][4] = '画面（シートで修正）';
  context.__newExecution();
  context.withUserWriteLock(() => assert.equal(context.loadPlanningTaskRows('sheet2026')[0][4], '画面（シートで修正）'));
  assert.equal(taskReads, 2);
  // 保存の中で読み直した内容がキャッシュに入るので、次の読み込みはシートを読まずに新しい内容を返す。
  context.__newExecution();
  assert.equal(context.loadPlanningTaskRows('sheet2026')[0][4], '画面（シートで修正）');
  assert.equal(taskReads, 2);
});

test('形式11の移行では、予定の優先順位を登録した週の古い順・週の中の順で全体共通の順位に振り直す', () => {
  const plan = (key, name, priority, id, extra) => {
    const row = PLAN_HEADER_V8.map(() => '');
    Object.assign(row, { 0: 'week', 1: key, 2: name, 3: 2, 6: priority, 11: id }, extra || {});
    return row;
  };
  const file = currentFile();
  file['予実計画'] = [PLAN_HEADER_V8,
    plan('2026-W42', '設計', 1, 'plan-1'),
    plan('2026-W42', '実装', 0, 'plan-2'),
    plan('2026-W43', '設計', 0, 'plan-3'),
    plan('2026-W43', 'レビュー', 1, 'plan-4'),
    plan('2026-W43', '実装', 0, 'plan-2', { 14: '2026-W42' }),
    plan('2026-10', '月の予定', 3, 'plan-5', { 0: 'month' }),
    plan('2026-W43', '会議', 2, 'plan-6', { 15: 'cal-1' })
  ];
  const { context, sheets } = createContext(file, {
    metadata: [{ metadataId: 1, metadataKey: 'matometeKousuKanri.schemaVersion', metadataValue: '10' }]
  });
  context.ensureDatabaseSchema('sheet2026');
  const priorities = Object.fromEntries(sheets.get('予実計画').rows.slice(1).map(row => [row[1] + ' ' + row[2] + (row[14] ? ' (引き継ぎ)' : ''), Number(row[6])]));
  assert.deepEqual(priorities, {
    '2026-W42 実装': 1024,
    '2026-W42 設計': 2048,
    '2026-W43 設計': 2048, // 同じ名前の予定は最初の予定の順位を引き継ぐ。
    '2026-W43 レビュー': 3072,
    '2026-W43 実装 (引き継ぎ)': 1024, // 引き継いだ行は登録した週の予定にそろえる。
    '2026-10 月の予定': 3, // 月の予定とカレンダーの行は変えない。
    '2026-W43 会議': 2
  });
});
