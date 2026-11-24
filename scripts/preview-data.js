function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatYmd(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function addDaysYmd(ymd, days) {
  const date = new Date(ymd + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return formatYmd(date);
}

function rangeFor(type, key) {
  if (type === 'month') {
    const [year, month] = key.split('-').map(Number);
    const end = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
    return { startYmd: `${key}-01`, endExclusiveYmd: end };
  }
  const match = key.match(/^(\d{4})-W(\d{2})$/);
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + (Number(match[2]) - 1) * 7 * 86400000);
  const next = new Date(monday.getTime() + 7 * 86400000);
  return { startYmd: monday.toISOString().slice(0, 10), endExclusiveYmd: next.toISOString().slice(0, 10) };
}

function nextWeekKey(key) {
  const range = rangeFor('week', key);
  const next = new Date(`${range.endExclusiveYmd}T12:00:00Z`);
  const day = (next.getUTCDay() + 6) % 7;
  next.setUTCDate(next.getUTCDate() + 3 - day);
  const year = next.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const janDay = (jan4.getUTCDay() + 6) % 7;
  const firstThursday = new Date(jan4.getTime() + (3 - janDay) * 86400000);
  return `${year}-W${pad2(1 + Math.round((next - firstThursday) / 604800000))}`;
}

function previousWeekKey(key) {
  const range = rangeFor('week', key);
  const prev = new Date(`${range.startYmd}T12:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 4);
  const year = prev.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const janDay = (jan4.getUTCDay() + 6) % 7;
  const firstThursday = new Date(jan4.getTime() + (3 - janDay) * 86400000);
  return `${year}-W${pad2(1 + Math.round((prev - firstThursday) / 604800000))}`;
}

function currentWeekKey() {
  const today = new Date();
  const thursday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - (thursday.getUTCDay() + 6) % 7);
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - (firstThursday.getUTCDay() + 6) % 7);
  return `${year}-W${pad2(1 + Math.round((thursday - firstThursday) / 604800000))}`;
}

function currentMonthKey() {
  return formatYmd(new Date()).slice(0, 7);
}

function mergeLifetimeDemoActuals(type, key, rows) {
  if (type !== 'week') return rows;
  let cursor = key;
  for (let i = 0; i < 16; i++) {
    cursor = previousWeekKey(cursor);
    if (!savedWeekKind(cursor)) continue;
    const prev = demoWeekWorkspace(cursor);
    rows.forEach(row => {
      const extra = prev.actualByDate && prev.actualByDate[row.aggregationKey];
      if (!extra) return;
      row.actualByDate = Object.assign({}, extra, row.actualByDate || {});
      row.actualHours = Object.values(row.actualByDate).reduce((sum, hours) => sum + Number(hours || 0), 0);
      row.varianceHours = row.actualHours - row.plannedHours;
      row.consumptionRate = row.plannedHours ? row.actualHours / row.plannedHours : null;
      if (row.hasPlan) {
        row.remainingHours = Math.max(0, row.plannedHours - row.actualHours);
        row.status = row.actualHours > row.plannedHours ? '超過' : row.actualHours === 0 ? '未着手' : '未消化';
      }
    });
  }
  return rows;
}

const PLANNING_CALENDARS = [
  { id: 'primary', name: '仕事', primary: true },
  { id: 'team@example.com', name: '開発チーム', primary: false },
  { id: 'company@example.com', name: '全社', primary: false }
];

const DEFAULT_CALENDAR_IDS = PLANNING_CALENDARS.map(calendar => calendar.id);

function calendarSelected(selectedIds, calendarId) {
  const ids = selectedIds || DEFAULT_CALENDAR_IDS;
  return ids.indexOf(calendarId) >= 0;
}

function eventHours(event) {
  if (event.meetingHours != null) return event.meetingHours;
  const [sh, sm] = String(event.startTime || '00:00').split(':').map(Number);
  const [eh, em] = String(event.endTime || '00:00').split(':').map(Number);
  return Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
}

function workCapacityOverridesFrom(payload) {
  if (payload && payload.workCapacity) return payload.workCapacity;
  if (typeof window !== 'undefined' && window.__workCapacityOverrides) return window.__workCapacityOverrides;
  return {};
}

function saveWorkCapacitySetting(dateValue, hoursValue, reasonValue) {
  const date = String(dateValue || '').trim();
  const hours = Math.max(0, Math.round((Number(hoursValue) || 0) * 4) / 4);
  const reason = String(reasonValue == null ? '' : reasonValue);
  if (typeof window !== 'undefined') {
    if (!window.__workCapacityOverrides) window.__workCapacityOverrides = {};
    window.__workCapacityOverrides[date] = { hours, reason };
  }
  return { date, hours, reason };
}

function demoCalendarEvents(date, selectedIds) {
  const day = date.getDay();
  if (day === 0 || day === 6) return [];
  const catalog = {
    1: [
      { id: 'standup', calendarId: 'primary', calendarName: '仕事', title: '朝会', startTime: '09:30', endTime: '10:00' },
      { id: 'kickoff', calendarId: 'primary', calendarName: '仕事', title: '案件キックオフ（ダッシュボード刷新 / API連携）', startTime: '10:00', endTime: '11:00' },
      { id: 'client', calendarId: 'primary', calendarName: '仕事', title: '顧客定例（進捗共有と来週の優先順位確認）', startTime: '14:00', endTime: '15:30' },
      { id: 'team-sync', calendarId: 'team@example.com', calendarName: '開発チーム', title: '開発チーム同期', startTime: '16:00', endTime: '16:30' }
    ],
    2: [
      { id: 'standup', calendarId: 'primary', calendarName: '仕事', title: '朝会', startTime: '09:30', endTime: '10:00' },
      { id: 'weekly', calendarId: 'primary', calendarName: '仕事', title: '週次プロダクト開発定例（全チーム合同・リリース判定含む）', startTime: '10:00', endTime: '12:00' },
      { id: 'oneonone', calendarId: 'team@example.com', calendarName: '開発チーム', title: '1on1', startTime: '16:00', endTime: '16:30' }
    ],
    3: [
      { id: 'standup', calendarId: 'primary', calendarName: '仕事', title: '朝会', startTime: '09:30', endTime: '10:00' },
      { id: 'design', calendarId: 'primary', calendarName: '仕事', title: '設計レビュー（権限モデルとAPIエラーハンドリング）', startTime: '11:00', endTime: '12:30' },
      { id: 'optional', calendarId: 'team@example.com', calendarName: '開発チーム', title: '任意参加ミーティング', startTime: '15:00', endTime: '16:00' }
    ],
    4: [
      { id: 'standup', calendarId: 'primary', calendarName: '仕事', title: '朝会', startTime: '09:30', endTime: '10:00' },
      { id: 'interview', calendarId: 'primary', calendarName: '仕事', title: '採用面談', startTime: '13:00', endTime: '14:00' },
      { id: 'allhands', calendarId: 'company@example.com', calendarName: '全社', title: '全社会（四半期方針と新サービス説明）', startTime: '15:00', endTime: '16:00' },
      { id: 'incident', calendarId: 'team@example.com', calendarName: '開発チーム', title: '障害共有会', startTime: '16:30', endTime: '17:00' }
    ],
    5: [
      { id: 'standup', calendarId: 'primary', calendarName: '仕事', title: '朝会', startTime: '09:30', endTime: '10:00' },
      { id: 'release', calendarId: 'primary', calendarName: '仕事', title: 'リリース判定会議', startTime: '10:00', endTime: '11:30' },
      { id: 'retro', calendarId: 'team@example.com', calendarName: '開発チーム', title: '週次ふりかえり', startTime: '16:00', endTime: '17:00' },
      { id: 'focus', calendarId: 'primary', calendarName: '仕事', title: '集中作業ブロック', startTime: '13:00', endTime: '15:00', blocksTime: false }
    ]
  };
  return (catalog[day] || []).filter(event => calendarSelected(selectedIds, event.calendarId)).map(event => {
    const durationHours = eventHours({ startTime: event.startTime, endTime: event.endTime });
    return {
      allDay: false,
      ...event,
      blocksTime: event.blocksTime !== false,
      durationHours: durationHours,
      meetingHours: event.blocksTime === false ? 0 : durationHours
    };
  });
}

function weekDates(key) {
  const monday = rangeFor('week', key).startYmd;
  return {
    mon: monday,
    tue: addDaysYmd(monday, 1),
    wed: addDaysYmd(monday, 2),
    thu: addDaysYmd(monday, 3),
    fri: addDaysYmd(monday, 4)
  };
}

function savedWeekKind(key) {
  const current = currentWeekKey();
  if (key === current) return 'current';
  const previous = previousWeekKey(current);
  if (key === previous || key === previousWeekKey(previous)) return 'past';
  return '';
}

function demoWeekWorkspace(key) {
  const days = weekDates(key);
  const kind = savedWeekKind(key);
  // 予定は期間（開始日〜終了日）で押さえる。週をまたぐ予定・前倒し・期限切れも見えるようにする。
  const plans = [
    { aggregationKey: 'ダッシュボード刷新', plannedHours: 8, note: '今週の最優先', startDate: days.mon, endDate: days.thu, priority: 0, initialPlannedHours: 8, planKind: 'initial' },
    { aggregationKey: 'API連携', plannedHours: 6, note: '認証まわりを先に', startDate: days.mon, endDate: addDaysYmd(days.mon, 9), priority: 1, initialPlannedHours: 6, planKind: 'initial' },
    { aggregationKey: '権限まわり改修', plannedHours: 4, note: '', startDate: days.wed, endDate: days.fri, priority: 2, initialPlannedHours: 4, planKind: 'initial' },
    { aggregationKey: 'コードレビュー', plannedHours: 3, note: '', startDate: days.mon, endDate: days.fri, priority: 3, initialPlannedHours: 3, planKind: 'initial' },
    { aggregationKey: '設計レビュー', plannedHours: 2, note: `start:${days.mon}\ncarry:${previousWeekKey(key)}`, priority: 5, initialPlannedHours: 2, planKind: 'initial' },
    { aggregationKey: 'ドキュメント整備', plannedHours: 3, note: '', startDate: days.thu, endDate: days.fri, priority: 6, initialPlannedHours: 3, planKind: 'initial' },
    { aggregationKey: 'リリース判定', plannedHours: 2, note: '', startDate: days.fri, endDate: days.fri, priority: 7, initialPlannedHours: 2, planKind: 'initial' },
    { aggregationKey: 'オンボーディング資料', plannedHours: 3, note: '先週から残っている', startDate: addDaysYmd(days.mon, -5), endDate: addDaysYmd(days.mon, -3), priority: 8, initialPlannedHours: 3, planKind: 'initial' },
    { aggregationKey: '障害対応', plannedHours: 2.5, note: '週途中で追加', startDate: days.wed, endDate: days.wed, priority: 9, initialPlannedHours: 2.5, planKind: 'added' },
    { aggregationKey: '技術調査メモ', plannedHours: 4, note: '期間を決めずに少しずつ', undated: true, priority: 10, initialPlannedHours: 4, planKind: 'added' }
  ];
  plans.forEach(plan => { plan.projectId = DEMO_PROJECT_PLAN_MAP[plan.aggregationKey] || ''; });

  const actualByDate = {};
  const put = (name, date, hours) => {
    if (!hours) return;
    actualByDate[name] = actualByDate[name] || {};
    actualByDate[name][date] = hours;
  };

  if (kind === 'current' || kind === 'past') {
    put('ダッシュボード刷新', days.mon, 2.5);
    put('ダッシュボード刷新', days.tue, 2);
    put('API連携', days.mon, 1.5);
    put('API連携', days.tue, 2);
    put('API連携', days.wed, 1.25);
    put('権限まわり改修', days.tue, 2);
    put('権限まわり改修', days.wed, 1);
    put('コードレビュー', days.mon, 1);
    put('コードレビュー', days.tue, 1);
    put('コードレビュー', days.wed, 0.5);
    put('設計レビュー', days.mon, 2);
    put('障害対応', days.wed, 1.5);
    put('問い合わせ対応', days.wed, 1.25);
    put('オンボーディング資料', addDaysYmd(days.mon, -4), 1);
    put('技術調査メモ', days.tue, 1);
  }
  if (kind === 'past') {
    put('ダッシュボード刷新', days.wed, 2);
    put('ダッシュボード刷新', days.thu, 2.5);
    put('API連携', days.thu, 2);
    put('API連携', days.fri, 2.5);
    put('権限まわり改修', days.thu, 1.5);
    put('ドキュメント整備', days.thu, 2.5);
    put('ドキュメント整備', days.fri, 1);
    put('リリース判定', days.fri, 2);
    put('オンボーディング資料', days.mon, 1.5);
    put('障害対応', days.thu, 1);
    put('問い合わせ対応', days.fri, 0.75);
  }

  const actuals = {};
  Object.keys(actualByDate).forEach(name => {
    actuals[name] = Object.values(actualByDate[name]).reduce((sum, hours) => sum + hours, 0);
  });

  const subtasks = [
    { id: 'mock-1', periodType: 'week', periodKey: key, parentKey: 'ダッシュボード刷新', title: '情報設計を確定する', plannedHours: 2.5, dueDate: days.tue, status: 'done', note: '', sortOrder: 0 },
    { id: 'mock-2', periodType: 'week', periodKey: key, parentKey: 'ダッシュボード刷新', title: 'レスポンシブ表示を調整', plannedHours: 4, dueDate: days.thu, status: kind === 'past' ? 'done' : 'doing', note: 'スマホ優先', sortOrder: 1 },
    { id: 'mock-3', periodType: 'week', periodKey: key, parentKey: 'ダッシュボード刷新', title: 'グラフの空状態を直す', plannedHours: 1.5, dueDate: days.fri, status: kind === 'past' ? 'done' : 'todo', note: '', sortOrder: 2 },
    { id: 'mock-4', periodType: 'week', periodKey: key, parentKey: 'API連携', title: '認証トークン更新を実装', plannedHours: 3, dueDate: days.wed, status: kind === 'past' ? 'done' : 'doing', note: '', sortOrder: 0 },
    { id: 'mock-5', periodType: 'week', periodKey: key, parentKey: 'API連携', title: 'エラーハンドリングを揃える', plannedHours: 2.5, dueDate: days.fri, status: kind === 'past' ? 'done' : 'todo', note: '', sortOrder: 1 },
    { id: 'mock-6', periodType: 'week', periodKey: key, parentKey: '権限まわり改修', title: 'ロール定義を洗い出す', plannedHours: 1.5, dueDate: days.tue, status: 'done', note: '', sortOrder: 0 },
    { id: 'mock-7', periodType: 'week', periodKey: key, parentKey: '権限まわり改修', title: '管理画面の表示制御', plannedHours: 2.5, dueDate: days.thu, status: kind === 'past' ? 'done' : 'doing', note: '', sortOrder: 1 },
    { id: 'mock-8', periodType: 'week', periodKey: key, parentKey: 'ドキュメント整備', title: '運用手順を更新', plannedHours: 2, dueDate: days.fri, status: kind === 'past' ? 'done' : 'todo', note: '', sortOrder: 0 }
  ];

  return {
    plans,
    actuals,
    actualByDate,
    subtasks,
    monthlyRows: [
      { aggregationKey: 'ダッシュボード刷新', monthlyPlannedHours: 48, suggestedHours: 12, note: '今月の重点' },
      { aggregationKey: 'API連携', monthlyPlannedHours: 32, suggestedHours: 8, note: '' },
      { aggregationKey: '権限まわり改修', monthlyPlannedHours: 16, suggestedHours: 4, note: '' },
      { aggregationKey: 'ドキュメント整備', monthlyPlannedHours: 12, suggestedHours: 3, note: '' },
      { aggregationKey: 'オンボーディング資料', monthlyPlannedHours: 10, suggestedHours: 3, note: '採用向け' }
    ]
  };
}

function demoMonthWorkspace(key) {
  const start = `${key}-01`;
  const plans = [
    { aggregationKey: 'ダッシュボード刷新', plannedHours: 48, note: '今月の重点', priority: 0, initialPlannedHours: 48, planKind: 'initial' },
    { aggregationKey: 'API連携', plannedHours: 32, note: '', priority: 1, initialPlannedHours: 32, planKind: 'initial' },
    { aggregationKey: '権限まわり改修', plannedHours: 16, note: '', priority: 2, initialPlannedHours: 16, planKind: 'initial' },
    { aggregationKey: 'コードレビュー', plannedHours: 12, note: '', priority: 3, initialPlannedHours: 12, planKind: 'initial' },
    { aggregationKey: 'ドキュメント整備', plannedHours: 12, note: '', priority: 4, initialPlannedHours: 12, planKind: 'initial' },
    { aggregationKey: 'オンボーディング資料', plannedHours: 10, note: '採用向け', priority: 5, initialPlannedHours: 10, planKind: 'initial' },
    { aggregationKey: '障害対応', plannedHours: 8, note: '週途中の割り込み枠', priority: 6, initialPlannedHours: 8, planKind: 'added' }
  ];
  plans.forEach(plan => { plan.projectId = DEMO_PROJECT_PLAN_MAP[plan.aggregationKey] || ''; });
  return {
    plans,
    actuals: {
      'ダッシュボード刷新': 19.5,
      'API連携': 16.5,
      '権限まわり改修': 8,
      'コードレビュー': 6.5,
      'ドキュメント整備': 3.5,
      'オンボーディング資料': 3,
      '障害対応': 4.5,
      '問い合わせ対応': 3.25
    },
    actualByDate: {
      ダッシュボード刷新: { [addDaysYmd(start, 16)]: 2.5, [addDaysYmd(start, 23)]: 2.5 },
      API連携: { [addDaysYmd(start, 17)]: 2, [addDaysYmd(start, 24)]: 1.5 }
    },
    subtasks: [],
    monthlyRows: []
  };
}

const DEMO_PROJECTS = [
  {
    id: 'project-portal',
    name: '顧客ポータル刷新',
    description: '顧客向けポータルの情報設計とAPI連携を段階的に刷新します。',
    status: 'active',
    statusLabel: '進行中',
    startDate: '2026-08-01',
    endDate: '2026-12-25',
    createdAt: '2026/08/01 09:00:00',
    updatedAt: '2026/09/01 09:00:00'
  },
  {
    id: 'project-admin',
    name: '管理基盤の権限整理',
    description: '管理画面のロールと表示制御を整理し、運用負荷を下げます。',
    status: 'active',
    statusLabel: '進行中',
    startDate: '2026-08-15',
    endDate: '2026-10-31',
    createdAt: '2026/08/15 09:00:00',
    updatedAt: '2026/09/01 09:00:00'
  },
  {
    id: 'project-ops',
    name: '運用改善',
    description: 'ドキュメントと障害対応の手順を整備します。',
    status: 'paused',
    statusLabel: '保留',
    startDate: '2026-09-01',
    endDate: '',
    createdAt: '2026/09/01 09:00:00',
    updatedAt: '2026/09/01 09:00:00'
  }
];

const DEMO_PROJECT_PLAN_MAP = {
  'ダッシュボード刷新': 'project-portal',
  'API連携': 'project-portal',
  '権限まわり改修': 'project-admin',
  'コードレビュー': 'project-admin',
  'ドキュメント整備': 'project-ops',
  '障害対応': 'project-ops'
};

function projectStatusLabel(status) {
  return ({ active: '進行中', paused: '保留', done: '完了', archived: 'アーカイブ' })[status] || '進行中';
}

function previewStorage() {
  return {
    configured: true, annual: true, currentYear: 2026, years: [2025, 2026],
    folderName: 'まとめて工数管理さん',
    folderPath: 'マイドライブ / まとめて工数管理さん',
    file: { year: 2026, name: '2026年工数管理データ', url: '#' },
    files: [{ year: 2025, name: '2025年工数管理データ', url: '#' }, { year: 2026, name: '2026年工数管理データ', url: '#' }],
    defaultName: 'まとめて工数管理さん'
  };
}

function previewProjectData() {
  if (typeof window === 'undefined') return { projects: DEMO_PROJECTS.map(project => ({ ...project })), monthly: {} };
  if (!window.__previewProjects) window.__previewProjects = DEMO_PROJECTS.map(project => ({ ...project }));
  if (!window.__previewProjectMonthly) window.__previewProjectMonthly = {};
  return { projects: window.__previewProjects, monthly: window.__previewProjectMonthly };
}

function projectCapacityForMonth(monthKey) {
  const key = String(monthKey || currentMonthKey());
  const range = rangeFor('month', key);
  const overrides = workCapacityOverridesFrom();
  const selectedIds = typeof window !== 'undefined' && window.__selectedCalendarIds
    ? window.__selectedCalendarIds
    : DEFAULT_CALENDAR_IDS;
  let date = new Date(`${range.startYmd}T12:00:00`);
  let availableHours = 0;
  let baseHours = 0;
  let meetingHours = 0;
  let workdayCount = 0;
  while (formatYmd(date) < range.endExclusiveYmd) {
    const dateKey = formatYmd(date);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const override = overrides[dateKey];
    const base = override ? Number(override.hours) || 0 : (weekend ? 0 : 8);
    const events = weekend ? [] : demoCalendarEvents(date, selectedIds);
    const meetings = events.reduce((sum, event) => sum + (event.blocksTime === false ? 0 : eventHours(event)), 0);
    baseHours += base;
    meetingHours += meetings;
    availableHours += Math.max(0, base - meetings);
    if (base > 0) workdayCount += 1;
    date.setDate(date.getDate() + 1);
  }
  return {
    monthKey: key,
    baseHours: Math.round(baseHours * 4) / 4,
    meetingHours: Math.round(meetingHours * 4) / 4,
    availableHours: Math.round(availableHours * 4) / 4,
    workdayCount,
    calendarAvailable: true
  };
}

function projectIssuePeriodKey(monthKey) {
  const first = rangeFor('month', monthKey).startYmd;
  const date = new Date(`${first}T12:00:00`);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  const thursday = new Date(date.getTime() + 3 * 86400000);
  const year = thursday.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const janDay = (jan4.getDay() + 6) % 7;
  const firstMonday = new Date(jan4.getTime() - janDay * 86400000);
  const week = 1 + Math.round((date - firstMonday) / (7 * 86400000));
  return `${year}-W${pad2(week)}`;
}

function previewProjectMonthlyHours(input, monthHours) {
  var raw = String(input == null ? '' : input).trim().replace(/　/g, " ").replace(/％/g, "%").replace(/／/g, "/").replace(/×/g, "*");
  if (!raw) return { ok: true, hours: 0, share: null, linked: false, formula: "" };
  var month = Number(monthHours);
  var monthOk = isFinite(month) && month > 0;
  function fromShare(share) {
    if (!isFinite(month) || month < 0) return { ok: false, error: "割合の基準時間が不正です" };
    if (!isFinite(share) || share < 0) return { ok: false, error: "割合が不正です" };
    var computed = Math.round(month * share * 4) / 4;
    if (computed > 744) return { ok: false, error: "予定稼働時間は744時間以下にしてください" };
    return { ok: true, hours: computed, share: share, linked: true, formula: raw };
  }
  var match = raw.match(/^(?:月の|1人月の)?\s*(\d+(?:\.\d+)?)\s*%$/);
  if (match) return fromShare(Number(match[1]) / 100);
  match = raw.match(/^(?:月の|1人月の)?\s*(\d+(?:\.\d+)?)\s*割$/);
  if (match) return fromShare(Number(match[1]) / 10);
  match = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (match) {
    var denominator = Number(match[2]);
    if (!(denominator > 0)) return { ok: false, error: "割合が不正です" };
    return fromShare(Number(match[1]) / denominator);
  }
  match = raw.match(/^(?:\*|月\s*\*|1人月\s*\*)\s*(\d+(?:\.\d+)?)$/);
  if (match) return fromShare(Number(match[1]));
  match = raw.match(/^(\d+(?:\.\d+)?)\s*h?$/i);
  if (match) {
    var direct = Math.round(Number(match[1]) * 4) / 4;
    if (direct < 0 || direct > 744) return { ok: false, error: "予定稼働時間は0〜744時間で入力してください" };
    return { ok: true, hours: direct, share: monthOk ? direct / month : null, linked: false, formula: "" };
  }
  return { ok: false, error: "時間（80）、割合（50%、3割、1/2）、または *0.5 で入力してください" };
}

function projectWorkspace(monthKey) {
  const key = String(monthKey || currentMonthKey());
  const data = previewProjectData();
  const capacity = projectCapacityForMonth(key);
  const monthPlans = [
    { projectId: 'project-portal', name: 'ダッシュボード刷新', plannedHours: 32, actualHours: 19.5, note: '今月の重点' },
    { projectId: 'project-portal', name: 'API連携', plannedHours: 24, actualHours: 16.5, note: '' },
    { projectId: 'project-admin', name: '権限まわり改修', plannedHours: 16, actualHours: 8, note: '' },
    { projectId: 'project-admin', name: 'コードレビュー', plannedHours: 10, actualHours: 6.5, note: '' },
    { projectId: 'project-ops', name: 'ドキュメント整備', plannedHours: 12, actualHours: 3.5, note: '' },
    { projectId: 'project-ops', name: '障害対応', plannedHours: 8, actualHours: 4.5, note: '週途中の追加' },
    { projectId: 'project-ops', name: '問い合わせ対応 設定案内', plannedHours: 0, actualHours: 1.25, note: '予定のない今日だけの実績' }
  ].map((issue, index) => Object.assign({}, issue, {
    id: `preview-project-issue-${key}-${index}`,
    periodType: 'week',
    periodKey: projectIssuePeriodKey(key),
    status: issue.actualHours > issue.plannedHours ? '超過' : issue.actualHours > 0 ? '進行中' : '未着手',
    planKind: index === 5 ? 'added' : 'initial'
  }));
  const monthlyDefaults = {
    'project-portal': { plannedHours: 64, statusNote: '要件確認とAPI連携を優先して進行中です。' },
    'project-admin': { plannedHours: 32, statusNote: '権限モデルの確認待ち。実装は予定どおりです。' },
    'project-ops': { plannedHours: 20, statusNote: '障害対応を優先したため、文書化は後半に実施します。' }
  };
  const settings = Object.fromEntries(data.projects.map(project => [project.id,
    data.monthly[`${key}:${project.id}`] || monthlyDefaults[project.id] || { plannedHours: 0, statusNote: '' }
  ]));
  const fixedHours = data.projects.reduce((total, project) => {
    const setting = settings[project.id];
    return total + (setting.plannedShareText ? 0 : Number(setting.plannedHours) || 0);
  }, 0);
  const shareBasisHours = Math.max(0, capacity.availableHours - fixedHours);
  const rows = data.projects.map(project => {
    const setting = settings[project.id];
    const issues = monthPlans.filter(issue => issue.projectId === project.id).map(issue => ({ ...issue }));
    const actualHours = issues.reduce((sum, issue) => sum + issue.actualHours, 0);
    const parsed = setting.plannedShareText ? previewProjectMonthlyHours(setting.plannedShareText, shareBasisHours) : null;
    const plannedHours = parsed && parsed.ok ? parsed.hours : Number(setting.plannedHours) || 0;
    const varianceHours = actualHours - plannedHours;
    return {
      ...project,
      status: project.status || 'active',
      statusLabel: project.statusLabel || projectStatusLabel(project.status),
      monthKey: key,
      hasMonthlyPlan: data.monthly[`${key}:${project.id}`] != null || monthlyDefaults[project.id] != null,
      plannedHours,
      taskPlannedHours: issues.reduce((sum, issue) => sum + issue.plannedHours, 0),
      actualHours,
      varianceHours,
      remainingHours: plannedHours - actualHours,
      onePersonMonthHours: capacity.availableHours,
      shareBasisHours,
      plannedShareText: setting.plannedShareText || '',
      plannedShareRate: capacity.availableHours ? plannedHours / capacity.availableHours : null,
      actualShareRate: capacity.availableHours ? actualHours / capacity.availableHours : null,
      consumptionRate: plannedHours ? actualHours / plannedHours : null,
      monthlyStatus: plannedHours === 0 ? (actualHours ? '予定未設定' : '未設定') : actualHours > plannedHours ? '超過' : actualHours === plannedHours ? '一致' : actualHours ? '稼働中' : '未着手',
      statusNote: setting.statusNote || '',
      issues
    };
  });
  const totals = rows.reduce((result, row) => {
    result.plannedHours += row.plannedHours;
    result.actualHours += row.actualHours;
    result.projectCount += 1;
    if (row.status === 'active') result.activeCount += 1;
    if (row.monthlyStatus === '超過' || row.monthlyStatus === '予定未設定') result.alertCount += 1;
    return result;
  }, { plannedHours: 0, actualHours: 0, projectCount: 0, activeCount: 0, alertCount: 0 });
  totals.varianceHours = totals.actualHours - totals.plannedHours;
  totals.consumptionRate = totals.plannedHours ? totals.actualHours / totals.plannedHours : null;
  totals.onePersonMonthHours = capacity.availableHours;
  totals.fixedPlannedHours = fixedHours;
  totals.shareBasisHours = shareBasisHours;
  totals.capacityBaseHours = capacity.baseHours;
  totals.meetingHours = capacity.meetingHours;
  totals.unallocatedHours = capacity.availableHours - totals.plannedHours;
  totals.plannedShareRate = capacity.availableHours ? totals.plannedHours / capacity.availableHours : null;
  totals.actualShareRate = capacity.availableHours ? totals.actualHours / capacity.availableHours : null;
  return { monthKey: key, projects: rows, totals, capacity, storage: previewStorage() };
}

function saveProject(payload) {
  const source = payload || {};
  const project = source.project || source;
  const data = previewProjectData();
  const id = String(project.id || `project-preview-${Date.now()}`);
  const index = data.projects.findIndex(item => item.id === id);
  const previous = index >= 0 ? data.projects[index] : {};
  const next = Object.assign({}, previous, project, {
    id,
    status: project.status || previous.status || 'active',
    statusLabel: projectStatusLabel(project.status || previous.status || 'active'),
    updatedAt: '2026/09/16 12:00:00',
    createdAt: previous.createdAt || project.createdAt || '2026/09/16 12:00:00'
  });
  if (index >= 0) data.projects[index] = next;
  else data.projects.push(next);
  return next;
}

function saveProjectWorkspace(payload) {
  const source = payload || {};
  const project = saveProject(source.project || source);
  const data = previewProjectData();
  const monthKey = source.monthKey || currentMonthKey();
  if (source.monthly) {
    data.monthly[`${monthKey}:${project.id}`] = { plannedHours: Number(source.monthly.plannedHours) || 0, statusNote: String(source.monthly.statusNote || ''), plannedShareText: String(source.monthly.plannedShareText || '') };
  }
  return projectWorkspace(monthKey);
}

function saveProjectMonthly(payload) {
  const source = payload || {};
  const data = previewProjectData();
  const monthKey = source.monthKey || source.month || currentMonthKey();
  data.monthly[`${monthKey}:${source.projectId}`] = { plannedHours: Number(source.plannedHours) || 0, statusNote: String(source.statusNote || ''), plannedShareText: String(source.plannedShareText || '') };
  return { projectId: source.projectId, monthKey, plannedHours: data.monthly[`${monthKey}:${source.projectId}`].plannedHours, statusNote: data.monthly[`${monthKey}:${source.projectId}`].statusNote };
}

function demoWorkspace(type, key) {
  return type === 'month' ? demoMonthWorkspace(key) : demoWeekWorkspace(key);
}

function planningResult(type, key, payload) {
  const hasWorkspace = !!(payload && Array.isArray(payload.plans));
  const savedKind = type === 'month' || hasWorkspace || savedWeekKind(key);
  const demo = savedKind ? demoWorkspace(type, key) : { plans: [], actuals: {}, actualByDate: {}, subtasks: [], monthlyRows: [] };
  const plans = hasWorkspace ? payload.plans : demo.plans;
  const actuals = demo.actuals;
  const names = [...new Set([...plans.map(plan => plan.aggregationKey), ...Object.keys(actuals)])];
  const rows = names.map(name => {
    const plan = plans.find(item => item.aggregationKey === name);
    const plannedHours = plan ? Number(plan.plannedHours) || 0 : 0;
    const actualHours = actuals[name] || 0;
    const planKind = plan ? (plan.planKind || 'initial') : 'unplanned';
    const weekKind = savedWeekKind(key);
    const pastDone = weekKind === 'past' && ['コードレビュー', 'リリース判定', '設計レビュー'].indexOf(name) >= 0;
    const notedDone = !!(plan && /(?:^|\n)done:(?:1|true)(?:\n|$)/i.test(plan.note || ''));
    const completionOverride = plan && plan.completionOverride != null ? Boolean(plan.completionOverride) : null;
    return {
      periodType: type,
      periodKey: key,
      aggregationKey: name,
      hasPlan: Boolean(plan),
      note: plan ? plan.note : '',
      planId: plan ? (plan.planId || `preview-${type}-${key}-${plan.priority != null ? plan.priority : name}`) : '',
      startDate: plan && plan.startDate || '',
      endDate: plan && plan.endDate || '',
      undated: !!(plan && plan.undated),
      dailyCap: plan && plan.dailyCap || 0,
      carryWeek: plan && plan.carryWeek || '',
      calendarKey: plan && plan.calendarKey || '',
      projectId: plan && plan.projectId || '',
      issueUrl: plan && plan.issueUrl || '',
      done: !!(plan && plan.done),
      completionOverride,
      dailyPlan: plan && plan.dailyPlan || {},
      plannedHours,
      actualHours,
      actualByDate: (demo.actualByDate && demo.actualByDate[name]) || {},
      varianceHours: actualHours - plannedHours,
      consumptionRate: plannedHours ? actualHours / plannedHours : null,
      status: !plan ? '計画なし' : actualHours > plannedHours ? '超過' : actualHours === 0 ? '未着手' : '未消化',
      priority: plan && plan.priority != null ? plan.priority : 999999,
      estimatedTotalHours: plannedHours,
      remainingHours: plan ? Math.max(0, plannedHours - actualHours) : 0,
      initialPlannedHours: plan && plan.initialPlannedHours != null ? plan.initialPlannedHours : plannedHours,
      planKind,
      complete: completionOverride === false ? false : pastDone || notedDone || !!(plan && plan.done),
      dailyComplete: pastDone
    };
  }).sort((left, right) => left.priority - right.priority || left.aggregationKey.localeCompare(right.aggregationKey, 'ja'));
  mergeLifetimeDemoActuals(type, key, rows);
  const totals = rows.reduce((result, row) => {
    result.plannedHours += row.plannedHours;
    result.actualHours += row.actualHours;
    if (row.planKind === 'added') result.addedPlannedHours += row.plannedHours;
    else if (row.hasPlan) result.initialPlannedHours += row.initialPlannedHours;
    return result;
  }, { plannedHours: 0, actualHours: 0, initialPlannedHours: 0, addedPlannedHours: 0 });
  totals.varianceHours = totals.actualHours - totals.plannedHours;
  totals.consumptionRate = totals.plannedHours ? totals.actualHours / totals.plannedHours : null;
  const subtasks = hasWorkspace ? (payload.subtasks || []) : demo.subtasks;
  const selectedIds = (payload && payload.calendarIds)
    || (typeof window !== 'undefined' && window.__selectedCalendarIds)
    || DEFAULT_CALENDAR_IDS.slice();
  const workCapacity = workCapacityOverridesFrom(payload);
  const capacityDays = [];
  const capacityStart = new Date(`${rangeFor(type, key).startYmd}T12:00:00`);
  for (let index = 0; index < 120; index++) {
    const date = new Date(capacityStart.getTime() + index * 86400000);
    const dateYmd = formatYmd(date);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const events = weekend ? [] : demoCalendarEvents(date, selectedIds);
    const override = workCapacity[dateYmd];
    const baseHours = override ? override.hours : (weekend ? 0 : 8);
    const meetingHours = events.reduce((sum, event) => sum + (event.blocksTime === false ? 0 : eventHours(event)), 0);
    const countedMeetings = baseHours > 0 ? meetingHours : 0;
    capacityDays.push({
      date: dateYmd,
      baseHours,
      meetingHours: countedMeetings,
      availableHours: Math.max(0, baseHours - countedMeetings),
      eventCount: events.length,
      events,
      capacityReason: override ? override.reason : '',
      capacityOverridden: !!override
    });
  }
  return {
    periodType: type,
    periodKey: key,
    range: rangeFor(type, key),
    rows,
    totals,
    subtasks,
    subtaskProgress: {},
    monthlyAllocation: type === 'week' ? {
      weekKey: key,
      monthKeys: [rangeFor(type, key).startYmd.slice(0, 7)],
      rows: demo.monthlyRows
    } : null,
    capacity: { baseHours: 8, startYmd: capacityDays[0].date, days: capacityDays },
    dailyActualByName: demoDailyActualByName(type, key),
    dailyActualByPlanChild: {},
    storage: {
      configured: true, annual: true, currentYear: 2026, years: [2025, 2026],
      folderName: 'まとめて工数管理さん',
      folderPath: 'マイドライブ / まとめて工数管理さん',
      file: { year: 2026, name: '2026年工数管理データ', url: '#' },
      files: [{ year: 2025, name: '2025年工数管理データ', url: '#' }, { year: 2026, name: '2026年工数管理データ', url: '#' }],
      defaultName: 'まとめて工数管理さん'
    }
  };
}


function dailyTask(title, hours, prevB, prevC, status, extra) {
  return Object.assign({
    title,
    hours,
    prevB,
    prevC,
    status,
    isCarryOver: !!extra && extra.isCarryOver,
    type: extra && extra.type || 'saved'
  }, extra || {});
}

function weekKeyForYmd(dateValue) {
  const thursday = new Date(`${dateValue}T12:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3 - (thursday.getUTCDay() + 6) % 7);
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4, 12));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - (firstThursday.getUTCDay() + 6) % 7);
  return `${year}-W${pad2(1 + Math.round((thursday - firstThursday) / 604800000))}`;
}

