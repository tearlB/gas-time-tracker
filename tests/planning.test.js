const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function createContext() {
  const context = {
    console,
    // 既存の同期ありの挙動を検証する。標準オフのケースはcompletion-settings.test.js。
    planActualCompletionSyncEnabled: () => true,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: {
      formatDate(date, timezone, pattern) {
        if (pattern === 'yyyy-MM-dd') return date.toISOString().slice(0, 10);
        return date.toISOString();
      }
    },
    formatDateCellValue(value) {
      if (typeof value === 'number') {
        return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000)
          .toISOString().slice(0, 10).replace(/-/g, '/');
      }
      if (value instanceof Date) return value.toISOString().slice(0, 10).replace(/-/g, '/');
      return String(value || '').replace(/-/g, '/');
    }
  };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/budget.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/legacy.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/planning.gs', 'utf8'), context);
  return context;
}

test('ISO週と月の期間境界を年越しを含めて計算する', () => {
  const api = createContext();
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.getBudgetPeriodRange('week', '2026-W01'))),
    { startYmd: '2025-12-29', endExclusiveYmd: '2026-01-05' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.getBudgetPeriodRange('month', '2028-02'))),
    { startYmd: '2028-02-01', endExclusiveYmd: '2028-03-01' }
  );
  assert.equal(api.getBudgetPeriodKey(new Date('2026-01-04T12:00:00Z'), 'week', 'UTC'), '2026-W01');
  assert.equal(api.getBudgetPeriodKey(new Date('2026-01-05T12:00:00Z'), 'week', 'UTC'), '2026-W02');
});

test('予定と日次実績を親タスクごとに集計する', () => {
  const api = createContext();
  const result = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '設計', plannedHours: 8, note: '優先' },
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '実装', plannedHours: 12, note: '' }
  ], [
    ['2026/08/17', '設計', 3],
    ['2026/08/18', '設計', 2.5],
    ['2026/08/20', '突発対応', 1.25],
    ['2026/08/24', '別件', 99]
  ], 'Asia/Tokyo');

  assert.deepEqual(Array.from(result.rows, row => row.aggregationKey), ['設計', '実装', '突発対応']);
  assert.equal(result.rows.find(row => row.aggregationKey === '設計').actualHours, 5.5);
  assert.equal(result.rows.find(row => row.aggregationKey === '突発対応').status, '計画なし');
  assert.equal(result.totals.plannedHours, 20);
  assert.equal(result.totals.actualHours, 6.75);
});

test('予定の開始日・終了日を保存し、終了日が開始日より前なら開始日にそろえる', () => {
  const api = createContext();
  const base = { periodType: 'week', periodKey: '2026-W35', aggregationKey: '設計', plannedHours: 6 };
  const plan = api.normalizeBudgetPlan(Object.assign({}, base, { startDate: '2026-08-26', endDate: '2026-09-02' }), 0);
  assert.equal(plan.startDate, '2026-08-26');
  assert.equal(plan.endDate, '2026-09-02');
  assert.equal(api.normalizeBudgetPlan(Object.assign({}, base, { startDate: '2026-08-26', endDate: '2026-08-24' }), 0).endDate, '2026-08-26');
  assert.equal(api.normalizeBudgetPlan(Object.assign({}, base, { endDate: 'あとで' }), 0).endDate, '');
  assert.equal(api.BUDGET_PLAN_HEADER[21], '終了日');
  const row = ['week', '2026-W35', '設計', 6, '', '', 0, 6, 6, 'initial', '2026/08/24 10:00:00', 'plan-1', '2026/08/26', '', '', '', '', '', '', '', '', '2026/09/02'];
  const persisted = api.budgetPersistedPlanFromRow(row, 0);
  // シートが日付として解釈した値も YYYY-MM-DD に戻す
  assert.equal(persisted.startDate, '2026-08-26');
  assert.equal(persisted.endDate, '2026-09-02');
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.budgetPlanDateRange(api.normalizeBudgetPlan(base, 0)))),
    { startYmd: '2026-08-24', endYmd: '2026-08-28', explicitEnd: false }
  );
});

test('週の予定は期間がかかる前の週の予定と、この週に実績がある先の週の予定も含める', () => {
  const api = createContext();
  const plans = [
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '週またぎ', plannedHours: 8, planId: 'span', startDate: '2026-08-27', endDate: '2026-09-02', done: true },
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '先週で完了', plannedHours: 2, planId: 'done-before', startDate: '2026-08-24', endDate: '2026-08-25', done: true },
    { periodType: 'week', periodKey: '2026-W36', aggregationKey: '今週', plannedHours: 4, planId: 'native' },
    { periodType: 'week', periodKey: '2026-W37', aggregationKey: '来週を前倒し', plannedHours: 3, planId: 'early', startDate: '2026-09-07', endDate: '2026-09-08' },
    { periodType: 'week', periodKey: '2026-W37', aggregationKey: '来週', plannedHours: 3, planId: 'upcoming', startDate: '2026-09-09', endDate: '2026-09-10' },
    { periodType: 'week', periodKey: '2026-W41', aggregationKey: 'ずっと先', plannedHours: 3, planId: 'far', startDate: '2026-10-05', endDate: '2026-10-07' }
  ].map((plan, index) => api.normalizeBudgetPlan(plan, index));
  const dailyRows = [['2026/09/03', '来週を前倒し', 1, 0, 3, '', '', 'early']];
  const ids = list => Array.from(list, plan => plan.planId).sort();
  assert.deepEqual(ids(api.selectWeeklyPlansForDailySuggestions(plans, '2026-W36', dailyRows, 'Asia/Tokyo')), ['early', 'native', 'span']);
  // 実績画面の候補には、これから始まる未完了の予定も出す（前倒しで選べるように）
  assert.deepEqual(
    ids(api.selectWeeklyPlansForDailySuggestions(plans, '2026-W36', [], 'Asia/Tokyo', { includeUpcoming: true })),
    ['early', 'native', 'span', 'upcoming']
  );
  const summary = api.calculateBudgetSummary('week', '2026-W36', plans, dailyRows, 'Asia/Tokyo');
  const early = summary.rows.find(row => row.planId === 'early');
  assert.equal(early.originWeek, '2026-W37');
  assert.equal(early.endDate, '2026-09-08');
  assert.equal(early.actualByDate['2026-09-03'], 1);
});

test('期間未定の予定は終了日の列に「未定」と書き、開始日・終了日が空の旧データと区別する', () => {
  const api = createContext();
  const base = { periodType: 'week', periodKey: '2026-W35', aggregationKey: '調査', plannedHours: 4 };
  const undated = api.normalizeBudgetPlan(Object.assign({}, base, { undated: true, startDate: '2026-08-26', endDate: '2026-08-28' }), 0);
  assert.equal(undated.undated, true);
  assert.equal(undated.startDate, '');
  assert.equal(undated.endDate, '');
  assert.equal(api.budgetPlanDateRange(undated), null);
  const row = ['week', '2026-W35', '調査', 4, '', '', 0, 4, 4, 'initial', '2026/08/24 10:00:00', 'plan-u', '', '', '', '', '', '', '', '', '', '未定'];
  assert.equal(api.budgetPersistedPlanFromRow(row, 0).undated, true);
  const legacy = api.budgetPersistedPlanFromRow(row.slice(0, 21), 0);
  assert.equal(legacy.undated, false);
  assert.equal(api.budgetPlanDateRange(legacy).endYmd, '2026-08-28');

  const plans = [
    Object.assign({}, undated, { planId: 'open' }),
    api.normalizeBudgetPlan(Object.assign({}, base, { aggregationKey: '終わった調査', planId: 'closed', undated: true, done: true }), 1)
  ];
  const ids = list => Array.from(list, plan => plan.planId).sort();
  // 未完了なら次の週にも出し、完了したらその週に実績があるときだけ出す
  assert.deepEqual(ids(api.selectWeeklyPlansForDailySuggestions(plans, '2026-W37', [], 'Asia/Tokyo')), ['open']);
  assert.deepEqual(ids(api.selectWeeklyPlansForDailySuggestions(plans, '2026-W37', [['2026/09/08', '終わった調査', 1, 0, 4, '', '', 'closed']], 'Asia/Tokyo')), ['closed', 'open']);
  const summary = api.calculateBudgetSummary('week', '2026-W37', plans, [], 'Asia/Tokyo');
  assert.equal(summary.rows.find(item => item.planId === 'open').undated, true);
});

test('月のガントは月にかかる週の集計を予定IDでまとめ、日ごとの実績合計を返す', () => {
  const api = createContext();
  const range = api.getBudgetPeriodRange('month', '2026-10');
  assert.deepEqual(Array.from(api.budgetWeekKeysForRange(range.startYmd, range.endExclusiveYmd, 'Asia/Tokyo')), ['2026-W40', '2026-W41', '2026-W42', '2026-W43', '2026-W44']);
  const merged = api.mergeBudgetGanttWeekRows([
    [
      { planId: 'p1', periodKey: '2026-W41', aggregationKey: '設計', hasPlan: true, actualHours: 3, actualByDate: { '2026-10-06': 3 } },
      { planId: '', periodKey: '2026-W41', aggregationKey: '突発', hasPlan: false, actualHours: 1, actualByDate: { '2026-10-07': 1 } }
    ],
    [
      { planId: 'p1', periodKey: '2026-W41', aggregationKey: '設計', hasPlan: true, actualHours: 5, actualByDate: { '2026-10-06': 3, '2026-10-13': 2 } },
      { planId: 'p2', periodKey: '2026-W42', aggregationKey: '実装', hasPlan: true, calendarKey: 'cal', actualByDate: {} }
    ]
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].actualHours, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(merged[0].actualByDate)), { '2026-10-06': 3, '2026-10-13': 2 });
  const totals = api.budgetDailyTotalsForRange([
    ['2026/10/06', '設計', 3],
    ['2026/10/06', '突発', 1.5],
    ['2026/09/30', '設計', 2],
    ['2026/10/07', '', 4]
  ], range, 'Asia/Tokyo');
  assert.deepEqual(JSON.parse(JSON.stringify(totals)), { '2026-10-06': 4.5 });
});

test('同名で作り直した週予定は、別の予定IDを持つ過去の完了実績を引き継がない', () => {
  const api = createContext();
  const result = api.calculateBudgetSummary('week', '2026-W42', [
    { periodType: 'week', periodKey: '2026-W38', aggregationKey: '課題A', plannedHours: 2, planId: 'plan-old', done: true },
    { periodType: 'week', periodKey: '2026-W42', aggregationKey: '課題A', plannedHours: 2, planId: 'plan-new' },
    { periodType: 'week', periodKey: '2026-W42', aggregationKey: '課題B', plannedHours: 4, planId: 'plan-b' }
  ], [
    ['2026/09/25', '課題A 工数見積', 1.5, 0, 2, '完了', '', 'plan-old'],
    ['2026/09/25', '課題B 調査', 1, 0, 4, '', '', ''],
    ['2026/10/13', '課題B 設計', 1, 0, 4, '', '', 'plan-other']
  ], 'Asia/Tokyo');
  const rowA = result.rows.find(row => row.planId === 'plan-new');
  assert.equal(rowA.complete, false);
  assert.equal(rowA.actualHours, 0);
  const rowB = result.rows.find(row => row.planId === 'plan-b');
  assert.equal(rowB.actualHours, 2);
});

test('日次のカレンダー自動行は週の計画なしタスクにしない', () => {
  const api = createContext();
  const result = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '設計', plannedHours: 8 }
  ], [
    ['2026/08/17', '設計', 3],
    ['2026/08/18', '朝会', 0.5, 0, 0.5, '', 'カレンダー'],
    ['2026/08/18', '突発対応', 1.25]
  ], 'Asia/Tokyo');
  assert.deepEqual(Array.from(result.rows, row => row.aggregationKey), ['設計', '突発対応']);
  assert.equal(result.totals.actualHours, 4.25);
  assert.equal(api.budgetDailyRowIsCalendarAuto(['2026/08/18', '朝会', 0.5, 0, 0.5, '', 'カレンダー']), true);
  assert.equal(api.budgetDailyRowIsCalendarAuto(['2026/08/18', '週次定例（8/18 10:00）', 1, 0, 1, '', 'カレンダー', 'plan-calendar']), true);
  const imported = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '週次定例（8/18 10:00）', plannedHours: 2, planId: 'plan-calendar', calendarKey: 'event-1' }
  ], [
    ['2026/08/18', '週次定例（8/18 10:00）', 1, 0, 2, '', 'カレンダー', 'plan-calendar']
  ], 'Asia/Tokyo');
  assert.equal(imported.rows.length, 0);
});

test('日次の割り込みは週の計画なし実績として残す', () => {
  const api = createContext();
  const result = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '設計', plannedHours: 8 }
  ], [
    ['2026/08/17', '設計', 3],
    ['2026/08/18', '問い合わせ対応', 1.25, 0, 0, '完了', '割り込み']
  ], 'Asia/Tokyo');
  assert.deepEqual(Array.from(result.rows, row => row.aggregationKey), ['設計', '問い合わせ対応']);
  assert.equal(result.rows.find(row => row.aggregationKey === '問い合わせ対応').hasPlan, false);
  assert.equal(result.rows.find(row => row.aggregationKey === '問い合わせ対応').actualHours, 1.25);
  assert.equal(result.totals.actualHours, 4.25);
  assert.equal(api.budgetDailyRowIsInterrupt(['2026/08/18', '問い合わせ対応', 1.25, 0, 0, '完了', '割り込み']), true);
  assert.equal(api.budgetDailyRowIsCalendarAuto(['2026/08/18', '問い合わせ対応', 1.25, 0, 0, '完了', '割り込み']), false);

  const calendarKey = 'meet-1:2026-08-18:10:00:0';
  const calendarMark = 'カレンダー今日だけ:' + calendarKey;
  const linked = api.calculateBudgetSummary('week', '2026-W34', [], [
    ['2026/08/18', '会議', 1.25, 0, 0, '完了', calendarMark]
  ], 'Asia/Tokyo');
  assert.equal(api.budgetDailyRowIsInterrupt(['2026/08/18', '会議', 1.25, 0, 0, '完了', calendarMark]), true);
  assert.equal(api.budgetDailyRowIsCalendarInterrupt(['2026/08/18', '会議', 1.25, 0, 0, '完了', calendarMark]), true);
  assert.deepEqual(JSON.parse(JSON.stringify(linked.calendarInterruptsByDate['2026-08-18'])), [
    { name: '会議', hours: 1.25, calendarKey: calendarKey }
  ]);
});

test('日次またはメモの完了が週予定の完了になる', () => {
  const api = createContext();
  const finished = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '課題1', plannedHours: 8 }
  ], [
    ['2026/08/17', '課題1 調査', 2, 0, 2, '完了'],
    ['2026/08/18', '課題1 テスト', 1, 0, 1, '完了']
  ], 'Asia/Tokyo');
  assert.equal(finished.rows.find(row => row.aggregationKey === '課題1').complete, true);

  const unfinished = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '課題1', plannedHours: 8 }
  ], [
    ['2026/08/17', '課題1 調査', 2, 0, 2, '完了'],
    ['2026/08/18', '課題1 テスト', 1, 0, 2, '']
  ], 'Asia/Tokyo');
  assert.equal(unfinished.rows.find(row => row.aggregationKey === '課題1').complete, false);

  const hoursMatched = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '課題1', plannedHours: 8 }
  ], [
    ['2026/08/17', '課題1 調査', 2, 0, 2, '']
  ], 'Asia/Tokyo');
  assert.equal(hoursMatched.rows.find(row => row.aggregationKey === '課題1').dailyComplete, false);
  assert.equal(hoursMatched.rows.find(row => row.aggregationKey === '課題1').complete, false);

  const noted = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '課題1', plannedHours: 8, note: 'done:1' }
  ], [], 'Asia/Tokyo');
  assert.equal(noted.rows.find(row => row.aggregationKey === '課題1').complete, true);
});

test('予定の完了を未完了へ戻すと日次の自動完了を上書きできる', () => {
  const api = createContext();
  const result = api.calculateBudgetSummary('week', '2026-W34', [{
    periodType: 'week',
    periodKey: '2026-W34',
    aggregationKey: '課題1',
    plannedHours: 8,
    completionOverride: false
  }], [
    ['2026/08/17', '課題1 調査', 2, 0, 2, '完了'],
    ['2026/08/18', '課題1 テスト', 1, 0, 1, '完了']
  ], 'Asia/Tokyo');
  const row = result.rows.find(item => item.aggregationKey === '課題1');
  assert.equal(row.dailyComplete, true);
  assert.equal(row.complete, false);
  assert.equal(row.completionOverride, false);
});

test('日次の子タスク工数を週予定の親へ集計する', () => {
  const api = createContext();
  assert.equal(api.budgetParentKeyForDailyName('課題1 調査', ['課題1', '実装']), '課題1');
  assert.equal(api.budgetParentKeyForDailyName('課題1 テスト', ['課題1']), '課題1');
  assert.equal(api.budgetParentKeyForDailyName('課題10', ['課題1']), '課題10');
  assert.equal(api.budgetParentKeyForDailyName('設計レビュー', ['設計']), '設計レビュー');
  assert.equal(api.budgetParentKeyForDailyName('前週繰越 設計レビュー 仕上げ', ['設計レビュー']), '設計レビュー');
  assert.equal(api.budgetParentKeyForDailyName('設計レビュー 仕上げ', ['前週繰越 設計レビュー']), '前週繰越 設計レビュー');
  assert.equal(api.budgetPlanIdentityName('前週繰越 設計レビュー'), '設計レビュー');
  assert.equal(api.budgetPlanIdentityName('前週繰り越し　設計レビュー'), '設計レビュー');
  assert.equal(api.budgetParentKeyForDailyName('課題1 調査 追加', ['課題1', '課題1 調査']), '課題1 調査');
  const result = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '課題1', plannedHours: 8 }
  ], [
    ['2026/08/17', '課題1 調査', 2],
    ['2026/08/18', '課題1 テスト', 1.25],
    ['2026/08/19', '課題1', 0.5],
    ['2026/08/20', '突発対応', 1]
  ], 'Asia/Tokyo');
  assert.equal(result.rows.find(row => row.aggregationKey === '課題1').actualHours, 3.75);
  assert.equal(result.rows.find(row => row.aggregationKey === '突発対応').status, '計画なし');
  assert.equal(result.rows.some(row => row.aggregationKey === '課題1 調査'), false);

  const carried = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '設計レビュー', plannedHours: 2 }
  ], [
    ['2026/08/17', '前週繰越 設計レビュー 仕上げ', 2]
  ], 'Asia/Tokyo');
  assert.equal(carried.rows.find(row => row.aggregationKey === '設計レビュー').actualHours, 2);
  assert.equal(carried.rows.some(row => String(row.aggregationKey).indexOf('前週繰越') === 0), false);
});

