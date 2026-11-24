const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { page } = require('../scripts/preview-server');
const {
  planningResult,
  currentWeekKey,
  previousWeekKey,
  nextWeekKey,
  rangeFor,
  addDaysYmd,
  demoDailyTasks,
  demoCalendarEvents,
  demoImportSuggestions,
  projectWorkspace,
  saveProject,
  saveProjectMonthly,
  saveWorkCapacitySetting,
  setDemoToday
} = require('../scripts/preview-data');

// サンプルの実績は「今日」より前の日にだけ入るので、テストでは今週の木曜を今日とする。
setDemoToday(addDaysYmd(rangeFor('week', currentWeekKey()).startYmd, 3));
const currentWeek = currentWeekKey();
const previousWeek = previousWeekKey(currentWeek);
const currentMonday = rangeFor('week', currentWeek).startYmd;
const previousMonday = rangeFor('week', previousWeek).startYmd;

function withPreviewWindow(callback) {
  const hadWindow = Object.prototype.hasOwnProperty.call(global, 'window');
  const previousWindow = global.window;
  global.window = {};
  try {
    return callback(global.window);
  } finally {
    if (hadWindow) global.window = previousWindow;
    else delete global.window;
  }
}

test('プレビューの予定は週ごとに別で、実績が予定を超えず、過去の予定は完了している', () => {
  const twoWeeksAgo = previousWeekKey(previousWeek);
  const weeks = [currentWeek, previousWeek, twoWeeksAgo].map(key => planningResult('week', key));
  const names = weeks.map(week => week.rows.filter(row => row.hasPlan).map(row => row.aggregationKey));
  const all = names.flat();
  assert.equal(new Set(all).size, all.length, '同じ名前の予定を複数の週に置かない');
  weeks.forEach(week => week.rows.filter(row => row.hasPlan).forEach(row => {
    assert.ok(row.actualHours <= row.plannedHours, `${week.periodKey} ${row.aggregationKey} が予定を超えている`);
  }));
  weeks.slice(1).forEach(week => week.rows.filter(row => row.hasPlan).forEach(row => assert.equal(row.complete, true)));
  const today = addDaysYmd(currentMonday, 3);
  weeks[0].rows.forEach(row => Object.keys(row.actualByDate).forEach(date => assert.ok(date < today, '今日以降に実績を入れない')));
});

test('プレビューの今週は予定・実績・会議で埋まっている', () => {
  const week = planningResult('week', currentWeek);
  const planned = week.rows.filter(row => row.hasPlan).length;
  assert.ok(planned >= 5 && planned <= 7, '今週の予定は見やすい件数にとどめる');
  assert.ok(week.rows.some(row => row.planKind === 'added'));
  assert.ok(week.rows.some(row => !row.hasPlan && row.actualHours > 0));
  assert.ok(week.rows.some(row => Object.keys(row.actualByDate || {}).length >= 2));
  assert.ok(week.totals.plannedHours >= 20);
  assert.ok(week.totals.actualHours >= 10);
  assert.ok(week.subtasks.length >= 6);

  const monday = week.capacity.days.find(day => day.date === week.range.startYmd);
  assert.ok(monday.events.length >= 3);
  assert.ok(monday.meetingHours >= 2);
  const midweek = week.capacity.days.find(day => day.date === addDaysYmd(currentMonday, 2));
  assert.ok(midweek.events.some(event => event.title.includes('設計レビュー')));
  const friday = week.capacity.days.find(day => day.date === addDaysYmd(currentMonday, 4));
  const focus = friday.events.find(event => event.title === '集中作業ブロック');
  assert.ok(focus);
  assert.equal(focus.blocksTime, false);
  assert.equal(focus.meetingHours, 0);
  assert.equal(focus.durationHours, 2);
});

test('プレビューの前週は実績が入った保存済み週になる', () => {
  const week = planningResult('week', previousWeek);
  assert.ok(week.rows.filter(row => row.hasPlan).length >= 3);
  assert.ok(week.totals.actualHours >= 10);
  // 予定どおり終えた週として見せる。
  week.rows.filter(row => row.hasPlan).forEach(row => assert.equal(row.actualHours, row.plannedHours));
});