// 月のガント表示。月にかかる各週の結果を予定IDでまとめる（本番の loadPlanningMonthGantt と同じ形）。
function monthGanttResult(monthKey, saved) {
  const range = rangeFor('month', monthKey);
  const weekKeys = [];
  let key = weekKeyForYmd(range.startYmd);
  for (let index = 0; index < 8; index++) {
    weekKeys.push(key);
    key = nextWeekKey(key);
    if (rangeFor('week', key).startYmd >= range.endExclusiveYmd) break;
  }
  const byId = {};
  const order = [];
  const subtasks = [];
  const dailyTotals = {};
  const calendarHoursByDate = {};
  weekKeys.forEach(weekKey => {
    const week = rangeFor('week', weekKey);
    const result = planningResult('week', weekKey, saved && saved[`week:${weekKey}`]);
    (result.capacity.days || []).forEach(day => {
      if (day.date >= range.startYmd && day.date < range.endExclusiveYmd) calendarHoursByDate[day.date] = (day.events || []).reduce((total, event) => total + (event.allDay ? 0 : Number(event.durationHours || event.meetingHours || 0)), 0);
    });
    result.rows.forEach(row => {
      Object.keys(row.actualByDate || {}).forEach(date => {
        if (date < week.startYmd || date >= week.endExclusiveYmd) return;
        if (date < range.startYmd || date >= range.endExclusiveYmd) return;
        dailyTotals[date] = (dailyTotals[date] || 0) + Number(row.actualByDate[date] || 0);
      });
      if (!row.hasPlan) return;
      if (byId[row.planId]) {
        Object.keys(row.actualByDate || {}).forEach(date => {
          if (byId[row.planId].actualByDate[date] == null) byId[row.planId].actualByDate[date] = row.actualByDate[date];
        });
        return;
      }
      byId[row.planId] = Object.assign({}, row, { originWeek: weekKey, actualByDate: Object.assign({}, row.actualByDate || {}) });
      order.push(row.planId);
    });
    (result.subtasks || []).forEach(task => subtasks.push(task));
  });
  return {
    periodType: 'month',
    periodKey: monthKey,
    range,
    weekKeys,
    rows: order.map(id => byId[id]),
    subtasks,
    dailyTotals,
    calendarHoursByDate,
    storage: { configured: true, annual: true }
  };
}

