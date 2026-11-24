const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const daily = fs.readFileSync(path.join(__dirname, '../ui/daily.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = daily.indexOf(startMarker);
  const end = daily.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, startMarker);
  return daily.slice(start, end);
}

function createContext(daily) {
  const calls = { gas: [], toast: [], timers: 0, loadDaily: 0 };
  const state = {
    view: 'daily',
    storage: { configured: true },
    nav: { daily: 0 },
    daily: Object.assign({
      date: '2026-10-14',
      loadedDate: '2026-10-14',
      saving: false,
      savingSeq: 0,
      rows: [{ id: 'r1', name: '最新の作業', today: 2, previous: 0, estimate: 0, status: '', type: 'saved' }],
      dirty: true,
      busy: false,
      saveQueued: false,
      changeSeq: 1,
      autoSaveTimer: null,
      autoSaveDeferred: false,
      autoSaveRetryCount: 0
    }, daily),
    planner: { dirty: false, autoSaveTimer: null }
  };
  const context = {
    state,
    calls,
    setTimeout() { calls.timers += 1; return 1; },
    clearTimeout() {},
    dailyHoursAreConfirmed: () => true,
    syncDailyFromDom() {},
    updateDailySummary() {},
    updateSaveDock() {},
    commitEditHistory() {},
    openPlanningSetup() {},
    applyWeeklyHoursToDailyRows() {},
    removedDailyCalendarRows: () => [],
    normalizeDailyRowsForSave: rows => rows.map(row => Object.assign({}, row)),
    numericHours: value => Number(value) || 0,
    dailyRowIsInterrupt: () => false,
    dailyRowIsCalendarInterrupt: () => false,
    showBusy() {},
    hideBusy() {},
    toast(message) { calls.toast.push(message); },
    loadDaily() { calls.loadDaily += 1; },
    async gas(name, payload) {
      calls.gas.push({ name, payload });
      throw new Error('stop after capture');
    }
  };
  vm.createContext(context);
  vm.runInContext(
    slice('const AUTO_SAVE_DELAY_MS', 'function updateSaveDock(') + slice('async function saveDaily(', 'async function reloadDaily('),
    context
  );
  return context;
}

test('表示日付と読み込み済みの日付が違う間は自動保存を予約しない', () => {
  const context = createContext({ date: '2026-10-14', loadedDate: '2026-10-07' });
  context.scheduleDailyAutoSave();
  assert.equal(context.calls.timers, 0);
  context.markDailyDirty();
  assert.equal(context.calls.timers, 0);
});

test('昔の日付の行が残っている間は自動保存でも手動保存でも書き込まない', async () => {
  const context = createContext({ date: '2026-10-14', loadedDate: '2026-10-07' });
  await context.saveDaily({ auto: true });
  await context.saveDaily();
  assert.equal(context.calls.gas.length, 0);
  assert.equal(context.calls.toast.length, 1);
});

test('読み込み前（loadedDate が空）の行は保存しない', async () => {
  const context = createContext({ loadedDate: '' });
  await context.saveDaily({ auto: true });
  assert.equal(context.calls.gas.length, 0);
});

test('保存先は行を読み込んだ日付になる', async () => {
  const context = createContext({});
  await context.saveDaily({ auto: true });
  assert.equal(context.calls.gas.length, 1);
  assert.equal(context.calls.gas[0].payload.date, '2026-10-14');
});

test('日付移動で行を切り離すと未保存フラグと自動保存が解除される', () => {
  const context = createContext({ date: '2026-10-14', loadedDate: '2026-10-07' });
  context.detachDailyRowsFromDate();
  assert.equal(context.state.daily.loadedDate, '');
  assert.equal(context.state.daily.dirty, false);
  assert.equal(context.state.daily.changeSeq, 2);
});

test('保存中は次の保存を順番待ちにし、同時に2件送らない', async () => {
  const context = createContext({ saving: true });
  await context.saveDaily({ auto: true });
  assert.equal(context.calls.gas.length, 0);
  assert.equal(context.state.daily.saveQueued, true);
});

test('loadDaily は日付が変わったら古い行を切り離し、保存中でも待たずに読み込む', () => {
  const body = slice('async function loadDaily(', 'ensureTaskNameSuggestions();');
  assert.match(body, /state\.daily\.loadedDate !== requestedDate\) detachDailyRowsFromDate\(\)/);
  assert.doesNotMatch(body, /saving|loadAfterSave/);
});

test('サブタスクから作った行は、サブタスクIDも一緒に保存する', async () => {
  const context = createContext({
    rows: [
      { id: 'r1', name: '設計 画面設計', planId: 'plan-1', subtaskId: 'task-1', today: 2, previous: 0, estimate: 0, status: '', type: 'new' },
      { id: 'r2', name: '設計', planId: 'plan-1', today: 1, previous: 0, estimate: 0, status: '', type: 'new' }
    ]
  });
  await context.saveDaily({ auto: true });
  const tasks = context.calls.gas[0].payload.tasks;
  assert.equal(tasks[0].subtaskId, 'task-1');
  assert.equal(tasks[1].subtaskId, '');
});

