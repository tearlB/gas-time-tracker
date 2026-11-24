    function switchIsOn(el) {
      if (!el) return false;
      if (typeof el.selected === 'boolean') return el.selected;
      return !!el.checked;
    }
    function setSwitchOn(el, on) {
      if (!el) return;
      const next = !!on;
      if (typeof el.selected === 'boolean') el.selected = next;
      else el.checked = next;
    }
    // ショートカットキー（1文字）。空にするとそのキーは使わない。標準は Googleカレンダーに合わせる。
    const SHORTCUT_ACTIONS = [
      { id: 'day', label: '日の表示' },
      { id: 'week', label: '週の表示' },
      { id: 'month', label: '月の表示' },
      { id: 'projects', label: 'プロジェクトの表示' },
      { id: 'today', label: '今日へ移動' },
      { id: 'prevPeriod', label: '前の期間' },
      { id: 'nextPeriod', label: '次の期間' },
      { id: 'quickActual', label: '今日の実績パネル' }
    ];
    // 前後の期間は Googleカレンダーと同じ K（前）・J（次）。矢印キー（← →）でも常に切り替えられる（固定）。
    const SHORTCUT_DEFAULTS = { day: 'd', week: 'w', month: 'm', projects: 'p', today: 't', prevPeriod: 'k', nextPeriod: 'j', quickActual: 'a' };
    function normalizeShortcutKey(value) {
      const key = String(value == null ? '' : value).trim().toLowerCase();
      return /^[a-z0-9]$/.test(key) ? key : '';
    }
    function readShortcutPreferences(stored) {
      const source = stored && typeof stored.shortcuts === 'object' && stored.shortcuts ? stored.shortcuts : {};
      const result = {};
      const used = {};
      SHORTCUT_ACTIONS.forEach(function(action) {
        const has = Object.prototype.hasOwnProperty.call(source, action.id);
        const key = has ? normalizeShortcutKey(source[action.id]) : SHORTCUT_DEFAULTS[action.id];
        result[action.id] = key && !used[key] ? key : '';
        if (result[action.id]) used[key] = true;
      });
      return result;
    }
    function shortcutActionForKey(key) {
      const target = normalizeShortcutKey(key);
      const shortcuts = state.uiPreferences && state.uiPreferences.shortcuts || SHORTCUT_DEFAULTS;
      if (!target || (state.uiPreferences && state.uiPreferences.shortcutsEnabled === false)) return '';
      return (SHORTCUT_ACTIONS.find(function(action) { return shortcuts[action.id] === target; }) || {}).id || '';
    }
    function shortcutLabel(actionId) {
      const shortcuts = state.uiPreferences && state.uiPreferences.shortcuts || SHORTCUT_DEFAULTS;
      const enabled = !state.uiPreferences || state.uiPreferences.shortcutsEnabled !== false;
      return enabled && shortcuts[actionId] ? shortcuts[actionId].toUpperCase() : '';
    }
    function persistUiPreferences(next) {
      state.uiPreferences = next;
      try { localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(next)); } catch (_) {}
    }
    // 設定画面の一覧。キーの欄を押して、割り当てたいキーを押す。Backspace で解除、Esc でやめる。
    function renderShortcutSettings() {
      const list = document.getElementById('shortcutList');
      if (!list) return;
      const shortcuts = state.uiPreferences.shortcuts;
      list.innerHTML = SHORTCUT_ACTIONS.map(function(action) {
        const key = shortcuts[action.id];
        return '<div class="shortcut-row"><span>' + escapeHtml(action.label) + '</span><button type="button" class="shortcut-key' + (key ? '' : ' is-empty') + '" data-shortcut-action="' + action.id + '" aria-label="' + escapeHtml(action.label + 'のキー: ' + (key ? key.toUpperCase() : '未設定') + '。押して変更') + '">' + (key ? escapeHtml(key.toUpperCase()) : '未設定') + '</button></div>';
      }).join('');
      setSwitchOn(document.getElementById('shortcutsEnabled'), state.uiPreferences.shortcutsEnabled !== false);
      list.classList.toggle('is-disabled', state.uiPreferences.shortcutsEnabled === false);
    }
    function applyShortcutHints() {
      // ヒントの表記は全体で「名称 (キー)」にそろえる（元に戻す (Ctrl/Cmd+Z) などと同じ）。
      const hint = function(id) { const label = shortcutLabel(id); return label ? ' (' + label + ')' : ''; };
      document.querySelectorAll('#viewMenu [data-view]').forEach(function(item) {
        const id = item.dataset.view;
        const trailing = item.querySelector('[slot="trailing-supporting-text"]');
        if (trailing) trailing.textContent = shortcutLabel(id);
      });
      const menuButton = document.getElementById('viewMenuButton');
      if (menuButton) menuButton.title = '表示の切り替え';
      const quick = document.getElementById('quickActualButton');
      if (quick) quick.title = '今日の実績を入力' + hint('quickActual');
      const today = document.getElementById('calendarToday');
      if (today) today.title = '今日へ移動' + hint('today');
      // 前後の期間: 設定したキーに、固定の矢印キーを添える（K / ←）。
      const arrowHint = function(id, arrow) { const label = shortcutLabel(id); const keys = [label, arrow].filter(Boolean); return keys.length ? ' (' + keys.join(' / ') + ')' : ''; };
      [['calendarPrev', 'prevPeriod', '前の期間', '←'], ['prevPeriod', 'prevPeriod', '前の期間', '←'], ['calendarNext', 'nextPeriod', '次の期間', '→'], ['nextPeriod', 'nextPeriod', '次の期間', '→']].forEach(function(entry) {
        const button = document.getElementById(entry[0]);
        if (button) button.title = entry[2] + arrowHint(entry[1], entry[3]);
      });
      const openDay = document.querySelector('#quickActualPanel .quick-open-day');
      if (openDay) openDay.title = '日タブでこの日を開く' + hint('day');
      const closeQuick = document.querySelector('#quickActualPanel .quick-close');
      if (closeQuick) closeQuick.title = '閉じる (Esc)';
      document.querySelectorAll('#viewMenu [data-view]').forEach(function(item) {
        const names = { day: '日', week: '週', month: '月', projects: 'プロジェクト' };
        item.title = names[item.dataset.view] + 'の表示' + hint(item.dataset.view);
      });
    }
    let shortcutCapture = null;
    function beginShortcutCapture(button) {
      endShortcutCapture(false);
      shortcutCapture = { button: button, action: button.dataset.shortcutAction, text: button.textContent };
      button.textContent = 'キーを押す';
      button.classList.add('is-capturing');
    }
    function endShortcutCapture(restore) {
      if (!shortcutCapture) return;
      const current = shortcutCapture;
      shortcutCapture = null;
      current.button.classList.remove('is-capturing');
      if (restore !== false) current.button.textContent = current.text;
    }
    function assignShortcut(actionId, key) {
      const next = Object.assign({}, state.uiPreferences);
      next.shortcuts = Object.assign({}, state.uiPreferences.shortcuts);
      if (key) {
        const clash = SHORTCUT_ACTIONS.find(function(action) { return action.id !== actionId && next.shortcuts[action.id] === key; });
        if (clash) { toast('「' + key.toUpperCase() + '」は「' + clash.label + '」で使っています', 'error'); renderShortcutSettings(); return false; }
      }
      next.shortcuts[actionId] = key;
      persistUiPreferences(next);
      renderShortcutSettings();
      applyShortcutHints();
      return true;
    }
    function bindShortcutSettings() {
      const list = document.getElementById('shortcutList');
      if (!list || list.dataset.bound) return;
      list.dataset.bound = '1';
      list.addEventListener('click', function(event) {
        const button = event.target.closest('.shortcut-key');
        if (button && !list.classList.contains('is-disabled')) beginShortcutCapture(button);
      });
      list.addEventListener('focusout', function() { setTimeout(function() { if (shortcutCapture && document.activeElement !== shortcutCapture.button) endShortcutCapture(true); }, 0); });
      document.addEventListener('keydown', function(event) {
        if (!shortcutCapture) return;
        event.preventDefault();
        event.stopPropagation();
        const action = shortcutCapture.action;
        if (event.key === 'Escape') { endShortcutCapture(true); return; }
        if (event.key === 'Backspace' || event.key === 'Delete') { endShortcutCapture(false); assignShortcut(action, ''); return; }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const key = normalizeShortcutKey(event.key);
        if (!key) { toast('英字か数字を1文字で押してください', 'error'); return; }
        endShortcutCapture(false);
        assignShortcut(action, key);
      }, true);
      document.getElementById('resetShortcuts').addEventListener('click', function() {
        const next = Object.assign({}, state.uiPreferences, { shortcuts: Object.assign({}, SHORTCUT_DEFAULTS), shortcutsEnabled: true });
        persistUiPreferences(next);
        renderShortcutSettings();
        applyShortcutHints();
      });
    }
    const STARTUP_VIEW_OPTIONS = [
      { value: 'last', label: '前回開いていた画面' },
      { value: 'day', label: '日（今日）' },
      { value: 'week', label: '週（今週）' },
      { value: 'month', label: '月（今月）' },
      { value: 'projects', label: 'プロジェクト（今月）' }
    ];
    const HOURS_STEP_OPTIONS = [{ value: '0.25', label: '0.25時間（15分）' }, { value: '0.5', label: '0.5時間（30分）' }, { value: '1', label: '1時間' }];
    function hoursStepValue(value) {
      const number = Number(value);
      return number === 0.5 || number === 1 ? number : 0.25;
    }
    function readUiPreferences() {
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY) || '{}') || {}; } catch (_) {}
      // 以前あった「保存バーや追加ボタンを隠す」設定（saveDock など）は、いまは使わない。保存済みの値は無視する。
      const preferences = {};
      preferences.awayDetection = stored.awayDetection !== false;
      preferences.awayMinutes = awayMinutesValue(stored.awayMinutes);
      preferences.shortcuts = readShortcutPreferences(stored);
      preferences.shortcutsEnabled = stored.shortcutsEnabled !== false;
      preferences.dailyShare = stored.dailyShare !== false;
      preferences.startupView = STARTUP_VIEW_OPTIONS.some(function(item) { return item.value === stored.startupView; }) ? stored.startupView : 'last';
      preferences.hoursStep = hoursStepValue(stored.hoursStep);
      preferences.externalEditWatch = stored.externalEditWatch !== false;
      return preferences;
    }
    function applyUiPreferences() {
      if (!state.uiPreferences) state.uiPreferences = readUiPreferences();
      const awayDetection = document.getElementById('awayDetectionEnabled');
      const awayMinutes = document.getElementById('awayDetectionMinutes');
      setSwitchOn(awayDetection, state.uiPreferences.awayDetection !== false);
      setSwitchOn(document.getElementById('dailyShareEnabled'), state.uiPreferences.dailyShare !== false);
      const shareSection = document.getElementById('dailyShareSection');
      if (shareSection) shareSection.hidden = state.uiPreferences.dailyShare === false;
      if (awayMinutes) {
        if (document.activeElement !== awayMinutes) awayMinutes.value = String(awayMinutesValue(state.uiPreferences.awayMinutes));
        awayMinutes.disabled = state.uiPreferences.awayDetection === false;
      }
      const startupView = document.getElementById('startupView');
      if (startupView && !startupView.dataset.filled) {
        fillSelect(startupView, STARTUP_VIEW_OPTIONS, state.uiPreferences.startupView);
        startupView.dataset.filled = '1';
      } else if (startupView) startupView.value = state.uiPreferences.startupView;
      const hoursStep = document.getElementById('hoursStep');
      if (hoursStep && !hoursStep.dataset.filled) {
        fillSelect(hoursStep, HOURS_STEP_OPTIONS, String(state.uiPreferences.hoursStep));
        hoursStep.dataset.filled = '1';
      } else if (hoursStep) hoursStep.value = String(state.uiPreferences.hoursStep);
      setSwitchOn(document.getElementById('externalEditWatch'), state.uiPreferences.externalEditWatch !== false);
      renderShortcutSettings();
      applyShortcutHints();
      updateSaveDock();
    }
    function saveUiPreferencesFromControls() {
      const next = {};
      const awayDetection = document.getElementById('awayDetectionEnabled');
      const awayMinutes = document.getElementById('awayDetectionMinutes');
      next.awayDetection = awayDetection ? switchIsOn(awayDetection) : true;
      next.awayMinutes = awayMinutesValue(awayMinutes ? awayMinutes.value : (state.uiPreferences && state.uiPreferences.awayMinutes));
      const shortcutsEnabled = document.getElementById('shortcutsEnabled');
      next.shortcuts = Object.assign({}, state.uiPreferences && state.uiPreferences.shortcuts || SHORTCUT_DEFAULTS);
      next.shortcutsEnabled = shortcutsEnabled ? switchIsOn(shortcutsEnabled) : true;
      const dailyShare = document.getElementById('dailyShareEnabled');
      next.dailyShare = dailyShare ? switchIsOn(dailyShare) : !(state.uiPreferences && state.uiPreferences.dailyShare === false);
      const previous = state.uiPreferences || {};
      const startupView = document.getElementById('startupView');
      next.startupView = (startupView && readOutlinedSelectValue(startupView)) || previous.startupView || 'last';
      const hoursStep = document.getElementById('hoursStep');
      next.hoursStep = hoursStepValue(hoursStep ? readOutlinedSelectValue(hoursStep) : previous.hoursStep);
      const externalEditWatch = document.getElementById('externalEditWatch');
      next.externalEditWatch = externalEditWatch ? switchIsOn(externalEditWatch) : previous.externalEditWatch !== false;
      const stepChanged = next.hoursStep !== previous.hoursStep;
      persistUiPreferences(next);
      applyUiPreferences();
      if (next.externalEditWatch) startExternalEditWatch(); else stopExternalEditWatch();
      if (stepChanged) {
        if (state.view === 'daily' && typeof renderDaily === 'function') renderDaily();
        if (typeof renderQuickActual === 'function' && document.getElementById('quickActualPanel') && !document.getElementById('quickActualPanel').hidden) renderQuickActual();
      }
      if (!next.awayDetection && state.timer) {
        clearAwayCandidate();
        persistTimer();
      }
      if (state.timer && state.timer.running) ensureIdleWatch();
      else if (!next.awayDetection) stopIdleWatch();
    }
    function selectAppSettingsTab(tabName) {
      const allowed = ['guide', 'feedback', 'general', 'work', 'calendar', 'googleTasks', 'backlog', 'display', 'advanced'];
      const tab = allowed.indexOf(tabName) >= 0 ? tabName : 'general';
      state.appSettings.activeTab = tab;
      document.querySelectorAll('[data-settings-tab]').forEach(function(button) {
        const active = button.dataset.settingsTab === tab;
        button.classList.toggle('is-active', active);
        const label = button.querySelector('.ui-navigation-label');
        button.ariaLabel = label.textContent + (active ? '（選択中）' : '');
      });
      document.querySelectorAll('[data-settings-panel]').forEach(function(panel) {
        panel.hidden = panel.dataset.settingsPanel !== tab;
        panel.classList.toggle('is-active', !panel.hidden);
      });
      const details = document.querySelector('#appSettingsDialog .settings-details');
      if (details) details.scrollTop = 0;
      const refreshCalendarButton = document.getElementById('refreshPlannerCalendar');
      if (refreshCalendarButton) refreshCalendarButton.hidden = state.view !== 'planning';
      if (tab === 'guide') renderGuideStorageStatus();
      if (tab === 'general') { loadSchemaBackups(); loadDataHealthSummary(); }
      if (tab === 'calendar') ensureCalendarSettingsLoaded();
      if (tab === 'googleTasks') ensureGoogleTasksSettingsLoaded();
      if (tab === 'backlog') loadBacklogSettings();
      if (tab === 'display') {
        setSwitchOn(document.getElementById('planActualCompletionSync'), completionSyncEnabled());
        applyUiPreferences();
        // 新しい作業のプロジェクトの選択肢。プロジェクトタブを開いていなくても選べるよう、一覧を読んでから並べる。
        syncDefaultProjectAssign();
        ensureProjectCatalog().then(function() { syncDefaultProjectAssign(); });
      }
      if (tab === 'work') renderWorkSettings();
    }
    // ---- 勤務時間（本人の設定としてサーバーに保存） ----
    const WORKDAY_WEEKDAY_LABELS = [{ day: 1, label: '月' }, { day: 2, label: '火' }, { day: 3, label: '水' }, { day: 4, label: '木' }, { day: 5, label: '金' }, { day: 6, label: '土' }, { day: 0, label: '日' }];
    function workdayTimeOptions() {
      const items = [];
      for (let minutes = 0; minutes <= 24 * 60; minutes += 30) {
        const label = Math.floor(minutes / 60) + ':' + pad2(minutes % 60);
        items.push({ value: pad2(Math.floor(minutes / 60)) + ':' + pad2(minutes % 60), label: label });
      }
      return items;
    }
    function workdayStartValue() { return /^\d{2}:\d{2}$/.test(String(state.workdayStart)) ? state.workdayStart : '09:00'; }
    function workdayEndValue() { return /^\d{2}:\d{2}$/.test(String(state.workdayEnd)) ? state.workdayEnd : '18:00'; }
    function renderWorkSettings() {
      const field = document.getElementById('workdayDefaultHours');
      if (field && document.activeElement !== field) field.value = String(workdayDefaultHours());
      const list = document.getElementById('workdayWeekdayList');
      if (list) {
        const selected = workdayWeekdays();
        list.textContent = '';
        WORKDAY_WEEKDAY_LABELS.forEach(function(item) {
          const label = document.createElement('label');
          const box = document.createElement('md-checkbox');
          box.setAttribute('touch-target', 'wrapper');
          box.value = String(item.day);
          box.checked = selected.indexOf(item.day) >= 0;
          box.setAttribute('aria-label', item.label + '曜日に勤務する');
          box.addEventListener('change', saveWorkdayWeekdaysFromControls);
          label.appendChild(box);
          label.appendChild(document.createTextNode(item.label));
          list.appendChild(label);
        });
      }
      fillSelect(document.getElementById('workdayStart'), workdayTimeOptions().slice(0, -1), workdayStartValue());
      fillSelect(document.getElementById('workdayEnd'), workdayTimeOptions().slice(1), workdayEndValue());
    }
    let workSettingsSaving = Promise.resolve();
    // 送った項目だけ保存する。保存したら、稼働時間を含む控えを古い扱いにして今の画面を読み直す。
    function saveWorkSettings(payload, message) {
      workSettingsSaving = workSettingsSaving.then(async function() {
        try {
          const result = await gas('saveWorkdayHoursSettings', payload);
          state.workdayHours = Number(result && result.hours) || workdayDefaultHours();
          if (result && Array.isArray(result.weekdays)) state.workdayWeekdays = result.weekdays.slice();
          if (result && result.start) state.workdayStart = result.start;
          if (result && result.end) state.workdayEnd = result.end;
          state.calendarCache = {};
          state.calendarFetchedAt = {};
          state.weekSnapshot = {};
          state.weekForecastCache = {};
          state.daily.weekSummary = null;
          invalidateProjectSnapshots();
          toast(message, 'success');
          if (!state.daily.dirty && !state.planner.dirty) {
            const refresh = state.view === 'daily' ? loadDaily({ force: true, silent: true })
              : state.view === 'planning' ? loadPlanner({ force: true, silent: true })
                : state.view === 'month' ? loadMonthGantt({ force: true })
                  : state.view === 'projects' ? loadProjectScreen({ force: true }) : null;
            if (refresh) refresh.catch(function() {});
          }
        } catch (error) {
          toast('勤務時間を保存できませんでした: ' + error.message, 'error');
        } finally {
          if (state.appSettings.activeTab === 'work') renderWorkSettings();
        }
      });
      return workSettingsSaving;
    }
    function saveWorkdayHoursSettings() {
      const field = document.getElementById('workdayDefaultHours');
      const wanted = Math.round(Number(field.value) * 4) / 4;
      const before = workdayDefaultHours();
      if (!(wanted > 0 && wanted <= 24)) {
        field.value = String(before);
        return toast('1日の稼働時間は0より大きく24以下で入力してください', 'error');
      }
      if (wanted === before) { field.value = String(before); return; }
      return saveWorkSettings({ hours: wanted }, '1日の稼働時間を' + wanted + '時間にしました');
    }
    function saveWorkdayWeekdaysFromControls() {
      const weekdays = Array.from(document.querySelectorAll('#workdayWeekdayList md-checkbox'))
        .filter(function(box) { return box.checked; })
        .map(function(box) { return Number(box.value); });
      return saveWorkSettings({ weekdays: weekdays }, weekdays.length ? '勤務する曜日を保存しました' : '勤務する曜日を空にしました（すべての日が0hになります）');
    }
    function saveWorkdayTimeRangeFromControls() {
      const start = readOutlinedSelectValue(document.getElementById('workdayStart')) || workdayStartValue();
      const end = readOutlinedSelectValue(document.getElementById('workdayEnd')) || workdayEndValue();
      if (end <= start) {
        renderWorkSettings();
        return toast('終業は始業より後にしてください', 'error');
      }
      if (start === workdayStartValue() && end === workdayEndValue()) return;
      return saveWorkSettings({ start: start, end: end }, '勤務時間帯を' + start.replace(/^0/, '') + '〜' + end.replace(/^0/, '') + 'にしました');
    }
    // スイッチはすぐ切り替わるようにし、保存と画面の読み直しは待たずに裏で行う（待つとスイッチが固まって見える）。
    // 保存中にまた切り替えたときは、最後の状態を保存し直す。
    let completionSyncSaving = false;
    let completionSyncPending = null;
    async function saveCompletionSyncSettings() {
      const control = document.getElementById('planActualCompletionSync');
      const wanted = switchIsOn(control);
      if (completionSyncSaving) { completionSyncPending = wanted; return; }
      completionSyncSaving = true;
      const before = completionSyncEnabled();
      try {
        const result = await gas('savePlanActualCompletionSyncSettings', { enabled: wanted });
        state.completionSync = result.enabled === true;
        // 設定変更前の完了判定を含む控えは、次の表示時に読み直す。
        state.weekSnapshot = {};
        state.weekForecastCache = {};
        state.daily.weekSummary = null;
        state.parentNamesByWeek = {};
        invalidateProjectSnapshots();
        toast('完了状態の同期設定を保存しました', 'success');
        if (!state.daily.dirty && !state.planner.dirty && completionSyncPending === null) {
          const refresh = state.view === 'daily' ? loadDaily({ force: true, silent: true })
            : state.view === 'planning' ? loadPlanner({ force: true, silent: true })
              : state.view === 'month' ? loadMonthGantt({ force: true }) : null;
          if (refresh) refresh.catch(function() {});
        }
      } catch (error) {
        setSwitchOn(control, before);
        completionSyncPending = null;
        toast('同期設定を保存できませんでした: ' + error.message, 'error');
      } finally {
        completionSyncSaving = false;
        if (completionSyncPending !== null) {
          const next = completionSyncPending;
          completionSyncPending = null;
          if (next !== completionSyncEnabled()) saveCompletionSyncSettings();
        }
      }
    }
    function dataHealthHintHtml(hint) {
      if (!hint) return '<p>まだ保存の記録がありません。</p>';
      const failed = hint.failedAfter
        ? '<p class="is-warning">' + escapeHtml(hint.failedAfter.time) + ' の保存（' + escapeHtml(hint.failedAfter.label) + '）が途中で失敗しています。一部のシートだけが書き換わっている可能性があります。</p>'
        : '';
      const restore = hint.time
        ? '<p>最後にアプリが正常に保存したのは <strong>' + escapeHtml(hint.time) + '</strong>（' + escapeHtml(hint.label) + '）です。壊れていたら、この時刻の版に戻すと直る見込みです。</p>'
        : '';
      return failed + restore;
    }
    function renderDataHealthLog(log) {
      const list = document.getElementById('dataHealthLog');
      if (!list) return;
      list.innerHTML = (log || []).map(function(entry) {
        return '<li class="' + (entry.ok ? 'is-ok' : 'is-failed') + '"><span>' + escapeHtml(entry.time) + '</span><span>' + (entry.ok ? '保存' : '失敗') + ' ' + escapeHtml(entry.label) + (entry.error ? '<small>' + escapeHtml(entry.error) + '</small>' : '') + '</span></li>';
      }).join('');
    }
    async function loadDataHealthSummary() {
      const summary = document.getElementById('dataHealthSummary');
      if (!state.storage || !state.storage.configured) {
        if (summary) summary.textContent = '保存先が未設定です';
        return;
      }
      try {
        const result = await gas('getDataHealthSummary');
        if (summary) summary.textContent = result.hint && result.hint.time ? '最後に正常に保存: ' + result.hint.time : 'まだ保存の記録がありません';
        renderDataHealthLog(result.log);
      } catch (error) {
        if (summary) summary.textContent = '保存の記録を確認できませんでした: ' + error.message;
      }
    }
    async function runDataHealthCheck() {
      const result = document.getElementById('dataHealthResult');
      showBusy('データを点検しています…');
      try {
        const health = await gas('checkDataHealth');
        const problems = health.problems || [];
        const list = problems.map(function(problem) {
          const place = [problem.file, problem.sheet ? '「' + problem.sheet + '」' : '', problem.cell].filter(Boolean).join(' ');
          return '<li><strong>' + escapeHtml(place) + '</strong> ' + escapeHtml(problem.message) + '</li>';
        }).join('');
        if (result) {
          result.innerHTML = problems.length
            ? '<p class="is-warning">' + problems.length + (health.truncated ? '件以上' : '件') + 'の気になる箇所が見つかりました（' + escapeHtml(health.checkedAt) + ' 点検）。</p><ul>' + list + '</ul>' + dataHealthHintHtml(health.hint)
            : '<p>問題は見つかりませんでした（' + escapeHtml(health.checkedAt) + ' 点検）。</p>';
        }
        renderDataHealthLog(health.log);
      } catch (error) {
        if (result) result.innerHTML = '<p class="is-warning">点検できませんでした: ' + escapeHtml(error.message) + '</p>';
      } finally {
        hideBusy();
      }
    }
    function schemaBackupSizeLabel(bytes) {
      const size = Number(bytes) || 0;
      if (size >= 1024 * 1024) return (Math.round(size / 1024 / 1024 * 10) / 10) + 'MB';
      return Math.max(1, Math.round(size / 1024)) + 'KB';
    }
    function renderSchemaBackups(items) {
      const list = document.getElementById('schemaBackupList');
      const summary = document.getElementById('schemaBackupSummary');
      const deleteAll = document.getElementById('deleteAllSchemaBackups');
      const backups = items || [];
      state.appSettings.schemaBackups = backups;
      const total = backups.reduce(function(sum, item) { return sum + (Number(item.size) || 0); }, 0);
      if (summary) summary.textContent = backups.length ? 'バックアップ ' + backups.length + '件（合計 ' + schemaBackupSizeLabel(total) + '）' : 'バックアップはありません';
      if (deleteAll) deleteAll.disabled = !backups.length;
      if (!list) return;
      list.innerHTML = backups.map(function(item) {
        return '<div class="backup-row"><span class="backup-copy"><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">' + escapeHtml(item.name) + '</a><small>' + escapeHtml(item.createdAt) + ' · ' + schemaBackupSizeLabel(item.size) + '</small></span><md-outlined-button class="ghost-button" type="button" data-delete-backup="' + escapeHtml(item.id) + '">削除</md-outlined-button></div>';
      }).join('');
    }
    async function loadSchemaBackups() {
      const summary = document.getElementById('schemaBackupSummary');
      if (!state.storage || !state.storage.configured) {
        renderSchemaBackups([]);
        return;
      }
      try {
        renderSchemaBackups(await gas('listSchemaBackups'));
      } catch (error) {
        if (summary) summary.textContent = 'バックアップを確認できませんでした: ' + error.message;
      }
    }
    async function deleteSchemaBackups(ids) {
      const targets = (ids || []).filter(Boolean);
      if (!targets.length) return;
      const confirmed = await confirmDialog({
        title: targets.length === 1 ? 'このバックアップを削除しますか？' : 'バックアップ ' + targets.length + '件を削除しますか？',
        message: 'Driveのゴミ箱に移ります。30日以内なら、ゴミ箱から戻せます。',
        confirmLabel: '削除する',
        cancelLabel: 'キャンセル',
        danger: true
      });
      if (!confirmed) return;
      showBusy('バックアップを削除しています…');
      try {
        const result = await gas('trashSchemaBackups', targets);
        renderSchemaBackups(result.backups);
        toast('バックアップを ' + result.trashed + '件削除しました', 'success');
      } catch (error) {
        toast('バックアップを削除できませんでした: ' + error.message, 'error');
      } finally {
        hideBusy();
      }
    }
    // 使い方の各手順の「開く」ボタン。設定の画面へ移るものと、日・週・月・プロジェクトを開くものがある。
    // 使い方の手順1に、いまの保存先の状態を出す。
    async function renderGuideStorageStatus() {
      const status = document.getElementById('guideStorageStatus');
      const button = document.getElementById('guideStorageButton');
      if (!status) return;
      let storage = state.storage;
      if (!storage) {
        try { storage = await gas('getAppStorageStatus'); } catch (_) { storage = null; }
      }
      if (!storage) { status.textContent = '保存先の状態を取得できませんでした。'; return; }
      const configured = !!storage.configured;
      status.textContent = configured
        ? '現在の保存先: ' + (storage.folderPath || storage.folderName || '設定済み') + (storage.years && storage.years.length ? '（' + storage.years.join('・') + '年）' : '')
        : '現在の保存先: 未設定です。';
      status.classList.toggle('is-warn', !configured);
      if (button) button.textContent = configured ? '保存先を確認・変更する' : '保存先を設定する';
    }
    function bindGuidePanel() {
      const panel = document.getElementById('settingsPanelGuide');
      if (!panel || panel.dataset.bound) return;
      panel.dataset.bound = '1';
      panel.addEventListener('click', function(event) {
        const button = event.target.closest('[data-guide-go]');
        if (!button) return;
        const target = button.dataset.guideGo;
        if (['day', 'week', 'month'].indexOf(target) >= 0) { closeAppSettingsDialog(); setCalendarMode(target); return; }
        if (target === 'projects') { closeAppSettingsDialog(); openProjectsView(); return; }
        if (target === 'feedback-form') { openExternal('feedback'); return; }
        if (target === 'sheet') { const open = document.getElementById('openSheet'); if (open) open.click(); return; }
        selectAppSettingsTab(target);
      });
    }
    // 初めて使うときだけ、使い方を自動で開く（プレビューでは開かない）。
    function showGuideOnFirstRun() {
      if (typeof window !== 'undefined' && window.__previewData) return;
      const key = scopedStorageKey('matomete-kousu-guide-seen-v1');
      let seen = false;
      try { seen = !!localStorage.getItem(key); } catch (_) { seen = true; }
      if (seen) return;
      try { localStorage.setItem(key, '1'); } catch (_) {}
      openAppSettings('guide');
    }
    function openAppSettings(tabName) {
      showAppDialog(document.getElementById('appSettingsDialog'));
      selectAppSettingsTab(tabName || 'general');
      applyUiPreferences();
    }
    function closeAppSettingsDialog() {
      hideAppDialog(document.getElementById('appSettingsDialog'));
    }
    function setGoogleTasksSyncStatus(message) {
      const status = document.getElementById('googleTasksSyncStatus');
      if (status) status.textContent = message;
      state.googleTasks.syncStatus = String(message || '');
    }
    function setGoogleTasksSyncEnabled(enabled, targetListTitle, autoSync) {
      const active = !!enabled;
      state.project.googleTasksEnabled = active;
      state.project.googleTasksTargetListTitle = String(targetListTitle || '');
      state.googleTasks.autoSync = !!autoSync;
      state.googleTasks.preferenceLoaded = true;
      const button = document.getElementById('syncProjectIssuesGoogleTasks');
      if (button && !state.googleTasks.syncing) button.disabled = !active;
      const autoCheckbox = document.getElementById('googleTasksAutoSync');
      if (autoCheckbox) {
        autoCheckbox.disabled = !active;
        setSwitchOn(autoCheckbox, state.googleTasks.autoSync);
      }
      const enabledCheckbox = document.getElementById('googleTasksEnabled');
      setSwitchOn(enabledCheckbox, active);
      const hint = active
        ? '同期先: 「' + (state.project.googleTasksTargetListTitle || '設定済みリスト') + '」 / 自動同期: ' + (state.googleTasks.autoSync ? 'オン（起動時・保存後）' : 'オフ')
        : 'Google Tasks連携はオフです';
      setGoogleTasksSyncStatus(hint);
    }
    async function refreshGoogleTasksSyncPreference() {
      try {
        const preference = await gas('getGoogleTasksSyncPreference');
        setGoogleTasksSyncEnabled(!!(preference && preference.enabled && preference.targetListId), preference && preference.targetListTitle, preference && preference.autoSync);
      } catch (_) {
        setGoogleTasksSyncEnabled(false, '', false);
      }
    }
    function renderGoogleTasksListOptions(settings, selectedValue) {
      const select = document.getElementById('googleTasksTargetList');
      const lists = settings && Array.isArray(settings.tasklists) ? settings.tasklists : [];
      const savedId = String(settings && settings.targetListId || '');
      const selectedId = selectedValue == null ? savedId : String(selectedValue || '');
      const items = [{ value: '', label: '既存のリストを選択してください' }];
      lists.forEach(function(list) { items.push({ value: list.id, label: list.title }); });
      if (savedId && !lists.some(function(list) { return list.id === savedId; })) {
        items.push({ value: savedId, label: '設定済みのリストが見つかりません', disabled: true });
      }
      items.push({ value: '__create__', label: '新しいタスクリストを作成…' });
      const chosen = selectedId === '__create__' || lists.some(function(list) { return list.id === selectedId; }) ? selectedId : '';
      fillSelect(select, items, chosen);
      document.getElementById('googleTasksNewListTitle').hidden = chosen !== '__create__';
    }
    async function ensureGoogleTasksSettingsLoaded(force) {
      if (state.appSettings.googleTasksLoaded && !force) return;
      const button = document.getElementById('reloadGoogleTasksLists');
      if (button) button.disabled = true;
      try {
        const settings = await gas('getGoogleTasksSyncSettings');
        setSwitchOn(document.getElementById('googleTasksEnabled'), !!settings.enabled);
        setSwitchOn(document.getElementById('googleTasksAutoSync'), !!settings.autoSync);
        renderGoogleTasksListOptions(settings);
        setGoogleTasksSyncEnabled(!!(settings.enabled && settings.targetListId), settings.targetListTitle, settings.autoSync);
        state.appSettings.googleTasksLoaded = true;
      } catch (error) {
        toast('Google Tasks設定を読み込めませんでした: ' + error.message, 'error');
      } finally {
        if (button) button.disabled = false;
      }
    }
    async function reloadGoogleTasksSettingsLists() {
      const select = document.getElementById('googleTasksTargetList');
      const selected = select.value;
      const button = document.getElementById('reloadGoogleTasksLists');
      button.disabled = true;
      try {
        const settings = await gas('getGoogleTasksSyncSettings');
        settings.enabled = switchIsOn(document.getElementById('googleTasksEnabled'));
        settings.autoSync = switchIsOn(document.getElementById('googleTasksAutoSync'));
        settings.targetListId = selected;
        renderGoogleTasksListOptions(settings);
        state.appSettings.googleTasksLoaded = true;
      } catch (error) {
        toast('タスクリストを取得できませんでした: ' + error.message, 'error');
      } finally {
        button.disabled = false;
      }
    }
    async function saveGoogleTasksSettings() {
      const button = document.getElementById('saveGoogleTasksSettings');
      if (button.disabled) return;
      const enabled = switchIsOn(document.getElementById('googleTasksEnabled'));
      const autoSync = enabled && switchIsOn(document.getElementById('googleTasksAutoSync'));
      const selected = document.getElementById('googleTasksTargetList').value;
      const createListTitle = selected === '__create__' ? document.getElementById('googleTasksNewListTitle').value.trim() : '';
      if (enabled && !selected) return toast('同期先のタスクリストを選んでください', 'error');
      if (selected === '__create__' && !createListTitle) return toast('新しいタスクリスト名を入力してください', 'error');
      if (selected === '__create__' && !enabled) return toast('新しいリストを作る場合は、連携を有効にしてください', 'error');
      button.disabled = true;
      showBusy('Google Tasksの設定を保存しています…');
      try {
        const settings = await gas('saveGoogleTasksSyncSettings', {
          enabled: enabled,
          autoSync: autoSync,
          targetListId: selected && selected !== '__create__' ? selected : '',
          createListTitle: createListTitle
        });
        setGoogleTasksSyncEnabled(!!(settings && settings.enabled && settings.targetListId), settings && settings.targetListTitle, settings && settings.autoSync);
        state.appSettings.googleTasksLoaded = true;
        const select = document.getElementById('googleTasksTargetList');
        const existingOption = Array.from(select.querySelectorAll('md-select-option')).some(function(option) { return option.value === settings.targetListId; });
        if (settings.targetListId && !existingOption) {
          const option = document.createElement('md-select-option');
          option.value = settings.targetListId;
          const headline = document.createElement('div');
          headline.slot = 'headline';
          headline.textContent = settings.targetListTitle || '設定済みのリスト';
          option.appendChild(headline);
          select.insertBefore(option, select.querySelector('md-select-option[value="__create__"]'));
        }
        if (settings.targetListId) select.value = settings.targetListId;
        toast(enabled ? (autoSync ? 'Google Tasks連携と自動同期を有効にしました' : 'Google Tasks連携を有効にしました') : 'Google Tasks連携をオフにしました', 'success');
      } catch (error) {
        toast('Google Tasks設定を保存できませんでした: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        hideBusy();
      }
    }
    function googleTasksSyncMonthKey() {
      return state.view === 'projects' && isProjectMonthKey(state.project.monthKey)
        ? state.project.monthKey
        : projectMonthForToday();
    }
    async function runGoogleTasksSync(options) {
      options = options || {};
      const automatic = !!options.automatic;
      if (!state.project.googleTasksEnabled || (automatic && !state.googleTasks.autoSync)) return;
      if (state.googleTasks.syncing) return;
      const button = document.getElementById('syncProjectIssuesGoogleTasks');
      const originalText = button ? button.textContent : '';
      state.googleTasks.syncing = true;
      if (button) { button.disabled = true; button.textContent = automatic ? '自動同期中…' : '同期中…'; }
      if (automatic) setGoogleTasksSyncStatus('Google Tasksへ自動同期しています…');
      else showBusy('Google Tasksへ同期しています…');
      try {
        const monthKey = options.monthKey || googleTasksSyncMonthKey();
        const result = await gas('syncProjectIssuesToGoogleTasks', monthKey);
        const monthLabel = result && result.monthKey || monthKey;
        if (!result || !(result.total || result.completed || result.deleted)) {
          const emptyMessage = monthLabel + ': 同期する予定の課題はありません（日次だけの作業・カレンダー・未着手の予定は対象外です）';
          setGoogleTasksSyncStatus(emptyMessage);
          if (!automatic) toast(emptyMessage);
          return;
        }
        const summary = '「' + result.taskListTitle + '」へ同期しました（追加 ' + result.created + '件・更新 ' + result.updated + '件・完了 ' + (result.completed || 0) + '件・変更なし ' + result.unchanged + '件）';
        setGoogleTasksSyncStatus(monthLabel + ': ' + summary);
        if (!automatic) toast(summary, 'success');
      } catch (error) {
        setGoogleTasksSyncStatus('Google Tasks同期エラー: ' + error.message);
        if (!automatic) toast('Google Tasksへの同期に失敗しました: ' + error.message, 'error');
      } finally {
        state.googleTasks.syncing = false;
        if (button) { button.disabled = !state.project.googleTasksEnabled; button.textContent = originalText || '今すぐ同期'; }
        if (!automatic) hideBusy();
      }
    }
    const GOOGLE_TASKS_AUTO_SYNC_INTERVAL_MS = 60 * 1000;
    function scheduleAutoGoogleTasksSync(monthKey) {
      if (!state.googleTasks.preferenceLoaded) {
        refreshGoogleTasksSyncPreference().then(function() { scheduleAutoGoogleTasksSync(monthKey); });
        return;
      }
      if (!state.project.googleTasksEnabled || !state.googleTasks.autoSync) return;
      const key = isProjectMonthKey(monthKey) ? monthKey : googleTasksSyncMonthKey();
      if (state.googleTasks.autoSyncTimer) clearTimeout(state.googleTasks.autoSyncTimer);
      // 自動同期は1回3〜5秒かかり、その間は他の保存を待たせるため、保存のたびではなく最短でも
      // GOOGLE_TASKS_AUTO_SYNC_INTERVAL_MS おきにまとめて行う。同期中なら終わってから行う。
      const wait = Math.max(900, state.googleTasks.lastAutoSyncAt + GOOGLE_TASKS_AUTO_SYNC_INTERVAL_MS - Date.now());
      state.googleTasks.autoSyncTimer = setTimeout(function() {
        state.googleTasks.autoSyncTimer = null;
        if (state.googleTasks.syncing) {
          scheduleAutoGoogleTasksSync(key);
          return;
        }
        state.googleTasks.lastAutoSyncAt = Date.now();
        runGoogleTasksSync({ automatic: true, monthKey: key });
      }, wait);
    }
    function syncProjectIssuesGoogleTasks() {
      closeAppSettingsDialog();
      return runGoogleTasksSync({ automatic: false, monthKey: googleTasksSyncMonthKey() });
    }
    async function openProjectIssue(projectIdValue) {
      const id = String(projectIdValue || '');
      if (!id) return;
      if (state.view === 'daily' && dailyNeedsLeaveConfirm() && !await confirmLeaveUnsaved('予定画面へ移動')) return;
      if (state.view === 'planning' && unsavedNeedsLeaveConfirm() && !await confirmLeaveUnsaved('課題登録へ移動')) return;
      const monthKey = state.project.monthKey || projectMonthForToday();
      state.project.issueProjectId = id;
      state.view = 'planning';
      state.calendarMode = 'week';
      state.planner.type = 'week';
      state.planner.key = projectIssueWeekKey(monthKey);
      applyViewVisibility();
      syncCalendarControl();
      syncNav();
      updateSaveDock();
      await loadPlanner();
    }