test('プレビューの日次の行は週の実績と一致する', () => {
  const week = planningResult('week', previousWeek);
  const monday = demoDailyTasks(previousMonday);
  const permission = monday.tasks.find(task => task.title.startsWith('権限まわり改修'));
  assert.ok(permission);
  assert.equal(permission.hours, week.rows.find(row => row.aggregationKey === '権限まわり改修').actualByDate[previousMonday]);
  assert.equal(demoDailyTasks(addDaysYmd(currentMonday, 3)).tasks.length, 0, '今日以降の日は空');
});

test('プレビューの未保存週は予定なしで会議だけ入る', () => {
  const week = planningResult('week', nextWeekKey(currentWeek));
  assert.equal(week.rows.filter(row => row.hasPlan).length, 0);
  const weekday = week.capacity.days.find(day => day.events.length);
  assert.ok(weekday.events.length >= 3);
});

test('プレビューの日次は週予定の子タスクで埋まっている', () => {
  const today = demoDailyTasks(addDaysYmd(currentMonday, 2));
  assert.ok(today.tasks.length >= 4);
  assert.ok(today.tasks.some(task => task.title.startsWith('障害対応')));
  assert.ok(today.tasks.some(task => task.type === 'interrupt' && task.title.startsWith('問い合わせ対応')));
  assert.equal(demoDailyTasks(addDaysYmd(currentMonday, 6)).tasks.length, 0);
});

