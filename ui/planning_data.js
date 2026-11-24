    function isoWeek(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const day = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() + 3 - day);
      const year = d.getUTCFullYear();
      const jan4 = new Date(Date.UTC(year,0,4));
      const janDay = (jan4.getUTCDay() + 6) % 7;
      const firstThu = new Date(jan4.getTime() + (3 - janDay) * 86400000);
      return year + '-W' + pad2(1 + Math.round((d - firstThu) / 604800000));
    }
    function periodForToday(type) { const now = new Date(); return type === 'month' ? now.getFullYear() + '-' + pad2(now.getMonth() + 1) : isoWeek(now); }
    function mondayForWeek(key) {
      const match = key.match(/^(\d{4})-W(\d{2})$/);
      const jan4 = new Date(Date.UTC(Number(match[1]),0,4));
      return new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + (Number(match[2]) - 1) * 604800000);
    }
    function previousWeekKey(key) {
      const monday = mondayForWeek(key);
      monday.setUTCDate(monday.getUTCDate() - 7);
      return isoWeek(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
    }
    function nextWeekKey(key) {
      const monday = mondayForWeek(key);
      monday.setUTCDate(monday.getUTCDate() + 7);
      return isoWeek(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
    }
    function discardDailyDraftForPlannerNavigation() {
      if (!state.daily.dirty) return;
      cancelDailyAutoSave();
      state.daily.dirty = false;
      state.daily.autoSaveDeferred = false;
      state.daily.saveQueued = false;
      state.daily.loadedDate = '';
      state.daily.changeSeq = 0;
    }
    function shiftPeriod(delta, confirmed) {
      if (!confirmed && (state.planner.dirty || dailyNeedsLeaveConfirm())) {
        confirmLeaveUnsaved('期間を移動').then(function(ok) { if (ok) { shiftPeriod(delta, true); syncCalendarControl(); } });
        return;
      }
      discardDailyDraftForPlannerNavigation();
      if (state.planner.type === 'month') {
        const parts = state.planner.key.split('-').map(Number);
        state.planner.key = periodForToday('month');
        const date = new Date(parts[0], parts[1] - 1 + delta, 1);
        state.planner.key = date.getFullYear() + '-' + pad2(date.getMonth() + 1);
      } else {
        const monday = mondayForWeek(state.planner.key);
        monday.setUTCDate(monday.getUTCDate() + delta * 7);
        state.planner.key = isoWeek(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
      }
      document.getElementById('periodInput').value = state.planner.key;
      prepareWeekNavigationMotion(state.planner.key);
      loadPlanner();
    }
    function presentWeekSnapshot(snapshot, options) {
      options = options || {};
      if (!snapshot || !snapshot.summary) return;
      state.planner.summary = snapshot.summary;
      // この週のカレンダーを先に読み込み済みなら、最初の描画から使う（後で入れて描き直すと、切り替えのたびに描画が増える）。
      const cachedCapacity = state.calendarCache[state.planner.type + ':' + state.planner.key];
      if (cachedCapacity && !snapshot.summary.capacity) { snapshot.summary.capacity = cachedCapacity; dropCalendarAutoActualsFromPlanner(); }
      state.planner.dirty = false;
      state.planner.changeSeq = 0;
      const workspaceKey = state.planner.type === 'week' ? weekWorkspaceCacheKey(state.planner.key) : '';
      if (workspaceKey) state.calendarCache[workspaceKey] = snapshot.summary;
      state.planner.paintedDigest = navigationDigest(snapshot.summary) + ':' + navigationDigest(snapshot.overlay && snapshot.overlay.items);
      renderPlanner(snapshot.overlay ? { items: snapshot.overlay.items, subtasks: snapshot.overlay.subtasks } : null);
      startPlannerCapacityLoad();
      if (options.resetHistory) resetEditHistory();
    }
    function plannerRefreshIsHeld() {
      const dialog = document.getElementById('planDialog');
      if (appDialogIsOpen(dialog)) return true;
      const menu = document.getElementById('planContextMenu');
      if (menu && menu.open) return true;
      return navigationViewHoldsFocus('planningView');
    }
    async function loadPlannerBlocking(type, key, token, force) {
      try {
        const workspaceKey = type === 'week' ? weekWorkspaceCacheKey(key) : '';
        const cachedWorkspace = !force && workspaceKey ? state.calendarCache[workspaceKey] : null;
        const summary = cachedWorkspace || await gas('loadPlanningWorkspace', type, key);
        if (state.nav.planner !== token || state.planner.type !== type || state.planner.key !== key) return;
        if (workspaceKey) state.calendarCache[workspaceKey] = summary;
        state.planner.summary = summary;
        state.planner.dirty = false;
        state.planner.changeSeq = 0;
        let overlay = null;
        if (type === 'week') {
          const baseItems = plannerItemsFromSummaryRows(summary.rows);
          try {
            overlay = await ensureWeekContinuationOverlay(key, baseItems, summary.subtasks || [], summary.range);
          } catch (_) {}
        }
        if (state.nav.planner !== token || state.planner.type !== type || state.planner.key !== key) return;
        rememberWeekSnapshot(type, key, summary, { overlay: overlay });
        state.planner.summary = summary;
        renderPlanner(overlay ? { items: overlay.items, subtasks: overlay.subtasks } : null);
        startPlannerCapacityLoad();
        resetEditHistory();
      } catch (error) { toast('予定の読み込みに失敗しました: ' + error.message, 'error'); }
    }
    async function refreshPlannerFromServer(type, key, token) {
      const summary = await gas('loadPlanningWorkspace', type, key);
      if (state.nav.planner !== token) return;
      const workspaceKey = type === 'week' ? weekWorkspaceCacheKey(key) : '';
      if (workspaceKey) state.calendarCache[workspaceKey] = summary;
      let overlay = null;
      if (type === 'week') {
        const baseItems = plannerItemsFromSummaryRows(summary.rows);
        try {
          overlay = await ensureWeekContinuationOverlay(key, baseItems, summary.subtasks || [], summary.range);
        } catch (_) {}
      }
      if (state.nav.planner !== token) return;
      rememberWeekSnapshot(type, key, summary, { overlay: overlay });
      const samePlace = state.planner.type === type && state.planner.key === key;
      if (!navigationRefreshIsCurrent(token, state.nav.planner, samePlace, state.planner.dirty || state.daily.dirty)) return;
      if (plannerRefreshIsHeld()) return;
      const digest = navigationDigest(summary) + ':' + navigationDigest(overlay && overlay.items);
      if (digest === state.planner.paintedDigest) return;
      state.planner.summary = summary;
      state.planner.dirty = false;
      state.planner.changeSeq = 0;
      state.planner.paintedDigest = digest;
      renderPlanner(overlay ? { items: overlay.items, subtasks: overlay.subtasks } : null);
      startPlannerCapacityLoad();
    }
    async function prefetchWeekSnapshot(weekKey) {
      if (!isViewWeekKey(weekKey)) return;
      const snapId = 'week:' + weekKey;
      const startedAt = Date.now();
      const existing = state.weekSnapshot[snapId];
      if (existing && existing.summary) return;
      try {
        const summary = await loadWeekWorkspaceCached(weekKey);
        let overlay = null;
        try {
          const baseItems = plannerItemsFromSummaryRows(summary.rows);
          overlay = await ensureWeekContinuationOverlay(weekKey, baseItems, summary.subtasks || [], summary.range);
        } catch (_) {}
        const current = state.weekSnapshot[snapId];
        if (current && current.fetchedAt && current.fetchedAt >= startedAt) return;
        if (state.planner.type === 'week' && state.planner.key === weekKey && state.planner.dirty) return;
        rememberWeekSnapshot('week', weekKey, summary, { overlay: overlay });
      } catch (_) {}
    }
    async function loadPlanner(options) {
      options = options || {};
      const silent = !!options.silent;
      const type = state.planner.type;
      const key = state.planner.key;
      cancelPlannerAutoSave();
      if (!(await ensureAnnualStorageYear(Number(String(key || '').slice(0, 4))))) return;
      if (state.planner.type !== type || state.planner.key !== key) return loadPlanner(options);
      state.planner.focusedPlanId = '';
      const snapId = type + ':' + key;
      const mode = await runScreenLoad({
        hasSnapshot: function() {
          const snap = state.weekSnapshot[snapId];
          return !!(snap && snap.summary);
        },
        options: {
          force: !!options.force,
          refresh: options.refresh,
          recent: snapshotIsRecent(state.weekSnapshot[snapId] && state.weekSnapshot[snapId].fetchedAt)
        },
        silent: silent,
        isBusy: function() { return state.planner.busy && state.planner.loadingKey === snapId; },
        markBusy: function(busy) {
          if (busy) {
            state.planner.busy = true;
            state.planner.loadingKey = snapId;
            return;
          }
          if (state.planner.loadingKey === snapId) {
            state.planner.busy = false;
            state.planner.loadingKey = '';
          }
        },
        showBusy: function() { showBusy('読み込んでいます…'); },
        hideBusy: hideBusy,
        paintCached: function() { presentWeekSnapshot(state.weekSnapshot[snapId], { resetHistory: true }); },
        beginRefresh: function() { return ++state.nav.planner; },
        refresh: function(token) { return refreshPlannerFromServer(type, key, token); },
        onRefreshError: function(error) {
          const snap = state.weekSnapshot[snapId];
          if (!(snap && snap.summary)) toast('予定の読み込みに失敗しました: ' + error.message, 'error');
        },
        loadBlocking: function() { return loadPlannerBlocking(type, key, ++state.nav.planner, !!options.force); }
      });
      if (mode === 'busy') return;
      if (state.project.issueProjectId && state.planner.type === type && state.planner.key === key) {
        const projectIdValue = state.project.issueProjectId;
        state.project.issueProjectId = '';
        syncPlanDialogProjects(projectIdValue);
        openPlanDialog({ projectId: projectIdValue });
      }
    }

    function fallbackCapacityForRange(range) {
      const startYmd = range && range.startYmd || ymd(new Date());
      const start = parseYmd(startYmd);
      const days = [];
      for (let index = 0; index < 60; index++) {
        const date = new Date(start.getTime());
        date.setDate(date.getDate() + index);
        const standard = standardHoursForDate(date);
        days.push({ date: ymd(date), baseHours: standard, meetingHours: 0, availableHours: standard, eventCount: 0, events: [] });
      }
      return { baseHours: workdayDefaultHours(), startYmd: startYmd, days: days, fallback: true };
    }
    function fallbackPlannerCapacity() {
      const range = state.planner.summary && state.planner.summary.range;
      return fallbackCapacityForRange(range);
    }

    function timeoutAfter(milliseconds, message) {
      return new Promise(function(_, reject) { setTimeout(function() { reject(new Error(message)); }, milliseconds); });
    }

    function calendarExclusions() {
      try { return JSON.parse(localStorage.getItem(CALENDAR_EXCLUSIONS_KEY) || '{}') || {}; }
      catch (_) { return {}; }
    }

    function uniqueKeys(values) {
      return (values || []).filter(function(key, index, list) { return key && list.indexOf(key) === index; });
    }

    function activeCalendarWeekKey() {
      if (state.view === 'daily' && state.daily && state.daily.date) return dailyWeekKey(state.daily.date);
      if (state.planner && state.planner.type === 'week') return state.planner.key || '';
      return '';
    }

    function excludedCalendarKeys(periodKey) {
      const target = periodKey || activeCalendarWeekKey();
      let values = (calendarExclusions().all || []).slice();
      if (state.planner.summary && (!target || state.planner.key === target)) {
        values = values.concat(state.planner.summary.calendarExclusions || []);
      }
      if (state.daily.weekSummary && (!target || state.daily.weekKey === target)) {
        values = values.concat(state.daily.weekSummary.calendarExclusions || []);
      }
      return uniqueKeys(values);
    }

    function importedCalendarKeys() {
      return uniqueKeys(plannerItems().map(function(item) { return item.calendarKey; }));
    }
    // 週の表示（前後の週の列を含む）に使う、取り込み済み・実施しない予定のキー。
    // 今開いている週の予定だけを見ると、週を切り替えた直後や前後の週の列で、点線の表示が塗りつぶしになってしまうため、
    // 読み込み済みのすべての週のデータから集める。
    function knownWeekSummaries() {
      const list = [];
      Object.keys(state.weekSnapshot || {}).forEach(function(key) {
        const snapshot = state.weekSnapshot[key];
        if (snapshot && snapshot.summary) list.push(snapshot.summary);
      });
      const adjacent = typeof adjacentCalendarPeriods !== 'undefined' && adjacentCalendarPeriods.week ? adjacentCalendarPeriods.week.snapshots || {} : {};
      Object.keys(adjacent).forEach(function(key) { if (adjacent[key]) list.push(adjacent[key]); });
      if (state.planner.summary) list.push(state.planner.summary);
      return list;
    }
    function knownImportedCalendarKeys() {
      let keys = importedCalendarKeys();
      knownWeekSummaries().forEach(function(summary) {
        keys = keys.concat((summary.rows || []).map(function(row) { return row && row.calendarKey; }));
        (summary.items || []).forEach(function(item) { keys.push(item && item.calendarKey); });
      });
      return uniqueKeys(keys.filter(Boolean));
    }
    function knownExcludedCalendarKeys() {
      let keys = excludedCalendarKeys();
      knownWeekSummaries().forEach(function(summary) { keys = keys.concat(summary.calendarExclusions || []); });
      return uniqueKeys(keys.filter(Boolean));
    }

    function persistCalendarExclusions(keys, periodKey) {
      const values = uniqueKeys(keys);
      try { localStorage.setItem(CALENDAR_EXCLUSIONS_KEY, JSON.stringify({ all: values })); } catch (_) {}
      const target = periodKey || activeCalendarWeekKey();
      if (state.planner.summary && (!target || state.planner.key === target)) state.planner.summary.calendarExclusions = values.slice();
      if (state.daily.weekSummary && (!target || state.daily.weekKey === target)) state.daily.weekSummary.calendarExclusions = values.slice();
    }

    function excludeCalendarPlan(periodKey, eventKey) {
      if (!eventKey) return;
      persistCalendarExclusions(excludedCalendarKeys(periodKey).concat([eventKey]), periodKey);
    }

    function restoreCalendarPlan(eventKey, periodKey) {
      if (!eventKey) return;
      persistCalendarExclusions(excludedCalendarKeys(periodKey).filter(function(key) { return key !== eventKey; }), periodKey);
    }

    function removeCalendarPlanImport(eventKey) {
      if (!eventKey) return false;
      const items = plannerItems().filter(function(item) { return item.calendarKey === eventKey; });
      if (!items.length) return false;
      items.forEach(function(item) { removePlannerSubtasksForParent(item.name, item.id); });
      state.planner.items = plannerItems().filter(function(item) { return item.calendarKey !== eventKey; });
      return true;
    }

    function calendarEventKey(event, dateValue, index) {
      const calendarId = String((event && event.calendarId) || '');
      const base = String((event && event.id) || (event && event.title) || '') + ':' + String(dateValue || '') + ':' + ((event && event.startTime) || 'all') + ':' + index;
      if (!calendarId || calendarId === 'primary') return base;
      return calendarId + ':' + base;
    }

    function calendarIdIsSelected(selectedIds, calendar) {
      const ids = selectedIds || [];
      if (calendar && ids.indexOf(calendar.id) >= 0) return true;
      return !!(calendar && calendar.primary && ids.indexOf('primary') >= 0);
    }

    function calendarSourceLabel() {
      const settings = state.planner.calendarSettings;
      if (!settings) return 'カレンダー一覧を読み込んでいます…';
      const count = (settings.calendars || []).filter(function(calendar) {
        return calendarIdIsSelected(settings.selectedIds, calendar);
      }).length;
      return count ? '読み込むカレンダー: ' + count + '件' : 'メインカレンダーを使用';
    }

    function syncCalendarSourceButton() {
      const summary = document.getElementById('calendarSelectionSummary');
      if (summary) summary.textContent = calendarSourceLabel();
    }

    function renderCalendarSettings(settings) {
      state.planner.calendarSettings = settings || { calendars: [], selectedIds: ['primary'] };
      const list = document.getElementById('calendarSourceList');
      const calendars = state.planner.calendarSettings.calendars || [];
      if (!calendars.length) {
        list.innerHTML = emptyStateHtml('読み込めるカレンダーがありません', 'Googleカレンダーの権限を確認してください。');
      } else {
        list.innerHTML = calendars.map(function(calendar) {
          const checked = calendarIdIsSelected(state.planner.calendarSettings.selectedIds, calendar) ? ' checked' : '';
          return '<label class="candidate"><md-checkbox touch-target="wrapper" value="' + escapeHtml(calendar.id) + '"' + checked + '></md-checkbox><span><strong>' + escapeHtml(calendar.name) + '</strong><small>' + (calendar.primary ? 'メインカレンダー' : escapeHtml(calendar.id)) + '</small></span></label>';
        }).join('');
      }
      state.appSettings.calendarLoaded = true;
      syncCalendarSourceButton();
    }

    async function loadCalendarSourceSettings() {
      try {
        renderCalendarSettings(await gas('getPlanningCalendarSettings'));
      } catch (error) {
        renderCalendarSettings({ calendars: [], selectedIds: ['primary'] });
      }
    }

    async function ensureCalendarSettingsLoaded(force) {
      if (state.appSettings.calendarLoaded && !force) return;
      const button = document.getElementById('reloadPlanningCalendars');
      if (button) button.disabled = true;
      const list = document.getElementById('calendarSourceList');
      const selectedBefore = force && list && list.querySelector('md-checkbox')
        ? Array.from(list.querySelectorAll('md-checkbox')).filter(function(input) { return input.checked; }).map(function(input) { return input.value; })
        : null;
      if (list) list.innerHTML = emptyStateHtml('カレンダー一覧を読み込んでいます…');
      try {
        const settings = await gas('getPlanningCalendarSettings');
        if (selectedBefore) {
          settings.selectedIds = selectedBefore.filter(function(id) {
            return (settings.calendars || []).some(function(calendar) { return calendar.id === id; });
          });
        }
        renderCalendarSettings(settings);
      } catch (error) {
        state.appSettings.calendarLoaded = false;
        if (list) list.innerHTML = emptyStateHtml('カレンダー一覧を取得できませんでした', error.message);
        toast('カレンダー一覧を取得できませんでした: ' + error.message, 'error');
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function saveCalendarSettings() {
      const selectedIds = Array.from(document.querySelectorAll('#calendarSourceList md-checkbox')).filter(function(input) { return input.checked; }).map(function(input) {
        return input.value;
      });
      const button = document.getElementById('saveCalendarSettings');
      button.disabled = true;
      showBusy('カレンダー設定を保存しています…');
      try {
        renderCalendarSettings(await gas('savePlanningCalendarSettings', { calendarIds: selectedIds }));
        clearCalendarCapacityCache();
        state.weekForecastCache = {};
        syncCalendarSourceButton();
        if (state.view === 'planning') await startPlannerCapacityLoad(true);
        else if (state.view === 'daily') {
          delete state.calendarCache['day:' + state.daily.date];
          await loadDayAgenda();
        }
        toast('読み込むカレンダーを更新しました', 'success');
      } catch (error) {
        toast('カレンダーの保存に失敗しました: ' + error.message, 'error');
      } finally {
        button.disabled = false;
        hideBusy();
      }
    }

    function calendarEventTimeMinutes(value) {
      const parts = String(value == null ? '' : value).split(':');
      return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
    }

    function calendarEventHours(event) {
      if (!event || event.allDay) return 0;
      if (event.durationHours != null && event.durationHours !== '') {
        const stored = Number(event.durationHours);
        if (isFinite(stored)) return Math.max(0, roundHours(stored));
      }
      if (!event.endTime) return 0;
      let duration = calendarEventTimeMinutes(event.endTime) - calendarEventTimeMinutes(event.startTime);
      if (duration < 0) duration += 24 * 60;
      return Math.max(0, roundHours(duration / 60));
    }

    function calendarEventWorkOverlapHours(event) {
      if (!event || event.allDay || event.blocksTime === false) return 0;
      if (event.meetingHours != null && event.meetingHours !== '') {
        const stored = Number(event.meetingHours);
        if (isFinite(stored)) return Math.max(0, roundHours(stored));
      }
      const overlapStart = Math.max(calendarEventTimeMinutes(event.startTime), 9 * 60);
      const overlapEnd = Math.min(calendarEventTimeMinutes(event.endTime), 18 * 60);
      return Math.max(0, roundHours((overlapEnd - overlapStart) / 60));
    }

    function calendarPlanName(event, dateValue) {
      const time = event && event.allDay ? '終日' : String((event && event.startTime) || '');
      const title = String((event && event.title) || '（タイトルなし）');
      return (title + '（' + shortDateLabel(dateValue) + (time ? ' ' + time : '') + '）').slice(0, 200);
    }

    function buildDailyCalendarTasks(date, days, importedPlans, excludedKeys) {
      const target = String(date || '').trim();
      const excluded = {};
      uniqueKeys(excludedKeys).forEach(function(key) { excluded[key] = true; });
      const importedByKey = {};
      (importedPlans || []).forEach(function(plan) {
        const key = String((plan && plan.calendarKey) || '').trim();
        if (!key) return;
        importedByKey[key] = plan;
      });
      const day = (days || []).find(function(entry) { return entry && entry.date === target; }) || null;
      const tasks = [];
      const seen = {};
      function addTask(task) {
        const name = String((task && task.name) || '').trim();
        if (!name || seen[name]) return;
        seen[name] = true;
        tasks.push({
          name: name,
          estimate: roundHours(task.estimate),
          calendarKey: task.calendarKey || '',
          imported: !!task.imported,
          planId: task.planId || ''
        });
      }
      ((day && day.events) || []).forEach(function(event, index) {
        const key = calendarEventKey(event, target, index);
        if (excluded[key]) return;
        if (event && event.allDay) return;
        const hours = calendarEventHours(event);
        if (!(hours > 0)) return;
        const imported = importedByKey[key];
        let name = imported
          ? String(imported.name || '').trim()
          : String((event && event.title) || 'カレンダー予定').trim();
        if (!name) return;
        if (!imported && seen[name] && event && event.startTime) {
          name = (name + '（' + event.startTime + '）').slice(0, 200);
        }
        addTask({
          name: name,
          estimate: imported && Number(imported.planned) > 0 ? imported.planned : hours,
          calendarKey: key,
          imported: !!imported,
          planId: imported && imported.id || ''
        });
      });
      (importedPlans || []).forEach(function(plan) {
        const key = String((plan && plan.calendarKey) || '').trim();
        if (!key || excluded[key]) return;
        if (String((plan && plan.startDate) || '') !== target) return;
        addTask({
          name: plan.name,
          estimate: plan.planned,
          calendarKey: key,
          imported: true,
          planId: plan.id || ''
        });
      });
      return tasks;
    }

    function importedCalendarPlansForDaily(date) {
      const weekKey = isoWeek(parseYmd(date));
      const plans = [];
      const seen = {};
      function add(plan) {
        const key = String((plan && plan.calendarKey) || '').trim();
        const name = String((plan && plan.name) || '').trim();
        if (!key || !name || seen[key]) return;
        seen[key] = true;
        plans.push({
          calendarKey: key,
          name: name,
          planned: roundHours(plan.planned),
          startDate: plan.startDate || '',
          id: plan.id || ''
        });
      }
      if (state.planner.type === 'week' && state.planner.key === weekKey) {
        plannerItems().forEach(function(item) {
          add({ calendarKey: item.calendarKey, name: item.name, planned: item.planned, startDate: item.startDate, id: item.id });
        });
      }
      Object.keys(state.weeklyPlanMeta || {}).forEach(function(name) {
        const meta = state.weeklyPlanMeta[name] || {};
        add({ calendarKey: meta.calendarKey, name: name, planned: meta.plannedHours || meta.prevC, startDate: meta.startDate, id: meta.planId });
      });
      const forecast = state.weekForecastCache[weekKey] || peekWeekForecast(date);
      (forecast && forecast.rows || []).forEach(function(row) {
        add({ calendarKey: row.calendarKey, name: row.name, planned: row.plannedHours, startDate: row.startDate, id: row.id });
      });
      return plans;
    }

    function dailyCalendarTasksForDate(date) {
      const target = date || state.daily.date;
      return buildDailyCalendarTasks(target, capacityDaysForDaily(target), importedCalendarPlansForDaily(target), excludedCalendarKeys(dailyWeekKey(target)));
    }

    function dailyCalendarTaskForRow(row, tasks) {
      if (!row) return null;
      const marked = row.type === 'calendar' || row.type === 'calendar-imported' || !!row.calendarKey;
      const key = String(row.calendarKey || '').trim();
      const planId = String(row.planId || '').trim();
      const name = String(row.name || '').trim();
      // キー → 予定ID → 名前の順で探す。キーを持つ行は名前を変えられるので、名前では寄せない。
      const list = tasks || [];
      const found = (key && list.find(function(task) { return task.calendarKey === key; }))
        || (planId && list.find(function(task) { return task.planId === planId; }))
        || (!key && name && list.find(function(task) { return task.name === name; }))
        || null;
      if (found && (marked || found.imported)) return found;
      return marked && key ? { calendarKey: key, name: name, planId: planId } : null;
    }

    function linkDailyCalendarRows(date) {
      const tasks = dailyCalendarTasksForDate(date);
      state.daily.rows.forEach(function(row) {
        const task = dailyCalendarTaskForRow(row, tasks);
        if (!task || !task.calendarKey || dailyRowIsInterrupt(row)) return;
        row.calendarKey = task.calendarKey;
        if (task.imported || row.type === 'calendar-imported') row.type = 'calendar-imported';
        else row.type = 'calendar';
        if (!row.planId && task.planId) row.planId = task.planId;
      });
    }

    function rememberDailyCalendarRows(date) {
      const tasks = dailyCalendarTasksForDate(date);
      const seen = {};
      state.daily.calendarRowsAtLoad = state.daily.rows.map(function(row) {
        const task = dailyCalendarTaskForRow(row, tasks);
        if (!task || !task.calendarKey || seen[task.calendarKey]) return null;
        seen[task.calendarKey] = true;
        return { calendarKey: task.calendarKey, name: task.name || row.name, planId: task.planId || row.planId || '' };
      }).filter(Boolean);
      return state.daily.calendarRowsAtLoad;
    }

    function removedDailyCalendarRows(date) {
      const tasks = dailyCalendarTasksForDate(date);
      const present = {};
      state.daily.rows.forEach(function(row) {
        const task = dailyCalendarTaskForRow(row, tasks);
        if (task && task.calendarKey) present[task.calendarKey] = true;
      });
      return (state.daily.calendarRowsAtLoad || []).filter(function(task) {
        return !present[task.calendarKey];
      });
    }

    function capacityDaysForDaily(date) {
      const forecast = peekWeekForecast(date);
      if (forecast && forecast.days && forecast.days.length) return forecast.days;
      const cached = state.calendarCache[weekCapacityCacheKey(isoWeek(parseYmd(date)))];
      return (cached && cached.days) || [];
    }

    function rememberDailyCalendarAutoNames(date) {
      const names = {};
      dailyCalendarTasksForDate(date).forEach(function(task) {
        if (task.name) names[task.name] = true;
      });
      state.daily.calendarAutoNames = names;
      return names;
    }

    function applyDailyCalendarTasks(date) {
      rememberDailyCalendarAutoNames(date);
      if (state.daily.mode === 'empty') return 0;
      const tasks = dailyCalendarTasksForDate(date);
      const existing = {};
      const existingCalendarKeys = {};
      // 編集中に削除した予定は、再同期しても復活させない。
      const removedKeys = {};
      removedDailyCalendarRows(date).forEach(function(task) { removedKeys[task.calendarKey] = true; });
      state.daily.rows.forEach(function(row) {
        const name = String(row.name || '').trim();
        if (name) existing[name] = true;
        const calendarKey = String(row.calendarKey || '').trim();
        if (calendarKey) existingCalendarKeys[calendarKey] = true;
      });
      let added = 0;
      tasks.forEach(function(task) {
        if (removedKeys[task.calendarKey]) return;
        if (!task.name || existing[task.name] || (task.calendarKey && existingCalendarKeys[task.calendarKey])) return;
        existing[task.name] = true;
        if (task.calendarKey) existingCalendarKeys[task.calendarKey] = true;
        state.daily.rows.push({
          id: uid('row-'),
          planId: task.planId || '',
          projectId: typeof defaultAssignedProjectId === 'function' ? defaultAssignedProjectId() : '',
          calendarKey: task.calendarKey || '',
          name: task.name,
          today: 0,
          previous: 0,
          estimate: roundHours(task.estimate),
          status: '',
          type: task.imported ? 'calendar-imported' : 'calendar'
        });
        added++;
      });
      return added;
    }

    function syncRefreshedDailyCalendarTasks(date) {
      if (state.daily.date !== date || state.daily.loadedDate !== date || state.daily.mode === 'empty') return 0;
      // 入力中の値を取り込んでから、足りない行だけ追加する。
      syncDailyFromDom();
      const added = applyDailyCalendarTasks(date);
      linkDailyCalendarRows(date);
      if (!added) return 0;
      const baseline = state.daily.calendarRowsAtLoad || [];
      const known = new Set(baseline.map(function(task) { return task.calendarKey; }));
      dailyCalendarTasksForDate(date).forEach(function(task) {
        if (known.has(task.calendarKey)) return;
        if (!state.daily.rows.some(function(row) { return row.calendarKey === task.calendarKey; })) return;
        baseline.push({ calendarKey: task.calendarKey, name: task.name, planId: task.planId || '' });
        known.add(task.calendarKey);
      });
      state.daily.calendarRowsAtLoad = baseline;
      renderDaily();
      markDailyDirty({ auto: true });
      return added;
    }

    function meetingEventsOnDay(day, exclusions) {
      const skip = {};
      uniqueKeys(exclusions || []).forEach(function(key) { skip[key] = true; });
      return (day && day.events || []).filter(function(event, index) {
        return !skip[calendarEventKey(event, day.date, index)];
      });
    }
    function meetingHoursOnDay(day, exclusions) {
      return mergeCalendarMeetingHours(meetingEventsOnDay(day, exclusions));
    }
    function meetingHoursInDays(days, exclusions) {
      return roundHours((days || []).reduce(function(total, day) {
        return total + meetingHoursOnDay(day, exclusions);
      }, 0));
    }
    function weekMeetingSummary(days, exclusions) {
      const source = days || [];
      let count = 0;
      let workHours = 0;
      source.forEach(function(day) {
        workHours += roundHours(day.baseHours);
        meetingEventsOnDay(day, exclusions).forEach(function(event) {
          if (calendarEventWorkOverlapHours(event) > 0) count++;
        });
      });
      const hoursTotal = meetingHoursInDays(source, exclusions);
      return {
        hours: hoursTotal,
        count: count,
        workHours: roundHours(workHours)
      };
    }
    function calendarEventWorkInterval(event) {
      if (!event || event.allDay || event.blocksTime === false) return null;
      if (event.startTime && event.endTime) {
        const startRaw = calendarEventTimeMinutes(event.startTime);
        let endRaw = calendarEventTimeMinutes(event.endTime);
        if (endRaw <= startRaw) endRaw += 24 * 60;
        const start = Math.max(startRaw, 9 * 60);
        const end = Math.min(endRaw, 18 * 60);
        return end > start ? [start, end] : null;
      }
      const hours = calendarEventWorkOverlapHours(event);
      if (!(hours > 0)) return null;
      const start = Math.max(calendarEventTimeMinutes(event.startTime), 9 * 60);
      return [start, start + Math.round(hours * 60)];
    }
    function mergeCalendarMeetingHours(events) {
      const intervals = [];
      (events || []).forEach(function(event) {
        const interval = calendarEventWorkInterval(event);
        if (interval) intervals.push(interval);
      });
      intervals.sort(function(left, right) { return left[0] - right[0]; });
      let total = 0;
      let mergedStart = null;
      let mergedEnd = null;
      intervals.forEach(function(interval) {
        if (mergedStart == null) { mergedStart = interval[0]; mergedEnd = interval[1]; return; }
        if (interval[0] <= mergedEnd) { mergedEnd = Math.max(mergedEnd, interval[1]); return; }
        total += mergedEnd - mergedStart;
        mergedStart = interval[0];
        mergedEnd = interval[1];
      });
      if (mergedStart != null) total += mergedEnd - mergedStart;
      return roundHours(total / 60);
    }

    function adjustCapacityDaysForCalendarPlans(days, exclusions, importedKeys) {
      const skip = {};
      uniqueKeys((exclusions || []).concat(importedKeys || [])).forEach(function(key) { skip[key] = true; });
      return (days || []).map(function(day) {
        const remainingEvents = (day.events || []).filter(function(event, index) {
          return !skip[calendarEventKey(event, day.date, index)];
        });
        const meetingHours = mergeCalendarMeetingHours(remainingEvents);
        return Object.assign({}, day, {
          meetingHours: meetingHours,
          availableHours: Math.max(0, roundHours((Number(day.baseHours) || 0) - meetingHours)),
          eventCount: remainingEvents.filter(function(event) { return calendarEventWorkOverlapHours(event) > 0; }).length
        });
      });
    }

    function applyWorkCapacityToDay(day, hoursValue, reasonValue) {
      if (!day) return null;
      const hours = Math.max(0, roundHours(hoursValue));
      const meetingHours = hours > 0 ? mergeCalendarMeetingHours(day.events || []) : 0;
      day.baseHours = hours;
      day.capacityReason = String(reasonValue || '');
      day.capacityOverridden = true;
      day.meetingHours = meetingHours;
      day.availableHours = Math.max(0, roundHours(hours - meetingHours));
      return day;
    }

    function applyWorkCapacitySetting(saved) {
      if (!saved || !saved.date || !state.planner.summary || !state.planner.summary.capacity) return;
      const days = state.planner.summary.capacity.days || [];
      const day = days.find(function(entry) { return entry.date === saved.date; });
      if (!day) return;
      applyWorkCapacityToDay(day, saved.hours, saved.reason);
      const cacheKey = state.planner.type + ':' + state.planner.key;
      if (state.calendarCache[cacheKey]) state.calendarCache[cacheKey] = state.planner.summary.capacity;
      delete state.weekForecastCache[state.planner.key];
    }

    function plannerCapacityDays() {
      const days = (state.planner.summary && state.planner.summary.capacity && state.planner.summary.capacity.days) || [];
      return adjustCapacityDaysForCalendarPlans(days, excludedCalendarKeys(), importedCalendarKeys());
    }

    function unimportedCalendarTitlesFromDays(days) {
      const imported = {};
      importedCalendarKeys().forEach(function(key) { imported[key] = true; });
      const titles = {};
      (days || []).forEach(function(day) {
        (day.events || []).forEach(function(event, index) {
          const key = calendarEventKey(event, day.date, index);
          if (imported[key] || (event && event.allDay)) return;
          const title = String((event && event.title) || '').trim();
          if (title) titles[title] = true;
        });
      });
      return titles;
    }

    function dropCalendarAutoActualsFromPlanner() {
      const days = (state.planner.summary && state.planner.summary.capacity && state.planner.summary.capacity.days) || [];
      const titles = unimportedCalendarTitlesFromDays(days);
      const interruptNames = {};
      const byDate = (state.planner.summary && state.planner.summary.calendarInterruptsByDate) || {};
      Object.keys(byDate).forEach(function(date) {
        (byDate[date] || []).forEach(function(entry) {
          const name = String(entry && entry.name || '').trim();
          if (name) interruptNames[name] = true;
        });
      });
      state.planner.items = plannerItems().filter(function(item) {
        if (item.hasPlan || item.calendarKey) return true;
        const name = String(item.name || '').trim();
        if (interruptNames[name]) return true;
        return !titles[name];
      });
    }

    function plannerItems() {
      return state.planner.items || (state.planner.items = []);
    }
    // 予定の並び順は週ごとではなく、予定ごとの「順位」（z-index のような値）で全体共通に決める。
    // 値は 1024 刻みで振り、並び替えでは動かした予定だけに前後の中間の値を付ける。
    const PLAN_PRIORITY_STEP = 1024;
    function planPriorityValue(item) {
      const value = item && item.priority != null && item.priority !== '' ? Number(item.priority) : NaN;
      return isFinite(value) && value >= 0 ? value : null;
    }
    function sortByPlanPriority(items) {
      return (items || []).map(function(item, index) { return { item: item, index: index }; }).sort(function(left, right) {
        const a = planPriorityValue(left.item);
        const b = planPriorityValue(right.item);
        if (a !== b) return a == null ? 1 : b == null ? -1 : a - b;
        const originA = String(left.item && left.item.originWeek || '');
        const originB = String(right.item && right.item.originWeek || '');
        return originA < originB ? -1 : originA > originB ? 1 : left.index - right.index;
      }).map(function(entry) { return entry.item; });
    }
    // 並べたい順の予定に、順位を付け直す。今の順位のままで並びを保てる予定（順位が増えていく最長の並び）は
    // そのまま残し、ほかの予定だけに前後の順位の間の値を付ける。ほかの週の並びをなるべく変えないため。
    function assignPlanPriorities(ordered) {
      const values = ordered.map(planPriorityValue);
      const length = values.map(function() { return 0; });
      const previous = values.map(function() { return -1; });
      let best = -1;
      values.forEach(function(value, index) {
        if (value == null) return;
        length[index] = 1;
        for (let before = 0; before < index; before++) {
          if (values[before] != null && values[before] < value && length[before] + 1 > length[index]) {
            length[index] = length[before] + 1;
            previous[index] = before;
          }
        }
        if (best < 0 || length[index] > length[best]) best = index;
      });
      const keep = {};
      for (let index = best; index >= 0; index = previous[index]) keep[index] = true;
      for (let index = 0; index < ordered.length;) {
        if (keep[index]) { index++; continue; }
        let end = index;
        while (end < ordered.length && !keep[end]) end++;
        const count = end - index;
        const low = index > 0 ? planPriorityValue(ordered[index - 1]) : null;
        const high = end < ordered.length ? values[end] : null;
        const from = low != null ? low : high != null ? Math.max(-1, high - (count + 1) * PLAN_PRIORITY_STEP) : 0;
        const to = high != null ? high : from + (count + 1) * PLAN_PRIORITY_STEP;
        if (to - from <= count) {
          // 間が詰まって入らないときだけ、全体を振り直す。
          ordered.forEach(function(item, position) { item.priority = (position + 1) * PLAN_PRIORITY_STEP; });
          return;
        }
        for (let step = 1; step <= count; step++) ordered[index + step - 1].priority = Math.floor(from + (to - from) * step / (count + 1));
        index = end;
      }
    }
    // 新しい予定の順位。同じ名前の予定（毎週登録する予定など）があればその順位を引き継ぎ、なければ一番下。
    function nextPlanPriority(name) {
      const identity = planIdentityName(name);
      const known = plannerItems().concat(calendarAdjacentSnapshots('week', state.planner.key).flatMap(function(snapshot) {
        return plannerItemsFromSummaryRows(snapshot.rows);
      }));
      const same = known.find(function(item) { return item && item.hasPlan !== false && planIdentityName(item.name) === identity && planPriorityValue(item) != null; });
      if (same) return planPriorityValue(same);
      const max = known.reduce(function(top, item) {
        const value = item && item.hasPlan !== false ? planPriorityValue(item) : null;
        return value != null && value > top ? value : top;
      }, 0);
      return max + PLAN_PRIORITY_STEP;
    }
    // 週の画面に行として出る予定はすべて並べ替えの対象にする。
    // 工数がまだ0hの予定（Backlogから取り込んだ直後など）も行は出るので、外すと並べ替えが保存されない。
    function plannerPriorityItems() {
      return sortByPlanPriority(plannerItems().filter(function(item) {
        return item && item.hasPlan !== false;
      }));
    }
    function rowToPlannerItem(row) {
      const carryWeek = row.carryWeek || parsePlanCarryWeek(row.note);
      return {
        id: row.planId || uid('plan-'),
        name: row.aggregationKey,
        planned: roundHours(row.plannedHours),
        actual: roundHours(row.actualHours),
        actualByDate: row.actualByDate || {},
        estimatedTotal: roundHours(row.plannedHours),
        hasPlan: !!row.hasPlan,
        planKind: row.planKind || (row.hasPlan ? 'initial' : 'unplanned'),
        initialPlanned: roundHours(row.initialPlannedHours == null ? row.plannedHours : row.initialPlannedHours),
        createdAt: row.createdAt || '',
        priority: row.hasPlan && row.priority !== '' && row.priority != null && isFinite(Number(row.priority)) ? Number(row.priority) : null,
        note: restPlanNote(row.note),
        startDate: row.startDate || parsePlanStartDate(row.note),
        endDate: row.endDate || '',
        undated: !!row.undated,
        dailyCap: roundHours(row.dailyCap == null ? parsePlanDailyCap(row.note) : row.dailyCap),
        dailyPlan: normalizePlanDailyPlan(row.dailyPlan || parsePlanDailyPlan(row.note)),
        carryWeek: carryWeek,
        originWeek: row.originWeek || (!carryWeek ? (row.periodKey || '') : ''),
        calendarKey: row.calendarKey || parsePlanCalendarKey(row.note),
        projectId: row.projectId || '',
        issueUrl: row.issueUrl || '',
        done: row.done == null ? parsePlanDone(row.note) : !!row.done,
        completionOverride: normalizePlanCompletionOverride(row.completionOverride == null ? parsePlanCompletionOverride(row.note) : row.completionOverride),
        progress: normalizePlanProgress(row.progress),
        dailyTracked: !!row.dailyTracked,
        dailyComplete: !!row.complete || !!row.dailyComplete
      };
    }
    function plannerItemsFromSummaryRows(rows) {
      return (rows || []).map(rowToPlannerItem).filter(function(item) {
        return item && !String(item.calendarKey || '').trim();
      });
    }
    function planSubtasksComplete(item, subtasks) {
      if (!item) return false;
      const tasks = (subtasks || (state.planner.summary || {}).subtasks || []).filter(function(task) {
        return planningTaskBelongsToPlan(task, item);
      });
      return tasks.length > 0 && tasks.every(function(task) { return task.status === 'done' || task.status === '完了'; });
    }
    function planCompletionIsDerived(item, subtasks) {
      return !!(item && ((completionSyncEnabled() && (item.dailyComplete || item.complete)) || planSubtasksComplete(item, subtasks)));
    }
    function planIsComplete(item, subtasks) {
      if (!item || item.completionOverride === false) return false;
      if (item.completionOverride === true || item.done) return true;
      if (completionSyncEnabled() && item.dailyTracked && !item.dailyComplete) return false;
      return !!planCompletionIsDerived(item, subtasks);
    }
    function planCompletionForSave(item, subtasks) {
      if (!item || item.completionOverride === false) return { done: false, completionOverride: false };
      if (planIsComplete(item, subtasks)) return { done: true, completionOverride: true };
      return { done: false, completionOverride: null };
    }
    function setPlanCompletion(item, completed, subtasks) {
      if (!item) return;
      const next = !!completed;
      item.done = next;
      item.completionOverride = next ? null : (planCompletionIsDerived(item, subtasks) ? false : null);
    }
    function normalizePlanProgress(value) {
      const raw = String(value == null ? '' : value).trim().toLowerCase();
      if (raw === 'doing' || raw === '進行中') return 'doing';
      if (raw === 'todo' || raw === '未着手') return 'todo';
      return '';
    }
    const PLAN_PROGRESS_LABELS = { todo: '未着手', doing: '進行中', done: '完了' };
    // 未着手・進行中は明示の選択がなければ実績の有無で決める。
    function planAutoProgress(item) {
      return item && roundHours(item.actual) > 0 ? 'doing' : 'todo';
    }
    function planProgressStatus(item, subtasks) {
      if (!item) return 'todo';
      if (planIsComplete(item, subtasks)) return 'done';
      return normalizePlanProgress(item.progress) || planAutoProgress(item);
    }
    function planProgressLabel(item, subtasks) {
      return PLAN_PROGRESS_LABELS[planProgressStatus(item, subtasks)];
    }
    function setPlanProgressStatus(item, status, subtasks) {
      if (!item) return;
      const next = PLAN_PROGRESS_LABELS[status] ? status : 'todo';
      setPlanCompletion(item, next === 'done', subtasks);
      if (next === 'done') return;
      // 自動判定と同じなら空欄にして、あとで実績が入ったときに進行中へ変わるようにする。
      item.progress = next === planAutoProgress(item) ? '' : next;
    }
    function togglePlanComplete(planId) {
      const item = plannerItems().find(function(entry) { return entry.id === planId; });
      if (!item) return;
      setPlanCompletion(item, !planIsComplete(item));
      markPlannerChanged();
      updatePlannerSummary();
    }

    async function loadPlannerCapacity(forceRefresh) {
      if (!state.planner.summary) return;
      const type = state.planner.type;
      const key = state.planner.key;
      const calendarCacheKey = type + ':' + key;
      const cached = state.calendarCache[calendarCacheKey];
      const fresh = calendarCacheIsFresh(calendarCacheKey);
      if (!forceRefresh && cached && fresh) {
        const changed = state.planner.summary.capacity !== cached;
        state.planner.summary.capacity = cached;
        dropCalendarAutoActualsFromPlanner();
        if (changed) scheduleCalendarTimelineRender('week');
        return;
      }
      if (!forceRefresh && cached) {
        state.planner.summary.capacity = cached;
        dropCalendarAutoActualsFromPlanner();
        scheduleCalendarTimelineRender('week');
      }
      const requestId = ++state.planner.capacityRequest;
      state.planner.capacityBusy = true;
      const refreshButton = document.getElementById('refreshPlannerCalendar');
      if (forceRefresh) {
        if (refreshButton) refreshButton.disabled = true;
        scheduleCalendarTimelineRender('week');
      }
      try {
        const fetchCapacity = function() {
          return Promise.race([
            gas('loadPlanningCalendarCapacity', type, key),
            timeoutAfter(12000, 'カレンダーの取得が12秒を超えました')
          ]);
        };
        let capacity;
        try { capacity = await fetchCapacity(); }
        catch (firstError) {
          // 一時的な遅れのことが多いので、同じ週を見ている間は1回だけ取り直す。
          if (state.planner.type !== type || state.planner.key !== key || requestId !== state.planner.capacityRequest) throw firstError;
          capacity = await fetchCapacity();
        }
        if (state.planner.type !== type || state.planner.key !== key || !state.planner.summary) return;
        state.planner.summary.capacity = capacity;
        rememberCalendarCapacity(calendarCacheKey, capacity);
        delete state.weekForecastCache[key];
        dropCalendarAutoActualsFromPlanner();
        scheduleCalendarTimelineRender('week');
        if (forceRefresh) toast('カレンダーを更新しました', 'success');
      } catch (error) {
        if (state.planner.type === type && state.planner.key === key) {
          if (cached) {
            state.planner.summary.capacity = cached;
            scheduleCalendarTimelineRender('week');
          } else {
            state.planner.summary.capacity = fallbackPlannerCapacity();
          }
          toast('カレンダーを取得できないため、平日8時間で仮計算しています: ' + error.message, 'error');
        }
      } finally {
        if (requestId === state.planner.capacityRequest) {
          state.planner.capacityBusy = false;
          if (refreshButton) refreshButton.disabled = false;
          scheduleCalendarTimelineRender('week');
        }
      }
    }
    function startPlannerCapacityLoad(forceRefresh) {
      const pending = loadPlannerCapacity(forceRefresh);
      state.planner.capacityPromise = pending;
      return pending;
    }
    function refreshVisibleCalendarIfStale(forceRefresh) {
      if (document.visibilityState !== 'visible') return;
      if (state.view === 'planning' && state.planner.summary && !state.planner.capacityBusy) {
        const cacheKey = state.planner.type + ':' + state.planner.key;
        if (forceRefresh) delete state.calendarFetchedAt[cacheKey];
        if (!calendarCacheIsFresh(cacheKey)) startPlannerCapacityLoad();
      }
      if (state.view === 'daily' && state.daily.date) {
        const weekKey = isoWeek(parseYmd(state.daily.date));
        if (forceRefresh) delete state.calendarFetchedAt[weekCapacityCacheKey(weekKey)];
        if (!calendarCacheIsFresh(weekCapacityCacheKey(weekKey))) loadDayAgenda();
      }
    }
    function refreshPlannerCalendar() {
      if (state.view !== 'planning') return toast('週間予定画面を開いてからカレンダーを再読み込みしてください');
      if (state.planner.capacityBusy) return;
      delete state.weekForecastCache[state.planner.key];
      return startPlannerCapacityLoad(true);
    }

    function lastDate(range) {
      if (!range) return '';
      const date = new Date(range.endExclusiveYmd + 'T00:00:00Z');
      date.setUTCDate(date.getUTCDate() - 1);
      return date.toISOString().slice(0,10);
    }
    function rangeLabel(range) { return range ? range.startYmd.replace(/-/g,'.') + ' — ' + lastDate(range).replace(/-/g,'.') : ''; }
    function compactDateLabel(date) {
      const label = (date.getMonth() + 1) + '月' + date.getDate() + '日';
      return date.getFullYear() === new Date().getFullYear() ? label : date.getFullYear() + '年' + label;
    }
    function compactRangeFromDates(start, end) {
      if (start.getFullYear() !== end.getFullYear()) {
        return start.getFullYear() + '年' + (start.getMonth() + 1) + '月' + start.getDate() + '日 – ' + end.getFullYear() + '年' + (end.getMonth() + 1) + '月' + end.getDate() + '日';
      }
      const yearPrefix = start.getFullYear() !== new Date().getFullYear() ? start.getFullYear() + '年' : '';
      if (start.getMonth() !== end.getMonth()) {
        return yearPrefix + (start.getMonth() + 1) + '月' + start.getDate() + '日 – ' + (end.getMonth() + 1) + '月' + end.getDate() + '日';
      }
      return yearPrefix + (start.getMonth() + 1) + '月' + start.getDate() + '日 – ' + end.getDate() + '日';
    }
    function compactRangeLabel(range) {
      if (!range || !range.startYmd) return '';
      return compactRangeFromDates(parseYmd(range.startYmd), parseYmd(lastDate(range)));
    }