function demoWeekKeyForDate(dateValue) {
  const current = currentWeekKey();
  const previous = previousWeekKey(current);
  const contains = key => {
    const range = rangeFor('week', key);
    return dateValue >= range.startYmd && dateValue < range.endExclusiveYmd;
  };
  if (contains(current)) return current;
  if (contains(previous)) return previous;
  return current;
}

function demoParentPlan(weekKey, title) {
  const plans = demoWeekWorkspace(weekKey).plans;
  const name = String(title || '');
  return plans.reduce((match, plan) => {
    const key = plan.aggregationKey;
    const matched = name === key || name.indexOf(key + ' ') === 0;
    if (!matched) return match;
    if (!match || key.length > match.aggregationKey.length) return plan;
    return match;
  }, null);
}

function withDemoProject(task, weekKey) {
  if (task.planId || task.projectId) return task;
  const title = String(task.title || '');
  const plan = task.type === 'interrupt' || task.type === 'calendar' ? null : demoParentPlan(weekKey, title);
  const planId = plan ? `preview-week-${weekKey}-${plan.priority}` : '';
  const subtask = !!(plan && title !== plan.aggregationKey);
  let projectId = subtask || !plan ? '' : (plan.projectId || '');
  if (title.indexOf('問い合わせ対応') === 0) projectId = 'project-ops';
  if (title.indexOf('設計レビュー') === 0) projectId = '';
  return Object.assign({}, task, { planId, projectId });
}

