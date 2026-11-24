const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function createContext(driveOverrides) {
  const values = new Map();
  const cacheValues = new Map();
  const userCache = {
    get(key) { return cacheValues.has(key) ? cacheValues.get(key) : null; },
    getAll(keys) {
      return keys.reduce((result, key) => {
        if (cacheValues.has(key)) result[key] = cacheValues.get(key);
        return result;
      }, {});
    },
    put(key, value) { cacheValues.set(key, String(value)); },
    putAll(entries) { Object.keys(entries).forEach(key => cacheValues.set(key, String(entries[key]))); },
    remove(key) { cacheValues.delete(key); }
  };
  const properties = {
    getProperty(key) { return values.get(key) || null; },
    setProperty(key, value) { values.set(key, String(value)); },
    deleteProperty(key) { values.delete(key); }
  };
  const context = {
    console,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: { formatDate: () => '2026' },
    PropertiesService: { getScriptProperties: () => properties },
    CacheService: { getUserCache: () => userCache },
    Sheets: { Spreadsheets: {} },
    DriveApp: Object.assign({ getFoldersByName() { return { hasNext: () => false }; } }, driveOverrides || {})
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/code.gs', 'utf8'), context);
  context.__properties = properties;
  context.__cacheValues = cacheValues;
  return context;
}

function createSchemaContext(defaultSheetRows) {
  const sheets = new Map();
  const calls = [];
  let nextSheetId = 10;
  const propertyValues = new Map();
  const cacheValues = new Map();
  const properties = {
    getProperty(key) { return propertyValues.get(key) || null; },
    setProperty(key, value) { propertyValues.set(key, String(value)); }
  };
  const cache = {
    get(key) { return cacheValues.has(key) ? cacheValues.get(key) : null; },
    getAll(keys) { return keys.reduce((result, key) => { if (cacheValues.has(key)) result[key] = cacheValues.get(key); return result; }, {}); },
    put(key, value) { cacheValues.set(key, String(value)); },
    remove(key) { cacheValues.delete(key); }
  };
  function columnNumber(value) {
    return String(value).split('').reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
  }
  function coordinates(range) {
    const match = String(range).match(/^'((?:''|[^'])*)'!([A-Z]+)(\d+)(?::([A-Z]+)(\d*)?)?$/);
    if (!match) throw new Error('Unable to parse range: ' + range);
    return {
      sheetName: match[1].replace(/''/g, "'"),
      startColumn: columnNumber(match[2]),
      startRow: Number(match[3]) - 1,
      endColumn: match[4] ? columnNumber(match[4]) : columnNumber(match[2]),
      endRow: match[5] ? Number(match[5]) - 1 : null
    };
  }
  const developerMetadata = [];
  const backups = [];
  function sheetMeta() {
    return {
      sheets: Array.from(sheets, ([title, entry]) => ({ properties: { sheetId: entry.sheetId, title } })),
      developerMetadata: developerMetadata.map(entry => Object.assign({}, entry))
    };
  }
  function valueGet(_spreadsheetId, range) {
    const position = coordinates(range);
    const sheet = sheets.get(position.sheetName);
    if (!sheet) throw new Error('Unable to parse range: ' + range);
    const endRow = position.endRow == null ? sheet.rows.length - 1 : Math.min(position.endRow, sheet.rows.length - 1);
    if (endRow < position.startRow) return { values: [] };
    const values = [];
    for (let rowIndex = position.startRow; rowIndex <= endRow; rowIndex++) {
      const row = sheet.rows[rowIndex] || [];
      values.push(row.slice(position.startColumn, position.endColumn + 1));
    }
    calls.push({ type: 'get', range });
    return { values };
  }
  function valueUpdate(body, _spreadsheetId, range) {
    const position = coordinates(range);
    const sheet = sheets.get(position.sheetName);
    if (!sheet) throw new Error('Unable to parse range: ' + range);
    (body.values || []).forEach((row, rowOffset) => {
      const targetRow = position.startRow + rowOffset;
      while (sheet.rows.length <= targetRow) sheet.rows.push([]);
      row.forEach((value, columnOffset) => {
        sheet.rows[targetRow][position.startColumn + columnOffset] = value;
      });
    });
    calls.push({ type: 'update', range, values: body.values });
    return {};
  }
  function valueClear(_body, _spreadsheetId, range) {
    const position = coordinates(range);
    const sheet = sheets.get(position.sheetName);
    if (!sheet) throw new Error('Unable to parse range: ' + range);
    const endRow = position.endRow == null ? sheet.rows.length - 1 : position.endRow;
    for (let rowIndex = position.startRow; rowIndex <= endRow; rowIndex++) {
      while (sheet.rows.length <= rowIndex) sheet.rows.push([]);
      for (let column = position.startColumn; column <= position.endColumn; column++) sheet.rows[rowIndex][column] = '';
    }
    calls.push({ type: 'clear', range });
    return {};
  }
  function batchUpdate(body) {
    calls.push({ type: 'batchUpdate', requests: body.requests });
    (body.requests || []).forEach(request => {
      if (request.addSheet) {
        const props = request.addSheet.properties;
        sheets.set(props.title, { sheetId: props.sheetId || nextSheetId++, rows: [] });
      }
      if (request.deleteSheet) {
        for (const [title, entry] of sheets) {
          if (entry.sheetId === request.deleteSheet.sheetId) sheets.delete(title);
        }
      }
      if (request.createDeveloperMetadata) {
        developerMetadata.push(Object.assign({ metadataId: developerMetadata.length + 100 }, request.createDeveloperMetadata.developerMetadata));
      }
      if (request.updateDeveloperMetadata) {
        const id = request.updateDeveloperMetadata.dataFilters[0].developerMetadataLookup.metadataId;
        developerMetadata.filter(entry => entry.metadataId === id).forEach(entry => {
          entry.metadataValue = request.updateDeveloperMetadata.developerMetadata.metadataValue;
        });
      }
    });
    return {};
  }
  sheets.set('予実計画', {
    sheetId: 1,
    rows: [
      ['期間種別', '期間キー', '集計キー', '予定工数', 'メモ', '更新日時', '優先順位', '着地見込工数', '当初予定工数', '予定区分', '登録日時', '予定ID', '課題'],
      ['週', '2026-W35', '親課題', 4, '旧メモ', '2026/09/01 10:00:00', 1, '', 4, 'initial', '2026/08/01 10:00:00', 'plan-original', '調査:2\n実装:1'],
      ['週', '2026-W35', '別課題', 2, '', '', 2, '', '', '', '', 'plan-original', '']
    ]
  });
  sheets.set('予定タスク', {
    sheetId: 2,
    rows: [
      ['親課題', '期間', '週キー', '課題', '予定工数', '期限', '状態', 'メモ', '順序', 'ID'],
      ['親課題', '週', '2026-W35', '調査', 2, '2026/08/25', '未着手', '旧タスク', 3, '']
    ]
  });
  sheets.set('2026年08月', {
    sheetId: 3,
    rows: [
      ['タスク名', '日付', '本日の工数', '予定工数', '進捗状況', 'これまでの工数', '管理情報'],
      ['親課題 調査', '2026/08/25', 1, 4, '', 2, '']
    ]
  });
  sheets.set('週次報告', { sheetId: 4, rows: [['週キー', '課題・リスク'], ['2026-W35', '削除対象']] });
  sheets.set('Sheet1', { sheetId: 5, rows: defaultSheetRows || [] });

  const context = {
    console,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: { formatDate: () => '2026/09/14 12:00:00' },
    PropertiesService: { getScriptProperties: () => properties },
    CacheService: { getUserCache: () => cache },
    DriveApp: {
      getFileById: id => ({
        getName: () => '2026年 まとめて工数管理さん',
        getParents: () => ({ hasNext: () => false }),
        makeCopy(name) {
          backups.push({ id, name, rows: JSON.parse(JSON.stringify(Array.from(sheets))) });
          return { getUrl: () => 'https://example.com/backup/' + backups.length };
        }
      }),
      getRootFolder: () => ({
        getFoldersByName: () => ({ hasNext: () => false }),
        createFolder: () => ({})
      })
    },
    Sheets: {
      Spreadsheets: {
        get: () => sheetMeta(),
        batchUpdate,
        Values: { get: valueGet, update: valueUpdate, clear: valueClear }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/code.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/budget.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/legacy.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/planning.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/storage_schema.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/legacy.gs', 'utf8'), context);
  context.__sheets = sheets;
  context.__calls = calls;
  context.__properties = properties;
  context.__developerMetadata = developerMetadata;
  context.__backups = backups;
  return context;
}

test('DriveのフォルダURLとスプレッドシートURLからIDを取り出す', () => {
  const api = createContext();
  assert.equal(
    api.extractDriveResourceId('https://drive.google.com/drive/folders/folderABC_123456789'),
    'folderABC_123456789'
  );
  assert.equal(
    api.extractDriveResourceId('https://docs.google.com/spreadsheets/d/sheetABC_123456789/edit'),
    'sheetABC_123456789'
  );
  assert.equal(api.extractDriveResourceId('not a drive url'), '');
});

test('日次保存先がない場合もDriveへ自動作成しない', () => {
  const api = createContext();
  assert.throws(() => api.requireSpreadsheetIdForDate('2026-08-20'), /保存先が未設定/);
});

test('大きなシート値も分割キャッシュから復元し、保存時の再読込を避ける', () => {
  const api = createContext();
  const rows = Array.from({ length: 700 }, (_, index) => [
    '2026/09/01',
    'タスク-' + index + '-' + 'x'.repeat(180),
    1, 0, 8, '', '', 'plan-' + index
  ]);
  api.putCachedSheetValues('sheet-large', '2026年09月', rows);
  assert.deepEqual(JSON.parse(JSON.stringify(api.getCachedSheetValues('sheet-large', '2026年09月'))), rows);
  // キャッシュのキーには「シートから読み直す」で切り替わる世代番号が入るため、アプリと同じ関数で作る。
  assert.match(api.sheetValuesCacheKey('sheet-large', '2026年09月'), /^sv\.[^.]+\.sheet-large\.2026年09月$/);
  assert.match(api.__cacheValues.get(api.sheetValuesCacheKey('sheet-large', '2026年09月')), /"version":2/);

  let reads = 0;
  api.Sheets.Spreadsheets.Values = {
    get() {
      reads += 1;
      return { values: [] };
    }
  };
  const loaded = api.loadSheetValuesDirect('sheet-large', '2026年09月');
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.values)), rows);
  assert.equal(reads, 0);
});

