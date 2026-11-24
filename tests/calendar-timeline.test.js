const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function setup(mode = 'week') {
  const source = fs.readFileSync('ui/core.js', 'utf8');
  const start = source.indexOf('    const calendarTimelinePositions =');
  const end = source.indexOf('    // 日・週・月はそれぞれ', start);
  assert.ok(start >= 0 && end > start);
  const state = {
    calendarMode: mode, view: mode === 'week' ? 'planning' : 'month',
    planner: { key: '2026-W42', dirty: true }, month: { key: '2026-10' }
  };
  const calls = [];
  let api;
  const containers = {};
  for (const name of ['week', 'month']) {
    const weekly = name === 'week';
    const nameWidth = weekly ? 190 : 170;
    const dayWidth = weekly ? 160 : 38;
    const header = weekly ? '.week-head-day' : '.month-day-head';
    const container = {
      dataset: { timelineKey: weekly ? state.planner.key : state.month.key },
      clientWidth: 366, scrollLeft: 0,
      get scrollWidth() { const range = api.calendarSurroundingRange(name, this.dataset.timelineKey); return nameWidth + dayWidth * Math.round((new Date(range.endExclusiveYmd) - new Date(range.startYmd)) / 86400000); },
      loading: false, hasToday: true,
      getBoundingClientRect() { return { left: 20 }; },
      querySelector(selector) {
        if (this.loading) return null;
        if (selector === (weekly ? '.week-head-label' : '.month-head-label')) return { getBoundingClientRect: () => ({ width: nameWidth }) };
        if (selector === header) return {};
        if (selector.startsWith(header + '[')) {
          const date = selector.match(/"([^"]+)"/)[1];
          const range = api.calendarSurroundingRange(name, this.dataset.timelineKey);
          if (date < range.startYmd || date >= range.endExclusiveYmd || (!this.hasToday && date === '2026-10-18')) return null;
          const index = Math.round((new Date(date) - new Date(range.startYmd)) / 86400000);
          return { getBoundingClientRect: () => ({ left: 20 + nameWidth + dayWidth * index - this.scrollLeft, width: dayWidth }) };
        }
        return null;
      }
    };
    containers[name] = container;
  }
  const context = {
    state,
    setTimeout,
    clearTimeout,
    document: { getElementById: id => id === 'weekCalendar' ? containers.week : id === 'monthGantt' ? containers.month : null, querySelector: () => null },
    pad2: value => String(value).padStart(2, '0'),
    addDaysYmd: (date, count) => new Date(new Date(date + 'T00:00:00Z').getTime() + count * 86400000).toISOString().slice(0, 10),
    parseYmd: value => new Date(value + 'T00:00:00Z'),
    roundHours: value => Math.round((Number(value) || 0) * 100) / 100,
    ymd: () => '2026-10-18',
    periodForToday: name => name === 'week' ? '2026-W42' : '2026-10',
    currentViewState: () => ({ view: state.view === 'planning' ? 'week' : state.view, key: state.view === 'planning' ? state.planner.key : state.month.key }),
    async setCalendarMode(name, key) {
      calls.push({ name, key });
      state.view = name === 'week' ? 'planning' : name;
      state.calendarMode = name;
      (name === 'week' ? state.planner : state.month).key = key;
    }
  };
  vm.createContext(context);
  const planning = fs.readFileSync('ui/planning_data.js', 'utf8');
  vm.runInContext(planning.slice(0, planning.indexOf('    function discardDailyDraftForPlannerNavigation(')), context);
  // 本体の periodForToday は実際の今日を使うので、テストの「今日」（2026-10-18）に差し替え直す。
  context.periodForToday = name => name === 'week' ? '2026-W42' : '2026-10';
  const month = fs.readFileSync('ui/planning_month.js', 'utf8');
  vm.runInContext(month.slice(month.indexOf('    function monthKeyRange('), month.indexOf('    function monthGanttDays(')), context);
  vm.runInContext(fs.readFileSync('ui/planning_timeline.js', 'utf8'), context);
  vm.runInContext(source.slice(start, end), context);
  api = context;
  return { api: context, state, containers, calls };
}

test('初回は前後の期間の中から、選択した週・月の先頭を名前欄の右に表示する', () => {
  for (const mode of ['week', 'month']) {
    const { api, containers } = setup(mode);
    api.positionCalendarTimeline(mode);
    const container = containers[mode];
    const day = container.querySelector((mode === 'week' ? '.week-head-day[data-date=' : '.month-day-head[data-month-date=') + '"' + api.calendarSelectedStart(mode, mode === 'week' ? '2026-W42' : '2026-10') + '"]');
    const rect = day.getBoundingClientRect();
    assert.ok(rect.left >= 20 + (mode === 'week' ? 190 : 170));
    assert.ok(rect.left + rect.width <= 20 + container.clientWidth);
    assert.ok(container.scrollLeft > 0);
  }
});

