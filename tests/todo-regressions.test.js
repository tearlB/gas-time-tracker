const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function functions(file, start, end) {
  const source = fs.readFileSync(file, 'utf8');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
function dailyContext() {
  const tasks = [];
  const context = {
    state: { daily: { date: '2026-10-27' }, weeklySubtasksByWeek: { week: tasks } },
    parentNameForDaily: () => '基本設計',
    weeklySubtasksForDate: () => tasks,
    planningSubtaskMatchesParent: (task, parent, id) => task.parentPlanId === id,
    composeDailyChildName: (parent, child) => parent + ' ' + child,
    dailyBelongsToPlan: (name, parent) => name === parent || name.startsWith(parent + ' ')
  };
  vm.createContext(context);
  vm.runInContext(functions('ui/core.js', 'function weeklySubtaskTitleForId(', 'function dailyParentNames('), context);
  return { api: context, tasks };
}

test('予定名を変更した親の実績は、元の名前を保ちサブタスクとして表示しない', () => {
  const { api } = dailyContext();
  const label = api.dailyIssueLabel('設計', 'plan-1', '');
  assert.equal(label.title, '設計');
  assert.equal(label.parent, '');
  // 変更前の予定名が、変更後の名前で始まっていても同じ。
  const prefixed = api.dailyIssueLabel('基本設計 API', 'plan-1', '');
  assert.equal(prefixed.title, '基本設計 API');
  assert.equal(prefixed.parent, '');
});

test('後からサブタスクを追加しても、親の実績は親のまま、ID付きの子は子として表示する', () => {
  const { api, tasks } = dailyContext();
  tasks.push({ id: 'child-1', parentPlanId: 'plan-1', title: '画面設計' });
  assert.equal(api.childNameForDaily('基本設計', 'plan-1', ''), '');
  assert.equal(api.dailyIssueLabel('基本設計', 'plan-1', '').parent, '');
  const child = api.dailyIssueLabel('設計 画面', 'plan-1', 'child-1');
  assert.equal(child.title, '画面設計');
  assert.equal(child.parent, '基本設計');
  assert.equal(api.childNameForDaily('基本設計 画面設計', 'plan-1', ''), '画面設計', '旧形式の名前一致の子も残す');
});

function calendarContext(mode = 'edit') {
  const tasks = [{ name: '新しい会議', calendarKey: 'meeting-1', estimate: 1 }];
  const state = { daily: { date: '2026-10-27', loadedDate: '2026-10-27', mode, rows: [], calendarRowsAtLoad: [] } };
  const calls = { dirty: 0, render: 0 };
  const context = {
    state, calls,
    rememberDailyCalendarAutoNames() {},
    dailyCalendarTasksForDate: () => tasks,
    removedDailyCalendarRows: () => state.daily.calendarRowsAtLoad.filter(task => !state.daily.rows.some(row => row.calendarKey === task.calendarKey)),
    uid: () => 'row-' + state.daily.rows.length,
    roundHours: value => Number(value) || 0,
    syncDailyFromDom() {}, linkDailyCalendarRows() {},
    renderDaily() { calls.render++; }, markDailyDirty() { calls.dirty++; }
  };
  vm.createContext(context);
  vm.runInContext(functions('ui/planning_data.js', 'function applyDailyCalendarTasks(', 'function meetingEventsOnDay('), context);
  return { api: context, state, tasks, calls };
}

test('保存済みの日にも、後から増えた会議を既存実績を保って一度だけ追加・保存する', () => {
  const { api, state, calls } = calendarContext();
  state.daily.rows.push({ name: '実装', today: 3.25 });
  assert.equal(api.syncRefreshedDailyCalendarTasks('2026-10-27'), 1);
  assert.equal(state.daily.rows[0].today, 3.25);
  assert.equal(state.daily.rows[1].name, '新しい会議');
  assert.equal(state.daily.rows[1].today, 0);
  assert.equal(api.syncRefreshedDailyCalendarTasks('2026-10-27'), 0);
  assert.equal(calls.dirty, 1);
  state.daily.rows.pop();
  assert.equal(api.syncRefreshedDailyCalendarTasks('2026-10-27'), 0, '手動削除した会議は復活させない');
});

test('空で保存した日や表示日を変更した後の応答では会議を追加しない', () => {
  const empty = calendarContext('empty');
  assert.equal(empty.api.syncRefreshedDailyCalendarTasks('2026-10-27'), 0);
  const moved = calendarContext();
  moved.state.daily.date = '2026-10-28';
  assert.equal(moved.api.syncRefreshedDailyCalendarTasks('2026-10-27'), 0);
});

test('カレンダーから戻ったときは、5分のキャッシュ待ちなしに新しい予定を確認する', () => {
  const calls = [];
  const api = {
    document: { visibilityState: 'visible' },
    state: { view: 'daily', daily: { date: '2026-10-27' }, calendarFetchedAt: { 'week:2026-W44': Date.now() } },
    isoWeek: () => '2026-W44', parseYmd: value => value,
    weekCapacityCacheKey: key => 'week:' + key,
    calendarCacheIsFresh: key => !!api.state.calendarFetchedAt[key],
    loadDayAgenda: () => calls.push('refresh')
  };
  vm.createContext(api);
  vm.runInContext(functions('ui/planning_data.js', 'function refreshVisibleCalendarIfStale(', 'function refreshPlannerCalendar('), api);
  api.refreshVisibleCalendarIfStale();
  assert.equal(calls.length, 0);
  api.refreshVisibleCalendarIfStale(true);
  assert.equal(calls.length, 1);
  assert.equal(api.state.calendarFetchedAt['week:2026-W44'], undefined);
  api.document.visibilityState = 'hidden';
  api.refreshVisibleCalendarIfStale(true);
  assert.equal(calls.length, 1);
});