test('旧列順・旧課題欄・重複IDを読み込み時に正規化し、中身の残る週次報告は削除しない', () => {
  const api = createSchemaContext();
  const first = api.ensureDatabaseSchema('schema-sheet');
  assert.equal(first.repaired, true);
  assert.deepEqual(Array.from(api.__sheets.get('予実計画').rows[0]), Array.from(api.BUDGET_PLAN_HEADER));
  assert.equal(api.__sheets.get('予実計画').rows.length, 3);
  assert.equal(api.__sheets.get('予実計画').rows[1][11], 'plan-original');
  assert.notEqual(api.__sheets.get('予実計画').rows[2][11], 'plan-original');
  assert.deepEqual(Array.from(api.__sheets.get('予定タスク').rows[0]), Array.from(api.PLANNING_TASK_HEADER));
  const taskRows = api.__sheets.get('予定タスク').rows.slice(1);
  assert.deepEqual(Array.from(taskRows, row => row[4]), ['調査', '実装']);
  assert.equal(taskRows[0][11], 'plan-original');
  assert.deepEqual(Array.from(api.__sheets.get('2026年08月').rows[0]), ['日付', 'タスク名 (PJ名など)', '本日の工数', 'これまでの工数', '予定総工数', '進捗状況', '管理情報', '予定ID', 'プロジェクトID', 'サブタスクID']);
  assert.deepEqual(Array.from(api.__sheets.get('2026年08月').rows[1]), ['2026/08/25', '親課題 調査', 1, 2, 4, '', '', '', '', '']);
  assert.equal(api.__sheets.has('週次報告'), true);
  assert.equal(api.__sheets.has('Sheet1'), false);
  // 修復したファイルには、その時点のスキーマ番号を記録する（番号は構造を変えるたびに上がる）。
  assert.equal(api.__properties.getProperty('appDbSchemaVersion:schema-sheet'), String(api.appDbSchemaVersion()));
  // 予実計画は「終了日」列まで含めた正本の列数にそろえる。
  assert.equal(api.__sheets.get('予実計画').rows[1].length, api.BUDGET_PLAN_HEADER.length);

  const callsAfterRepair = api.__calls.length;
  const second = api.ensureDatabaseSchema('schema-sheet');
  assert.equal(second.repaired, true);
  assert.equal(api.__calls.length, callsAfterRepair);
});

