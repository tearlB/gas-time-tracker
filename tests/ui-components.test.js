const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../ui/components.js'), 'utf8');
const components = vm.runInNewContext(source + '\n({ emptyStateHtml, projectMetricHtml, backlogIssueFromClipboard, planSummaryTitleHtml })');

test('shared empty state escapes data returned by external services', () => {
  const html = components.emptyStateHtml('読み込み失敗', '<img src=x onerror=alert(1)>');
  assert.match(html, /<strong>読み込み失敗<\/strong>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
});

test('Backlog の課題URLがあるときだけ課題キーをリンクにする', () => {
  const url = 'https://example.backlog.jp/view/DEMO_APP_WEB-12';
  assert.deepEqual({ ...components.backlogIssueFromClipboard('', url + ' サンプル課題の追加対応') }, { name: 'DEMO_APP_WEB-12 サンプル課題の追加対応', url });
  assert.equal(components.backlogIssueFromClipboard('', 'DEMO_APP_WEB-12 サンプル課題の追加対応'), null);
  assert.equal(components.backlogIssueFromClipboard('', 'https://example.com/view/DEV-1 件名'), null);

  const linked = components.planSummaryTitleHtml('DEMO_APP_WEB-12 サンプル課題の追加対応', url);
  assert.match(linked, /<a class="span-name-key" href="https:\/\/example\.backlog\.jp\/view\/DEMO_APP_WEB-12" target="_blank"/);
  assert.match(linked, /<span class="span-name-description">サンプル課題の追加対応<\/span>/);
  assert.doesNotMatch(components.planSummaryTitleHtml('DEMO_APP_WEB-12 サンプル課題の追加対応', ''), /span-name-key/);
  assert.doesNotMatch(components.planSummaryTitleHtml('別の課題名', url), /span-name-key/);
});

test('reopened parent remains selectable for actuals when all subtasks are complete', () => {
  const core = fs.readFileSync(path.join(__dirname, '../ui/core.js'), 'utf8');
  const start = core.indexOf('function dailySelectableIssues(date)');
  const end = core.indexOf('function weeklyHasNamedIssue(', start);
  const context = {
    existingNames: () => [],
    dailyHoursBeforeByName: () => ({}),
    priorDailySources: () => [],
    weeklyHoursByPlanChild: () => ({}),
    dailySelectablePlanSources: () => [{ name: '再開した課題', planId: 'plan-1', periodKey: '2026-W38', plannedHours: 2, prevB: 2, completionOverride: false }],
    dailyPlanSourcePeriodKey: source => source.periodKey,
    dailyPlanSourceCanComplete: () => false,
    dailyPlanSourceIsComplete: source => source.completionOverride !== false,
    weeklySubtasksForParent: () => [{ title: '旧作業', status: 'done' }],
    dailySubtaskIsComplete: task => task.status === 'done',
    isoWeek: () => '2026-W39',
    parseYmd: value => value,
    roundHours: value => Number(value || 0),
    planDateRange: () => ({ start: '2026-09-14', end: '2026-09-18', explicitEnd: false }),
    planDatePosition: (range, date) => date > range.end ? 'after' : date < range.start ? 'before' : 'within'
  };
  const groups = vm.runInNewContext(core.slice(start, end) + '\ndailySelectableIssues("2026-09-25")', context);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].issues[0].name, '再開した課題');
  assert.equal(groups[0].issues[0].previousHours, 2);
  // 候補にも予定期間を持たせ、期限を過ぎた予定だと分かるようにする
  assert.equal(groups[0].range.end, '2026-09-18');
  assert.equal(groups[0].position, 'after');
});

