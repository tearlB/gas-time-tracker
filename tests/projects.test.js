const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createApi() {
  const sheets = {
    'file-2026': {
      'プロジェクト': [
        ['project-a', '案件A', '説明', 'active', '2026-09-01', '', '2026/09/01 09:00:00', '2026/09/01 09:00:00']
      ],
      'プロジェクト月次': [
        ['project-a', '2026-09', 40, '', '2026/09/01 09:00:00'],
        ['project-a', '2026-10', 40, '', '2026/10/01 09:00:00'],
        ['project-a', '2026-11', 40, '', '2026/11/01 09:00:00']
      ],
      '予実計画': []
    }
  };
  const daily = { 'file-2026': [] };
  const context = {
    console,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: {
      formatDate(date, timezone, pattern) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        if (pattern === 'yyyy-MM-dd') return year + '-' + month + '-' + day;
        if (pattern === 'yyyy-MM') return year + '-' + month;
        return year + '/' + month + '/' + day + ' 00:00:00';
      },
      getUuid: () => 'uuid'
    },
    formatDateCellValue(value) {
      return String(value || '').replace(/-/g, '/');
    },
    isAnnualStorage: () => true,
    getAnnualStorageFileMap: () => ({ 2026: 'file-2026' }),
    getSpreadsheetIdForYear: () => 'file-2026',
    requireSpreadsheetIdForYear: () => 'file-2026',
    requireSheetsApi() {},
    loadSheetValuesDirect(id, name) {
      return { values: (sheets[id] && sheets[id][name]) || [] };
    },
    getAppStorageStatus: () => ({ configured: true }),
    withUserWriteLock(fn) { return fn(); },
    sanitizeEnteredString(value) { return String(value || ''); },
    currentStorageYear: () => 2026,
    normalizeStorageYear(year) { return Number(year); },
    sheets,
    daily
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/budget.gs'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/legacy.gs'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/projects.gs'), 'utf8'), context);
  context.ensureProjectMonthlySheet = () => {};
  context.projectWriteRows = (id, name, header, rows) => { sheets[id][name] = rows; };
  context.loadBudgetPlanRows = id => (sheets[id] && sheets[id]['予実計画']) || [];
  context.loadBudgetDailyRowsForYmdRange = (id, start, end) => (daily[id] || []).filter(row => {
    const date = String(row[0]).replace(/\//g, '-');
    return date >= start && date < end;
  });
  context.setPlans = plans => {
    sheets['file-2026']['予実計画'] = plans.map(plan => [
      plan.periodType, plan.periodKey, plan.name, plan.planned, '', '2026/10/01 09:00:00',
      0, plan.planned, plan.planned, 'initial', '2026/10/01 09:00:00',
      plan.planId, '', '', '', '', '', '', plan.projectId || ''
    ]);
  };
  context.setDaily = rows => { daily['file-2026'] = rows; };
  return context;
}

function projectOf(api, month) {
  return api.loadProjectWorkspace(month).projects[0];
}

test('同じ週の日次工数はプロジェクトの実績になる', () => {
  const api = createApi();
  api.setPlans([{ periodType: 'week', periodKey: '2026-W40', name: '設計', planned: 8, planId: 'plan-1', projectId: 'project-a' }]);
  api.setDaily([
    ['2026/10/01', '設計 調査', 2, 0, 8, '', '', 'plan-1'],
    ['2026/10/02', '設計 実装', 1.5, 0, 8, '', '', 'plan-1'],
    ['2026/10/02', '朝会', 0.5, 0, 0.5, '', 'カレンダー', 'plan-1']
  ]);
  const project = projectOf(api, '2026-10');
  assert.equal(project.actualHours, 4);
  assert.equal(project.taskPlannedHours, 8);
  assert.equal(project.issues.length, 1);
  assert.equal(project.issues[0].actualHours, 4);
  assert.equal(project.issues[0].status, '進行中');
});

test('サブタスクに付いたプロジェクトIDは無視して親の課題へ集計する', () => {
  const api = createApi();
  api.sheets['file-2026']['プロジェクト'].push(['project-b', '案件B', '', 'active', '', '', '', '']);
  api.setPlans([{ periodType: 'week', periodKey: '2026-W40', name: '設計', planned: 8, planId: 'plan-1', projectId: 'project-a' }]);
  api.setDaily([
    ['2026/10/01', '設計 調査', 2, 0, 8, '', '', 'plan-1', 'project-b'],
    ['2026/10/01', '問い合わせ', 1, 0, 1, '', '割り込み', '', 'project-b']
  ]);
  const workspace = api.loadProjectWorkspace('2026-10');
  const parent = workspace.projects.find(project => project.id === 'project-a');
  const interrupt = workspace.projects.find(project => project.id === 'project-b');
  assert.equal(parent.actualHours, 2);
  assert.equal(parent.issues.length, 1);
  assert.equal(parent.issues[0].name, '設計');
  assert.equal(parent.issues[0].actualHours, 2);
  assert.equal(interrupt.actualHours, 1);
  assert.equal(interrupt.issues[0].name, '問い合わせ');
  assert.equal(interrupt.issues[0].plannedHours, 0);
  assert.equal(interrupt.issues[0].status, '進行中');
});

test('前月で終わった課題でも、今月入力した工数は今月の実績に入る', () => {
  const api = createApi();
  api.setPlans([{ periodType: 'week', periodKey: '2026-W39', name: '設計', planned: 8, planId: 'plan-1', projectId: 'project-a' }]);
  api.setDaily([
    ['2026/09/22', '設計 調査', 3, 0, 8, '', '', 'plan-1'],
    ['2026/09/30', '設計 調査', 1, 0, 8, '', '', 'plan-1'],
    ['2026/10/06', '設計 調査', 4, 0, 8, '', '', 'plan-1']
  ]);
  const september = projectOf(api, '2026-09');
  const october = projectOf(api, '2026-10');
  assert.equal(september.actualHours, 4);
  assert.equal(october.actualHours, 4);
  assert.equal(october.issues.length, 1);
  assert.equal(october.issues[0].plannedHours, 8);
  assert.equal(october.issues[0].actualHours, 4);
  assert.equal(october.issues[0].periodKey, '2026-W39');
  assert.equal(october.taskPlannedHours, 8);
});

test('同じ課題を複数週に保存しても予定は一度だけで、月内の実績は合算する', () => {
  const api = createApi();
  api.setPlans([
    { periodType: 'week', periodKey: '2026-W40', name: '設計', planned: 8, planId: 'plan-1', projectId: 'project-a' },
    { periodType: 'week', periodKey: '2026-W41', name: '設計', planned: 8, planId: 'plan-1', projectId: 'project-a' }
  ]);
  api.setDaily([
    ['2026/10/01', '設計', 6, 0, 8, '', '', 'plan-1'],
    ['2026/10/08', '設計', 6, 0, 8, '', '', 'plan-1']
  ]);
  const project = projectOf(api, '2026-10');
  assert.equal(project.issues.length, 1);
  assert.equal(project.issues[0].plannedHours, 8);
  assert.equal(project.issues[0].actualHours, 12);
  assert.equal(project.issues[0].status, '超過');
  assert.equal(JSON.stringify(Array.from(project.issues[0].periodKeys)), JSON.stringify(['2026-W40', '2026-W41']));
  assert.equal(project.taskPlannedHours, 8);
  assert.equal(project.actualHours, 12);
});

test('プロジェクト未設定の同名課題へは工数を付け替えない', () => {
  const api = createApi();
  api.setPlans([
    { periodType: 'week', periodKey: '2026-W40', name: '設計', planned: 8, planId: 'plan-linked', projectId: 'project-a' },
    { periodType: 'week', periodKey: '2026-W41', name: '設計', planned: 4, planId: 'plan-free', projectId: '' }
  ]);
  api.setDaily([['2026/10/08', '設計 調査', 3, 0, 4, '', '', 'plan-free']]);
  const project = projectOf(api, '2026-10');
  assert.equal(project.actualHours, 0);
  assert.equal(project.issues[0].actualHours, 0);
});

test('予定にプロジェクトがなくても、日次で選んだプロジェクトの実績になる', () => {
  const api = createApi();
  api.sheets['file-2026']['プロジェクト'].push(['project-b', '案件B', '', 'active', '', '', '', '']);
  api.setPlans([{ periodType: 'week', periodKey: '2026-W40', name: '設計', planned: 8, planId: 'plan-free', projectId: '' }]);
  api.setDaily([['2026/10/01', '設計', 2, 0, 8, '', '', 'plan-free', 'project-b']]);
  const project = api.loadProjectWorkspace('2026-10').projects.find(entry => entry.id === 'project-b');
  assert.equal(project.actualHours, 2);
  assert.equal(project.issues[0].name, '設計');
  assert.equal(project.issues[0].plannedHours, 0);
  assert.equal(project.issues[0].status, '進行中');
});

test('プロジェクトを選んでいない課題の工数は集計しない', () => {
  const api = createApi();
  api.setPlans([{ periodType: 'week', periodKey: '2026-W40', name: '設計', planned: 8, planId: 'plan-free', projectId: '' }]);
  api.setDaily([['2026/10/01', '設計', 2, 0, 8, '', '', 'plan-free']]);
  const project = projectOf(api, '2026-10');
  assert.equal(project.actualHours, 0);
  assert.equal(project.issues.length, 0);
});

test('課題登録は表示中の月の今日の週を開き、別の月ではその月に始まる週を開く', () => {
  const core = fs.readFileSync(path.join(__dirname, '../ui/core.js'), 'utf8');
  const projects = fs.readFileSync(path.join(__dirname, '../ui/projects.js'), 'utf8');
  const planning = fs.readFileSync(path.join(__dirname, '../ui/planning_data.js'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../ui/settings.js'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '../ui/index.template.html'), 'utf8');
  const context = { state: { project: { monthKey: '2026-10' } } };
  vm.createContext(context);
  vm.runInContext([
    core.slice(core.indexOf('function pad2('), core.indexOf('function showBusy(')),
    core.slice(core.indexOf('function isProjectMonthKey('), core.indexOf('function currentViewState(')),
    planning.slice(planning.indexOf('function isoWeek('), planning.indexOf('function discardDailyDraftForPlannerNavigation(')),
    projects.slice(projects.indexOf('function projectMonthForToday('), projects.indexOf('function shiftProjectMonthKey('))
  ].join('\n'), context);
  const today = new Date(2026, 9, 15, 12);
  assert.equal(context.projectIssueWeekKey('2026-10', today), '2026-W42');
  assert.equal(context.projectIssueWeekKey('2026-11', today), '2026-W45');
  assert.equal(context.projectIssueWeekKey('2026-09', today), '2026-W37');
  assert.match(settings, /projectIssueWeekKey\(monthKey\)/);
  assert.doesNotMatch(settings, /isoWeek\(parseYmd\(monthKey \+ '-01'\)\)/);
  assert.doesNotMatch(projects, /data-project-action="save-month"/);
  assert.match(projects, /function scheduleProjectMonthAutoSave\(/);
  assert.match(projects, /saveProjectMonthEditors\(\{ auto: true \}\)/);
  assert.match(projects, /state\.project\.saving && !options\.duringSave/);
  assert.match(projects, /プロジェクトを選ばないと、この予定の実績はプロジェクトに集計されません/);
  assert.match(template, /未設定の実績はプロジェクトに入りません/);
});

test('割合で保存した予定稼働は、月の合計が変わると時間を計算し直す', () => {
  const api = createApi();
  api.sheets['file-2026']['プロジェクト月次'][1][5] = '50%';
  const project = projectOf(api, '2026-10');
  assert.equal(project.plannedShareText, '50%');
  assert.equal(project.plannedHours, api.roundHours(project.onePersonMonthHours * 0.5));
  assert.notEqual(project.plannedHours, 40);
});

test('予定稼働は月の割合から時間になる', () => {
  const source = fs.readFileSync(path.join(__dirname, '../ui/projects.js'), 'utf8');
  const start = source.indexOf('function parseProjectMonthHours');
  const end = source.indexOf('function projectMonthPreviewText');
  const context = { roundHours(value) { return Math.round((Number(value) || 0) * 4) / 4; } };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const parse = context.parseProjectMonthHours;
  assert.equal(parse('80', 160).hours, 80);
  assert.equal(parse('50%', 160).hours, 80);
  assert.equal(parse('50％', 160).hours, 80);
  assert.equal(parse('5割', 160).hours, 80);
  assert.equal(parse('月の3割', 160).hours, 48);
  assert.equal(parse('1/2', 160).hours, 80);
  assert.equal(parse('*0.25', 160).hours, 40);
  assert.equal(parse('1人月*0.1', 160).hours, 16);
  assert.equal(parse('50%', 0).hours, 0);
  assert.equal(parse('80h', 160).share, 0.5);
  const plan = context.parseProjectMonthPlan;
  assert.equal(plan('50', 160, 'share').hours, 80);
  assert.equal(plan('50', 160, 'share').formula, '50%');
  assert.equal(plan('50', 160, 'hours').hours, 50);
  assert.equal(plan('50%', 160, 'hours').ok, false);
});


test('割合の予定稼働は、月の稼働時間から固定時間を引いた残りから計算する', () => {
  const api = createApi();
  api.sheets['file-2026']['プロジェクト'].push(
    ['project-b', '案件B', '', 'active', '', '', '', ''],
    ['project-c', '案件C', '', 'active', '', '', '', '']
  );
  api.projectCapacityForMonth = () => ({ availableHours: 160, baseHours: 160, meetingHours: 0 });
  api.sheets['file-2026']['プロジェクト月次'].push(
    ['project-a', '2026-10', 40, '', ''],
    ['project-b', '2026-10', 999, '', '', '50%'],
    ['project-c', '2026-10', 999, '', '', '25%']
  );
  let workspace = api.loadProjectWorkspace('2026-10');
  assert.equal(workspace.totals.fixedPlannedHours, 40);
  assert.equal(workspace.totals.shareBasisHours, 120);
  assert.equal(workspace.projects.find(project => project.id === 'project-b').plannedHours, 60);
  assert.equal(workspace.projects.find(project => project.id === 'project-c').plannedHours, 30);
  api.saveProjectMonthly({ projectId: 'project-a', monthKey: '2026-10', plannedHours: 80 });
  workspace = api.loadProjectWorkspace('2026-10');
  assert.equal(workspace.projects.find(project => project.id === 'project-b').plannedHours, 40);
  assert.equal(workspace.projects.find(project => project.id === 'project-c').plannedHours, 20);
  api.saveProjectMonthly({ projectId: 'project-a', monthKey: '2026-10', plannedHours: 200 });
  workspace = api.loadProjectWorkspace('2026-10');
  assert.equal(workspace.projects.find(project => project.id === 'project-b').plannedHours, 0);
});

test('固定から割合への保存は、固定時間を引いた残りからサーバーで時間を再計算する', () => {
  const api = createApi();
  api.projectCapacityForMonth = () => ({ availableHours: 160, baseHours: 160, meetingHours: 0 });
  api.sheets['file-2026']['プロジェクト'].push(['project-b', '案件B', '', 'active', '', '', '', '']);
  api.sheets['file-2026']['プロジェクト月次'].push(['project-b', '2026-10', 40, '', '']);
  const saved = api.saveProjectMonthly({ projectId: 'project-a', monthKey: '2026-10', plannedHours: 1, plannedShareText: '50%' });
  assert.equal(saved.plannedHours, 60);
  assert.equal(api.loadProjectWorkspace('2026-10').projects.find(project => project.id === 'project-a').plannedHours, 60);
});


test('画面の割合プレビューも固定時間を引いた残りを基準にする', () => {
  const source = fs.readFileSync(path.join(__dirname, '../ui/projects.js'), 'utf8');
  const start = source.indexOf('function parseProjectMonthHours');
  const end = source.indexOf('function projectMonthCardMode');
  const fixed = { id: 'fixed', plannedHours: 40, onePersonMonthHours: 160, shareBasisHours: 120 };
  const share = { id: 'share', plannedHours: 60, plannedShareText: '50%', onePersonMonthHours: 160, shareBasisHours: 120 };
  const context = {
    roundHours: value => Math.round(Number(value) * 4) / 4,
    hours: value => Number(value).toFixed(2),
    compactHours: value => String(Math.round(Number(value) * 4) / 4),
    state: { project: { workspace: { projects: [fixed, share] } } }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  assert.equal(context.projectShareBasisHours(share), 120);
  assert.equal(context.projectShareBasisHours(fixed), 120);
  assert.equal(context.parseProjectMonthPlan('50', context.projectShareBasisHours(share), 'share').hours, 60);
  assert.match(context.projectMonthPreviewText('50', 120, 'share'), /固定を除いた稼働 120h × 50% ＝ 60h/);
});
