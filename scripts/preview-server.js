const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const preview = require('./preview-data');

const port = Number(process.env.PREVIEW_PORT || 4173);
const root = path.resolve(__dirname, '..');

const {
  planningResult,
  nextWeekKey
} = preview;

const mockApi = `<script>
(function () {
  var success = function () {};
  var failure = function () {};
  var api = new Proxy({}, { get: function (_, name) {
    if (name === 'withSuccessHandler') return function (handler) { success = handler; return api; };
    if (name === 'withFailureHandler') return function (handler) { failure = handler; return api; };
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var done = success; var fail = failure;
      success = function () {}; failure = function () {};
      setTimeout(function () {
        try {
          if (name === 'savePlanActualCompletionSyncSettings') {
            sessionStorage.setItem('previewCompletionSync', String(args[0].enabled === true));
            return done({enabled:args[0].enabled === true});
          }
          if (name === 'saveWorkdayHoursSettings') {
            const p = args[0] || {};
            if (p.hours != null) sessionStorage.setItem('previewWorkdayHours', String(p.hours));
            if (p.weekdays) sessionStorage.setItem('previewWorkdayWeekdays', p.weekdays.join(','));
            if (p.start) { sessionStorage.setItem('previewWorkdayStart', p.start); sessionStorage.setItem('previewWorkdayEnd', p.end); }
            return done({
              hours: Number(sessionStorage.getItem('previewWorkdayHours')) || 8,
              weekdays: (sessionStorage.getItem('previewWorkdayWeekdays') || '1,2,3,4,5').split(',').filter(Boolean).map(Number),
              start: sessionStorage.getItem('previewWorkdayStart') || '09:00',
              end: sessionStorage.getItem('previewWorkdayEnd') || '18:00'
            });
          }
          if (name === 'getBacklogSettings') return done(window.__backlogSettings || {spaceUrl:'',hasApiKey:false,configured:false});
          if (name === 'saveBacklogSettings') {
            window.__backlogSettings = {spaceUrl:args[0].spaceUrl,hasApiKey:true,configured:true,userName:'プレビュー担当者'};
            return done(window.__backlogSettings);
          }
          if (name === 'clearBacklogSettings') {window.__backlogSettings=null;return done({spaceUrl:'',hasApiKey:false,configured:false});}
          if (name === 'listBacklogAssignedIssues') return done({userName:'プレビュー担当者',hasMore:false,nextOffset:2,issues:[
            {id:'preview-1',key:'DEMO-101',title:'連携から取り込む課題',status:'処理中',estimatedHours:3,startDate:null,dueDate:null,url:'https://example.backlog.jp/view/DEMO-101'},
            {id:'preview-2',key:'DEMO-102',title:'調査と設計',status:'未対応',estimatedHours:null,startDate:null,dueDate:null,url:'https://example.backlog.jp/view/DEMO-102'}
          ]});
          if (name === 'loadDataForDate') return done(window.__previewData.demoDailyTasks(args[0]));
          if (name === 'getTaskNameSuggestions') return done(window.__previewData.demoTaskNames());
          if (name === 'loadPlanningWorkspace') {
            var stored = window.__savedPlanningWorkspaces && window.__savedPlanningWorkspaces[args[0] + ':' + args[1]];
            return done(window.__planningResult(args[0], args[1], stored));
          }
          if (name === 'loadPlanningMonthGantt') return done(window.__previewData.monthGanttResult(args[0], window.__savedPlanningWorkspaces || {}));
          if (name === 'loadProjectWorkspace') return done(window.__previewData.projectWorkspace(args[0]));
          if (name === 'loadProjectCatalog') {
            var catalog = window.__previewData.projectWorkspace();
            return done((catalog.projects || []).map(function(project) {
              return { id: project.id, name: project.name, description: project.description || '', status: project.status || 'active', statusLabel: project.statusLabel || '', startDate: project.startDate || '', endDate: project.endDate || '' };
            }));
          }
          if (name === 'loadPlanningCalendarCapacity') {
            var storedCap = window.__savedPlanningWorkspaces && window.__savedPlanningWorkspaces[args[0] + ':' + args[1]];
            return done(window.__planningResult(args[0], args[1], storedCap).capacity);
          }
          if (name === 'saveWorkCapacitySetting') return done(window.__previewData.saveWorkCapacitySetting(args[0], args[1], args[2]));
          if (name === 'savePlanningWorkspace') {
            window.__savedPlanningWorkspaces = window.__savedPlanningWorkspaces || {};
            var saveKey = args[0].periodType + ':' + args[0].periodKey;
            var prev = window.__savedPlanningWorkspaces[saveKey] || {};
            window.__savedPlanningWorkspaces[saveKey] = {
              plans: args[0].plans,
              subtasks: Array.isArray(args[0].subtasks) ? args[0].subtasks : prev.subtasks
            };
            return done(window.__planningResult(args[0].periodType, args[0].periodKey, window.__savedPlanningWorkspaces[saveKey]));
          }
          if (name === 'updatePlanFields') { (window.__planUpdates = window.__planUpdates || []).push(args[0]); return done({ planId: args[0].planId, updated: 1 }); }
          if (name === 'saveProject') return done(window.__previewData.saveProject(args[0]));
          if (name === 'saveProjectWorkspace') return done(window.__previewData.saveProjectWorkspace(args[0]));
          if (name === 'saveProjectMonthly') return done(window.__previewData.saveProjectMonthly(args[0]));
          if (name === 'setPlanningPlanDone') {
            var completion = args[0] || {};
            var completionType = completion.periodType || 'week';
            var completionKey = completion.periodKey;
            var completionSaveKey = completionType + ':' + completionKey;
            var completionPrev = window.__savedPlanningWorkspaces && window.__savedPlanningWorkspaces[completionSaveKey];
            var completionDemo = window.__previewData.demoWorkspace(completionType, completionKey);
            var completionBase = completionPrev && Array.isArray(completionPrev.plans)
              ? completionPrev
              : { plans: completionDemo.plans, subtasks: completionDemo.subtasks };
            var completionId = String(completion.planId || '');
            var completionName = String(completion.aggregationKey || completion.name || completion.title || '');
            var completionMatched = false;
            var completionPlans = completionBase.plans.map(function (plan, index) {
              var fallbackId = 'preview-' + completionType + '-' + completionKey + '-' + (plan.priority != null ? plan.priority : index);
              var planId = String(plan.planId || fallbackId);
              var matched = completionId ? planId === completionId : String(plan.aggregationKey || '') === completionName;
              if (!matched && completionId && completionName && String(plan.aggregationKey || '') === completionName) matched = true;
              if (!matched) return plan;
              completionMatched = true;
              return Object.assign({}, plan, {
                planId: planId,
                done: completion.done !== false,
                completionOverride: completion.done === false ? false : true
              });
            });
            if (!completionMatched) return fail(new Error('指定した週予定が見つかりません。'));
            window.__savedPlanningWorkspaces = window.__savedPlanningWorkspaces || {};
            window.__savedPlanningWorkspaces[completionSaveKey] = { plans: completionPlans, subtasks: completionBase.subtasks || [] };
            return done(window.__planningResult(completionType, completionKey, window.__savedPlanningWorkspaces[completionSaveKey]));
          }
          if (name === 'getPlanningCalendarSettings') return done({
            calendars: window.__planningCalendars,
            selectedIds: window.__selectedCalendarIds.slice()
          });
          if (name === 'savePlanningCalendarSettings') {
            var requested = ((args[0] || {}).calendarIds || []).filter(Boolean);
            window.__selectedCalendarIds = requested.length ? requested : ['primary'];
            return done({ calendars: window.__planningCalendars, selectedIds: window.__selectedCalendarIds.slice() });
          }
          if (name === 'saveToSpreadsheet') {
            window.__savedDailyTasks = window.__savedDailyTasks || {};
            window.__savedDailyTasks[args[0].date] = args[0].tasks || [];
            try { sessionStorage.setItem('previewSavedDaily', JSON.stringify(window.__savedDailyTasks)); } catch (e) {}
            return done('#');
          }
          if (name === 'getImportSuggestions' || name === 'getManualCarrySuggestions') return done(window.__previewData.demoImportSuggestions(args[0]));
          if (name === 'getSpreadsheetUrlForDate') return done('#');
          if (name === 'getScriptEditorUrl') return done('#');
          if (name === 'clearAppReadCache') return done(true);
          if (name === 'getExternalEditStamp') return done({ stamp: 0 });
          if (name === 'inspectAppStorageFolder') return done({ id: 'mock-folder', name: 'まとめて工数管理さん', path: 'マイドライブ / まとめて工数管理さん', url: '#' });
          if (name === 'previewAnnualStorageMigration') return done({ parentPath: 'マイドライブ', folderName: args[0].title, folderPath: 'マイドライブ / ' + args[0].title, years: [2025, 2026], fileNames: ['2025年工数管理データ', '2026年工数管理データ'] });
          if (name === 'inspectExistingAppStorage') {
            if (args[0] === 'mock-target') return done({ folderId: 'mock-target', folderPath: 'マイドライブ / プロジェクト / まとめて工数管理さん', currentYear: 2026, missingCurrentYear: false, files: [{ year: 2025, id: 'f2025', name: '2025年 まとめて工数管理さん', url: '#' }, { year: 2026, id: 'f2026', name: '2026年 まとめて工数管理さん', url: '#' }] });
            return done({ folderId: args[0], folderPath: '', currentYear: 2026, missingCurrentYear: true, files: [] });
          }
          if (name === 'attachAppStorage') return done({
            configured: true, annual: true, currentYear: 2026, years: [2025, 2026], folderName: 'まとめて工数管理さん', folderPath: 'マイドライブ / プロジェクト / まとめて工数管理さん',
            file: { year: 2026, name: '2026年 まとめて工数管理さん', url: '#' }, files: [], defaultName: 'まとめて工数管理さん'
          });
          if (name === 'listAppStorageFolders') {
            if (args[0] === 'mock-projects') return done({ current: { id: 'mock-projects', name: 'プロジェクト', path: 'マイドライブ / プロジェクト' }, ancestors: [{ id: 'mock-root', name: 'マイドライブ' }, { id: 'mock-projects', name: 'プロジェクト' }], parent: { id: 'mock-root', name: 'マイドライブ' }, folders: [{ id: 'mock-target', name: 'まとめて工数管理さん' }], truncated: false });
            if (args[0] === 'mock-target') return done({ current: { id: 'mock-target', name: 'まとめて工数管理さん', path: 'マイドライブ / プロジェクト / まとめて工数管理さん' }, ancestors: [{ id: 'mock-root', name: 'マイドライブ' }, { id: 'mock-projects', name: 'プロジェクト' }, { id: 'mock-target', name: 'まとめて工数管理さん' }], parent: { id: 'mock-projects', name: 'プロジェクト' }, folders: [], truncated: false });
            return done({ current: { id: 'mock-root', name: 'マイドライブ', path: 'マイドライブ' }, ancestors: [{ id: 'mock-root', name: 'マイドライブ' }], parent: null, folders: [{ id: 'mock-projects', name: 'プロジェクト' }, { id: 'mock-shared', name: '共有資料' }], truncated: false });
          }
          if (name === 'getAppStorageStatus' || name === 'migrateAppStorage' || name === 'createAnnualStorageFile') return done({
            configured: true, annual: true, currentYear: 2026, years: [2025, 2026], folderName: 'まとめて工数管理さん', folderPath: 'マイドライブ / まとめて工数管理さん',
            file: { year: 2026, name: '2026年工数管理データ', url: '#' }, files: [{ year: 2025, name: '2025年工数管理データ', url: '#' }, { year: 2026, name: '2026年工数管理データ', url: '#' }], defaultName: 'まとめて工数管理さん'
          });
          return done({});
        } catch (error) { fail(error); }
      }, 40);
    };
  }});
  window.google = { script: { run: api } };
})();
</script>`;

