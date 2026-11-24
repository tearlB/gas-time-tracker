const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const core = fs.readFileSync(path.join(__dirname, '../ui/core.js'), 'utf8');
const start = core.indexOf('function screenLoadPlan(');
const end = core.indexOf('function ensureTaskNameSuggestions(');
assert.ok(start >= 0 && end > start);
const storage = new Map();
let adjacentResetCount = 0;
let adjacentStaleCount = 0;
const state = {
  dailyCache: {},
  dailyFetchedAt: {},
  weekSnapshot: {},
  projectCache: {},
  projectFetchedAt: {},
  weekForecastCache: {},
  parentNamesByWeek: {},
  weeklySubtasksByWeek: {},
  weekContinuationBusy: {},
  calendarCache: {},
  calendarFetchedAt: {}
};
const context = {
  state,
  NAV_SNAPSHOT_FRESH_MS: 3 * 60 * 1000,
  NAV_LOCAL_KEY: 'matomete-kousu-nav-v1',
  NAV_LOCAL_KEEP_DAYS: 45,
  NAV_LOCAL_KEEP_WEEKS: 16,
  NAV_LOCAL_KEEP_MONTHS: 6,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  clearCalendarCapacityCache() {
    state.calendarCache = {};
    state.calendarFetchedAt = {};
  },
  resetAdjacentCalendarPeriods() { adjacentResetCount++; },
  markAdjacentCalendarPeriodsStale() { adjacentStaleCount++; },
  ymd(date) {
    const pad = value => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  },
  isoWeek() { return '2026-W40'; }
};
vm.createContext(context);
vm.runInContext(core.slice(start, end), context);

test('a stored screen is shown before the spreadsheet refresh finishes', async () => {
  let resolveRefresh;
  const refresh = new Promise(resolve => { resolveRefresh = resolve; });
  const order = [];
  const mode = await context.runScreenLoad({
    hasSnapshot() { return true; },
    options: { recent: false },
    paintCached() { order.push('paint'); },
    beginRefresh() { return 7; },
    refresh(token) {
      order.push('refresh:' + token);
      return refresh;
    },
    showBusy() { throw new Error('screen switch waited on the busy state'); },
    loadBlocking() { throw new Error('screen switch waited on a reload'); }
  });
  assert.equal(mode, 'paint');
  assert.deepEqual(order, ['paint', 'refresh:7']);
  resolveRefresh();
  await refresh;
});

test('a fresh local snapshot does not call the spreadsheet', async () => {
  let refreshed = false;
  const mode = await context.runScreenLoad({
    hasSnapshot() { return true; },
    options: { recent: true },
    paintCached() {},
    beginRefresh() { return 1; },
    refresh() { refreshed = true; return Promise.resolve(); },
    loadBlocking() { throw new Error('fresh snapshot should not block'); }
  });
  assert.equal(mode, 'paint');
  assert.equal(refreshed, false);
  assert.equal(context.snapshotIsRecent(Date.now() - 60 * 1000), true);
  assert.equal(context.snapshotIsRecent(Date.now() - 4 * 60 * 1000), false);
});

test('the first visit still waits for the spreadsheet', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const order = [];
  const pending = context.runScreenLoad({
    hasSnapshot() { return false; },
    options: {},
    silent: true,
    paintCached() { order.push('paint'); },
    markBusy() {},
    loadBlocking() {
      order.push('load');
      return gate;
    }
  });
  await Promise.resolve();
  assert.deepEqual(order, ['load']);
  release();
  assert.equal(await pending, 'block');
});

test('a background refresh does not replace a newer screen or unsaved edits', () => {
  assert.equal(context.navigationRefreshIsCurrent(2, 2, true, false), true);
  assert.equal(context.navigationRefreshIsCurrent(1, 2, true, false), false);
  assert.equal(context.navigationRefreshIsCurrent(2, 2, false, false), false);
  assert.equal(context.navigationRefreshIsCurrent(2, 2, true, true), false);
});