test('日次の予定工数と前日までは週予定から同期する', () => {
  const api = createContext();
  assert.equal(api.budgetChildNameForDaily('API連携 認証', 'API連携'), '認証');
  assert.equal(api.budgetChildNameForDaily('API連携', 'API連携'), '');
  const plans = [{
    aggregationKey: 'API連携',
    plannedHours: 6,
    planId: 'plan-1',
    actualByDate: { '2026-08-24': 2, '2026-08-25': 1.5, '2026-08-26': 2 }
  }];
  const subtasks = [{ parentKey: 'API連携', parentPlanId: 'plan-1', title: '認証', plannedHours: 3 }];
  const parent = api.budgetWeeklySyncedHoursForDailyTask(
    { title: 'API連携', prevB: 99, prevC: 12 },
    '2026-08-26',
    plans,
    subtasks,
    {},
    {}
  );
  assert.equal(parent.prevC, 6);
  assert.equal(parent.prevB, 3.5);

  const child = api.budgetWeeklySyncedHoursForDailyTask(
    { title: 'API連携 認証', prevB: 0.5, prevC: 99 },
    '2026-08-26',
    plans,
    subtasks,
    { 'API連携 認証': 2 },
    {}
  );
  assert.equal(child.prevC, 3);
  assert.equal(child.prevB, 2);

  const calendar = api.budgetWeeklySyncedHoursForDailyTask(
    { title: '朝会', type: 'calendar', prevB: 0, prevC: 0.5 },
    '2026-08-26',
    plans,
    [],
    {},
    {}
  );
  assert.equal(calendar.prevC, 0.5);

  const interrupt = api.budgetWeeklySyncedHoursForDailyTask(
    { title: '問い合わせ対応', type: 'interrupt', hours: 1.25, prevB: 5, prevC: 8 },
    '2026-08-26',
    plans,
    [],
    {},
    {}
  );
  assert.equal(interrupt.prevB, 0);
  assert.equal(interrupt.prevC, 1.25);

  const applied = api.applyBudgetWeeklyHoursToDailyTasks('2026-08-26', [
    { title: 'API連携', hours: 1, prevB: 99, prevC: 12 }
  ], { plans: plans, subtasks: subtasks, hoursByExactName: {}, actualBefore: {} });
  assert.equal(applied[0].prevB, 3.5);
  assert.equal(applied[0].prevC, 6);

  const mismatched = api.budgetWeeklySyncedHoursForDailyTask(
    { title: 'API連携 認証', prevB: 0, prevC: 99 },
    '2026-08-26',
    [{ aggregationKey: 'API連携', plannedHours: 6, planId: 'plan-new' }],
    [{ parentKey: 'API連携', parentPlanId: 'plan-origin', title: '認証', plannedHours: 3 }],
    { 'API連携 認証': 2 },
    {}
  );
  assert.equal(mismatched.prevC, 6);
  assert.equal(mismatched.prevB, 2);
  assert.equal(api.budgetPlanningSubtaskMatchesParent({ parentKey: 'API連携', parentPlanId: 'plan-origin', title: '認証' }, 'API連携', 'plan-new'), false);
  assert.equal(api.budgetPlanningSubtaskMatchesParent({ parentKey: '旧名', parentPlanId: 'plan-1', title: '認証' }, '新名', 'plan-1'), true);
  assert.equal(api.budgetComposeDailyChildName('API連携', '認証'), 'API連携 認証');

  const renamed = api.budgetWeeklySyncedHoursForDailyTask(
    { title: '新名 認証', planId: 'plan-1', prevB: 0, prevC: 99 },
    '2026-08-26',
    [{ aggregationKey: '新名', plannedHours: 6, planId: 'plan-1' }],
    [{ parentKey: '旧名', parentPlanId: 'plan-1', title: '認証', plannedHours: 3, prevB: 1.25 }],
    {},
    {}
  );
  assert.equal(renamed.prevC, 3);
  assert.equal(renamed.prevB, 1.25);

  const fromSubPrev = api.budgetWeeklySyncedHoursForDailyTask(
    { title: 'API連携 認証', prevB: 0, prevC: 99 },
    '2026-08-26',
    [{ aggregationKey: 'API連携', plannedHours: 6, planId: 'plan-1' }],
    [{ parentKey: 'API連携', parentPlanId: 'plan-1', title: '認証', plannedHours: 3, prevB: 1.75 }],
    {},
    {}
  );
  assert.equal(fromSubPrev.prevC, 3);
  assert.equal(fromSubPrev.prevB, 1.75);

  const fromPlanChild = api.budgetWeeklySyncedHoursForDailyTask(
    { title: 'API連携 認証', planId: 'plan-1', prevB: 0, prevC: 99 },
    '2026-08-26',
    [{ aggregationKey: 'API連携', plannedHours: 6, planId: 'plan-1' }],
    [{ parentKey: 'API連携', parentPlanId: 'plan-1', title: '認証', plannedHours: 3 }],
    { 'API連携 認証': 9 },
    {},
    { 'plan-1\0認証': 1.5 }
  );
  assert.equal(fromPlanChild.prevB, 1.5);
  assert.equal(fromPlanChild.prevC, 3);

  const ambiguous = api.budgetWeeklySyncedHoursForDailyTask(
    { title: 'API連携 認証', prevB: 0.25, prevC: 99 },
    '2026-08-26',
    [
      { aggregationKey: 'API連携', plannedHours: 6, planId: 'plan-a' },
      { aggregationKey: 'API連携', plannedHours: 4, planId: 'plan-b' }
    ],
    [{ parentKey: 'API連携', parentPlanId: 'plan-a', title: '認証', plannedHours: 3 }],
    { 'API連携 認証': 2 },
    {}
  );
  assert.equal(ambiguous.prevC, 99);
  assert.equal(ambiguous.prevB, 0.25);
});

test('日次候補は週予定のサブタスクを親に付けて前日までを返す', () => {
  const api = createContext();
  api.loadWeeklyDailyHoursContext = function() {
    return {
      plans: [{
        aggregationKey: 'API連携',
        plannedHours: 6,
        planId: 'plan-origin',
        note: '',
        startDate: '',
        calendarKey: '',
        carryWeek: ''
      }],
      subtasks: [{ parentKey: 'API連携', parentPlanId: 'plan-origin', title: '認証', plannedHours: 3, sortOrder: 1 }],
      hoursByExactName: { 'API連携 認証': 2.25 },
      actualBefore: { 'API連携': 4 }
    };
  };
  const items = api.getBudgetPlanSuggestionsForDate('2026-08-26');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'API連携');
  assert.equal(items[0].prevB, 4);
  assert.equal(items[0].prevC, 6);
  assert.equal(items[0].subtasks.length, 1);
  assert.equal(items[0].subtasks[0].title, '認証');
  assert.equal(items[0].subtasks[0].parentKey, 'API連携');
  assert.equal(items[0].subtasks[0].plannedHours, 3);
  assert.equal(items[0].subtasks[0].parentPlanId, 'plan-origin');
  assert.equal(items[0].subtasks[0].prevB, 2.25);

  api.loadWeeklyDailyHoursContext = function() {
    return {
      plans: [{
        aggregationKey: '新名',
        plannedHours: 6,
        planId: 'plan-1',
        note: '',
        startDate: '',
        calendarKey: '',
        carryWeek: ''
      }],
      subtasks: [{ parentKey: '旧名', parentPlanId: 'plan-1', title: '認証', plannedHours: 3, sortOrder: 0 }],
      hoursByExactName: { '新名 認証': 1 },
      actualBefore: { '新名': 1 }
    };
  };
  const renamedItems = api.getBudgetPlanSuggestionsForDate('2026-08-26');
  assert.equal(renamedItems[0].subtasks.length, 1);
  assert.equal(renamedItems[0].subtasks[0].title, '認証');
  assert.equal(renamedItems[0].subtasks[0].parentPlanId, 'plan-1');
  assert.equal(renamedItems[0].subtasks[0].parentKey, '新名');

  api.loadWeeklyDailyHoursContext = function() {
    return {
      plans: [{ aggregationKey: '完了済み', plannedHours: 2, planId: 'plan-done', done: true }],
      subtasks: [],
      hoursByExactName: {},
      actualBefore: {}
    };
  };
  assert.equal(api.getBudgetPlanSuggestionsForDate('2026-08-26').length, 0);

  api.loadWeeklyDailyHoursContext = function() {
    return {
      plans: [{ aggregationKey: '実績で完了', plannedHours: 4, planId: 'plan-actual', periodType: 'week', periodKey: '2026-W34' }],
      subtasks: [],
      hoursByExactName: {},
      actualBefore: { 'plan-actual': 4 },
      completedByPlan: {},
      weekKey: '2026-W35'
    };
  };
  assert.equal(api.getBudgetPlanSuggestionsForDate('2026-08-26').length, 1);

  api.loadWeeklyDailyHoursContext = function() {
    return {
      plans: [{ aggregationKey: '日次で完了', plannedHours: 8, planId: 'plan-daily' }],
      subtasks: [],
      hoursByExactName: {},
      actualBefore: {},
      completedByPlan: { 'plan-daily': true }
    };
  };
  assert.equal(api.getBudgetPlanSuggestionsForDate('2026-08-26').length, 0);

  api.loadWeeklyDailyHoursContext = function() {
    return {
      plans: [{ aggregationKey: '明示的に戻した', plannedHours: 4, planId: 'plan-reopened', completionOverride: false }],
      subtasks: [],
      hoursByExactName: {},
      actualBefore: { 'plan-reopened': 4 },
      completedByPlan: { 'plan-reopened': true }
    };
  };
  assert.equal(api.getBudgetPlanSuggestionsForDate('2026-08-26').length, 1);
});

test('候補画面から元の週予定を完了状態へ保存できる', () => {
  const api = createContext();
  let saved;
  api.withUserWriteLock = callback => callback();
  api.requirePlanningSpreadsheetId = () => 'planning-sheet';
  api.loadBudgetPlanRows = () => [[
    'week', '2026-W34', '設計レビュー', 8, '', '', 0, 8, 8, 'initial', '2026/08/17 09:00:00', 'plan-origin'
  ]];
  api.saveBudgetPlans = payload => {
    saved = payload;
    return { periodType: 'week', periodKey: '2026-W34', rows: [] };
  };

  api.setPlanningPlanDone({ periodType: 'week', periodKey: '2026-W34', planId: 'plan-origin', done: true });
  assert.equal(saved.periodType, 'week');
  assert.equal(saved.periodKey, '2026-W34');
  assert.equal(saved.plans.length, 1);
  assert.equal(saved.plans[0].planId, 'plan-origin');
  assert.equal(saved.plans[0].done, true);
  assert.equal(saved.plans[0].completionOverride, true);

  api.setPlanningPlanDone({ periodType: 'week', periodKey: '2026-W34', planId: 'plan-origin', done: false });
  assert.equal(saved.plans[0].done, false);
  assert.equal(saved.plans[0].completionOverride, false);
});

test('画面で完了の予定は、予実計画の完了列が空なら TRUE を書き戻す', () => {
  const api = createContext();
  const targets = api.budgetPlansToPersistAsComplete([
    { hasPlan: true, planId: 'plan-daily', aggregationKey: '日次', periodKey: '2026-W40', originWeek: '2026-W40', completionOverride: null, done: false, dailyComplete: true, complete: true },
    { hasPlan: true, planId: 'plan-sub', aggregationKey: '親', periodKey: '2026-W39', originWeek: '2026-W39', completionOverride: null, done: false, dailyComplete: false, complete: false },
    { hasPlan: true, planId: 'plan-open', aggregationKey: '未完了', periodKey: '2026-W40', originWeek: '2026-W40', completionOverride: null, done: false, dailyComplete: false, complete: false },
    { hasPlan: true, planId: 'plan-reopened', aggregationKey: '再開', periodKey: '2026-W40', originWeek: '2026-W40', completionOverride: false, done: false, dailyComplete: true, complete: false },
    { hasPlan: true, planId: 'plan-stored', aggregationKey: '記録済み', periodKey: '2026-W40', originWeek: '2026-W40', completionOverride: true, done: true, dailyComplete: true, complete: true }
  ], [
    { parentPlanId: 'plan-sub', title: '子', status: '完了' }
  ]);
  assert.deepEqual(targets.map(row => row.planId), ['plan-daily', 'plan-sub']);

  let saved;
  api.loadBudgetSummary = () => ({
    rows: [{ hasPlan: true, planId: 'plan-1', aggregationKey: '課題', periodKey: '2026-W40', originWeek: '2026-W39', completionOverride: null, done: false, dailyComplete: true, complete: true }]
  });
  api.getPlanningSpreadsheetId = () => 'sheet';
  api.loadPlanningTaskRows = () => [];
  api.loadBudgetPlanRows = () => [[
    'week', '2026-W39', '課題', 8, '', '', 0, 8, 8, 'initial', '2026/09/21 09:00:00', 'plan-1'
  ]];
  api.saveBudgetPlans = payload => { saved = payload; return { rows: [] }; };
  api.persistEffectivePlanCompletion('week', '2026-W40');
  assert.equal(saved.periodKey, '2026-W39');
  assert.equal(saved.plans[0].planId, 'plan-1');
  assert.equal(saved.plans[0].done, true);
  // 自動で付けた完了は、手で付けた完了（completionOverride: true）と区別して「自動」として残す。
  assert.equal(saved.plans[0].completionOverride, null);
  assert.equal(saved.plans[0].autoComplete, true);
  assert.equal(api.savedRowsIncludePlanCompletion([['2026/10/08', '課題', 1, 0, 8, '完了', '', 'plan-1']]), true);
  assert.equal(api.savedRowsIncludePlanCompletion([['2026/10/08', '割り込み', 1, 0, 1, '完了', '割り込み', '']]), false);
  assert.equal(api.budgetDayRowsChangedPlanCompletion(
    [['2026/10/08', '課題', 1, 0, 8, '完了', '', 'plan-1']],
    [['2026/10/08', '課題', 1, 0, 8, '', '', 'plan-1']]
  ), true);

  saved = null;
  api.loadBudgetSummary = () => ({
    rows: [{ hasPlan: true, planId: 'plan-1', aggregationKey: '課題', periodKey: '2026-W40', originWeek: '2026-W39', completionOverride: true, done: true, dailyTracked: true, dailyComplete: false, complete: true }]
  });
  api.loadBudgetPlanRows = () => [[
    'week', '2026-W39', '課題', 8, '', '', 0, 8, 8, 'initial', '2026/09/21 09:00:00', 'plan-1', '', '', '', '', 'TRUE'
  ]];
  api.loadPlanningTaskRows = () => [{ parentPlanId: 'plan-1', title: '子', status: '完了' }];
  api.planningTaskFromRow = task => task;
  api.persistEffectivePlanCompletion('week', '2026-W40');
  assert.equal(saved.plans[0].done, false);
  assert.equal(saved.plans[0].completionOverride, null);
});

test('保存対象でない繰り越し元のサブタスクは残す', () => {
  const api = createContext();
  const retained = api.planningTasksToRetain([
    { id: 'sub-carry', periodType: 'week', periodKey: '2026-W41', parentPlanId: 'plan-origin', parentKey: '設計', title: '調査' },
    { id: 'sub-edited', periodType: 'week', periodKey: '2026-W41', parentPlanId: 'plan-native', parentKey: '実装', title: '旧作業' },
    { id: 'sub-deleted', periodType: 'week', periodKey: '2026-W41', parentPlanId: 'plan-removed', parentKey: '削除予定', title: '作業' },
    { id: 'sub-other', periodType: 'week', periodKey: '2026-W40', parentPlanId: 'plan-origin', parentKey: '設計', title: '別週' }
  ], 'week', '2026-W41', [
    { planId: 'plan-native', aggregationKey: '実装' }
  ], [
    { planId: 'plan-origin', aggregationKey: '設計' },
    { planId: 'plan-native', aggregationKey: '実装' }
  ]);
  assert.deepEqual(retained.map(task => task.id), ['sub-carry']);
});

test('日次実績の完了状態を週予定候補の判定へ引き継ぐ', () => {
  const api = createContext();
  const context = api.budgetWeeklyDailyHoursContext('2026-08-26', [{
    aggregationKey: '課題1',
    plannedHours: 8,
    planId: 'plan-1'
  }], [
    ['2026/08/25', '課題1 調査', 2, 0, 2, '完了'],
    ['2026/08/25', '課題1 テスト', 1, 0, 1, '完了']
  ], [], 'Asia/Tokyo');
  assert.equal(context.completedByPlan['plan-1'], true);

  api.loadWeeklyDailyHoursContext = () => Object.assign({}, context, {
    plans: [{ aggregationKey: '課題1', plannedHours: 8, planId: 'plan-1' }]
  });
  assert.equal(api.getBudgetPlanSuggestionsForDate('2026-08-26').length, 0);
});

test('日次の週次集計は取得済みの月だけを再利用する', () => {
  const api = createContext();
  const cached = {
    '2026年08月': [['cached']]
  };
  const requested = [];
  api.listBudgetDailySheetNamesForYmdRange = () => ['2026年08月', '2026年09月'];
  api.getCachedSheetValues = (spreadsheetId, sheetName) => Object.prototype.hasOwnProperty.call(cached, sheetName) ? cached[sheetName] : null;
  api.putCachedSheetValues = (spreadsheetId, sheetName, values) => { cached[sheetName] = values; };
  api.a1Range = (sheetName, range) => sheetName + '!' + range;
  api.sheetsValuesBatchGet = (spreadsheetId, ranges) => {
    requested.push(ranges);
    return [[['fetched']]];
  };

  const rows = api.loadBudgetDailyRowsForYmdRange('sheet', '2026-08-01', '2026-10-01');
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [['cached'], ['fetched']]);
  assert.deepEqual(JSON.parse(JSON.stringify(requested)), [['2026年09月!A2:I']]);
});

test('週ワークスペースは予定タスクシートを週ごとに読み直さない', () => {
  const api = createContext();
  let planReads = 0;
  let taskReads = 0;
  api.getPlanningSpreadsheetId = () => 'planning-sheet';
  api.loadBudgetPlanRows = () => {
    planReads += 1;
    return [{ periodType: 'week', periodKey: '2026-W34', aggregationKey: '設計', plannedHours: 8 }];
  };
  api.budgetPersistedPlanFromRow = plan => plan;
  api.loadBudgetSummary = (type, key, plans) => {
    assert.equal(type, 'week');
    assert.equal(key, '2026-W34');
    assert.equal(plans.length, 1);
    return { rows: [{ periodKey: key }], subtasks: [], range: { startYmd: '2026-08-17', endExclusiveYmd: '2026-08-24' } };
  };
  api.loadPlanningTaskRows = () => {
    taskReads += 1;
    return [{ periodType: 'week', periodKey: '2026-W34', parentKey: '設計', title: '確認', plannedHours: 1, status: 'todo' }];
  };
  api.planningTaskFromRow = task => task;
  api.getAppStorageStatus = () => ({ configured: true });
  api.loadMonthlyAllocationForWeek = () => null;
  api.loadCalendarExclusions = () => [];

  const result = api.loadPlanningWorkspace('week', '2026-W34');
  assert.equal(planReads, 1);
  assert.equal(taskReads, 1);
  assert.equal(result.subtasks.length, 1);
  assert.equal(result.subtasks[0].title, '確認');
});

test('サブタスクを検証し、期間外の期限と未知の親を拒否する', () => {
  const api = createContext();
  const plans = [{ aggregationKey: '実装', plannedHours: 8 }];
  const task = {
    id: 'sub-1', parentKey: '実装', title: 'APIを作る', plannedHours: 3.5,
    dueDate: '2026-08-21', status: 'doing', note: '', sortOrder: 0
  };
  const normalized = api.normalizePlanningTasks([task], 'week', '2026-W34', plans);
  assert.equal(normalized[0].plannedHours, 3.5);
  assert.equal(normalized[0].status, 'doing');
  assert.throws(
    () => api.normalizePlanningTasks([{ ...task, dueDate: '2026-08-24' }], 'week', '2026-W34', plans),
    /期間内/
  );
  assert.throws(
    () => api.normalizePlanningTasks([{ ...task, parentKey: '不存在' }], 'week', '2026-W34', plans),
    /親タスク/
  );
});

test('課題の予定工数合計は親の予定を超えない', () => {
  const api = createContext();
  const plans = [{ aggregationKey: '実装', plannedHours: 4 }];
  const ok = [
    { id: 'sub-1', parentKey: '実装', title: 'APIを作る', plannedHours: 2, dueDate: '2026-08-21', status: 'todo', note: '', sortOrder: 0 },
    { id: 'sub-2', parentKey: '実装', title: 'テスト', plannedHours: 2, dueDate: '2026-08-21', status: 'todo', note: '', sortOrder: 1 }
  ];
  assert.equal(api.normalizePlanningTasks(ok, 'week', '2026-W34', plans).length, 2);
  assert.throws(
    () => api.normalizePlanningTasks([
      { ...ok[0] },
      { ...ok[1], plannedHours: 2.25 }
    ], 'week', '2026-W34', plans),
    /予定を超えて/
  );
});

test('サブタスクの完了件数と見積工数を集計する', () => {
  const api = createContext();
  const progress = api.planningTaskProgress([
    { status: 'done', plannedHours: 2.5 },
    { status: 'doing', plannedHours: 3 },
    { status: 'done', plannedHours: 1.25 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(progress)), {
    total: 3,
    done: 2,
    plannedHours: 6.75,
    doneHours: 3.75
  });
});

test('Sheetsの日付シリアルをサブタスク期限へ戻す', () => {
  const api = createContext();
  const row = ['sub-1', 'week', '2026-W34', '実装', 'APIを作る', 2, 46255, 'todo', '', 0];
  const task = api.planningTaskFromRow(row);
  assert.equal(task.dueDate, '2026-08-21');
});

test('工数は15分単位（0.25h）に丸める', () => {
  const api = createContext();
  assert.equal(api.roundHours(0), 0);
  assert.equal(api.roundHours(0.12), 0);
  assert.equal(api.roundHours(0.13), 0.25);
  assert.equal(api.roundHours(0.83), 0.75);
  assert.equal(api.roundHours(1.17), 1.25);
  assert.equal(api.roundHours(8), 8);
  assert.equal(api.roundHours(50 / 60), 0.75);
  assert.equal(api.roundHours(40 / 60), 0.75);
  assert.equal(api.roundHours(20 / 60), 0.25);
  const plan = api.normalizeBudgetPlan({
    periodType: 'week', periodKey: '2026-W34', aggregationKey: '定例会議', plannedHours: 1.17
  }, 0);
  assert.equal(plan.plannedHours, 1.25);
  const tasks = api.normalizePlanningTasks([{
    id: 'sub-1', parentKey: '実装', title: 'レビュー', plannedHours: 0.83,
    dueDate: '2026-08-21', status: 'doing', note: '', sortOrder: 0
  }], 'week', '2026-W34', [{ aggregationKey: '実装', plannedHours: 8 }]);
  assert.equal(tasks[0].plannedHours, 0.75);
});

test('入力中は工数を保持し、保存時だけ0.25刻みに正規化する', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const start = html.indexOf('function roundHours(value)');
  const end = html.indexOf('function applyStatusCard');
  assert.ok(start >= 0 && end > start);
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  assert.equal(context.numericHours(0.13), 0.13);
  assert.equal(context.liveHours(0.13), '0.13');
  assert.equal(context.plannerHasWorkHours(0, 0), false);
  assert.equal(context.plannerHasWorkHours(0, 0.25), true);
  assert.equal(context.plannerHasWorkHours(0.25, 0), true);
  assert.equal(context.isQuarterHour(1.13), false);
  assert.equal(context.isQuarterHour(1.25), true);
  context.document = { querySelectorAll: () => [{ value: '1.13' }] };
  assert.equal(context.dailyHoursAreConfirmed(), false);
  context.document = { querySelectorAll: () => [{ value: '1.25' }] };
  assert.equal(context.dailyHoursAreConfirmed(), true);
  const saved = context.normalizeDailyRowsForSave([
    { type: 'interrupt', today: 1.13, previous: 9, estimate: 8 },
    { type: 'saved', today: 1.13, previous: 0.13, estimate: 8.13 }
  ]);
  assert.equal(saved[0].today, 1.25);
  assert.equal(saved[0].previous, 0);
  assert.equal(saved[0].estimate, 1.25);
  assert.equal(saved[1].today, 1.25);
  assert.equal(saved[1].previous, 0.25);
  assert.equal(saved[1].estimate, 8.25);
});