test('既定シートに手入力がある場合は自動修復で削除しない', () => {
  const api = createSchemaContext([['手入力メモ']]);
  api.ensureDatabaseSchema('schema-sheet-with-note');
  assert.equal(api.__sheets.has('Sheet1'), true);
});

test('v1の未完了FALSEは自動判定へ移行し、v2のFALSEは明示的な未完了として扱う', () => {
  const api = createSchemaContext();
  api.__sheets.get('予実計画').rows = [
    Array.from(api.BUDGET_PLAN_HEADER),
    ['week', '2026-W35', '自動判定', 4, '', '', 0, 4, 4, 'initial', '2026/08/01 10:00:00', 'plan-auto', '', '', '', '', 'FALSE', ''],
    ['week', '2026-W35', '完了済み', 2, '', '', 1, 2, 2, 'initial', '2026/08/01 10:00:00', 'plan-done', '', '', '', '', 'TRUE', '']
  ];
  api.ensureDatabaseSchema('schema-sheet-done-migration');
  assert.equal(api.__sheets.get('予実計画').rows[1][16], '');
  assert.equal(api.__sheets.get('予実計画').rows[2][16], 'TRUE');

  const explicitFalse = api.budgetPersistedPlanFromRow([
    'week', '2026-W35', '手動で戻す', 1, '', '', 0, 1, 1, 'initial', '2026/08/01 10:00:00', 'plan-clear', '', '', '', '', 'FALSE', ''
  ]);
  assert.equal(explicitFalse.done, false);
  assert.equal(explicitFalse.completionOverride, false);
});

