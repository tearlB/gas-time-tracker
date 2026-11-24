const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function serverContext() {
  const properties = new Map();
  const context = {
    PropertiesService: { getUserProperties: () => ({
      getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => properties.set(key, value)
    }) },
    withUserWriteLock: action => action(),
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: { formatDate: date => date.toISOString().slice(0, 10) },
    formatDateCellValue: value => String(value).replace(/-/g, '/')
  };
  vm.createContext(context);
  for (const file of ['gas/completion_settings.gs', 'gas/budget.gs', 'gas/planning.gs']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  }
  return context;
}

test('完了同期は標準オフで、本人の設定で有効・無効を保存する', () => {
  const api = serverContext();
  assert.equal(api.getPlanActualCompletionSyncSettings().enabled, false);
  assert.equal(api.savePlanActualCompletionSyncSettings({ enabled: true }).enabled, true);
  assert.equal(api.planActualCompletionSyncEnabled(), true);
  assert.equal(api.savePlanActualCompletionSyncSettings({ enabled: false }).enabled, false);
  assert.equal(serverContext().planActualCompletionSyncEnabled(), false, '別の利用者には引き継がない');
});

test('同期オフなら実績の完了で予定を完了にせず、オンの場合だけ連動する', () => {
  const api = serverContext();
  const plans = [{ periodType: 'week', periodKey: '2026-W44', planId: 'p1', aggregationKey: '設計', plannedHours: 8 }];
  const actuals = [['2026/10/28', '設計', 2, 0, 8, '完了', '', 'p1']];
  const summary = () => api.calculateBudgetSummary('week', '2026-W44', plans, actuals, 'Asia/Tokyo').rows[0];
  assert.equal(summary().dailyComplete, true);
  assert.equal(summary().complete, false);
  assert.equal(api.budgetPlanSuggestionIsComplete(plans[0], { completedByPlan: { p1: true } }), false);
  let writes = 0;
  api.persistEffectivePlanCompletion = () => writes++;
  api.persistEffectivePlanCompletionForDate('2026-10-28', actuals, []);
  assert.equal(writes, 0);
  api.savePlanActualCompletionSyncSettings({ enabled: true });
  assert.equal(summary().complete, true);
  api.persistEffectivePlanCompletionForDate('2026-10-28', actuals, []);
  assert.equal(writes, 1);
  api.savePlanActualCompletionSyncSettings({ enabled: false });
  assert.equal(summary().complete, false);
  plans[0].done = true;
  assert.equal(summary().complete, true, '予定で手動指定した完了は維持する');
});

test('今日だけの作業は分類・再分類してもユーザーが選んだ状態を保持する', () => {
  const source = fs.readFileSync('ui/core.js', 'utf8');
  const from = source.indexOf('    function classifyDailyRowType(');
  const to = source.indexOf('    function applySavedWeekWorkspace(', from);
  const api = { numericHours: Number, roundHours: value => Math.round((Number(value) || 0) * 4) / 4, weeklyHasNamedIssue: () => false, parentKeyForDailyName: () => '', dailyParentNames: () => [] };
  vm.createContext(api);
  vm.runInContext(source.slice(from, to), api);
  for (const status of ['', '完了']) {
    const row = { type: 'interrupt', name: '臨時対応', status, today: 1 };
    api.classifyDailyRowType(row, '2026-10-28');
    assert.equal(row.status, status);
  }
  const row = { type: 'new', name: '新しい作業', status: '', today: 0 };
  api.classifyDailyRowType(row, '2026-10-28');
  assert.equal(row.type, 'interrupt');
  assert.equal(row.status, '');
});

test('画面の予定完了判定も設定に従い、実績の完了と分離する', () => {
  const source = fs.readFileSync('ui/planning_data.js', 'utf8');
  const start = source.indexOf('    function planSubtasksComplete(');
  const end = source.indexOf('    function normalizePlanProgress(', start);
  let enabled = false;
  const api = { completionSyncEnabled: () => enabled, state: { planner: { summary: { subtasks: [] } } }, planningTaskBelongsToPlan: () => false };
  vm.createContext(api);
  vm.runInContext(source.slice(start, end), api);
  const plan = { done: false, dailyTracked: true, dailyComplete: true };
  assert.equal(api.planIsComplete(plan), false);
  enabled = true;
  assert.equal(api.planIsComplete(plan), true);
  enabled = false;
  api.setPlanCompletion(plan, true);
  assert.equal(api.planIsComplete(plan), true);
  api.setPlanCompletion(plan, false);
  assert.equal(api.planIsComplete(plan), false);
});