test('日次は週の課題を選ぶか今日だけの作業を足せる', () => {
  const html = page();
  assert.match(html, /<th scope="col">課題<\/th>/);
  assert.doesNotMatch(html, /<th scope="col">週予定<\/th>/);
  assert.doesNotMatch(html, /<th scope="col">今日の作業<\/th>/);
  assert.match(html, /<th scope="col" class="task-col-origin">区分<\/th>/);
  assert.match(html, /function dailyRowOrigin\(/);
  assert.match(html, /class="field interrupt-name"/);
  assert.match(html, /type === 'interrupt' \|\| type === 'calendar' \|\| type === 'calendar-imported'[\s\S]*querySelector\('\.interrupt-name'\)/);
  assert.match(html, /event\.target\.classList\.contains\('interrupt-name'\)/);
  assert.match(html, /<th scope="col" class="task-col-num"[^>]*>本日実績 <span class="task-head-total"><b id="dailyTotalHours">/);
  assert.match(html, /<th scope="col" class="task-col-num"[^>]*>前日まで<\/th>/);
  assert.match(html, /<th scope="col" class="task-col-num"[^>]*>予定工数<\/th>/);
  assert.match(html, /plan-dialog-subtask-cols[\s\S]*<span>予定<\/span><span>h<\/span>/);
  assert.match(html, /<th scope="col" class="task-col-status">状態<\/th>/);
  assert.match(html, /function dailyTaskStatus\(/);
  assert.match(html, /class="daily-status weekly-status"/);
  assert.match(html, /function dailySelectableIssues\(/);
  assert.match(html, /function dailyIssueLabel\(/);
  assert.match(html, /function weeklySubtasksForParent\(/);
  assert.match(html, /function collectPlannerSubtasks\(/);
  assert.match(html, /function collectPlanningPayload\(/);
  assert.match(html, /id="planDialogSubtaskList"/);
  assert.match(html, /placeholder="サブタスク名"/);
  assert.match(html, /function issueHoursExceedPlan\(/);
  assert.match(html, /id="planDialogIssueSum"/);
  assert.match(html, /サブタスクの予定工数の合計が予定を超えています/);
  assert.match(html, /課題「' \+ parent \+ '」の予定工数合計が予定を超えています/);
  assert.match(html, /class="plan-dialog-title-field"/);
  assert.doesNotMatch(html, /id="planDialogName"[^>]*list="taskNames"/);
  assert.doesNotMatch(html, /<datalist id="taskNames">/);
  assert.match(html, /class="plan-dialog-section plan-dialog-span plan-dialog-period"/);
  assert.match(html, /class="plan-dialog-primary"/);
  assert.match(html, /class="plan-dialog-eyebrow">週の予定<\/span>/);
  assert.match(html, /id="planDialogNote"/);
  assert.match(html, /id="planDialogNote"[^>]*placeholder="詳細や、実績との差の理由（改行・URLも使えます）"/);
  assert.match(html, /planNote \? '備考: ' \+ planNote : ''/);
  assert.match(html, /日付を入れなければ期間未定として登録します/);
  assert.match(html, /課題を追加/);
  assert.match(html, /id="addTask"[^>]*>[\s\S]*週の課題から選ぶ/);
  assert.match(html, /id="addInterrupt"[^>]*>[\s\S]*今日だけの作業/);
  assert.match(html, /function setCandidateDialogMode\(/);
  assert.match(html, /function completeCandidatePlan\(/);
  assert.match(html, /class="candidate-complete"/);
  assert.match(html, /setPlanningPlanDone/);
  assert.match(html, /id="dailyIssueComposer"/);
  assert.match(html, /class="candidate-group-toggle"/);
  assert.doesNotMatch(html, /<details class="candidate-group"/);
  assert.doesNotMatch(html, /<details class="candidate-older"/);
  assert.match(html, /function addDailyCreatedIssue\(/);
  assert.match(html, /function weeklyHasNamedIssue\(/);
  assert.match(html, /function classifyDailyRowType\(/);
  assert.match(html, /選んだ課題を入れる/);
  assert.match(html, /今日だけ記録する/);
  assert.match(html, /if \(origin === 'interrupt'\) return '今日だけ'/);
  assert.match(html, /if \(origin === 'calendar'\) return 'カレンダー'/);
  assert.doesNotMatch(html, /カレンダーから自動/);
  assert.doesNotMatch(html, /カレンダー・今日だけの作業/);
  assert.doesNotMatch(html, /function buildDailyGroupRow\(/);
  assert.match(html, /週予定や予実には入りません/);
  assert.doesNotMatch(html, /id="dailyNewIssueHours"/);
  assert.doesNotMatch(html, /週の追加予定としても残ります/);
  assert.doesNotMatch(html, /週の追加予定にも残しました/);
  assert.doesNotMatch(html, /id="dailyNewIssueParent"/);
  assert.doesNotMatch(html, /id="dailyNewPlanName"/);
  assert.doesNotMatch(html, /function remainingParentIssueHours\(/);
  assert.match(html, /savePlanningWorkspace/);
  assert.doesNotMatch(html, /class="field task-name"/);
  assert.doesNotMatch(html, /candidate-child/);
  assert.doesNotMatch(html, /task-parent-chip/);
  assert.doesNotMatch(html, /dailyChildPicker/);
  assert.doesNotMatch(html, /dailyParentPicker/);
  assert.doesNotMatch(html, /作業名を入れます/);
  assert.match(html, /週の課題を選んで時間を入れます/);
  assert.doesNotMatch(html, /当日割込み/);
  assert.doesNotMatch(html, /この課題を今日に追加/);
  assert.match(html, /function dailyStatusIsComplete\(/);
  assert.match(html, /function liveReorderElements\(/);
  assert.match(html, /function animateReorder\(/);
  assert.match(html, /function bindPlannerRowDraggables\(/);
  assert.doesNotMatch(html, /drag-before/);
  assert.match(html, /function dailyRowNameLocked\(/);
  assert.match(html, /function planNameLocked\(/);
  assert.match(html, /id="planDialogNameText"/);
  assert.match(html, /class="task-issue-text/);
  assert.doesNotMatch(html, /class="status-value"/);
  assert.match(html, /function childNameForDaily/);
  assert.doesNotMatch(html, /placeholder="課題1 調査"/);
  assert.doesNotMatch(html, /task-progress/);
  assert.doesNotMatch(html, /function updateTaskProgress\(/);
  assert.match(html, /<h2>共有テキスト<\/h2>/);
  assert.doesNotMatch(html, /class="section report-details"/);
  assert.doesNotMatch(html, /class="icon-button move-up"/);
  assert.doesNotMatch(html, /class="icon-button move-down"/);
});

test('日次の予定工数と前日までは週予定と同期する', () => {
  const html = page();
  assert.doesNotMatch(html, /本日の予定配分/);
  assert.doesNotMatch(html, /id="dailyPlanBoard"/);
  assert.doesNotMatch(html, /id="dailyPlanPanel"/);
  assert.doesNotMatch(html, /class="span-daily-plan-open"/);
  assert.match(html, /function weeklySyncedHoursForDaily\(/);
  assert.match(html, /function applyWeeklyHoursToDailyRows\(/);
  assert.match(html, /class="synced-hours previous-value"/);
  assert.match(html, /class="synced-hours estimate-value"/);
  assert.match(html, /function scheduleDailyAutoSave\(/);
  assert.match(html, /function schedulePlannerAutoSave\(/);
  assert.match(html, /変更時に自動保存/);
});

test('主要操作を予定と実績に絞り高度な操作を段階表示する', () => {
  const html = page();
  // 日・週・月・プロジェクトはアプリバー右の1つのメニューで切り替える。
  assert.match(html, /id="viewMenu"[\s\S]*data-view="day"[\s\S]*data-view="week"[\s\S]*data-view="month"[\s\S]*data-view="projects"/);
  assert.doesNotMatch(html, /id="sideReport"/);
  // 狭い画面では文字を隠して歯車だけにするため、「設定」は別の span に入れ、読み上げ用に aria-label を持たせる。
  assert.match(html, /<md-icon-button[^>]*id="openAppSettings"[^>]*aria-label="設定"[^>]*><span class="material-symbols-outlined" aria-hidden="true">settings<\/span><\/md-icon-button>/);
  assert.match(html, /id="appSettingsDialog"/);
  // 予定は期間で押さえるので、開始日・終了日は常に見せ、日別の予定や1日の上限は置かない。
  assert.match(html, /id="planDialogStartDate" type="date"/);
  assert.match(html, /id="planDialogEndDate" type="date"/);
  assert.doesNotMatch(html, /id="planDialogAdvanced"|id="planDialogDailyCap"|id="planDialogDailyPlanList"/);
  // 日付を入れなければ期間未定として登録でき、入れた日付は「日付を消す」で空に戻せる
  assert.match(html, /id="clearPlanDialogPeriod"[^>]*>日付を消す（期間未定にする）/);
  assert.doesNotMatch(html, /id="planDialogUndated"/);
  assert.match(html, /\.plan-dialog-fields \{[\s\S]*display: block;[\s\S]*overflow-y: auto/);
  assert.doesNotMatch(html, /着地見込/);
  assert.doesNotMatch(html, /id="planDialogEstimate"/);
  assert.doesNotMatch(html, /id="estimateHours"/);
  assert.match(html, /<h2>共有テキスト<\/h2>/);
  assert.doesNotMatch(html, /<summary>共有<\/summary>/);
  assert.doesNotMatch(html, /<details class="advanced-section">/);
});

test('予定画面から選択日の実績を開いて操作できる', () => {
  const html = page();
  assert.match(html, /class="planning-main-grid"/);
  assert.match(html, /function openPlannerActualDay\(/);
  assert.match(html, /await setCalendarMode\('day', nextDate\)/);
  assert.match(html, /function activeDailyTaskList\(/);
  assert.match(html, /id="taskList"/);
  assert.match(html, /openPlannerActualDay\(openDay\.dataset\.date\)/);
  assert.match(html, /wireDailyTaskListEvents\(document\.getElementById\('taskList'\)\)/);
  assert.doesNotMatch(html, /id="planningActualPanel"/);
});

test('日次の稼働消化は稼働時間に対する実績を使い割当一覧は出さない', () => {
  const html = page();
  assert.match(html, /id="dailyProgressMeta">本日 ÷ 稼働/);
  assert.doesNotMatch(html, /今日の割当/);
  assert.match(html, /function buildDayAgendaModel\(/);
  assert.match(html, /function dayAgendaFromForecast\(/);
  assert.doesNotMatch(html, /1日の割当を見る/);
  assert.doesNotMatch(html, /id="dayAgendaList"/);
  assert.doesNotMatch(html, /function renderDayAgenda\(/);
  const agenda = html.slice(html.indexOf('function loadDayAgenda('), html.indexOf('function renderDaily('));
  assert.match(agenda, /dayAgendaFromForecast/);
  assert.doesNotMatch(agenda, /row\.estimate/);
  assert.doesNotMatch(html, /累積 ÷ 予定/);
  assert.doesNotMatch(html, /上のタスクから稼働枠へ割り当て/);
});

test('プレビューの週予定候補は繰越元の週を保持する', () => {
  const suggestions = demoImportSuggestions();
  const carry = suggestions.find(item => item.carry);
  assert.ok(carry);
  assert.equal(carry.title, '設計レビュー');
  assert.equal(carry.carryWeek, previousWeek);
  assert.ok(suggestions.every(item => item.title.indexOf('前週繰越') !== 0));
  const dash = suggestions.find(item => item.title === 'ダッシュボード刷新');
  assert.ok(dash.subtasks.length >= 2);
  assert.ok(dash.subtasks.every(task => task.parentKey === 'ダッシュボード刷新'));
  assert.ok(dash.subtasks.every(task => task.plannedHours > 0));
  const dated = demoImportSuggestions(addDaysYmd(currentMonday, 2));
  const datedDash = dated.find(item => item.title === 'ダッシュボード刷新');
  assert.ok(datedDash.subtasks.some(task => task.prevB > 0));
  const html = page();
  assert.match(html, /function planIdentityName\(/);
  assert.match(html, /function reconcileWeekContinuations\(/);
});

test('週の課題候補は最新候補とキャッシュを統合してサブタスクを欠落させない', () => {
  const html = page();
  assert.match(html, /function mergeSuggestionItem\(/);
  assert.match(html, /state\.parentNamesByWeek\[weekKey\][\s\S]*state\.candidates/);
  assert.doesNotMatch(html, /if \(fromItems\.length\) return fromItems/);
});

test('表示中の画面はリロード後も戻せる', () => {
  const html = page();
  assert.match(html, /const VIEW_KEY = scopedStorageKey\('matomete-kousu-view-v1'\)/);
  assert.match(html, /function persistViewState/);
  assert.match(html, /function readStoredViewState/);
  assert.match(html, /applyViewState\(startupViewState\(\)\)/);
  assert.match(html, /function startupViewState[\s\S]*?return readStoredViewState\(\);/, '起動時の画面が「前回の画面」なら保存した画面に戻す');
});

test('プレビューの稼働時間編集は容量へ残る', () => {
  const html = page();
  assert.match(html, /saveWorkCapacitySetting/);
  assert.match(html, /window\.__workCapacityOverrides/);
  const monday = currentMonday;
  const week = planningResult('week', currentWeek, {
    workCapacity: { [monday]: { hours: 4, reason: '時短' } }
  });
  const day = week.capacity.days.find(entry => entry.date === monday);
  assert.equal(day.baseHours, 4);
  assert.equal(day.capacityReason, '時短');
  assert.equal(day.capacityOverridden, true);
  assert.ok(day.availableHours <= 4);
  const saved = saveWorkCapacitySetting(monday, 6, '午前のみ');
  assert.deepEqual(saved, { date: monday, hours: 6, reason: '午前のみ' });
});

test('月は見るだけのガント表示で、月予定の作成画面は出さない', () => {
  const html = page();
  assert.doesNotMatch(html, /id="sideMonth"/);
  assert.doesNotMatch(html, /id="monthMode"/);
  assert.doesNotMatch(html, /id="importMonthlyPlans"/);
  assert.doesNotMatch(html, /function renderMonthCalendar\(/);
  assert.doesNotMatch(html, /function monthCalendarCells\(/);
  // 月は日・週と並ぶ表示の切り替えで、予定はプロジェクトごとのガント（見るだけ）
  assert.match(html, /<md-menu-item data-view="month"><div slot="headline">月<\/div><div slot="trailing-supporting-text">M<\/div>/);
  // 期間はボタンで、押すとアプリ独自の日付選択（M3 の Docked date picker の形）を開く。ブラウザ標準の選択は使わない。
  assert.match(html, /<button class="period-picker" id="calendarPeriodButton"[^>]*aria-controls="datePicker"/);
  assert.match(html, /<div class="date-picker" id="datePicker" role="dialog"[^>]*hidden><\/div>/);
  assert.match(html, /function renderDatePicker\(/);
  assert.doesNotMatch(html, /input\.showPicker\(/);
  assert.match(html, /id="monthView" hidden/);
  assert.match(html, /function renderMonthGantt\(/);
  assert.match(html, /gas\('loadPlanningMonthGantt', key\)/);
  assert.match(html, /id="monthFilterProject"/);
  assert.match(html, /id="monthFilterDeviation"/);
  assert.match(html, /見るだけの画面です。予定を押すと、その予定がある週の画面へ移動して編集できます/);
  assert.doesNotMatch(html.slice(html.indexOf('function renderMonthGantt('), html.indexOf('async function loadMonthGantt(')), /openPlanDialog|markPlannerChanged|savePlanner/);
  const dailyIssues = html.slice(html.indexOf('function dailySelectableIssues('), html.indexOf('function copyPlannerSubtask('));
  assert.doesNotMatch(dailyIssues, /month/);
});

test('プレビューの会議はカレンダー選択で減らせる', () => {
  const tuesday = new Date('2026-08-25T12:00:00');
  assert.ok(demoCalendarEvents(tuesday, ['primary', 'team@example.com']).length >= 3);
  assert.equal(demoCalendarEvents(tuesday, ['team@example.com']).every(event => event.calendarId === 'team@example.com'), true);
});

test('プロジェクト本体は月をまたいで保持し、予定時間と説明は月次設定に分離される', () => {
  withPreviewWindow(() => {
    const saved = saveProject({
      id: 'project-test-permanent',
      name: '恒久保存プロジェクト',
      description: '月に依存しないプロジェクト情報',
      status: 'active'
    });
    assert.equal(saved.id, 'project-test-permanent');

    const september = projectWorkspace('2026-09');
    const october = projectWorkspace('2026-10');
    assert.ok(september.projects.some(project => project.id === saved.id));
    assert.ok(october.projects.some(project => project.id === saved.id));
    assert.equal(october.projects.find(project => project.id === saved.id).hasMonthlyPlan, false);

    saveProjectMonthly({ projectId: saved.id, monthKey: '2026-10', plannedHours: 20, statusNote: '設計を進めます' });
    const configured = projectWorkspace('2026-10').projects.find(project => project.id === saved.id);
    assert.equal(configured.plannedHours, 20);
    assert.equal(configured.statusNote, '設計を進めます');
    assert.equal(projectWorkspace('2026-09').projects.find(project => project.id === saved.id).plannedHours, 0);
  });
});

test('プロジェクト集計は1人月、配分、実績、残り時間を同じ稼働可能時間から算出する', () => {
  const workspace = projectWorkspace('2026-09');
  const capacity = workspace.capacity.availableHours;
  assert.ok(capacity > 0);
  assert.equal(workspace.totals.onePersonMonthHours, capacity);
  assert.equal(workspace.totals.unallocatedHours, capacity - workspace.totals.plannedHours);
  workspace.projects.forEach(project => {
    assert.equal(project.onePersonMonthHours, capacity);
    assert.equal(project.remainingHours, project.plannedHours - project.actualHours);
    assert.equal(project.actualShareRate, project.actualHours / capacity);
  });

  const html = page();
  assert.match(html, /1人月は、その月の稼働可能時間の合計です/);
  assert.match(html, /id="projectCapacityHours"/);
  assert.match(html, /id="projectUnallocatedHours"/);
  assert.match(html, /data-project-month-hours/);
  assert.match(html, /saveProjectMonthly/);
  assert.doesNotMatch(html, /id="projectDialogPlannedHours"/);
});

test('プレビューだけ操作デバッグを出し、本番HTMLには入れない', () => {
  const html = page();
  const gas = fs.readFileSync('gas/index.html', 'utf8');
  assert.match(html, /id="previewDebug"/);
  assert.match(html, /data-preview-debug="away"/);
  assert.match(html, /setCalendarMode\('day', value\)/);
  assert.doesNotMatch(gas, /id="previewDebug"/);
});

test('スマホ幅では、週と月を横長の表ではなくスマホ用のリストで描く', () => {
  const html = page();
  assert.match(html, /function isCompactLayout\(\) \{[\s\S]*?max-width: 620px/);
  assert.match(html, /if \(isCompactLayout\(\)\) \{\s*renderWeekMobile\(target, selectedDays\);\s*return;/);
  assert.match(html, /if \(isCompactLayout\(\)\) \{\s*renderMonthMobile\(target, rows, allRows, range\);\s*return;/);
  // 幅が変わってスマホ幅をまたいだら描き直す。
  assert.match(html, /matchMedia\('\(max-width: 620px\)'\)\.addEventListener\('change'/);
});

test('スマホの日は行を読むだけにし、押すと編集シートで時間・計測・削除を操作する', () => {
  const html = page();
  assert.match(html, /<div class="daily-sheet" id="dailyRowSheet" role="dialog"[^>]*hidden><\/div>/);
  // 丸（完了）以外を押したらシートを開く。
  assert.match(html, /if \(isCompactLayout\(\) && !event\.target\.closest\('\.done-check'\)\) \{\s*openDailyRowSheet\(row\);/);
  // シートの操作は行の既存の入力欄へ渡し、行で入力したときと同じ input / change を起こす。
  assert.match(html, /function setDailyRowField\(field, value, commit\) \{[\s\S]*?new Event\('input'[\s\S]*?new Event\('change'/);
});