test('shared project metric keeps text data inside its fields', () => {
  const html = components.projectMetricHtml('予定稼働', '<script>', 'h', 'is-alert');
  assert.match(html, /class="project-metric is-alert"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('generated GAS page contains shared UI and complete screen scripts', () => {
  const html = fs.readFileSync(path.join(__dirname, '../gas/index.html'), 'utf8');
  assert.match(html, /function emptyStateHtml\(/);
  assert.match(html, /function renderDaily\(/);
  assert.match(html, /function renderProjectScreen\(/);
  assert.match(html, /function renderWeekCalendar\(/);
  assert.match(html, /customElements\.define|customElement\(/);
  assert.match(html, /window\.uiLibraries=/);
  assert.match(html, /<md-filled-button class="primary-button" id="addPlan"/);
  assert.doesNotMatch(html, /<!-- UI_(?:STYLES|SCRIPT) -->/);
  assert.doesNotMatch(html, /<\?>(?:[^<]*)<\/script>/);
});

test('project card uses the shared metric markup for every figure', () => {
  const projectSource = fs.readFileSync(path.join(__dirname, '../ui/projects.js'), 'utf8');
  const start = projectSource.indexOf('function projectCardHtml(');
  const end = projectSource.indexOf('function renderProjectScreen(', start);
  const context = {
    state: { project: { openSettings: {} } },
    projectMonthlyStatusClass: () => 'is-ok',
    projectIssueStatusClass: () => 'is-ok',
    roundHours: value => Number(value || 0),
    projectStatusClass: () => 'active',
    projectStatusLabelText: () => '稼働中',
    projectDateRangeLabel: () => '2026年',
    hours: value => Number(value || 0).toFixed(2),
    projectRemainingText: value => Number(value || 0).toFixed(2),
    projectPercent: () => '25%',
    // カード内の月次設定（固定・割合）の欄。このテストは数字の欄だけを見るので簡単な代わりで足りる。
    projectMonthModeOf: project => (project && project.plannedShareText ? 'share' : 'hours'),
    projectMonthFieldValue: () => '20',
    projectShareBasisHours: () => 160,
    projectMonthPreviewText: () => '20h',
    projectIssuesOpen: () => false,
    projectIssuePeriodText: () => ''
  };
  vm.createContext(context);
  vm.runInContext(source + projectSource.slice(start, end), context);
  const html = context.projectCardHtml({ id: 'p1', name: '開発', issues: [], plannedHours: 20, actualHours: 5, remainingHours: 15 });
  assert.equal((html.match(/class="project-metric(?: [^"]+)?"/g) || []).length, 4);
  assert.match(html, /<span>予定稼働<\/span><strong>20\.00<small>h<\/small>/);
  assert.match(html, /class="project-month-hours" data-month-mode="hours"/);
});

test('actual rows delete with a trash icon and measurement can be cancelled without recording', () => {
  const daily = fs.readFileSync(path.join(__dirname, '../ui/daily.js'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '../ui/index.template.html'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(__dirname, '../ui/bootstrap.js'), 'utf8');
  const row = daily.slice(daily.indexOf("'<td class=\"row-actions\">"), daily.indexOf('setDailyRowComplete('));
  assert.match(row, /aria-label="この実績を削除"/);
  assert.match(row, />delete</);
  assert.doesNotMatch(row, />close</);
  assert.match(template, /id="pauseTimer"[^>]*>[\s\S]*?>pause<\/span>[\s\S]*id="stopTimer"[^>]*aria-label="停止して記録"[^>]*>[\s\S]*?>check<\/span>[\s\S]*id="cancelTimer"[^>]*aria-label="計測をキャンセル"[^>]*>[\s\S]*?>close<\/span>/);
  const recorded = daily.slice(daily.indexOf('function finishTimer('), daily.indexOf('function cancelTimer('));
  assert.match(recorded, /showRecordedDailyRow\(el\.dataset\.id, addition\)/);
  assert.match(daily, /class="recorded-delta"/);
  const renderDaily = daily.slice(daily.indexOf('function renderDaily('), daily.indexOf('function dailyIssueCellHtml('));
  assert.match(renderDaily, /applyRecordedDailyRow\(\)/);
  assert.match(recorded, /「' \+ taskName \+ '」の本日実績に /);
  const cancel = daily.slice(daily.indexOf('function cancelTimer('), daily.indexOf('function syncTimerButton('));
  assert.match(cancel, /finishTimer\(false\)/);
  assert.doesNotMatch(cancel, /finishTimer\(true\)/);
  assert.match(bootstrap, /getElementById\('cancelTimer'\)\.addEventListener\('click', cancelTimer\)/);
});

test('timer stays on the measured subtask when siblings share a parent plan', () => {
  const daily = fs.readFileSync(path.join(__dirname, '../ui/daily.js'), 'utf8');
  const start = daily.indexOf('function timerIdentityMatches(');
  const end = daily.indexOf('function timerRowIsActive(', start);
  const match = vm.runInNewContext(daily.slice(start, end) + '\ntimerIdentityMatches', {});
  const timer = { planId: 'plan-1', task: '設計 調査', calendarKey: '' };
  assert.equal(match('plan-1', '', '設計 調査', timer), true);
  assert.equal(match('plan-1', '', '設計 実装', timer), false);
  assert.equal(match('plan-1', '', '設計', timer), false);
});

test('機能の説明（ⓘ）は、説明文を吹き出し用に持ち、読み上げにも説明を付ける', () => {
  const { tipHtml } = require('../ui/components.js');
  const html = tipHtml({ text: '予定は"期間"で押さえる <b>' });
  assert.match(html, /class="ui-tip"/);
  assert.match(html, /data-tip="予定は&quot;期間&quot;で押さえる &lt;b&gt;"/);
  assert.match(html, /aria-label="説明: 予定は&quot;期間&quot;で押さえる &lt;b&gt;"/);
  assert.match(html, /<span class="material-symbols-outlined" aria-hidden="true">info<\/span>/);
});

test('ⓘ に使うアイコンをアイコン用フォントの一覧に含める', () => {
  const template = require('node:fs').readFileSync(require('node:path').join(__dirname, '../ui/index.template.html'), 'utf8');
  const names = /icon_names=([a-z_,]+)/.exec(template)[1].split(',');
  assert.ok(names.includes('info'));
  assert.deepEqual(names, names.slice().sort(), 'Google Fonts の icon_names はアルファベット順で指定する');
});