test('画面の行は、表示・編集・保存のあいだサブタスクIDを持ち続ける', () => {
  // 候補 → 行の下書き → 画面の要素 → 画面から集め直した行、のどこでも落とさない。
  assert.match(daily, /subtaskId: issue\.isParent \? '' : String\(issue\.subtaskId \|\| ''\)/);
  assert.match(daily, /planId: task\.planId \|\| '', subtaskId: task\.subtaskId \|\| '', name: name/);
  assert.match(daily, /el\.dataset\.subtaskId = row\.subtaskId \|\| '';/);
  assert.match(daily, /subtaskId: el\.dataset\.subtaskId \|\| '',\n(?:\s+[^\n]+\n)?\s+projectId: dailyProjectIdFromRow\(el\)/);
  const fromServer = daily.match(/planId: task\.planId \|\| '', subtaskId: task\.subtaskId \|\| ''/g) || [];
  assert.ok(fromServer.length >= 3, 'サーバーから受け取った行と候補から作った行の両方で引き継ぐ');
  const core = fs.readFileSync(path.join(__dirname, '../ui/core.js'), 'utf8');
  assert.match(core, /subtaskId: String\(task\.id \|\| ''\)/);
});

function leaveContext(daily, planner) {
  const calls = { saveDaily: 0, savePlanner: 0 };
  const state = {
    storage: { configured: true },
    daily: Object.assign({ dirty: false, saving: false, savingSeq: 0, changeSeq: 1, loadedDate: '2026-10-16', date: '2026-10-16', autoSaveDeferred: false, autoSaveTimer: null }, daily),
    planner: Object.assign({ dirty: false, saving: false, savingSeq: 0, changeSeq: 1, autoSaveTimer: null }, planner)
  };
  const context = {
    state,
    calls,
    hoursConfirmed: true,
    clearTimeout() {},
    dailyHoursAreConfirmed: () => context.hoursConfirmed,
    dailyRowsBelongToViewedDate: () => state.daily.loadedDate === state.daily.date,
    saveDaily() { calls.saveDaily += 1; state.daily.saving = true; state.daily.savingSeq = state.daily.changeSeq; },
    savePlanner() { calls.savePlanner += 1; state.planner.saving = true; state.planner.savingSeq = state.planner.changeSeq; }
  };
  vm.createContext(context);
  vm.runInContext(slice('    function dailyNeedsLeaveConfirm()', '    function cancelDailyAutoSave()') + slice('    function cancelDailyAutoSave()', '    function markDailyDirty('), context);
  return context;
}

test('移動するとき、未保存の変更はその場で保存を送り、確認を出さない', () => {
  const context = leaveContext({ dirty: true });
  assert.equal(context.dailyNeedsLeaveConfirm(), false);
  assert.equal(context.calls.saveDaily, 1);
});

test('保存中でも、保存を始めたあとに変更していなければ確認を出さずに移動できる', () => {
  const context = leaveContext({ dirty: true, saving: true, savingSeq: 3, changeSeq: 3 });
  assert.equal(context.dailyNeedsLeaveConfirm(), false);
  assert.equal(context.calls.saveDaily, 0, '同じ内容をもう一度送らない');
});

test('保存中にさらに変更した場合や、入力が確定していない場合は確認を出す', () => {
  assert.equal(leaveContext({ dirty: true, saving: true, savingSeq: 3, changeSeq: 4 }).dailyNeedsLeaveConfirm(), true);
  const unconfirmed = leaveContext({ dirty: true });
  unconfirmed.hoursConfirmed = false;
  assert.equal(unconfirmed.dailyNeedsLeaveConfirm(), true);
  assert.equal(unconfirmed.calls.saveDaily, 0);
});

test('予定と実績の両方に変更があれば、両方とも保存を送る', () => {
  const context = leaveContext({ dirty: true }, { dirty: true });
  assert.equal(context.unsavedNeedsLeaveConfirm(), false);
  assert.deepEqual([context.calls.saveDaily, context.calls.savePlanner], [1, 1]);
});

test('アプリが裏に回ったら、待っている自動保存をすぐ送る', () => {
  const context = leaveContext({ dirty: true, autoSaveTimer: 1 }, { dirty: true, autoSaveTimer: 2 });
  context.flushPendingAutoSaves();
  assert.deepEqual([context.calls.saveDaily, context.calls.savePlanner], [1, 1]);
  const idle = leaveContext({}, {});
  idle.flushPendingAutoSaves();
  assert.deepEqual([idle.calls.saveDaily, idle.calls.savePlanner], [0, 0]);
});