test('実績から登録元の週と予定モーダルへ移動し、未保存の実績を先に保存する', async () => {
  const source = fs.readFileSync('ui/daily.js', 'utf8');
  const start = source.indexOf('    async function openDailyPlanEditor(');
  const end = source.indexOf('    function setDailyWeekWorkspace(', start);
  const row = { id: 'r1', name: '設計 API', planId: 'p1', subtaskId: 's1' };
  const plan = { id: 'p1', name: '設計', originWeek: '2026-W43' };
  const calls = [];
  const api = {
    state: { view: 'daily', daily: { rows: [row], date: '2026-10-28', dirty: true }, planner: {} },
    syncDailyFromDom() {}, dailyRowIsInterrupt: () => false, parentNameForDaily: () => '設計',
    dailyPlanItems: () => [plan], plannerItems: () => [plan], closeDailyRowSheet() {},
    async saveDaily() { calls.push('save'); api.state.daily.dirty = false; },
    async setCalendarMode(mode, week) { calls.push([mode, week]); api.state.view = 'planning'; api.state.planner.key = week; },
    openPlanDialog(options) { calls.push({ ...options }); }, toast() {}, Date
  };
  vm.createContext(api);
  vm.runInContext(source.slice(start, end), api);
  await api.openDailyPlanEditor({ dataset: { id: 'r1' } });
  assert.deepEqual(calls, ['save', ['week', '2026-W43'], { id: 'p1', editSubtaskId: 's1' }]);
  api.state.view = 'daily';
  api.state.daily.dirty = true;
  api.saveDaily = async () => { calls.push('failed save'); };
  const before = calls.length;
  await api.openDailyPlanEditor({ dataset: { id: 'r1' } });
  assert.equal(calls.length, before + 1, '保存失敗時は週へ移動しない');
});

test('前日からの繰り越しは、週の予定が完了なら締切前でも入れない', () => {
  const api = serverContext();
  const plans = [
    { periodType: 'week', periodKey: '2026-W44', planId: 'done1', aggregationKey: '完了済み', plannedHours: 8, done: true },
    { periodType: 'week', periodKey: '2026-W44', planId: 'open1', aggregationKey: '作業中', plannedHours: 8 }
  ];
  api.loadWeeklyDailyHoursContext = () => ({ plans, subtasks: [], hoursByExactName: {}, hoursByPlanChild: {}, actualBefore: {}, completedByPlan: {} });
  const ongoing = [
    { title: '完了済み', planId: 'done1', prevB: 2, prevC: 8, status: '' },
    { title: '作業中', planId: 'open1', prevB: 2, prevC: 8, status: '' },
    { title: '予定に紐づかない', planId: '', prevB: 0, prevC: 0, status: '' }
  ];
  const kept = api.applyWeeklyPlanHoursToDailyTasks('2026-10-29', ongoing, { dropCompleted: true }).map(task => task.title);
  assert.deepEqual(kept, ['作業中', '予定に紐づかない']);
  assert.equal(api.applyWeeklyPlanHoursToDailyTasks('2026-10-29', ongoing).length, 3, '保存済みの日は落とさない');
});

test('課題URLはBacklogの課題ページ（https）だけを保存し、ほかのURLは保存しない', () => {
  const api = serverContext();
  assert.equal(api.budgetIssueUrl(' https://example.backlog.jp/view/DEV-12 '), 'https://example.backlog.jp/view/DEV-12');
  assert.equal(api.budgetIssueUrl('https://example.backlogtool.com/view/DEV-1?x=1'), 'https://example.backlogtool.com/view/DEV-1?x=1');
  for (const url of ['http://example.backlog.jp/view/DEV-12', 'https://evil.example.com/view/DEV-12', 'https://example.backlog.jp.evil.com/view/DEV-12', 'https://x.backlog.jp@evil.com/view/DEV-1', 'javascript:alert(1)', 'https://example.backlog.jp/view/DEV-12"onmouseover=1', '']) {
    assert.equal(api.budgetIssueUrl(url), '', url);
  }
});

function planRow(overrides) {
  const row = ['週', '2026-W44', 'DEV-1 件名', 6, '', '', 1, 6, 6, 'initial', '2026/10/20 09:00:00', 'plan-1', '2026-10-27', '', '', '', '', '', '', '', '', '2026-10-30'];
  Object.keys(overrides || {}).forEach(index => { row[Number(index)] = overrides[index]; });
  return row;
}