test('今日だけの課題名は編集値をそのまま日次名として同期する', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const start = html.indexOf('function roundHours(value)');
  const end = html.indexOf('function dailyEmptyState');
  assert.ok(start >= 0 && end > start);
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const interruptRow = {
    dataset: { type: 'interrupt' },
    querySelector(selector) {
      return selector === '.interrupt-name' ? { value: ' 変更後の作業名 ' } : null;
    }
  };
  assert.equal(context.composedDailyNameFromRow(interruptRow), '変更後の作業名');
  const plannedRow = {
    dataset: { type: 'saved' },
    querySelector(selector) {
      if (selector === '.task-parent') return { value: '親課題' };
      if (selector === '.task-name') return { value: '子課題' };
      return null;
    }
  };
  assert.equal(context.composedDailyNameFromRow(plannedRow), '親課題 子課題');
});

test('予定メモから前週繰越の週キーを読む', () => {
  const api = createContext();
  assert.equal(api.budgetCarryWeekFromNote('start:2026-08-24\ncarry:2026-W34\n今週の最優先'), '2026-W34');
  assert.equal(api.budgetCarryWeekFromNote('cap:2.5\n今週の最優先'), '');
  assert.equal(api.budgetCalendarKeyFromNote('start:2026-08-25\ncal:weekly:2026-08-25:10:00:1'), 'weekly:2026-08-25:10:00:1');
  assert.equal(api.budgetStartDateFromNote('start:2026-08-25\ncal:weekly:2026-08-25:10:00:1'), '2026-08-25');
  assert.equal(api.budgetStartDateFromNote('start:2026/08/21\ncarry:2026-W34'), '2026-08-21');
});

test('旧形式のメモを専用フィールドへ移して本文だけを残す', () => {
  const api = createContext();
  const plan = api.budgetPersistedPlanFromRow([
    'week', '2026-W34', '設計', 8,
    'start:2026-08-18\ncap:2\ncarry:2026-W33\ncal:event-1\ndone:1\nday:{"2026-08-18":2}\nユーザーのメモ',
    '2026/08/17 09:00:00', 0, 10, 8, 'initial', '2026/08/17 09:00:00'
  ], 0);
  assert.match(plan.planId, /^legacy-/);
  assert.equal(plan.note, 'ユーザーのメモ');
  assert.equal(plan.startDate, '2026-08-18');
  assert.equal(plan.dailyCap, 2);
  assert.equal(plan.carryWeek, '2026-W33');
  assert.equal(plan.calendarKey, 'event-1');
  assert.equal(plan.done, true);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.dailyPlan)), { '2026-08-18': 2 });
});

test('専用列があればメモ内の旧メタデータより優先する', () => {
  const api = createContext();
  const plan = api.budgetPersistedPlanFromRow([
    'week', '2026-W34', '設計', 8, 'start:2026-08-18\n古いメモ',
    '2026/08/17 09:00:00', 0, 8, 8, 'initial', '2026/08/17 09:00:00',
    'plan-stable-1', '2026-08-20', 3, '2026-W32', 'event-new', 'FALSE', '{"2026-08-20":3}'
  ], 0);
  assert.equal(plan.planId, 'plan-stable-1');
  assert.equal(plan.note, '古いメモ');
  assert.equal(plan.startDate, '2026-08-20');
  assert.equal(plan.dailyCap, 3);
  assert.equal(plan.done, false);
});

test('予定名を変更しても予定IDで日次実績を集計する', () => {
  const api = createContext();
  const result = api.calculateBudgetSummary('week', '2026-W34', [{
    periodType: 'week',
    periodKey: '2026-W34',
    aggregationKey: '変更後の名前',
    planId: 'plan-stable-1',
    plannedHours: 8
  }], [
    ['2026/08/18', '変更前の名前 調査', 2.5, 0, 8, '', '', 'plan-stable-1']
  ], 'Asia/Tokyo');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].aggregationKey, '変更後の名前');
  assert.equal(result.rows[0].actualHours, 2.5);
  const split = api.calculateBudgetSummary('week', '2026-W35', [
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '設計レビュー', plannedHours: 4, planId: 'plan-own' },
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '設計レビュー', plannedHours: 8, planId: 'plan-origin' }
  ], [
    ['2026/08/31', '設計レビュー', 1, 0, 4, '', '', 'plan-own'],
    ['2026/08/28', '設計レビュー', 3, 0, 8, '', '', 'plan-origin']
  ], 'Asia/Tokyo');
  assert.equal(split.rows.filter(row => row.aggregationKey === '設計レビュー').length, 2);
  assert.equal(split.rows.find(row => row.planId === 'plan-own').actualHours, 1);
  assert.equal(split.rows.find(row => row.planId === 'plan-origin').actualHours, 3);
  const sameNamePlans = api.normalizeBudgetPlans([
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '設計レビュー', plannedHours: 4, planId: 'plan-a' },
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '設計レビュー', plannedHours: 8, planId: 'plan-b' }
  ]);
  assert.equal(sameNamePlans.length, 2);
});

test('親予定IDがあればサブタスクの親名を安全に更新する', () => {
  const api = createContext();
  const tasks = api.normalizePlanningTasks([{
    id: 'sub-1',
    parentKey: '変更前の名前',
    parentPlanId: 'plan-stable-1',
    title: '調査',
    plannedHours: 2
  }], 'week', '2026-W34', [{
    periodType: 'week',
    periodKey: '2026-W34',
    aggregationKey: '変更後の名前',
    planId: 'plan-stable-1',
    plannedHours: 8
  }]);
  assert.equal(tasks[0].parentKey, '変更後の名前');
  assert.equal(tasks[0].parentPlanId, 'plan-stable-1');
});

test('日次の親候補は週予定だけ使い月予定へは落とさない', () => {
  const api = createContext();
  const result = api.selectWeeklyPlansForDailySuggestions([
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '課題1' },
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '来週課題' },
    { periodType: 'month', periodKey: '2026-08', aggregationKey: '月次課題' }
  ], '2026-W34');
  assert.deepEqual(Array.from(result, plan => plan.aggregationKey), ['課題1']);
  assert.deepEqual(Array.from(api.selectWeeklyPlansForDailySuggestions([
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '続き課題', plannedHours: 8 },
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '続き課題', plannedHours: 8, carryWeek: '2026-W34' },
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '今週の新規', plannedHours: 2 }
  ], '2026-W35'), plan => plan.aggregationKey), ['今週の新規', '続き課題']);
  const reordered = api.calculateBudgetSummary('week', '2026-W35', [
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '今週の新規', plannedHours: 2, planId: 'new', priority: 1 },
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '続き課題', plannedHours: 8, planId: 'origin', carryWeek: '2026-W34', priority: 0 },
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '続き課題', plannedHours: 8, planId: 'origin', priority: 5 }
  ], [], 'Asia/Tokyo');
  // 優先順位は予定ごとに全体で共通。引き継いだ週の行ではなく、登録した週の値で並べる。
  assert.deepEqual(Array.from(reordered.rows, row => row.aggregationKey), ['今週の新規', '続き課題']);
  assert.equal(reordered.rows.find(row => row.planId === 'origin').priority, 5);
  assert.equal(api.previousBudgetWeekKey('2026-W35'), '2026-W34');
  assert.deepEqual(Array.from(api.selectWeeklyPlansForDailySuggestions([
    { periodType: 'month', periodKey: '2026-08', aggregationKey: '月次課題' }
  ], '2026-W34'), plan => plan.aggregationKey), []);
  const sameName = api.selectWeeklyPlansForDailySuggestions([
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '設計レビュー', plannedHours: 4, planId: 'new-1' },
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '設計レビュー', plannedHours: 8, planId: 'origin-1' }
  ], '2026-W35');
  assert.equal(sameName.length, 2);
  assert.deepEqual(Array.from(sameName, plan => plan.planId).sort(), ['new-1', 'origin-1']);
});

test('続きの週予定は過去週と今週の実績を通算する', () => {
  const api = createContext();
  const result = api.calculateBudgetSummary('week', '2026-W35', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '設計レビュー', plannedHours: 8, planId: 'plan-origin', startDate: '2026-08-17' },
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '設計レビュー', plannedHours: 8, planId: 'plan-copy', carryWeek: '2026-W34' },
    { periodType: 'week', periodKey: '2026-W35', aggregationKey: '今週の新規', plannedHours: 2, planId: 'plan-new' }
  ], [
    ['2026/08/17', '設計レビュー', 3],
    ['2026/08/21', '設計レビュー 指摘', 1],
    ['2026/08/24', '設計レビュー', 2],
    ['2026/08/24', '今週の新規', 0.5],
    ['2026/08/10', '無関係', 4]
  ], 'Asia/Tokyo');
  const continued = result.rows.find(row => row.aggregationKey === '設計レビュー');
  assert.equal(continued.hasPlan, true);
  assert.equal(continued.periodKey, '2026-W34');
  assert.equal(continued.originWeek, '2026-W34');
  assert.equal(continued.planId, 'plan-origin');
  assert.equal(continued.actualHours, 6);
  assert.equal(continued.actualByDate['2026-08-17'], 3);
  assert.equal(continued.actualByDate['2026-08-21'], 1);
  assert.equal(continued.actualByDate['2026-08-24'], 2);
  assert.equal(result.dailyActualByName['設計レビュー']['2026-08-17'], 3);
  assert.equal(result.dailyActualByName['設計レビュー 指摘']['2026-08-21'], 1);
  assert.equal(result.rows.find(row => row.aggregationKey === '今週の新規').actualHours, 0.5);
  assert.equal(result.rows.some(row => row.aggregationKey === '無関係'), false);
  const lookback = api.budgetWeeklyActualsRange('2026-W35', 'Asia/Tokyo');
  let cursor = '2026-W35';
  for (let i = 0; i < 16; i++) cursor = api.previousBudgetWeekKey(cursor);
  assert.equal(lookback.startYmd, api.getBudgetPeriodRange('week', cursor).startYmd);
  assert.ok(lookback.endExclusiveYmd >= '2026-08-31');
});

test('月次予定を選択週の平日数に応じて配分する', () => {
  const api = createContext();
  const result = api.calculateMonthlyAllocationForWeek('2026-W36', [
    { periodType: 'month', periodKey: '2026-08', aggregationKey: '設計', plannedHours: 21, note: '' },
    { periodType: 'month', periodKey: '2026-09', aggregationKey: '設計', plannedHours: 44, note: '' },
    { periodType: 'month', periodKey: '2026-09', aggregationKey: '実装', plannedHours: 22, note: '' }
  ]);
  assert.deepEqual(Array.from(result.monthKeys), ['2026-08', '2026-09']);
  assert.equal(result.rows.find(row => row.aggregationKey === '設計').suggestedHours, 9);
  assert.equal(result.rows.find(row => row.aggregationKey === '実装').suggestedHours, 4);
});

test('上位タスクからカレンダーの空き時間へ順番に割り当てる', () => {
  const api = createContext();
  const result = api.calculatePriorityForecast([
    { aggregationKey: '最優先', plannedHours: 10, actualHours: 2, hasPlan: true },
    { aggregationKey: '次の課題', plannedHours: 6, actualHours: 0, hasPlan: true }
  ], [
    { date: '2026-08-20', availableHours: 6, meetingHours: 2 },
    { date: '2026-08-21', availableHours: 8, meetingHours: 0 }
  ]);
  assert.equal(result[0].endDate, '2026-08-21');
  assert.deepEqual(Array.from(result[0].allocations, row => row.hours), [6, 2]);
  assert.equal(result[1].startDate, '2026-08-21');
  assert.equal(result[1].endDate, '2026-08-21');
});

test('予定の優先順位を保存用データへ引き継ぐ', () => {
  const api = createContext();
  const result = api.normalizeBudgetPlan({
    periodType: 'week', periodKey: '2026-W34', aggregationKey: '設計', plannedHours: 4, priority: 3
  }, 0);
  assert.equal(result.priority, 3);
  assert.equal(result.estimatedTotalHours, 4);
  assert.equal(result.initialPlannedHours, 4);
  assert.equal(result.planKind, 'initial');
});

test('優先順位は週予定として表示される行だけを数え、工数0hの予定も含める', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const context = {
    state: {
      planner: {
        items: [
          { id: 'planned', hasPlan: true, planned: 4, actual: 0 },
          { id: 'actual-only', hasPlan: false, planned: 0, actual: 2 },
          { id: 'empty-plan', hasPlan: true, planned: 0, actual: 0 },
          { id: 'completed', hasPlan: true, planned: 1, actual: 1 }
        ]
      }
    }
  };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  const start = html.indexOf('function roundHours(value)');
  const end = html.indexOf('function rowToPlannerItem');
  assert.ok(start >= 0 && end > start);
  vm.runInContext(html.slice(start, end), context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.plannerPriorityItems().map(item => item.id))),
    ['planned', 'empty-plan', 'completed']
  );
});

test('予定名の変更は表示中の引継ぎ関連データにも反映する', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const plan = { id: 'plan-1', name: '旧タスク', hasPlan: true };
  const context = {
    state: {
      planner: {
        items: [plan],
        summary: {
          rows: [{ planId: 'plan-1', aggregationKey: '旧タスク' }],
          subtasks: [{ parentPlanId: 'plan-1', parentKey: '旧タスク', title: '調査' }]
        }
      },
      daily: { weekItems: [{ id: 'plan-1', name: '旧タスク' }], weekSummary: null },
      parentNamesByWeek: {
        '2026-W35': [{ planId: 'plan-1', title: '旧タスク', parentKey: '旧タスク', subtasks: [{ parentPlanId: 'plan-1', parentKey: '旧タスク', title: '調査' }] }]
      },
      candidates: [],
      weeklySubtasksByWeek: {
        '2026-W35': [{ parentPlanId: 'plan-1', parentKey: '旧タスク', title: '調査' }]
      },
      weekForecastCache: {
        '2026-W35': { rows: [{ id: 'plan-1', name: '旧タスク' }] }
      },
      calendarCache: {},
      weeklyPlanNames: ['旧タスク'],
      weeklyPlanMeta: { '旧タスク': { planId: 'plan-1', plannedHours: 4 } }
    }
  };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  const start = html.indexOf('function planIdentityName');
  const end = html.indexOf('function rememberWeeklyPlansFromSummary');
  assert.ok(start >= 0 && end > start);
  vm.runInContext(html.slice(start, end), context);
  context.renamePlannerNameReferences(plan, '旧タスク', '新タスク');
  assert.equal(plan.name, '新タスク');
  assert.equal(context.state.planner.summary.rows[0].aggregationKey, '新タスク');
  assert.equal(context.state.planner.summary.subtasks[0].parentKey, '新タスク');
  assert.equal(context.state.parentNamesByWeek['2026-W35'][0].title, '新タスク');
  assert.equal(context.state.weeklySubtasksByWeek['2026-W35'][0].parentKey, '新タスク');
  assert.deepEqual(JSON.parse(JSON.stringify(context.state.weeklyPlanNames)), ['新タスク']);
  assert.equal(context.state.weeklyPlanMeta['新タスク'].planId, 'plan-1');
  assert.equal(context.state.weeklyPlanMeta['旧タスク'], undefined);
});

test('当初予定と追加予定を集計で分離する', () => {
  const api = createContext();
  const result = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '当初課題', plannedHours: 6, initialPlannedHours: 8, planKind: 'initial' },
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '追加課題', plannedHours: 3, initialPlannedHours: 3, planKind: 'added' }
  ], [], 'Asia/Tokyo');
  assert.equal(result.totals.plannedHours, 9);
  assert.equal(result.totals.initialPlannedHours, 8);
  assert.equal(result.totals.addedPlannedHours, 3);
  assert.equal(result.rows[1].planKind, 'added');
});