test('書き込みロックは成功時も失敗時も必ず解放する', () => {
  const api = createContext();
  let released = 0;
  api.LockService = {
    getUserLock() {
      return {
        tryLock: () => true,
        releaseLock: () => { released++; }
      };
    }
  };
  assert.equal(api.withUserWriteLock(() => 'saved'), 'saved');
  assert.equal(released, 1);
  assert.throws(() => api.withUserWriteLock(() => { throw new Error('write failed'); }), /write failed/);
  assert.equal(released, 2);
});

test('年次管理の設定前は旧スプレッドシートを日次読込先にしない', () => {
  const api = createContext();
  api.__properties.setProperty('appSpreadsheetId', 'legacy-sheet');
  assert.equal(api.getSpreadsheetIdForDate('2026-08-20'), null);
  assert.deepEqual(Array.from(api.annualSpreadsheetIdsForRange('2026-08-01', '2026-09-01')), []);
});

test('全データの移行は確認済みでなければ作成処理へ進まない', () => {
  const api = createContext();
  assert.throws(() => api.migrateAppStorage({}), /確認が完了していません/);
});

test('Driveフォルダ選択用に現在地と子フォルダを返す', () => {
  function iterator(items) {
    let index = 0;
    return { hasNext: () => index < items.length, next: () => items[index++] };
  }
  const root = {
    getId: () => 'root-folder', getName: () => 'My Drive',
    getFolders: () => iterator([
      { getId: () => 'folder-b', getName: () => '資料' },
      { getId: () => 'folder-a', getName: () => '案件' }
    ])
  };
  const api = createContext({ getRootFolder: () => root, getFolderById: () => root });
  const result = api.listAppStorageFolders('');
  assert.equal(result.current.name, 'マイドライブ');
  assert.deepEqual(Array.from(result.folders, folder => folder.name), ['案件', '資料']);
  assert.equal(result.parent, null);
  assert.deepEqual(Array.from(result.ancestors, item => item.name), ['マイドライブ']);
  assert.equal(result.current.path, 'マイドライブ');
});

