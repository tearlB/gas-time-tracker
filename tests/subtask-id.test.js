const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function budgetContext() {
  const context = {
    console,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: { formatDate: (date, tz, pattern) => pattern === 'yyyy-MM-dd' ? date.toISOString().slice(0, 10) : date.toISOString() },
    formatDateCellValue: value => String(value || '').replace(/-/g, '/')
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/budget.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/legacy.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/planning.gs', 'utf8'), context);
  return context;
}

// 予定「設計」は後から「基本設計」に、サブタスク「画面」は「画面設計」に名前を変えた。
const plans = [{ periodType: 'week', periodKey: '2026-W42', aggregationKey: '基本設計', planId: 'plan-1', plannedHours: 10 }];
const tasks = [{ id: 'task-1', periodType: 'week', periodKey: '2026-W42', parentKey: '基本設計', parentPlanId: 'plan-1', title: '画面設計', plannedHours: 4 }];
const rowsBeforeRename = [
  // 名前を変える前に保存した行（サブタスクIDあり）
  ['2026/10/12', '設計 画面', 2, 0, 4, '', '', 'plan-1', '', 'task-1'],
  // サブタスクIDのない古い行は、今までどおり名前で照合する（名前が変わると子の実績には数えられない）
  ['2026/10/13', '設計 画面', 1, 2, 4, '', '', 'plan-1', '', ''],
  // 名前を変えた後に保存した行
  ['2026/10/14', '基本設計 画面設計', 3, 3, 4, '', '', 'plan-1', '', 'task-1']
];

test('サブタスクIDのある行は、今の予定名とサブタスク名に読み替える（シートの値は変えない）', () => {
  const api = budgetContext();
  const source = rowsBeforeRename.map(row => row.slice());
  const resolved = api.budgetResolveDailyRowNames(source, plans, tasks);
  assert.deepEqual(Array.from(resolved, row => row[1]), ['基本設計 画面設計', '設計 画面', '基本設計 画面設計']);
  assert.equal(source[0][1], '設計 画面', '元の行は書き換えない');
});

test('予定名とサブタスク名を変えても、サブタスクIDのある実績は同じサブタスクに集計される', () => {
  const api = budgetContext();
  const resolved = api.budgetResolveDailyRowNames(rowsBeforeRename, plans, tasks);
  const context = api.budgetWeeklyDailyHoursContext('2026-10-15', plans, resolved, tasks, 'Asia/Tokyo');
  assert.equal(context.hoursByPlanChild['plan-1\u0000画面設計'], 5);
  assert.equal(context.actualBefore['plan-1'], 6, '親の実績には、IDのない古い行も予定IDで数える');
});

test('サブタスクIDのない行だけなら、読み替えずにそのまま返す', () => {
  const api = budgetContext();
  const rows = [['2026/10/13', '設計 画面', 1, 2, 4, '', '', 'plan-1', '']];
  assert.equal(api.budgetResolveDailyRowNames(rows, plans, tasks), rows);
});

test('週の予定から作る日次の候補は、サブタスクのIDを持つ', () => {
  const source = fs.readFileSync('gas/budget.gs', 'utf8');
  assert.match(source, /id: String\(task\.id \|\| ""\),\n\s+title: String\(task\.title \|\| ""\)\.trim\(\),\n\s+parentKey: plan\.aggregationKey/);
});

function codeContext() {
  const context = {
    console,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: { formatDate: () => '2026' }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/code.gs', 'utf8'), context);
  return context;
}

test('日次の保存と読み込みで、サブタスクIDを10列目に持つ', () => {
  const api = codeContext();
  const rows = api.buildRowsForSave({ tasks: [
    { name: '基本設計 画面設計', a: 1, b: 2, c: 4, planId: 'plan-1', subtaskId: 'task-1' },
    { name: '基本設計', a: 1, b: 0, c: 10, planId: 'plan-1' }
  ] }, '2026/10/14');
  assert.equal(rows[0][9], 'task-1');
  assert.equal(rows[1][9], '');
  const saved = api.extractSavedTasks(rows, '2026/10/14', 'Asia/Tokyo');
  assert.equal(saved.tasks[0].subtaskId, 'task-1');
  assert.equal(api.rowToOngoingTask(rows[0]).subtaskId, 'task-1', '翌日へ引き継ぐ行もIDを持つ');
});

test('完了列の「自動」は完了として読み、手で付けた TRUE とは区別する', () => {
  const api = budgetContext();
  const row = done => ['week', '2026-W42', '設計', 4, '', '', 1, 4, 4, 'initial', '', 'plan-1', '', '', '', '', done];
  const auto = api.budgetPersistedPlanFromRow(row('自動'), 0);
  assert.equal(auto.done, true);
  assert.equal(auto.completionOverride, null);
  assert.equal(auto.autoComplete, true);
  const manual = api.budgetPersistedPlanFromRow(row('TRUE'), 0);
  assert.equal(manual.done, true);
  assert.equal(manual.completionOverride, true);
  assert.equal(manual.autoComplete, false);
  const reopened = api.budgetPersistedPlanFromRow(row('FALSE'), 0);
  assert.equal(reopened.completionOverride, false);
});

test('予定画面から保存しても、自動の完了は「自動」のまま、手で完了にしたものは TRUE で残す', () => {
  const api = budgetContext();
  const header = Array.from(api.BUDGET_PLAN_HEADER);
  let written = null;
  api.requirePlanningSpreadsheetId = () => 'sheet';
  api.ensureBudgetPlanSheet = () => {};
  api.sanitizeEnteredString = value => String(value == null ? '' : value);
  api.sheetsValuesUpdate = (id, range, values) => { written = values; };
  api.sheetsValuesClear = () => {};
  api.a1Range = (name, range) => name + '!' + range;
  api.loadBudgetPlanRows = () => [
    ['week', '2026-W42', '自動で完了', 4, '', '', 1, 4, 4, 'initial', '', 'plan-auto', '', '', '', '', '自動'],
    ['week', '2026-W42', '手で完了', 4, '', '', 2, 4, 4, 'initial', '', 'plan-manual', '', '', '', '', 'TRUE']
  ];
  // 画面からは、完了の予定が done: true で届く（自動かどうかは画面は知らない）。
  api.saveBudgetPlans({ periodType: 'week', periodKey: '2026-W42', plans: [
    { periodType: 'week', periodKey: '2026-W42', aggregationKey: '自動で完了', plannedHours: 4, planId: 'plan-auto', done: true },
    { periodType: 'week', periodKey: '2026-W42', aggregationKey: '手で完了', plannedHours: 4, planId: 'plan-manual', done: true, completionOverride: true }
  ] }, { skipSummary: true });
  const doneColumn = header.indexOf('完了');
  assert.deepEqual(Array.from(written.slice(1), r => r[2] + ':' + r[doneColumn]), ['自動で完了:自動', '手で完了:TRUE']);
});

test('予定のない作業の「これまでの工数」は、保存値ではなく実績から計算し直す', () => {
  const api = budgetContext();
  // 10/12 に保存したときは「これまで 5h」。その後 10/13 の工数を 1h → 3h に直した。
  const rows = [
    ['2026/10/12', '問い合わせ対応', 2, 5, 0, '', '', '', ''],
    ['2026/10/13', '問い合わせ対応', 3, 7, 0, '', '', '', ''],
    ['2026/10/14', '問い合わせ対応', 1, 8, 0, '', '', '', '']
  ];
  const context = api.budgetWeeklyDailyHoursContext('2026-10-15', [], rows, [], 'Asia/Tokyo');
  assert.equal(context.previousByExactName['問い合わせ対応'], 11, '範囲より前の 5h ＋ 範囲内の 2+3+1h');
  const [task] = api.applyBudgetWeeklyHoursToDailyTasks('2026-10-15', [{ title: '問い合わせ対応', prevB: 8, prevC: 0, type: 'ongoing' }], context);
  assert.equal(task.prevB, 11, '保存されていた 8h ではなく計算し直した値');
});

test('サブタスク追加前に親へ付けた実績は、新しい子へ振り分けず親の合計に残す', () => {
  const api = budgetContext();
  const rows = [['2026/10/12', '基本設計', 2, 0, 10, '', '', 'plan-1', '', '']];
  const resolved = api.budgetResolveDailyRowNames(rows, plans, tasks);
  const context = api.budgetWeeklyDailyHoursContext('2026-10-15', plans, resolved, tasks, 'Asia/Tokyo');
  assert.equal(context.actualBefore['plan-1'], 2);
  assert.equal(Object.keys(context.hoursByPlanChild).length, 0);
  const child = api.applyBudgetWeeklyHoursToDailyTasks('2026-10-15', [
    { title: '基本設計 画面設計', planId: 'plan-1', subtaskId: 'task-1', prevB: 0, prevC: 4 }
  ], context)[0];
  assert.equal(child.prevB, 0);
  assert.equal(child.prevC, 4);
});

test('名前変更前の子の実績でも、IDから子の予定工数・過去実績を参照する', () => {
  const api = budgetContext();
  const context = api.budgetWeeklyDailyHoursContext('2026-10-15', plans,
    api.budgetResolveDailyRowNames(rowsBeforeRename, plans, tasks), tasks, 'Asia/Tokyo');
  const child = api.applyBudgetWeeklyHoursToDailyTasks('2026-10-15', [
    { title: '設計 画面', planId: 'plan-1', subtaskId: 'task-1', prevB: 0, prevC: 10 }
  ], context)[0];
  assert.equal(child.prevC, 4);
  assert.equal(child.prevB, 5);
});