test('local snapshots keep the recent window and omit calendar event bodies', () => {
  const anchor = { date: '2026-10-01', week: '2026-W40', month: '2026-10' };
  const source = {
    dailyCache: {
      '2026-09-20': { tasks: [{ title: '残す' }] },
      '2026-07-01': { tasks: [{ title: '捨てる' }] }
    },
    dailyFetchedAt: { '2026-09-20': 10, '2026-07-01': 10 },
    weekSnapshot: {
      'week:2026-W40': {
        summary: { rows: [{ name: '週' }], capacity: { days: [{ date: '2026-10-01', meetingHours: 1, events: [{ title: '会議' }] }] } },
        overlay: { items: [{ id: 'plan-1' }] },
        fetchedAt: 20
      },
      'week:2026-W10': { summary: { rows: [] }, overlay: null, fetchedAt: 20 }
    },
    projectCache: {
      '2026-10': { projects: [{ name: '開発' }] },
      '2026-01': { projects: [{ name: '古い' }] }
    },
    projectFetchedAt: { '2026-10': 30, '2026-01': 30 }
  };
  const doc = context.buildNavigationLocalDocument(source, anchor);
  assert.deepEqual(Object.keys(doc.daily), ['2026-09-20']);
  assert.deepEqual(Object.keys(doc.weeks), ['2026-W40']);
  assert.deepEqual(Object.keys(doc.projects), ['2026-10']);
  assert.equal(doc.weeks['2026-W40'].summary.capacity.days[0].meetingHours, 1);
  assert.equal(doc.weeks['2026-W40'].summary.capacity.days[0].events, undefined);
  assert.equal(source.weekSnapshot['week:2026-W40'].summary.capacity.days[0].events[0].title, '会議');
  assert.equal(doc.weeks['2026-W40'].overlay.items[0].id, 'plan-1');

  const restored = { dailyCache: {}, dailyFetchedAt: {}, weekSnapshot: {}, projectCache: {}, projectFetchedAt: {} };
  assert.equal(context.applyNavigationLocalDocument(restored, doc), true);
  assert.equal(restored.dailyCache['2026-09-20'].tasks[0].title, '残す');
  assert.equal(restored.weekSnapshot['week:2026-W40'].summary.rows[0].name, '週');
  assert.equal(restored.projectCache['2026-10'].projects[0].name, '開発');
  assert.equal(restored.projectFetchedAt['2026-10'], 30);
});

test('startup reads local snapshots before the visible screen load, and saves still go to the spreadsheet', () => {
  assert.match(core, /const NAV_SNAPSHOT_FRESH_MS = 3 \* 60 \* 1000/);
  const bootstrap = fs.readFileSync(path.join(__dirname, '../ui/bootstrap.js'), 'utf8');
  const initStart = bootstrap.indexOf('async function init(');
  const initEnd = bootstrap.indexOf('function syncVisibleNavigationSnapshot(');
  const init = bootstrap.slice(initStart, initEnd);
  assert.ok(init.indexOf('hydrateNavigationSnapshots()') < init.indexOf('loadDaily()'));
  assert.ok(init.indexOf('loadPlanner()') < init.indexOf('warmNavigationSnapshots()'));
  assert.doesNotMatch(init, /await warmNavigationSnapshots\(/);
  const daily = fs.readFileSync(path.join(__dirname, '../ui/daily.js'), 'utf8');
  assert.match(daily, /gas\('saveToSpreadsheet'/);
  assert.match(daily, /if \(!isViewYmd\(date\) \|\| state\.dailyCache\[date\]\) return;/);
});

test('saving hours marks the cached project screen stale so the next open shows it at once and re-reads the spreadsheet', () => {
  state.projectCache['2026-10'] = { projects: [{ actualHours: 0 }] };
  state.projectFetchedAt['2026-10'] = Date.now();
  const stale = adjacentStaleCount;
  context.invalidateProjectSnapshots();
  assert.equal(adjacentStaleCount, stale + 1);
  // 控えは残して古い扱いにする（次に開いたときはすぐ出して、裏で読み直す）。
  assert.equal(JSON.stringify(state.projectCache), JSON.stringify({ '2026-10': { projects: [{ actualHours: 0 }] } }));
  assert.equal(state.projectFetchedAt['2026-10'], 0);
  const daily = fs.readFileSync(path.join(__dirname, '../ui/daily.js'), 'utf8');
  const planner = fs.readFileSync(path.join(__dirname, '../ui/planning_dialog.js'), 'utf8');
  const planningView = fs.readFileSync(path.join(__dirname, '../ui/planning_view.js'), 'utf8');
  assert.ok(daily.indexOf("gas('saveToSpreadsheet'") < daily.indexOf('invalidateProjectSnapshots()'));
  assert.ok(planner.indexOf("gas('savePlanningWorkspace'") < planner.indexOf('invalidateProjectSnapshots()'));
  assert.ok(planningView.indexOf("gas('savePlanningWorkspace'") < planningView.indexOf('invalidateProjectSnapshots()'));
});