test('日次への追加候補は週予定の親だけ残す', () => {
  const api = createContext();
  const result = api.filterImportSuggestions([
    { title: '設計', type: 'planning' },
    { title: '設計', type: 'calendar' },
    { title: '実装', type: 'planning' },
    { title: '継続作業', type: 'ongoing' }
  ], ['会議']);
  assert.deepEqual(Array.from(result, item => item.title + ':' + item.type), ['設計:planning', '実装:planning']);
});

test('週予定の親は子タスクが日次にあっても候補に残す', () => {
  const api = createContext();
  const result = api.filterImportSuggestions([
    { title: '課題1', type: 'planning' },
    { title: '課題1 調査', type: 'ongoing' }
  ], ['課題1 調査']);
  assert.deepEqual(Array.from(result, item => item.title + ':' + item.type), ['課題1:planning']);
});

test('日次タスクは完了するまで自動継続する', () => {
  const api = createContext();
  const context = { targetFormatted: '2026/08/21', tz: 'Asia/Tokyo' };
  const rows = [
    ['2026/08/20', '未完了', 2, 1, 8, '', ''],
    ['2026/08/20', '工数到達', 3, 2, 5, '', ''],
    ['2026/08/20', '明示完了', 1, 0, 8, '完了', ''],
    ['2026/08/20', '朝会', 0, 0, 0.5, '', 'カレンダー']
  ];
  const result = api.ongoingTasksFromLatestDate(rows, context);
  assert.deepEqual(Array.from(result, task => task.title), ['未完了', '工数到達']);
  assert.equal(result[0].prevB, 3);
});

test('日次のカレンダー自動行は保存印を残し継続対象にしない', () => {
  const api = createContext();
  const saved = api.extractSavedTasks([
    ['2026/08/25', '朝会', 0.5, 0, 0.5, '', 'カレンダー'],
    ['2026/08/25', '設計', 2, 1, 8, '', '']
  ], '2026/08/25', 'Asia/Tokyo');
  assert.equal(saved.mode, 'edit');
  assert.equal(saved.tasks[0].type, 'calendar');
  assert.equal(saved.tasks[1].type, 'saved');
  const rows = api.buildRowsForSave({
    tasks: [
      { name: '朝会', a: 0.5, b: 0, c: 0.5, d: '', calendar: true },
      { name: '設計', a: 2, b: 1, c: 8, d: '', planId: 'plan-stable-1' }
    ]
  }, '2026/08/25');
  assert.equal(rows[0][6], 'カレンダー');
  assert.equal(rows[1][6], '');
  assert.equal(rows[1][7], 'plan-stable-1');
  const loaded = api.extractSavedTasks([
    ['2026/08/25', '変更前の名前 調査', 2, 1, 8, '', '', 'plan-stable-1']
  ], '2026/08/25', 'Asia/Tokyo');
  assert.equal(loaded.tasks[0].planId, 'plan-stable-1');
});