function varianceContext() {
  const context = {
    state: { daily: { date: '2026-10-16' } },
    roundHours: value => Math.round((Number(value) || 0) * 4) / 4,
    numericHours: value => Number(value) || 0,
    composedDailyNameFromRow: el => el.name,
    setDailyRowComplete() {},
    syncDailyRowIssueField() {},
    syncDailyRowSyncedHours() {}
  };
  vm.createContext(context);
  vm.runInContext(slice('    function calendarOriginForInterruptRow(el) {', '    // 名前を変えたカレンダーの行を') + slice('    function syncCalendarVarianceRow(el) {', '\n    }\n') + '\n    }', context);
  return context;
}
function interruptRow(dataset, name, hours) {
  return { dataset: Object.assign({ type: 'interrupt', calendarKey: 'evt-1', calendarEstimate: '1', calendarType: 'calendar', calendarName: '定例' }, dataset), name, querySelector: () => ({ value: String(hours) }) };
}

test('カレンダーから今日だけにした行は、時間がカレンダーと同じでも名前が同じなら元に戻す', () => {
  const context = varianceContext();
  const el = interruptRow({}, '定例', 1);
  assert.equal(context.syncCalendarVarianceRow(el), true);
  assert.equal(el.dataset.type, 'calendar');
});

test('手で今日だけにした行や、名前を変えた行は、カレンダーの行に戻さない', () => {
  const context = varianceContext();
  const manual = interruptRow({ manualInterrupt: '1' }, '定例', 1);
  assert.equal(context.syncCalendarVarianceRow(manual), false);
  assert.equal(manual.dataset.type, 'interrupt');
  const renamed = interruptRow({}, '定例（デモ準備含む）', 1);
  assert.equal(context.syncCalendarVarianceRow(renamed), false);
  assert.equal(renamed.dataset.type, 'interrupt');
});

test('カレンダーの行は名前を編集でき、元の名前から変えて確定すると今日だけの行にする', () => {
  assert.doesNotMatch(daily, /to-interrupt/, '切り替え用のボタンは置かない');
  assert.match(daily, /class="field interrupt-name calendar-row-name"[^>]*data-calendar-name="/);
  const convert = slice('    function convertCalendarRowToInterrupt(el) {', '    function syncCalendarVarianceRow(el) {');
  assert.match(convert, /row\.type = 'interrupt';/);
  assert.match(convert, /row\.manualInterrupt = true;/);
  assert.doesNotMatch(convert, /calendarKey\s*=/, 'カレンダーとのつながりは消さない');
  const context = { };
  vm.createContext(context);
  vm.runInContext(slice('    function calendarRowNameChanged(input) {', '    function syncCalendarVarianceRow(el) {'), context);
  const input = (value, original, calendar) => ({ value, dataset: { calendarName: original }, classList: { contains: name => calendar && name === 'calendar-row-name' } });
  assert.equal(context.calendarRowNameChanged(input('定例（デモ準備含む）', '定例', true)), true);
  assert.equal(context.calendarRowNameChanged(input('定例', '定例', true)), false, '名前を変えていなければカレンダーのまま');
  assert.equal(context.calendarRowNameChanged(input('', '定例', true)), false, '空にしただけでは切り替えない');
  assert.equal(context.calendarRowNameChanged(input('別の名前', '定例', false)), false, 'カレンダー以外の行は対象外');
  const events = fs.readFileSync(path.join(__dirname, '../ui/events_daily.js'), 'utf8');
  assert.match(events, /if \(calendarRowNameChanged\(event\.target\)\) \{\s*convertCalendarRowToInterrupt\(row\);/);
});

test('保存後の同期を待つ間に入力した内容は、保存完了で上書きせず未保存のまま残す', async () => {
  const context = createContext();
  const removed = { id: 'c1', name: '会議', calendarKey: 'cal-1' };
  Object.assign(context, {
    removedDailyCalendarRows: () => [removed],
    async gas(name, payload) { context.calls.gas.push({ name, payload }); return 'https://example.com/sheet'; },
    invalidateProjectSnapshots() {},
    async syncRemovedDailyCalendarRowsToPlanner() {
      // 同期を待っている間に、画面で入力が続いた。
      context.state.daily.rows = [{ id: 'r1', name: '入力中の作業', today: 3, previous: 0, estimate: 0, status: '', type: 'new' }];
      context.state.daily.changeSeq += 1;
    },
    rememberDailySnapshot() {},
    dailyWeekKey: () => '2026-W42',
    async refreshWeekWorkspaceAfterDailySave() {},
    scheduleWeekWorkspaceRefresh() {},
    peekWeekForecast: () => null,
    rememberDailyCalendarRows() {},
    renderDaily() {},
    scheduleAutoGoogleTasksSync() {},
    googleTasksSyncMonthKey: () => '2026-10'
  });
  await context.saveDaily({ auto: true });
  assert.equal(context.calls.gas.length, 1);
  assert.equal(context.state.daily.rows[0].name, '入力中の作業');
  assert.equal(context.state.daily.dirty, true);
});