function savedDailyTasks(dateValue) {
  if (typeof window === 'undefined' || !window.__savedDailyTasks) return null;
  const saved = window.__savedDailyTasks[dateValue];
  if (!saved) return null;
  return saved.map(task => dailyTask(task.name, Number(task.a) || 0, Number(task.b) || 0, Number(task.c) || 0, task.d || '', {
    type: task.interrupt ? 'interrupt' : (task.calendar ? 'calendar' : 'saved'),
    planId: task.planId || '',
    projectId: task.projectId || '',
    calendarKey: task.calendarKey || ''
  }));
}

function presentDailyTasks(dateValue, tasks) {
  const weekKey = demoWeekKeyForDate(dateValue);
  return {
    mode: tasks.length ? 'edit' : 'new',
    tasks: tasks.map(task => withDemoProject(task, weekKey)),
    spreadsheetUrl: '#',
    importSource: [],
    needCalendar: false
  };
}

function demoDailyTasks(dateValue) {
  const saved = savedDailyTasks(dateValue);
  if (saved) return presentDailyTasks(dateValue, saved);

  const days35 = weekDates(currentWeekKey());
  const days34 = weekDates(previousWeekKey(currentWeekKey()));
  const catalog = {};
  catalog[days35.mon] = [
    dailyTask('ダッシュボード刷新 調査', 2.5, 5, 12, '↑', { isCarryOver: true }),
    dailyTask('API連携 実装', 1.5, 8, 8, '↓'),
    dailyTask('コードレビュー 指摘確認', 1, 2, 3, ''),
    dailyTask('設計レビュー 仕上げ', 2, 1.5, 2, '↑')
  ];
  catalog[days35.tue] = [
    dailyTask('ダッシュボード刷新 情報設計', 2, 7.5, 12, '↑', { isCarryOver: true }),
    dailyTask('API連携 認証', 2, 9.5, 10, ''),
    dailyTask('権限まわり改修 ロール定義', 2, 0, 4, ''),
    dailyTask('コードレビュー 実装差分', 1, 3, 3, '')
  ];
  catalog[days35.wed] = [
    dailyTask('API連携 エラーハンドリング', 1.25, 11.5, 12, '↓'),
    dailyTask('権限まわり改修 表示制御', 1, 2, 4, ''),
    dailyTask('コードレビュー 再確認', 0.5, 4, 3, '↑'),
    dailyTask('障害対応 切り分け', 1.5, 0, 2.5, ''),
    dailyTask('問い合わせ対応 設定案内', 1.25, 0, 1.25, '完了', { type: 'interrupt' })
  ];
  catalog[days34.mon] = [
    dailyTask('ダッシュボード刷新 調査', 2.5, 2, 12, '', { isCarryOver: true }),
    dailyTask('API連携 実装', 1.5, 4, 8, ''),
    dailyTask('設計レビュー 仕上げ', 2, 0, 2, '完了')
  ];
  catalog[days34.tue] = [
    dailyTask('ダッシュボード刷新 ワイヤー', 2, 4.5, 12, ''),
    dailyTask('API連携 認証', 2, 5.5, 8, ''),
    dailyTask('権限まわり改修 調査', 2, 0, 4, '')
  ];
  catalog[days34.wed] = [
    dailyTask('ダッシュボード刷新 実装', 2, 6.5, 12, ''),
    dailyTask('API連携 結合', 1.25, 7.5, 8, ''),
    dailyTask('オンボーディング資料 構成', 1.5, 0, 6, ''),
    dailyTask('障害対応 切り分け', 1.5, 0, 2.5, ''),
    dailyTask('問い合わせ対応 設定案内', 1.25, 0, 1.25, '完了', { type: 'interrupt' })
  ];
  catalog[days34.thu] = [
    dailyTask('ダッシュボード刷新 調整', 2.5, 8.5, 12, ''),
    dailyTask('API連携 試験', 2, 8.75, 8, '↑'),
    dailyTask('ドキュメント整備 運用手順', 2.5, 0, 4, ''),
    dailyTask('障害対応 再発防止', 1, 1.5, 3, '')
  ];
  catalog[days34.fri] = [
    dailyTask('API連携 リリース準備', 2.5, 10.75, 8, '↑'),
    dailyTask('ドキュメント整備 レビュー', 1, 2.5, 4, ''),
    dailyTask('リリース判定 チェックリスト', 2, 0, 2, '完了'),
    dailyTask('問い合わせ対応 フォロー', 0.75, 0, 0.75, '完了', { type: 'interrupt' })
  ];
  if (catalog[dateValue]) return presentDailyTasks(dateValue, catalog[dateValue]);
  const date = new Date(dateValue + 'T12:00:00');
  const weekday = date.getDay();
  if (weekday === 0 || weekday === 6) {
    return { mode: 'new', tasks: [], spreadsheetUrl: '#', importSource: [], needCalendar: false };
  }
  return presentDailyTasks(dateValue, [
    dailyTask('ダッシュボード刷新 調査', 2, 4, 12, '', { isCarryOver: true }),
    dailyTask('API連携 実装', 1.5, 6, 8, ''),
    dailyTask('設計レビュー 仕上げ', 1, 1, 2, ''),
    dailyTask('問い合わせ対応 設定案内', 1, 0, 1, '完了', { type: 'interrupt' })
  ]);
}

