const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 実データに近い「月の日次シート」を1枚持つモック。セルはシート上の実際の並びを表す。
function createContext(sheetRows) {
  const rows = sheetRows.map(row => row.slice());
  const updates = [];
  const cacheValues = new Map();
  const propertyValues = new Map([
    ['appStorageMode', 'annual'],
    ['appStorageYearFiles', JSON.stringify({ 2026: 'sheet2026' })]
  ]);
  const properties = {
    getProperty(key) { return propertyValues.has(key) ? propertyValues.get(key) : null; },
    setProperty(key, value) { propertyValues.set(key, String(value)); },
    deleteProperty(key) { propertyValues.delete(key); }
  };
  const cache = {
    get(key) { return cacheValues.has(key) ? cacheValues.get(key) : null; },
    getAll(keys) { return keys.reduce((result, key) => { if (cacheValues.has(key)) result[key] = cacheValues.get(key); return result; }, {}); },
    put(key, value) { cacheValues.set(key, String(value)); },
    putAll(entries) { Object.keys(entries).forEach(key => cacheValues.set(key, String(entries[key]))); },
    remove(key) { cacheValues.delete(key); }
  };
  function columnIndex(letters) {
    return letters.split('').reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
  }
  function parseRange(range) {
    const match = /!([A-Z]+)(\d+):([A-Z]+)(\d*)$/.exec(range);
    return { startColumn: columnIndex(match[1]), startRow: Number(match[2]), endColumn: columnIndex(match[3]), endRow: match[4] ? Number(match[4]) : null };
  }
  const context = {
    console,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: {
      formatDate(date, tz, format) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return format === 'yyyy年MM月' ? y + '年' + m + '月' : format === 'yyyy' ? String(y) : y + '/' + m + '/' + d;
      }
    },
    PropertiesService: { getScriptProperties: () => properties, getUserProperties: () => properties },
    CacheService: { getUserCache: () => cache },
    LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Sheets: {
      Spreadsheets: {
        Values: {
          get(id, range) {
            const { startRow } = parseRange(range);
            return { values: rows.slice(startRow - 1).map(row => row.slice()) };
          },
          update(body, id, range) {
            const { startRow, startColumn } = parseRange(range);
            updates.push(range);
            body.values.forEach((row, index) => {
              const target = rows[startRow - 1 + index] || (rows[startRow - 1 + index] = []);
              row.forEach((value, offset) => { target[startColumn + offset] = value; });
            });
          },
          clear(body, id, range) {
            const { startRow, endRow, startColumn, endColumn } = parseRange(range);
            for (let i = startRow - 1; i < endRow; i++) {
              const target = rows[i] || [];
              for (let c = startColumn; c <= endColumn; c++) target[c] = '';
              while (target.length && target[target.length - 1] === '') target.pop();
              rows[i] = target;
            }
          }
        },
        get: () => ({ sheets: [{ properties: { sheetId: 7, title: '2026年10月' } }] }),
        batchUpdate: () => ({ replies: [] })
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/code.gs', 'utf8'), context);
  return { context, rows, updates };
}

const HEADER = ['日付', 'タスク名 (PJ名など)', '本日の工数', 'これまでの工数', '予定総工数', '進捗状況', '管理情報', '予定ID', 'プロジェクトID', 'サブタスクID'];
const row = (date, name, hours) => [date, name, hours, hours, 0, '', '', '', ''];

test('人がシートを並べ替えた後に保存しても、古いキャッシュの行位置で他の日を上書きしない', () => {
  // アプリが最後に読んだ並び（キャッシュ）: 10/13 → 10/14
  const { context, rows } = createContext([HEADER, row('2026/10/13', '月曜の作業', 2), row('2026/10/14', '火曜の作業', 3)]);
  context.putCachedSheetValues('sheet2026', '2026年10月', [row('2026/10/13', '月曜の作業', 2), row('2026/10/14', '火曜の作業', 3)]);
  // その後、人がシートで日付の降順に並べ替えた。
  rows[1] = row('2026/10/14', '火曜の作業', 3);
  rows[2] = row('2026/10/13', '月曜の作業', 2);

  context.saveToSpreadsheet({ date: '2026-10-14', tasks: [{ name: '火曜の作業（修正）', a: 4, b: 4, c: 0 }] });

  const byDate = rows.slice(1).filter(r => r.length).map(r => r[0] + ':' + r[1]);
  assert.ok(byDate.includes('2026/10/13:月曜の作業'), '月曜の行が残っている: ' + byDate.join(', '));
  assert.ok(byDate.includes('2026/10/14:火曜の作業（修正）'));
  assert.equal(byDate.length, 2);
});

test('列が入れ替わっていても見出し名で読み、値を失わずに正本の並びへ直してから保存する', () => {
  const swapped = HEADER.slice();
  swapped[2] = 'これまでの工数';
  swapped[3] = '本日の工数';
  // シート上では C列=これまで、D列=本日。10/13 は本日 2h・これまで 5h。
  const { context, rows } = createContext([swapped, ['2026/10/13', '月曜の作業', 5, 2, 0, '', '', '', ''], row('2026/10/14', '火曜の作業', 3)]);
  assert.equal(context.loadSheetValuesDirect('sheet2026', '2026年10月').values[0][2], 2, '本日の工数を見出し名で読む');
  context.saveToSpreadsheet({ date: '2026-10-14', tasks: [{ name: '作業', a: 1, b: 4, c: 0 }] });
  assert.deepEqual(rows[0], HEADER);
  assert.deepEqual(rows[1].slice(0, 4), ['2026/10/13', '月曜の作業', 2, 5]);
  assert.deepEqual(rows[2].slice(0, 4), ['2026/10/14', '作業', 1, 4]);
});

test('アプリが知らない列や、見出しのない列に値があるときは保存を止め、シートに書き込まない', () => {
  const extra = HEADER.slice(0, 2).concat(['自分用メモ']).concat(HEADER.slice(2));
  const first = createContext([extra, ['2026/10/14', '火曜の作業', 'メモ', 3, 3, 0, '', '', '', '']]);
  assert.throws(
    () => first.context.saveToSpreadsheet({ date: '2026-10-14', tasks: [{ name: '作業', a: 1, b: 1, c: 0 }] }),
    /C列「自分用メモ」はアプリが使わない列のため、データを壊さないよう保存を中止しました/
  );
  assert.deepEqual(first.updates, []);

  const stray = createContext([HEADER, row('2026/10/14', '火曜の作業', 3).concat(['', '欄外のメモ'])]);
  assert.throws(
    () => stray.context.saveToSpreadsheet({ date: '2026-10-14', tasks: [{ name: '作業', a: 1, b: 1, c: 0 }] }),
    /K2に見出しのない列の値があるため/
  );
  assert.deepEqual(stray.updates, []);
});

test('末尾の列が足りないだけの旧版シートには保存できる', () => {
  const { context, rows } = createContext([HEADER.slice(0, 7), row('2026/10/14', '火曜の作業', 3)]);
  context.saveToSpreadsheet({ date: '2026-10-14', tasks: [{ name: '作業', a: 1, b: 1, c: 0 }] });
  assert.equal(rows[1][1], '作業');
});

test('読み込み画面は保存中でなければキャッシュを使い、保存中に読んだ値は同じ実行内で使い回す', () => {
  const { context } = createContext([HEADER, row('2026/10/14', 'シート上の値', 3)]);
  context.putCachedSheetValues('sheet2026', '2026年10月', [row('2026/10/14', 'キャッシュの値', 3)]);
  assert.equal(context.loadSheetValuesDirect('sheet2026', '2026年10月').values[0][1], 'キャッシュの値');
  let gets = 0;
  const get = context.Sheets.Spreadsheets.Values.get;
  context.Sheets.Spreadsheets.Values.get = function() { gets += 1; return get.apply(this, arguments); };
  context.withUserWriteLock(() => {
    assert.equal(context.loadSheetValuesDirect('sheet2026', '2026年10月').values[0][1], 'シート上の値');
    assert.equal(context.loadSheetValuesDirect('sheet2026', '2026年10月').values[0][1], 'シート上の値');
  });
  assert.equal(gets, 1);
});