function previewDataScript() {
  const source = fs.readFileSync(path.join(__dirname, 'preview-data.js'), 'utf8')
    .replace(/^module\.exports = /m, 'window.__previewData = ');
  return `<script>
${source}
try {
  window.__savedDailyTasks = JSON.parse(sessionStorage.getItem('previewSavedDaily') || 'null') || {};
} catch (e) {
  window.__savedDailyTasks = {};
}
window.__planningCalendars = window.__previewData.PLANNING_CALENDARS;
window.__selectedCalendarIds = window.__previewData.DEFAULT_CALENDAR_IDS.slice();
window.__workCapacityOverrides = window.__workCapacityOverrides || {};
window.__planningResult = window.__previewData.planningResult;
window.__nextWeekKey = window.__previewData.nextWeekKey;
window.planningResult = window.__planningResult;
window.nextWeekKey = window.__nextWeekKey;
</script>`;
}

const previewDebug = `<style>
.preview-debug { position: fixed; right: 16px; bottom: 16px; z-index: 800; width: min(320px, calc(100vw - 32px)); }
.preview-debug-toggle { border: 0; border-radius: 999px; padding: 8px 12px; background: #3c4043; color: #fff; font: 500 12px/1 Roboto, sans-serif; cursor: pointer; }
.preview-debug-panel { margin-top: 8px; padding: 12px; border-radius: 12px; background: #fff; color: #3c4043; box-shadow: 0 8px 28px rgba(60,64,67,.28); font: 400 12px/1.4 Roboto, "Noto Sans JP", sans-serif; }
.preview-debug-panel[hidden] { display: none; }
.preview-debug-panel p { margin: 0 0 8px; white-space: pre-wrap; }
.preview-debug-panel label { display: grid; gap: 4px; margin: 8px 0; }
.preview-debug-panel input, .preview-debug-actions button { font: inherit; }
.preview-debug-panel input { height: 32px; padding: 0 8px; border: 1px solid #c4c7c5; border-radius: 8px; }
.preview-debug-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.preview-debug-actions button { border: 0; border-radius: 8px; padding: 6px 8px; background: #e8f0fe; color: #174ea6; cursor: pointer; }
</style>
<aside class="preview-debug" id="previewDebug">
  <button class="preview-debug-toggle" id="previewDebugToggle" type="button" aria-expanded="false">debug</button>
  <div class="preview-debug-panel" id="previewDebugPanel" hidden>
    <p id="previewDebugStatus">読み込み中</p>
    <label>日付<input id="previewDebugDate" type="date"></label>
    <div class="preview-debug-actions">
      <button type="button" data-preview-debug="open-day">この日を開く</button>
      <button type="button" data-preview-debug="prev-day">前日</button>
      <button type="button" data-preview-debug="next-day">翌日</button>
      <button type="button" data-preview-debug="today">今日</button>
    </div>
    <label>放置（分）<input id="previewDebugAway" type="number" min="1" step="1" value="10"></label>
    <div class="preview-debug-actions">
      <button type="button" data-preview-debug="away">放置にする</button>
      <button type="button" data-preview-debug="idle">離席にする</button>
      <button type="button" data-preview-debug="lock">画面ロック</button>
      <button type="button" data-preview-debug="back">離席から戻る</button>
      <button type="button" data-preview-debug="advance">計測を15分進める</button>
    </div>
  </div>
</aside>
<script>
(function () {
  var panel = document.getElementById('previewDebugPanel');
  var status = document.getElementById('previewDebugStatus');
  var dateInput = document.getElementById('previewDebugDate');
  document.getElementById('previewDebugToggle').addEventListener('click', function () {
    var open = panel.hidden;
    panel.hidden = !open;
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) refreshPreviewDebug();
  });
  function addDays(value, delta) {
    var date = new Date(value + 'T12:00:00');
    date.setDate(date.getDate() + delta);
    return ymd(date);
  }
  function appState() {
    return typeof state === 'undefined' ? null : state;
  }
  function refreshPreviewDebug() {
    var current = appState();
    if (!current) {
      status.textContent = '画面の準備前です';
      return;
    }
    var timer = current.timer;
    var idle = state.idle || {};
    dateInput.value = current.view === 'daily' ? current.daily.date : dateInput.value;
    var lines = [
      (current.view === 'daily' ? '日次 ' : '週 ') + (current.view === 'daily' ? current.daily.date : current.planner.key),
      timer ? ('計測 ' + (timer.task || '名称なし') + ' ' + formatClock(timerElapsed()) + (timer.running ? ' 進行中' : ' 停止中')) : '計測なし',
      '状態 ' + (idle.user || 'active') + ' / ' + (idle.screen || 'unlocked')
    ];
    status.textContent = lines.join('\\n');
  }
  async function openDay(value) {
    var current = appState();
    current.daily.dirty = false;
    current.planner.dirty = false;
    await setCalendarMode('day', value);
    refreshPreviewDebug();
  }
  async function ensureTiming() {
    var current = appState();
    if (current.view !== 'daily') await openDay(current.daily.date || ymd(new Date()));
    current = appState();
    if (current.timer && current.timer.running) return true;
    var row = document.querySelector('#taskList .work-card');
    if (!row) {
      status.textContent = 'この日に計測できる行がありません';
      return false;
    }
    startTimer(row.dataset.id);
    current = appState();
    return !!(current.timer && current.timer.running);
  }
  document.getElementById('previewDebug').addEventListener('click', async function (event) {
    var button = event.target.closest('[data-preview-debug]');
    if (!button) return;
    var current = appState();
    if (!current) {
      status.textContent = '画面の準備前です';
      return;
    }
    var action = button.getAttribute('data-preview-debug');
    try {
      if (action === 'open-day') await openDay(dateInput.value);
      if (action === 'prev-day') await openDay(addDays(current.daily.date || dateInput.value, -1));
      if (action === 'next-day') await openDay(addDays(current.daily.date || dateInput.value, 1));
      if (action === 'today') await openDay(ymd(new Date()));
      if (action === 'away') {
        var minutes = Math.max(1, Number(document.getElementById('previewDebugAway').value) || 10);
        if (!(await ensureTiming())) return;
        current = appState();
        var end = Date.now();
        var start = end - minutes * 60 * 1000;
        if (current.timer.startedAt > start) current.timer.startedAt = start;
        current.timer.lastSeenAt = start;
        noteAway(start, end);
        if (!current.idle.dialog) status.textContent = '設定した離席時間未満（または離席判定オフ）なので確認は出ません';
      }
      if (action === 'idle' || action === 'lock') {
        if (!(await ensureTiming())) return;
        current = appState();
        current.idle.user = action === 'idle' ? 'idle' : 'active';
        current.idle.screen = action === 'lock' ? 'locked' : 'unlocked';
        if (!current.idle.awaySince) current.idle.awaySince = Date.now();
        markAwayCandidate(current.idle.awaySince, 0);
      }
      if (action === 'back') {
        current.idle.user = 'active';
        current.idle.screen = 'unlocked';
        current.idle.awaySince = 0;
        settleAway(Date.now());
      }
      if (action === 'advance') {
        if (!(await ensureTiming())) return;
        current = appState();
        current.timer.startedAt -= 15 * 60 * 1000;
        renderTimer();
      }
      if (!(action === 'away' && status.textContent.indexOf('設定した離席時間未満') === 0)) refreshPreviewDebug();
    } catch (error) {
      status.textContent = error && error.message ? error.message : String(error);
    }
  });
  setInterval(function () {
    if (!panel.hidden) refreshPreviewDebug();
  }, 1000);
})();
</script>`;