test('日次は未保存の日にカレンダー予定を自動で足す', () => {
  const api = createContext();
  const days = [{
    date: '2026-08-25',
    events: [
      { id: 'standup', title: '朝会', startTime: '09:30', endTime: '10:00', blocksTime: true },
      { id: 'weekly', title: '週次定例', startTime: '10:00', endTime: '12:00', blocksTime: true },
      { id: 'skip', title: '任意参加', startTime: '15:00', endTime: '16:00', blocksTime: true },
      { id: 'holiday', title: '休日', allDay: true }
    ]
  }];
  const skipKey = api.calendarEventKey(days[0].events[2], '2026-08-25', 2);
  const tasks = api.buildDailyCalendarTasks('2026-08-25', days, [], [skipKey]);
  assert.deepEqual(Array.from(tasks, task => task.name), ['朝会', '週次定例']);
  assert.equal(tasks[0].imported, false);
  assert.equal(tasks[0].estimate, 0.5);
  assert.equal(tasks[1].imported, false);
  assert.equal(tasks[1].estimate, 2);
  const html = fs.readFileSync('gas/index.html', 'utf8');
  assert.match(html, /function applyDailyCalendarTasks\(/);
  assert.match(html, /if \(state\.daily\.mode === 'empty'\) return 0;/);
  assert.doesNotMatch(html, /if \(state\.daily\.mode === 'edit' && !task\.imported\) return;/);
  assert.match(html, /applyDailyCalendarTasks\(state\.daily\.date\)/);
  assert.match(html, /task\.imported \? 'calendar-imported' : 'calendar'/);
  assert.match(html, /if \(row\.type === 'calendar' \|\| row\.type === 'calendar-imported'\) return 'calendar'/);
  assert.match(html, /origin === 'calendar'\) return 'カレンダー'/);
  assert.doesNotMatch(html, /カレンダーから自動/);
  assert.doesNotMatch(html, /カレンダー・今日だけの作業/);
  assert.doesNotMatch(html, /function buildDailyGroupRow\(/);
  assert.doesNotMatch(html, /function dailyRowIsSideTask\(/);
  assert.match(html, /function dropCalendarAutoActualsFromPlanner\(/);
  assert.match(html, /calendar: row\.type === 'calendar' \|\| row\.type === 'calendar-imported'/);
  assert.match(html, /function syncRemovedDailyCalendarRowsToPlanner\(/);
  assert.match(html, /function linkDailyCalendarRows\(/);
  assert.match(html, /calendarRowsAtLoad/);
  assert.match(html, /カレンダー予定は自動で入ります/);
  assert.match(html, /issue\.isCalendar \? '<span class="candidate-tag">カレンダー<\/span>' : ''/);
  const selectable = html.slice(html.indexOf('function dailySelectableIssues('), html.indexOf('function weeklyHasNamedIssue('));
  assert.match(selectable, /isCalendar: !!source\.calendarKey/);
  assert.match(html, /function planningSubtaskMatchesParent\(/);
  assert.match(html, /function planForDailyTask\(/);
  assert.match(html, /function findPlannerItem\(/);
  assert.match(html, /function planningTaskBelongsToPlan\(/);
  assert.match(html, /function weeklyPlanNameForId\(/);
  assert.match(html, /function dailySelectablePlanSources\(/);
  assert.match(html, /function dailyPlanSourceCanComplete\(/);
  assert.match(html, /function dailyPlanSourceIsComplete\(/);
  assert.match(html, /function dailySubtaskIsComplete\(/);
  assert.match(html, /function completeCandidatePlan\(/);
  assert.match(html, /setPlanningPlanDone/);
  assert.match(html, /class="candidate-complete"/);
  assert.match(html, /同名の今日だけの作業があるため/);
  assert.match(html, /function rememberWeeklySubtasksFromSuggestions\(/);
  assert.match(html, /function suggestionItemsForWeek\(/);
  assert.match(html, /if \(previous > 0\) meta\.push\('前日まで ' \+ hours\(previous\) \+ 'h'\)/);
  assert.match(html, /data-previous="/);
  // 選んだ課題の「前日まで」は、候補一覧に覚えた値から日次の行へ渡す。
  assert.match(html, /previousHours: roundHours\(issue\.previousHours\)/);
  assert.match(html, /previous: roundHours\(task\.previousHours\)/);
  assert.match(html, /\.span-row \{[^}]*transition: none;/);
});

test('カレンダー予定は自動取り込みしない', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  assert.doesNotMatch(html, /function importCalendarPlans\(/);
  assert.doesNotMatch(html, /function addCalendarPlanItem\(/);
  assert.doesNotMatch(html, /id="unimportCalendarEvent"/);
  assert.match(html, /実績時間（h）/);
  assert.match(html, /この日に記録します/);
});

test('カレンダー予定の日次候補は除外・終日・0時間を除く', () => {
  const api = createContext();
  const days = [{
    date: '2026-08-24',
    events: [
      { id: 'meet-1', title: '週次定例', startTime: '10:00', endTime: '12:00', blocksTime: true },
      { id: 'skip-1', title: '任意参加', startTime: '15:00', endTime: '16:00', blocksTime: true },
      { id: 'all-day', title: '休日', allDay: true, startTime: '', endTime: '' },
      { id: 'free', title: '予定あり表示', startTime: '13:00', endTime: '14:00', blocksTime: false }
    ]
  }];
  const tasks = api.buildDailyCalendarTasks('2026-08-24', days, [], [api.calendarEventKey(days[0].events[1], '2026-08-24', 1)]);
  assert.deepEqual(Array.from(tasks, task => task.name), ['週次定例', '予定あり表示']);
  assert.equal(tasks[0].estimate, 2);
});

test('旧カレンダー週予定の削除と除外は引き続き扱える', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  assert.match(html, /function removeCalendarPlanImport\(/);
  const del = html.slice(html.indexOf('function deletePlannerItemById('), html.indexOf('function deleteEditingPlan('));
  assert.doesNotMatch(del, /removeCalendarPlanImport\(/);
  assert.doesNotMatch(del, /週予定から外す/);
  assert.doesNotMatch(del, /excludeCalendarPlan\(/);
  assert.doesNotMatch(del, /実施しない予定として除外/);
  const exclude = html.slice(html.indexOf('function excludeEditingCalendarEvent('), html.indexOf('function restoreEditingCalendarEvent('));
  assert.match(exclude, /excludeCalendarPlan\(/);
  assert.match(exclude, /removeCalendarPlanImport\(/);
});

test('除外したカレンダー予定は日次候補に出さない', () => {
  const api = createContext();
  const event = { id: 'opt-1', title: '任意参加', startTime: '15:00', endTime: '16:00', blocksTime: true };
  const days = [{ date: '2026-08-24', events: [event] }];
  const key = api.calendarEventKey(event, '2026-08-24', 0);
  const tasks = api.buildDailyCalendarTasks('2026-08-24', days, [], [key]);
  assert.deepEqual(Array.from(tasks), []);
});

test('カレンダーの実施時間は開始終了時刻から0.25刻みで取る', () => {
  const api = createContext();
  assert.equal(api.calendarEventPlannedHours({ startTime: '10:00', endTime: '12:00' }), 2);
  assert.equal(api.calendarEventPlannedHours({ startTime: '10:00', endTime: '11:15' }), 1.25);
  assert.equal(api.calendarEventPlannedHours({ startTime: '08:00', endTime: '09:00', meetingHours: 0 }), 1);
  assert.equal(api.calendarEventPlannedHours({ startTime: '18:00', endTime: '19:30', meetingHours: 0 }), 1.5);
  assert.equal(api.calendarEventPlannedHours({ startTime: '22:00', endTime: '24:00' }), 2);
  assert.equal(api.calendarEventPlannedHours({ startTime: '22:00', endTime: '10:00' }), 12);
  assert.equal(api.calendarEventPlannedHours({ durationHours: 3.25, startTime: '09:00', endTime: '10:00' }), 3.25);
  assert.equal(api.calendarEventPlannedHours({ allDay: true, startTime: '00:00', endTime: '23:59' }), 0);
});

test('日をまたぐカレンダー予定は当日分だけ切り出す', () => {
  const api = createContext();
  const dayStart = new Date(2026, 7, 24);
  const dayEnd = new Date(2026, 7, 25);
  const nextEnd = new Date(2026, 7, 26);
  const event = {
    allDay: false,
    start: new Date(2026, 7, 24, 22, 0),
    end: new Date(2026, 7, 25, 10, 0)
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.calendarEventDaySlice(event, dayStart, dayEnd))),
    { startTime: '22:00', endTime: '24:00', durationHours: 2 }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.calendarEventDaySlice(event, dayEnd, nextEnd))),
    { startTime: '00:00', endTime: '10:00', durationHours: 10 }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.calendarEventDaySlice({
      allDay: true,
      start: new Date(2026, 7, 24),
      end: new Date(2026, 7, 25)
    }, dayStart, dayEnd))),
    { startTime: '', endTime: '', durationHours: 0 }
  );
});

test('週間画面はカレンダー予定を週予定へ取り込まず実績へ誘導する', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const commit = html.slice(html.indexOf('function commitPlanDialog('), html.indexOf('function deletePlannerItemById('));
  assert.match(commit, /const nameInput = document\.getElementById\('planDialogName'\)/);
  assert.match(commit, /planNameLocked\(editing\)/);
  assert.match(commit, /renamePlannerNameReferences\(item, previousName, name\)/);
  assert.match(commit, /item\.name = name/);
  assert.match(commit, /const note = document\.getElementById\('planDialogNote'\)\.value\.trim\(\)/);
  assert.match(commit, /item\.note = note/);
  assert.match(commit, /note: note/);
  assert.match(html, /function renamePlannerNameReferences\(/);
  assert.match(html, /const planNote = item \? String\(item\.note \|\| ''\)\.trim\(\) : ''/);
  assert.match(html, /planNote \? '備考: ' \+ planNote : ''/);
  assert.match(html, /gas\('loadPlanningCalendarCapacity', type, key\)/);
  assert.match(html, /const CALENDAR_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(html, /function calendarCacheIsFresh\(/);
  assert.match(html, /function rememberCalendarCapacity\(/);
  assert.match(html, /if \(!forceRefresh && cached && fresh\)/);
  assert.match(html, /if \(!forceRefresh && cached\)/);
  assert.match(html, /id="refreshPlannerCalendar"/);
  assert.match(html, /function refreshPlannerCalendar\(/);
  assert.match(html, /function refreshVisibleCalendarIfStale\(/);
  assert.match(html, /document\.addEventListener\('visibilitychange', function\(\) \{\s*if \(document\.visibilityState === 'hidden'\) flushPendingAutoSaves\(\);\s*refreshVisibleCalendarIfStale\(true\);\s*syncVisibleNavigationSnapshot\(\);/);
  assert.match(html, /state\.calendarFetchedAt/);
  assert.doesNotMatch(html.slice(html.indexOf('function applyWorkCapacitySetting('), html.indexOf('function plannerCapacityDays(')), /rememberCalendarCapacity\(/);
  assert.doesNotMatch(html.slice(html.indexOf('function applyWorkCapacitySetting('), html.indexOf('function plannerCapacityDays(')), /calendarFetchedAt/);
  assert.doesNotMatch(html, /function importCalendarPlans\(/);
  assert.doesNotMatch(html, /function weekHasSavedPlans\(/);
  assert.doesNotMatch(html, /function addCalendarPlanItem\(/);
  const calendarCommit = html.slice(html.indexOf('function commitCalendarEventDialog('), html.indexOf('function excludeEditingCalendarEvent('));
  assert.match(calendarCommit, /await openPlannerActualDay\(editing\.date\)/);
  assert.match(calendarCommit, /row\.today = actualHours/);
  assert.match(calendarCommit, /await saveDaily\(\)/);
  assert.doesNotMatch(calendarCommit, /markPlannerChanged\(\)/);
  assert.match(html, /id="commitCalendarEvent"[^>]*>実績で記録/);
  assert.match(html, /excludeCalendarPlan\(/);
  assert.match(html, /id="calendarEventHours"/);
  assert.match(html, /const eventHours = calendarEventHours\(event\)/);
  assert.doesNotMatch(html, /const eventHours = calendarEventWorkOverlapHours\(event\)/);
  assert.match(html, /id="openAppSettings"/);
  assert.match(html, /id="saveCalendarSettings"/);
  assert.match(html, /function renderCalendarSettings\(/);
  assert.match(html, /getPlanningCalendarSettings/);
  assert.match(html, /savePlanningCalendarSettings/);
  assert.match(html, /\.week-meet-day \{[\s\S]*overflow: hidden;/);
  assert.match(html, /\.week-head-day \{[\s\S]*overflow: hidden;/);
  assert.match(html, /function compactHours\(/);
  assert.match(html, /class="week-add"[^>]*>[\s\S]*add<\/span>/);
  assert.match(html, /function weekDayLoadLabel\(/);
  assert.match(html, /function weekDayLoadHtml\(/);
  assert.match(html, /weekDayLoadHtml\(actual, base\)/);
  assert.match(html, /\.calendar-entry \{[\s\S]*overflow: hidden;/);
  assert.match(html, /\.calendar-entry b, \.calendar-entry small \{[\s\S]*text-overflow: ellipsis;/);
  assert.doesNotMatch(html, /calendar-entry-state/);
  assert.match(html, /\.calendar-entry\.is-imported \{[\s\S]*border: 2px dashed var\(--meet-line\); background: transparent/);
  assert.match(html, /\.calendar-entry\.is-excluded \{[\s\S]*var\(--surface-3\)/);
  assert.match(html, /grid-template-columns: var\(--week-name-col\)/);
  assert.match(html, /weekGridStyle[\s\S]*var\(--week-name-col\)/);
  // 予定名は共通の planSummaryTitleHtml で <b title="…"> にする（Backlogの課題キーがあればリンクも付ける）。
  assert.match(html, /class="span-name-title">' \+ planSummaryTitleHtml\(row\.name/);
  assert.match(html, /if \(!issue\) return '<b title="' \+ escapeHtml\(text\) \+ '">'/);
  assert.doesNotMatch(html, /grid-template-columns:176px/);
  assert.match(html, /function planActualStatus\(/);
  assert.doesNotMatch(html, /class="plan-kind-badge is-calendar">カレンダー<\/span>/);
  assert.doesNotMatch(html, /取込済/);
  assert.match(html, /function syncCalendarVarianceRow\(/);
  assert.match(html, /function calendarOriginForInterruptRow\(/);
  assert.match(html, /calendarEstimate: el\.dataset\.calendarEstimate/);
  assert.match(html, /function syncDailyRowIssueField\(/);
  assert.match(html, /syncDailyRowIssueField\(el, name\)/);
  assert.match(html, /function syncDailyRowSyncedHours\(/);
  assert.match(html, /el\.dataset\.type = 'interrupt'/);
  assert.match(html, /syncDailyFromDom\(\{ convertCalendarVariance: true \}\)/);
  assert.match(html, /syncCalendarVarianceRow\(row\)/);
  assert.doesNotMatch(html, /is-calendar-row/);
  // 予定は期間のバーで見せるので、日ごとの予定時間（span-plan）は出さず実績だけを載せる。
  assert.doesNotMatch(html, /class="span-plan"/);
  assert.match(html, /class="span-actual/);
  assert.match(html, /function weekSpanActualHtml\(/);
  assert.doesNotMatch(html, /function beginSpanSlide\(/);
  assert.doesNotMatch(html, /予定を押したまま左右へ移動/);
  assert.match(html, /id="weekStatus"/);
  assert.doesNotMatch(html, /id="planDialogDone"/);
  assert.match(html, /id="planDialogProgress"/);
  assert.match(html, /<md-select-option value="todo"[^>]*><div slot="headline">未着手<\/div>/);
  assert.match(html, /<md-select-option value="doing"><div slot="headline">進行中<\/div>/);
  assert.match(html, /<md-select-option value="done"><div slot="headline">完了<\/div>/);
  assert.match(html, /function togglePlanComplete\(/);
  assert.match(html, /function planIsComplete\(/);
  assert.match(html, /function setPlanCompletion\(/);
  assert.match(html, /completionOverride/);
  const loadPlannerStart = html.indexOf('async function loadPlannerBlocking(');
  const loadPlannerEnd = html.indexOf('async function refreshPlannerFromServer(');
  assert.ok(loadPlannerStart >= 0 && loadPlannerEnd > loadPlannerStart);
  const loadPlannerSource = html.slice(loadPlannerStart, loadPlannerEnd);
  assert.match(loadPlannerSource, /overlay = await ensureWeekContinuationOverlay/);
  assert.ok(loadPlannerSource.indexOf('await ensureWeekContinuationOverlay') < loadPlannerSource.indexOf('renderPlanner(overlay'));
  assert.match(html, /class="done-check"/);
  assert.doesNotMatch(html, /\.span-row\.is-done \.span-name b \{/, '完了した行の名前の欄は、未完了の行と同じ見た目にする（打ち消し線・色の変更をしない）');
  assert.match(html, /\.work-card\.is-done \.task-issue-text strong \{ color: var\(--faint\); \}/);
  assert.doesNotMatch(html, /\.work-card\.is-done \.task-issue-text strong \{[^}]*text-decoration/);
  assert.match(html, /data-action="done"/);
  assert.doesNotMatch(html, /week-head-result/);
  assert.match(html, /span-name-status/);
  assert.match(html, /weekly-status' \+ statusToneClass\(status\)/);
  assert.match(html, /id="addPlan"[^>]*>予定を追加/);
  assert.match(html, /id="undoEdit"/);
  assert.match(html, /id="redoEdit"/);
  const sidebarStart = html.indexOf('<header class="sidebar">');
  const saveDockInSidebar = html.indexOf('<div class="save-dock" id="saveDock"');
  const sidebarEnd = html.indexOf('</header>', sidebarStart);
  assert.ok(sidebarStart >= 0 && saveDockInSidebar > sidebarStart && saveDockInSidebar < sidebarEnd);
  assert.match(html, /\.save-dock \{[\s\S]*flex: 0 0 auto;/);
  const saveDockCssStart = html.indexOf('.save-dock {');
  const saveDockCssEnd = html.indexOf('}', saveDockCssStart);
  assert.ok(saveDockCssStart >= 0 && !html.slice(saveDockCssStart, saveDockCssEnd).includes('position: fixed'));
  assert.match(html, /function undoEdit\(/);
  assert.match(html, /function redoEdit\(/);
  assert.match(html, /function captureEditHistorySnapshot\(/);
  assert.match(html, /function restoreEditHistorySnapshot\(/);
  assert.match(html, /historyUsesNativeUndo/);
  assert.match(html, /function focusPlannerRow\(/);
  assert.match(html, /\.span-row:focus-within/);
  assert.match(html, /is-focused/);
  assert.match(html, /\.span-row\.is-hover/);
  assert.doesNotMatch(html, /\.span-row:hover,\s*\.span-row:focus-within/);
  assert.match(html, /\.week-head-day\.is-today \.week-day-open small \{ color: var\(--blue\)/);
  assert.match(html, /\.week-head-day\.is-saturday \.week-day-open small \{ color: #4267a3; \}/);
  assert.match(html, /\.week-head-day\.is-sunday \.week-day-open small \{ color: var\(--danger\); \}/);
});

test('自動保存中は保存バーと画面上端に進行表示を出す', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  assert.match(html, /id="saveSpinner"/);
  assert.match(html, /\.save-spinner \{[\s\S]*animation: spin/);
  assert.match(html, /body\.is-autosaving \.sidebar::after \{[\s\S]*save-sweep/);
  assert.match(html, /\.plan-save\.is-saving #weekBoardHint::before/);
  assert.match(html, /state\.daily\.savingAuto \|\| state\.planner\.savingAuto/);
  assert.match(html, /dock\.classList\.toggle\('is-saving', saving\)/);
  assert.match(html, /document\.body\.classList\.toggle\('is-autosaving', saving\)/);
  assert.match(html, /planningSaving \? '自動保存中…'/);
});

test('カレンダー帯の実施時間は稼働重なりではなく予定の実時間を出す', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const roundStart = html.indexOf('function roundHours(value)');
  const hoursStart = html.indexOf('function hours(value)');
  const start = html.indexOf('function calendarEventTimeMinutes(');
  const end = html.indexOf('function calendarPlanName(');
  assert.ok(roundStart >= 0 && hoursStart > roundStart && start >= 0 && end > start);
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(roundStart, hoursStart) + html.slice(start, end), context);
  assert.equal(context.calendarEventHours({ startTime: '08:00', endTime: '09:00', meetingHours: 0, blocksTime: true }), 1);
  assert.equal(context.calendarEventHours({ startTime: '18:00', endTime: '19:30', meetingHours: 0 }), 1.5);
  assert.equal(context.calendarEventHours({ startTime: '13:00', endTime: '15:00', meetingHours: 0, blocksTime: false }), 2);
  assert.equal(context.calendarEventHours({ startTime: '22:00', endTime: '24:00' }), 2);
  assert.equal(context.calendarEventHours({ startTime: '22:00', endTime: '10:00' }), 12);
  assert.equal(context.calendarEventHours({ startTime: '10:00', endTime: '12:00', durationHours: 1.75 }), 1.75);
  assert.equal(context.calendarEventHours({ allDay: true, startTime: '00:00', endTime: '24:00', durationHours: 0 }), 0);
  assert.equal(context.calendarEventWorkOverlapHours({ startTime: '08:00', endTime: '09:00', meetingHours: 0, blocksTime: true }), 0);
});

test('日付の下は実績と稼働時間だけを出す', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const start = html.indexOf('function roundHours(value)');
  const hoursEnd = html.indexOf('function barLabel(');
  const fnStart = html.indexOf('function weekDayActualHours(');
  const fnEnd = html.indexOf('function plannerSubtasksForItem(');
  assert.ok(start >= 0 && hoursEnd > start && fnStart >= 0 && fnEnd > fnStart);
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(start, hoursEnd) + html.slice(fnStart, fnEnd), context);
  assert.equal(context.weekDayLoadLabel(6.5, 8), '実績 6.5h / 稼働 8h');
  assert.equal(context.weekDayLoadLabel(0, 0), '休み');
  assert.equal(context.weekDayLoadLabel(2, 0), '実績 2h / 稼働 0h');
  assert.equal(context.weekDayLoadHtml(6.5, 8), '<b>実績 6.5</b><span>/ 8h</span>');
  assert.equal(context.weekDayLoadHtml(0, 0), '<b>休み</b>');
  const rows = [
    { actualByDate: { '2026-08-24': 2.5 } },
    { actualByDate: { '2026-08-24': 1, '2026-08-25': 3 } },
    { hasPlan: false, actualByDate: { '2026-08-24': 0.5 } }
  ];
  assert.equal(context.weekDayActualHours('2026-08-24', rows, null), 4);
  // 編集中の実績画面があれば、その日の入力値を使う
  assert.equal(context.weekDayActualHours('2026-08-24', rows, { date: '2026-08-24', rows: [{ today: 1 }, { today: 0.75 }] }), 1.75);
  const header = html.slice(html.indexOf('const header ='), html.indexOf('const meetings ='));
  assert.match(header, /class="week-day-open"[\s\S]*class="capacity-edit/);
  assert.doesNotMatch(header, /空き|remainingByDate|leftover/);
  assert.match(html, /repeat\(' \+ dayCount \+ ',var\(--week-day-col,160px\)\)/);
});
test('週の帯は予定期間をバーにして実績だけを載せる', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const start = html.indexOf('function roundHours(value)');
  const end = html.indexOf('function planPaceStatus(');
  assert.ok(start >= 0 && end > start);
  const context = { workdayDefaultHours: () => 8 };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  assert.equal(context.weekSpanActualHtml(0, 'within'), '');
  assert.match(context.weekSpanActualHtml(2, 'within'), /class="span-actual" style="--actual-ratio:25%"><span class="span-bar-label">2h<\/span>/);
  assert.match(context.weekSpanActualHtml(1.5, 'before'), /span-actual is-early[\s\S]*前倒し/);
  assert.match(context.weekSpanActualHtml(1.5, 'after'), /span-actual is-late[\s\S]*超過/);
  assert.doesNotMatch(context.weekSpanActualHtml(2, 'within'), /span-plan|予定/);
  const render = html.slice(html.indexOf('function renderWeekCalendar('), html.indexOf('function renderForecastTimeline('));
  assert.match(render, /if \(!\(actual > 0\)\) return '';/, '実績のない日のセルは作らない（線と色は行の背景で描く）');
  assert.match(render, /timelinePeriodHtml\(\{ range: range, days: days/);
  assert.doesNotMatch(render, /allocation|weekCellPairHtml|span-plan"/);
  assert.match(html, /\.span-day-stack > \.span-actual\.is-early \{[^}]*var\(--warn\)/);
  assert.match(html, /\.span-day-stack > \.span-actual\.is-late \{[^}]*var\(--danger\)/);
  assert.doesNotMatch(html, /function computeForecastForItems\(|function weekPlanCarryStatus\(|planDialogDailyPlanList|planDialogDailyCap/);
});
function createTimelinePeriodContext() {
  const source = fs.readFileSync('ui/planning_view.js', 'utf8');
  const start = source.indexOf('    function timelinePeriodModel(');
  const end = source.indexOf('    function weekSpanFlagsHtml(', start);
  const context = {
    escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    shortDateLabel: value => value.slice(5).replace('-', '/'),
    planRangeLabel: range => range.start + '〜' + range.end,
    compactHours: value => String(value)
  };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  context.roundHours = value => Math.round((Number(value) || 0) * 4) / 4;
  vm.createContext(context);
  const core = fs.readFileSync('ui/core.js', 'utf8');
  const helperStart = core.indexOf('    function planCompletedRange(');
  vm.runInContext(core.slice(helperStart, core.indexOf('    function planVisibleInWeek(', helperStart)), context);
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test('完了した予定の帯は、終了日がまだ先なら最後の実績の日で止める', () => {
  const api = createTimelinePeriodContext();
  const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map(date => ({ date }));
  const range = { start: '2026-11-16', end: '2026-11-20' };
  const done = api.timelinePeriodHtml({ days, range, done: true, actualByDate: { '2026-11-17': 2 }, today: '2026-11-18', mode: 'month', planId: 'p1' });
  assert.match(done, /grid-column:2 \/ 4/);
  // ドラッグで期間を変えるときは、元の終了日を使う
  assert.match(done, /data-end="2026-11-20"/);
  const open = api.timelinePeriodHtml({ days, range, done: false, actualByDate: { '2026-11-17': 2 }, today: '2026-11-18', mode: 'month' });
  assert.match(open, /grid-column:2 \/ 7/);
  // 終了日を過ぎてから完了した予定は、元の期間のまま
  assert.equal(api.planCompletedRange(range, { '2026-11-17': 2 }, '2026-11-25'), range);
  // 実績のないまま完了した予定は開始日だけ
  assert.equal(api.planCompletedRange(range, {}, '2026-11-18').end, '2026-11-16');
});

test('期間バーは表示期間に切り詰め、年またぎの継続と1日予定の開始終了を保持する', () => {
  const api = createTimelinePeriodContext();
  const days = ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'].map(date => ({ date }));
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(api.timelinePeriodModel({ start: '2026-12-29', end: '2027-01-03' }, days)), {
    startColumn: 2, endColumn: 6, dayCount: 4, continuesBefore: true, continuesAfter: true
  });
  assert.deepEqual(plain(api.timelinePeriodModel({ start: '2026-12-31', end: '2026-12-31' }, days)), {
    startColumn: 3, endColumn: 4, dayCount: 1, continuesBefore: false, continuesAfter: false
  });
  assert.equal(api.timelinePeriodModel(null, days), null);
  assert.equal(api.timelinePeriodModel({ start: '2026-12-01', end: '2026-12-29' }, days), null);
  assert.equal(api.timelinePeriodModel({ start: '2027-01-03', end: '2027-01-04' }, days), null);
  assert.equal(api.timelinePeriodModel({ start: '2026-12-30', end: '2027-01-02' }, []), null);
});

test('期間未定や表示期間外の予定には架空の期間バーを描かない', () => {
  const api = createTimelinePeriodContext();
  const options = { days: [{ date: '2026-10-12' }, { date: '2026-10-13' }], mode: 'week' };
  const undated = api.timelinePeriodHtml(Object.assign({}, options, { range: null }));
  const overdue = api.timelinePeriodHtml(Object.assign({}, options, { range: { start: '2026-10-01', end: '2026-10-09' }, overdue: true }));
  assert.match(undated, /期間未定/);
  assert.match(overdue, /10\/09 終了予定 · 期限切れ/);
  assert.doesNotMatch(undated + overdue, /class="timeline-period(?: |")/);
});

test('期間バーは名前を安全に表示し、完了と期限切れを文字でも区別する', () => {
  const api = createTimelinePeriodContext();
  const options = { days: [{ date: '2026-10-12' }, { date: '2026-10-13' }], range: { start: '2026-10-12', end: '2026-10-13' }, name: '<img src=x>', mode: 'week' };
  const overdue = api.timelinePeriodHtml(Object.assign({}, options, { overdue: true }));
  const done = api.timelinePeriodHtml(Object.assign({}, options, { done: true, overdue: true }));
  assert.match(overdue, /timeline-period-state">期限切れ/);
  assert.match(done, /timeline-period-state">完了/);
  assert.doesNotMatch(done, /is-overdue/);
  assert.match(overdue, /&lt;img src=x&gt;/);
  assert.doesNotMatch(overdue, /<img/);
});

test('予定工数と累計実績は、長い帯でも見えるよう帯ではなく名前の欄に出す', () => {
  const api = createTimelinePeriodContext();
  const options = { days: [{ date: '2026-10-12' }, { date: '2026-10-13' }], range: { start: '2026-10-12', end: '2026-10-13' }, name: '調査', planned: 2.5, actual: 11.75, mode: 'week' };
  for (const range of [options.range, null]) {
    const html = api.timelinePeriodHtml(Object.assign({}, options, { range }));
    assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /予定 2\.5h|実績 11\.75h/);
  }
  const hours = api.planHoursHtml(2.5, 11.75);
  assert.match(hours.replace(/<[^>]*>/g, ''), /予定 2\.5h/);
  assert.match(hours.replace(/<[^>]*>/g, ''), /実績 11\.75h/);
  assert.match(hours, /plan-hours-actual is-over/); // 予定を超えた実績は色で示す。
});

function createPlanPeriodContext() {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const start = html.indexOf('function roundHours(value)');
  const end = html.indexOf('function childNameForDaily(');
  assert.ok(start >= 0 && end > start);
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  return context;
}

test('予定の期間は開始日〜終了日で、未入力の旧データは登録した週の月〜金とみなす', () => {
  const api = createPlanPeriodContext();
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(api.planDateRange({ startDate: '2026-08-25', endDate: '2026-09-02' })), { start: '2026-08-25', end: '2026-09-02', explicitEnd: true });
  assert.deepEqual(plain(api.planDateRange({ originWeek: '2026-W35' })), { start: '2026-08-24', end: '2026-08-28', explicitEnd: false });
  assert.deepEqual(plain(api.planDateRange({ originWeek: '2026-W35', startDate: '2026-08-26' })), { start: '2026-08-26', end: '2026-08-28', explicitEnd: false });
  // 土日に始めた予定は、その日だけとみなす
  assert.deepEqual(plain(api.planDateRange({ startDate: '2026-08-29' })), { start: '2026-08-29', end: '2026-08-29', explicitEnd: false });
  // 終了日が開始日より前なら開始日にそろえる
  assert.equal(api.planDateRange({ startDate: '2026-08-26', endDate: '2026-08-24' }).end, '2026-08-26');
  assert.equal(api.planDateRange({}, ''), null);
  assert.equal(api.planDateRange({}, '2026-W36').start, '2026-08-31');
  assert.equal(api.planRangeLabel({ start: '2026-08-24', end: '2026-09-02' }), '8/24〜9/2');
  assert.equal(api.planRangeLabel({ start: '2026-08-24', end: '2026-08-24' }), '8/24');
  const range = { start: '2026-08-25', end: '2026-08-27' };
  assert.equal(api.planDatePosition(range, '2026-08-24'), 'before');
  assert.equal(api.planDatePosition(range, '2026-08-26'), 'within');
  assert.equal(api.planDatePosition(range, '2026-08-28'), 'after');
});

test('週の画面には期間がかかる予定・その週に実績がある予定・期限切れの予定を出す', () => {
  const api = createPlanPeriodContext();
  const week = { startYmd: '2026-08-31', endExclusiveYmd: '2026-09-07' };
  const nextWeek = { startYmd: '2026-09-07', endExclusiveYmd: '2026-09-14' };
  const plan = extra => Object.assign({ hasPlan: true, originWeek: '2026-W35', actualByDate: {} }, extra);
  // 週をまたぐ予定は、終了日の週にも出る
  assert.equal(api.planVisibleInWeek(plan({ startDate: '2026-08-26', endDate: '2026-09-02' }), week, '2026-08-26', false), true);
  // 期間が先の週なら、その週までは出さない
  assert.equal(api.planVisibleInWeek(plan({ startDate: '2026-09-07', endDate: '2026-09-09' }), week, '2026-08-26', false), false);
  // 開始日より前に着手した実績があれば、その週にも出す（前倒し）
  assert.equal(api.planVisibleInWeek(plan({ startDate: '2026-09-07', endDate: '2026-09-09', actualByDate: { '2026-09-04': 1 } }), week, '2026-09-04', false), true);
  // 完了済みでも、期間がかかる週には出す
  assert.equal(api.planVisibleInWeek(plan({ startDate: '2026-08-31', endDate: '2026-09-01' }), week, '2026-09-02', true), true);
  // 終了日を過ぎて未完了なら、今週以降に「期限切れ」として残す
  const overdue = plan({ startDate: '2026-08-24', endDate: '2026-08-26' });
  assert.equal(api.planVisibleInWeek(overdue, week, '2026-09-01', false), true);
  assert.equal(api.planVisibleInWeek(overdue, nextWeek, '2026-09-01', false), true);
  assert.equal(api.planVisibleInWeek(overdue, week, '2026-09-01', true), false);
  // まだ期限前なら、先の週には出さない
  assert.equal(api.planVisibleInWeek(overdue, nextWeek, '2026-08-25', false), false);
  // 過ぎた週の画面には出さない
  assert.equal(api.planVisibleInWeek(overdue, week, '2026-09-10', false), false);
  // 終了日のない旧データは、以前の持ち越しと同じく実績がある予定だけ残す
  assert.equal(api.planVisibleInWeek(plan({}), week, '2026-09-01', false), false);
  assert.equal(api.planVisibleInWeek(plan({ actualByDate: { '2026-08-25': 2 } }), week, '2026-09-01', false), true);
  assert.equal(api.planVisibleInWeek({ hasPlan: false, actualByDate: { '2026-09-01': 1 } }, week, '2026-09-01', false), false);
});

test('前の週に登録した予定は、期間がかかる週・実績がある間・期限切れのあいだ今週に重ねる', () => {
  const api = createPlanPeriodContext();
  const week = { startYmd: '2026-08-31', endExclusiveYmd: '2026-09-07' };
  const base = extra => Object.assign({ id: 'plan-1', name: '設計', hasPlan: true, originWeek: '2026-W35', actualByDate: {} }, extra);
  assert.equal(api.planShouldContinue(base({ startDate: '2026-08-27', endDate: '2026-09-02', done: true }), [], week), true);
  assert.equal(api.planShouldContinue(base({ startDate: '2026-08-24', endDate: '2026-08-26' }), [], week), true);
  assert.equal(api.planShouldContinue(base({ startDate: '2026-08-24', endDate: '2026-08-26', done: true }), [], week), false);
  assert.equal(api.planShouldContinue(base({}), [], week), false);
  assert.equal(api.planShouldContinue(base({ actualByDate: { '2026-08-25': 1 } }), [], week), true);
  assert.equal(api.planShouldContinue(base({ calendarKey: 'cal', startDate: '2026-08-31', endDate: '2026-09-01' }), [], week), false);
});
test('前の週から引き継いだ予定は、繰り越し元が空でもこの週の新しい行として保存しない', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const start = html.indexOf('function collectPlanningPayload(');
  assert.ok(start >= 0);
  const end = html.indexOf('\n    function ', start + 10);
  const context = {
    roundHours: value => Math.round((Number(value) || 0) * 100) / 100,
    dailyPlanHoursTotal: () => 0,
    planCompletionForSave: () => ({ done: false, completionOverride: null }),
    restPlanNote: note => note || '',
    planBacklogIssue: () => false,
    normalizePlanDailyPlan: value => value || {},
    normalizePlanProgress: value => value || '',
    PLAN_PRIORITY_STEP: 1024,
    planPriorityValue: item => (item && item.priority != null ? Number(item.priority) : null)
  };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const payload = context.collectPlanningPayload({
    periodType: 'week',
    periodKey: '2026-W42',
    items: [
      { id: 'plan-native', name: '今週の予定', planned: 4, hasPlan: true, originWeek: '2026-W42' },
      { id: 'plan-new', name: '追加したばかり', planned: 2, hasPlan: true },
      { id: 'plan-server-carry', name: '前週から', planned: 22, hasPlan: true, originWeek: '2026-W40', carryWeek: '' },
      { id: 'plan-overlay-carry', name: '重ねた予定', planned: 20, hasPlan: true, originWeek: '2026-W41', carryWeek: '2026-W41' }
    ]
  });
  assert.deepEqual(Array.from(payload.plans, plan => plan.planId), ['plan-native', 'plan-new']);
});

test('サブタスクは親の予実ペアを動かさず各行のグラフを描画する', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  const start = html.indexOf('function roundHours(value)');
  const end = html.indexOf('function dayMarks(');
  assert.ok(start >= 0 && end > start);
  vm.runInContext(html.slice(start, end), context);
  context.escapeHtml = value => String(value || '');
  context.state = {
    planner: {
      expandedSubtasks: { 'plan-1': true },
      summary: {
        subtasks: [
          { id: 'sub-1', parentPlanId: 'plan-1', parentKey: 'API連携', title: '認証トークン更新を実装', plannedHours: 2.5, sortOrder: 0 },
          { id: 'sub-2', parentPlanId: 'plan-1', parentKey: 'API連携', title: 'エラーハンドリングを揃える', plannedHours: 4, sortOrder: 1 }
        ],
        dailyActualByPlanChild: { ['plan-1\u0000認証']: { '2026-08-25': 2 } },
        dailyActualByName: {}
      }
    }
  };
  const item = { id: 'plan-1', name: 'API連携' };
  const days = [{ date: '2026-08-24' }, { date: '2026-08-25' }];
  const tasks = context.plannerSubtasksForItem(item);
  assert.equal(tasks.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(context.plannerSubtaskActualByDate(item, tasks[0]))), { '2026-08-25': 2 });
  context.compactHours = value => Number(value).toFixed(2);
  context.hours = value => Number(value).toFixed(2);
  context.shortDateLabel = value => value;
  const lanes = context.renderPlannerSubtaskRows(item, days, '');
  assert.match(lanes, /span-subtask-lane/);
  assert.match(lanes, /span-subtask-actual/);
  assert.match(lanes, /実績 2\.00h/);
  assert.doesNotMatch(lanes, /span-plan/);
  assert.match(html, /\.span-day \{ display: flex; align-items: flex-start;/);
  assert.match(html, /span-day-stack/);
  assert.match(html, /function renderPlannerSubtaskRows\(/);
  assert.doesNotMatch(html, /function plannerSubtaskPlanByDate\(/);
});

test('予実の状態は進行中と完了を色分けする', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const start = html.indexOf('function roundHours(value)');
  const end = html.indexOf('function applyStatusCard');
  assert.ok(start >= 0 && end > start);
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  assert.equal(context.planActualStatus(8, 10, true).key, 'late');
  assert.equal(context.planActualStatus(8, 0, true).key, 'late');
  assert.equal(context.planActualStatus(0, 1.5, false).key, 'late');
  assert.equal(context.planActualStatus(8, 8, true).key, 'ontrack');
  assert.equal(context.planActualStatus(8, 3, true).key, 'late');
  assert.equal(context.planActualStatus(8, 10, true).label, '進行中');
  assert.equal(context.planActualStatus(8, 8, true).label, '進行中');
  assert.equal(context.planActualStatus(8, 6, true, 0.4).label, '進行中');
  assert.equal(context.planActualStatus(8, 3, true, 0.4).label, '進行中');
  assert.equal(context.planActualStatus(8, 10, true).paceLabel, '遅延');
  assert.equal(context.planActualStatus(8, 8, true).paceLabel, '順調');
  assert.equal(context.planActualStatus(8, 6, true, 0.4).paceLabel, '先行');
  assert.equal(context.planActualStatus(8, 3.25, true, 0.4).paceLabel, '先行');
  assert.equal(context.planActualStatus(8, 3.2, true, 0.4).paceLabel, '順調');
  assert.equal(context.planActualStatus(8, 3, true, 0.4).paceLabel, '遅延');
  assert.equal(context.planActualStatus(8, 8, true, 1, true).label, '完了');
  assert.equal(context.planActualStatus(8, 8, true, 1, true).key, 'done');
  assert.equal(context.planActualStatus(8, 8, true, 1, true).paceLabel, '順調');
  assert.equal(context.planActualStatus(8, 10, true, 1, true).paceLabel, '遅延');
  assert.equal(context.planActualStatus(8, 10, true, 1, true).paceTone, 'alert');
  assert.equal(context.planActualStatus(8, 4, true, 1, true).paceLabel, '先行');
  assert.equal(context.planActualStatus(8, 6, true, 0.4, true).paceLabel, '先行');
  assert.equal(context.statusToneClass(context.planActualStatus(8, 10, true, 1, true)).trim(), 'is-done is-alert');
  assert.equal(context.statusToneClass(context.planActualStatus(8, 4, true, 1, true)).trim(), 'is-done is-ahead');
  assert.equal(context.statusDetailTitle(context.planActualStatus(8, 10, true, 1, true)), '完了 · 遅延');
  assert.equal(context.statusDetailTitle(context.planActualStatus(8, 4, true, 1, true)), '完了 · 先行');
  assert.equal(context.statusRollup([
    { key: 'late' }, { key: 'ontrack' }, { key: 'ahead' }
  ]).overall.label, '進行中');
  assert.equal(context.statusRollup([
    { key: 'late' }, { key: 'ontrack' }, { key: 'ahead' }
  ]).overall.tone, 'alert');
  assert.equal(context.statusRollup([{ key: 'done' }, { key: 'done' }]).overall.label, '完了');
  const mixed = context.statusRollup([{ key: 'done' }, { key: 'late' }, { key: 'ontrack' }]);
  assert.equal(mixed.overall.label, '進行中');
  assert.equal(mixed.overall.tone, 'alert');
  assert.equal(mixed.meta, '進行中 2 · 完了 1');
  const doneLate = context.statusRollup([
    { key: 'done', done: true, paceKey: 'late' },
    { key: 'done', done: true, paceKey: 'ahead' }
  ]);
  assert.equal(doneLate.overall.label, '完了');
  assert.equal(doneLate.overall.tone, 'alert');

  assert.equal(context.dailyTaskStatus(1, 1, 8, false).label, '進行中');
  assert.equal(context.dailyTaskStatus(1, 1, 8, false).paceLabel, '順調');
  assert.equal(context.dailyTaskStatus(2, 7, 8, false).label, '進行中');
  assert.equal(context.dailyTaskStatus(2, 7, 8, false).paceLabel, '遅延');
  assert.equal(context.dailyTaskStatus(2, 6, 8, true).label, '完了');
  assert.equal(context.dailyTaskStatus(2, 6, 8, true).paceLabel, '順調');
  assert.equal(context.dailyTaskStatus(2, 5.75, 8, true).paceLabel, '先行');
  assert.equal(context.dailyTaskStatus(1, 2, 8, true).paceLabel, '先行');
  assert.equal(context.dailyTaskStatus(0, 0, 0, true).label, '完了');
  assert.equal(context.dailyTaskStatus(0, 0, 0, true).paceLabel, '順調');
  assert.equal(context.sharePaceArrow(context.dailyTaskStatus(1, 1, 8, false)), '');
  assert.equal(context.sharePaceArrow(context.dailyTaskStatus(2, 7, 8, false)), '↓');
  assert.equal(context.sharePaceArrow(context.dailyTaskStatus(2, 6, 8, true)), '');
  assert.equal(context.sharePaceArrow(context.dailyTaskStatus(1, 2, 8, true)), '↑');
  assert.equal(context.sharePaceArrow(context.planActualStatus(8, 3, true, 0.4)), '↓');
  assert.equal(context.sharePaceArrow(context.planActualStatus(8, 6, true, 0.4)), '↑');
  assert.equal(context.dailyShareLine({ today: 2, previous: 6, estimate: 8, status: '完了', name: '設計レビュー' }), '（2/6/8_設計レビュー）');
  assert.equal(context.dailyShareLine({ today: 2, previous: 7, estimate: 8, status: '', name: '障害対応' }), '（2/7/8↓_障害対応）');
  assert.equal(context.dailyShareLine({ today: 1, previous: 2, estimate: 8, status: '完了', name: '先行作業' }), '（1/2/8↑_先行作業）');
  assert.equal(context.dailyShareLine({ today: 1.25, previous: 5, estimate: 99, type: 'interrupt', name: '問い合わせ対応' }), '（1.25/0/1.25_問い合わせ対応）');
  assert.equal(context.dailyShareLine({ today: 1.13, previous: 5, estimate: 99, type: 'interrupt', name: '入力中の作業' }), '（1.13/0/1.13_入力中の作業）');
  assert.match(html, /function dailyShareLine\(/);
  assert.match(html, /today: numericHours\(el\.querySelector\('\.today-value'\)\.value\)/);
  assert.match(html, /const savedRows = normalizeDailyRowsForSave\(state\.daily\.rows\)/);
  assert.match(html, /!dailyHoursAreConfirmed\(\)/);
  assert.doesNotMatch(html, /snapHourField/);
  assert.match(html, /function sharePaceArrow\(/);
  assert.doesNotMatch(html, /■ 完了/);
});

test('期間未定の予定はバーを出さず、完了するまで登録した週以降の画面に出す', () => {
  const api = createPlanPeriodContext();
  const week = { startYmd: '2026-08-31', endExclusiveYmd: '2026-09-07' };
  const before = { startYmd: '2026-08-17', endExclusiveYmd: '2026-08-24' };
  const plan = extra => Object.assign({ hasPlan: true, undated: true, originWeek: '2026-W35', startDate: '', endDate: '', actualByDate: {} }, extra);
  assert.equal(api.planDateRange(plan({})), null);
  assert.equal(api.planVisibleInWeek(plan({}), week, '2026-09-01', false), true);
  assert.equal(api.planVisibleInWeek(plan({}), { startYmd: '2026-08-24', endExclusiveYmd: '2026-08-31' }, '2026-09-01', true), true);
  // 完了したら、登録した週と実績がある週だけ
  assert.equal(api.planVisibleInWeek(plan({}), week, '2026-09-01', true), false);
  assert.equal(api.planVisibleInWeek(plan({ actualByDate: { '2026-09-01': 1 } }), week, '2026-09-01', true), true);
  // 登録した週より前の画面には出さない
  assert.equal(api.planVisibleInWeek(plan({}), before, '2026-09-01', false), false);
  // 前の週から重ねるのも、完了するまで
  assert.equal(api.planShouldContinue(plan({ id: 'u1', name: '調査' }), [], week), true);
  assert.equal(api.planShouldContinue(plan({ id: 'u1', name: '調査', done: true }), [], week), false);
  // ずれの判定はしない（工数超過だけ見る）
  const status = api.planPeriodStatus(plan({ planned: 2, actual: 3, actualByDate: { '2026-08-20': 3 } }), null, '2026-09-01', false);
  assert.equal(status.deviation.earlyDate, '');
  assert.equal(status.deviation.overdue, false);
  assert.equal(status.paceLabel, '工数超過');
  // 前の週の予定を今週へ重ねても、期間未定のまま日付を入れない
  const carried = api.buildCarriedPlannerItem({ id: 'u1', name: '調査', planned: 2, undated: true }, '2026-08-31', '2026-W35');
  assert.equal(carried.undated, true);
  assert.equal(carried.startDate, '');
  assert.equal(carried.endDate, '');
});

test('予定ダイアログは日付を両方空にすると期間未定、片方だけなら保存しない', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const start = html.indexOf('function planDialogPeriodFromInputs(');
  const end = html.indexOf('function updatePlanDialogPeriodHint(');
  assert.ok(start >= 0 && end > start);
  const context = { isYmdText: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(context.planDialogPeriodFromInputs('', '')), { undated: true, startDate: '', endDate: '', error: '' });
  assert.deepEqual(plain(context.planDialogPeriodFromInputs('2026-08-26', '2026-09-02')), { undated: false, startDate: '2026-08-26', endDate: '2026-09-02', error: '' });
  assert.match(context.planDialogPeriodFromInputs('2026-08-26', '').error, /両方入れるか、両方空/);
  assert.match(context.planDialogPeriodFromInputs('', '2026-08-26').error, /両方入れるか、両方空/);
  assert.match(context.planDialogPeriodFromInputs('2026-08-26', '2026-08-24').error, /終了日は開始日以降/);
  // 「予定を追加」からは空で開き、日付の＋からは押した日〜金曜を入れて開く
  const open = html.slice(html.indexOf('function openPlanDialog('), html.indexOf('function applyPlanDialogProgress('));
  assert.match(open, /options\.date \? defaultPlanDialogRange\(options\.date\) : null/);
});

function createMonthGanttContext() {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const start = html.indexOf('function roundHours(value)');
  const end = html.indexOf('function childNameForDaily(');
  const monthStart = html.indexOf('const MONTH_FILTER_STORAGE_KEY');
  const monthEnd = html.indexOf('function monthDayClasses(');
  assert.ok(start >= 0 && end > start && monthStart >= 0 && monthEnd > monthStart);
  const context = {
    pad2: value => String(value).padStart(2, '0'),
    parseYmd: value => new Date(value + 'T12:00:00'),
    planIsComplete: item => !!(item && item.done),
    planProgressLabel: item => (item && item.progress === 'doing' ? '進行中' : '未着手'),
    localStorage: { getItem: () => null, setItem: () => {} }
  };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(start, end) + html.slice(monthStart, monthEnd), context);
  return context;
}

test('月のガントは週の画面と同じルールで予定を選び、プロジェクトごとにまとめて絞り込める', () => {
  const api = createMonthGanttContext();
  assert.deepEqual(JSON.parse(JSON.stringify(api.monthKeyRange('2026-12'))), { startYmd: '2026-12-01', endExclusiveYmd: '2027-01-01' });
  assert.equal(api.shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(api.monthKeyLabel('2026-10'), '2026年10月');
  const range = api.monthKeyRange('2026-10');
  assert.equal(api.monthGanttDays(range, '2026-10-14').length, 31);
  assert.equal(api.monthGanttDays(range, '2026-10-14')[13].today, true);
  const plan = extra => Object.assign({ hasPlan: true, originWeek: '2026-W41', actualByDate: {}, planned: 4, actual: 0 }, extra);
  const items = [
    plan({ id: 'a', name: '設計', projectId: 'p1', startDate: '2026-10-05', endDate: '2026-10-09' }),
    plan({ id: 'b', name: '実装', projectId: 'p2', startDate: '2026-10-12', endDate: '2026-10-23', done: true }),
    plan({ id: 'c', name: '調査', undated: true, startDate: '', endDate: '' }),
    plan({ id: 'd', name: '期限切れ', projectId: 'p1', startDate: '2026-09-21', endDate: '2026-09-25', originWeek: '2026-W39' }),
    plan({ id: 'e', name: '11月の予定', projectId: 'p2', startDate: '2026-11-02', endDate: '2026-11-06', originWeek: '2026-W45' }),
    plan({ id: 'f', name: '前倒し', projectId: 'p2', startDate: '2026-11-02', endDate: '2026-11-06', originWeek: '2026-W45', actualByDate: { '2026-10-30': 1 } })
  ];
  const rows = api.monthGanttRows(items, range, '2026-10-14', []);
  assert.deepEqual(Array.from(rows, row => row.id).sort(), ['a', 'b', 'c', 'd', 'f']);
  assert.equal(rows.find(row => row.id === 'b').statusLabel, '完了');
  const groups = api.monthGanttGroups(rows, [{ id: 'p2', name: '基盤' }, { id: 'p1', name: 'ポータル' }]);
  assert.deepEqual(Array.from(groups, group => group.name), ['基盤', 'ポータル', 'プロジェクト未設定']);
  assert.deepEqual(Array.from(groups[1].rows, row => row.id), ['d', 'a']);
  const filter = extra => Object.assign(api.defaultMonthFilter(), extra);
  const ids = matched => Array.from(rows.filter(row => api.monthRowMatchesFilter(row, matched)), row => row.id).sort();
  assert.deepEqual(ids(filter({ query: '設' })), ['a']);
  assert.deepEqual(ids(filter({ projectId: 'p2' })), ['b', 'f']);
  assert.deepEqual(ids(filter({ projectId: '__none' })), ['c']);
  assert.deepEqual(ids(filter({ status: 'done' })), ['b']);
  assert.deepEqual(ids(filter({ status: 'open' })), ['a', 'c', 'd', 'f']);
  // 終了日を過ぎて未完了（a・d）と、開始日より前に実績がある予定（f）
  assert.deepEqual(ids(filter({ deviationOnly: true })), ['a', 'd', 'f']);
  assert.equal(api.monthFilterIsActive(filter({})), false);
  assert.equal(api.monthFilterIsActive(filter({ query: ' ' })), false);
  assert.equal(api.monthFilterIsActive(filter({ status: 'open' })), true);
  // 予定を押したときに開く日
  assert.equal(api.monthPlanAnchorDate(rows.find(row => row.id === 'a'), range, '2026-10-14'), '2026-10-05');
  assert.equal(api.monthPlanAnchorDate(rows.find(row => row.id === 'f'), range, '2026-10-14'), '2026-10-30');
  assert.equal(api.monthPlanAnchorDate(rows.find(row => row.id === 'c'), range, '2026-10-14'), '2026-10-14');
  assert.equal(api.monthPlanAnchorDate(rows.find(row => row.id === 'd'), range, '2026-11-20'), '2026-10-01');
});

test('予定日からのずれを前倒し・期限超過・期限切れで示す', () => {
  const api = createPlanPeriodContext();
  const range = { start: '2026-08-26', end: '2026-08-28', explicitEnd: true };
  const item = { originWeek: '2026-W35', planned: 6, actual: 5, actualByDate: { '2026-08-24': 1, '2026-08-26': 2, '2026-08-31': 2 } };
  const deviation = api.planDeviation(item, range, '2026-09-01', false);
  assert.equal(deviation.earlyDate, '2026-08-24');
  assert.equal(deviation.lateDate, '2026-08-31');
  assert.equal(deviation.overdue, true);
  assert.equal(api.planDeviation(item, range, '2026-09-01', true).overdue, false);
  assert.equal(api.planDeviation(item, range, '2026-08-27', false).overdue, false);
  // 終了日のない旧データは、登録した週より前の同名の実績を前倒しに数えない
  const legacy = api.planDeviation(
    { originWeek: '2026-W35', actualByDate: { '2026-08-20': 3, '2026-08-25': 1 } },
    { start: '2026-08-26', end: '2026-08-28', explicitEnd: false },
    '2026-08-27',
    false
  );
  assert.equal(legacy.earlyDate, '2026-08-25');

  const overdue = api.planPeriodStatus(item, range, '2026-09-01', false);
  assert.equal(overdue.label, '進行中');
  assert.equal(overdue.paceLabel, '期限切れ');
  assert.equal(overdue.paceTone, 'alert');
  const late = api.planPeriodStatus(item, range, '2026-09-01', true);
  assert.equal(late.key, 'done');
  assert.equal(late.paceLabel, '期限超過');
  const over = api.planPeriodStatus({ planned: 4, actual: 5, actualByDate: { '2026-08-26': 5 } }, range, '2026-08-27', false);
  assert.equal(over.over, true);
  assert.equal(over.paceLabel, '工数超過');
  // 前倒しだけなら注意にはしない（バッジで見せる）
  const early = api.planPeriodStatus({ planned: 4, actual: 2, actualByDate: { '2026-08-24': 2 } }, range, '2026-08-27', false);
  assert.equal(early.paceTone, 'ok');
  assert.equal(early.deviation.earlyDate, '2026-08-24');
  assert.equal(api.statusDetailTitle(overdue), '進行中 · 期限切れ');
  assert.equal(api.statusRollup([overdue, early]).overall.tone, 'alert');
});
test('繰り越し予定は前週の設定と追加予定の種別を引き継ぐ', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const budget = fs.readFileSync('gas/budget.gs', 'utf8');
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  const start = html.indexOf('function roundHours(value)');
  const end = html.indexOf('function dailyRowNameLocked');
  assert.ok(start >= 0 && end > start);
  vm.runInContext(html.slice(start, end), context);

  const carried = context.buildCarriedPlannerItem(
    {
      id: 'plan-src',
      name: 'オンボーディング資料',
      planned: 8,
      actual: 3,
      actualByDate: { '2026-08-28': 3 },
      estimatedTotal: 8,
      initialPlanned: 8,
      note: '採用向け',
      dailyCap: 1.5,
      startDate: '2026-08-24'
    },
    '2026-08-31',
    '2026-W35'
  );
  assert.deepEqual(JSON.parse(JSON.stringify(carried)), {
    id: 'plan-src',
    name: 'オンボーディング資料',
    planned: 8,
    actual: 3,
    actualByDate: { '2026-08-28': 3 },
    estimatedTotal: 8,
    hasPlan: true,
    planKind: 'initial',
    initialPlanned: 8,
    createdAt: '',
    priority: null,
    note: '採用向け',
    startDate: '2026-08-24',
    endDate: '',
    undated: false,
    dailyCap: 1.5,
    dailyPlan: {},
    carryWeek: '2026-W35',
    originWeek: '2026-W35',
    calendarKey: '',
    done: false,
    completionOverride: null
  });
  assert.deepEqual(JSON.parse(JSON.stringify(context.buildCarriedPlannerItem(
    {
      name: 'オンボーディング資料',
      planned: 8,
      estimatedTotal: 8,
      dailyPlan: { '2026-08-28': 1, '2026-08-31': 1.5, '2026-09-01': 2 }
    },
    '2026-08-31',
    '2026-W35'
  ).dailyPlan)), { '2026-08-28': 1, '2026-08-31': 1.5, '2026-09-01': 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.buildCarriedPlannerItem(
    {
      name: 'オンボーディング資料',
      planned: 8,
      estimatedTotal: 8,
      dailyPlan: { '2026-08-28': 1, '2026-08-31': 1.5, '2026-09-01': 2 }
    },
    '2026-08-31',
    '2026-W35'
  ).dailyPlan)), { '2026-08-28': 1, '2026-08-31': 1.5, '2026-09-01': 2 });
  assert.match(budget, /plan\.planKind === "added" \? "added"/);
  assert.match(html, /function reconcileWeekContinuations\(/);
  assert.match(html, /planId: item\.id/);
  assert.match(html, /startDate: item\.startDate/);
  assert.match(html, /carryWeek: ''/);
  assert.match(html, /dailyPlan: normalizePlanDailyPlan\(item\.dailyPlan\)/);
});

test('未完了の予定は次週に残り完了したら消える', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  const start = html.indexOf('function roundHours(value)');
  const end = html.indexOf('function dailyRowNameLocked');
  vm.runInContext(html.slice(start, end), context);
  let seq = 0;
  const ids = {
    newId() { return 'plan-' + (++seq); },
    newSubId() { return 'sub-' + (++seq); }
  };
  const source = {
    id: 'plan-src',
    name: '設計レビュー',
    planned: 8,
    actual: 3,
    actualByDate: { '2026-08-28': 3 },
    estimatedTotal: 8,
    initialPlanned: 8,
    hasPlan: true,
    startDate: '2026-08-24',
    dailyPlan: { '2026-08-28': 3, '2026-08-31': 2 }
  };
  const added = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [source],
    sourceSubtasks: [
      { parentPlanId: 'plan-src', parentKey: '設計レビュー', title: '指摘反映', status: 'todo', plannedHours: 2 },
      { parentPlanId: 'plan-src', parentKey: '設計レビュー', title: '時間を使い切った作業', status: 'todo', plannedHours: 3, prevB: 3 },
      { parentPlanId: 'plan-src', parentKey: '設計レビュー', title: '完了にした作業', status: 'done', plannedHours: 1, prevB: 1 }
    ],
    targetItems: [],
    targetSubtasks: [],
    targetStart: '2026-08-31',
    targetRange: { startYmd: '2026-08-31', endExclusiveYmd: '2026-09-07' }
  }, ids));
  assert.equal(added.added, 1);
  assert.equal(added.items[0].name, '設計レビュー');
  const untouched = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [Object.assign({}, source, { id: 'plan-empty', name: '未着手の予定', actual: 0, actualByDate: {} })],
    sourceSubtasks: [],
    targetItems: [],
    targetSubtasks: [],
    targetStart: '2026-08-31'
  }, ids));
  assert.equal(untouched.added, 0);
  assert.equal(untouched.items.length, 0);
  const checked = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [Object.assign({}, source, { id: 'plan-checked', name: '完了チェック済み', done: false, actual: 5, actualByDate: { '2026-08-28': 5 } })],
    sourceSubtasks: [
      { parentPlanId: 'plan-checked', parentKey: '完了チェック済み', title: '調査', status: 'done', plannedHours: 2, prevB: 2 },
      { parentPlanId: 'plan-checked', parentKey: '完了チェック済み', title: '実装', status: '完了', plannedHours: 3, prevB: 3 }
    ],
    targetItems: [],
    targetSubtasks: [],
    targetStart: '2026-08-31'
  }, ids));
  assert.equal(checked.added, 0);
  assert.equal(checked.items.length, 0);
  assert.equal(added.items[0].id, 'plan-src');
  assert.equal(added.items[0].planned, 8);
  assert.equal(added.items[0].actual, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(added.items[0].actualByDate)), { '2026-08-28': 3 });
  assert.equal(added.items[0].carryWeek, '2026-W35');
  assert.equal(added.items[0].originWeek, '2026-W35');
  assert.equal(added.items[0].startDate, '2026-08-24');
  assert.equal(added.items[0].done, false);
  assert.deepEqual(JSON.parse(JSON.stringify(added.items[0].dailyPlan)), { '2026-08-28': 3, '2026-08-31': 2 });
  assert.equal(added.subtasks.length, 3);
  assert.deepEqual(added.subtasks.map(task => task.title), ['指摘反映', '時間を使い切った作業', '完了にした作業']);

  assert.equal(context.planningTaskBelongsToPlan(
    { parentPlanId: 'plan-src', parentKey: '設計レビュー', title: '指摘反映' },
    { id: 'plan-copy', name: '設計レビュー', carryWeek: '2026-W35' }
  ), true);
  assert.equal(context.planningTaskBelongsToPlan(
    { parentPlanId: 'plan-src', parentKey: '設計レビュー', title: '指摘反映' },
    { id: 'plan-own', name: '設計レビュー', carryWeek: '' }
  ), false);

  const spent = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [Object.assign({}, source, { actual: 8, actualByDate: { '2026-08-28': 8 } })],
    targetItems: [],
    targetSubtasks: [],
    targetStart: '2026-08-31'
  }, ids));
  assert.equal(spent.items.length, 1);
  assert.equal(spent.items[0].actual, 8);

  const synced = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [source],
    targetItems: [{
      id: 'plan-src',
      name: '設計レビュー',
      planned: 5,
      actual: 1,
      actualByDate: { '2026-08-31': 1 },
      hasPlan: true,
      carryWeek: '2026-W35'
    }],
    targetSubtasks: [],
    targetStart: '2026-08-31',
    targetRange: { startYmd: '2026-08-31', endExclusiveYmd: '2026-09-07' }
  }, ids));
  assert.equal(synced.updated, 1);
  assert.equal(synced.items[0].planned, 8);
  assert.equal(synced.items[0].actual, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(synced.items[0].actualByDate)), { '2026-08-28': 3, '2026-08-31': 1 });

  const renamed = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [Object.assign({}, source, { name: '新しい設計レビュー' })],
    targetItems: [{
      id: 'plan-src',
      name: '設計レビュー',
      planned: 5,
      actual: 1,
      hasPlan: true,
      carryWeek: '2026-W35'
    }],
    targetSubtasks: [],
    targetStart: '2026-08-31',
    targetRange: { startYmd: '2026-08-31', endExclusiveYmd: '2026-09-07' }
  }, ids));
  assert.equal(renamed.updated, 1);
  assert.equal(renamed.items[0].name, '新しい設計レビュー');

  context.state = { planner: { dirty: true } };
  const locallyCompleted = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [Object.assign({}, source, { done: false })],
    targetItems: [{
      id: 'plan-src',
      name: '設計レビュー',
      planned: 5,
      actual: 1,
      actualByDate: { '2026-08-31': 1 },
      hasPlan: true,
      carryWeek: '2026-W35',
      originWeek: '2026-W35',
      done: true
    }],
    targetSubtasks: [],
    targetStart: '2026-08-31',
    targetRange: { startYmd: '2026-08-31', endExclusiveYmd: '2026-09-07' },
    targetKey: '2026-W36'
  }, ids));
  assert.equal(locallyCompleted.updated, 1);
  assert.equal(locallyCompleted.items[0].done, true);
  delete context.state;

  const undated = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [Object.assign({}, source, { actual: 8, actualByDate: {} })],
    targetItems: [{
      id: 'plan-src',
      name: '設計レビュー',
      planned: 5,
      actual: 1,
      actualByDate: { '2026-08-31': 1 },
      hasPlan: true
    }],
    targetSubtasks: [],
    targetStart: '2026-08-31',
    targetRange: { startYmd: '2026-08-31', endExclusiveYmd: '2026-09-07' }
  }, ids));
  assert.equal(undated.items[0].actual, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(undated.items[0].actualByDate)), { '2026-08-31': 1 });

  const chained = context.enrichContinuationSources(
    [{ name: '設計レビュー', planned: 8, actual: 1, actualByDate: { '2026-08-31': 1 }, carryWeek: '2026-W34' }],
    { '2026-W34': [{ name: '設計レビュー', actual: 3, actualByDate: { '2026-08-28': 3 }, startDate: '2026-08-24' }] }
  );
  assert.equal(chained[0].actual, 4);
  assert.equal(chained[0].startDate, '2026-08-24');
  assert.deepEqual(JSON.parse(JSON.stringify(chained[0].actualByDate)), { '2026-08-28': 3, '2026-08-31': 1 });

  const completed = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [Object.assign({}, source, { done: true })],
    targetItems: added.items,
    targetSubtasks: added.subtasks,
    targetStart: '2026-08-31'
  }, ids));
  assert.equal(completed.removed, 1);
  assert.equal(completed.items.length, 0);
  assert.equal(completed.subtasks.length, 0);

  const completedBySummary = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [Object.assign({}, source, { complete: true })],
    targetItems: added.items,
    targetSubtasks: added.subtasks,
    targetStart: '2026-08-31'
  }, ids));
  assert.equal(completedBySummary.removed, 1);
  assert.equal(completedBySummary.items.length, 0);
  assert.equal(completedBySummary.subtasks.length, 0);

  const linked = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [source],
    targetItems: [{
      id: 'plan-own',
      name: '設計レビュー',
      planned: 4,
      actual: 1,
      actualByDate: { '2026-08-31': 1 },
      hasPlan: true,
      carryWeek: ''
    }],
    targetSubtasks: [],
    targetStart: '2026-08-31',
    targetRange: { startYmd: '2026-08-31', endExclusiveYmd: '2026-09-07' },
    targetKey: '2026-W36'
  }, ids));
  assert.equal(linked.items.length, 2);
  const linkedOwn = linked.items.find(item => item.id === 'plan-own');
  const linkedSrc = linked.items.find(item => item.id === 'plan-src');
  assert.ok(linkedOwn);
  assert.ok(linkedSrc);
  assert.equal(linked.added, 1);
  assert.equal(linkedOwn.planned, 4);
  assert.equal(linkedOwn.actual, 1);
  assert.equal(linkedSrc.planned, 8);
  assert.equal(linkedSrc.actual, 3);
  assert.equal(linkedSrc.originWeek, '2026-W35');
  assert.equal(linkedSrc.carryWeek, '2026-W35');

  const independent = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [Object.assign({}, source, { done: true })],
    targetItems: [{ id: 'plan-own', name: '設計レビュー', planned: 4, hasPlan: true, carryWeek: '' }],
    targetSubtasks: [],
    targetStart: '2026-08-31'
  }, ids));
  assert.equal(independent.removed, 0);
  assert.equal(independent.items.length, 1);
  assert.equal(independent.items[0].id, 'plan-own');

  const calendar = context.reconcileWeekContinuations(Object.assign({
    sourceKey: '2026-W35',
    sourceItems: [Object.assign({}, source, { calendarKey: 'evt-1' })],
    targetItems: [],
    targetSubtasks: [],
    targetStart: '2026-08-31'
  }, ids));
  assert.equal(calendar.added, 0);
  assert.equal(calendar.items.length, 0);
});

test('完了した前週予定の繰り越し残りを次週から除去する', async () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  const start = html.indexOf('function roundHours(value)');
  const end = html.indexOf('function importMonthlyPlansToWeek');
  assert.ok(start >= 0 && end > start);
  vm.runInContext(html.slice(start, end), context);
  vm.runInContext(fs.readFileSync('ui/legacy.js', 'utf8'), context);
  context.state = { calendarCache: {} };
  context.state.calendarCache['weekWorkspace:2026-W34'] = {
    rows: [{
      periodKey: '2026-W34',
      planId: 'legacy-1abc',
      aggregationKey: '完了予定',
      plannedHours: 8,
      actualHours: 8,
      hasPlan: true,
      done: false,
      complete: true,
      carryWeek: ''
    }],
    subtasks: []
  };
  const future = await context.overlayOriginContinuations('2099-W02', [], [], {
    startYmd: '2099-01-05',
    endExclusiveYmd: '2099-01-12'
  });
  assert.equal(future.items.length, 0);
  context.state.calendarCache['weekWorkspace:' + context.previousWeekKey('2099-W02')] = {
    rows: [{
      periodKey: context.previousWeekKey('2099-W02'),
      planId: 'plan-open',
      aggregationKey: '未完了の予定',
      plannedHours: 8,
      actualHours: 3,
      hasPlan: true,
      done: false,
      carryWeek: ''
    }],
    subtasks: []
  };
  const carriedForward = await context.overlayOriginContinuations('2099-W02', [], [], {
    startYmd: '2099-01-05',
    endExclusiveYmd: '2099-01-12'
  });
  assert.equal(carriedForward.items.length, 1);
  assert.equal(carriedForward.items[0].name, '未完了の予定');
  assert.equal(carriedForward.items[0].done, false);

  const merged = await context.overlayOriginContinuations('2026-W35', [{
    id: 'legacy-1abc',
    name: '完了予定',
    planned: 8,
    actual: 8,
    hasPlan: true,
    carryWeek: '',
    originWeek: '2026-W34'
  }], [], { startYmd: '2026-08-31', endExclusiveYmd: '2026-09-07' });
  assert.equal(merged.items.length, 0);
});

test('期間タイトルは Google 風の短い日付になる', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const parseStart = html.indexOf('function parseYmd(value)');
  const parseEnd = html.indexOf('function showBusy');
  const start = html.indexOf('function lastDate(range)');
  const end = html.indexOf('function renderPlanningStorage');
  assert.ok(parseStart >= 0 && parseEnd > parseStart && start >= 0 && end > start);
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(parseStart, parseEnd) + html.slice(start, end), context);
  const yearPrefix = new Date().getFullYear() === 2026 ? '' : '2026年';
  assert.equal(context.compactRangeLabel({ startYmd: '2026-08-24', endExclusiveYmd: '2026-08-31' }), yearPrefix + '8月24日 – 30日');
  assert.equal(context.compactDateLabel(new Date(2026, 7, 26)), yearPrefix + '8月26日');
  assert.equal(context.compactRangeLabel({ startYmd: '2026-08-31', endExclusiveYmd: '2026-09-07' }), yearPrefix + '8月31日 – 9月6日');
});

test('読み込むカレンダーIDは空ならメイン、重複は除く', () => {
  const api = createContext();
  assert.deepEqual(Array.from(api.normalizeSelectedPlanningCalendarIds([])), ['primary']);
  assert.deepEqual(Array.from(api.normalizeSelectedPlanningCalendarIds(['', null])), ['primary']);
  assert.deepEqual(Array.from(api.normalizeSelectedPlanningCalendarIds(['team@example.com', 'team@example.com', 'primary'])), ['team@example.com', 'primary']);
});

test('メインカレンダーは primary と実IDのどちらでも選択扱いする', () => {
  const api = createContext();
  const primary = { id: 'user@example.com', name: '仕事', primary: true };
  const team = { id: 'team@example.com', name: '開発チーム', primary: false };
  assert.equal(api.calendarIdIsSelected(['primary'], primary), true);
  assert.equal(api.calendarIdIsSelected(['user@example.com'], primary), true);
  assert.equal(api.calendarIdIsSelected(['primary'], team), false);
  assert.equal(api.calendarIdIsSelected(['team@example.com'], team), true);
});

test('短いカレンダー予定は実時間のまま0.25h単位にまとめる', () => {
  const api = createContext();
  assert.equal(api.mergeCalendarMeetingHours([
    { startTime: '10:00', endTime: '10:10', blocksTime: true, meetingHours: 0.25 },
    { startTime: '10:15', endTime: '10:25', blocksTime: true, meetingHours: 0.25 }
  ]), 0.25);
  assert.equal(api.mergeCalendarMeetingHours([
    { startTime: '17:50', endTime: '18:05', blocksTime: true, meetingHours: 0.25 }
  ]), 0.25);
});

test('カレンダー予定キーはメイン以外だけ calendarId を付ける', () => {
  const api = createContext();
  const primary = { id: 'meet-1', calendarId: 'primary', title: '週次定例', startTime: '10:00' };
  const unnamed = { id: 'meet-1', title: '週次定例', startTime: '10:00' };
  const team = { id: 'meet-1', calendarId: 'team@example.com', title: '週次定例', startTime: '10:00' };
  assert.equal(api.calendarEventKey(primary, '2026-08-24', 0), 'meet-1:2026-08-24:10:00:0');
  assert.equal(api.calendarEventKey(unnamed, '2026-08-24', 0), 'meet-1:2026-08-24:10:00:0');
  assert.equal(api.calendarEventKey(team, '2026-08-24', 0), 'team@example.com:meet-1:2026-08-24:10:00:0');
});

test('週の会議時間は除外以外の稼働重なりを合計する', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const roundStart = html.indexOf('function roundHours(value)');
  const hoursStart = html.indexOf('function hours(value)');
  const start = html.indexOf('function uniqueKeys(values)');
  const end = html.indexOf('function plannerCapacityDays(');
  assert.ok(roundStart >= 0 && hoursStart > roundStart && start >= 0 && end > start);
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(roundStart, hoursStart) + html.slice(start, end), context);
  const days = [
    {
      date: '2026-08-24',
      baseHours: 8,
      events: [
        { id: 'a', title: '定例', startTime: '10:00', endTime: '11:30', blocksTime: true },
        { id: 'b', title: '任意', startTime: '15:00', endTime: '16:00', blocksTime: true }
      ]
    },
    {
      date: '2026-08-25',
      baseHours: 8,
      events: [
        { id: 'c', title: 'レビュー', startTime: '11:00', endTime: '12:00', blocksTime: true }
      ]
    }
  ];
  const skip = context.calendarEventKey(days[0].events[1], '2026-08-24', 1);
  const summary = context.weekMeetingSummary(days, [skip]);
  assert.equal(summary.hours, 2.5);
  assert.equal(summary.count, 2);
  assert.equal(context.meetingHoursOnDay(days[0], [skip]), 1.5);
  assert.equal(context.mergeCalendarMeetingHours([
    { startTime: '10:00', endTime: '10:10', blocksTime: true, meetingHours: 0.25 },
    { startTime: '10:15', endTime: '10:25', blocksTime: true, meetingHours: 0.25 }
  ]), 0.25);
  assert.doesNotMatch(html, /id="meetingHours"/);
  assert.match(html, /week-meet-label" title="[^"]*">カレンダー/);
  assert.match(html, /week-meet-label" title="[^"]*">今日だけ/);
  assert.match(html, /const classes = \['calendar-entry', 'is-interrupt'/);
  assert.match(html, /entry\.calendarOrigin \? 'is-calendar-interrupt' : ''/);
  assert.match(html, /\.calendar-entry\.is-event\.is-calendar-variance \{[\s\S]*border: 2px dashed var\(--meet-line\); background: transparent/);
  assert.match(html, /calendarVarianceKeys\[entry\.calendarKey\] = true/);
  assert.doesNotMatch(html, /\.calendar-entry\.is-interrupt\.is-calendar-interrupt \{[\s\S]*border: 2px dashed/);
  assert.match(html, /\.work-card\.is-calendar-interrupt td \{ border-bottom-style: solid; \}/);
  assert.doesNotMatch(html, /\.work-card\.is-calendar-interrupt \{ border-bottom-style:/);
  assert.match(html, /function interruptEntriesByDate\(/);
  assert.match(html, /calendarInterruptsByDate/);
  assert.match(html, /function plannerSubtasksForItem\(/);
  assert.match(html, /class="span-subtasks-toggle"/);
  assert.match(html, /\.span-subtask-lane\.is-visible \{ display: grid; \}/);
  assert.match(html, /class="span-subtask-check/);
  assert.match(html, /subtaskPanel \|\| '<span class="span-subtasks-spacer"/);
  assert.match(html, /サブタスク合計/);
  assert.match(html, /const planRows = \(model\.rows \|\| \[\]\)\.filter\(function\(row\) \{ return row\.visible; \}\)/);
  assert.doesNotMatch(html, /week-meet-hours/);
  const edited = context.applyWorkCapacityToDay({
    date: '2026-08-24',
    baseHours: 8,
    meetingHours: 2.5,
    availableHours: 5.5,
    events: days[0].events
  }, 4, '時短');
  assert.equal(edited.baseHours, 4);
  assert.equal(edited.meetingHours, 2.5);
  assert.equal(edited.availableHours, 1.5);
  assert.equal(edited.capacityReason, '時短');
  assert.equal(edited.capacityOverridden, true);
  assert.match(html, /applyWorkCapacitySetting\(/);
  const capacityStart = html.indexOf('async function commitCapacityDialog(');
  const capacityEnd = html.indexOf('function markPlannerChanged(', capacityStart);
  assert.ok(capacityStart >= 0 && capacityEnd > capacityStart);
  const capacityCommit = html.slice(capacityStart, capacityEnd);
  assert.match(capacityCommit, /applyWorkCapacitySetting\(/);
  assert.doesNotMatch(capacityCommit, /loadPlannerCapacity\(/);
});

test('除外と取り込み済みのカレンダー予定は稼働時間から外す', () => {
  const api = createContext();
  const event = { id: 'meet-1', title: '週次定例', startTime: '10:00', endTime: '12:00', blocksTime: true, meetingHours: 2 };
  const optional = { id: 'opt-1', title: '任意参加', startTime: '15:00', endTime: '16:00', blocksTime: true, meetingHours: 1 };
  const days = [{
    date: '2026-08-24',
    baseHours: 8,
    meetingHours: 3,
    availableHours: 5,
    events: [event, optional]
  }];
  const excludedKey = api.calendarEventKey(optional, '2026-08-24', 1);
  const importedKey = api.calendarEventKey(event, '2026-08-24', 0);
  const adjusted = api.adjustCapacityDaysForCalendarPlans(days, [excludedKey], [importedKey]);
  assert.equal(adjusted[0].meetingHours, 0);
  assert.equal(adjusted[0].availableHours, 8);
});

test('予定と実績から残工数を算出する', () => {
  const api = createContext();
  const result = api.calculateBudgetSummary('week', '2026-W34', [
    { periodType: 'week', periodKey: '2026-W34', aggregationKey: '実装', plannedHours: 8, estimatedTotalHours: 12, priority: 0 }
  ], [['2026/08/20', '実装', 5]], 'Asia/Tokyo');
  assert.equal(result.rows[0].estimatedTotalHours, 8);
  assert.equal(result.rows[0].remainingHours, 3);
  const html = fs.readFileSync('gas/index.html', 'utf8');
  assert.doesNotMatch(html, /着地見込/);
  assert.doesNotMatch(html, /id="planDialogEstimate"/);
});

function createDailyAgendaContext() {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const roundStart = html.indexOf('function roundHours(value)');
  const childStart = html.indexOf('function childNameForDaily(');
  const rowsStart = html.indexOf('function weekPlanRows(');
  const rowsEnd = html.indexOf('function calculateWeekPlanModel(');
  assert.ok(roundStart >= 0 && childStart > roundStart);
  assert.ok(rowsStart >= 0 && rowsEnd > rowsStart);
  const context = { planIsComplete: item => !!(item && item.done) };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(roundStart, childStart) + html.slice(rowsStart, rowsEnd), context);
  return context;
}

test('日次の稼働消化は稼働時間に対する実績で、予定は期間に入る日だけ並べる', () => {
  const api = createDailyAgendaContext();
  const rows = api.weekPlanRows([
    { id: 'p1', name: 'API連携', planned: 4, actual: 0, hasPlan: true, startDate: '2026-08-24', endDate: '2026-08-25', actualByDate: {} },
    { id: 'p2', name: '権限まわり改修', planned: 4, actual: 0, hasPlan: true, startDate: '2026-08-26', endDate: '2026-08-28', actualByDate: {} },
    { id: 'p3', name: '突発対応', planned: 0, actual: 1, hasPlan: false, actualByDate: { '2026-08-24': 1 } }
  ], { range: { startYmd: '2026-08-24', endExclusiveYmd: '2026-08-31' }, today: '2026-08-24', weekKey: '2026-W35' });
  assert.equal(rows[0].allocations, undefined);
  assert.equal(rows[0].visible, true);
  assert.equal(rows[2].visible, false);
  assert.equal(rows[1].startDate, '2026-08-26');

  const model = api.buildDayAgendaModel('2026-08-24', rows, [
    { name: 'API連携 認証', today: 1.5, estimate: 20 },
    { name: '権限まわり改修 調査', today: 3, estimate: 20 },
    { name: '突発対応', today: 1, estimate: 8 }
  ], { date: '2026-08-24', baseHours: 8, meetingHours: 0 }, ['API連携', '権限まわり改修']);
  assert.equal(model.workdayHours, 8);
  assert.equal(model.actualHours, 5.5);
  assert.equal(model.allocatedHours, undefined);
  assert.equal(model.rows.find(row => row.name === 'API連携').inPeriod, true);
  assert.equal(model.rows.find(row => row.name === 'API連携').actual, 1.5);
  // 開始日より前の実績は、期間外（前倒し）として並べる
  assert.equal(model.rows.find(row => row.name === '権限まわり改修').inPeriod, false);
  assert.equal(model.rows.find(row => row.name === '権限まわり改修').position, 'before');
  assert.equal(model.rows.find(row => row.name === '突発対応').unplanned, true);

  const wednesday = api.buildDayAgendaModel('2026-08-26', rows, [], { date: '2026-08-26', baseHours: 8, meetingHours: 0 }, ['API連携', '権限まわり改修']);
  assert.deepEqual(Array.from(wednesday.rows, row => row.name), ['権限まわり改修']);
  assert.equal(api.dailyProgressRate(6, 8), 75);
  assert.equal(api.dailyProgressRate(2, 0), null);
  assert.equal(api.planIdentityName('前週繰越 設計レビュー'), '設計レビュー');
  assert.equal(api.parentKeyForDailyName('前週繰越 設計レビュー 仕上げ', ['設計レビュー']), '設計レビュー');
  assert.equal(api.dailyRowOrigin({ type: 'new', previous: 0 }), 'new');
  assert.equal(api.dailyRowOrigin({ type: 'saved', previous: 0 }), 'new');
  assert.equal(api.dailyRowOrigin({ type: 'ongoing', previous: 0 }), 'resume');
  assert.equal(api.dailyRowOrigin({ type: 'saved', previous: 2 }), 'resume');
  assert.equal(api.dailyRowOrigin({ type: 'new', previous: 0, name: 'API連携 認証' }, ['API連携 認証']), 'resume');
  assert.equal(api.dailyRowOrigin({ type: 'new', previous: 0, name: 'API連携 認証' }, ['API連携']), 'new');
  assert.equal(api.findPriorDailyTask('API連携 認証', [
    { title: 'API連携 認証', hours: 2, prevB: 1.5, prevC: 8 }
  ]).previous, 3.5);
  assert.equal(api.findPriorDailyTask('API連携 調査', ['API連携 調査']).previous, 0);
  assert.equal(api.findPriorDailyTask('API連携 調査', ['API連携']), null);
  assert.equal(api.dailyRowOrigin({ type: 'calendar', previous: 0 }), 'calendar');
  assert.equal(api.dailyRowOrigin({ type: 'calendar-imported', previous: 0 }), 'calendar');
  assert.equal(api.dailyRowOrigin({ type: 'interrupt', previous: 0 }), 'interrupt');
  assert.equal(api.dailyRowOriginLabel('new'), '予定');
  assert.equal(api.dailyRowOriginLabel('resume'), '予定');
  assert.equal(api.dailyRowOriginLabel('calendar'), 'カレンダー');
  assert.equal(api.dailyRowOriginLabel('interrupt'), '今日だけ');
  assert.equal(api.dailyRowIsInterrupt({ type: 'interrupt' }), true);
  assert.equal(api.dailyRowIsInterrupt({ type: 'saved' }), false);
  assert.equal(api.findPriorDailyTask('問い合わせ対応', [
    { title: '問い合わせ対応', type: 'interrupt', hours: 1.25, prevB: 0, prevC: 0 }
  ]), null);
  const interruptSynced = api.weeklySyncedHoursForDaily(
    { name: '問い合わせ対応', type: 'interrupt', today: 1.25, previous: 3, estimate: 8 },
    '2026-08-26',
    [{ aggregationKey: 'API連携', plannedHours: 6, actualByDate: { '2026-08-24': 2 } }],
    [],
    {}
  );
  assert.equal(interruptSynced.estimate, 1.25);
  assert.equal(interruptSynced.previous, 0);
  const interruptEditing = api.weeklySyncedHoursForDaily(
    { name: '入力中の作業', type: 'interrupt', today: 1.13, previous: 3, estimate: 8 },
    '2026-08-26',
    [],
    [],
    {}
  );
  assert.equal(interruptEditing.estimate, 1.13);
  assert.equal(interruptEditing.previous, 0);
  const interruptWithoutTodayPlan = api.weeklySyncedHoursForDaily(
    { name: '問い合わせ対応', type: 'interrupt', today: 0, previous: 5, estimate: 8 },
    '2026-08-26',
    [],
    [],
    {},
    {}
  );
  assert.equal(interruptWithoutTodayPlan.estimate, 0);
  assert.equal(interruptWithoutTodayPlan.previous, 0);
  const interruptMap = api.interruptEntriesByDate(
    [{ date: '2026-08-26' }, { date: '2026-08-27' }],
    {
      rows: [
        { name: '問い合わせ対応', hasPlan: false, actualByDate: { '2026-08-26': 1.25 } },
        { name: 'API連携', hasPlan: true, actualByDate: { '2026-08-26': 2 } }
      ]
    },
    null
  );
  assert.equal(interruptMap['2026-08-26'].length, 1);
  assert.equal(interruptMap['2026-08-26'][0].name, '問い合わせ対応');
  assert.equal(interruptMap['2026-08-26'][0].hours, 1.25);
  assert.equal(interruptMap['2026-08-27'].length, 0);
  const liveMap = api.interruptEntriesByDate(
    [{ date: '2026-08-26' }, { date: '2026-08-27' }],
    {
      rows: [
        { name: '問い合わせ対応', hasPlan: false, actualByDate: { '2026-08-26': 1.25 } }
      ]
    },
    { date: '2026-08-26', rows: [{ type: 'interrupt', name: '臨時対応', today: 0.5 }] }
  );
  assert.equal(liveMap['2026-08-26'].length, 1);
  assert.equal(liveMap['2026-08-26'][0].name, '臨時対応');
  assert.equal(api.dailyRowNameLocked({ name: 'API連携 認証' }), true);
  assert.equal(api.dailyRowNameLocked({ name: '' }), false);
  assert.equal(api.dailyRowNameLocked({ name: '   ' }), false);
  assert.equal(api.planNameLocked({ name: 'API連携', hasPlan: true }), false);
  assert.equal(api.planNameLocked({ name: 'API連携', hasPlan: false }), true);
  assert.equal(api.planNameLocked({ name: '' }), false);
  assert.equal(api.planNameLocked(null), false);
  const synced = api.weeklySyncedHoursForDaily(
    { name: 'API連携', previous: 99, estimate: 12 },
    '2026-08-26',
    [{ aggregationKey: 'API連携', plannedHours: 6, actualByDate: { '2026-08-24': 2, '2026-08-25': 1.5 } }],
    [],
    {}
  );
  assert.equal(synced.estimate, 6);
  assert.equal(synced.previous, 3.5);
  const childSynced = api.weeklySyncedHoursForDaily(
    { name: 'API連携 認証', previous: 0, estimate: 99 },
    '2026-08-26',
    [{ aggregationKey: 'API連携', plannedHours: 6, planId: 'plan-1', actualByDate: { '2026-08-24': 2 } }],
    [{ parentKey: 'API連携', parentPlanId: 'plan-1', title: '認証', plannedHours: 3, prevB: 1.5 }],
    {}
  );
  assert.equal(childSynced.estimate, 3);
  assert.equal(childSynced.previous, 1.5);
});

test('週キャッシュが消えても実績画面のサブタスク予定工数は親に戻らない', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const start = html.indexOf('function weeklySubtasksForWeek(');
  const end = html.indexOf('function mergeSuggestionItem(');
  assert.ok(start >= 0 && end > start);
  const context = {
    roundHours: value => Math.round((Number(value) || 0) * 100) / 100,
    planningSubtaskMatchesParent: (task, parent, planId) => (planId && task.parentPlanId === planId) || task.parentKey === parent,
    state: {
      weeklySubtasksByWeek: {},
      planner: { type: 'month', key: '2026-10', summary: null },
      daily: {
        weekKey: '2026-W42',
        weekSummary: { subtasks: [] },
        weekSubtasks: [{ parentKey: 'API連携', parentPlanId: 'plan-1', title: '認証', plannedHours: 3 }]
      }
    }
  };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const subtasks = context.weeklySubtasksForWeek('2026-W42');
  assert.equal(subtasks.length, 1);
  assert.equal(subtasks[0].plannedHours, 3);
  assert.equal(context.weeklySubtasksForWeek('2026-W43').length, 0);
});

test('離席は設定した時間以上のときだけ確認し、判定をオフにもできる', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const roundStart = html.indexOf('function roundHours(value)');
  const roundEnd = html.indexOf('function plannerHasWorkHours(');
  const start = html.indexOf('const AWAY_DEFAULT_MINUTES');
  const end = html.indexOf('function timerElapsed(');
  assert.ok(roundStart >= 0 && roundEnd > roundStart && start >= 0 && end > start);
  const context = { state: { uiPreferences: {} } };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(roundStart, roundEnd) + html.slice(start, end), context);
  assert.equal(context.awayGapShouldPrompt(9 * 60 * 1000), false);
  assert.equal(context.awayGapShouldPrompt(10 * 60 * 1000), true);
  assert.equal(context.awayRecordHours(7 * 60 * 1000), 0.25);
  assert.equal(context.awayRecordHours(40 * 60 * 1000), 0.75);
  context.state.uiPreferences = { awayDetection: true, awayMinutes: 3 };
  assert.equal(context.awayGapShouldPrompt(3 * 60 * 1000), true);
  assert.equal(context.awayGapShouldPrompt(2 * 60 * 1000), false);
  context.state.uiPreferences = { awayDetection: false, awayMinutes: 3 };
  assert.equal(context.awayGapShouldPrompt(60 * 60 * 1000), false);
  assert.match(html, /id="awayDetectionEnabled"/);
  assert.match(html, /id="awayDetectionMinutes"/);
  assert.match(html, /IdleDetector\.requestPermission\(/);
  assert.match(html, /id="awayDialog"/);
  assert.match(html, /resolveAwayDialog\('break'\)/);
  assert.match(html, /resolveAwayDialog\('move'\)/);
});

test('蓋を閉じた時刻を離席の開始にし、スリープ中の散発的なtickで開始を遅らせない', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const roundStart = html.indexOf('function roundHours(value)');
  const roundEnd = html.indexOf('function plannerHasWorkHours(');
  const start = html.indexOf('const AWAY_DEFAULT_MINUTES');
  const end = html.indexOf('function noteAway(');
  assert.ok(start >= 0 && end > start);
  const noted = [];
  const minute = 60 * 1000;
  const t0 = Date.UTC(2026, 9, 14, 0, 0, 0);
  const context = {
    window: {},
    noted: noted,
    persistTimer: function() {},
    noteAway: function(from, to) { noted.push([from, to]); },
    state: {
      uiPreferences: { awayDetection: true, awayMinutes: 10 },
      idle: { user: 'active', screen: 'unlocked', awaySince: 0, dialog: null },
      timer: { running: true, startedAt: t0, accumulated: 0, lastSeenAt: t0 }
    }
  };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(roundStart, roundEnd) + html.slice(start, end) + '; var __now = 0; Date.now = function() { return __now; };', context);
  const tick = function(at) { context.__now = at; vm.runInContext('noteTimerPresence()', context); };
  for (let s = 1; s <= 30; s += 1) tick(t0 + s * 1000);
  const closedAt = t0 + 30 * 1000;
  // 蓋を閉じた後、モダンスタンバイ中にtickがときどき動く
  tick(closedAt + 5 * minute);
  tick(closedAt + 5 * minute + 1000);
  tick(closedAt + 20 * minute);
  tick(closedAt + 20 * minute + 1000);
  const resumedAt = closedAt + 45 * minute;
  tick(resumedAt);
  assert.equal(noted.length, 0);
  assert.equal(context.state.timer.awayFrom, closedAt);
  for (let s = 1; s <= 121; s += 1) tick(resumedAt + s * 1000);
  assert.deepEqual(noted, [[closedAt, resumedAt]]);
  assert.equal(context.state.timer.awayFrom, undefined);

  // 判定オフなら何もしない
  noted.length = 0;
  context.state.uiPreferences = { awayDetection: false, awayMinutes: 10 };
  tick(resumedAt + 200 * 1000);
  tick(resumedAt + 200 * 1000 + 60 * minute);
  for (let s = 1; s <= 130; s += 1) tick(resumedAt + 200 * 1000 + 60 * minute + s * 1000);
  assert.equal(noted.length, 0);
});

test('予定と実績の並び替えは同じ移動アニメーションを使う', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const start = html.indexOf('function reorderShouldInsertBefore(');
  const end = html.indexOf('function reorderIdList(');
  const listEnd = html.indexOf('function reorderRowElements(');
  assert.ok(start >= 0 && end > start && listEnd > end);
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(html.slice(start, listEnd), context);

  assert.equal(context.reorderShouldInsertBefore(10, 0, 40), true);
  assert.equal(context.reorderShouldInsertBefore(30, 0, 40), false);
  assert.deepEqual(context.reorderIdList(['a', 'b', 'c'], 0, 1, true), ['a', 'b', 'c']);
  assert.deepEqual(context.reorderIdList(['a', 'b', 'c'], 0, 1, false), ['b', 'a', 'c']);
  assert.deepEqual(context.reorderIdList(['a', 'b', 'c'], 0, 2, false), ['b', 'c', 'a']);
  assert.deepEqual(context.reorderIdList(['a', 'b', 'c'], 2, 0, true), ['c', 'a', 'b']);
  assert.deepEqual(context.reorderIdList(['a', 'b', 'c'], 2, 0, false), ['a', 'c', 'b']);
  assert.match(html, /this\.pointerEvent\.clientY : this\.pointerY - window\.scrollY/);
  assert.match(html, /function liveReorderElements\(/);
  assert.match(html, /function bindReorderDraggables\(/);
  assert.match(html, /bindReorderDraggables\(list,/);
  assert.match(html, /bindReorderDraggables\(parent,/);
  assert.match(html, /gsap\.fromTo\(element,/);
  assert.doesNotMatch(html, /drag-before/);
  assert.doesNotMatch(html, /is-priority-target-before/);
});

test('予定名と課題URLの変更を同じ予定IDの他の週へ反映する', () => {
  const api = createContext();
  const url = 'https://example.backlog.jp/view/DEV-1';
  const previous = { periodType: 'week', periodKey: '2026-W41', aggregationKey: '旧名', planId: 'plan-1', issueUrl: '' };
  const saved = { periodType: 'week', periodKey: '2026-W41', aggregationKey: 'DEV-1 新名', planId: 'plan-1', issueUrl: url };
  const others = [
    { periodType: 'week', periodKey: '2026-W40', aggregationKey: '旧名', planId: 'plan-1', issueUrl: '' },
    { periodType: 'week', periodKey: '2026-W39', aggregationKey: '旧名', planId: 'plan-1', issueUrl: '' },
    { periodType: 'week', periodKey: '2026-W39', aggregationKey: 'DEV-1 新名', planId: 'plan-other', issueUrl: '' },
    { periodType: 'week', periodKey: '2026-W40', aggregationKey: '旧名', planId: 'plan-2', issueUrl: '' }
  ];
  api.budgetPropagatePlanIdentity([saved], { 'plan-1': previous }, others);
  assert.equal(others[0].aggregationKey, 'DEV-1 新名');
  assert.equal(others[0].issueUrl, url);
  // 同じ週に同名の別予定があるときは名前を変えず、課題URLだけ揃える。
  assert.equal(others[1].aggregationKey, '旧名');
  assert.equal(others[1].issueUrl, url);
  assert.equal(others[2].aggregationKey, 'DEV-1 新名');
  assert.equal(others[3].aggregationKey, '旧名');
});

test('予定の状態は未着手・進行中・完了から選べ、未操作なら実績で自動判定する', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const pick = (from, to) => {
    const a = html.indexOf(from);
    const b = html.indexOf(to, a + 1);
    assert.ok(a >= 0 && b > a, from);
    return html.slice(a, b);
  };
  const context = { state: { planner: { summary: { subtasks: [] } } }, planningTaskBelongsToPlan: () => false };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(
    pick('function roundHours(value)', 'function plannerHasWorkHours(') +
    pick('function planSubtasksComplete(', 'async function loadPlannerCapacity('),
    context
  );
  const item = { id: 'p1', actual: 0, done: false, completionOverride: null, progress: '' };
  assert.equal(context.planProgressStatus(item), 'todo');
  item.actual = 1;
  assert.equal(context.planProgressStatus(item), 'doing');
  context.setPlanProgressStatus(item, 'todo');
  assert.equal(item.progress, 'todo');
  assert.equal(context.planProgressLabel(item), '未着手');
  context.setPlanProgressStatus(item, 'done');
  assert.equal(item.done, true);
  assert.equal(context.planProgressLabel(item), '完了');
  context.setPlanProgressStatus(item, 'doing');
  assert.equal(item.done, false);
  assert.equal(item.progress, '');
  assert.equal(context.planProgressStatus(item), 'doing');
  item.actual = 0;
  context.setPlanProgressStatus(item, 'doing');
  assert.equal(item.progress, 'doing');
  assert.equal(context.normalizePlanProgress('進行中'), 'doing');
  assert.equal(context.normalizePlanProgress('未着手'), 'todo');
  assert.equal(context.normalizePlanProgress('x'), '');
});

function sliceFunction(source, name, nextName) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('function ' + nextName + '(', start);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}

test('カレンダー由来の今日だけは名前を変えてもキーで元の予定に結び付く', () => {
  const source = fs.readFileSync('ui/planning_data.js', 'utf8');
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(sliceFunction(source, 'dailyCalendarTaskForRow', 'linkDailyCalendarRows'), context);
  const tasks = [
    { name: '朝会', calendarKey: 'k-standup', estimate: 0.5, imported: false, planId: '' },
    { name: '週次定例', calendarKey: 'k-weekly', estimate: 2, imported: false, planId: '' }
  ];
  // 週次定例を今日だけにして、別の予定（朝会）と同じ名前に変えた
  const renamedToOther = context.dailyCalendarTaskForRow({ type: 'interrupt', calendarKey: 'k-weekly', name: '朝会' }, tasks);
  assert.equal(renamedToOther.calendarKey, 'k-weekly');
  assert.equal(renamedToOther.estimate, 2);
  // 自由な名前に変えてもキーで見つかる
  assert.equal(context.dailyCalendarTaskForRow({ type: 'interrupt', calendarKey: 'k-weekly', name: '定例の資料直し' }, tasks).calendarKey, 'k-weekly');
  // キーが見つからないとき、名前の一致で別の予定に寄せない
  const missing = context.dailyCalendarTaskForRow({ type: 'interrupt', calendarKey: 'k-gone', name: '朝会' }, tasks);
  assert.equal(missing.calendarKey, 'k-gone');
  assert.equal(missing.estimate, undefined);
  // キーのないカレンダー行は従来どおり名前で探す
  assert.equal(context.dailyCalendarTaskForRow({ type: 'calendar', name: '朝会' }, tasks).calendarKey, 'k-standup');
  // キーのない今日だけは、取り込み済みでない予定と名前が同じでも結び付けない
  assert.equal(context.dailyCalendarTaskForRow({ type: 'interrupt', name: '朝会' }, tasks), null);
});

test('カレンダー由来の今日だけには元の予定名を表示する', () => {
  const source = fs.readFileSync('ui/daily.js', 'utf8');
  const core = fs.readFileSync('ui/core.js', 'utf8');
  const context = {
    state: { daily: { date: '2026-08-25' } },
    dailyCalendarTasksForDate() {
      return [{ name: '週次定例', calendarKey: 'k-weekly', estimate: 2 }];
    },
    // 除外済み（実施しない）の予定は日次のカレンダー課題に出ず、週の予定データにだけある
    capacityDaysForDaily() {
      return [{ date: '2026-08-25', events: [{ id: 'k-skipped', title: '任意参加MTG', hours: 1 }] }];
    },
    calendarEventKey(event) { return event.id; },
    calendarEventHours(event) { return event.hours; },
    escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext([
    sliceFunction(core, 'roundHours', 'numericHours'),
    'function hours(value) { return roundHours(value).toFixed(2); }',
    sliceFunction(core, 'dailyRowIsInterrupt', 'dailyRowOrigin'),
    sliceFunction(source, 'dailyCalendarSourceForRow', 'dailyIssueCellHtml')
  ].join('\n'), context);
  const html = context.dailyCalendarSourceHtml({ type: 'interrupt', calendarKey: 'k-weekly', name: '定例の資料直し' });
  assert.match(html, /class="interrupt-calendar-source"/);
  assert.match(html, /カレンダー：週次定例/);
  assert.match(html, /予定 2\.00h/);
  assert.match(context.dailyCalendarSourceHtml({ type: 'interrupt', calendarKey: 'k-skipped', name: 'x' }), /カレンダー：任意参加MTG/);
  assert.match(context.dailyCalendarSourceHtml({ type: 'interrupt', calendarKey: 'k-gone', name: 'x' }), /カレンダー予定から/);
  assert.equal(context.dailyCalendarSourceHtml({ type: 'interrupt', name: '問い合わせ対応' }), '');
  assert.equal(context.dailyCalendarSourceHtml({ type: 'calendar', calendarKey: 'k-weekly', name: '週次定例' }), '');
  // 今日だけになったカレンダー由来の行は、元の予定が見つかればカレンダーに戻せる。
  assert.match(html, /class="calendar-revert"[^>]*aria-label="カレンダーの予定に戻す"><span class="material-symbols-outlined" aria-hidden="true">undo</);
  assert.match(context.dailyCalendarSourceHtml({ type: 'interrupt', calendarKey: 'k-weekly', name: '週次定例' }), /calendar-revert/, '名前が同じでも時間を変えて今日だけになった行は戻せる');
  assert.doesNotMatch(context.dailyCalendarSourceHtml({ type: 'interrupt', calendarKey: 'k-gone', name: 'x' }), /calendar-revert/, '元の予定が見つからなければ出さない');
});

test('カレンダー由来の表示に使うアイコンをフォントに含める', () => {
  const html = fs.readFileSync('ui/index.template.html', 'utf8');
  const names = (html.match(/icon_names=([^"&]+)/) || [])[1].split(',');
  assert.ok(names.indexOf('event') >= 0);
});

test('登録した週へ書き戻したあとは、端末の古い控えではなく保存した内容から持ち越しを作る', async () => {
  const view = fs.readFileSync('ui/planning_view.js', 'utf8');
  const core = fs.readFileSync('ui/core.js', 'utf8');
  const part = (source, from, to) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start);
    assert.ok(start >= 0 && end > start, from);
    return source.slice(start, end);
  };
  const stale = { rows: [{ planId: 'p1', endDate: '2026-10-16' }] };
  const fresh = { rows: [{ planId: 'p1', endDate: '2026-10-23' }] };
  const context = {
    state: { calendarCache: {}, weekSnapshot: { 'week:2026-W42': { summary: stale, overlay: { items: [] }, fetchedAt: 1 } }, parentNamesByWeek: {}, weeklySubtasksByWeek: {}, weekForecastCache: {}, weekContinuationBusy: {} },
    collectPlanningPayload: options => options,
    gas: async name => (name === 'savePlanningWorkspace' ? fresh : stale),
    invalidateProjectSnapshots() {},
    scheduleNavigationPersist() {},
    weekWorkspaceCacheKey: key => 'week:' + key,
    previousWeekKey: () => '',
    nextWeekKey: () => ''
  };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(
    part(core, '    function rememberWeekSnapshot(', '    function navigationDayNumber(') +
    part(view, '    function rememberCarriedWeekCaches(', '    function applyContinuationMergeToPlanner(') +
    part(view, '    async function savePlanningWeekWorkspace(', '    function continuedOriginSnapshot('),
    context
  );
  await context.savePlanningWeekWorkspace('2026-W42', [], [], []);
  const loaded = await context.loadWeekWorkspaceCached('2026-W42');
  assert.equal(loaded.rows[0].endDate, '2026-10-23');
  assert.equal(context.state.weekSnapshot['week:2026-W42'].overlay, null);
});

test('並び替えでは動かした予定だけに前後の中間の順位を付け、どの週でも順位の順に並べる', () => {
  const source = fs.readFileSync('ui/planning_data.js', 'utf8');
  const start = source.indexOf('    const PLAN_PRIORITY_STEP');
  const end = source.indexOf('    // 新しい予定の順位', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(source.slice(start, end).replace('const PLAN_PRIORITY_STEP', 'var PLAN_PRIORITY_STEP'), context);
  const a = { id: 'a', priority: 1024 }, b = { id: 'b', priority: 2048 }, c = { id: 'c', priority: 3072 }, d = { id: 'd', priority: 4096 };
  const increasing = list => list.every((item, index) => index === 0 || list[index - 1].priority < item.priority);
  // b を c の下へ動かす → 1つだけ順位が変わり、並びどおりになる。
  let before = [a, b, c, d].map(item => item.priority);
  context.assignPlanPriorities([a, c, b, d]);
  assert.equal(increasing([a, c, b, d]), true);
  assert.equal([a, b, c, d].filter((item, index) => item.priority !== before[index]).length, 1);
  // 一番上へ動かす → 動かした予定と、順位のない新しい予定だけに順位を付ける。
  const e = { id: 'e', priority: null };
  before = [a, b, c, d].map(item => item.priority);
  context.assignPlanPriorities([d, a, c, b, e]);
  assert.equal(increasing([d, a, c, b, e]), true);
  assert.deepEqual([a, b, c].map(item => item.priority), [a, b, c].map(item => before[[a, b, c, d].indexOf(item)]));
  assert.equal(d.priority >= 0, true);
  // 順位で並べ、順位が同じなら登録した週の古い順、順位のない予定は最後。
  const sorted = context.sortByPlanPriority([
    { id: 'x', priority: null },
    { id: 'y', priority: 2048, originWeek: '2026-W43' },
    { id: 'z', priority: 2048, originWeek: '2026-W42' },
    { id: 'w', priority: 1024 }
  ]);
  assert.deepEqual(sorted.map(item => item.id), ['w', 'z', 'y', 'x']);
});


test('元に戻すとき、仮の稼働時間（カレンダー読み込み前）で本当の稼働時間を上書きしない', async () => {
  const source = fs.readFileSync('ui/core.js', 'utf8');
  const start = source.indexOf('    function historyCapacityDays(');
  const end = source.indexOf('    function applyEditHistoryCalendarExclusions(', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = {
    roundHours: value => Math.round((Number(value) || 0) * 100) / 100,
    state: { storage: { configured: true } },
    gas: async (name, ...args) => { calls.push([name, ...args]); },
    toast() {}
  };
  context.completionSyncEnabled = context.completionSyncEnabled || (() => true);
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const snapshot = (days, fallback) => ({ planner: { summary: { capacity: { fallback, days } } } });
  const real = snapshot([{ date: '2026-10-12', baseHours: 0, capacityReason: 'スポーツの日' }, { date: '2026-10-13', baseHours: 8 }], false);
  const provisional = snapshot([{ date: '2026-10-12', baseHours: 8 }, { date: '2026-10-13', baseHours: 8 }], true);
  await context.syncEditHistoryCapacity(real, provisional);
  await context.syncEditHistoryCapacity(provisional, real);
  assert.deepEqual(calls, []);
  // 本当の稼働時間どうしで値が違う日だけを書き戻す（片方にしかない日は書かない）。
  const edited = snapshot([{ date: '2026-10-12', baseHours: 0, capacityReason: 'スポーツの日' }, { date: '2026-10-13', baseHours: 4 }, { date: '2026-10-14', baseHours: 8 }], false);
  await context.syncEditHistoryCapacity(edited, real);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['saveWorkCapacitySetting', '2026-10-13', 8, '']]);
});

test('週の帯は、今日より前で実績のない日が7日以上続いた期間だけを線にする', () => {
  const view = fs.readFileSync('ui/planning_view.js', 'utf8');
  const core = fs.readFileSync('ui/core.js', 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    sliceFunction(core, 'roundHours', 'hoursStepUnit'),
    sliceFunction(core, 'addDaysYmd', 'isYmdText'),
    'const TIMELINE_IDLE_GAP_DAYS = 7;',
    sliceFunction(view, 'timelineIdleGaps', 'timelinePeriodSegments')
  ].join('\n'), context);
  const range = { start: '2026-10-20', end: '2026-11-14' };
  const gaps = context.timelineIdleGaps(range, { '2026-11-12': 2, '2026-11-13': 1.5 }, '2026-11-13');
  assert.deepEqual(JSON.parse(JSON.stringify(gaps)), [{ start: '2026-10-20', end: '2026-11-11' }]);
  // 2〜3日あいただけなら線にしない。今日以降は実績がなくても線にしない。
  assert.deepEqual(Array.from(context.timelineIdleGaps(range, { '2026-10-20': 1, '2026-10-23': 1, '2026-10-26': 1 }, '2026-10-30')), []);
  assert.equal(context.timelineIdleGaps(range, { '2026-10-20': 1 }, '2026-11-13').length, 1, '途中の空白も線にする');
});