test('日次の割り込みは保存印を残し継続対象にしない', () => {
  const api = createContext();
  const saved = api.extractSavedTasks([
    ['2026/08/25', '問い合わせ対応', 1.25, 0, 0, '完了', '割り込み'],
    ['2026/08/25', '設計', 2, 1, 8, '', '']
  ], '2026/08/25', 'Asia/Tokyo');
  assert.equal(saved.mode, 'edit');
  assert.equal(saved.tasks[0].type, 'interrupt');
  assert.equal(saved.tasks[1].type, 'saved');
  const rows = api.buildRowsForSave({
    tasks: [
      { name: '変更後の問い合わせ対応', a: 1.25, b: 0, c: 1.25, d: '完了', interrupt: true },
      { name: '設計', a: 2, b: 1, c: 8, d: '', planId: 'plan-stable-1' }
    ]
  }, '2026/08/25');
  assert.equal(rows[0][6], '割り込み');
  assert.equal(rows[0][1], '変更後の問い合わせ対応');
  assert.equal(rows[0][4], 1.25);
  assert.equal(rows[1][6], '');
  const renamed = api.extractSavedTasks(rows, '2026/08/25', 'Asia/Tokyo');
  assert.equal(renamed.tasks[0].title, '変更後の問い合わせ対応');
  const context = { targetFormatted: '2026/08/26', tz: 'Asia/Tokyo' };
  const ongoing = api.ongoingTasksFromLatestDate([
    ['2026/08/25', '問い合わせ対応', 1.25, 0, 0, '', '割り込み'],
    ['2026/08/25', '未完了', 2, 1, 8, '', '']
  ], context);
  assert.deepEqual(Array.from(ongoing, task => task.title), ['未完了']);
  assert.equal(api.dailyRowIsSameDayOnly(['2026/08/25', '問い合わせ対応', 1.25, 0, 0, '完了', '割り込み']), true);
});

test('カレンダー由来の今日だけはイベントキーを保存して復元する', () => {
  const api = createContext();
  const key = 'meet-1:2026-08-25:10:00:0';
  const mark = 'カレンダー今日だけ:' + key;
  const saved = api.extractSavedTasks([
    ['2026/08/25', '会議', 1.25, 0, 0, '完了', mark]
  ], '2026/08/25', 'Asia/Tokyo');
  assert.equal(saved.tasks[0].type, 'interrupt');
  assert.equal(saved.tasks[0].calendarKey, key);
  const rows = api.buildRowsForSave({
    tasks: [{ name: '会議', a: 1.25, b: 0, c: 0, d: '完了', interrupt: true, calendarInterrupt: true, calendarKey: key }]
  }, '2026/08/25');
  assert.equal(rows[0][6], mark);
});

test('年次ファイルを日付と年またぎ期間から選択する', () => {
  const api = createContext();
  api.__properties.setProperty('appStorageMode', 'annual');
  api.__properties.setProperty('appStorageYearFiles', JSON.stringify({ 2025: 'sheet-2025', 2026: 'sheet-2026' }));
  assert.equal(api.getSpreadsheetIdForDate('2025-12-31'), 'sheet-2025');
  assert.equal(api.getSpreadsheetIdForDate('2026-01-01'), 'sheet-2026');
  assert.deepEqual(Array.from(api.annualSpreadsheetIdsForRange('2025-12-29', '2026-01-05')), ['sheet-2025', 'sheet-2026']);
});

test('新しい年次ファイルも確認済みでなければ作成しない', () => {
  const api = createContext();
  assert.throws(() => api.createAnnualStorageFile({ year: 2027 }), /確認が完了していません/);
});