function page() {
  return fs.readFileSync(path.join(root, 'gas/index.html'), 'utf8')
    .replace(/'<\?= getPlanActualCompletionSyncSettings\(\)\.enabled \?>'/g, "sessionStorage.getItem('previewCompletionSync')")
    .replace(/'<\?= getWorkdayHoursSettings\(\)\.hours \?>'/g, "sessionStorage.getItem('previewWorkdayHours')")
    .replace(/'<\?= getWorkdayHoursSettings\(\)\.weekdays\.join\(","\) \?>'/g, "(sessionStorage.getItem('previewWorkdayWeekdays') || '1,2,3,4,5')")
    .replace(/'<\?= getWorkdayHoursSettings\(\)\.start \?>'/g, "(sessionStorage.getItem('previewWorkdayStart') || '09:00')")
    .replace(/'<\?= getWorkdayHoursSettings\(\)\.end \?>'/g, "(sessionStorage.getItem('previewWorkdayEnd') || '18:00')")
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace('<script>', previewDataScript() + mockApi + '<script>')
    .replace('</body>', previewDebug + '</body>');
}

function startPreviewServer() {
  return http.createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === '/' || request.url.startsWith('/?')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page());
      return;
    }
    response.writeHead(404);
    response.end('Not found');
  }).listen(port, '127.0.0.1', () => {
    console.log(`Preview: http://127.0.0.1:${port}`);
  });
}

if (require.main === module) startPreviewServer();

module.exports = {
  planningResult,
  nextWeekKey,
  page,
  startPreviewServer
};