function demoTaskNames() {
  return [
    'ダッシュボード刷新', 'API連携', '権限まわり改修', 'コードレビュー',
    'ドキュメント整備', 'リリース判定', 'オンボーディング資料', '障害対応',
    '問い合わせ対応', '設計レビュー', '運用手順の整理', '定例ミーティング',
    'ダッシュボード刷新 調査', 'ダッシュボード刷新 情報設計', 'ダッシュボード刷新 ワイヤー',
    'ダッシュボード刷新 実装', 'ダッシュボード刷新 調整', 'ダッシュボード刷新 作業',
    'API連携 実装', 'API連携 認証', 'API連携 エラーハンドリング', 'API連携 結合',
    'API連携 試験', 'API連携 リリース準備',
    '権限まわり改修 ロール定義', '権限まわり改修 表示制御', '権限まわり改修 調査',
    'コードレビュー 指摘確認', 'コードレビュー 実装差分', 'コードレビュー 再確認', 'コードレビュー 確認',
    '設計レビュー 仕上げ', 'ドキュメント整備 運用手順', 'ドキュメント整備 レビュー',
    'リリース判定 チェックリスト', 'オンボーディング資料 構成',
    '障害対応 切り分け', '障害対応 再発防止',
    '問い合わせ対応 設定案内', '問い合わせ対応 フォロー'
  ];
}