test('予定の一部の項目だけを変える。許可する項目と値を検証する', () => {
  const api = serverContext();
  const changes = api.planFieldChanges_({ startDate: '2026-10-28', endDate: '2026-11-02', plannedHours: 8, note: ' メモ ', projectId: 'p1', done: true });
  assert.equal(changes.period.startDate, '2026-10-28');
  assert.equal(changes.plannedHours, 8);
  assert.equal(changes.note, 'メモ');
  assert.equal(changes.done, true);
  assert.equal(api.planFieldChanges_({ startDate: '', endDate: '' }).period.undated, true);
  assert.throws(() => api.planFieldChanges_({ startDate: '2026-11-02', endDate: '2026-10-28' }), /期間が不正/);
  assert.throws(() => api.planFieldChanges_({ startDate: '2026-10-28', endDate: '' }), /期間が不正/);
  assert.throws(() => api.planFieldChanges_({ plannedHours: -1 }), /予定工数/);
  assert.throws(() => api.planFieldChanges_({ name: '改名' }), /変更する項目がありません/, '名前は変えられない');
});

test('予定の項目の更新は、同じ予定IDの行だけを、その週の予定ごと保存し直す', () => {
  const api = serverContext();
  const sheetRows = [planRow(), planRow({ 2: '別の予定', 11: 'plan-2' }), planRow({ 1: '2026-W45', 11: 'plan-1' })];
  const saved = [];
  api.withUserWriteLock = action => action();
  api.getPlanningSpreadsheetId = () => 'sheet-1';
  api.loadBudgetPlanRows = () => sheetRows;
  api.saveBudgetPlans = (payload) => { saved.push(payload); return {}; };
  const result = api.updatePlanFields({ planId: 'plan-1', originWeek: '2026-W44', fields: { startDate: '2026-10-28', endDate: '2026-11-03', plannedHours: 9 } });
  assert.equal(result.updated, 2, '取り込み元と繰り越し先の両方');
  assert.deepEqual(saved.map(entry => entry.periodKey).sort(), ['2026-W44', '2026-W45']);
  const week44 = saved.find(entry => entry.periodKey === '2026-W44').plans;
  assert.equal(week44.length, 2, '同じ週の別の予定は残す');
  assert.equal(week44.find(plan => plan.planId === 'plan-1').endDate, '2026-11-03');
  assert.equal(week44.find(plan => plan.planId === 'plan-1').plannedHours, 9);
  assert.equal(week44.find(plan => plan.planId === 'plan-2').plannedHours, 6, '別の予定は変えない');
  assert.throws(() => api.updatePlanFields({ planId: 'missing', originWeek: '2026-W44', fields: { plannedHours: 1 } }), /見つかりません/);
});

test('平日1日の稼働時間は標準8hで、本人の設定で変えられる', () => {
  const api = serverContext();
  assert.equal(api.getWorkdayHoursSettings().hours, 8);
  assert.equal(api.saveWorkdayHoursSettings({ hours: 7.5 }).hours, 7.5);
  assert.equal(api.workdayDefaultHours(), 7.5);
  assert.throws(() => api.saveWorkdayHoursSettings({ hours: 0 }));
  assert.throws(() => api.saveWorkdayHoursSettings({ hours: 25 }));
  assert.equal(api.workdayDefaultHours(), 7.5, '不正な値では上書きしない');
});

test('勤務曜日と勤務時間帯は標準が月〜金・9:00〜18:00で、送った項目だけ保存する', () => {
  const api = serverContext();
  const initial = api.getWorkdayHoursSettings();
  assert.deepEqual(Array.from(initial.weekdays), [1, 2, 3, 4, 5]);
  assert.equal(initial.start, '09:00');
  assert.equal(initial.end, '18:00');
  const saved = api.saveWorkdayHoursSettings({ weekdays: [1, 2, 3, 4] });
  assert.deepEqual(Array.from(saved.weekdays), [1, 2, 3, 4]);
  assert.equal(saved.hours, 8, '送っていない項目は変えない');
  assert.equal(api.workdayHoursForWeekday(5), 0);
  assert.equal(api.workdayHoursForWeekday(1), 8);
  assert.deepEqual(Array.from(api.saveWorkdayHoursSettings({ weekdays: [] }).weekdays), [], '空にもできる');
  const range = api.saveWorkdayHoursSettings({ start: '10:00', end: '19:30' });
  assert.equal(range.start, '10:00');
  assert.equal(range.end, '19:30');
  assert.throws(() => api.saveWorkdayHoursSettings({ start: '18:00', end: '09:00' }));
  assert.equal(api.getWorkdayHoursSettings().start, '10:00', '不正な時間帯では上書きしない');
});