test('再描画とタブ復帰で横位置を保ち、週と月を混同しない', () => {
  const { api, state, containers } = setup();
  api.positionCalendarTimeline('week');
  containers.week.scrollLeft = 320;
  api.rememberCalendarTimelinePosition('week');
  state.view = 'month';
  api.positionCalendarTimeline('month');
  containers.month.scrollLeft = 450;
  api.rememberCalendarTimelinePosition('month');
  // 読み込み表示でDOMが空になっても、保存した横位置を0で上書きしない。
  containers.month.loading = true;
  containers.month.scrollLeft = 0;
  api.rememberCalendarTimelinePosition('month');
  containers.month.loading = false;
  api.positionCalendarTimeline('month');
  assert.equal(containers.month.scrollLeft, 450);
  state.view = 'planning';
  containers.week.scrollLeft = 0;
  api.positionCalendarTimeline('week');
  assert.equal(containers.week.scrollLeft, 320);
});

test('過去・未来でも選択期間を維持し、前の期間を飛ばして指定月の先頭を表示する', () => {
  const { api, state, containers } = setup('month');
  api.positionCalendarTimeline('month');
  state.month.key = '2026-12';
  containers.month.dataset.timelineKey = '2026-12';
  containers.month.hasToday = false;
  api.positionCalendarTimeline('month');
  assert.equal(containers.month.scrollLeft, 30 * 38);
  assert.equal(state.planner.key, '2026-W42');
});

test('非表示や古いグリッドでは確定せず、対象期間の描画後に選択期間を表示する', () => {
  const { api, containers } = setup('month');
  const container = containers.month;
  container.clientWidth = 0;
  api.positionCalendarTimeline('month');
  container.clientWidth = 366;
  container.dataset.timelineKey = '2026-09';
  api.positionCalendarTimeline('month');
  assert.equal(container.scrollLeft, 0);
  container.dataset.timelineKey = '2026-10';
  api.positionCalendarTimeline('month');
  assert.ok(container.scrollLeft > 0);
});

test('今週ボタンの押し直しは再読込せず、未保存の入力を保持して今日の週の月曜にそろえる', async () => {
  const { api, state, containers, calls } = setup();
  api.positionCalendarTimeline('week');
  containers.week.scrollLeft = 0;
  api.rememberCalendarTimelinePosition('week');
  await api.returnToCalendarToday();
  assert.equal(calls.length, 0);
  assert.equal(state.planner.dirty, true);
  // 今日を中央に寄せず、今日の週の月曜が名前の列の右（左端）にそろう。
  const monday = containers.week.querySelector('.week-head-day[data-date="2026-10-12"]');
  assert.equal(Math.round(monday.getBoundingClientRect().left), 210);
});

test('別の月から今月へ戻る要求は、今月のグリッドが読み込まれるまで保持する', async () => {
  const { api, state, containers, calls } = setup('month');
  state.month.key = '2026-12';
  containers.month.dataset.timelineKey = '2026-12';
  containers.month.hasToday = false;
  await api.returnToCalendarToday();
  assert.deepEqual(calls, [{ name: 'month', key: '2026-10' }]);
  assert.equal(containers.month.scrollLeft, 0);
  containers.month.dataset.timelineKey = '2026-10';
  containers.month.hasToday = true;
  api.positionCalendarTimeline('month');
  assert.ok(containers.month.scrollLeft > 0);
});

test('期間移動をキャンセルしたときは、閲覧中の期間と横位置を変えない', async () => {
  const { api, state, containers } = setup('month');
  state.month.key = '2026-12';
  containers.month.dataset.timelineKey = '2026-12';
  containers.month.hasToday = false;
  api.positionCalendarTimeline('month');
  containers.month.scrollLeft = 200;
  api.rememberCalendarTimelinePosition('month');
  api.setCalendarMode = async () => {}; // 未保存確認をキャンセルした場合。
  await api.returnToCalendarToday();
  api.positionCalendarTimeline('month');
  assert.equal(state.month.key, '2026-12');
  assert.equal(containers.month.scrollLeft, 200);
});