function demoDailyActualByName(type, key) {
  if (type !== 'week') return {};
  const result = {};
  const keys = [key];
  let cursor = key;
  for (let i = 0; i < 16; i++) {
    cursor = previousWeekKey(cursor);
    if (!savedWeekKind(cursor)) continue;
    keys.push(cursor);
  }
  keys.forEach(weekKey => {
    const range = rangeFor('week', weekKey);
    let day = range.startYmd;
    while (day < range.endExclusiveYmd) {
      const daily = demoDailyTasks(day);
      (daily.tasks || []).forEach(task => {
        if (!task || task.type === 'interrupt' || task.type === 'calendar') return;
        const name = String(task.title || '').trim();
        if (!name) return;
        result[name] = result[name] || {};
        result[name][day] = (result[name][day] || 0) + (Number(task.hours) || 0);
      });
      day = addDaysYmd(day, 1);
    }
  });
  return result;
}

function demoHoursBeforeName(named, name, beforeYmd) {
  let total = 0;
  Object.keys((named && named[name]) || {}).forEach(date => {
    if (String(date) < String(beforeYmd || '')) total += Number(named[name][date] || 0);
  });
  return Math.round(total * 4) / 4;
}

function demoChildHoursBefore(named, parent, childTitle, beforeYmd) {
  const parentName = String(parent || '').trim();
  const child = String(childTitle || '').trim();
  if (!parentName || !child) return 0;
  const exact = demoHoursBeforeName(named, parentName + ' ' + child, beforeYmd) || demoHoursBeforeName(named, child, beforeYmd);
  if (exact > 0) return exact;
  let total = 0;
  Object.keys(named || {}).forEach(name => {
    if (name === parentName || name.indexOf(parentName + ' ') !== 0) return;
    const rest = name.slice(parentName.length + 1).trim();
    if (!rest) return;
    if (child === rest || child.indexOf(rest) === 0 || rest.indexOf(child) === 0) {
      total += demoHoursBeforeName(named, name, beforeYmd);
    }
  });
  return Math.round(total * 4) / 4;
}

