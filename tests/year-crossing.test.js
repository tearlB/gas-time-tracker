const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

// 2025年と2026年の年次ファイルを持つ状態。予定はISO週の年のファイルに入っている。
function createContext() {
  const files = {
    sheet2025: {
      plans: [['week', '2025-W52', '年末からの設計', 8, '', '', 1, 8, 8, 'initial', '2025/12/20', 'plan-2025', '2025/12/22', '', '', '', '', '', '', '', '', '2026/01/09']],
      tasks: [['task-2025', 'week', '2025-W52', '年末からの設計', '画面設計', 4, '', 'todo', '', 1, '', 'plan-2025']]
    },
    sheet2026: {
      plans: [['week', '2026-W01', '新年の実装', 6, '', '', 1, 6, 6, 'initial', '2025/12/28', 'plan-2026', '2025/12/29', '', '', '', '', '', '', '', '', '2026/01/02']],
      tasks: []
    }
  };
  const context = {
    console,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: { formatDate: (date, tz, pattern) => pattern === 'yyyy-MM-dd' ? date.toISOString().slice(0, 10) : date.toISOString() },
    formatDateCellValue: value => String(value || '').replace(/-/g, '/'),
    requireSheetsApi() {},
    getPlanningSpreadsheetId: (type, key) => String(key).slice(0, 4) === '2025' ? 'sheet2025' : 'sheet2026',
    annualSpreadsheetIdsForRange: (start, end) => (start < '2026-01-01' ? ['sheet2025'] : []).concat(end > '2026-01-01' ? ['sheet2026'] : []),
    loadBudgetDailyRowsForYmdRange: () => [],
    readOnly: true
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/budget.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/legacy.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/planning.gs', 'utf8'), context);
  context.loadBudgetPlanRows = id => files[id].plans;
  context.loadPlanningTaskRows = id => files[id].tasks;
  return context;
}

test('年をまたぐ週は、振り返り範囲にかかる前の年のファイルの予定とサブタスクも読む', () => {
  const api = createContext();
  const range = api.budgetWeeklyActualsRange('2026-W01', 'Asia/Tokyo');
  const ids = Array.from(api.budgetPlanningSpreadsheetIds('week', '2026-W01', range));
  assert.deepEqual(ids, ['sheet2026', 'sheet2025'], 'その週の年のファイルを先に、前の年を後に読む');

  const plans = api.loadBudgetPlansFromSpreadsheets(ids);
  assert.deepEqual(Array.from(plans, plan => plan.planId).sort(), ['plan-2025', 'plan-2026']);
  const tasks = api.loadPlanningTasksFromSpreadsheets(ids);
  assert.deepEqual(Array.from(tasks, task => task.id), ['task-2025']);
});

test('年の途中の週は、その年のファイルだけを読む', () => {
  const api = createContext();
  const range = { startYmd: '2026-05-01', endExclusiveYmd: '2026-08-01' };
  assert.deepEqual(Array.from(api.budgetPlanningSpreadsheetIds('week', '2026-W30', range)), ['sheet2026']);
});

test('日次画面の週予定は、前の年から続く予定も候補に含める', () => {
  const api = createContext();
  let received = null;
  const select = api.selectWeeklyPlansForDailySuggestions;
  api.selectWeeklyPlansForDailySuggestions = function(plans) {
    received = Array.from(plans, plan => plan.planId).sort();
    return select.apply(this, arguments);
  };
  // 候補の選び方だけを見る（その後の日次シートの読み込みはこのモックでは扱わない）。
  try { api.loadWeeklyDailyHoursContext('2026-01-02'); } catch (_) {}
  assert.deepEqual(received, ['plan-2025', 'plan-2026']);
});

test('同じ予定が複数のファイルにあっても二重に数えない', () => {
  const api = createContext();
  api.loadBudgetPlanRows = () => [['week', '2026-W01', '新年の実装', 6, '', '', 1, 6, 6, 'initial', '', 'plan-2026']];
  assert.equal(api.loadBudgetPlansFromSpreadsheets(['sheet2026', 'sheet2025']).length, 1);
});

test('保存する日次行の予定IDが空なら、その週の予定から名前で1つに決まるものの予定IDを書き込む', () => {
  const api = createContext();
  api.loadBudgetPlanRows = id => id === 'sheet2026' ? [
    ['week', '2026-W03', '設計', 6, '', '', 1, 6, 6, 'initial', '', 'plan-design', '2026/01/12', '', '', '', '', '', 'project-1', '', '', '2026/01/16'],
    ['week', '2026-W03', '重複', 2, '', '', 2, 2, 2, 'initial', '', 'plan-dup-1', '2026/01/12', '', '', '', '', '', '', '', '', '2026/01/16'],
    ['week', '2026-W03', '重複', 2, '', '', 3, 2, 2, 'initial', '', 'plan-dup-2', '2026/01/12', '', '', '', '', '', '', '', '', '2026/01/16']
  ] : [];
  const rows = api.budgetFillDailyPlanIds('2026-01-14', [
    ['2026/01/14', '設計', 1, 1, 0, '', '', '', ''],
    ['2026/01/14', '設計 画面', 1, 1, 0, '', '', '', ''],
    ['2026/01/14', '重複', 1, 1, 0, '', '', '', ''],
    ['2026/01/14', '設計', 1, 1, 0, '', 'カレンダー', '', ''],
    ['2026/01/14', '設計', 1, 1, 0, '', '', 'plan-other', 'project-x'],
    ['2026/01/14', '予定にない作業', 1, 1, 0, '', '', '', '']
  ]);
  const ids = Array.from(rows, row => row[7] + '/' + row[8]);
  assert.deepEqual(ids, [
    'plan-design/project-1',
    'plan-design/project-1',
    '/',
    '/',
    'plan-other/project-x',
    '/'
  ]);
});

test('予定IDがすべて入っているときは予定を読まない', () => {
  const api = createContext();
  api.loadBudgetPlanRows = () => { throw new Error('読まない'); };
  const rows = [['2026/01/14', '設計', 1, 1, 0, '', '', 'plan-design', '']];
  assert.equal(api.budgetFillDailyPlanIds('2026-01-14', rows), rows);
});