test('前後の表示範囲は年越し・ISO週の年・うるう年も連続する', () => {
  const { api } = setup();
  const plain = value => JSON.parse(JSON.stringify(value));
  // 週は前後2週ずつ（5週）。年をまたぐ週でも連続する。
  assert.deepEqual(plain(api.calendarSurroundingRange('week', '2026-W01')), { startYmd: '2025-12-15', endExclusiveYmd: '2026-01-19' });
  assert.equal(api.calendarSurroundingPeriods('week', '2026-W01').length, 5);
  assert.equal(api.calendarSurroundingPeriods('week', '2026-W01')[2].key, '2026-W01', '中央が表示中の週');
  assert.equal(api.calendarSelectedStart('week', '2026-W01'), '2025-12-29');
  assert.equal(api.calendarPeriodDelta('week', '2026-W01', '2026-W03'), 2);
  assert.equal(api.calendarPeriodDelta('week', '2026-W01', '2025-W52'), -1);
  assert.equal(api.calendarPeriodDelta('month', '2026-12', '2027-02'), 2);
  assert.deepEqual(plain(api.calendarSurroundingRange('month', '2026-12')), { startYmd: '2026-11-01', endExclusiveYmd: '2027-02-01' });
  assert.deepEqual(plain(api.calendarSurroundingRange('month', '2028-02')), { startYmd: '2028-01-01', endExclusiveYmd: '2028-04-01' });
});

test('同一IDの予定をまとめても工数を加算せず、編集中の週の削除・更新を優先する', () => {
  const { api } = setup();
  const primary = [{ id: 'p1', name: '調査', planned: 8, actual: 2, actualByDate: { '2026-10-12': 2 } }];
  const adjacent = [
    { id: 'p1', name: '調査', planned: 8, actual: 4, actualByDate: { '2026-10-07': 1, '2026-10-12': 8, '2026-10-13': 1 } },
    { id: 'p2', name: '調査', planned: 3, actual: 1, actualByDate: { '2026-10-20': 1 } }
  ];
  const before = JSON.stringify({ primary, adjacent });
  const merged = api.mergeCalendarTimelineItems(primary, adjacent, { startYmd: '2026-10-12', endExclusiveYmd: '2026-10-19' });
  assert.equal(merged.length, 2); // 同名で異なるIDは別の予定。
  assert.equal(merged[0].planned, 8);
  assert.equal(merged[0].actual, 4);
  assert.equal(merged[0].actualByDate['2026-10-12'], 2);
  assert.equal(merged[0].actualByDate['2026-10-13'], undefined); // 削除した実績を復活させない。
  assert.equal(merged[0].actualByDate['2026-10-07'], 1);
  assert.equal(merged[0].contextOnly, false);
  assert.equal(merged[1].contextOnly, true);
  assert.equal(JSON.stringify({ primary, adjacent }), before);
});

test('選択期間へ戻る操作は日付も画面も変えず、指定期間の先頭だけへ戻る', () => {
  const { api, state, containers, calls } = setup('month');
  state.month.key = '2026-12';
  containers.month.dataset.timelineKey = '2026-12';
  api.positionCalendarTimeline('month');
  containers.month.scrollLeft = 0;
  api.rememberCalendarTimelinePosition('month');
  api.returnToSelectedCalendarPeriod('month');
  assert.equal(containers.month.scrollLeft, 30 * 38);
  assert.equal(state.month.key, '2026-12');
  assert.equal(calls.length, 0);
});

test('前後のデータは期間ごとに保持し、中央が移っても前後にあたる期間だけ描き直す', async () => {
  const { api, state } = setup('month');
  const pending = [];
  api.gas = (_method, key) => new Promise(resolve => pending.push({ key, resolve }));
  let paints = 0;
  api.renderMonthGantt = () => paints++;
  api.loadAdjacentCalendarPeriods('month', '2026-10');
  state.month.key = '2026-12';
  api.loadAdjacentCalendarPeriods('month', '2026-12');
  // 読み込み中の11月は重ねて読まない。
  assert.deepEqual(pending.map(item => item.key), ['2026-09', '2026-11', '2027-01']);
  for (const item of pending) item.resolve({ periodKey: item.key, rows: [] });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(Array.from(api.calendarAdjacentSnapshots('month', '2026-12'), item => item.periodKey).sort(), ['2026-11', '2027-01']);
  // 9月は12月の前後ではないので描き直さず、続けて終わった11月・1月の描き直しは1回にまとめる。
  assert.equal(paints, 1);
  assert.equal(state.planner.dirty, true);
});