function demoImportSuggestions(dateStr) {
  const date = String(dateStr || formatYmd(new Date())).trim() || formatYmd(new Date());
  const demo = demoWeekWorkspace(currentWeekKey());
  const named = demoDailyActualByName('week', currentWeekKey());
  const byParent = {};
  (demo.subtasks || []).forEach(task => {
    const parent = String(task.parentKey || '').trim();
    if (!parent) return;
    (byParent[parent] = byParent[parent] || []).push({
      title: task.title,
      plannedHours: task.plannedHours,
      parentKey: parent,
      prevB: demoChildHoursBefore(named, parent, task.title, date),
      prevC: task.plannedHours,
      sortOrder: task.sortOrder || 0
    });
  });
  return [
    { title: 'ダッシュボード刷新', hours: 0, prevB: 5.25, prevC: 8, status: '', type: 'planning' },
    { title: 'API連携', hours: 0, prevB: 4.75, prevC: 6, status: '', type: 'planning' },
    { title: '権限まわり改修', hours: 0, prevB: 3, prevC: 4, status: '', type: 'planning' },
    { title: 'コードレビュー', hours: 0, prevB: 2.5, prevC: 3, status: '', type: 'planning' },
    { title: 'ドキュメント整備', hours: 0, prevB: 0, prevC: 3, status: '', type: 'planning' },
    { title: 'リリース判定', hours: 0, prevB: 0, prevC: 2, status: '', type: 'planning' },
    { title: 'オンボーディング資料', hours: 0, prevB: 0, prevC: 3, status: '', type: 'planning' },
    { title: '障害対応', hours: 0, prevB: 1.5, prevC: 2.5, status: '', type: 'planning' },
    { title: '設計レビュー', hours: 0, prevB: 2, prevC: 2, status: '', type: 'planning', carryWeek: previousWeekKey(currentWeekKey()), carry: true },
    // 来週から始まる予定。実績画面では「これから」に出て、前倒しで今日に入れられる。
    { title: '移行リハーサル', hours: 0, prevB: 0, prevC: 4, status: '', type: 'planning', periodKey: nextWeekKey(currentWeekKey()), startDate: weekDates(nextWeekKey(currentWeekKey())).mon, endDate: weekDates(nextWeekKey(currentWeekKey())).wed }
  ].map(item => {
    const periodKey = item.periodKey || item.carryWeek || currentWeekKey();
    const sourcePlan = demoWorkspace('week', periodKey).plans.find(plan => plan.aggregationKey === item.title);
    const fallbackId = `preview-week-${periodKey}-${sourcePlan && sourcePlan.priority != null ? sourcePlan.priority : item.title}`;
    return Object.assign({}, item, {
      periodType: 'week',
      periodKey,
      originWeek: periodKey,
      planId: sourcePlan && sourcePlan.planId || fallbackId,
      projectId: sourcePlan && sourcePlan.projectId || '',
      startDate: item.startDate || (sourcePlan && sourcePlan.startDate) || '',
      endDate: item.endDate || (sourcePlan && sourcePlan.endDate) || '',
      undated: !!(sourcePlan && sourcePlan.undated),
      subtasks: byParent[item.title] || []
    });
  });
}

module.exports = {
  PLANNING_CALENDARS,
  DEFAULT_CALENDAR_IDS,
  rangeFor,
  nextWeekKey,
  previousWeekKey,
  currentWeekKey,
  addDaysYmd,
  demoCalendarEvents,
  demoWorkspace,
  projectCapacityForMonth,
  projectWorkspace,
  saveProject,
  saveProjectWorkspace,
  saveProjectMonthly,
  planningResult,
  monthGanttResult,
  demoDailyTasks,
  demoTaskNames,
  demoImportSuggestions,
  saveWorkCapacitySetting
};