test('gas/ のサーバー側ファイルはすべて GAS への送信対象（.claspignore の除外解除）に入っている', () => {
  const ignore = fs.readFileSync('gas/.claspignore', 'utf8').split('\n').map(line => line.trim());
  const files = fs.readdirSync('gas').filter(name => name.endsWith('.gs'));
  for (const file of files) assert.ok(ignore.includes('!' + file), file + ' が gas/.claspignore に入っていないため、GAS に送られない');
});

test('既存の管理フォルダから年次ファイルを見つけ、移行前のバックアップや別の表は使わない', () => {
  function iterator(items) {
    let index = 0;
    return { hasNext: () => index < items.length, next: () => items[index++] };
  }
  const file = (id, name, updated) => ({ getId: () => id, getName: () => name, getUrl: () => 'url-' + id, getLastUpdated: () => new Date(updated) });
  const folder = {
    getId: () => 'managed-folder-id', getName: () => 'まとめて工数管理さん',
    getParents: () => iterator([{ getId: () => 'parent', getName: () => 'マイドライブ', getParents: () => iterator([]) }]),
    getFilesByType: () => iterator([
      file('y2026', '2026年 まとめて工数管理さん', '2026-11-01'),
      file('y2026old', '2026年工数管理データ', '2026-01-01'),
      file('backup', '2026年 まとめて工数管理さん（形式10→11 移行前）', '2026-11-02'),
      file('y2025', '2025年工数管理データ', '2025-12-01'),
      file('memo', 'メモ', '2026-11-01'),
      file('other', '2024年 別の表', '2024-01-01')
    ])
  };
  const context = createContext({ getFolderById: () => folder });
  context.BUDGET_PLAN_SHEET_NAME = '予実計画';
  context.MimeType = { GOOGLE_SHEETS: 'sheets' };
  context.sheetsGetMeta = id => ({ sheets: [{ properties: { title: id === 'other' ? 'Sheet1' : '予実計画' } }] });
  const result = context.inspectExistingAppStorage('managed-folder-id');
  assert.deepEqual(Array.from(result.files, item => item.id), ['y2025', 'y2026']);
  assert.equal(result.missingCurrentYear, false);
  assert.throws(() => context.attachAppStorage({ folderId: 'managed-folder-id' }), /確認が完了していません/);
  context.ensureDatabaseSchema = () => null;
  context.getAppStorageStatus = () => ({ configured: true });
  context.attachAppStorage({ folderId: 'managed-folder-id', confirmed: true });
  assert.equal(context.__properties.getProperty('appStorageFolderId'), 'managed-folder-id');
  assert.equal(context.__properties.getProperty('appStorageParentFolderId'), 'parent');
  assert.deepEqual(JSON.parse(context.__properties.getProperty('appStorageYearFiles')), { 2025: 'y2025', 2026: 'y2026' });
});

test('作成先に同じ名前のフォルダがあれば、確認の前に知らせる', () => {
  function iterator(items) {
    let index = 0;
    return { hasNext: () => index < items.length, next: () => items[index++] };
  }
  const existing = { getId: () => 'existing-folder-id', getName: () => 'まとめて工数管理さん', getFilesByType: () => iterator([]) };
  const parent = {
    getId: () => 'parent-folder-id', getName: () => '仕事', getParents: () => iterator([]),
    getFoldersByName: name => iterator(name === 'まとめて工数管理さん' ? [existing] : [])
  };
  const context = createContext({ getFolderById: () => parent });
  context.MimeType = { GOOGLE_SHEETS: 'sheets' };
  const same = context.previewAnnualStorageMigration({ folderId: 'parent-folder-id', title: 'まとめて工数管理さん' });
  assert.equal(same.existingFolder.id, 'existing-folder-id');
  const other = context.previewAnnualStorageMigration({ folderId: 'parent-folder-id', title: '別の名前' });
  assert.equal(other.existingFolder, null);
});