test('実績画面で入力中の時間は、保存を待たずに週の帯のその日の実績へ反映する', () => {
  const source = fs.readFileSync('ui/planning_timeline.js', 'utf8');
  const start = source.indexOf('    function overlayLiveDailyActuals(');
  const end = source.indexOf('    function liveDailyForWeek(', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    roundHours: value => Math.round((Number(value) || 0) * 100) / 100,
    numericHours: value => Number(value) || 0,
    dailyRowIsInterrupt: row => row.type === 'interrupt',
    dailyBelongsToPlan: (daily, plan) => daily === plan
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const items = [
    { id: 'p1', name: '調査', actual: 3, actualByDate: { '2026-10-20': 1, '2026-10-21': 2 } },
    { id: 'p2', name: '実装', actual: 1, actualByDate: { '2026-10-21': 1 } },
    { id: 'p3', name: 'レビュー', actual: 0, actualByDate: {} }
  ];
  const live = {
    date: '2026-10-21', loadedDate: '2026-10-21',
    rows: [
      { name: '調査', planId: 'p1', today: 3.5 },
      { name: 'レビュー', today: 0.5 },
      { name: '割り込み', type: 'interrupt', today: 1 }
    ]
  };
  const result = context.overlayLiveDailyActuals(items, live);
  assert.equal(result[0].actualByDate['2026-10-21'], 3.5);
  assert.equal(result[0].actualByDate['2026-10-20'], 1);
  assert.equal(result[0].actual, 4.5);
  assert.equal(result[1].actualByDate['2026-10-21'], undefined); // 実績画面から消した行は帯からも消す。
  assert.equal(result[1].actual, 0);
  assert.equal(result[2].actualByDate['2026-10-21'], 0.5);
  assert.equal(items[0].actualByDate['2026-10-21'], 2); // 元の予定データは書き換えない。
  // 読み込みが終わっていない実績画面の内容は使わない。
  assert.equal(context.overlayLiveDailyActuals(items, Object.assign({}, live, { loadedDate: '' })), items);
});

test('月の予定を押したときの開き先は、表示されない週ならエラーにせず開き方を変える', () => {
  const source = fs.readFileSync('ui/planning_month.js', 'utf8');
  const from = source.indexOf('    // クリックした日の週の画面に、その予定が出るか');
  const to = source.indexOf('    async function openWeekForMonthPlan');
  const context = {
    state: { planner: {}, month: { key: '2026-10' } },
    isoWeek: date => date.getDate() >= 26 ? '2026-W44' : '2026-W43', parseYmd: value => new Date(value + 'T00:00:00'),
    weekKeyStartYmd: key => key === '2026-W44' ? '2026-10-26' : '2026-10-19', addDaysYmd: (value, days) => { const d = new Date(value + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); },
    planHasActualInRange: () => false, ymd: () => '2026-10-29', shortYmdLabel: value => value.slice(5),
    planVisibleInWeek: (item, range) => item.range.start < range.endExclusiveYmd && item.range.end >= range.startYmd,
    isYmdText: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)), calendarSurroundingRange: () => ({ startYmd: '2026-10-01', endExclusiveYmd: '2026-11-01' }),
    monthPlanAnchorDate: row => row.range.start
  };
  require('node:vm').createContext(context);
  require('node:vm').runInContext(source.slice(from, to), context);
  const open = { item: { range: { start: '2026-10-20', end: '2026-10-22' } }, range: { start: '2026-10-20', end: '2026-10-22' }, done: false, name: '予定' };
  assert.equal(context.monthPlanOpenTarget(open, '2026-10-21').mode, 'direct');
  const outside = context.monthPlanOpenTarget(open, '2026-10-28');
  assert.equal(outside.mode, 'direct', '期間外の週を押しても、押した日の週をそのまま開く');
  assert.equal(outside.date, '2026-10-28');
  const done = { item: { range: { start: '2026-10-20', end: '2026-10-30' } }, range: { start: '2026-10-20', end: '2026-10-30' }, done: true, name: '完了済み' };
  assert.equal(context.monthPlanOpenTarget(done, '2026-10-28').mode, 'direct', '完了済みでも、期間にかかる週はそのまま開く');
});

test('取り込み済み・実施しない予定の判定は、今開いている週だけでなく、読み込み済みのすべての週から集める', () => {
  const source = fs.readFileSync('ui/planning_data.js', 'utf8');
  const to = source.indexOf('    function persistCalendarExclusions(');
  const helpers = source.slice(source.indexOf('    function uniqueKeys('), source.indexOf('    function activeCalendarWeekKey()'));
  const known = source.slice(source.indexOf('    function importedCalendarKeys()'), to);
  const context = {
    state: { planner: { summary: { rows: [{ calendarKey: 'cur' }], calendarExclusions: ['x-cur'] } }, weekSnapshot: { 'week:2026-W43': { summary: { rows: [{ calendarKey: 'prev' }], calendarExclusions: ['x-prev'] } } } },
    adjacentCalendarPeriods: { week: { snapshots: { '2026-W45': { rows: [{ calendarKey: 'next' }], calendarExclusions: ['x-next'] } } } },
    plannerItems: () => [{ calendarKey: 'cur-item' }], excludedCalendarKeys: () => ['x-local']
  };
  require('node:vm').createContext(context);
  require('node:vm').runInContext(helpers + known, context);
  assert.deepEqual(Array.from(context.knownImportedCalendarKeys()).sort(), ['cur', 'cur-item', 'next', 'prev']);
  assert.deepEqual(Array.from(context.knownExcludedCalendarKeys()).sort(), ['x-cur', 'x-local', 'x-next', 'x-prev']);
});
