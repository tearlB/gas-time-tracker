    function appDialogAnimation(opening) {
      const duration = opening ? 200 : 140;
      // Animate the whole dialog together; growing only its background exposes
      // the footer and form controls before their surface reaches them.
      const hidden = { opacity: 0, transform: 'translateY(8px) scale(.98)' };
      const visible = { opacity: 1, transform: 'translateY(0) scale(1)' };
      return {
        dialog: [[opening ? [hidden, visible] : [visible, hidden], {
          duration: duration, easing: 'cubic-bezier(.2, 0, 0, 1)', fill: 'both'
        }]],
        scrim: [[opening ? [{ opacity: 0 }, { opacity: .32 }] : [{ opacity: .32 }, { opacity: 0 }], {
          duration: duration, easing: 'linear', fill: 'both'
        }]]
      };
    }
    function prepareAppDialogMotion(dialog) {
      if (!dialog || dialog.localName !== 'md-dialog') return;
      dialog.quick = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      dialog.getOpenAnimation = function() { return appDialogAnimation(true); };
      dialog.getCloseAnimation = function() { return appDialogAnimation(false); };
    }
    function showAppDialog(dialog) {
      if (!dialog) return;
      if (typeof dialog.show === 'function') {
        prepareAppDialogMotion(dialog);
        dialog.show();
      } else dialog.hidden = false;
    }
    function hideAppDialog(dialog) {
      if (!dialog) return;
      if (typeof dialog.close === 'function') {
        if (dialog.open) {
          prepareAppDialogMotion(dialog);
          dialog.close();
        }
        return;
      }
      dialog.hidden = true;
    }
    function appDialogIsOpen(dialog) {
      if (!dialog) return false;
      if (dialog.localName === 'md-dialog' || dialog.localName === 'md-menu') return !!dialog.open;
      return !dialog.hidden;
    }
    // 標準の confirm の代わりに使う、Material の確認ダイアログ。選んだ結果（true / false）を返す。
    // options: title（見出し）、message（本文。改行できる）、confirmLabel、cancelLabel、danger（取り返しのつかない操作は true）
    const confirmDialogState = { resolve: null };
    function settleConfirmDialog(value) {
      const resolve = confirmDialogState.resolve;
      confirmDialogState.resolve = null;
      hideAppDialog(document.getElementById('confirmDialog'));
      if (resolve) resolve(!!value);
    }
    function confirmDialog(options) {
      options = options || {};
      const dialog = document.getElementById('confirmDialog');
      if (!dialog) return Promise.resolve(false);
      if (confirmDialogState.resolve) settleConfirmDialog(false);
      document.getElementById('confirmDialogTitle').textContent = options.title || '確認';
      const message = document.getElementById('confirmDialogMessage');
      message.textContent = options.message || '';
      message.hidden = !options.message;
      const ok = document.getElementById('confirmDialogOk');
      ok.textContent = options.confirmLabel || 'OK';
      ok.classList.toggle('is-danger', !!options.danger);
      document.getElementById('confirmDialogCancel').textContent = options.cancelLabel || 'キャンセル';
      return new Promise(function(resolve) {
        confirmDialogState.resolve = resolve;
        showAppDialog(dialog);
        // 取り返しのつかない操作は、うっかり Enter で進めないよう、やめる側に合わせておく。
        setTimeout(function() { const target = document.getElementById(options.danger ? 'confirmDialogCancel' : 'confirmDialogOk'); if (target && target.focus) target.focus(); }, 0);
      });
    }
    // 未保存の変更があるまま画面や期間を移るときの確認。action は「日付を移動」のような、移る操作の言い方。
    function confirmLeaveUnsaved(action) {
      return confirmDialog({
        title: '未保存の変更があります',
        message: action + 'すると、保存していない変更は失われます。',
        confirmLabel: '破棄して続ける',
        cancelLabel: '編集を続ける',
        danger: true
      });
    }
    function bindAppDialogCancel(dialog, close) {
      if (!dialog || typeof close !== 'function') return;
      dialog.addEventListener('cancel', function(event) {
        event.preventDefault();
        close();
      });
    }

    const SERVICE_URL = '<?= getServiceUrl() ?>';
    const SCRIPT_EDITOR_URL = '<?= getScriptEditorUrl() ?>';
    const FEEDBACK_FORM_URL = '<?= getFeedbackFormUrl() ?>';
    // ブラウザに控える内容はアカウントごとに分ける。同じブラウザで別のGoogleアカウントに切り替えても、
    // 前のアカウントの予定・実績・設定が見えないようにする。値が取れないとき（空）は、従来どおり分けない。
    const USER_SCOPE_RAW = '<?= getUserStorageScope() ?>';
    const USER_SCOPE = /^[a-f0-9]{16}$/.test(USER_SCOPE_RAW) ? USER_SCOPE_RAW : '';
    function scopedStorageKey(base) { return USER_SCOPE ? base + ':' + USER_SCOPE : base; }
    // 分ける前の控えは、最初に開いたアカウントのものとして引き継ぎ、元の場所からは消す（別のアカウントには渡さない）。
    (function claimLegacyStorage() {
      if (!USER_SCOPE || typeof localStorage === 'undefined') return;
      ['matomete-kousu-timer-v2', 'matomete-kousu-view-v1', 'matomete-kousu-ui-preferences-v1', 'matomete-kousu-calendar-exclusions-v1',
        'matomete-kousu-nav-v1', 'matomete-kousu-month-filter-v1', 'matomete-kousu-default-project'].forEach(function(base) {
        try {
          const legacy = localStorage.getItem(base);
          if (legacy == null) return;
          if (localStorage.getItem(scopedStorageKey(base)) == null) localStorage.setItem(scopedStorageKey(base), legacy);
          localStorage.removeItem(base);
        } catch (_) {}
      });
    })();
    const TIMER_KEY = scopedStorageKey('matomete-kousu-timer-v2');
    const VIEW_KEY = scopedStorageKey('matomete-kousu-view-v1');
    const UI_PREFERENCES_KEY = scopedStorageKey('matomete-kousu-ui-preferences-v1');
    function completionSyncEnabled() { return state.completionSync === true; }
      const CALENDAR_EXCLUSIONS_KEY = scopedStorageKey('matomete-kousu-calendar-exclusions-v1');
      const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000;
      const NAV_LOCAL_KEY = scopedStorageKey('matomete-kousu-nav-v1');
      const NAV_SNAPSHOT_FRESH_MS = 3 * 60 * 1000;
      // スプレッドシートを直接編集してアプリに戻ってきたときは、これより古ければ裏で読み直す。
      const NAV_FOCUS_REFRESH_MS = 15 * 1000;
      const NAV_LOCAL_KEEP_DAYS = 45;
      const NAV_LOCAL_KEEP_WEEKS = 16;
      const NAV_LOCAL_KEEP_MONTHS = 6;
      const DEDUPED_READ_METHODS = {
        getAppStorageStatus: true,
        getTaskNameSuggestions: true,
        getPlanningCalendarSettings: true,
        loadDataForDate: true,
        getImportSuggestions: true,
        getManualCarrySuggestions: true,
        loadPlanningWorkspace: true,
        loadPlanningMonthGantt: true,
        loadPlanningCalendarCapacity: true,
        getSpreadsheetUrlForDate: true,
        getScriptEditorUrl: true,
        inspectAppStorageFolder: true,
        listAppStorageFolders: true,
        previewAnnualStorageMigration: true,
        inspectExistingAppStorage: true,
        loadProjectWorkspace: true,
        loadProjectCatalog: true,
        getGoogleTasksSyncPreference: true,
        getGoogleTasksSyncSettings: true
      };
    const state = {
      view: 'planning',
      calendarMode: 'week',
      historyNames: [],
      historyNamesPromise: null,
      dailyCache: {},
      dailyFetchedAt: {},
      weekSnapshot: {},
      projectCache: {},
      projectFetchedAt: {},
      nav: { daily: 0, planner: 0, project: 0 },
      month: { key: '', data: null, cache: {}, busy: false, saving: false, savingAuto: false, requestSeq: 0, rows: [], collapsed: {}, filter: { query: '', projectId: '', status: '', deviationOnly: false } },
      parentNamesByWeek: {},
      weeklySubtasksByWeek: {},
      calendarCache: {},
      calendarFetchedAt: {},
      weekForecastCache: {},
      weekForecastBusy: {},
      weekWorkspaceBusy: {},
      weekContinuationBusy: {},
      weekWorkspaceRefreshTimer: {},
      weekWorkspaceRefreshBusy: {},
      weekWorkspaceRefreshQueued: {},
      daily: { date: '', loadedDate: '', mode: 'new', rows: [], dirty: false, busy: false, saving: false, savingSeq: 0, saveQueued: false, changeSeq: 0, autoSaveTimer: null, autoSaveDeferred: false, autoSaveRetryCount: 0, weekKey: '', weekSummary: null, weekItems: [], weekSubtasks: [], url: '', importSource: [], needsCalendar: false, agenda: null, calendarAutoNames: {}, calendarRowsAtLoad: [] },
      planner: { type: 'week', key: '', summary: null, items: [], editingId: '', editingDate: '', editingEvent: null, editingSubtasks: [], expandedSubtasks: {}, focusedPlanId: '', calendarSettings: null, verifiedFolder: null, folderBrowser: null, dirty: false, busy: false, saving: false, savingSeq: 0, saveQueued: false, changeSeq: 0, autoSaveTimer: null, autoSaveRetryCount: 0, capacityBusy: false, capacityRequest: 0, capacityPromise: null },
      project: { monthKey: '', workspace: null, busy: false, catalogPromise: null, catalogLoaded: false, editingId: '', issueProjectId: '', saving: false, monthSaving: false, monthSaveQueued: false, autoSaveTimer: null, autoSaveRetryCount: 0, renderPending: false, googleTasksEnabled: false, googleTasksTargetListTitle: '' },
      googleTasks: { autoSync: false, preferenceLoaded: false, syncing: false, autoSyncTimer: null, lastAutoSyncAt: 0, syncStatus: '' },
      appSettings: { activeTab: 'general', calendarLoaded: false, googleTasksLoaded: false, schemaBackups: [] },
      uiPreferences: null,
      completionSync: '<?= getPlanActualCompletionSyncSettings().enabled ?>' === 'true',
      workdayHours: Number('<?= getWorkdayHoursSettings().hours ?>') || 8,
      workdayWeekdays: '<?= getWorkdayHoursSettings().weekdays.join(",") ?>',
      workdayStart: '<?= getWorkdayHoursSettings().start ?>',
      workdayEnd: '<?= getWorkdayHoursSettings().end ?>',
      projects: [],
      storage: null,
      candidates: [],
      candidateKind: '',
      weeklyPlanNames: [],
      weeklyPlanMeta: {},
      editHistory: { past: [], future: [], lastDigest: '', lastKey: '', lastAt: 0, applying: false },
      timer: null,
      timerTick: null,
      idle: { detector: null, controller: null, threshold: 0, starting: false, permission: '', user: 'active', screen: 'unlocked', awaySince: 0, dialog: null },
      dragId: '',
      dragOrder: '',
      suppressPlanClick: false
    };

    const pendingGasReads = {};
    function fillSelect(select, items, selectedValue) {
      if (!select) return '';
      const selected = selectedValue == null ? '' : String(selectedValue);
      const nodes = (items || []).map(function(item) {
        const option = document.createElement('md-select-option');
        const value = item.value == null ? '' : String(item.value);
        option.value = value;
        if (item.disabled) option.disabled = true;
        if (value === selected) option.selected = true;
        const headline = document.createElement('div');
        headline.slot = 'headline';
        headline.textContent = item.label;
        option.appendChild(headline);
        return option;
      });
      select.replaceChildren.apply(select, nodes);
      if (select.id === 'planDialogProject' || select.id === 'defaultProjectAssign') select.dataset.projectId = selected;
      const apply = function() {
        if (String(select.value || '') !== selected) select.value = selected;
        if (select.id === 'planDialogProject' || select.id === 'defaultProjectAssign') select.dataset.projectId = selected;
        // 値が空の選択肢（「未設定」など）を選んでいると、Material の選択欄は何も表示せず見出しだけを大きく出す。
        // 選んだ選択肢の文字を出す。
        if (!selected && !select.displayText) {
          const chosen = select.querySelector('md-select-option[selected]') || nodes.find(function(option) { return option.selected; });
          const text = chosen ? String(chosen.displayText || chosen.textContent || '').trim() : '';
          if (text) select.displayText = text;
        }
      };
      if (select.updateComplete && typeof select.updateComplete.then === 'function') select.updateComplete.then(apply);
      else apply();
      return selected;
    }
    function readOutlinedSelectValue(select) {
      if (!select) return '';
      const direct = String(select.value || '');
      if (direct) return direct;
      const options = select.querySelectorAll('md-select-option');
      for (let i = 0; i < options.length; i++) {
        if (options[i].selected) return String(options[i].value || '');
      }
      return String(select.dataset.projectId || '');
    }
    function gas(method) {
      const args = Array.prototype.slice.call(arguments, 1);
      let requestKey = '';
      if (DEDUPED_READ_METHODS[method]) {
        try { requestKey = method + ':' + JSON.stringify(args); }
        catch (_) { requestKey = ''; }
      }
      if (requestKey && pendingGasReads[requestKey]) return pendingGasReads[requestKey];
      const request = new Promise(function(resolve, reject) {
        const runner = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
        runner[method].apply(runner, args);
      });
      if (requestKey) {
        pendingGasReads[requestKey] = request;
        request.then(function() {
          if (pendingGasReads[requestKey] === request) delete pendingGasReads[requestKey];
        }, function() {
          if (pendingGasReads[requestKey] === request) delete pendingGasReads[requestKey];
        });
      }
      return request;
    }

    // 画面データは localStorage に置き、切り替えはそこからすぐ描画する。
    // スプレッドシートへの保存は従来どおり即時。読み取りの同期は、スナップショットが古くなったときだけ裏で行う。
    function screenLoadPlan(hasSnapshot, options) {
      const force = !!(options && options.force);
      if (!force && hasSnapshot) {
        const recent = !!(options && options.recent);
        return { mode: 'paint', refresh: !(options && options.refresh === false) && !recent };
      }
      return { mode: 'block' };
    }
    function snapshotIsRecent(fetchedAt, freshMs) {
      const stamp = Number(fetchedAt) || 0;
      return stamp > 0 && Date.now() - stamp < (freshMs || NAV_SNAPSHOT_FRESH_MS);
    }
    function navigationRefreshIsCurrent(token, currentToken, samePlace, dirty) {
      return token === currentToken && !!samePlace && !dirty;
    }
    function navigationDigest(value) {
      try { return JSON.stringify(value); }
      catch (_) { return ''; }
    }
    function rememberDailySnapshot(date, result) {
      if (!date || !result) return;
      state.dailyCache[date] = result;
      state.dailyFetchedAt[date] = Date.now();
      scheduleNavigationPersist();
    }
    function rememberProjectSnapshot(monthKey, workspace) {
      if (!monthKey || !workspace) return;
      state.projectCache[monthKey] = workspace;
      state.projectFetchedAt[monthKey] = Date.now();
      scheduleNavigationPersist();
    }
    // 保存したら、プロジェクトと前後の期間の控えを「古い」扱いにする。消してしまうと、次に開いたときに
    // 読み終わるまで待たされる（保存は自動で頻繁に起きる）ので、前の内容をすぐ出して裏で読み直させる。
    function invalidateProjectSnapshots() {
      Object.keys(state.projectFetchedAt || {}).forEach(function(monthKey) { state.projectFetchedAt[monthKey] = 0; });
      markAdjacentCalendarPeriodsStale();
      if (navigationPersistTimer) {
        clearTimeout(navigationPersistTimer);
        navigationPersistTimer = null;
      }
      flushNavigationPersist();
    }
    function rememberWeekSnapshot(type, key, summary, options) {
      if (!type || !key || !summary) return;
      options = options || {};
      const id = type + ':' + key;
      const prev = state.weekSnapshot[id] || {};
      const overlay = Object.prototype.hasOwnProperty.call(options, 'overlay') ? options.overlay : (prev.overlay || null);
      state.weekSnapshot[id] = {
        summary: summary,
        overlay: overlay,
        fetchedAt: options.stale ? 0 : Date.now()
      };
      scheduleNavigationPersist();
    }
    function navigationDayNumber(value) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
      if (!match) return null;
      return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
    }
    function navigationWeekNumber(value) {
      const match = /^(\d{4})-W(\d{2})$/.exec(String(value || ''));
      if (!match) return null;
      return Number(match[1]) * 53 + Number(match[2]);
    }
    function navigationMonthNumber(value) {
      const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
      if (!match) return null;
      return Number(match[1]) * 12 + Number(match[2]);
    }
    function navigationClone(value) {
      if (value == null) return null;
      try { return JSON.parse(JSON.stringify(value)); }
      catch (_) { return null; }
    }
    function navigationSummaryForStorage(summary) {
      const copy = navigationClone(summary);
      const days = copy && copy.capacity && copy.capacity.days;
      if (Array.isArray(days)) days.forEach(function(day) { if (day) delete day.events; });
      return copy;
    }
    function currentNavigationAnchor(now) {
      const date = now || new Date();
      const ymdText = ymd(date);
      return { date: ymdText, week: isoWeek(date), month: ymdText.slice(0, 7) };
    }
    function buildNavigationLocalDocument(source, anchor) {
      source = source || {};
      anchor = anchor || {};
      const today = navigationDayNumber(anchor.date);
      const todayWeek = navigationWeekNumber(anchor.week);
      const todayMonth = navigationMonthNumber(anchor.month);
      const daily = {};
      Object.keys(source.dailyCache || {}).forEach(function(date) {
        const day = navigationDayNumber(date);
        if (day == null || today == null || Math.abs(day - today) > NAV_LOCAL_KEEP_DAYS) return;
        const result = navigationClone(source.dailyCache[date]);
        if (!result) return;
        daily[date] = { result: result, fetchedAt: Number(source.dailyFetchedAt && source.dailyFetchedAt[date]) || 0 };
      });
      const weeks = {};
      Object.keys(source.weekSnapshot || {}).forEach(function(id) {
        if (id.indexOf('week:') !== 0) return;
        const key = id.slice(5);
        const week = navigationWeekNumber(key);
        if (week == null || todayWeek == null || Math.abs(week - todayWeek) > NAV_LOCAL_KEEP_WEEKS) return;
        const snap = source.weekSnapshot[id];
        const summary = navigationSummaryForStorage(snap && snap.summary);
        if (!summary) return;
        weeks[key] = {
          summary: summary,
          overlay: navigationClone(snap.overlay),
          fetchedAt: Number(snap.fetchedAt) || 0
        };
      });
      const projects = {};
      Object.keys(source.projectCache || {}).forEach(function(monthKey) {
        const month = navigationMonthNumber(monthKey);
        if (month == null || todayMonth == null || Math.abs(month - todayMonth) > NAV_LOCAL_KEEP_MONTHS) return;
        const workspace = navigationClone(source.projectCache[monthKey]);
        if (!workspace) return;
        projects[monthKey] = { workspace: workspace, fetchedAt: Number(source.projectFetchedAt && source.projectFetchedAt[monthKey]) || 0 };
      });
      return { v: 1, daily: daily, weeks: weeks, projects: projects };
    }
    function applyNavigationLocalDocument(target, doc) {
      if (!target || !doc || doc.v !== 1) return false;
      let applied = false;
      Object.keys(doc.daily || {}).forEach(function(date) {
        const entry = doc.daily[date];
        if (!entry || !entry.result || navigationDayNumber(date) == null) return;
        target.dailyCache[date] = entry.result;
        target.dailyFetchedAt[date] = Number(entry.fetchedAt) || 0;
        applied = true;
      });
      Object.keys(doc.weeks || {}).forEach(function(key) {
        const entry = doc.weeks[key];
        if (!entry || !entry.summary || navigationWeekNumber(key) == null) return;
        target.weekSnapshot['week:' + key] = {
          summary: entry.summary,
          overlay: entry.overlay || null,
          fetchedAt: Number(entry.fetchedAt) || 0
        };
        applied = true;
      });
      Object.keys(doc.projects || {}).forEach(function(monthKey) {
        const entry = doc.projects[monthKey];
        if (!entry || !entry.workspace || navigationMonthNumber(monthKey) == null) return;
        target.projectCache[monthKey] = entry.workspace;
        target.projectFetchedAt[monthKey] = Number(entry.fetchedAt) || 0;
        applied = true;
      });
      return applied;
    }
    let navigationPersistTimer = null;
    let navigationPersistIdle = 0;
    // 控えの書き出しは1回数十msかかる。週を横に流している最中に割り込むとカクつくので、
    // 操作が1秒止まってから、さらに手の空いたときに書き出す（閉じるときなどは flush で即時に書く）。
    function scheduleNavigationPersist() {
      if (typeof localStorage === 'undefined') return;
      if (navigationPersistTimer) clearTimeout(navigationPersistTimer);
      if (navigationPersistIdle && typeof cancelIdleCallback === 'function') cancelIdleCallback(navigationPersistIdle);
      navigationPersistIdle = 0;
      navigationPersistTimer = setTimeout(function() {
        navigationPersistTimer = null;
        if (typeof requestIdleCallback !== 'function') { flushNavigationPersist(); return; }
        navigationPersistIdle = requestIdleCallback(function() { navigationPersistIdle = 0; flushNavigationPersist(); }, { timeout: 3000 });
      }, 1000);
    }
    function flushNavigationPersist() {
      if (navigationPersistTimer) clearTimeout(navigationPersistTimer);
      navigationPersistTimer = null;
      if (navigationPersistIdle && typeof cancelIdleCallback === 'function') cancelIdleCallback(navigationPersistIdle);
      navigationPersistIdle = 0;
      if (typeof localStorage === 'undefined') return;
      const documentToStore = function(omitOverlay) {
        const doc = buildNavigationLocalDocument(state, currentNavigationAnchor());
        if (omitOverlay) Object.keys(doc.weeks || {}).forEach(function(key) { doc.weeks[key].overlay = null; });
        return JSON.stringify(doc);
      };
      try {
        localStorage.setItem(NAV_LOCAL_KEY, documentToStore(false));
      } catch (_) {
        try { localStorage.setItem(NAV_LOCAL_KEY, documentToStore(true)); }
        catch (_) {}
      }
    }
    function hydrateNavigationSnapshots() {
      if (typeof localStorage === 'undefined') return false;
      try {
        const raw = localStorage.getItem(NAV_LOCAL_KEY);
        if (!raw) return false;
        return applyNavigationLocalDocument(state, JSON.parse(raw));
      } catch (_) { return false; }
    }
    function clearNavigationSnapshots() {
      resetAdjacentCalendarPeriods();
      state.dailyCache = {};
      state.dailyFetchedAt = {};
      state.weekSnapshot = {};
      state.projectCache = {};
      state.projectFetchedAt = {};
      state.weekForecastCache = {};
      state.parentNamesByWeek = {};
      state.weeklySubtasksByWeek = {};
      state.weekContinuationBusy = {};
      if (navigationPersistTimer) {
        clearTimeout(navigationPersistTimer);
        navigationPersistTimer = null;
      }
      try { localStorage.removeItem(NAV_LOCAL_KEY); } catch (_) {}
      clearCalendarCapacityCache();
    }
    function navigationViewHoldsFocus(viewId) {
      const active = document.activeElement;
      if (!active || active === document.body) return false;
      const view = document.getElementById(viewId);
      return !!(view && view.contains(active) && active !== view);
    }
    async function runScreenLoad(spec) {
      const plan = screenLoadPlan(spec.hasSnapshot(), spec.options);
      if (plan.mode === 'paint') {
        spec.paintCached();
        if (plan.refresh) {
          const token = spec.beginRefresh();
          spec.refresh(token).catch(function(error) {
            if (spec.onRefreshError) spec.onRefreshError(error);
          });
        }
        return 'paint';
      }
      if (spec.isBusy && spec.isBusy()) return 'busy';
      if (spec.markBusy) spec.markBusy(true);
      if (!spec.silent && spec.showBusy) spec.showBusy();
      try {
        await spec.loadBlocking();
        return 'block';
      } finally {
        if (spec.markBusy) spec.markBusy(false);
        if (!spec.silent && spec.hideBusy) spec.hideBusy();
      }
    }

    function ensureTaskNameSuggestions() {
      if (state.historyNamesPromise) return state.historyNamesPromise;
      state.historyNamesPromise = gas('getTaskNameSuggestions').then(function(names) {
        state.historyNames = names || [];
        return state.historyNames;
      }).catch(function() {
        state.historyNames = [];
        return state.historyNames;
      });
      return state.historyNamesPromise;
    }

    function uid(prefix) {
      if (window.crypto && crypto.randomUUID) return prefix + crypto.randomUUID();
      return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function roundHours(value) { return Math.round((Number(value) || 0) * 4) / 4; }
    // −・＋ ボタンで増減する幅（設定の「表示・操作」）。保存は0.25h単位なので、その倍数だけ選べる。
    function hoursStepUnit() {
      const value = Number(state.uiPreferences && state.uiPreferences.hoursStep);
      return value === 0.5 || value === 1 ? value : 0.25;
    }
    function hoursStepLabel() { return hoursStepUnit() + 'h'; }
    // 刻みの倍数にそろえながら1段増減する（例: 刻み0.5hで1.25h → ＋で1.5h、−で1h）。
    function steppedHours(value, direction) {
      const unit = hoursStepUnit();
      const current = Math.max(0, Number(value) || 0);
      const next = direction > 0
        ? Math.floor(current / unit + 1e-9) * unit + unit
        : Math.ceil(current / unit - 1e-9) * unit - unit;
      return Math.max(0, roundHours(next));
    }
    function plannerHasWorkHours(planned, actual) {
      return roundHours(planned) > 0 || roundHours(actual) > 0;
    }
    // Keep the value that is being edited as-is. Quarter-hour normalization is
    // reserved for an explicit save/commit so typing an intermediate value does
    // not change the input or the generated text underneath it.
    function numericHours(value) {
      const number = Number(value);
      return isFinite(number) && number >= 0 ? number : 0;
    }
    function isQuarterHour(value) {
      const number = numericHours(value);
      return Math.abs(number * 4 - Math.round(number * 4)) < 1e-9;
    }
    function activeDailyTaskList() {
      const doc = typeof document !== 'undefined' ? document : null;
      if (!doc || typeof doc.getElementById !== 'function') return null;
      return doc.getElementById('taskList');
    }
    function dailyHoursAreConfirmed() {
      const list = activeDailyTaskList();
      const fallback = typeof document !== 'undefined' && document && typeof document.querySelectorAll === 'function' ? document.querySelectorAll('.today-value') : [];
      return Array.prototype.every.call(list ? list.querySelectorAll('.today-value') : fallback, function(input) {
        return String(input.value || '').trim() === '' || isQuarterHour(input.value);
      });
    }
    function liveHours(value) {
      const number = numericHours(value);
      return String(Math.round(number * 1000000) / 1000000);
    }
    function rawHoursText(value) {
      const raw = String(value == null ? '' : value).trim();
      if (!raw) return '0';
      const number = Number(raw);
      return isFinite(number) && number >= 0 ? raw : '0';
    }
    function normalizeDailyRowsForSave(rows) {
      return (rows || []).map(function(row) {
        const saved = Object.assign({}, row);
        const actual = roundHours(numericHours(row && row.today));
        const interrupt = String(row && row.type || '') === 'interrupt';
        saved.today = actual;
        saved.previous = interrupt ? 0 : roundHours(row && row.previous);
        saved.estimate = interrupt ? actual : roundHours(row && row.estimate);
        return saved;
      });
    }
    function normalizePlanDailyPlan(value) {
      const source = value && typeof value === 'object' ? value : {};
      const result = {};
      Object.keys(source).forEach(function(date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        const hoursValue = Number(source[date]);
        if (!isFinite(hoursValue) || hoursValue < 0) return;
        result[date] = roundHours(hoursValue);
      });
      return result;
    }
    function hours(value) { return roundHours(value).toFixed(2); }
    function compactHours(value) { return String(roundHours(value)); }
    function barLabel(value) {
      return '<span class="span-bar-label">' + compactHours(value) + 'h</span>';
    }
    // 週の帯の1日分の実績。予定の期間はバーで見せるので、ここには実績だけを出す。
    // 期間外の実績は、開始日より前なら「前倒し」、終了日より後なら「超過」と添える。
    // 長さは工数に比例させ、1日の標準の稼働時間で列いっぱいにする。
    function weekSpanActualHtml(actual, position) {
      const done = roundHours(actual);
      if (!(done > 0)) return '';
      const style = ' style="--actual-ratio:' + Math.min(100, Math.round(done / workdayDefaultHours() * 100)) + '%"';
      if (position === 'before') return '<em class="span-actual is-early"' + style + '>' + barLabel(done) + '<small>前倒し</small></em>';
      if (position === 'after') return '<em class="span-actual is-late"' + style + '>' + barLabel(done) + '<small>超過</small></em>';
      return '<em class="span-actual"' + style + '>' + barLabel(done) + '</em>';
    }
    function planPaceStatus(planned, actual, hasPlan, expected, done) {
      const planHours = Number(planned) || 0;
      const actualHours = Number(actual) || 0;
      const pace = expected == null || !isFinite(Number(expected)) ? 1 : Math.max(0, Math.min(1, Number(expected)));
      if (hasPlan === false && actualHours > 0) return { key: 'late', label: '遅延', tone: 'alert' };
      if (hasPlan === false) return { key: 'ontrack', label: '順調', tone: 'ok' };
      if (actualHours > planHours) return { key: 'late', label: '遅延', tone: 'alert' };
      if (planHours <= 0) return { key: 'ontrack', label: '順調', tone: 'ok' };
      if (done) {
        if (actualHours < planHours) return { key: 'ahead', label: '先行', tone: 'ahead' };
        return { key: 'ontrack', label: '順調', tone: 'ok' };
      }
      const expectedActual = planHours * pace;
      if (actualHours < expectedActual) return { key: 'late', label: '遅延', tone: 'alert' };
      if (actualHours > expectedActual) return { key: 'ahead', label: '先行', tone: 'ahead' };
      return { key: 'ontrack', label: '順調', tone: 'ok' };
    }
    function planActualStatus(planned, actual, hasPlan, expected, done) {
      const pace = planPaceStatus(planned, actual, hasPlan, expected, done);
      if (done) return { key: 'done', label: '完了', tone: pace.tone, paceKey: pace.key, paceLabel: pace.label, paceTone: pace.tone, done: true };
      return { key: pace.key, label: '進行中', tone: pace.tone, paceKey: pace.key, paceLabel: pace.label, paceTone: pace.tone, done: false };
    }
    function dailyTaskStatus(today, previous, estimate, done) {
      const actual = (Number(today) || 0) + (Number(previous) || 0);
      const planned = Number(estimate) || 0;
      const hasPlan = planned > 0;
      if (done) {
        if (!hasPlan) {
          return { key: 'done', label: '完了', tone: 'ok', paceKey: 'ontrack', paceLabel: '順調', paceTone: 'ok', done: true };
        }
        return planActualStatus(planned, actual, true, 1, true);
      }
      if (hasPlan && actual > planned) {
        return { key: 'late', label: '進行中', tone: 'alert', paceKey: 'late', paceLabel: '遅延', paceTone: 'alert', done: false };
      }
      return { key: 'ontrack', label: '進行中', tone: 'ok', paceKey: 'ontrack', paceLabel: '順調', paceTone: 'ok', done: false };
    }
    function sharePaceArrow(status) {
      const pace = status && (status.paceKey || status.key);
      if (pace === 'ahead') return '↑';
      if (pace === 'late') return '↓';
      return '';
    }
    function normalizePlanCompletionOverride(value) {
      if (value == null || String(value).trim() === '') return null;
      if (typeof value === 'boolean') return value;
      const normalized = String(value).trim().toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === '完了';
    }
    function dailyShareLine(row) {
      if (!row) return '';
      const name = String(row.name || '').trim();
      if (row.type === 'interrupt') {
        const actual = numericHours(row.today);
        return '（' + actual + '/0/' + actual + '_' + name + '）';
      }
      const done = row.type === 'interrupt' || String(row.status || '').trim() === '完了';
      const mark = sharePaceArrow(dailyTaskStatus(row.today, row.previous, row.estimate, done));
      return '（' + row.today + '/' + row.previous + '/' + row.estimate + mark + '_' + name + '）';
    }
    function addDaysYmd(value, delta) {
      const date = new Date(String(value || '') + 'T12:00:00');
      date.setDate(date.getDate() + delta);
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }
    function isYmdText(value) {
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    }
    function weekKeyStartYmd(key) {
      const match = String(key || '').match(/^(\d{4})-W(\d{2})$/);
      if (!match) return '';
      const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
      const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + (Number(match[2]) - 1) * 604800000);
      return monday.getUTCFullYear() + '-' + String(monday.getUTCMonth() + 1).padStart(2, '0') + '-' + String(monday.getUTCDate()).padStart(2, '0');
    }
    function weekFridayYmd(value) {
      const weekday = (new Date(String(value) + 'T12:00:00').getDay() + 6) % 7;
      return weekday >= 5 ? value : addDaysYmd(value, 4 - weekday);
    }
    function planRegisteredWeek(item) {
      return String((item && (item.originWeek || item.periodKey || item.carryWeek)) || '').trim();
    }
    // 予定の期間（ガントのバー）。開始日が空の旧データは登録した週の月曜、
    // 終了日が空なら開始日の週の金曜（開始日が土日ならその日）までとみなす。期間未定の予定は null。
    function planDateRange(item, fallbackWeekKey) {
      if (item && item.undated) return null;
      const explicitStart = isYmdText(item && item.startDate) ? item.startDate : '';
      const explicitEnd = isYmdText(item && item.endDate) ? item.endDate : '';
      const start = explicitStart || weekKeyStartYmd(planRegisteredWeek(item) || fallbackWeekKey);
      if (!start) return null;
      let end = explicitEnd || weekFridayYmd(start);
      if (end < start) end = start;
      return { start: start, end: end, explicitEnd: !!explicitEnd };
    }
    function planRangeLabel(range) {
      if (!range) return '';
      return range.start === range.end ? shortYmdLabel(range.start) : shortYmdLabel(range.start) + '〜' + shortYmdLabel(range.end);
    }
    function shortYmdLabel(value) {
      const parts = String(value || '').split('-');
      return parts.length === 3 ? Number(parts[1]) + '/' + Number(parts[2]) : String(value || '');
    }
    function planDatePosition(range, dateYmd) {
      if (!range || !dateYmd) return 'within';
      if (dateYmd < range.start) return 'before';
      if (dateYmd > range.end) return 'after';
      return 'within';
    }
    // 予定日からのずれ。開始日より前の実績は前倒し、終了日より後の実績は超過、
    // 未完了のまま終了日を過ぎたら期限切れ。
    // 終了日を入れていない旧データは、同じ名前の古い実績も通算されているため、
    // 登録した週より前の実績は前倒しに数えない。
    function planDeviation(item, range, todayYmd, done) {
      let earlyDate = '';
      let lateDate = '';
      const earliest = range && !range.explicitEnd ? weekKeyStartYmd(planRegisteredWeek(item)) : '';
      Object.keys((item && item.actualByDate) || {}).forEach(function(date) {
        if (!(roundHours(item.actualByDate[date]) > 0) || !range) return;
        if (date < range.start && date >= earliest && (!earlyDate || date < earlyDate)) earlyDate = date;
        if (date > range.end && (!lateDate || date > lateDate)) lateDate = date;
      });
      return {
        earlyDate: earlyDate,
        lateDate: lateDate,
        overdue: !!(range && !done && todayYmd && todayYmd > range.end)
      };
    }
    function planHasActualInRange(item, startYmd, endExclusiveYmd) {
      return Object.keys((item && item.actualByDate) || {}).some(function(date) {
        return date >= startYmd && date < endExclusiveYmd && roundHours(item.actualByDate[date]) > 0;
      });
    }
    // 週の画面に予定を出すか。期間がこの週にかかる予定と、この週に実績がある予定を出す。
    // 未完了のまま終了日を過ぎた予定は、今週以降の画面に「期限切れ」として残す（まだ期限前なら残さない）。
    // 終了日を入れていない旧データは、以前の持ち越しと同じく実績がある予定だけ残す。
    // 完了した予定は、終了日がまだ先でも、最後に実績を入れた日で帯を止める（実績がなければ開始日だけ）。
    // 終了日がもう過ぎている予定や、未完了の予定は、そのままの期間を返す。
    function planCompletedRange(range, actualByDate, todayYmd) {
      if (!range || !todayYmd || range.end <= todayYmd) return range;
      let last = '';
      Object.keys(actualByDate || {}).forEach(function(date) {
        if (roundHours(actualByDate[date]) > 0 && date >= range.start && date <= range.end && date > last) last = date;
      });
      const end = last || range.start;
      return end === range.end ? range : Object.assign({}, range, { end: end });
    }
    function planVisibleInWeek(item, weekRange, todayYmd, done, fallbackWeekKey) {
      if (!item || item.hasPlan === false) return false;
      if (item.undated) return undatedPlanVisibleInWeek(item, weekRange, done, fallbackWeekKey);
      const planned = planDateRange(item, fallbackWeekKey);
      // 完了したあとの週には、終了日がまだ先でも出さない。
      const range = done ? planCompletedRange(planned, item.actualByDate, todayYmd) : planned;
      if (!range || !weekRange || !weekRange.startYmd || !weekRange.endExclusiveYmd) return true;
      if (range.start < weekRange.endExclusiveYmd && range.end >= weekRange.startYmd) return true;
      if (planHasActualInRange(item, weekRange.startYmd, weekRange.endExclusiveYmd)) return true;
      if (done || range.end >= weekRange.startYmd) return false;
      if (!todayYmd || weekRange.endExclusiveYmd <= todayYmd || todayYmd <= range.end) return false;
      return range.explicitEnd || planHasLoggedActual(item);
    }
    // 期間未定の予定は、完了するまで登録した週以降の画面に出し続ける。
    // 完了したら、登録した週と実績がある週にだけ出す。
    function undatedPlanVisibleInWeek(item, weekRange, done, fallbackWeekKey) {
      if (!weekRange || !weekRange.startYmd || !weekRange.endExclusiveYmd) return true;
      if (planHasActualInRange(item, weekRange.startYmd, weekRange.endExclusiveYmd)) return true;
      const registered = weekKeyStartYmd(planRegisteredWeek(item) || fallbackWeekKey);
      if (registered && weekRange.endExclusiveYmd <= registered) return false;
      return !done || !registered || (registered >= weekRange.startYmd && registered < weekRange.endExclusiveYmd);
    }
    // 週の予定の状態。日ごとの予定時間は持たないので、注意が要るのは
    // 期限切れ・終了日より後の実績・予定工数の超過だけ。
    function planPeriodStatus(item, range, todayYmd, done) {
      const deviation = planDeviation(item, range, todayYmd, done);
      const planned = roundHours(item && item.planned);
      const over = planned > 0 && roundHours(item && item.actual) > planned;
      const alert = deviation.overdue || !!deviation.lateDate || over;
      const paceLabel = deviation.overdue ? '期限切れ' : deviation.lateDate ? '期限超過' : over ? '工数超過' : '予定どおり';
      return {
        key: done ? 'done' : (alert ? 'late' : 'ontrack'),
        label: done ? '完了' : '進行中',
        tone: alert ? 'alert' : 'ok',
        paceKey: alert ? 'late' : 'ontrack',
        paceLabel: paceLabel,
        paceTone: alert ? 'alert' : 'ok',
        done: !!done,
        over: over,
        deviation: deviation
      };
    }
    function buildCarriedPlannerItem(source, thisWeekStart, carryWeek) {
      const name = planIdentityName(source && source.name);
      const planned = roundHours(source && (source.plannedHours != null ? source.plannedHours : source.planned));
      const actual = roundHours(source && (source.actualHours != null ? source.actualHours : source.actual));
      const originWeek = (source && source.originWeek) || carryWeek || '';
      const carried = {
        id: (source && source.id) || '',
        name: name,
        planned: planned,
        actual: actual,
        actualByDate: Object.assign({}, (source && source.actualByDate) || {}),
        estimatedTotal: planned,
        hasPlan: true,
        planKind: source && source.planKind === 'added' ? 'added' : 'initial',
        initialPlanned: roundHours(source && source.initialPlanned != null ? source.initialPlanned : source.initialPlannedHours != null ? source.initialPlannedHours : planned),
        createdAt: (source && source.createdAt) || '',
        priority: source && source.priority != null ? source.priority : null,
        note: source && source.note || '',
        startDate: source && source.undated ? '' : ((source && source.startDate) || weekKeyStartYmd(originWeek) || thisWeekStart || ''),
        endDate: source && source.undated ? '' : ((source && source.endDate) || ''),
        undated: !!(source && source.undated),
        dailyCap: roundHours(source && source.dailyCap),
        dailyPlan: normalizePlanDailyPlan(source && source.dailyPlan),
        carryWeek: carryWeek || '',
        originWeek: originWeek,
        calendarKey: '',
        done: !!(source && (source.done || (completionSyncEnabled() && source.dailyComplete) || source.complete)),
        completionOverride: normalizePlanCompletionOverride(source && source.completionOverride)
      };
      if (source && source.projectId) carried.projectId = String(source.projectId);
      if (source && source.issueUrl) carried.issueUrl = String(source.issueUrl);
      return carried;
    }
    function continuationUid(prefix) {
      if (typeof uid === 'function') return uid(prefix);
      return prefix + Math.random().toString(36).slice(2, 10);
    }
    function actualHoursFromByDate(actualByDate, startYmd, endExclusiveYmd) {
      const start = String(startYmd || '');
      const end = String(endExclusiveYmd || '');
      return Object.keys(actualByDate || {}).reduce(function(total, date) {
        if (start && date < start) return total;
        if (end && date >= end) return total;
        return roundHours(total + Number(actualByDate[date] || 0));
      }, 0);
    }
    function undatedActualHours(item) {
      return Math.max(0, roundHours(item && (item.actualHours != null ? item.actualHours : item && item.actual)) - actualHoursFromByDate(item && item.actualByDate));
    }
    function mergeActualByDate(base, extra) {
      const result = Object.assign({}, base || {});
      Object.keys(extra || {}).forEach(function(date) {
        if (result[date] == null) result[date] = extra[date];
      });
      return result;
    }
    function statusToneClass(status) {
      const bits = [];
      if (status && (status.done || status.key === 'done')) bits.push('is-done');
      const tone = status && (status.paceTone || status.tone);
      if (tone === 'alert') bits.push('is-alert');
      else if (tone === 'ahead') bits.push('is-ahead');
      else bits.push('is-ok');
      return bits.length ? ' ' + bits.join(' ') : '';
    }
    function statusDetailTitle(status) {
      if (!status) return '';
      return status.label + ' · ' + status.paceLabel;
    }
    function rollupPace(late, ontrack, ahead) {
      if (late) return { key: 'late', tone: 'alert' };
      if (ahead && !ontrack) return { key: 'ahead', tone: 'ahead' };
      return { key: 'ontrack', tone: 'ok' };
    }
    function statusRollup(statuses) {
      const counts = { done: 0, late: 0, ontrack: 0, ahead: 0, doneLate: 0, doneOntrack: 0, doneAhead: 0 };
      (statuses || []).forEach(function(status) {
        const paceKey = status.paceKey || (status.key === 'done' ? 'ontrack' : status.key);
        if (status.key === 'done' || status.done) {
          counts.done += 1;
          if (paceKey === 'late') counts.doneLate += 1;
          else if (paceKey === 'ahead') counts.doneAhead += 1;
          else counts.doneOntrack += 1;
          return;
        }
        if (paceKey === 'late') counts.late += 1;
        else if (paceKey === 'ahead') counts.ahead += 1;
        else counts.ontrack += 1;
      });
      const inProgress = counts.late + counts.ontrack + counts.ahead;
      const overall = inProgress > 0
        ? Object.assign({ label: '進行中' }, rollupPace(counts.late, counts.ontrack, counts.ahead))
        : counts.done > 0
          ? Object.assign({ label: '完了' }, rollupPace(counts.doneLate, counts.doneOntrack, counts.doneAhead), { key: 'done' })
          : { key: 'ontrack', label: '進行中', tone: 'ok' };
      return {
        counts: counts,
        overall: overall,
        meta: '進行中 ' + inProgress + ' · 完了 ' + counts.done
      };
    }
    function applyStatusCard(cardId, valueId, metaId, rollup) {
      const card = document.getElementById(cardId);
      const value = document.getElementById(valueId);
      const meta = document.getElementById(metaId);
      if (value) value.textContent = rollup.overall.label;
      if (meta) meta.textContent = rollup.meta;
      if (!card) return;
      const hasItems = ((rollup.counts.late || 0) + (rollup.counts.ontrack || 0) + (rollup.counts.ahead || 0) + (rollup.counts.done || 0)) > 0;
      card.classList.toggle('is-alert', rollup.overall.tone === 'alert');
      card.classList.toggle('is-ok', rollup.overall.tone === 'ok' && hasItems);
      card.classList.toggle('is-ahead', rollup.overall.tone === 'ahead');
    }
    function planIdentityName(name) {
      const raw = String(name || '').trim();
      const match = raw.match(/^(前週繰越|前週繰り越し)[\s\u3000]+(.+)$/);
      return match ? String(match[2] || '').trim() : raw;
    }
    function findPlannerItem(items, id, name) {
      const planId = String(id || '').trim();
      if (planId) {
        return (items || []).find(function(item) {
          return item && String(item.id || '').trim() === planId;
        }) || null;
      }
      const raw = String(name || '').trim();
      if (!raw) return null;
      const clean = planIdentityName(raw);
      return (items || []).find(function(item) {
        if (!item || String(item.id || '').trim()) return false;
        return item.name === raw || item.name === clean || planIdentityName(item.name) === clean;
      }) || null;
    }
    function planningTaskBelongsToPlan(task, item) {
      if (!task || !item) return false;
      const parentPlanId = String(task.parentPlanId || '').trim();
      const id = String((item.id || item.planId) || '').trim();
      if (id && parentPlanId) {
        if (parentPlanId === id) return true;
        // 繰り越し先が別IDでも、元の週のサブタスクは同じ課題名で残す。
        if (item.carryWeek) {
          const carriedParent = String(task.parentKey || '').trim();
          const carriedName = String((item.name || item.aggregationKey) || '').trim();
          if (carriedParent && carriedName && carriedParent === carriedName) return true;
        }
        return false;
      }
      const parentKey = String(task.parentKey || '').trim();
      const parent = String((item.name || item.aggregationKey) || '').trim();
      return !!(parentKey && parent && parentKey === parent);
    }
    function planHasLoggedActual(item, subtasks) {
      if (!item) return false;
      if (roundHours(item.actualHours != null ? item.actualHours : item.actual) > 0) return true;
      if (Object.keys(item.actualByDate || {}).some(function(date) { return roundHours(item.actualByDate[date]) > 0; })) return true;
      return (subtasks || []).some(function(task) {
        return planningTaskBelongsToPlan(task, item) && roundHours(task.prevB || task.actual || task.actualHours) > 0;
      });
    }
    function planContinuationIsComplete(item, subtasks) {
      if (!item || item.completionOverride === false) return false;
      if (item.done || item.complete || (completionSyncEnabled() && item.dailyComplete)) return true;
      const tasks = (subtasks || []).filter(function(task) { return planningTaskBelongsToPlan(task, item); });
      return tasks.length > 0 && tasks.every(function(task) {
        const status = String(task.status || '').trim();
        return status === 'done' || status === '完了';
      });
    }
    // 前の週に登録した予定を、この週の画面にも重ねるか。
    // 期間がこの週にかかる予定は完了していても重ね、未完了の予定は実績があれば残す。
    // 実績が一度もない予定は、終了日を決めて期限を過ぎたものだけ「期限切れ」として残す。
    function planShouldContinue(item, subtasks, targetRange) {
      if (!item || item.hasPlan === false || item.calendarKey) return false;
      if (!item.id && !planIdentityName(item.name)) return false;
      // 期間未定の予定は、完了するまで次の週にも重ねる。
      if (item.undated) return !planContinuationIsComplete(item, subtasks);
      const range = planDateRange(item);
      const hasTarget = !!(targetRange && targetRange.startYmd && targetRange.endExclusiveYmd);
      if (range && hasTarget && range.start < targetRange.endExclusiveYmd && range.end >= targetRange.startYmd) return true;
      if (planContinuationIsComplete(item, subtasks)) return false;
      if (planHasLoggedActual(item, subtasks)) return true;
      return !!(range && range.explicitEnd && hasTarget && range.end < targetRange.startYmd);
    }
    function dropUnworkedDuplicatePlans(items, subtasks) {
      const groups = {};
      (items || []).forEach(function(item) {
        if (!item || item.hasPlan === false || item.calendarKey) return;
        const name = planIdentityName(item.name);
        if (!name) return;
        (groups[name] = groups[name] || []).push(item);
      });
      const drop = new Set();
      Object.keys(groups).forEach(function(name) {
        const group = groups[name];
        if (group.length < 2) return;
        const worked = group.filter(function(item) { return planHasLoggedActual(item, subtasks); });
        if (worked.length === group.length) return;
        const native = group.filter(function(item) { return !item.carryWeek; });
        const keep = new Set(worked.length ? worked : [native[0] || group[0]]);
        group.forEach(function(item) { if (!keep.has(item)) drop.add(item); });
      });
      if (!drop.size) return { items: items || [], subtasks: subtasks || [], removed: 0 };
      let nextSubs = subtasks || [];
      drop.forEach(function(item) { nextSubs = dropSubtasksForPlan(nextSubs, item); });
      return {
        items: (items || []).filter(function(item) { return !drop.has(item); }),
        subtasks: nextSubs,
        removed: drop.size
      };
    }
    function copyContinuationSubtask(task, targetItem, newSubId) {
      return {
        id: (task && task.id) || (newSubId ? newSubId() : continuationUid('sub-')),
        parentKey: String((targetItem && targetItem.name) || '').trim(),
        parentPlanId: (targetItem && targetItem.id) || '',
        title: String((task && task.title) || '').trim(),
        plannedHours: roundHours(task && task.plannedHours),
        prevB: roundHours(task && task.prevB),
        dueDate: (task && task.dueDate) || '',
        status: (task && task.status) || 'todo',
        note: (task && task.note) || '',
        sortOrder: (task && task.sortOrder) || 0
      };
    }
    function continuationSubtasksForPlan(sourceSubtasks, sourceItem, targetItem, newSubId) {
      if (!sourceItem || !targetItem) return [];
      // 前週で実績が予定と同じでも、サブタスク自体は残す。
      // 完了チェックは表示用で、一覧から外す理由にはしない。
      return (sourceSubtasks || []).filter(function(task) {
        return planningTaskBelongsToPlan(task, sourceItem);
      }).map(function(task) {
        return copyContinuationSubtask(task, targetItem, newSubId);
      });
    }
    function appendContinuationSubtasks(targetSubtasks, incoming) {
      const list = (targetSubtasks || []).slice();
      (incoming || []).forEach(function(task) {
        const exists = list.some(function(entry) {
          if (task.id && entry.id && String(task.id) === String(entry.id)) return true;
          if (task.parentPlanId && entry.parentPlanId) {
            return String(entry.parentPlanId) === String(task.parentPlanId) && String(entry.title || '') === String(task.title || '');
          }
          return String(entry.parentKey || '') === String(task.parentKey || '') && String(entry.title || '') === String(task.title || '');
        });
        if (!exists) list.push(task);
      });
      return list;
    }
    function dropSubtasksForPlan(subtasks, item) {
      if (!item) return subtasks || [];
      return (subtasks || []).filter(function(task) {
        return !planningTaskBelongsToPlan(task, item);
      });
    }
    function continuationSnapshot(item) {
      return [
        String((item && item.name) || ''),
        roundHours(item && item.planned),
        roundHours(item && item.actual),
        JSON.stringify(item && item.actualByDate || {}),
        String((item && item.startDate) || ''),
        String((item && item.endDate) || ''),
        item && item.undated ? 'undated' : '',
        String(item && item.completionOverride == null ? '' : item.completionOverride)
      ].join('\u0000');
    }
    function applySamePlanContinuation(existing, source, targetRange) {
      if (!existing || !source) return existing;
      const keepLocalDone = !!(existing.done
        && typeof state !== 'undefined'
        && state.planner
        && state.planner.dirty);
      const keepLocalCompletionOverride = existing.completionOverride === false
        && typeof state !== 'undefined'
        && state.planner
        && state.planner.dirty;
      const start = targetRange && targetRange.startYmd || '';
      const end = targetRange && targetRange.endExclusiveYmd || '';
      const thisWeekByDate = {};
      Object.keys(existing.actualByDate || {}).forEach(function(date) {
        if (start && date < start) return;
        if (end && date >= end) return;
        thisWeekByDate[date] = existing.actualByDate[date];
      });
      if (source.id) existing.id = source.id;
      existing.hasPlan = true;
      if (source.projectId != null) existing.projectId = String(source.projectId || '');
      if (source.issueUrl) existing.issueUrl = String(source.issueUrl);
      existing.name = planIdentityName(source.name) || existing.name;
      existing.planned = roundHours(source.planned);
      existing.estimatedTotal = roundHours(source.planned);
      existing.initialPlanned = roundHours(source.initialPlanned == null ? source.planned : source.initialPlanned);
      if (source.planKind) existing.planKind = source.planKind;
      if (source.createdAt && !existing.createdAt) existing.createdAt = source.createdAt;
      // 順位は登録した週の値が正本。どの週から見ても同じ位置に並べる。
      if (source.priority != null) existing.priority = source.priority;
      if (source.startDate && (!existing.startDate || existing.startDate > source.startDate)) existing.startDate = source.startDate;
      if (source.endDate) existing.endDate = source.endDate;
      existing.undated = !!source.undated;
      if (existing.undated) {
        existing.startDate = '';
        existing.endDate = '';
      }
      if (source.note && !String(existing.note || '').trim()) existing.note = source.note;
      existing.actualByDate = Object.assign({}, source.actualByDate || {}, thisWeekByDate);
      existing.actual = roundHours(actualHoursFromByDate(existing.actualByDate) + undatedActualHours(source));
      existing.originWeek = source.originWeek || existing.originWeek || '';
      existing.done = keepLocalDone ? true : !!source.done;
      existing.completionOverride = keepLocalCompletionOverride
        ? false
        : normalizePlanCompletionOverride(source.completionOverride);
      return existing;
    }
    function enrichContinuationSources(items, ancestorsByWeek) {
      return (items || []).map(function(item) {
        if (!item) return item;
        let byDate = Object.assign({}, item.actualByDate || {});
        let startDate = item.startDate || '';
        let endDate = item.endDate || '';
        let note = item.note || '';
        let key = item.carryWeek;
        let originWeek = item.originWeek || '';
        const seen = {};
        let undated = undatedActualHours(item);
        while (key && !seen[key]) {
          seen[key] = true;
          originWeek = originWeek || key;
          const prev = findPlannerItem(ancestorsByWeek && ancestorsByWeek[key] || [], item.id, item.name);
          if (!prev) break;
          byDate = mergeActualByDate(prev.actualByDate, byDate);
          undated = roundHours(undated + undatedActualHours(prev));
          if (prev.startDate && (!startDate || prev.startDate < startDate)) startDate = prev.startDate;
          if (!endDate && prev.endDate) endDate = prev.endDate;
          if (!String(note || '').trim()) note = prev.note || '';
          if (prev.originWeek) originWeek = prev.originWeek;
          else if (!prev.carryWeek) originWeek = key;
          key = prev.carryWeek;
        }
        const dated = actualHoursFromByDate(byDate);
        return Object.assign({}, item, {
          actual: roundHours(dated + undated),
          actualByDate: byDate,
          startDate: startDate,
          endDate: endDate,
          note: note,
          originWeek: originWeek || item.originWeek || ''
        });
      });
    }
    function planIsOrigin(item) {
      return !!(item && item.hasPlan !== false && !item.calendarKey && !item.carryWeek);
    }
    function planBelongsToPeriod(item, periodKey) {
      if (!item || item.hasPlan === false) return false;
      if (item.calendarKey) return true;
      if (item.originWeek) return item.originWeek === periodKey;
      return !item.carryWeek;
    }
    function reconcileWeekContinuations(options) {
      options = options || {};
      const sourceKey = options.sourceKey || '';
      const sourceItems = options.sourceItems || [];
      const sourceSubtasks = options.sourceSubtasks || [];
      const items = (options.targetItems || []).slice();
      let subtasks = (options.targetSubtasks || []).slice();
      const targetStart = options.targetStart || '';
      const targetRange = options.targetRange || { startYmd: targetStart };
      const targetKey = options.targetKey || '';
      const newId = options.newId || function() { return continuationUid('plan-'); };
      const newSubId = options.newSubId || function() { return continuationUid('sub-'); };
      let added = 0;
      let removed = 0;
      let updated = 0;
      const desiredById = {};
      const desiredByName = {};
      sourceItems.forEach(function(source) {
        if (!planShouldContinue(source, sourceSubtasks, targetRange)) return;
        if (!source.originWeek) source.originWeek = sourceKey;
        if (source.id) desiredById[source.id] = source;
        else {
          const name = planIdentityName(source.name);
          if (name) desiredByName[name] = source;
        }
      });
      function desiredForItem(item) {
        if (!item) return null;
        if (item.id && desiredById[item.id]) return desiredById[item.id];
        if (!item.id) return desiredByName[planIdentityName(item.name)] || null;
        return null;
      }
      const kept = [];
      items.forEach(function(item) {
        const belongsToSourceWeek = item && sourceKey && (
          item.carryWeek === sourceKey
          || item.originWeek === sourceKey
        );
        const hasActualInTargetWeek = !!(targetRange && targetRange.startYmd && targetRange.endExclusiveYmd &&
          Object.keys(item.actualByDate || {}).some(function(date) {
            return date >= targetRange.startYmd && date < targetRange.endExclusiveYmd && roundHours(item.actualByDate[date]) > 0;
          }));
        if (belongsToSourceWeek && !desiredForItem(item) && !hasActualInTargetWeek) {
          subtasks = dropSubtasksForPlan(subtasks, item);
          removed++;
          return;
        }
        kept.push(item);
      });
      function applyDesired(source) {
        const existing = findPlannerItem(kept, source.id, source.name);
        if (existing) {
          const before = continuationSnapshot(existing);
          const beforeId = existing.id;
          applySamePlanContinuation(existing, source, targetRange);
          existing.originWeek = source.originWeek || sourceKey;
          if (targetKey && existing.originWeek && existing.originWeek !== targetKey) {
            existing.carryWeek = existing.carryWeek || sourceKey;
          }
          if (before !== continuationSnapshot(existing) || (source.id && beforeId !== source.id)) updated++;
          subtasks = appendContinuationSubtasks(subtasks, continuationSubtasksForPlan(sourceSubtasks, source, existing, newSubId));
          return;
        }
        const carried = buildCarriedPlannerItem(source, targetStart, sourceKey);
        carried.originWeek = source.originWeek || sourceKey;
        if (!carried.id) carried.id = newId();
        kept.push(carried);
        subtasks = appendContinuationSubtasks(subtasks, continuationSubtasksForPlan(sourceSubtasks, source, carried, newSubId));
        added++;
      }
      Object.keys(desiredById).forEach(function(id) { applyDesired(desiredById[id]); });
      Object.keys(desiredByName).forEach(function(name) { applyDesired(desiredByName[name]); });
      return {
        items: kept,
        subtasks: subtasks,
        changed: added + removed + updated,
        added: added,
        removed: removed,
        updated: updated
      };
    }
    function dailyBelongsToPlan(dailyName, planName) {
      const daily = planIdentityName(dailyName);
      const plan = planIdentityName(planName);
      if (!daily || !plan) return false;
      if (daily === plan) return true;
      if (daily.length <= plan.length || daily.indexOf(plan) !== 0) return false;
      const next = daily.charAt(plan.length);
      return next === ' ' || next === '\u3000' || next === '/' || next === '／' || next === ':' || next === '：' || next === '-';
    }
    function dailyRowNameLocked(row) {
      return !!(row && String(row.name || '').trim());
    }
    function dailyRowIsInterrupt(row) {
      return !!(row && String(row.type || '') === 'interrupt');
    }
    function dailyRowIsCalendarInterrupt(row) {
      return !!(dailyRowIsInterrupt(row) && String(row.calendarKey || '').trim());
    }
    function dailyRowOrigin(row, priorNames) {
      if (!row) return 'new';
      if (dailyRowIsInterrupt(row)) return 'interrupt';
      if (row.type === 'calendar' || row.type === 'calendar-imported') return 'calendar';
      const name = String(row.name || '').trim();
      if (name && typeof state !== 'undefined' && state.daily && state.daily.calendarAutoNames && state.daily.calendarAutoNames[name]) return 'calendar';
      if (row.type === 'ongoing' || Number(row.previous) > 0) return 'resume';
      if (name && priorNames && priorNames.indexOf(name) >= 0) return 'resume';
      return 'new';
    }
    function findPriorDailyTask(name, sources) {
      const title = String(name || '').trim();
      if (!title) return null;
      let found = null;
      (sources || []).some(function(item) {
        const itemName = String((typeof item === 'string' ? item : item && item.title) || '').trim();
        if (itemName !== title) return false;
        if (typeof item !== 'string' && (dailyRowIsInterrupt(item) || item.type === 'calendar' || item.type === 'calendar-imported')) return false;
        if (typeof item === 'string') found = { title: title, previous: 0, estimate: 0 };
        else {
          found = {
            title: title,
            previous: roundHours((Number(item.hours) || 0) + (Number(item.prevB) || 0)),
            estimate: roundHours(item.prevC)
          };
        }
        return true;
      });
      return found;
    }
    function hoursBeforeDateFromActualByDate(actualByDate, date) {
      let total = 0;
      const target = String(date || '');
      Object.keys(actualByDate || {}).forEach(function(key) {
        if (String(key) < target) total += roundHours(actualByDate[key]);
      });
      return roundHours(total);
    }
    function dailyHoursBeforeByName(date, sources) {
      const totals = {};
      const target = String(date || '');
      const named = weeklyDailyActualByName();
      Object.keys(named).forEach(function(name) {
        totals[name] = hoursBeforeDateFromActualByDate(named[name], target);
      });
      Object.keys(state && state.dailyCache || {}).forEach(function(key) {
        if (!key || key >= target) return;
        ((state.dailyCache[key] && state.dailyCache[key].tasks) || []).forEach(function(item) {
          if (!item || item.type === 'calendar' || item.type === 'interrupt') return;
          const title = String(item.title || '').trim();
          if (!title) return;
          if (named[title] && Object.prototype.hasOwnProperty.call(named[title], key)) return;
          totals[title] = roundHours((totals[title] || 0) + (Number(item.hours) || 0));
        });
      });
      (sources || []).forEach(function(item) {
        if (typeof item === 'string' || !item) return;
        const title = String(item.title || '').trim();
        if (!title || Object.prototype.hasOwnProperty.call(totals, title)) return;
        totals[title] = roundHours((Number(item.hours) || 0) + (Number(item.prevB) || 0));
      });
      return totals;
    }
    function weeklyDailyActualByName() {
      const weekKey = dailyWeekKey(state.daily.date);
      const workspace = dailyWeekWorkspaceFor(weekKey);
      const summary = (workspace && workspace.summary)
        || state.daily.weekSummary
        || (state.planner.type === 'week' && state.planner.key === weekKey ? state.planner.summary : null);
      return (summary && summary.dailyActualByName) || {};
    }
    function weeklyHoursByPlanChild(date) {
      const totals = {};
      const weekKey = dailyWeekKey(date || state.daily.date);
      const workspace = dailyWeekWorkspaceFor(weekKey);
      const summary = (workspace && workspace.summary)
        || state.daily.weekSummary
        || (state.planner.type === 'week' && state.planner.key === weekKey ? state.planner.summary : null);
      const named = (summary && summary.dailyActualByPlanChild) || {};
      const target = String(date || '');
      Object.keys(named).forEach(function(stamp) {
        totals[stamp] = hoursBeforeDateFromActualByDate(named[stamp], target);
      });
      Object.keys(state && state.dailyCache || {}).forEach(function(key) {
        if (!key || key >= target) return;
        ((state.dailyCache[key] && state.dailyCache[key].tasks) || []).forEach(function(item) {
          if (!item || item.type === 'calendar' || item.type === 'interrupt' || !item.planId) return;
          const parent = typeof weeklyPlanNameForId === 'function' ? weeklyPlanNameForId(item.planId) : '';
          const title = String(item.title || item.name || '').trim();
          if (!parent || !title) return;
          const child = title === parent ? '' : (dailyBelongsToPlan(title, parent) ? title.slice(parent.length).replace(/^[\s\u3000/／:：-]+/, '') : '');
          if (!child) return;
          const stamp = item.planId + '\0' + child;
          if (named[stamp] && Object.prototype.hasOwnProperty.call(named[stamp], key)) return;
          totals[stamp] = roundHours((totals[stamp] || 0) + (Number(item.hours) || 0));
        });
      });
      return totals;
    }
    function weeklySyncedHoursForDaily(row, date, plans, subtasks, hoursByExactName, actualBefore, hoursByPlanChild) {
      const name = String((row && (row.name || row.title)) || '').trim();
      const type = String((row && row.type) || '');
      let previous = roundHours(row && (row.previous != null ? row.previous : row.prevB));
      let estimate = roundHours(row && (row.estimate != null ? row.estimate : row.prevC));
      if (!name || type === 'calendar' || type === 'calendar-imported' || type === 'interrupt') {
        if (type === 'interrupt') {
          return { previous: 0, estimate: numericHours(row && (row.today != null ? row.today : row.hours)) };
        }
        return { previous: previous, estimate: estimate };
      }
      const plan = planForDailyTask(row, plans);
      if (!plan) return { previous: previous, estimate: estimate };
      const planName = plan.aggregationKey || plan.name || plan.title;
      const linkedSubtask = row.subtaskId && (subtasks || []).find(function(entry) {
        return String(entry.id || '') === String(row.subtaskId)
          && planningSubtaskMatchesParent(entry, planName, plan.planId || plan.id);
      });
      const child = linkedSubtask ? String(linkedSubtask.title || '').trim() : name !== planName && dailyBelongsToPlan(name, planName)
        ? name.slice(planName.length).replace(/^[\s\u3000/／:：-]+/, '')
        : '';
      const planned = roundHours(plan.plannedHours != null ? plan.plannedHours : plan.planned);
      const parentPrevious = plan.actualByDate
        ? hoursBeforeDateFromActualByDate(plan.actualByDate, date)
        : roundHours((actualBefore && actualBefore[planName]) || plan.prevB || 0);
      if (!child) return { previous: parentPrevious, estimate: planned };
      const sub = (subtasks || []).find(function(entry) {
        return planningSubtaskMatchesParent(entry, planName, plan.planId || plan.id)
          && String(entry.title || '').trim() === child;
      });
      const stamp = String(plan.planId || plan.id || '') + '\0' + child;
      const fromPlanChild = hoursByPlanChild && Object.prototype.hasOwnProperty.call(hoursByPlanChild, stamp)
        ? roundHours(hoursByPlanChild[stamp])
        : null;
      return {
        previous: fromPlanChild != null
          ? fromPlanChild
          : hoursByExactName && Object.prototype.hasOwnProperty.call(hoursByExactName, name)
            ? roundHours(hoursByExactName[name])
            : hoursByExactName && Object.prototype.hasOwnProperty.call(hoursByExactName, child)
              ? roundHours(hoursByExactName[child])
              : sub && sub.prevB != null && Number(sub.prevB) > 0
                ? roundHours(sub.prevB)
                : previous,
        estimate: sub ? roundHours(sub.plannedHours != null ? sub.plannedHours : sub.prevC) : planned
      };
    }
    function dailyRowOriginLabel(origin) {
      if (origin === 'calendar') return 'カレンダー';
      if (origin === 'interrupt') return '今日だけ';
      return '予定';
    }
    function interruptEntriesByDate(days, forecast, liveDaily) {
      const map = {};
      (days || []).forEach(function(day) {
        if (day && day.date) map[day.date] = [];
      });
      function add(date, name, hours, allowZero, calendarOrigin, calendarKey) {
        if (!Object.prototype.hasOwnProperty.call(map, date)) return;
        const title = String(name || '').trim();
        const value = numericHours(hours);
        if (!title) return;
        if (!(value > 0) && !allowZero) return;
        const existing = map[date].find(function(item) { return item.name === title; });
        if (existing) {
          existing.hours = numericHours(existing.hours + value);
          existing.calendarOrigin = existing.calendarOrigin || !!calendarOrigin;
          if (calendarKey && !existing.calendarKey) existing.calendarKey = calendarKey;
        } else {
          map[date].push({ name: title, hours: value, calendarOrigin: !!calendarOrigin, calendarKey: calendarKey || '' });
        }
      }
      function markCalendarOrigin(date, name, hours, calendarKey) {
        if (!Object.prototype.hasOwnProperty.call(map, date)) return;
        const title = String(name || '').trim();
        if (!title) return;
        const existing = map[date].find(function(item) { return item.name === title; });
        if (existing) {
          existing.calendarOrigin = true;
          if (calendarKey && !existing.calendarKey) existing.calendarKey = calendarKey;
        } else {
          add(date, title, hours, true, true, calendarKey || '');
        }
      }
      (forecast && forecast.rows || []).forEach(function(row) {
        if (!row || row.hasPlan || row.calendarKey || row.isCalendar) return;
        Object.keys(row.actualByDate || {}).forEach(function(date) {
          add(date, row.name, row.actualByDate[date], false);
        });
      });
      if (liveDaily && liveDaily.date && Object.prototype.hasOwnProperty.call(map, liveDaily.date)) {
        map[liveDaily.date] = [];
        (liveDaily.rows || []).forEach(function(row) {
          if (!dailyRowIsInterrupt(row)) return;
          add(liveDaily.date, row.name || row.title, row.today != null ? row.today : row.hours, true, dailyRowIsCalendarInterrupt(row), row.calendarKey || '');
        });
      }
      Object.keys((forecast && forecast.calendarInterruptsByDate) || {}).forEach(function(date) {
        ((forecast.calendarInterruptsByDate || {})[date] || []).forEach(function(entry) {
          markCalendarOrigin(date, entry.name, entry.hours, entry.calendarKey || '');
        });
      });
      return map;
    }
    function planNameLocked(item) {
      return !!(item && item.hasPlan === false && String(item.name || '').trim());
    }
    function composeDailyChildName(parentName, childName) {
      const parent = String(parentName || '').trim();
      const child = String(childName || '').trim();
      if (!parent) return child;
      if (!child) return parent;
      if (dailyBelongsToPlan(child, parent)) return child;
      return parent + ' ' + child;
    }
    function planningSubtaskMatchesParent(task, parentName, planId) {
      return planningTaskBelongsToPlan(task, { id: planId, name: parentName, aggregationKey: parentName });
    }
    function planForDailyTask(task, plans) {
      const planId = String((task && (task.planId || task.parentPlanId)) || '').trim();
      if (planId) {
        const found = (plans || []).find(function(item) {
          return String(item.planId || item.id || '').trim() === planId;
        });
        return found || null;
      }
      const name = String((task && (task.name || task.title)) || '').trim();
      if (!name) return null;
      let best = null;
      let bestLen = -1;
      let conflict = false;
      (plans || []).forEach(function(item) {
        const key = String((item && (item.aggregationKey || item.name || item.title)) || '').trim();
        if (!key || (key !== name && !dailyBelongsToPlan(name, key))) return;
        const len = planIdentityName(key).length;
        if (len > bestLen) {
          best = item;
          bestLen = len;
          conflict = false;
          return;
        }
        if (len !== bestLen || !best) return;
        const bestId = String(best.planId || best.id || '').trim();
        const itemId = String(item.planId || item.id || '').trim();
        if ((bestId || itemId) && bestId !== itemId) conflict = true;
      });
      return conflict ? null : best;
    }
    function parentKeyForDailyName(name, planNames) {
      let best = '';
      (planNames || []).forEach(function(plan) {
        if (dailyBelongsToPlan(name, plan) && planIdentityName(plan).length > planIdentityName(best).length) best = plan;
      });
      return best;
    }
    function dailyActualHoursByParent(rows, planNames) {
      const totals = {};
      (rows || []).forEach(function(row) {
        const today = numericHours(row.today);
        if (!(today > 0)) return;
        const fromId = typeof weeklyPlanNameForId === 'function' ? weeklyPlanNameForId(row.planId) : '';
        const parent = fromId || parentKeyForDailyName(row.name, planNames) || String(row.name || '').trim() || '名称未入力';
        totals[parent] = numericHours((totals[parent] || 0) + today);
      });
      return totals;
    }
    function dailyProgressRate(actualHours, workdayHours) {
      const workday = roundHours(workdayHours);
      if (!(workday > 0)) return null;
      return Math.round(numericHours(actualHours) / workday * 100);
    }
    // 実績画面の1日分。予定は期間だけを持つので、その日が期間に入る予定と
    // その日の実績を並べ、進み具合は稼働時間に対する実績で見る。
    function buildDayAgendaModel(date, planRows, dailyRows, capacityDay, planNames) {
      const names = [];
      const seenNames = {};
      (planNames || []).concat((planRows || []).map(function(row) { return row && row.name; })).forEach(function(name) {
        const title = String(name || '').trim();
        if (!title || seenNames[title]) return;
        seenNames[title] = true;
        names.push(title);
      });
      const actualByParent = dailyActualHoursByParent(dailyRows, names);
      const seen = {};
      const rows = [];
      (planRows || []).forEach(function(row) {
        const name = (row && row.name) || '名称未入力';
        const actual = numericHours(actualByParent[name] || 0);
        const position = row && row.hasPlan !== false
          ? (row.range ? planDatePosition(row.range, date) : (row.undated ? 'within' : ''))
          : '';
        const inPeriod = position === 'within';
        if (!inPeriod && !(actual > 0)) return;
        seen[name] = true;
        rows.push({
          name: name,
          actual: actual,
          inPeriod: inPeriod,
          position: position,
          isCalendar: !!(row && (row.isCalendar || row.calendarKey)),
          unplanned: !!(row && row.hasPlan === false)
        });
      });
      Object.keys(actualByParent).forEach(function(name) {
        if (seen[name]) return;
        rows.push({
          name: name,
          actual: actualByParent[name],
          inPeriod: false,
          position: '',
          isCalendar: false,
          unplanned: true
        });
      });
      return {
        date: date,
        workdayHours: capacityDay ? roundHours(capacityDay.baseHours) : workdayDefaultHours(),
        meetingHours: capacityDay ? roundHours(capacityDay.meetingHours) : 0,
        actualHours: roundHours(rows.reduce(function(total, row) { return total + row.actual; }, 0)),
        rows: rows
      };
    }
    // サブタスクIDから、今のサブタスク名を探す（予定名・サブタスク名を変えた後の過去の行のため）。
    function weeklySubtaskTitleForId(subtaskId) {
      const id = String(subtaskId || '').trim();
      if (!id) return '';
      const weeks = Object.keys(state.weeklySubtasksByWeek || {});
      for (let i = 0; i < weeks.length; i++) {
        const found = (state.weeklySubtasksByWeek[weeks[i]] || []).find(function(task) { return String(task.id || '') === id; });
        if (found && found.title) return String(found.title).trim();
      }
      return '';
    }
    function childNameForDaily(name, planId, subtaskId) {
      const fromId = weeklySubtaskTitleForId(subtaskId);
      if (fromId) return fromId;
      const parent = parentNameForDaily(name, planId);
      const raw = String(name || '').trim();
      if (!parent || !raw) return raw;
      if (raw === parent) return '';
      if (planId && !subtaskId) {
        const knownChild = weeklySubtasksForDate(state.daily.date).some(function(task) {
          return planningSubtaskMatchesParent(task, parent, planId)
            && composeDailyChildName(parent, task.title) === raw;
        });
        if (!knownChild) return '';
      }
      // 予定名が変わった古い行は、今の予定名で始まらないので切り出さずにそのまま見せる。
      if (!dailyBelongsToPlan(raw, parent)) return planId && !subtaskId ? '' : raw;
      return raw.slice(parent.length).replace(/^[\s\u3000/／:：-]+/, '');
    }
    function dailyIssueLabel(name, planId, subtaskId) {
      const parent = parentNameForDaily(name, planId);
      const child = childNameForDaily(name, planId, subtaskId);
      const raw = String(name || '').trim();
      // IDだけで親に紐づく古い名前を、存在しないサブタスクとして表示しない。
      const historicalName = planId && !subtaskId && parent && raw !== parent && !child;
      const title = historicalName ? raw : (child || parent || raw);
      return {
        title: title,
        parent: !historicalName && child && parent && parent !== title ? parent : ''
      };
    }
    function dailyParentNames(date) {
      const names = [];
      const seen = {};
      const targetWeek = date ? dailyWeekKey(date) : '';
      (state.weeklyPlanNames || []).forEach(function(name) {
        const title = String(name || '').trim();
        const meta = (state.weeklyPlanMeta || {})[title] || {};
        const periodKey = dailyPlanSourcePeriodKey(meta, targetWeek);
        const isCarry = !!(meta.carry || meta.carryWeek);
        if (targetWeek && periodKey && periodKey !== targetWeek && !isCarry) return;
        if (!title || seen[title] || dailyPlanSourceIsComplete(meta)) return;
        seen[title] = true;
        names.push(title);
      });
      return names;
    }
    function dailyParentHoursLabel(name) {
      const meta = (state.weeklyPlanMeta || {})[name] || {};
      const planned = roundHours(meta.plannedHours != null ? meta.plannedHours : meta.prevC);
      const actual = roundHours(meta.prevB);
      if (planned <= 0 && actual <= 0) return '';
      if (planned > 0 && actual > 0) return '予定 ' + hours(planned) + 'h · ここまで ' + hours(actual) + 'h';
      if (planned > 0) return '予定 ' + hours(planned) + 'h';
      return 'ここまで ' + hours(actual) + 'h';
    }
    function priorDailySources() {
      const items = [];
      const seen = {};
      const before = state.daily.date;
      function add(item) {
        const title = String((typeof item === 'string' ? item : item && item.title) || '').trim();
        if (!title || seen[title]) return;
        seen[title] = true;
        items.push(item);
      }
      Object.keys(state.dailyCache || {}).sort().forEach(function(date) {
        if (before && date >= before) return;
        ((state.dailyCache[date] && state.dailyCache[date].tasks) || []).forEach(add);
      });
      (state.daily.importSource || []).forEach(add);
      (state.historyNames || []).forEach(add);
      return items;
    }
    function priorDailyNames() {
      return priorDailySources().map(function(item) {
        return String((typeof item === 'string' ? item : item && item.title) || '').trim();
      }).filter(Boolean);
    }
    function applyPriorDailyIdentity(row) {
      if (!row || !String(row.name || '').trim()) return row;
      if (row.type === 'calendar' || row.type === 'calendar-imported') {
        applyWeeklyHoursToDailyRows([row], state.daily.date);
        return row;
      }
      classifyDailyRowType(row, state.daily.date);
      if (dailyRowIsInterrupt(row)) return row;
      const prior = findPriorDailyTask(row.name, priorDailySources());
      if (prior) {
        row.type = 'ongoing';
        if (!(Number(row.previous) > 0) && prior.previous > 0) row.previous = prior.previous;
        if (!(Number(row.estimate) > 0) && prior.estimate > 0) row.estimate = prior.estimate;
      }
      applyWeeklyHoursToDailyRows([row], state.daily.date);
      return row;
    }
    function composedDailyNameFromRow(el) {
      if (!el) return '';
      const type = el.dataset ? el.dataset.type : '';
      if (type === 'interrupt' || type === 'calendar' || type === 'calendar-imported') {
        const interruptName = el.querySelector('.interrupt-name');
        if (interruptName) return String(interruptName.value || '').trim();
      }
      const parent = el.querySelector('.task-parent');
      const name = el.querySelector('.task-name');
      return composeDailyChildName(parent ? parent.value : '', name ? name.value : '');
    }
    function dailyEmptyState() {
      return '<tr class="empty-row"><td colspan="11">' + emptyStateHtml('この日の実績はまだありません', '週の課題から選ぶか、今日だけの作業を記録してください。', state.daily.mode === 'empty' ? '<md-outlined-button class="ghost-button" id="reloadDay" type="button">未完了タスクを再取得</md-outlined-button>' : '') + '</td></tr>';
    }
    function sheetsQuotaError(error) {
      return /quota exceeded|rate limit|too many requests|Read requests/i.test(String(error && (error.message || error) || ''));
    }
    function loadImportSuggestions(date) {
      const weekKey = isoWeek(parseYmd(date));
      if (Object.prototype.hasOwnProperty.call(state.parentNamesByWeek || {}, weekKey)) {
        return Promise.resolve(state.parentNamesByWeek[weekKey]);
      }
      state.suggestionBusy = state.suggestionBusy || {};
      if (state.suggestionBusy[weekKey]) return state.suggestionBusy[weekKey];
      const pending = gas('getImportSuggestions', date, []).then(function(items) {
        state.parentNamesByWeek[weekKey] = items || [];
        return state.parentNamesByWeek[weekKey];
      });
      state.suggestionBusy[weekKey] = pending;
      const clear = function() { delete state.suggestionBusy[weekKey]; };
      pending.then(clear, clear);
      return pending;
    }
    async function rememberDailyParentNames(date) {
      const weekKey = isoWeek(parseYmd(date));
      let items = state.parentNamesByWeek[weekKey];
      if (!items && state.planner.type === 'week' && state.planner.key === weekKey && state.planner.summary) {
        rememberWeeklyPlansFromSummary(weekKey, state.planner.summary);
        plannerItems().forEach(function(item) {
          if (!item || item.hasPlan === false || !String(item.name || '').trim()) return;
          rememberWeeklyPlanName(item.name, {
            planId: item.id,
            periodKey: item.originWeek || item.carryWeek || weekKey,
            originWeek: item.originWeek,
            carryWeek: item.carryWeek,
            carry: !!(item.carryWeek || item.originWeek && item.originWeek !== weekKey),
            prevB: hoursBeforeDateFromActualByDate(item.actualByDate, date),
            prevC: item.planned,
            plannedHours: item.planned,
            calendarKey: item.calendarKey,
            startDate: item.startDate,
            endDate: item.endDate,
            undated: !!item.undated,
            done: planIsComplete(item),
            completionOverride: item.completionOverride,
            projectId: item.projectId
          });
        });
        await rememberWeeklySubtasksForDate(date);
        return;
      }
      if (!items) {
        try { items = await loadImportSuggestions(date); }
        catch (_) { items = null; }
      }
      (items || []).forEach(function(item) {
        rememberWeeklyPlanName(item.title, { planId: item.planId, periodKey: item.periodKey, originWeek: item.originWeek, carryWeek: item.carryWeek, carry: !!(item.carryWeek || item.carry), prevB: item.prevB, prevC: item.prevC, plannedHours: item.prevC, calendarKey: item.calendarKey, projectId: item.projectId, startDate: item.startDate, endDate: item.endDate, undated: !!item.undated, done: item.done, completionOverride: item.completionOverride });
      });
      await rememberWeeklySubtasksForDate(date);
      rememberWeeklySubtasksFromSuggestions(weekKey, items);
    }
    function rememberWeeklyPlanName(name, extra) {
      const title = String(name || '').trim();
      if (!title) return;
      if (state.weeklyPlanNames.indexOf(title) < 0) state.weeklyPlanNames.push(title);
      const meta = state.weeklyPlanMeta[title] || {};
      if (extra && extra.carryWeek) meta.carryWeek = extra.carryWeek;
      if ((extra && extra.carry) || (extra && extra.carryWeek)) meta.carry = true;
      if (extra && extra.prevB != null) meta.prevB = extra.prevB;
      if (extra && extra.prevC != null) meta.prevC = extra.prevC;
      if (extra && extra.plannedHours != null) meta.plannedHours = roundHours(extra.plannedHours);
      if (extra && extra.planId) meta.planId = extra.planId;
      if (extra && extra.periodKey) meta.periodKey = extra.periodKey;
      if (extra && extra.originWeek) meta.originWeek = extra.originWeek;
      if (extra && extra.calendarKey) meta.calendarKey = extra.calendarKey;
      if (extra && Object.prototype.hasOwnProperty.call(extra, 'projectId')) meta.projectId = extra.projectId || '';
      if (extra && extra.startDate) meta.startDate = extra.startDate;
      if (extra && extra.endDate) meta.endDate = extra.endDate;
      if (extra && Object.prototype.hasOwnProperty.call(extra, 'undated')) meta.undated = !!extra.undated;
      if (extra && extra.done != null) meta.done = !!extra.done;
      if (extra && Object.prototype.hasOwnProperty.call(extra, 'completionOverride') && extra.completionOverride !== undefined) {
        const override = normalizePlanCompletionOverride(extra.completionOverride);
        if (override == null) delete meta.completionOverride;
        else meta.completionOverride = override;
      }
      state.weeklyPlanMeta[title] = meta;
    }
    function plannerReferenceMatches(entry, planId, previousName) {
      if (!entry || typeof entry !== 'object') return false;
      const id = String(planId || '').trim();
      const entryId = String(entry.planId || entry.parentPlanId || entry.id || '').trim();
      if (id && entryId) return id === entryId;
      const previous = String(previousName || '').trim();
      if (!previous) return false;
      return [entry.aggregationKey, entry.name, entry.title, entry.parentKey].some(function(value) {
        const name = String(value || '').trim();
        return name === previous || planIdentityName(name) === planIdentityName(previous);
      });
    }
    function renamePlannerNameReferences(item, previousName, nextName) {
      const previous = String(previousName || '').trim();
      const next = String(nextName || '').trim();
      if (!item || !previous || !next || previous === next) return;
      const planId = String(item.id || '').trim();
      const matches = function(entry) { return plannerReferenceMatches(entry, planId, previous); };
      const renameEntry = function(entry) {
        if (!matches(entry)) return;
        if (Object.prototype.hasOwnProperty.call(entry, 'aggregationKey')) entry.aggregationKey = next;
        if (Object.prototype.hasOwnProperty.call(entry, 'name')) entry.name = next;
        if (Object.prototype.hasOwnProperty.call(entry, 'title')) entry.title = next;
        if (Object.prototype.hasOwnProperty.call(entry, 'parentKey')) entry.parentKey = next;
        if (entry !== item && (entry.planId || entry.id) === planId && planId) entry.issueUrl = item.issueUrl || '';
        (entry.subtasks || []).forEach(function(task) {
          if (plannerReferenceMatches(task, planId, previous)) task.parentKey = next;
        });
      };
      const renameSubtaskParent = function(task) {
        if (plannerReferenceMatches(task, planId, previous)) task.parentKey = next;
      };
      [state.planner.items, state.daily.weekItems].forEach(function(items) {
        (items || []).forEach(renameEntry);
      });
      [state.planner.summary, state.daily.weekSummary].forEach(function(summary) {
        if (!summary) return;
        (summary.rows || []).forEach(renameEntry);
        (summary.subtasks || []).forEach(renameSubtaskParent);
      });
      Object.keys(state.parentNamesByWeek || {}).forEach(function(weekKey) {
        (state.parentNamesByWeek[weekKey] || []).forEach(renameEntry);
      });
      (state.candidates || []).forEach(renameEntry);
      Object.keys(state.weeklySubtasksByWeek || {}).forEach(function(weekKey) {
        (state.weeklySubtasksByWeek[weekKey] || []).forEach(renameSubtaskParent);
      });
      Object.keys(state.weekForecastCache || {}).forEach(function(weekKey) {
        const forecast = state.weekForecastCache[weekKey];
        (forecast && forecast.rows || []).forEach(renameEntry);
      });
      Object.keys(state.calendarCache || {}).forEach(function(cacheKey) {
        const cached = state.calendarCache[cacheKey];
        (cached && cached.rows || []).forEach(renameEntry);
      });
      // 繰り越し元の週も同じ予定IDなので、手元の週スナップショットも新しい名前にする。
      Object.keys(state.weekSnapshot || {}).forEach(function(snapId) {
        const snap = state.weekSnapshot[snapId];
        (snap && snap.summary && snap.summary.rows || []).forEach(renameEntry);
      });

      let replacementMeta = state.weeklyPlanMeta[next] || null;
      const removedMetaNames = {};
      Object.keys(state.weeklyPlanMeta || {}).forEach(function(name) {
        const meta = state.weeklyPlanMeta[name];
        if (name !== previous && !plannerReferenceMatches(meta, planId, previous)) return;
        if (!replacementMeta) replacementMeta = meta;
        removedMetaNames[name] = true;
        if (name !== next) delete state.weeklyPlanMeta[name];
      });
      if (replacementMeta && !state.weeklyPlanMeta[next]) state.weeklyPlanMeta[next] = replacementMeta;
      state.weeklyPlanNames = (state.weeklyPlanNames || []).filter(function(name) {
        return name === next || (!removedMetaNames[name] && name !== previous);
      });
      if (state.weeklyPlanNames.indexOf(next) < 0) state.weeklyPlanNames.push(next);
    }
    function rememberWeeklyPlansFromSummary(weekKey, summary) {
      rememberWeeklySubtasks(weekKey, summary && summary.subtasks);
      ((summary && summary.rows) || []).forEach(function(row) {
        if (!row || !row.hasPlan) return;
        rememberWeeklyPlanName(row.aggregationKey, {
          planId: row.planId,
          carryWeek: row.carryWeek || parsePlanCarryWeek(row.note),
          carry: !!(row.carryWeek || parsePlanCarryWeek(row.note)),
          periodKey: row.periodKey,
          originWeek: row.originWeek,
          plannedHours: row.plannedHours,
          prevC: row.plannedHours,
          calendarKey: row.calendarKey || parsePlanCalendarKey(row.note),
          projectId: row.projectId || '',
          startDate: row.startDate || parsePlanStartDate(row.note),
          endDate: row.endDate || '',
          undated: !!row.undated,
          done: planIsComplete(row),
          completionOverride: row.completionOverride
        });
      });
    }
    function rememberWeeklySubtasks(weekKey, tasks) {
      if (!weekKey) return;
      state.weeklySubtasksByWeek[weekKey] = (tasks || []).map(function(task) {
        return {
          id: task.id || '',
          parentKey: String(task.parentKey || '').trim(),
          parentPlanId: task.parentPlanId || '',
          title: String(task.title || '').trim(),
          plannedHours: roundHours(task.plannedHours),
          prevB: roundHours(task.prevB),
          dueDate: task.dueDate || '',
          status: task.status || 'todo',
          note: task.note || '',
          sortOrder: task.sortOrder || 0
        };
      });
    }
    function rememberWeeklySubtasksFromSuggestions(weekKey, items) {
      if (!weekKey) return;
      const existing = (weeklySubtasksForWeek(weekKey) || []).slice();
      (items || []).forEach(function(item) {
        const parent = String((item && (item.title || item.parentKey)) || '').trim();
        (item && item.subtasks || []).forEach(function(task) {
          const title = String((task && task.title) || '').trim();
          if (!parent || !title) return;
          const match = existing.find(function(entry) {
            return planningSubtaskMatchesParent(entry, parent, item.planId) && String(entry.title || '').trim() === title;
          });
          if (match) {
            if (!(Number(match.plannedHours) > 0) && Number(task.plannedHours) > 0) match.plannedHours = roundHours(task.plannedHours);
            if (task.prevB != null) match.prevB = roundHours(task.prevB);
            if (!match.parentPlanId && (item.planId || task.parentPlanId)) match.parentPlanId = item.planId || task.parentPlanId;
            return;
          }
          existing.push({
            id: task.id || '',
            parentKey: parent,
            parentPlanId: item.planId || task.parentPlanId || '',
            title: title,
            plannedHours: roundHours(task.plannedHours != null ? task.plannedHours : task.prevC),
            prevB: roundHours(task.prevB),
            dueDate: task.dueDate || '',
            status: task.status || 'todo',
            note: task.note || '',
            sortOrder: task.sortOrder || 0
          });
        });
      });
      rememberWeeklySubtasks(weekKey, existing);
      if (state.planner.type === 'week' && state.planner.key === weekKey && state.planner.summary) {
        state.planner.summary.subtasks = existing;
      }
    }
    function weeklySubtasksForWeek(weekKey) {
      const cached = state.weeklySubtasksByWeek[weekKey] || [];
      let live;
      if (state.planner.type === 'week' && state.planner.key === weekKey && state.planner.summary) {
        live = (state.planner.summary.subtasks || []).slice();
      } else if (state.daily.weekKey === weekKey && state.daily.weekSummary) {
        // 保存後などで週キャッシュが消えても、実績画面が持つ週予定のサブタスクで
        // 予定工数を引けるようにする（見つからないと親の予定工数に戻ってしまう）。
        live = (state.daily.weekSubtasks || []).map(function(task) { return Object.assign({}, task); });
      } else {
        return cached;
      }
      cached.forEach(function(task) {
        const title = String((task && task.title) || '').trim();
        const parent = String((task && task.parentKey) || '').trim();
        if (!title || !parent) return;
        const match = live.find(function(entry) {
          return planningSubtaskMatchesParent(entry, parent, task.parentPlanId) && String(entry.title || '').trim() === title;
        });
        if (match) {
          if (!(Number(match.plannedHours) > 0) && Number(task.plannedHours) > 0) match.plannedHours = roundHours(task.plannedHours);
          if ((match.prevB == null || !(Number(match.prevB) > 0)) && Number(task.prevB) > 0) match.prevB = roundHours(task.prevB);
          if (!match.parentPlanId && task.parentPlanId) match.parentPlanId = task.parentPlanId;
          return;
        }
        live.push(task);
      });
      return live;
    }
    function mergeSuggestionItem(target, source) {
      if (!target || !source) return target;
      ['title', 'parentKey', 'planId', 'periodType', 'periodKey', 'originWeek', 'carryWeek', 'calendarKey', 'startDate', 'endDate'].forEach(function(key) {
        if ((target[key] == null || target[key] === '') && source[key] != null && source[key] !== '') target[key] = source[key];
      });
      ['prevB', 'prevC', 'plannedHours'].forEach(function(key) {
        if (!(Number(target[key]) > 0) && Number(source[key]) > 0) target[key] = source[key];
      });
      if (target.done == null && source.done != null) target.done = !!source.done;
      if (source.undated) target.undated = true;
      if (target.complete == null && source.complete != null) target.complete = !!source.complete;
      if (target.completionOverride == null && source.completionOverride != null) {
        target.completionOverride = normalizePlanCompletionOverride(source.completionOverride);
      }
      if (source.completionOverride === false) target.done = false;
      const subtasks = target.subtasks || (target.subtasks = []);
      (source.subtasks || []).forEach(function(task) {
        const title = String((task && task.title) || '').trim();
        if (!title) return;
        const found = subtasks.find(function(existing) {
          return String((existing && existing.title) || '').trim() === title;
        });
        if (!found) {
          subtasks.push(task);
          return;
        }
        if (!(Number(found.plannedHours) > 0) && Number(task.plannedHours) > 0) found.plannedHours = task.plannedHours;
        if (!(Number(found.prevB) > 0) && Number(task.prevB) > 0) found.prevB = task.prevB;
        if (!found.parentPlanId && task.parentPlanId) found.parentPlanId = task.parentPlanId;
      });
      return target;
    }
    function suggestionItemsMatch(left, right) {
      const leftId = String((left && left.planId) || '').trim();
      const rightId = String((right && right.planId) || '').trim();
      if (leftId && rightId) return leftId === rightId;
      const leftName = planIdentityName((left && (left.title || left.parentKey)) || '');
      const rightName = planIdentityName((right && (right.title || right.parentKey)) || '');
      return !!leftName && leftName === rightName;
    }
    function suggestionItemsForWeek(weekKey) {
      const merged = [];
      // The cached parent list can be populated before the candidate request
      // finishes. Keep both lists: either one may contain subtasks the other
      // list does not have.
      const lists = [
        state.parentNamesByWeek && state.parentNamesByWeek[weekKey],
        state.candidates
      ];
      lists.forEach(function(items) {
        (items || []).forEach(function(item) {
          if (!item) return;
          const found = merged.find(function(existing) { return suggestionItemsMatch(existing, item); });
          if (found) mergeSuggestionItem(found, item);
          else merged.push(Object.assign({}, item, { subtasks: (item.subtasks || []).slice() }));
        });
      });
      return merged;
    }
    function dailyPlanSourcePeriodKey(source, fallbackWeekKey) {
      return String((source && (source.originWeek || source.periodKey || source.carryWeek)) || fallbackWeekKey || '').trim();
    }
    function dailyPlanSourceCanComplete(source, weekKey) {
      const periodKey = dailyPlanSourcePeriodKey(source, weekKey);
      return !!(periodKey && periodKey !== weekKey && source && (source.planId || source.name));
    }
    function dailyPlanSourceIsComplete(source) {
      if (!source) return false;
      const override = normalizePlanCompletionOverride(source.completionOverride);
      if (override === false) return false;
      return override === true || !!(source.done || source.complete || (completionSyncEnabled() && source.dailyComplete));
    }
    function dailySubtaskIsComplete(task) {
      if (!task) return false;
      const status = String(task.status || '').trim();
      return status === 'done' || status === '完了';
    }
    function weeklySubtasksForDate(date) {
      return weeklySubtasksForWeek(isoWeek(parseYmd(date || state.daily.date)));
    }
    function weeklySubtasksForParent(parentName, date, planId) {
      const parent = String(parentName || '').trim();
      const weekKey = isoWeek(parseYmd(date || state.daily.date));
      const id = String(planId || ((state.weeklyPlanMeta || {})[parent] || {}).planId || '').trim();
      const list = [];
      function add(task) {
        const title = String((task && task.title) || '').trim();
        if (!title) return;
        if (!planningSubtaskMatchesParent(task, parent, id)) return;
        const match = list.find(function(entry) { return String(entry.title || '').trim() === title; });
        if (match) {
          if (!(Number(match.plannedHours) > 0) && Number(task.plannedHours || task.prevC) > 0) {
            match.plannedHours = roundHours(task.plannedHours != null ? task.plannedHours : task.prevC);
          }
          if ((match.prevB == null || !(Number(match.prevB) > 0)) && Number(task.prevB) > 0) match.prevB = roundHours(task.prevB);
          if (!match.parentPlanId && (task.parentPlanId || id)) match.parentPlanId = task.parentPlanId || id;
          return;
        }
        list.push({
          id: task.id || '',
          parentKey: String((task && task.parentKey) || parent).trim() || parent,
          parentPlanId: task.parentPlanId || id || '',
          title: title,
          plannedHours: roundHours(task.plannedHours != null ? task.plannedHours : task.prevC),
          prevB: roundHours(task.prevB),
          dueDate: task.dueDate || '',
          status: task.status || 'todo',
          note: task.note || '',
          sortOrder: task.sortOrder || 0
        });
      }
      weeklySubtasksForDate(date).forEach(add);
      suggestionItemsForWeek(weekKey).forEach(function(item) {
        const itemId = String((item && item.planId) || '').trim();
        const title = String((item && (item.title || item.parentKey)) || '').trim();
        if (id && itemId) {
          if (itemId !== id) return;
        } else if (title !== parent && planIdentityName(title) !== planIdentityName(parent)) {
          return;
        }
        (item && item.subtasks || []).forEach(add);
      });
      return list.sort(function(left, right) {
        return (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0);
      });
    }
    function dailySelectablePlanSources(date) {
      const target = date || state.daily.date;
      const weekKey = isoWeek(parseYmd(target));
      const sources = [];
      function addSource(source) {
        if (!source || !String(source.name || '').trim()) return;
        const name = String(source.name || '').trim();
        const planId = String(source.planId || '').trim();
        const found = sources.find(function(existing) {
          const existingId = String(existing.planId || '').trim();
          if (planId && existingId) return planId === existingId;
          return planIdentityName(existing.name) === planIdentityName(name);
        });
        if (!found) {
          sources.push(Object.assign({}, source, { name: name, planId: planId }));
          return;
        }
        // Prefer the live workspace values, while filling fields which only
        // the import suggestion or the carry-over metadata knows about.
        ['planId', 'calendarKey', 'periodKey', 'originWeek', 'carryWeek', 'startDate', 'endDate'].forEach(function(key) {
          if (!found[key] && source[key]) found[key] = source[key];
        });
        if (!(Number(found.plannedHours) > 0) && Number(source.plannedHours) > 0) found.plannedHours = source.plannedHours;
        if (!(Number(found.prevB) > 0) && Number(source.prevB) > 0) found.prevB = source.prevB;
        if (source.undated) found.undated = true;
        if (source.completionOverride === false) {
          found.done = false;
          found.completionOverride = false;
        } else if (source.done) found.done = true;
      }
      dailyPlanItems().filter(function(item) {
        return item && item.hasPlan !== false && String(item.name || '').trim();
      }).map(function(item) {
        return {
          name: String(item.name || '').trim(),
          planId: String(item.id || '').trim(),
          plannedHours: roundHours(item.planned),
          prevB: hoursBeforeDateFromActualByDate(item.actualByDate, target),
          calendarKey: item.calendarKey || '',
          periodKey: dailyPlanSourcePeriodKey(item, weekKey),
          originWeek: String(item.originWeek || '').trim(),
          carryWeek: String(item.carryWeek || '').trim(),
          startDate: item.startDate || '',
          endDate: item.endDate || '',
          undated: !!item.undated,
          done: planIsComplete(item),
          completionOverride: item.completionOverride
        };
      }).forEach(addSource);
      suggestionItemsForWeek(weekKey).map(function(item) {
        return {
          name: String((item && (item.title || item.parentKey)) || '').trim(),
          planId: String((item && item.planId) || '').trim(),
          plannedHours: roundHours(item && (item.prevC != null ? item.prevC : item.plannedHours)),
          prevB: roundHours(item && item.prevB),
          calendarKey: (item && item.calendarKey) || '',
          periodKey: dailyPlanSourcePeriodKey(item, weekKey),
          originWeek: String((item && item.originWeek) || '').trim(),
          carryWeek: String((item && item.carryWeek) || '').trim(),
          startDate: (item && item.startDate) || '',
          endDate: (item && item.endDate) || '',
          undated: !!(item && item.undated),
          done: !!(item && (item.completionOverride === false ? false : (item.done || item.complete || (completionSyncEnabled() && item.dailyComplete)))),
          completionOverride: item && item.completionOverride
        };
      }).forEach(addSource);
      // 親候補APIを取得済みの週では、その結果を正とする。古い
      // weeklyPlanMeta を最後に足すと、完了済みの繰越元が復活してしまう。
      if (!Object.prototype.hasOwnProperty.call(state.parentNamesByWeek || {}, weekKey)) {
        dailyParentNames(target).map(function(name) {
          const meta = (state.weeklyPlanMeta || {})[name] || {};
          return {
            name: name,
            planId: String(meta.planId || '').trim(),
            plannedHours: roundHours(meta.plannedHours != null ? meta.plannedHours : meta.prevC),
            prevB: roundHours(meta.prevB),
            calendarKey: meta.calendarKey || '',
            periodKey: dailyPlanSourcePeriodKey(meta, weekKey),
            originWeek: String(meta.originWeek || '').trim(),
            carryWeek: String(meta.carryWeek || '').trim(),
            startDate: meta.startDate || '',
            endDate: meta.endDate || '',
            undated: !!meta.undated,
            done: !!(meta.completionOverride === false ? false : (meta.done || meta.complete)),
            completionOverride: meta.completionOverride
          };
        }).forEach(addSource);
      }
      return sources;
    }
    function dailySelectableIssues(date) {
      const existing = {};
      existingNames().forEach(function(name) { existing[name] = true; });
      const hoursByName = dailyHoursBeforeByName(date, priorDailySources());
      const hoursByPlanChild = weeklyHoursByPlanChild(date);
      const groups = [];
      dailySelectablePlanSources(date).forEach(function(source) {
        const parent = source.name;
        const periodKey = dailyPlanSourcePeriodKey(source, isoWeek(parseYmd(date)));
        const canComplete = dailyPlanSourceCanComplete(source, isoWeek(parseYmd(date)));
        if (dailyPlanSourceIsComplete(source) || !parent) return;
        const children = weeklySubtasksForParent(parent, date, source.planId);
        const openChildren = children.filter(function(task) { return !dailySubtaskIsComplete(task); });
        // 親課題を明示的に再開した場合、完了済みの子課題だけでも
        // 親課題自体は実績入力の候補に残す。
        const reopenedParent = source.completionOverride === false;
        if (children.length && !openChildren.length && !reopenedParent) return;
        const issues = [];
        if (openChildren.length) {
          openChildren.forEach(function(task) {
            const name = composeDailyChildName(parent, task.title);
            const stamp = (source.planId || task.parentPlanId || '') + '\0' + String(task.title || '').trim();
            if (!name || existing[name]) return;
            issues.push({
              name: name,
              parent: parent,
              title: task.title,
              plannedHours: task.plannedHours,
              previousHours: roundHours(task.prevB != null && Number(task.prevB) > 0
                ? task.prevB
                : (hoursByPlanChild[stamp] || hoursByName[name] || hoursByName[task.title] || 0)),
              status: task.status,
              planId: source.planId || task.parentPlanId || '',
              subtaskId: String(task.id || '')
            });
          });
        } else if (!existing[parent]) {
          issues.push({
            name: parent,
            parent: parent,
            title: parent,
            plannedHours: roundHours(source.plannedHours),
            previousHours: roundHours(source.prevB != null ? source.prevB : hoursByName[parent]),
            status: '',
            isParent: true,
            isCalendar: !!source.calendarKey,
            planId: source.planId || ''
          });
        }
        if (issues.length || canComplete) {
          // 予定の期間と、この日がその前後どちらにあるか（前倒し・期限超過を候補でも見せる）。
          const range = source.calendarKey ? null : planDateRange(source, isoWeek(parseYmd(date)));
          groups.push({
            parent: parent,
            planId: source.planId || '',
            periodKey: periodKey,
            canComplete: canComplete,
            range: range,
            undated: !!source.undated,
            position: range ? planDatePosition(range, date) : '',
            issues: issues
          });
        }
      });
      return groups;
    }
    function weeklyHasNamedIssue(name, date) {
      const title = String(name || '').trim();
      if (!title) return false;
      if (dailyParentNames(date).indexOf(title) >= 0) return true;
      return weeklySubtasksForDate(date).some(function(task) {
        return composeDailyChildName(task.parentKey, task.title) === title || String(task.title || '').trim() === title;
      });
    }
    function classifyDailyRowType(row, date) {
      if (!row) return row;
      const type = String(row.type || '');
      if (type === 'calendar' || type === 'calendar-imported') return row;
      if (type === 'interrupt') {
        row.previous = 0;
        row.estimate = numericHours(row.today);
        if (row.prevB != null) row.prevB = 0;
        if (row.prevC != null) row.prevC = row.estimate;
        return row;
      }
      if (row.planId) return row;
      const name = String(row.name || row.title || '').trim();
      if (!name) return row;
      if (weeklyHasNamedIssue(name, date)) return row;
      if (parentKeyForDailyName(name, dailyParentNames(date))) return row;
      row.type = 'interrupt';
      row.previous = 0;
      row.estimate = roundHours(row.estimate != null ? row.estimate : row.prevC);
      if (row.prevB != null) row.prevB = 0;
      if (row.prevC != null) row.prevC = row.estimate;
      return row;
    }
    function applySavedWeekWorkspace(weekKey, summary, live) {
      rememberWeeklyPlansFromSummary(weekKey, summary);
      delete state.weekForecastCache[weekKey];
      delete state.parentNamesByWeek[weekKey];
      const savedItems = plannerItemsFromSummaryRows(summary.rows);
      rememberWeekSnapshot('week', weekKey, summary, live
        ? { overlay: { items: savedItems, subtasks: summary.subtasks || [] } }
        : { stale: true });
      if (state.daily.weekKey === weekKey || dailyWeekKey(state.daily.date) === weekKey) {
        setDailyWeekWorkspace(weekKey, summary, savedItems);
        if (state.daily.rows && state.daily.rows.length) applyWeeklyHoursToDailyRows(state.daily.rows, state.daily.date);
      }
      if (live) {
        state.planner.summary = summary;
        state.planner.dirty = false;
        state.planner.changeSeq = 0;
        state.planner.items = savedItems;
      }
    }
    function addDailyCreatedIssue() {
      const name = document.getElementById('dailyNewIssueTitle').value.trim();
      if (!name) return toast('作業名を入力してください', 'error');
      if (existingNames().indexOf(name) >= 0) return toast('同じ名前の作業が既にあります', 'error');
      if (weeklyHasNamedIssue(name, state.daily.date)) {
        return toast('「' + name + '」はすでに週にあります。「週の課題から選ぶ」から入れてください', 'error');
      }
      const created = {
        id: uid('row-'),
        planId: '',
        projectId: typeof defaultAssignedProjectId === 'function' ? defaultAssignedProjectId() : '',
        name: name,
        today: 0,
        previous: 0,
        estimate: 0,
        status: '',
        type: 'interrupt'
      };
      addDailyRow(created, false);
      document.getElementById('dailyNewIssueTitle').value = '';
      const createdId = created.id;
      const focusToday = function() {
        const list = activeDailyTaskList();
        const el = list && list.querySelector('.work-card[data-id="' + createdId + '"]');
        const today = el && el.querySelector('.today-value');
        if (today) today.focus();
        else if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('add-row')) document.activeElement.blur();
      };
      const dialog = document.getElementById('candidateDialog');
      if (dialog && (dialog.open || appDialogIsOpen(dialog))) dialog.addEventListener('closed', focusToday, { once: true });
      closeCandidates();
      renderDaily();
      focusToday();
      toast('今日だけの作業を記録しました。本日実績に時間を入れてください', 'success');
    }
    function copyPlannerSubtask(task, parentKey) {
      return {
        id: (task && task.id) || uid('sub-'),
        parentKey: String(parentKey || (task && task.parentKey) || '').trim(),
        parentPlanId: (task && task.parentPlanId) || '',
        title: String((task && task.title) || '').trim(),
        plannedHours: roundHours(task && task.plannedHours),
        prevB: roundHours(task && task.prevB),
        dueDate: (task && task.dueDate) || '',
        status: (task && task.status) || 'todo',
        note: (task && task.note) || '',
        sortOrder: (task && task.sortOrder) || 0
      };
    }
    function removePlannerSubtasksForParent(parentName, parentPlanId) {
      if (!state.planner.summary) return;
      const parent = String(parentName || '').trim();
      state.planner.summary.subtasks = (state.planner.summary.subtasks || []).filter(function(task) {
        return !planningTaskBelongsToPlan(task, { id: parentPlanId, name: parent });
      });
      if (state.planner.type === 'week') rememberWeeklySubtasks(state.planner.key, state.planner.summary.subtasks);
    }
    async function rememberWeeklySubtasksForDate(date) {
      const weekKey = isoWeek(parseYmd(date));
      if (state.planner.type === 'week' && state.planner.key === weekKey && state.planner.summary) {
        rememberWeeklyPlansFromSummary(weekKey, {
          rows: plannerItems().map(function(item) {
            return {
              aggregationKey: item.name,
              hasPlan: item.hasPlan !== false,
              planId: item.id,
              actualHours: item.actual,
              plannedHours: item.planned,
              estimatedTotalHours: item.planned,
              carryWeek: item.carryWeek,
              calendarKey: item.calendarKey,
              startDate: item.startDate,
              endDate: item.endDate,
              undated: !!item.undated
            };
          }),
          subtasks: state.planner.summary.subtasks
        });
        return weeklySubtasksForDate(date);
      }
      try {
        await ensureDailyWeekWorkspace(weekKey);
      } catch (_) {
        if (!state.weeklySubtasksByWeek[weekKey]) rememberWeeklySubtasks(weekKey, []);
      }
      return weeklySubtasksForDate(date);
    }
    // 平日1日の標準の稼働時間（設定の「表示・操作」で変えられる）。カレンダーを読む前の仮の値にも使う。
    function workdayDefaultHours() { return Number(state.workdayHours) > 0 ? Number(state.workdayHours) : 8; }
    // 勤務する曜日（0=日〜6=土）。設定が読めないときは月〜金。
    function workdayWeekdays() {
      const raw = state.workdayWeekdays;
      if (Array.isArray(raw)) return raw.map(Number);
      if (typeof raw !== 'string' || /<\?/.test(raw)) return [1, 2, 3, 4, 5];
      return raw.split(',').filter(function(value) { return value.trim() !== ''; }).map(Number).filter(function(day) { return day >= 0 && day <= 6; });
    }
    // その日の標準の稼働時間（勤務しない曜日は0h）。date は Date か 'YYYY-MM-DD'。
    function standardHoursForDate(date) {
      const value = typeof date === 'string' ? parseYmd(date) : date;
      return workdayWeekdays().indexOf(value.getDay()) >= 0 ? workdayDefaultHours() : 0;
    }
    function pad2(value) { return String(value).padStart(2, '0'); }
    function ymd(date) { return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()); }
    function parseYmd(value) { return new Date(value + 'T12:00:00'); }

    function clearLocalReadCaches() {
      state.dailyCache = {};
      state.dailyFetchedAt = {};
      state.weekSnapshot = {};
      state.projectCache = {};
      state.projectFetchedAt = {};
      state.parentNamesByWeek = {};
      state.weeklySubtasksByWeek = {};
      state.calendarCache = {};
      state.calendarFetchedAt = {};
      state.weekForecastCache = {};
      state.weekContinuationBusy = {};
      state.candidates = [];
      state.weeklyPlanMeta = {};
      state.projects = [];
      state.daily.weekSummary = null;
      state.daily.weekItems = [];
      state.daily.weekSubtasks = [];
      state.daily.dirty = false;
      state.planner.dirty = false;
      state.project.catalogLoaded = false;
      state.project.catalogPromise = null;
      state.project.workspace = null;
      Object.keys(pendingGasReads).forEach(function(key) { delete pendingGasReads[key]; });
      try { localStorage.removeItem(NAV_LOCAL_KEY); } catch (_) {}
      // 空にしたプロジェクトの一覧はすぐ読み直す（読めたら日次・週を描き直す）。再読み込みしなくても名前が出るように。
      if (typeof ensureProjectCatalog === 'function') ensureProjectCatalog().catch(function() {});
    }
    async function syncFromSpreadsheet() {
      const dirty = !!(state.daily.dirty || state.planner.dirty || (typeof projectMonthEditorsDirty === 'function' && projectMonthEditorsDirty()));
      if (dirty && !await confirmDialog({
        title: 'スプレッドシートの内容を読み直しますか？',
        message: '保存していない変更は破棄されます。',
        confirmLabel: '読み直す',
        cancelLabel: 'キャンセル',
        danger: true
      })) return;
      if (typeof closeAppSettingsDialog === 'function') closeAppSettingsDialog();
      const button = document.getElementById('syncSpreadsheet');
      if (button) button.disabled = true;
      if (typeof cancelDailyAutoSave === 'function') cancelDailyAutoSave();
      if (typeof cancelPlannerAutoSave === 'function') cancelPlannerAutoSave();
      showBusy('スプレッドシートから読み込んでいます…');
      try {
        await gas('clearAppReadCache');
        clearLocalReadCaches();
        resetEditHistory();
        if (state.view === 'daily') await loadDaily({ force: true });
        else if (state.view === 'projects') await loadProjectScreen({ force: true });
        else if (state.view === 'month') await loadMonthGantt({ force: true });
        else await loadPlanner({ force: true });
        toast('スプレッドシートの内容を読み込みました', 'success');
      } catch (error) {
        toast('シートの読み込みに失敗しました: ' + (error && error.message ? error.message : error), 'error');
      } finally {
        hideBusy();
        if (button) button.disabled = false;
      }
    }
    function showBusy(message) {
      document.getElementById('busyText').textContent = message || '処理中…';
      document.getElementById('busy').hidden = false;
    }
    function hideBusy() { document.getElementById('busy').hidden = true; }
    let toastTimer = null;
    // Material 3 のスナックバー。エラーは読み切れるよう ✕ で閉じるまで残し、それ以外は数秒で消す。
    function toast(message, type) {
      const el = document.getElementById('toast');
      clearTimeout(toastTimer);
      const persistent = type === 'error';
      el.innerHTML = '<span class="toast-text"></span>' + (persistent
        ? '<button type="button" class="toast-close" aria-label="閉じる"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>'
        : '');
      el.querySelector('.toast-text').textContent = message;
      el.className = 'toast is-entering' + (type ? ' is-' + type : '');
      el.setAttribute('role', persistent ? 'alert' : 'status');
      el.hidden = false;
      requestAnimationFrame(function() { el.classList.remove('is-entering'); });
      const close = el.querySelector('.toast-close');
      if (close) close.addEventListener('click', hideToast);
      if (!persistent) toastTimer = setTimeout(hideToast, 4000);
    }
    function hideToast() {
      const el = document.getElementById('toast');
      clearTimeout(toastTimer);
      el.classList.add('is-entering');
      toastTimer = setTimeout(function() { el.hidden = true; }, 150);
    }

    const EDIT_HISTORY_LIMIT = 100;
    function cloneEditHistoryValue(value) {
      if (value == null) return value;
      try { return JSON.parse(JSON.stringify(value)); }
      catch (_) { return null; }
    }
    function dailyRowsForHistory(rows) {
      return cloneEditHistoryValue(rows || []).map(function(row) {
        if (row && row.type === 'saved') row.type = 'new';
        return row;
      });
    }
    function plannerSummaryForHistory(summary) {
      if (!summary) return null;
      return {
        range: cloneEditHistoryValue(summary.range),
        capacity: cloneEditHistoryValue(summary.capacity),
        subtasks: cloneEditHistoryValue(summary.subtasks || []),
        calendarExclusions: cloneEditHistoryValue(summary.calendarExclusions || [])
      };
    }
    function captureEditHistorySnapshot() {
      const dailyList = activeDailyTaskList();
      if ((state.view === 'daily' || state.view === 'planning') && dailyList && dailyList.querySelector('.work-card')) syncDailyFromDom();
      return {
        daily: {
          date: state.daily.date,
          loadedDate: state.daily.loadedDate,
          rows: dailyRowsForHistory(state.daily.rows || []),
          calendarRowsAtLoad: cloneEditHistoryValue(state.daily.calendarRowsAtLoad || [])
        },
        planner: {
          type: state.planner.type,
          key: state.planner.key,
          items: cloneEditHistoryValue(plannerItems()),
          summary: plannerSummaryForHistory(state.planner.summary)
        },
        calendarExclusions: cloneEditHistoryValue(calendarExclusions()),
        weeklyPlanNames: cloneEditHistoryValue(state.weeklyPlanNames || []),
        weeklyPlanMeta: cloneEditHistoryValue(state.weeklyPlanMeta || {}),
        weeklySubtasksByWeek: cloneEditHistoryValue(state.weeklySubtasksByWeek || {})
      };
    }
    function editHistoryDigest(snapshot) {
      try { return JSON.stringify(snapshot); }
      catch (_) { return ''; }
    }
    function syncEditHistoryControls() {
      const history = state.editHistory;
      const undo = document.getElementById('undoEdit');
      const redo = document.getElementById('redoEdit');
      if (undo) {
        undo.disabled = history.applying || history.past.length <= 1;
        undo.title = undo.disabled ? '元に戻せる変更はありません' : '元に戻す (Ctrl/Cmd+Z)';
      }
      if (redo) {
        redo.disabled = history.applying || !history.future.length;
        redo.title = redo.disabled ? 'やり直せる変更はありません' : 'やり直す (Ctrl/Cmd+Y)';
      }
    }
    // ブラウザの1文字ずつの元に戻すを使うのは、ダイアログの中の入力欄（文章を書く場所）と編集可能な文章だけ。
    // 画面の表の入力欄でもブラウザ側を使うと、1文字ずつしか戻らず、その変化が新しい編集として記録されて
    // アプリのやり直しの履歴が消えてしまうため、アプリの元に戻す・やり直すで扱う。
    function historyUsesNativeUndo(target) {
      if (!target) return false;
      if (target.isContentEditable) return true;
      return !!(target.closest && target.closest('md-dialog, dialog'));
    }
    // 入力中の欄を確定させてから元に戻す・やり直す（確定時の change で、入力が1つの編集として記録される）。
    function commitFocusedFieldForHistory() {
      const active = document.activeElement;
      if (active && active !== document.body && typeof active.blur === 'function') active.blur();
    }
    function resetEditHistory() {
      const snapshot = captureEditHistorySnapshot();
      const history = state.editHistory;
      history.past = [snapshot];
      history.future = [];
      history.lastDigest = editHistoryDigest(snapshot);
      history.lastKey = '';
      history.lastAt = 0;
      history.applying = false;
      syncEditHistoryControls();
    }
    function commitEditHistory(options) {
      const history = state.editHistory;
      if (history.applying) return;
      const snapshot = captureEditHistorySnapshot();
      const digest = editHistoryDigest(snapshot);
      if (!history.past.length) history.past.push(snapshot);
      if (digest === history.lastDigest) {
        syncEditHistoryControls();
        return;
      }
      options = options || {};
      const key = String(options.key || '');
      // 同じ欄への続けての入力は、間が空いても1つの編集にまとめる（元に戻すとその欄の編集がまとめて戻る）。
      const coalesce = !!options.coalesce && key && history.lastKey === key && history.past.length > 1;
      if (coalesce) history.past[history.past.length - 1] = snapshot;
      else {
        history.past.push(snapshot);
        if (history.past.length > EDIT_HISTORY_LIMIT) history.past.shift();
      }
      history.future = [];
      history.lastDigest = digest;
      history.lastKey = options.coalesce ? key : '';
      history.lastAt = Date.now();
      syncEditHistoryControls();
    }
    function historyCapacityDays(snapshot) {
      return (((snapshot || {}).planner || {}).summary || {}).capacity && (((snapshot || {}).planner || {}).summary || {}).capacity.days || [];
    }
    function historyCapacityIsFallback(snapshot) {
      const capacity = (((snapshot || {}).planner || {}).summary || {}).capacity;
      return !capacity || !!capacity.fallback;
    }
    // 元に戻した稼働時間を保存先へ書き戻す。カレンダーの読み込み前の仮の値（平日8h）が絡むときは書かない
    // （本当の稼働時間を仮の値で上書きしてしまうため）。両方にある日で、値が違う日だけを書く。
    async function syncEditHistoryCapacity(before, after) {
      if (historyCapacityIsFallback(before) || historyCapacityIsFallback(after)) return;
      const beforeDays = historyCapacityDays(before);
      const afterDays = historyCapacityDays(after);
      const beforeByDate = {};
      beforeDays.forEach(function(day) { if (day && day.date) beforeByDate[day.date] = day; });
      const changes = afterDays.filter(function(day) {
        if (!day || !day.date) return false;
        const previous = beforeByDate[day.date];
        return !!previous && (roundHours(previous.baseHours) !== roundHours(day.baseHours) || String(previous.capacityReason || '') !== String(day.capacityReason || ''));
      });
      if (!changes.length || !state.storage || !state.storage.configured) return;
      try {
        for (let index = 0; index < changes.length; index++) {
          const day = changes[index];
          await gas('saveWorkCapacitySetting', day.date, roundHours(day.baseHours), day.capacityReason || '');
        }
      } catch (error) {
        toast('稼働時間の取り消し保存に失敗しました: ' + error.message, 'error');
      }
    }
    function applyEditHistoryCalendarExclusions(snapshot) {
      const values = (((snapshot || {}).calendarExclusions || {}).all || []).filter(Boolean);
      try { localStorage.setItem(CALENDAR_EXCLUSIONS_KEY, JSON.stringify({ all: uniqueKeys(values) })); } catch (_) {}
      if (state.planner.summary) state.planner.summary.calendarExclusions = uniqueKeys(values).slice();
      if (state.daily.weekSummary) state.daily.weekSummary.calendarExclusions = uniqueKeys(values).slice();
    }
    async function restoreEditHistorySnapshot(snapshot) {
      const history = state.editHistory;
      if (!snapshot || history.applying) return;
      history.applying = true;
      syncEditHistoryControls();
      const before = captureEditHistorySnapshot();
      cancelDailyAutoSave();
      cancelPlannerAutoSave();
      state.daily.date = snapshot.daily.date || state.daily.date;
      state.daily.loadedDate = snapshot.daily.loadedDate || '';
      state.daily.rows = cloneEditHistoryValue(snapshot.daily.rows || []);
      state.daily.calendarRowsAtLoad = cloneEditHistoryValue(snapshot.daily.calendarRowsAtLoad || []);
      state.planner.type = snapshot.planner.type || 'week';
      state.planner.key = snapshot.planner.key || state.planner.key;
      state.planner.items = cloneEditHistoryValue(snapshot.planner.items || []);
      const restoredSummary = cloneEditHistoryValue(snapshot.planner.summary);
      // 記録したときの稼働時間が仮の値なら、今の（読み込み済みの）稼働時間を残す。
      if (restoredSummary && historyCapacityIsFallback(snapshot) && state.planner.summary && state.planner.summary.capacity) delete restoredSummary.capacity;
      if (state.planner.summary && restoredSummary) state.planner.summary = Object.assign(state.planner.summary, restoredSummary);
      else if (snapshot.planner.summary) state.planner.summary = cloneEditHistoryValue(snapshot.planner.summary);
      state.planner.focusedPlanId = '';
      state.weeklyPlanNames = cloneEditHistoryValue(snapshot.weeklyPlanNames || []);
      state.weeklyPlanMeta = cloneEditHistoryValue(snapshot.weeklyPlanMeta || {});
      state.weeklySubtasksByWeek = cloneEditHistoryValue(snapshot.weeklySubtasksByWeek || {});
      applyEditHistoryCalendarExclusions(snapshot);
      if (state.view === 'daily') {
        state.daily.changeSeq += 1;
        state.daily.dirty = true;
        state.daily.autoSaveDeferred = false;
        rememberDailyCalendarAutoNames(state.daily.date);
        renderDaily();
        scheduleDailyAutoSave();
      } else if (state.view === 'planning') {
        state.daily.changeSeq += 1;
        state.daily.dirty = true;
        state.daily.autoSaveDeferred = false;
        rememberDailyCalendarAutoNames(state.daily.date);
        renderDaily();
        state.planner.changeSeq += 1;
        state.planner.dirty = true;
        if (state.planner.summary && state.planner.summary.capacity) state.calendarCache[state.planner.type + ':' + state.planner.key] = state.planner.summary.capacity;
        updatePlannerSummary();
        schedulePlannerAutoSave();
      }
      history.lastDigest = editHistoryDigest(snapshot);
      history.lastKey = '';
      history.lastAt = 0;
      // 稼働時間の書き戻しは時間がかかるので待たない。待つ間はやり直し・元に戻すが押せなくなるため。
      history.applying = false;
      syncEditHistoryControls();
      syncEditHistoryCapacity(before, snapshot);
    }
    async function undoEdit() {
      const history = state.editHistory;
      if (history.applying || history.past.length <= 1) return;
      const current = history.past.pop();
      history.future.unshift(current);
      await restoreEditHistorySnapshot(history.past[history.past.length - 1]);
      toast('変更を元に戻しました');
    }
    async function redoEdit() {
      const history = state.editHistory;
      if (history.applying || !history.future.length) return;
      const next = history.future.shift();
      history.past.push(next);
      await restoreEditHistorySnapshot(next);
      toast('変更をやり直しました');
    }

    function syncCalendarModesSelection() {
      syncNav();
    }
    // アプリバーに出す期間。日は曜日付きの日付、週は月曜〜日曜、月は年月。short は狭い画面向け。
    function calendarPeriodLabel(mode, short) {
      if (mode === 'day') {
        const date = parseYmd(state.daily.date);
        const weekday = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
        return short ? (date.getMonth() + 1) + '/' + date.getDate() + '（' + weekday + '）' : (date.getMonth() + 1) + '月' + date.getDate() + '日（' + weekday + '）';
      }
      if (mode === 'projects') return short ? state.project.monthKey.replace('-', '/') : monthKeyLabel(state.project.monthKey);
      if (mode === 'month') return short ? state.month.key.replace('-', '/') : monthKeyLabel(state.month.key);
      const monday = mondayForWeek(state.planner.key);
      const start = new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      const sameMonth = end.getMonth() === start.getMonth();
      if (short) return (start.getMonth() + 1) + '/' + start.getDate() + '〜' + (sameMonth ? '' : (end.getMonth() + 1) + '/') + end.getDate();
      return (start.getMonth() + 1) + '月' + start.getDate() + '日〜' + (sameMonth ? '' : (end.getMonth() + 1) + '月') + end.getDate() + '日';
    }
    function syncCalendarControl() {
      const mode = state.view === 'projects' ? 'projects' : state.calendarMode;
      syncCalendarModesSelection();
      if (typeof closeDatePicker === 'function') closeDatePicker(false);
      const input = document.getElementById('calendarPeriodInput');
      input.value = mode === 'projects' ? state.project.monthKey : mode === 'day' ? state.daily.date : mode === 'month' ? state.month.key : state.planner.key;
      document.getElementById('calendarToday').textContent = '今日';
      document.getElementById('calendarToday').title = mode === 'projects' ? '今月のプロジェクトを開く' : mode === 'day' ? '今日の実績を開く' : (mode === 'week' ? '今週' : '今月') + 'に戻り、今日の列を表示';
      document.getElementById('calendarPeriodLabel').textContent = calendarPeriodLabel(mode);
      document.getElementById('calendarPeriodShortLabel').textContent = calendarPeriodLabel(mode, true);
      const plannerInput = document.getElementById('periodInput');
      if (plannerInput) {
        plannerInput.type = 'week';
        plannerInput.value = state.planner.key;
      }
      persistViewState();
    }

    function isViewYmd(value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = parseYmd(value);
      return !Number.isNaN(date.getTime()) && ymd(date) === value;
    }
    function isViewWeekKey(value) {
      return /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value);
    }
    function isProjectMonthKey(value) {
      const key = String(value || '');
      if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(key)) return false;
      const parts = key.split('-').map(Number);
      const date = new Date(parts[0], parts[1], 0);
      return !Number.isNaN(date.getTime()) && date.getFullYear() === parts[0] && date.getMonth() + 1 === parts[1];
    }
    function currentViewState() {
      if (state.view === 'daily') return { view: 'day', key: state.daily.date };
      if (state.view === 'projects') return { view: 'projects', key: state.project.monthKey || periodForToday('month') };
      if (state.view === 'month') return { view: 'month', key: state.month.key || periodForToday('month') };
      return { view: 'week', key: state.planner.key };
    }
    function parseViewState(input) {
      let view = '';
      let key = '';
      if (input && typeof input === 'object') {
        view = input.view;
        key = input.key;
      } else {
        const match = String(input || '').replace(/^#/, '').match(/^\/?(day|week|month|projects)\/([^/?#]+)$/);
        if (!match) return null;
        view = match[1];
        key = match[2];
      }
      if (view === 'day' && isViewYmd(key)) return { view: view, key: key };
      if (view === 'week' && isViewWeekKey(key)) return { view: view, key: key };
      if (view === 'projects' && isProjectMonthKey(key)) return { view: view, key: key };
      if (view === 'month' && isProjectMonthKey(key)) return { view: view, key: key };
      return null;
    }
    // 画面の種類（日・週・月・プロジェクト）が変わったときだけ、ブラウザの履歴に積む。
    // 同じ画面で週や日だけが変わるときは、いまの履歴を書き換える。戻るボタンやAlt+←で「さっきいた画面」へ戻れる。
    const navHistory = { timer: 0, pending: null };
    function navHistoryIndex() {
      const value = history.state && history.state.navIndex;
      return Number.isInteger(value) && value > 0 ? value : 0;
    }
    function syncNavBackButton() {
      const button = document.getElementById('navBack');
      if (button) button.disabled = navHistoryIndex() <= 0;
    }
    function flushNavHistory() {
      const pending = navHistory.pending;
      navHistory.pending = null;
      if (!pending) { syncNavBackButton(); return; }
      if (location.hash === pending.hash) {
        // 最初の画面にも履歴の番号を付けておく（これがないと、次の移動を「積む」のか分からない）。
        if (!(history.state && Number.isInteger(history.state.navIndex))) {
          try { history.replaceState(Object.assign({ navIndex: 0 }, pending.snapshot), '', pending.hash); } catch (_) {}
        }
        syncNavBackButton();
        return;
      }
      const previous = parseViewState(location.hash);
      const hasEntry = history.state && Number.isInteger(history.state.navIndex);
      const push = hasEntry && previous && previous.view !== pending.snapshot.view;
      const index = push ? navHistoryIndex() + 1 : navHistoryIndex();
      const entry = Object.assign({ navIndex: index }, pending.snapshot);
      try { history[push ? 'pushState' : 'replaceState'](entry, '', pending.hash); }
      catch (_) { location.hash = pending.hash; }
      syncNavBackButton();
    }
    function persistViewState() {
      const snapshot = parseViewState(currentViewState());
      if (!snapshot) return;
      try { localStorage.setItem(VIEW_KEY, JSON.stringify(snapshot)); } catch (_) {}
      const hash = '#/' + snapshot.view + '/' + snapshot.key;
      // 続けて何度も呼ばれる途中の状態は履歴に残さず、落ち着いた状態だけを記録する。
      navHistory.pending = { snapshot: snapshot, hash: hash };
      clearTimeout(navHistory.timer);
      navHistory.timer = setTimeout(flushNavHistory, 0);
    }
    async function restoreViewFromHistory(event) {
      const snapshot = parseViewState(event && event.state) || parseViewState(location.hash);
      syncNavBackButton();
      if (!snapshot) return;
      navHistory.pending = null;
      const current = currentViewState();
      if (current.view === snapshot.view && current.key === snapshot.key) return;
      try {
        if (snapshot.view === 'projects') await openProjectsView(snapshot.key);
        else await setCalendarMode(snapshot.view, snapshot.key);
      } finally {
        // 未保存の確認で移動をやめたときは、表示と履歴のずれを直す。
        const now = parseViewState(currentViewState());
        if (now && location.hash !== '#/' + now.view + '/' + now.key) {
          try { history.replaceState(Object.assign({ navIndex: navHistoryIndex() }, now), '', '#/' + now.view + '/' + now.key); } catch (_) {}
        }
        syncNavBackButton();
      }
    }
    function navigateBack() {
      if (navHistoryIndex() > 0) history.back();
    }
    function readStoredViewState() {
      const fromHash = parseViewState(location.hash);
      if (fromHash) return fromHash;
      try { return parseViewState(JSON.parse(localStorage.getItem(VIEW_KEY) || 'null')); }
      catch (_) { return null; }
    }
    function applyViewVisibility() {
      rememberCalendarTimelinePosition('week');
      rememberCalendarTimelinePosition('month');
      document.getElementById('dailyView').hidden = state.view !== 'daily';
      document.getElementById('planningView').hidden = state.view !== 'planning';
      document.getElementById('projectsView').hidden = state.view !== 'projects';
      document.getElementById('monthView').hidden = state.view !== 'month';
      const calendarCommand = document.getElementById('calendarCommand');
      if (calendarCommand) calendarCommand.hidden = false;
      syncCalendarControl();
      syncCalendarModesSelection();
      if (typeof renderTimer === 'function') renderTimer();
    }
    function applyViewState(snapshot) {
      const next = parseViewState(snapshot);
      if (!next) return false;
      if (next.view === 'day') {
        state.view = 'daily';
        state.calendarMode = 'day';
        state.daily.date = next.key;
        state.planner.type = 'week';
        state.planner.key = isoWeek(parseYmd(next.key));
      } else {
        if (next.view === 'projects') {
          state.view = 'projects';
          state.calendarMode = 'week';
          state.project.monthKey = next.key;
        } else if (next.view === 'month') {
          state.view = 'month';
          state.calendarMode = 'month';
          state.month.key = next.key;
        } else {
          state.view = 'planning';
          state.calendarMode = 'week';
          state.planner.type = 'week';
          state.planner.key = next.key;
        }
      }
      applyViewVisibility();
      return true;
    }

    // 日・週・月・プロジェクトは、アプリバー右の1つのメニューで切り替える。
    function syncNav() {
      const current = state.view === 'projects' ? 'projects' : state.calendarMode;
      const label = document.getElementById('viewMenuLabel');
      const name = { day: '日', week: '週', month: '月', projects: 'プロジェクト' }[current] || '週';
      const compactProject = current === 'projects' && typeof matchMedia === 'function' && matchMedia('(max-width: 620px)').matches;
      if (label) label.textContent = compactProject ? 'PJ' : name;
      const button = document.getElementById('viewMenuButton');
      if (button) button.setAttribute('aria-label', name + 'の表示。表示を切り替える');
      document.querySelectorAll('#viewMenu [data-view]').forEach(function(item) { item.selected = item.dataset.view === current; });
    }

    // 横位置は週と月で独立させる。再描画やタブ復帰では、読んでいた位置を保つ。
    const calendarTimelinePositions = { week: {}, month: {} };
    function calendarTimelineElements(mode) {
      if (mode !== 'week' && mode !== 'month') return null;
      const target = document.getElementById(mode === 'week' ? 'weekCalendar' : 'monthGantt');
      if (!target) return null;
      return {
        target: target,
        header: mode === 'week' ? '.week-head-day' : '.month-day-head',
        label: mode === 'week' ? '.week-head-label' : '.month-head-label',
        dateAttribute: mode === 'week' ? 'data-date' : 'data-month-date'
      };
    }
    function rememberCalendarTimelinePosition(mode) {
      const elements = calendarTimelineElements(mode);
      const position = calendarTimelinePositions[mode];
      if (!elements || !position || !position.initialized) return;
      const target = elements.target;
      if (target.clientWidth > 0 && target.dataset.timelineKey === position.key && target.querySelector(elements.header)) {
        position.left = target.scrollLeft;
      }
    }
    // 週は1画面にちょうど7日が並ぶよう、日付列の幅を表示幅から決める。
    // 画面の幅は、毎回測らず、大きさが変わったときだけ測り直す（測るたびにレイアウトの再計算が走り、週の切り替えが重くなるため）。
    const weekFitCache = { width: 0, nameWidth: 0, applied: '', needsApply: false, observer: null };
    function fitWeekTimelineColumns() {
      const target = document.getElementById('weekCalendar');
      if (!target || typeof getComputedStyle !== 'function') return;
      if (!weekFitCache.observer && typeof ResizeObserver === 'function') {
        weekFitCache.observer = new ResizeObserver(function() { weekFitCache.width = 0; fitWeekTimelineColumns(); });
        weekFitCache.observer.observe(target);
      }
      if (!weekFitCache.width) {
        // 前に余りを足した名前列の幅を外してから、元の幅を測る。
        target.style.removeProperty('--week-name-col');
        weekFitCache.width = target.clientWidth;
        weekFitCache.nameWidth = parseFloat(getComputedStyle(target).getPropertyValue('--week-name-col')) || 0;
        weekFitCache.needsApply = true;
      }
      if (!weekFitCache.width) return;
      const width = Math.max(40, Math.floor((weekFitCache.width - weekFitCache.nameWidth) / 7));
      // 日付の列は整数のpxにしたいので、割り切れない余りは名前の列に足す。これで7日がちょうど画面に収まる（右に次の週が少し見えない）。
      const nameWidth = weekFitCache.width - width * 7 > weekFitCache.nameWidth ? weekFitCache.width - width * 7 : weekFitCache.nameWidth;
      const signature = width + 'x' + nameWidth;
      // 値が同じなら触らない（触るとスタイルの再計算とレイアウトのやり直しが走る）。
      if (weekFitCache.applied === signature && !weekFitCache.needsApply) return;
      const resized = !!weekFitCache.applied && weekFitCache.applied !== signature;
      weekFitCache.applied = signature;
      weekFitCache.needsApply = false;
      target.style.setProperty('--week-name-col', nameWidth + 'px');
      target.style.setProperty('--week-day-col', width + 'px');
      // 画面の幅が変わって列の幅が変わったときは、いま見ている週の頭にそろえ直す（位置がずれたまま残らないように）。
      if (resized && typeof calendarTimelinePositions === 'object' && calendarTimelinePositions.week) {
        calendarTimelinePositions.week.initialized = false;
        calendarTimelinePositions.week.date = '';
        requestAnimationFrame(function() { positionCalendarTimeline('week'); });
      }
    }
    // 画面の中央にある期間と、左端の日付（切り替え後も同じ位置に保つため）を求める。
    function centeredCalendarPeriod(mode) {
      const elements = calendarTimelineElements(mode);
      if (!elements) return null;
      const target = elements.target;
      const label = target.querySelector(elements.label);
      const left = target.getBoundingClientRect().left + (label ? label.getBoundingClientRect().width : 0);
      const center = left + (target.getBoundingClientRect().width - (label ? label.getBoundingClientRect().width : 0)) / 2;
      let centerDate = '';
      let anchor = null;
      Array.prototype.forEach.call(target.querySelectorAll(elements.header), function(day) {
        const rect = day.getBoundingClientRect();
        const date = day.getAttribute(elements.dateAttribute);
        if (rect.left <= center && rect.right > center) centerDate = date;
        if (!anchor && rect.right > left) anchor = { date: date, offset: left - rect.left };
      });
      if (!centerDate || !anchor) return null;
      return { key: mode === 'week' ? isoWeek(parseYmd(centerDate)) : centerDate.slice(0, 7), anchor: anchor };
    }
    // 中央の期間が変わったら、その期間を表示中の期間にして、前後を読み込み直す。
    async function activateCenteredCalendarPeriod(mode) {
      // 期間をドラッグしている間は、自動スクロールで中央の週・月が変わっても、表示中の期間を切り替えない。
      if (typeof periodDrag !== 'undefined' && periodDrag.active) return;
      const elements = calendarTimelineElements(mode);
      const current = mode === 'week' ? state.planner.key : state.month.key;
      if (!elements || elements.target.dataset.timelineKey !== current) return;
      if (state.view !== (mode === 'week' ? 'planning' : 'month')) return;
      let found = centeredCalendarPeriod(mode);
      // 矢印やキーで隣の週へ流したときは、止まった位置ではなく行き先の週の月曜にそろえる
      // （流している途中の描き直しなどで数px〜1日手前や先で止まっても、最後にずれない）。
      const intended = mode === 'week' && typeof weekNeighborNav === 'object' && weekNeighborNav.from === current && weekNeighborNav.key &&
        calendarNeighborKeys(mode, current).indexOf(weekNeighborNav.key) >= 0 ? weekNeighborNav.key : '';
      if (intended) {
        clearTimeout(weekNeighborNav.timer);
        weekNeighborNav.from = '';
        weekNeighborNav.key = '';
        found = { key: intended, anchor: { date: calendarSelectedStart(mode, intended), offset: 0 } };
      }
      if (!found || found.key === current) return;
      // 前後のどの期間へ移っても切り替える（スクロールが速いと、1つ先ではなく数期間先で止まる）。
      if (calendarNeighborKeys(mode, current).indexOf(found.key) < 0) return;
      const delta = calendarPeriodDelta(mode, current, found.key);
      if (!delta) return;
      if (mode === 'week') {
        if (state.planner.busy || state.planner.saving) return;
        if (state.planner.dirty) await savePlanner({ auto: true });
        if (state.planner.dirty || state.planner.key !== current) return;
        rememberAdjacentCalendarPeriod('week', current, Object.assign({}, state.planner.summary, { periodKey: current, items: plannerItems().slice() }));
      } else {
        rememberAdjacentCalendarPeriod('month', current, state.month.data);
      }
      calendarTimelinePositions[mode] = { key: found.key, left: 0, initialized: false, date: found.anchor.date, offset: found.anchor.offset };
      shiftCalendarPeriod(delta, { immediate: true });
    }
    // 日付のセルへの吸い付きは CSS の scroll snap に任せる（指の動きや慣性と一緒に計算され、なめらか）。
    // ここでは止まった後に中央の期間を切り替えるだけ。
    function settleCalendarTimeline(mode) {
      activateCenteredCalendarPeriod(mode);
    }
    function scrollCalendarTimelineToDate(mode, date) {
      const elements = calendarTimelineElements(mode);
      const target = elements && elements.target;
      const day = target && target.querySelector(elements.header + '[' + elements.dateAttribute + '="' + date + '"]');
      if (!day) return;
      const label = target.querySelector(elements.label);
      const left = day.getBoundingClientRect().left - target.getBoundingClientRect().left + target.scrollLeft - (label ? label.getBoundingClientRect().width : 0);
      target.scrollTo({ left: left, behavior: 'smooth' });
    }
    // 前後の週の中を押したときは、編集の前にその週を中央へ寄せて表示中の週にする。
    function redirectCalendarContextClick(event) {
      const holder = event.target.closest && event.target.closest('[data-date]');
      const range = state.planner.summary && state.planner.summary.range;
      if (!range) return;
      let date = holder ? holder.getAttribute('data-date') : '';
      // 予定の行には日付のセルがないので、空いている所を押したときは、押した位置の見出しの日付を使う。
      if (!holder && event.target.closest('.span-row') && !event.target.closest('.span-name, .timeline-period, a, button')) {
        const heads = event.currentTarget.querySelectorAll('.week-head-day[data-date]');
        for (let i = 0; i < heads.length; i++) {
          const rect = heads[i].getBoundingClientRect();
          if (event.clientX >= rect.left && event.clientX < rect.right) { date = heads[i].getAttribute('data-date'); break; }
        }
      }
      if (!date) return;
      if (!date || (date >= range.startYmd && date < range.endExclusiveYmd)) return;
      event.preventDefault();
      event.stopPropagation();
      const period = calendarSurroundingPeriods('week', isoWeek(parseYmd(date)))[calendarWindowRadius('week')];
      scrollCalendarTimelineToDate('week', period.range.startYmd);
    }
    function bindCalendarTimelineSnap(mode, target) {
      if (target.dataset.snapBound || typeof target.addEventListener !== 'function') return;
      target.dataset.snapBound = '1';
      if (mode === 'week') target.addEventListener('click', redirectCalendarContextClick, true);
      // 表示範囲の端にぶつかったままスクロールしようとしたら、止まるのを待たずに隣の期間へ切り替える。
      let edgeTimer = 0;
      target.addEventListener('wheel', function(event) {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : (event.shiftKey ? event.deltaY : 0);
        if (!delta) return;
        const max = target.scrollWidth - target.clientWidth;
        const atEdge = (delta < 0 && target.scrollLeft <= 1) || (delta > 0 && target.scrollLeft >= max - 1);
        if (!atEdge) return;
        clearTimeout(edgeTimer);
        edgeTimer = setTimeout(function() { activateCenteredCalendarPeriod(mode); }, 80);
      }, { passive: true });
      if ('onscrollend' in target) {
        target.addEventListener('scrollend', function() { settleCalendarTimeline(mode); });
        return;
      }
      let timer = 0;
      target.addEventListener('scroll', function() {
        clearTimeout(timer);
        timer = setTimeout(function() { settleCalendarTimeline(mode); }, 150);
      }, { passive: true });
    }
    function positionCalendarTimeline(mode) {
      const elements = calendarTimelineElements(mode);
      if (!elements || state.view !== (mode === 'week' ? 'planning' : 'month')) return;
      if (mode === 'week') fitWeekTimelineColumns();
      bindCalendarTimelineSnap(mode, elements.target);
      const key = mode === 'week' ? state.planner.key : state.month.key;
      const target = elements.target;
      // 読み込み中の旧グリッドや、非表示のグリッドでは位置を確定しない。
      if (target.dataset.timelineKey !== key || !target.clientWidth || !target.querySelector(elements.header)) return;
      let position = calendarTimelinePositions[mode];
      if (position.key !== key) position = calendarTimelinePositions[mode] = { key: key, left: 0, initialized: false };
      if (!position.initialized || position.date) {
        const date = position.date || calendarSelectedStart(mode, key);
        const day = target.querySelector(elements.header + '[' + elements.dateAttribute + '="' + date + '"]');
        position.left = 0;
        if (day) {
          const label = target.querySelector(elements.label);
          const nameWidth = label ? label.getBoundingClientRect().width : 0;
          const dayRect = day.getBoundingClientRect();
          const dayOffset = dayRect.left - target.getBoundingClientRect().left + target.scrollLeft;
          const available = Math.max(0, target.clientWidth - nameWidth);
          position.left = dayOffset - nameWidth + (position.offset || 0) - (position.date && position.center ? Math.max(0, (available - dayRect.width) / 2) : 0);
        }
        position.initialized = true;
        position.date = '';
      }
      target.scrollLeft = Math.max(0, Math.min(position.left, target.scrollWidth - target.clientWidth));
      position.left = target.scrollLeft;
      placeCalendarNowLine(mode);
    }
    // 週・月の「いま」の線。今日の列の中を、時刻に合わせて左から右へ進む。
    // 重なりは、予定の帯より上、名前の列（スクロールで被さる）より下に固定する（CSSの .timeline-now-line）。
    function placeCalendarNowLine(mode) {
      const elements = calendarTimelineElements(mode);
      if (!elements) return;
      const grid = elements.target.firstElementChild;
      if (!grid) return;
      let line = grid.querySelector(':scope > .timeline-now-line');
      const now = new Date();
      const day = elements.target.querySelector(elements.header + '[' + elements.dateAttribute + '="' + ymd(now) + '"]');
      if (!day || !day.offsetWidth) { if (line) line.remove(); return; }
      if (!line) {
        line = document.createElement('div');
        line.className = 'timeline-now-line';
        line.setAttribute('aria-hidden', 'true');
        grid.appendChild(line);
      }
      const gridRect = grid.getBoundingClientRect();
      const dayRect = day.getBoundingClientRect();
      const fraction = (now.getHours() * 60 + now.getMinutes()) / 1440;
      line.style.left = (dayRect.left - gridRect.left + dayRect.width * fraction) + 'px';
      // 日付の見出しには重ねず、その下から引く。
      line.style.top = (dayRect.bottom - gridRect.top) + 'px';
    }
    function refreshCalendarNowLines() {
      placeCalendarNowLine('week');
      placeCalendarNowLine('month');
    }

    async function returnToCalendarToday() {
      if (state.view === 'projects') { await selectProjectMonth(projectMonthForToday()); return; }
      const mode = state.calendarMode;
      const date = ymd(new Date());
      const key = mode === 'day' ? date : periodForToday(mode);
      const current = currentViewState();
      // 同じ期間なら再読み込みも未保存確認も不要。横位置だけを戻す。
      if (current.view !== mode || current.key !== key || mode === 'day') await setCalendarMode(mode, key);
      const opened = currentViewState();
      if (opened.view !== mode || opened.key !== key || mode === 'day') return;
      // 週は今日を中央に寄せず、月曜〜日曜がちょうど収まる位置にそろえる。
      calendarTimelinePositions[mode] = mode === 'week'
        ? { key: key, left: 0, initialized: false, date: calendarSelectedStart(mode, key) }
        : { key: key, left: 0, initialized: false, date: date, center: true };
      positionCalendarTimeline(mode);
    }

    function returnToSelectedCalendarPeriod(mode) {
      const key = mode === 'week' ? state.planner.key : state.month.key;
      calendarTimelinePositions[mode] = { key: key, left: 0, initialized: false, date: calendarSelectedStart(mode, key) };
      positionCalendarTimeline(mode);
    }

    // 日・週・月はそれぞれ最後に見ていた日付を覚えておき、表示を切り替えても他の表示の日付に引きずられない。
    // 月の中の週や日を開くときのように、開く日付を明示する場合は setCalendarMode に渡す。
    function calendarTargetForMode(mode) {
      const today = new Date();
      if (mode === 'day') return isViewYmd(state.daily.date) ? state.daily.date : ymd(today);
      if (mode === 'month') return isProjectMonthKey(state.month.key) ? state.month.key : ymd(today).slice(0, 7);
      return state.planner.type === 'week' && isViewWeekKey(state.planner.key) ? state.planner.key : isoWeek(today);
    }

    async function setCalendarMode(mode, targetValue) {
      if (mode !== 'day' && mode !== 'week' && mode !== 'month') mode = 'week';
      const alreadyShowingMode = (mode === 'day' && state.view === 'daily') || (mode === 'week' && state.view === 'planning') || (mode === 'month' && state.view === 'month');
      if (mode === state.calendarMode && !targetValue && alreadyShowingMode) { syncCalendarControl(); return; }
      if (state.view === 'daily' && dailyNeedsLeaveConfirm() && !await confirmLeaveUnsaved('表示を切り替え')) { syncCalendarControl(); return; }
      if (state.view === 'planning' && unsavedNeedsLeaveConfirm() && !await confirmLeaveUnsaved('表示を切り替え')) { syncCalendarControl(); return; }
      const resolvedTarget = targetValue || calendarTargetForMode(mode);
      if (mode === 'week' && state.view === 'planning' && state.planner.key !== resolvedTarget) prepareWeekNavigationMotion(resolvedTarget);
      state.calendarMode = mode;
      state.view = mode === 'day' ? 'daily' : mode === 'month' ? 'month' : 'planning';
      applyViewVisibility();
      if (mode === 'month') {
        state.month.key = resolvedTarget;
        syncCalendarControl();
        syncNav();
        updateSaveDock();
        await loadMonthGantt();
        return;
      }
      if (mode === 'day') {
        state.daily.date = resolvedTarget;
        syncCalendarControl();
        syncNav();
        updateSaveDock();
        await loadDaily();
        return;
      }
      state.planner.type = 'week';
      state.planner.key = resolvedTarget;
      const plannerInput = document.getElementById('periodInput');
      plannerInput.type = 'week';
      plannerInput.value = state.planner.key;
      document.getElementById('weekMode').classList.toggle('is-active', true);
      syncCalendarControl();
      syncNav();
      updateSaveDock();
      await loadPlanner();
    }
