    function shiftCalendarPeriod(delta, options) {
      if (state.view === 'projects') { changeProjectMonth(delta); return; }
      if (state.calendarMode === 'day') {
        if (!(options && options.confirmed) && dailyNeedsLeaveConfirm()) {
          confirmLeaveUnsaved('日付を移動').then(function(ok) { if (ok) shiftCalendarPeriod(delta, Object.assign({}, options, { confirmed: true })); });
          return;
        }
        const date = parseYmd(state.daily.date);
        date.setDate(date.getDate() + delta);
        state.daily.date = ymd(date);
        syncCalendarControl();
        renderTimer();
        loadDaily();
        return;
      }
      if (state.calendarMode === 'month') {
        state.month.key = shiftMonthKey(state.month.key, delta);
        syncCalendarControl();
        loadMonthGantt();
        return;
      }
      if (!(options && options.immediate) && scrollWeekToNeighbor(delta)) return;
      shiftPeriod(delta);
      syncCalendarControl();
    }
    // 前後の週はすでに同じ横スクロールの中にある。描き直さずに隣の週までなめらかに流し、
    // 止まったところで（settleCalendarTimeline が）表示中の週を切り替える。
    // 週の移動は、ISO週（W44 → W45 など、月曜〜日曜）の単位で、1週間がちょうど画面に収まる位置へスクロールする。
    // 流れている途中でもう一度押したときは、行き先の週を起点に、さらに1週ずつ進める（連打しても1回分にならない）。
    const weekNeighborNav = { from: '', key: '', timer: 0 };
    function scrollWeekToNeighbor(delta) {
      if (state.planner.type !== 'week' || state.view !== 'planning' || !motionAllowed()) return false;
      const target = document.getElementById('weekCalendar');
      if (!target || target.dataset.timelineKey !== state.planner.key || !target.querySelector('.week-span')) return false;
      if (state.planner.busy || state.planner.saving) return false;
      // 行き先を決める起点: 流れている途中なら、その行き先の週。表示中の週が切り替わっていたら、いまの週。
      const base = weekNeighborNav.from === state.planner.key && weekNeighborNav.key ? weekNeighborNav.key : state.planner.key;
      const wanted = shiftWeekKey(base, delta < 0 ? -1 : 1);
      // 描画してある範囲（表示中の週の前後2週）の外へは、スクロールではなく切り替えにまかせる。
      const neighbor = calendarSurroundingPeriods('week', state.planner.key).find(function(period) { return period.key === wanted; });
      if (!neighbor || !neighbor.range) {
        // 連打で、描画してある範囲の外の週まで進むときは、起点の週から数えて、行き先の週へ直接切り替える。
        if (base !== state.planner.key) {
          const steps = calendarPeriodDelta('week', state.planner.key, wanted);
          clearTimeout(weekNeighborNav.timer);
          weekNeighborNav.from = '';
          weekNeighborNav.key = '';
          if (steps) { shiftPeriod(steps); return true; }
        }
        return false;
      }
      const header = target.querySelector('.week-head-day[data-date="' + neighbor.range.startYmd + '"]');
      if (!header) return false;
      weekNeighborNav.from = state.planner.key;
      weekNeighborNav.key = wanted;
      clearTimeout(weekNeighborNav.timer);
      // 切り替わらずに止まった場合（動かせなかったとき）も、次の操作が元の週から始まるよう戻す。
      weekNeighborNav.timer = setTimeout(function() { weekNeighborNav.from = ''; weekNeighborNav.key = ''; }, 1500);
      scrollCalendarTimelineToDate('week', neighbor.range.startYmd);
      return true;
    }

    function weekdayLabel(date) {
      return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(date);
    }

    function dailyWeekKey(date) {
      return isoWeek(parseYmd(date || state.daily.date));
    }
    async function openPlannerActualDay(dateValue) {
      const nextDate = String(dateValue || '').trim();
      if (!isViewYmd(nextDate) || state.daily.busy) return false;
      await setCalendarMode('day', nextDate);
      return state.view === 'daily' && state.daily.date === nextDate;
    }
    async function openDailyPlanEditor(element) {
      if (state.daily.openingPlan) return;
      syncDailyFromDom();
      const row = state.daily.rows.find(function(item) { return item.id === element.dataset.id; });
      if (!row || dailyRowIsInterrupt(row)) return;
      const parent = parentNameForDaily(row.name, row.planId);
      const matches = dailyPlanItems().filter(function(item) {
        return row.planId ? item.id === row.planId : item.name === parent;
      });
      // 持ち越し元など、この日の週に載っていない予定は、覚えている予定の情報から元の週を開く。
      if (!matches.length && row.planId) {
        const metas = state.weeklyPlanMeta || {};
        const metaName = Object.keys(metas).find(function(name) { return String((metas[name] || {}).planId || '').trim() === String(row.planId).trim(); });
        const meta = metaName ? metas[metaName] : null;
        if (meta && (meta.originWeek || meta.periodKey || meta.carryWeek)) matches.push({ id: row.planId, originWeek: meta.originWeek, periodKey: meta.periodKey, carryWeek: meta.carryWeek });
      }
      if (matches.length !== 1) return toast('対応する予定を確認できませんでした。週の画面から確認してください', 'error');
      const plan = matches[0];
      const weekKey = plan.originWeek || plan.periodKey || plan.carryWeek || dailyWeekKey(state.daily.date);
      state.daily.openingPlan = true;
      try {
        // 入力した実績を保存してから移動する。保存中や保存失敗時は画面を切り替えない。
        const date = state.daily.date;
        const deadline = Date.now() + 15000;
        while (state.daily.saving && Date.now() < deadline) await new Promise(function(resolve) { setTimeout(resolve, 50); });
        if (state.view !== 'daily' || state.daily.date !== date) return;
        if (state.daily.saving) return toast('実績を保存中です。保存が終わってから予定を開いてください');
        if (state.daily.dirty) await saveDaily();
        if (state.daily.dirty) return;
        closeDailyRowSheet();
        await setCalendarMode('week', weekKey);
        if (state.view !== 'planning' || state.planner.key !== weekKey) return;
        const target = plannerItems().find(function(item) { return item.id === plan.id; });
        if (!target) return toast('予定を読み込めませんでした。週の画面から確認してください', 'error');
        openPlanDialog({ id: target.id, editSubtaskId: row.subtaskId || '' });
      } catch (error) {
        toast('予定を開けませんでした: ' + error.message, 'error');
      } finally { state.daily.openingPlan = false; }
    }
    function setDailyWeekWorkspace(weekKey, summary, items, subtasks) {
      state.daily.weekKey = weekKey || '';
      state.daily.weekSummary = summary || null;
      state.daily.weekItems = items || plannerItemsFromSummaryRows(summary && summary.rows);
      state.daily.weekSubtasks = (subtasks || (summary && summary.subtasks) || []).slice();
      return { live: false, summary: state.daily.weekSummary, items: state.daily.weekItems };
    }
    function dailyWeekWorkspaceFor(weekKey) {
      if (state.planner.type === 'week' && state.planner.key === weekKey && state.planner.summary) {
        state.daily.weekKey = weekKey;
        state.daily.weekSummary = state.planner.summary;
        state.daily.weekItems = plannerItems();
        return { live: true, summary: state.planner.summary, items: plannerItems() };
      }
      if (state.daily.weekKey === weekKey && state.daily.weekSummary) {
        return { live: false, summary: state.daily.weekSummary, items: state.daily.weekItems || [] };
      }
      return null;
    }
    async function ensureDailyWeekWorkspace(weekKey) {
      const current = dailyWeekWorkspaceFor(weekKey);
      if (current) return current;
      if (state.weekWorkspaceBusy[weekKey]) return state.weekWorkspaceBusy[weekKey];
      const pending = gas('loadPlanningWorkspace', 'week', weekKey).then(async function(summary) {
        rememberWeeklyPlansFromSummary(weekKey, summary);
        const overlay = await ensureWeekContinuationOverlay(weekKey, plannerItemsFromSummaryRows(summary.rows), summary.subtasks || [], summary.range);
        overlay.items.forEach(function(item) {
          if (!item || !item.hasPlan) return;
          rememberWeeklyPlanName(item.name, {
            planId: item.id,
            carryWeek: item.carryWeek,
            plannedHours: item.planned,
            prevC: item.planned,
            startDate: item.startDate,
            endDate: item.endDate,
            undated: !!item.undated,
            calendarKey: item.calendarKey,
            projectId: item.projectId
          });
        });
        if (overlay.subtasks) rememberWeeklySubtasks(weekKey, overlay.subtasks);
        return setDailyWeekWorkspace(weekKey, summary, overlay.items, overlay.subtasks);
      });
      state.weekWorkspaceBusy[weekKey] = pending;
      try { return await pending; }
      finally { delete state.weekWorkspaceBusy[weekKey]; }
    }

    function applyStoredDailyContext(date) {
      const weekKey = dailyWeekKey(date);
      const snap = state.weekSnapshot['week:' + weekKey];
      if (snap && snap.summary) rememberWeeklyPlansFromSummary(weekKey, snap.summary);
      if (state.projects && state.projects.length) return;
      const monthKey = typeof projectMonthForToday === 'function' ? projectMonthForToday() : String(date || '').slice(0, 7);
      const cached = state.projectCache[monthKey];
      if (cached && cached.projects && cached.projects.length) state.projects = cached.projects;
    }
    function warmDailyRowContext(date) {
      return refreshDailyContext(date).then(function() {
        if (state.daily.date !== date || state.view !== 'daily' || state.daily.dirty) return;
        syncRefreshedDailyCalendarTasks(date);
        renderDaily();
      }).catch(function() {});
    }
    function presentDailyResult(date, result, options) {
      options = options || {};
      if (state.daily.date !== date || !result) return;
      applyStoredDailyContext(date);
      if (state.daily.dirty && !options.force) return;
      state.daily.mode = result.mode || 'new';
      state.daily.url = result.spreadsheetUrl || '';
      state.daily.importSource = result.importSource || [];
      state.daily.needsCalendar = !!result.needCalendar;
      state.daily.calendarRowsAtLoad = [];
      state.daily.rows = (result.tasks || []).map(function(task) {
        return { id: uid('row-'), planId: task.planId || '', subtaskId: task.subtaskId || '', projectId: task.projectId || '', calendarKey: task.calendarKey || '', name: task.title || '', today: roundHours(task.hours), previous: roundHours(task.prevB), estimate: roundHours(task.prevC), status: dailyStatusIsComplete(task.status) ? '完了' : '', type: task.type || 'new' };
      });
      const forecast = peekWeekForecast(date);
      state.daily.rows.forEach(function(row) { classifyDailyRowType(row, date); });
      try { state.daily.agenda = dayAgendaFromForecast(forecast, date, state.daily.rows); }
      catch (_) { state.daily.agenda = null; }
      const calendarRowsAdded = applyDailyCalendarTasks(date);
      linkDailyCalendarRows(date);
      const calendarProjectStamped = stampDefaultProjectOnCalendarRows();
      applyWeeklyHoursToDailyRows(state.daily.rows, date);
      rememberDailyCalendarRows(date);
      state.daily.loadedDate = date;
      state.daily.dirty = false;
      state.daily.autoSaveDeferred = false;
      state.daily.changeSeq = 0;
      state.daily.paintedDigest = navigationDigest(result.tasks) + ':' + navigationDigest(forecast);
      renderDaily();
      if (calendarProjectStamped || calendarRowsAdded) markDailyDirty({ auto: true });
      restoreTimer();
      if (options.resetHistory) resetEditHistory();
    }
    function dailyRefreshIsHeld() {
      const dialogOpen = ['candidateDialog', 'planDialog', 'awayDialog'].some(function(id) {
        const dialog = document.getElementById(id);
        return appDialogIsOpen(dialog);
      });
      return dialogOpen || navigationViewHoldsFocus('dailyView');
    }
    async function refreshDailyContext(date) {
      await Promise.all([
        rememberDailyParentNames(date),
        ensureWeekForecastForDate(date).catch(function() { return null; }),
        ensureDailyWeekWorkspace(dailyWeekKey(date)).catch(function() { return null; }),
        ensureProjectCatalog().catch(function() { return []; })
      ]);
    }
    async function loadDailyBlocking(date, token, force) {
      try {
        const result = (!force && dailySnapshotIsUsable(date) && state.dailyCache[date]) || await gas('loadDataForDate', date);
        if (state.nav.daily !== token || state.daily.date !== date) return;
        rememberDailySnapshot(date, result);
        await refreshDailyContext(date);
        if (state.nav.daily !== token || state.daily.date !== date) return;
        presentDailyResult(date, result, { resetHistory: true, force: true });
      } catch (error) {
        toast('日次ログの読み込みに失敗しました: ' + error.message, 'error');
      }
    }
    async function refreshDailyFromServer(date, token) {
      const result = await gas('loadDataForDate', date);
      if (state.nav.daily !== token) return;
      rememberDailySnapshot(date, result);
      await refreshDailyContext(date);
      if (!navigationRefreshIsCurrent(token, state.nav.daily, state.daily.date === date, state.daily.dirty)) return;
      if (dailyRefreshIsHeld()) return;
      const forecast = peekWeekForecast(date);
      const digest = navigationDigest(result.tasks) + ':' + navigationDigest(forecast);
      if (digest === state.daily.paintedDigest) {
        state.daily.agenda = dayAgendaFromForecast(forecast, date, state.daily.rows);
        applyDailyProgress(state.daily.agenda);
        syncRefreshedDailyCalendarTasks(date);
        renderDaily();
        return;
      }
      presentDailyResult(date, result, { resetHistory: false, force: true });
    }
    // まだ保存していない日（mode: 'new'）の控えは、前の日の持ち越しやカレンダーから作った下書きにすぎない。
    // 前の日をあとで書き足すと古くなり、そのまま表示すると自動保存で古い持ち越しが確定してしまうので、
    // 控えは使わず毎回サーバーから作り直す。保存済みの日の控えはこれまでどおり先に表示する。
    function dailySnapshotIsUsable(date) {
      const cached = state.dailyCache[date];
      return !!cached && cached.mode !== 'new';
    }
    async function prefetchDailySnapshot(date) {
      if (!isViewYmd(date) || state.dailyCache[date]) return;
      const startedAt = Date.now();
      try {
        const result = await gas('loadDataForDate', date);
        if ((state.dailyFetchedAt[date] || 0) < startedAt) rememberDailySnapshot(date, result);
        await refreshDailyContext(date);
      } catch (_) {}
    }
    function prefetchAdjacentDailySnapshots(date) {
      const base = isViewYmd(date) ? date : state.daily.date;
      if (!isViewYmd(base)) return;
      const anchor = parseYmd(base);
      [-1, 1].forEach(function(delta) {
        const next = new Date(anchor.getTime());
        next.setDate(next.getDate() + delta);
        prefetchDailySnapshot(ymd(next));
      });
    }
    async function loadDaily(options) {
      options = options || {};
      const silent = !!options.silent;
      const requestedDate = state.daily.date;
      if (state.daily.loadedDate && state.daily.loadedDate !== requestedDate) detachDailyRowsFromDate();
      ensureTaskNameSuggestions();
      cancelDailyAutoSave();
      if (!(await ensureAnnualStorageYear(Number(String(requestedDate || '').slice(0, 4))))) return;
      if (state.daily.date !== requestedDate) return loadDaily(options);
      const snapId = requestedDate;
      return runScreenLoad({
        hasSnapshot: function() { return dailySnapshotIsUsable(snapId); },
        options: {
          force: !!options.force,
          refresh: options.refresh,
          recent: snapshotIsRecent(state.dailyFetchedAt[snapId])
        },
        silent: silent,
        isBusy: function() { return state.daily.busy && state.daily.loadingDate === snapId; },
        markBusy: function(busy) {
          if (busy) {
            state.daily.busy = true;
            state.daily.loadingDate = snapId;
            return;
          }
          if (state.daily.loadingDate === snapId) {
            state.daily.busy = false;
            state.daily.loadingDate = '';
          }
        },
        showBusy: function() { showBusy('読み込んでいます…'); },
        hideBusy: hideBusy,
        paintCached: function() {
          presentDailyResult(snapId, state.dailyCache[snapId], { resetHistory: true, force: true });
          warmDailyRowContext(snapId);
        },
        beginRefresh: function() { return ++state.nav.daily; },
        refresh: function(token) { return refreshDailyFromServer(snapId, token); },
        onRefreshError: function(error) {
          if (!state.dailyCache[snapId]) toast('日次ログの読み込みに失敗しました: ' + error.message, 'error');
        },
        loadBlocking: function() { return loadDailyBlocking(snapId, ++state.nav.daily, !!options.force); }
      });
    }

    function weekCapacityCacheKey(weekKey) {
      return 'week:' + weekKey;
    }
    function rememberCalendarCapacity(cacheKey, capacity) {
      if (!cacheKey || !capacity) return capacity;
      state.calendarCache[cacheKey] = capacity;
      state.calendarFetchedAt[cacheKey] = Date.now();
      return capacity;
    }
    function calendarCacheIsFresh(cacheKey) {
      const cached = state.calendarCache[cacheKey];
      if (!cached || !Array.isArray(cached.days)) return false;
      const fetchedAt = Number(state.calendarFetchedAt[cacheKey]) || 0;
      return fetchedAt > 0 && Date.now() - fetchedAt < CALENDAR_CACHE_TTL_MS;
    }
    function clearCalendarCapacityCache() {
      state.calendarCache = {};
      state.calendarFetchedAt = {};
    }
    function livePlannerHasCapacity(weekKey) {
      if (state.planner.type !== 'week' || state.planner.key !== weekKey || !state.planner.summary) return false;
      return !!((state.planner.summary.capacity && state.planner.summary.capacity.days) || []).length;
    }
    // 週の予定と稼働時間（週の画面と同じもの）。予定は期間だけを持ち、日ごとの割当はしない。
    function peekWeekForecast(date) {
      const weekKey = isoWeek(parseYmd(date));
      if (livePlannerHasCapacity(weekKey)) return calculateWeekPlanModel();
      return state.weekForecastCache[weekKey] || null;
    }
    function dayAgendaFromForecast(forecast, date, dailyRows) {
      if (!forecast) return null;
      const capacityDay = (forecast.days || []).find(function(day) { return day.date === date; }) || null;
      return buildDayAgendaModel(date, forecast.rows, dailyRows, capacityDay, state.weeklyPlanNames);
    }
    function applyDailyProgress(model) {
      let todayTotal = 0;
      state.daily.rows.forEach(function(row) { todayTotal += numericHours(row.today); });
      const workday = model ? roundHours(model.workdayHours) : 0;
      const rate = dailyProgressRate(todayTotal, workday);
      document.getElementById('dailyProgress').textContent = rate == null ? '—' : String(rate);
      const meta = document.getElementById('dailyProgressMeta');
      if (meta) meta.textContent = workday > 0 ? '本日 ÷ 稼働 ' + compactHours(workday) + 'h' : '稼働なし';
      refreshDailyCalendarSources();
    }
    async function ensureWeekForecastForDate(date) {
      const weekKey = isoWeek(parseYmd(date));
      const cacheKey = weekCapacityCacheKey(weekKey);
      let waitedForPlannerCapacity = false;
      if (state.planner.type === 'week' && state.planner.key === weekKey && state.planner.summary && state.planner.capacityBusy && state.planner.capacityPromise) {
        waitedForPlannerCapacity = true;
        try { await state.planner.capacityPromise; } catch (_) {}
      }
      const live = peekWeekForecast(date);
      if (live && (calendarCacheIsFresh(cacheKey) || waitedForPlannerCapacity)) return live;
      if (state.weekForecastBusy[weekKey]) return state.weekForecastBusy[weekKey];
      const pending = (async function() {
        const useCached = calendarCacheIsFresh(cacheKey);
        const [summary, capacity] = await Promise.all([
          gas('loadPlanningWorkspace', 'week', weekKey),
          useCached
            ? Promise.resolve(state.calendarCache[cacheKey])
            : gas('loadPlanningCalendarCapacity', 'week', weekKey)
        ]);
        if (!useCached) rememberCalendarCapacity(cacheKey, capacity);
        else state.calendarCache[cacheKey] = capacity;
        rememberWeeklySubtasks(weekKey, summary.subtasks);
        const overlay = await ensureWeekContinuationOverlay(weekKey, plannerItemsFromSummaryRows(summary.rows), summary.subtasks || [], summary.range);
        overlay.items.forEach(function(item) {
          if (!item || !item.hasPlan) return;
          rememberWeeklyPlanName(item.name, {
            planId: item.id,
            carryWeek: item.carryWeek,
            plannedHours: item.planned,
            prevC: item.planned,
            startDate: item.startDate,
            endDate: item.endDate,
            undated: !!item.undated
          });
        });
        if (overlay.subtasks) rememberWeeklySubtasks(weekKey, overlay.subtasks);
        const exclusions = uniqueKeys((summary && summary.calendarExclusions) || []);
        const imported = uniqueKeys(overlay.items.map(function(item) { return item.calendarKey; }));
        const adjusted = adjustCapacityDaysForCalendarPlans((capacity && capacity.days) || [], exclusions, imported);
        const rows = weekPlanRows(overlay.items, {
          range: summary && summary.range,
          today: ymd(new Date()),
          weekKey: weekKey,
          subtasks: overlay.subtasks || summary.subtasks || []
        });
        const forecast = { days: adjusted, rows: rows, fallback: !!(capacity && capacity.fallback), calendarInterruptsByDate: (summary && summary.calendarInterruptsByDate) || {} };
        state.weekForecastCache[weekKey] = forecast;
        return forecast;
      })();
      state.weekForecastBusy[weekKey] = pending;
      try { return await pending; }
      finally { delete state.weekForecastBusy[weekKey]; }
    }
    async function loadDayAgenda() {
      const date = state.daily.date;
      const cached = peekWeekForecast(date);
      if (cached) {
        state.daily.agenda = dayAgendaFromForecast(cached, date, state.daily.rows);
        applyDailyProgress(state.daily.agenda);
        if (!calendarCacheIsFresh(weekCapacityCacheKey(isoWeek(parseYmd(date))))) {
          ensureWeekForecastForDate(date).then(function(forecast) {
            if (state.daily.date !== date || !forecast) return;
            state.daily.agenda = dayAgendaFromForecast(forecast, date, state.daily.rows);
            applyDailyProgress(state.daily.agenda);
            syncRefreshedDailyCalendarTasks(date);
          }).catch(function() {});
        }
        return;
      }
      try {
        const forecast = await ensureWeekForecastForDate(date);
        if (state.daily.date !== date) return;
        state.daily.agenda = dayAgendaFromForecast(forecast, date, state.daily.rows);
        applyDailyProgress(state.daily.agenda);
        syncRefreshedDailyCalendarTasks(date);
      } catch (_) {
        if (state.daily.date !== date) return;
        state.daily.agenda = buildDayAgendaModel(date, [], state.daily.rows, null, state.weeklyPlanNames);
        applyDailyProgress(state.daily.agenda);
      }
    }
    const AUTO_WEEK_WORKSPACE_REFRESH_DELAY_MS = 4000;
    function scheduleWeekWorkspaceRefresh(weekKey) {
      if (!weekKey) return;
      if (state.weekWorkspaceRefreshTimer[weekKey]) clearTimeout(state.weekWorkspaceRefreshTimer[weekKey]);
      state.weekWorkspaceRefreshTimer[weekKey] = setTimeout(function() {
        delete state.weekWorkspaceRefreshTimer[weekKey];
        if (state.weekWorkspaceRefreshBusy[weekKey]) {
          state.weekWorkspaceRefreshQueued[weekKey] = true;
          return;
        }
        state.weekWorkspaceRefreshBusy[weekKey] = true;
        refreshWeekWorkspaceAfterDailySave(weekKey, { skipContinuations: true }).catch(function() {}).then(function() {
          delete state.weekWorkspaceRefreshBusy[weekKey];
          if (state.weekWorkspaceRefreshQueued[weekKey]) {
            delete state.weekWorkspaceRefreshQueued[weekKey];
            scheduleWeekWorkspaceRefresh(weekKey);
          }
        });
      }, AUTO_WEEK_WORKSPACE_REFRESH_DELAY_MS);
    }
    async function refreshWeekWorkspaceAfterDailySave(weekKey, options) {
      options = options || {};
      if (state.weekWorkspaceRefreshTimer[weekKey]) {
        clearTimeout(state.weekWorkspaceRefreshTimer[weekKey]);
        delete state.weekWorkspaceRefreshTimer[weekKey];
      }
      delete state.weekForecastCache[weekKey];
      delete state.calendarCache[weekWorkspaceCacheKey(weekKey)];
      // 週の画面がほかの週を開いている間は、控えを古い扱いにして次に開いたとき読み直させる。
      const snapshot = state.weekSnapshot['week:' + weekKey];
      if (snapshot) snapshot.fetchedAt = 0;
      if (typeof adjacentCalendarPeriods !== 'undefined') delete adjacentCalendarPeriods.week.fetchedAt[weekKey];
      const onWeek = state.planner.type === 'week' && state.planner.key === weekKey && state.planner.summary;
      if (onWeek && (state.planner.dirty || state.planner.busy || state.planner.saving)) {
        // 予定の編集・保存中は上書きできないので、少し待って読み直す。
        scheduleWeekWorkspaceRefresh(weekKey);
      } else if (onWeek) {
        try {
          const summary = await gas('loadPlanningWorkspace', 'week', weekKey);
          applySavedWeekWorkspace(weekKey, summary, true);
          if (state.view === 'planning') renderPlanner();
        } catch (_) {}
      }
      if (!options.skipContinuations) {
        try { await applyPreviousWeekContinuations(); } catch (_) {}
      }
    }

    async function syncRemovedDailyCalendarRowsToPlanner(date, removedRows) {
      const keys = uniqueKeys((removedRows || []).map(function(row) { return row && row.calendarKey; }));
      if (!keys.length) return 0;
      const weekKey = dailyWeekKey(date);
      const workspace = await ensureDailyWeekWorkspace(weekKey);
      if (!workspace || !workspace.summary) throw new Error('週予定を読み込めませんでした');
      const exclusions = uniqueKeys(excludedCalendarKeys(weekKey).concat(keys));
      const items = (workspace.items || []).filter(function(item) {
        return !item || keys.indexOf(String(item.calendarKey || '').trim()) < 0;
      });
      persistCalendarExclusions(exclusions, weekKey);
      const saved = await savePlanningWeekWorkspace(weekKey, items, workspace.summary.subtasks || [], exclusions);
      const live = state.planner.type === 'week'
        && state.planner.key === weekKey
        && !state.planner.dirty
        && !state.planner.busy && !state.planner.saving;
      applySavedWeekWorkspace(weekKey, saved, live);
      rememberDailyCalendarAutoNames(date);
      return keys.length;
    }

    function renderDaily() {
      if (state.calendarMode === 'day') syncCalendarControl();
      const mode = document.getElementById('dailyMode');
      mode.textContent = state.daily.mode === 'edit' ? '保存済み' : state.daily.mode === 'empty' ? '空で保存済み' : '新規入力';
      mode.className = 'mode-pill' + (state.daily.mode === 'edit' ? ' is-saved' : state.daily.mode === 'empty' ? ' is-empty' : '');
      const list = activeDailyTaskList();
      list.innerHTML = '';
      state.daily.rows.forEach(function(row) { list.appendChild(buildTaskRow(row)); });
      if (!state.daily.rows.length) list.innerHTML = dailyEmptyState();
      bindDailyDraggables(list);
      updateDailySummary();
      updateSaveDock();
      renderTimer();
      applyRecordedDailyRow();
    }

    function dailyRowIsSubtask(row) {
      if (!row || dailyRowIsInterrupt(row)) return false;
      if (row.type === 'calendar' || row.type === 'calendar-imported') return false;
      if (row.subtaskId) return true;
      const name = String(row.name || '').trim();
      const parent = parentNameForDaily(name, row.planId);
      if (!parent || !dailyBelongsToPlan(name, parent)) return false;
      return !!childNameForDaily(name, row.planId, row.subtaskId);
    }
    function stampDefaultProjectOnCalendarRows() {
      const projectId = typeof defaultAssignedProjectId === 'function' ? defaultAssignedProjectId() : '';
      if (!projectId) return false;
      let changed = false;
      (state.daily.rows || []).forEach(function(row) {
        if (!row || row.projectId) return;
        const calendar = row.type === 'calendar' || row.type === 'calendar-imported' || String(row.calendarKey || '').trim();
        if (!calendar) return;
        row.projectId = projectId;
        changed = true;
      });
      return changed;
    }
    function dailyRowFollowsPlanProject(row) {
      if (!row || dailyRowIsInterrupt(row)) return false;
      if (row.type === 'calendar' || row.type === 'calendar-imported') return false;
      if (String(row.planId || '').trim()) return true;
      const name = String(row.name || '').trim();
      const parent = parentNameForDaily(name, '');
      return !!(parent && (planIdentityName(name) === planIdentityName(parent) || dailyBelongsToPlan(name, parent)));
    }
    function dailyInheritedProjectId(row) {
      const parent = parentNameForDaily(row && row.name, row && row.planId);
      const item = dailyPlanItems().find(function(entry) {
        if (!entry) return false;
        if (row.planId && String(entry.id || '') === String(row.planId)) return true;
        return !!(parent && entry.name === parent);
      });
      if (item && item.projectId) return item.projectId;
      const meta = parent ? ((state.weeklyPlanMeta || {})[parent] || {}) : {};
      return meta.projectId || '';
    }
    function bindDailyProjectSelect(el, projectId) {
      const select = el && el.querySelector('.daily-project');
      if (!select) return;
      const current = String(projectId || '');
      el.dataset.projectId = current;
      const apply = function() {
        if (String(select.value || '') !== current) select.value = current;
      };
      if (select.updateComplete && typeof select.updateComplete.then === 'function') select.updateComplete.then(apply);
      else apply();
    }
    function dailyProjectIdFromRow(el) {
      if (dailyRowFollowsPlanProject({ planId: el.dataset.planId || '', name: composedDailyNameFromRow(el), type: el.dataset.type || 'new' })) return '';
      const select = el.querySelector('.daily-project');
      const chosen = select ? String(select.value || '').trim() : '';
      if (chosen) return chosen;
      return el.dataset.projectId || '';
    }
    function dailyProjectSelectHtml(projectId) {
      const current = String(projectId || '');
      const projects = (Array.isArray(state.projects) ? state.projects : []).filter(function(project) {
        return project && (project.status !== 'archived' || project.id === current);
      });
      return '<md-outlined-select class="field daily-project" quick aria-label="プロジェクト" value="' + escapeHtml(current) + '"><md-select-option value=""' + (current ? '' : ' selected') + '><div slot="headline">未設定</div></md-select-option>' + projects.map(function(project) {
        return '<md-select-option value="' + escapeHtml(project.id) + '"' + (project.id === current ? ' selected' : '') + '><div slot="headline">' + escapeHtml(project.name) + '</div></md-select-option>';
      }).join('') + '</md-outlined-select>';
    }
    function dailyProjectCellHtml(row) {
      if (!dailyRowFollowsPlanProject(row)) return dailyProjectSelectHtml(row.projectId);
      const projectId = dailyInheritedProjectId(row);
      const project = (Array.isArray(state.projects) ? state.projects : []).find(function(item) { return item && item.id === projectId; });
      const label = project ? project.name : '未設定';
      return '<span class="daily-project-inherited' + (project ? '' : ' is-empty') + '" title="プロジェクトは予定の割り当てに従います">' + escapeHtml(label) + '</span>';
    }
    // カレンダー予定から今日だけに切り替えた行は、名前を変えても元の予定が分かるようにする。
    // 除外済みの予定は日次のカレンダー課題に出ないので、週の予定データからも探す。
    function dailyCalendarSourceForRow(row) {
      const key = String((row && row.calendarKey) || '').trim();
      if (!key) return null;
      const date = state.daily.date;
      const tasks = typeof dailyCalendarTasksForDate === 'function' ? dailyCalendarTasksForDate(date) : [];
      const task = (tasks || []).find(function(item) { return item && item.calendarKey === key; });
      if (task && task.name) return { title: task.name, estimate: roundHours(task.estimate) };
      const days = typeof capacityDaysForDaily === 'function' ? capacityDaysForDaily(date) : [];
      const day = (days || []).find(function(item) { return item && item.date === date; });
      let source = null;
      ((day && day.events) || []).some(function(event, index) {
        if (calendarEventKey(event, date, index) !== key) return false;
        source = { title: String((event && event.title) || '').trim(), estimate: roundHours(calendarEventHours(event)) };
        return true;
      });
      return source && source.title ? source : null;
    }
    function dailyCalendarSourceHtml(row) {
      if (!dailyRowIsCalendarInterrupt(row)) return '';
      const source = dailyCalendarSourceForRow(row);
      const label = source ? 'カレンダー：' + source.title : 'カレンダー予定から';
      const detail = source && source.estimate > 0 ? label + '（予定 ' + hours(source.estimate) + 'h）' : label;
      // 名前や時間を変えて今日だけになった行は、元のカレンダーの予定に戻せるようにする。
      const revertTitle = 'カレンダーの予定に戻す（名前を「' + (source ? source.title : '') + '」' + (source && source.estimate > 0 ? '、時間を ' + hours(source.estimate) + 'h' : '') + 'に戻します）';
      const revert = source
        ? '<button type="button" class="calendar-revert" title="' + escapeHtml(revertTitle) + '" aria-label="カレンダーの予定に戻す"><span class="material-symbols-outlined" aria-hidden="true">undo</span></button>'
        : '';
      return '<small class="interrupt-calendar-source"><span class="material-symbols-outlined" aria-hidden="true">event</span><span class="interrupt-calendar-source-title" title="' + escapeHtml(detail) + '">' + escapeHtml(label) + '</span>' + revert + '</small>';
    }
    // 週の予定データは日次の行より後に届くことがあるので、届いたら元の予定名を描き直す。
    function refreshDailyCalendarSources() {
      const list = typeof activeDailyTaskList === 'function' ? activeDailyTaskList() : null;
      Array.from(list ? list.querySelectorAll('.work-card .interrupt-calendar-source') : []).forEach(function(badge) {
        const el = badge.closest('.work-card');
        const html = dailyCalendarSourceHtml({ type: el.dataset.type, calendarKey: el.dataset.calendarKey, name: composedDailyNameFromRow(el) });
        if (html && html !== badge.outerHTML) badge.outerHTML = html;
      });
    }
    function dailyIssueCellHtml(row) {
      const interrupt = dailyRowIsInterrupt(row);
      const name = String((row && row.name) || '').trim();
      if (interrupt) {
        return '<span class="task-field-label">今日だけの課題</span><label class="interrupt-name-field"><input class="field interrupt-name" maxlength="200" value="' + escapeHtml(name) + '" placeholder="例）問い合わせ対応" autocomplete="off" aria-label="今日だけの課題名" title="名前を変更"><span class="material-symbols-outlined interrupt-name-edit" aria-hidden="true">edit</span></label>' + dailyCalendarSourceHtml(row);
      }
      // カレンダーの行も名前を編集できる。名前を変えて確定すると、今日だけの作業に切り替わる（events_daily.js）。
      if (row && (row.type === 'calendar' || row.type === 'calendar-imported')) {
        return '<span class="task-field-label">カレンダーの予定</span><label class="interrupt-name-field"><input class="field interrupt-name calendar-row-name" maxlength="200" value="' + escapeHtml(name) + '" data-calendar-name="' + escapeHtml(name) + '" autocomplete="off" aria-label="カレンダーの予定の名前（変えると今日だけの作業になります）" title="名前を変えると今日だけの作業になります"><span class="material-symbols-outlined interrupt-name-edit" aria-hidden="true">edit</span></label>';
      }
      const parentName = parentNameForDaily(name, row && row.planId);
      const childName = childNameForDaily(name, row && row.planId, row && row.subtaskId);
      const issue = dailyIssueLabel(name, row && row.planId, row && row.subtaskId);
      const titleHtml = row && (row.planId || parentName)
        ? '<button type="button" class="daily-plan-link" title="週の予定を開いて編集">' + escapeHtml(issue.title) + '</button>'
        : escapeHtml(issue.title);
      const issueText = issue.title
        ? '<strong>' + titleHtml + '</strong>' + (issue.parent ? '<small>' + escapeHtml(issue.parent) + '</small>' : '')
        : '<strong class="is-empty">課題なし</strong>';
      // 予定名が変わる前の古い行（サブタスクIDなし・今の予定名で始まらない）は、保存しても元の名前のまま残す。
      const keepSavedName = !!(parentName && name && name !== parentName && !childName && !row.subtaskId);
      const hiddenParent = keepSavedName ? '' : parentName;
      const hiddenName = keepSavedName ? name : (childName || (parentName ? '' : name));
      return '<span class="task-field-label">課題</span><input type="hidden" class="task-parent" value="' + escapeHtml(hiddenParent) + '"><input type="hidden" class="task-name" value="' + escapeHtml(hiddenName) + '"><span class="task-issue-text' + (issue.title ? '' : ' is-empty') + '">' + issueText + '</span>';
    }

    function buildTaskRow(row) {
      const el = document.createElement('tr');
      el.className = 'work-card';
      el.dataset.id = row.id;
      el.dataset.type = row.type;
      el.dataset.planId = row.planId || '';
      el.dataset.subtaskId = row.subtaskId || '';
      if (row.manualInterrupt) el.dataset.manualInterrupt = '1';
      el.dataset.calendarKey = row.calendarKey || '';
      const interrupt = dailyRowIsInterrupt(row);
      el.dataset.previous = String(roundHours(row.previous));
      el.dataset.estimate = String(interrupt ? numericHours(row.today) : roundHours(row.estimate));
      el.draggable = false;
      const nameLocked = dailyRowNameLocked(row);
      const origin = dailyRowOrigin(row, priorDailyNames());
      const displayPrevious = interrupt ? 0 : roundHours(row.previous);
      const displayEstimate = interrupt ? numericHours(row.today) : roundHours(row.estimate);
      if (!interrupt && nameLocked) el.dataset.nameLocked = '1';
      el.dataset.origin = origin;
      if (origin === 'new' || origin === 'resume') el.classList.add('is-plan');
      if (origin === 'calendar') el.classList.add('is-calendar-auto');
      if (interrupt) el.classList.add('is-interrupt');
      if (dailyRowIsCalendarInterrupt(row)) el.classList.add('is-calendar-interrupt');
      if (row.calendarEstimate != null && row.calendarEstimate !== '' && roundHours(row.calendarEstimate) > 0) {
        el.dataset.calendarEstimate = String(roundHours(row.calendarEstimate));
        if (row.calendarType) el.dataset.calendarType = row.calendarType;
      }
      const recordedMark = recordedDailyMarkHtml(row.id);
      el.innerHTML =
        '<td class="task-col-handle"><md-icon-button touch-target="wrapper" class="drag-handle" title="ドラッグして並び替え" aria-label="並び替え"><span class="material-symbols-outlined">drag_indicator</span></md-icon-button></td>' +
        '<td class="task-col-done"><md-checkbox class="done-check" touch-target="wrapper"' + (row.status === '完了' ? ' checked' : '') + ' title="' + (row.status === '完了' ? '完了を取り消す' : '完了にする') + '" aria-label="完了"></md-checkbox></td>' +
        '<td class="task-issue-cell"><div class="task-issue-wrap">' + dailyIssueCellHtml(row) + '</div></td>' +
        '<td class="task-origin-cell task-col-origin"><span class="task-origin is-' + origin + '" title="タスクの出どころ: ' + escapeHtml(dailyRowOriginLabel(origin)) + '">' + dailyRowOriginLabel(origin) + '</span></td>' +
        '<td class="task-project-cell">' + dailyProjectCellHtml(row) + '</td>' +
        '<td class="field-cell today-cell task-col-num">' + recordedMark + '<div class="today-stepper"><md-icon-button touch-target="wrapper" class="today-step" data-step="-0.25" title="本日の実績を' + hoursStepLabel() + '減らす" aria-label="本日実績を' + hoursStepUnit() + '時間減らす"><span class="material-symbols-outlined">remove</span></md-icon-button><md-outlined-text-field class="field number-field today-value" type="number" no-spinner min="0" step="0.25" value="' + hours(row.today) + '" aria-label="本日実績"></md-outlined-text-field><md-icon-button touch-target="wrapper" class="today-step" data-step="0.25" title="本日の実績を' + hoursStepLabel() + '増やす" aria-label="本日実績を' + hoursStepUnit() + '時間増やす"><span class="material-symbols-outlined">add</span></md-icon-button></div></td>' +
        '<td class="field-cell previous-cell task-col-num"><span class="synced-hours previous-value" aria-label="前日までの実績">' + hours(displayPrevious) + '</span></td>' +
        '<td class="field-cell estimate-cell task-col-num"><span class="synced-hours estimate-value" aria-label="予定工数">' + hours(interrupt ? row.today : displayEstimate) + '</span></td>' +
        '<td class="remaining-cell task-col-num"><span class="synced-hours daily-remaining" aria-label="残り工数"></span></td>' +
        '<td class="task-status-cell task-col-status"><span class="daily-status weekly-status"></span></td>' +
        '<td class="row-actions"><md-icon-button touch-target="wrapper" class="icon-button timer" title="計測を開始" aria-label="計測を開始"><span class="material-symbols-outlined">play_arrow</span></md-icon-button><md-icon-button touch-target="wrapper" class="icon-button remove" title="この実績を削除" aria-label="この実績を削除"><span class="material-symbols-outlined">delete</span></md-icon-button></td>';
      bindDailyProjectSelect(el, row.projectId);
      const todayField = el.querySelector('.today-value');
      const todayMinus = el.querySelector('.today-step[data-step="-0.25"]');
      if (todayMinus) todayMinus.disabled = numericHours(todayField && todayField.value) <= 0;
      setDailyRowComplete(el, dailyStatusIsComplete(row.status));
      syncTimerButton(el.querySelector('.timer'));
      return el;
    }
    function dailyTaskRowOrder(list) {
      return reorderRowKeys(reorderRowElements(list, '.work-card'), function(row) { return row.dataset.id; });
    }
    function bindDailyDraggables(list) {
      if (!list) return;
      bindReorderDraggables(list, {
        selector: '.work-card',
        handleSelector: '.drag-handle',
        keyOf: function(row) { return row.dataset.id; },
        onPress: function(row, session) {
          state.dragId = row.dataset.id;
          state.dragOrder = session.startOrder;
        },
        onFinish: function(parent, changed) {
          state.dragId = '';
          state.dragOrder = '';
          Array.prototype.forEach.call(parent.querySelectorAll('.work-card'), function(row) {
            row.draggable = false;
          });
          if (changed) markDailyDirty();
        }
      });
    }

    function dailyStatusIsComplete(status) {
      return String(status || '').trim() === '完了';
    }
    function dailyRowComplete(row) {
      return !!(row && row.classList.contains('is-done'));
    }
    function setDailyRowComplete(row, done) {
      if (!row) return;
      row.classList.toggle('is-done', !!done);
      const check = row.querySelector('.done-check');
      if (check) {
        check.checked = !!done;
        check.title = done ? '完了を取り消す' : '完了にする';
      }
      syncDailyRowStatus(row);
      syncDailyRowOrigin(row);
    }
    function syncDailyRowStatus(el) {
      if (!el) return;
      syncDailyRowSyncedHours(el);
      const badge = el && el.querySelector('.daily-status');
      if (!badge) return;
      const today = el.querySelector('.today-value');
      const status = dailyTaskStatus(today && today.value, el.dataset.previous, el.dataset.estimate, dailyRowComplete(el));
      badge.className = 'daily-status weekly-status' + statusToneClass(status);
      badge.textContent = status.label;
      badge.title = statusDetailTitle(status);
    }
    function syncDailyRowOrigin(el) {
      const badge = el && el.querySelector('.task-origin');
      if (!badge) return;
      const origin = dailyRowOrigin({
        type: el.dataset.type,
        previous: el.dataset.previous,
        name: composedDailyNameFromRow(el),
        calendarKey: el.dataset.calendarKey
      }, priorDailyNames());
      el.dataset.origin = origin;
      el.classList.toggle('is-plan', origin === 'new' || origin === 'resume');
      el.classList.toggle('is-calendar-auto', origin === 'calendar');
      el.classList.toggle('is-interrupt', origin === 'interrupt' || el.dataset.type === 'interrupt');
      el.classList.toggle('is-calendar-interrupt', dailyRowIsCalendarInterrupt({ type: el.dataset.type, calendarKey: el.dataset.calendarKey }));
      badge.className = 'task-origin is-' + origin;
      badge.textContent = dailyRowOriginLabel(origin);
    }

    function syncDailyRowSyncedHours(el) {
      if (!el) return;
      const interrupt = el.dataset.type === 'interrupt';
      const today = el.querySelector('.today-value');
      if (interrupt) {
        el.dataset.previous = '0';
        // 今日だけの作業は、予定を実績と同じ値にする（実績を変えると、予定も一緒に変わる）。
        el.dataset.estimate = String(numericHours(today && today.value));
      }
      const previous = el.querySelector('.previous-value');
      const estimate = el.querySelector('.estimate-value');
      if (previous) previous.textContent = hours(el.dataset.previous);
      if (estimate) estimate.textContent = hours(el.dataset.estimate);
      const remaining = el.querySelector('.daily-remaining');
      if (remaining) {
        const planned = numericHours(el.dataset.estimate);
        const actual = numericHours(el.dataset.previous) + numericHours(today && today.value);
        const difference = Math.round((planned - actual) * 100) / 100;
        const hasHours = planned > 0 || actual > 0;
        remaining.textContent = interrupt ? '0.00' : hasHours
          ? difference.toFixed(2)
          : '—';
        remaining.hidden = false;
        remaining.classList.toggle('is-over', !interrupt && difference < 0);
        remaining.title = interrupt ? '今日だけの作業のため、残り工数は0hです' : hasHours
          ? '予定 ' + liveHours(planned) + 'h − 累計実績 ' + liveHours(actual) + 'h（本日を含む）'
          : '予定工数が未設定です';
        // スマホの編集シートでも、一覧と同じ値を入力中に更新する。
        const sheet = document.querySelector('[data-sheet-remaining]');
        if (sheet && typeof dailySheetRowId !== 'undefined' && dailySheetRowId === el.dataset.id) {
          sheet.textContent = remaining.textContent;
          sheet.title = remaining.title;
          sheet.hidden = remaining.hidden;
          sheet.classList.toggle('is-over', remaining.classList.contains('is-over'));
        }
      }
    }

    function syncDailyRowIssueField(el, name) {
      const wrap = el && el.querySelector('.task-issue-wrap');
      if (!wrap) return;
      wrap.innerHTML = dailyIssueCellHtml({
        name: name,
        planId: el.dataset.planId || '',
        subtaskId: el.dataset.subtaskId || '',
        calendarKey: el.dataset.calendarKey || '',
        type: el.dataset.type || 'new'
      });
    }

    function calendarOriginForInterruptRow(el) {
      if (!el) return null;
      if (el.dataset.calendarEstimate) {
        const estimate = roundHours(el.dataset.calendarEstimate);
        if (!(estimate > 0)) return null;
        return { type: el.dataset.calendarType || 'calendar', estimate: estimate, name: String(el.dataset.calendarName || '').trim() };
      }
      if (String(el.dataset.type || '') !== 'interrupt' || !String(el.dataset.calendarKey || '').trim()) return null;
      if (typeof dailyCalendarTaskForRow !== 'function' || typeof dailyCalendarTasksForDate !== 'function') return null;
      const task = dailyCalendarTaskForRow({
        type: 'interrupt',
        calendarKey: el.dataset.calendarKey,
        planId: el.dataset.planId,
        name: composedDailyNameFromRow(el)
      }, dailyCalendarTasksForDate(state.daily.date));
      if (!task || !(roundHours(task.estimate) > 0)) return null;
      return { type: task.imported ? 'calendar-imported' : 'calendar', estimate: roundHours(task.estimate), name: String(task.name || '').trim() };
    }
    // 名前を変えたカレンダーの行を「今日だけ」の作業に切り替える。カレンダーの予定とのつながり
    // （カレンダーキー）は残すので、週の予定側で「実施しない」扱いにはならない。
    function convertCalendarRowToInterrupt(el) {
      if (!el) return;
      const type = String(el.dataset.type || '');
      if (type !== 'calendar' && type !== 'calendar-imported') return;
      syncDailyFromDom();
      const row = state.daily.rows.find(function(entry) { return entry.id === el.dataset.id; });
      if (!row) return;
      row.type = 'interrupt';
      row.manualInterrupt = true;
      row.previous = 0;
      row.estimate = row.today;
      renderDaily();
      markDailyDirty();
    }
    // 今日だけにしたカレンダー由来の行を、元のカレンダーの予定の行に戻す。名前と時間もカレンダーの
    // 予定に戻す（時間が予定と違うままだと、保存時にまた今日だけの行になるため）。Ctrl+Z で取り消せる。
    function revertInterruptRowToCalendar(el) {
      if (!el || !dailyRowIsCalendarInterrupt({ type: el.dataset.type, calendarKey: el.dataset.calendarKey })) return false;
      const origin = calendarOriginForInterruptRow(el);
      const source = dailyCalendarSourceForRow({ calendarKey: el.dataset.calendarKey });
      const name = (source && source.title) || (origin && origin.name) || '';
      const estimate = (origin && origin.estimate) || (source && source.estimate) || 0;
      if (!name) {
        toast('元のカレンダーの予定が見つからないため戻せません');
        return false;
      }
      syncDailyFromDom();
      const row = state.daily.rows.find(function(entry) { return entry.id === el.dataset.id; });
      if (!row) return false;
      row.type = origin && origin.type === 'calendar-imported' ? 'calendar-imported' : 'calendar';
      row.name = name;
      row.manualInterrupt = false;
      row.previous = 0;
      row.estimate = roundHours(estimate);
      if (row.estimate > 0) row.today = row.estimate;
      row.calendarType = '';
      row.calendarEstimate = '';
      renderDaily();
      markDailyDirty();
      return true;
    }
    // 今日だけにした行の名前を、元のカレンダーの予定名に打ち直したら true。
    function interruptRowNameMatchesCalendar(input) {
      if (!input || !input.classList.contains('interrupt-name') || input.classList.contains('calendar-row-name')) return false;
      const el = input.closest('.work-card');
      if (!el || !dailyRowIsCalendarInterrupt({ type: el.dataset.type, calendarKey: el.dataset.calendarKey })) return false;
      const source = dailyCalendarSourceForRow({ calendarKey: el.dataset.calendarKey });
      return !!(source && source.title && String(input.value || '').trim() === source.title);
    }
    // カレンダーの行の名前が、元の予定名から変わっていれば true。
    function calendarRowNameChanged(input) {
      if (!input || !input.classList.contains('calendar-row-name')) return false;
      const value = String(input.value || '').trim();
      return !!value && value !== String(input.dataset.calendarName || '').trim();
    }
    function syncCalendarVarianceRow(el) {
      if (!el) return false;
      const input = el.querySelector('.today-value');
      if (!input) return false;
      const actual = roundHours(numericHours(input.value));
      const type = String(el.dataset.type || '');
      const calendarType = type === 'calendar' || type === 'calendar-imported';
      if (calendarType) {
        const planned = roundHours(el.dataset.estimate);
        if (!(actual > 0) || !(planned > 0) || actual === planned) return false;
        const name = composedDailyNameFromRow(el);
        el.dataset.calendarType = type;
        el.dataset.calendarEstimate = String(planned);
        el.dataset.calendarName = name;
        el.dataset.type = 'interrupt';
        el.dataset.previous = '0';
        el.dataset.estimate = String(actual);
        syncDailyRowIssueField(el, name);
        syncDailyRowSyncedHours(el);
        return true;
      }
      // 手で今日だけにした行と、名前を変えた行は、時間がカレンダーと同じでもカレンダーの行へ戻さない。
      if (el.dataset.manualInterrupt === '1') return false;
      const origin = calendarOriginForInterruptRow(el);
      if (type !== 'interrupt' || !origin) return false;
      if (actual > 0 && actual !== origin.estimate) return false;
      if (origin.name && composedDailyNameFromRow(el) !== origin.name) return false;
      const name = composedDailyNameFromRow(el);
      el.dataset.type = origin.type || 'calendar';
      el.dataset.previous = '0';
      el.dataset.estimate = String(origin.estimate);
      delete el.dataset.calendarType;
      delete el.dataset.calendarEstimate;
      syncDailyRowIssueField(el, name);
      syncDailyRowSyncedHours(el);
      return true;
    }

    function syncDailyFromDom(options) {
      options = options || {};
      const list = activeDailyTaskList();
      const elements = Array.from(list ? list.querySelectorAll('.work-card') : []);
      if (options.convertCalendarVariance) elements.forEach(syncCalendarVarianceRow);
      state.daily.rows = elements.map(function(el) {
        return {
          id: el.dataset.id,
          planId: el.dataset.planId || '',
          subtaskId: el.dataset.subtaskId || '',
          manualInterrupt: el.dataset.manualInterrupt === '1',
          projectId: dailyProjectIdFromRow(el),
          calendarKey: el.dataset.calendarKey || '',
          type: el.dataset.type || 'new',
          name: composedDailyNameFromRow(el),
          today: numericHours(el.querySelector('.today-value').value),
          previous: roundHours(el.dataset.previous),
          estimate: el.dataset.type === 'interrupt' ? numericHours(el.dataset.estimate) : roundHours(el.dataset.estimate),
          status: dailyRowComplete(el) ? '完了' : '',
          calendarType: el.dataset.calendarType || '',
          calendarEstimate: el.dataset.calendarEstimate ? roundHours(el.dataset.calendarEstimate) : ''
        };
      });
    }

    const AUTO_SAVE_DELAY_MS = 800;
    const AUTO_SAVE_RETRY_BASE_MS = 5000;
    const AUTO_SAVE_RETRY_MAX_MS = 60000;
    function autoSaveRetryDelay(retryCount) {
      return Math.min(AUTO_SAVE_RETRY_MAX_MS, AUTO_SAVE_RETRY_BASE_MS * Math.pow(2, Math.max(0, Number(retryCount) - 1)));
    }
    // 画面の行は loadedDate の実績。表示日付と一致しない間は保存すると別の日を上書きしてしまう。
    function dailyRowsBelongToViewedDate() {
      return !!state.daily.loadedDate && state.daily.loadedDate === state.daily.date;
    }
    function detachDailyRowsFromDate() {
      cancelDailyAutoSave();
      state.daily.loadedDate = '';
      state.daily.dirty = false;
      state.daily.autoSaveDeferred = false;
      state.daily.saveQueued = false;
      state.daily.changeSeq += 1;
    }
    function scheduleDailyAutoSave(delayMs) {
      if (state.daily.autoSaveTimer) clearTimeout(state.daily.autoSaveTimer);
      state.daily.autoSaveTimer = null;
      if (!dailyRowsBelongToViewedDate()) return;
      if (state.daily.autoSaveDeferred || !state.daily.dirty || !state.storage || !state.storage.configured || !dailyHoursAreConfirmed()) return;
      state.daily.autoSaveTimer = setTimeout(function() {
        state.daily.autoSaveTimer = null;
        saveDaily({ auto: true });
      }, delayMs == null ? AUTO_SAVE_DELAY_MS : delayMs);
    }
    function schedulePlannerAutoSave(delayMs) {
      if (state.planner.autoSaveTimer) clearTimeout(state.planner.autoSaveTimer);
      state.planner.autoSaveTimer = null;
      if (!state.planner.dirty || !state.storage || !state.storage.configured) return;
      state.planner.autoSaveTimer = setTimeout(function() {
        state.planner.autoSaveTimer = null;
        savePlanner({ auto: true });
      }, delayMs == null ? AUTO_SAVE_DELAY_MS : delayMs);
    }
    // 画面を移るときの未保存の変更の扱い。保存はバックグラウンドで進むので、送れるならその場で送って移動を止めない。
    // 確認が必要（保存を送れない・保存中にさらに変更した）なら true を返す。
    function dailyNeedsLeaveConfirm() {
      if (!state.daily.dirty) return false;
      if (state.daily.saving) return state.daily.changeSeq !== state.daily.savingSeq;
      if (!dailyRowsBelongToViewedDate() || state.daily.autoSaveDeferred || !state.storage || !state.storage.configured || !dailyHoursAreConfirmed()) return true;
      saveDaily({ auto: true });
      return !state.daily.saving;
    }
    function plannerNeedsLeaveConfirm() {
      if (!state.planner.dirty) return false;
      if (state.planner.saving) return state.planner.changeSeq !== state.planner.savingSeq;
      if (!state.storage || !state.storage.configured) return true;
      savePlanner({ auto: true });
      return !state.planner.saving;
    }
    // 予定と実績の両方を見る（どちらも送れるものは送る）。
    function unsavedNeedsLeaveConfirm(options) {
      const daily = dailyNeedsLeaveConfirm();
      const planner = options && options.dailyOnly ? false : plannerNeedsLeaveConfirm();
      return daily || planner;
    }
    // アプリが裏に回ったら、待たずに保存を送る（閉じる直前でも送った保存はサーバーで最後まで進む）。
    function flushPendingAutoSaves() {
      if (state.daily.autoSaveTimer) { cancelDailyAutoSave(); saveDaily({ auto: true }); }
      if (state.planner.autoSaveTimer) { cancelPlannerAutoSave(); savePlanner({ auto: true }); }
    }
    function cancelDailyAutoSave() {
      if (state.daily.autoSaveTimer) clearTimeout(state.daily.autoSaveTimer);
      state.daily.autoSaveTimer = null;
    }
    function cancelPlannerAutoSave() {
      if (state.planner.autoSaveTimer) clearTimeout(state.planner.autoSaveTimer);
      state.planner.autoSaveTimer = null;
    }
    // 今日より後の、まだ保存していない日。開いただけで保存すると、その時点の前日の持ち越しで確定してしまい、
    // そのあと前日に足した作業が入らなくなる。
    function dailyIsUnsavedFutureDay() {
      return state.daily.mode === 'new' && String(state.daily.date || '') > ymd(new Date());
    }
    function markDailyDirty(options) {
      options = options || {};
      // カレンダーの行を足したなど、アプリが自動で変えただけのときは、先の日を保存しない（表示だけ変える）。
      // 自分で実績を入れるなどしたときは、これまでどおり保存する。
      if (options.auto && dailyIsUnsavedFutureDay()) {
        syncDailyFromDom();
        updateDailySummary();
        return;
      }
      state.daily.autoSaveDeferred = !!options.deferAutoSave;
      state.daily.dirty = true;
      state.daily.changeSeq += 1;
      syncDailyFromDom();
      updateDailySummary();
      updateSaveDock();
      if (state.daily.autoSaveDeferred) cancelDailyAutoSave();
      else scheduleDailyAutoSave();
      commitEditHistory(options);
    }

    function updateSaveDock() {
      const configured = !!(state.storage && state.storage.configured);
      const dock = document.getElementById('saveDock');
      const dockHint = document.getElementById('saveDockHint');
      const dockButton = document.getElementById('saveDockButton');
      let dirty = false;
      let hintText = '変更はありません';
      let buttonText = '保存';
      if (state.view === 'daily') {
        dirty = !!state.daily.dirty;
        hintText = state.daily.saving ? '自動保存中…' : dirty && !dailyHoursAreConfirmed() ? '0.25h単位で入力を確定すると自動保存' : dirty && state.daily.autoSaveDeferred ? '入力確定後に自動保存' : dirty ? '変更時に自動保存' : (state.daily.mode === 'edit' ? '自動保存済み' : '変更すると自動保存');
        buttonText = dirty ? '今すぐ保存' : 'この日を保存';
        document.getElementById('saveHint').textContent = hintText;
        document.getElementById('saveDaily').textContent = buttonText;
      } else if (state.view === 'planning') {
        const plannerDirty = !!state.planner.dirty;
        const dailyDirty = !!state.daily.dirty;
        dirty = plannerDirty || dailyDirty;
        hintText = state.planner.saving || state.daily.saving ? '自動保存中…' : dailyDirty && !dailyHoursAreConfirmed() ? '0.25h単位で入力を確定すると自動保存' : dailyDirty && plannerDirty ? '予定と実績を自動保存' : dailyDirty ? '実績を自動保存' : plannerDirty ? '予定を自動保存' : '自動保存済み';
        buttonText = dailyDirty && plannerDirty ? '変更を保存' : dailyDirty ? '実績を保存' : plannerDirty ? '予定を保存' : 'この週を保存';
        const savePlan = document.getElementById('savePlan');
        if (savePlan) savePlan.textContent = plannerDirty ? '今すぐ保存' : '予定を保存';
      } else if (state.view === 'month') {
        // 月の画面の予定の編集・ドラッグは、すぐ保存する（週の画面と同じ自動保存の表示）。
        dirty = !!(typeof monthPlanEdit !== 'undefined' && monthPlanEdit.dirty);
        const invalidEdit = typeof monthPlanEdit !== 'undefined' ? monthPlanEdit.invalid : '';
        hintText = state.month.saving ? '自動保存中…' : invalidEdit ? invalidEdit : dirty ? '変更時に自動保存' : '自動保存済み';
        buttonText = dirty ? '今すぐ保存' : '予定を保存';
      } else if (state.view === 'projects') {
        dirty = projectMonthEditorsDirty();
        const invalid = dirty ? projectMonthInvalidEntry() : null;
        hintText = state.project.monthSaving ? '自動保存中…'
          : invalid ? (invalid.project ? invalid.project.name + ': ' : '') + invalid.parsed.error
            : dirty && projectMonthYearNeedsFile(state.project.monthKey) ? '年次ファイル作成のため「今すぐ保存」で保存'
              : dirty ? '月次設定を自動保存' : '自動保存済み';
        buttonText = dirty ? '今すぐ保存' : '月次設定を保存';
      }
      const saving = !!(state.daily.savingAuto || state.planner.savingAuto || (state.view === 'projects' && state.project.monthSaving) || (state.view === 'month' && state.month.saving));
      if (saving) buttonText = '保存中…';
      if (dock) dock.classList.toggle('is-history-hidden', state.view === 'projects' || state.view === 'month');
      if (dockHint) dockHint.textContent = hintText;
      if (dockButton) {
        // 自動保存なので、保存は雲のアイコンだけで示し、状態と何を保存するかはマウスを乗せたときに出す。
        const icon = document.getElementById('saveDockIcon');
        if (icon) icon.textContent = dirty ? 'cloud_upload' : 'cloud_done';
        dockButton.title = saving ? hintText : hintText + '（押すと' + buttonText.replace(/^今すぐ/, '') + '）';
        dockButton.disabled = !configured;
      }
      if (dock) {
        dock.classList.toggle('is-dirty', dirty && !saving);
        dock.classList.toggle('is-saving', saving);
        dock.setAttribute('aria-busy', saving ? 'true' : 'false');
      }
      const spinner = document.getElementById('saveSpinner');
      if (spinner) spinner.hidden = !saving;
      document.body.classList.toggle('is-autosaving', saving);
      const boardHint = document.getElementById('weekBoardHint');
      const planSave = boardHint && boardHint.closest('.plan-save');
      if (boardHint && planSave) {
        if (!boardHint.dataset.idle) boardHint.dataset.idle = boardHint.textContent;
        const planningSaving = state.view === 'planning' && saving;
        planSave.classList.toggle('is-saving', planningSaving);
        boardHint.textContent = planningSaving ? '自動保存中…' : boardHint.dataset.idle;
      }
      // 今日の実績パネルは、日次の行の変更・保存の状態にそろえて更新する。
      if (typeof quickActual !== 'undefined' && quickActual.open) renderQuickActual();
    }

    async function savePlanningScreen() {
      const dailyDirty = !!state.daily.dirty;
      const plannerDirty = !!state.planner.dirty;
      if (dailyDirty) await saveDaily();
      if (plannerDirty || !dailyDirty) await savePlanner();
    }

    function weeklyPlanNameForId(planId) {
      const id = String(planId || '').trim();
      if (!id) return '';
      const item = dailyPlanItems().find(function(entry) { return entry && String(entry.id || '').trim() === id; });
      if (item && item.name) return item.name;
      const names = Object.keys(state.weeklyPlanMeta || {});
      for (let i = 0; i < names.length; i++) {
        if (String(((state.weeklyPlanMeta || {})[names[i]] || {}).planId || '').trim() === id) return names[i];
      }
      return '';
    }
    function parentNameForDaily(name, planId) {
      const fromId = weeklyPlanNameForId(planId);
      if (fromId) return fromId;
      return parentKeyForDailyName(name, (typeof state !== 'undefined' && state.weeklyPlanNames) || []);
    }

    function dailyPlanItems() {
      const workspace = dailyWeekWorkspaceFor(dailyWeekKey(state.daily.date));
      return workspace ? (workspace.items || []) : [];
    }
    function weeklySyncPlansForDaily() {
      const items = dailyPlanItems().filter(function(item) { return item && item.hasPlan !== false && String(item.name || '').trim(); });
      if (items.length) {
        return items.map(function(item) {
          return {
            aggregationKey: item.name,
            name: item.name,
            plannedHours: roundHours(item.planned),
            planned: roundHours(item.planned),
            planId: item.id,
            actualByDate: item.actualByDate || {},
            prevB: hoursBeforeDateFromActualByDate(item.actualByDate, state.daily.date)
          };
        });
      }
      return dailyParentNames(state.daily.date).map(function(name) {
        const meta = (state.weeklyPlanMeta || {})[name] || {};
        return {
          aggregationKey: name,
          name: name,
          plannedHours: roundHours(meta.plannedHours != null ? meta.plannedHours : meta.prevC),
          planned: roundHours(meta.plannedHours != null ? meta.plannedHours : meta.prevC),
          planId: meta.planId || '',
          prevB: roundHours(meta.prevB)
        };
      });
    }
    function applyWeeklyHoursToDailyRows(rows, date) {
      const target = date || state.daily.date;
      const plans = weeklySyncPlansForDaily();
      const subtasks = weeklySubtasksForDate(target);
      const hoursByExactName = dailyHoursBeforeByName(target, priorDailySources());
      const hoursByPlanChild = weeklyHoursByPlanChild(target);
      (rows || []).forEach(function(row) {
        const synced = weeklySyncedHoursForDaily(row, target, plans, subtasks, hoursByExactName, null, hoursByPlanChild);
        row.previous = synced.previous;
        row.estimate = synced.estimate;
      });
      return rows;
    }
    function updateDailySummary() {
      let total = 0, ongoing = 0;
      state.daily.rows.forEach(function(row) {
        total += numericHours(row.today);
        if (row.status === '完了') return;
        ongoing++;
      });
      document.getElementById('todayHours').textContent = liveHours(total);
      document.getElementById('dailyMobileTotal').textContent = compactHours(total);
      document.getElementById('dailyTotalHours').textContent = compactHours(total);
      document.getElementById('taskCount').textContent = state.daily.rows.length;
      document.getElementById('ongoingCount').textContent = '継続中 ' + ongoing + '件';
      fillDailyShareText();
      const forecast = peekWeekForecast(state.daily.date);
      if (forecast) {
        state.daily.agenda = dayAgendaFromForecast(forecast, state.daily.date, state.daily.rows);
        applyDailyProgress(state.daily.agenda);
        return;
      }
      applyDailyProgress(state.daily.agenda && state.daily.agenda.date === state.daily.date ? state.daily.agenda : null);
      if (state.calendarMode === 'day') loadDayAgenda();
    }

    function addDailyRow(source, focus) {
      syncDailyFromDom();
      const row = source || { id: uid('row-'), name: '', today: 0, previous: 0, estimate: 0, status: '', type: 'new' };
      if (!row.id) row.id = uid('row-');
      state.daily.rows.push(row);
      const list = activeDailyTaskList();
      const empty = list && (list.querySelector('.empty-row') || list.querySelector('.empty-state'));
      if (empty) (empty.closest('tr') || empty).remove();
      const el = buildTaskRow(row);
      if (list) list.appendChild(el);
      bindDailyDraggables(list);
      markDailyDirty();
      updateSaveDock();
      if (focus) {
        const today = el.querySelector('.today-value');
        if (today) today.focus();
      }
    }

    async function saveDaily(options) {
      options = options || {};
      const auto = !!options.auto;
      // 保存は1件ずつ送る（順番が入れ替わって古い内容で上書きしないように）。保存中の変更は終わったあとに送る。
      if (state.daily.saving) { state.daily.saveQueued = true; return; }
      if (auto && (state.daily.autoSaveDeferred || !dailyHoursAreConfirmed())) return;
      if (!dailyRowsBelongToViewedDate()) {
        cancelDailyAutoSave();
        if (!auto) toast('表示中の日付の実績を読み込み中のため保存できません。読み込み完了後にもう一度保存してください', 'error');
        return;
      }
      if (!state.storage || !state.storage.configured) {
        openPlanningSetup();
        return toast('保存する前にアプリ全体のDrive保存先を設定してください');
      }
      cancelDailyAutoSave();
      state.daily.autoSaveDeferred = false;
      syncDailyFromDom({ convertCalendarVariance: true });
      applyWeeklyHoursToDailyRows(state.daily.rows, state.daily.date);
      const saveSeq = state.daily.changeSeq;
      const saveDate = state.daily.loadedDate;
      const removedCalendarRows = removedDailyCalendarRows(saveDate);
      const savedRows = normalizeDailyRowsForSave(state.daily.rows);
      const tasks = savedRows.filter(function(row) { return row.name.trim() || numericHours(row.today) || numericHours(row.previous) || numericHours(row.estimate); }).map(function(row) {
        const interrupt = dailyRowIsInterrupt(row);
        return {
          name: row.name.trim(),
          a: row.today,
          b: interrupt ? 0 : row.previous,
          c: interrupt ? row.today : row.estimate,
          d: row.status,
          calendar: row.type === 'calendar' || row.type === 'calendar-imported',
          interrupt: interrupt,
          calendarInterrupt: dailyRowIsCalendarInterrupt(row),
          calendarKey: row.calendarKey || '',
          planId: row.planId || '',
          projectId: row.projectId || '',
          subtaskId: row.subtaskId || ''
        };
      });
      if (!auto) showBusy('日次ログを保存しています…');
      state.daily.savingAuto = auto;
      state.daily.saving = true;
      state.daily.savingSeq = saveSeq;
      state.nav.daily += 1;
      updateSaveDock();
      try {
        const url = await gas('saveToSpreadsheet', { date: saveDate, tasks: tasks });
        invalidateProjectSnapshots();
        state.daily.autoSaveRetryCount = 0;
        // 保存のあとの通信を待つ間にも入力は続くため、画面を書き換える直前に毎回確かめる。
        const isUnchanged = function() { return saveSeq === state.daily.changeSeq && saveDate === state.daily.date; };
        const unchanged = isUnchanged();
        const savedMode = tasks.length ? 'edit' : 'empty';
        let calendarSyncError = null;
        if (unchanged && removedCalendarRows.length) {
          try { await syncRemovedDailyCalendarRowsToPlanner(saveDate, removedCalendarRows); }
          catch (error) { calendarSyncError = error; }
        }
        if (isUnchanged()) {
          state.daily.rows = savedRows;
          state.daily.url = url;
          state.daily.mode = savedMode;
          state.daily.rows.forEach(function(row) {
            if (row.type !== 'calendar' && row.type !== 'calendar-imported' && row.type !== 'interrupt') row.type = 'saved';
          });
          state.daily.dirty = false;
          state.daily.autoSaveDeferred = false;
        }
        rememberDailySnapshot(saveDate, {
          mode: savedMode,
          spreadsheetUrl: url,
          importSource: [],
          needCalendar: true,
          tasks: savedRows.map(function(row) { return { title: row.name, hours: row.today, prevB: row.previous, prevC: row.estimate, status: row.status, type: row.type || 'saved', planId: row.planId || '', subtaskId: row.subtaskId || '', projectId: row.projectId || '', calendarKey: row.calendarKey || '' }; })
        });
        const weekKey = dailyWeekKey(saveDate);
        if (!auto || (unchanged && removedCalendarRows.length)) await refreshWeekWorkspaceAfterDailySave(weekKey);
        else if (unchanged && !removedCalendarRows.length) scheduleWeekWorkspaceRefresh(weekKey);
        if (isUnchanged()) {
          if (!auto) {
            try {
              const forecast = await ensureWeekForecastForDate(saveDate);
              if (saveDate === state.daily.date) state.daily.agenda = dayAgendaFromForecast(forecast, saveDate, state.daily.rows);
            } catch (_) {}
          } else {
            const forecast = peekWeekForecast(saveDate);
            if (forecast) state.daily.agenda = dayAgendaFromForecast(forecast, saveDate, state.daily.rows);
          }
          applyWeeklyHoursToDailyRows(state.daily.rows, saveDate);
          rememberDailyCalendarRows(saveDate);
          renderDaily();
        }
        if (calendarSyncError) toast('日次ログは保存しましたが、カレンダー予定の「実施しない」同期に失敗しました: ' + calendarSyncError.message, 'error');
        else if (!auto) toast('日次ログを保存しました', 'success');
        scheduleAutoGoogleTasksSync(googleTasksSyncMonthKey());
      } catch (error) {
        if (auto) state.daily.autoSaveRetryCount = Math.min(8, state.daily.autoSaveRetryCount + 1);
        toast((auto ? '自動保存に失敗しました: ' : '保存に失敗しました: ') + error.message, 'error');
      } finally {
        state.daily.saving = false;
        state.daily.savingAuto = false;
        if (!auto) hideBusy();
        updateSaveDock();
        if (state.daily.dirty) scheduleDailyAutoSave(auto && state.daily.autoSaveRetryCount ? autoSaveRetryDelay(state.daily.autoSaveRetryCount) : undefined);
        state.daily.saveQueued = false;
      }
    }

    async function reloadDaily() {
      if (state.daily.dirty && !await confirmDialog({
        title: '未完了タスクを再取得しますか？',
        message: '入力中の変更は破棄されます。',
        confirmLabel: '再取得する',
        cancelLabel: 'キャンセル',
        danger: true
      })) return;
      showBusy('未完了タスクを再取得しています…');
      const reloadDate = state.daily.date;
      try {
        const result = await gas('reloadDayAsNew', reloadDate);
        if (state.daily.date !== reloadDate) return;
        state.nav.daily += 1;
        rememberDailySnapshot(state.daily.date, result);
        delete state.calendarCache['day:' + state.daily.date];
        delete state.weekForecastCache[isoWeek(parseYmd(state.daily.date))];
        delete state.weeklySubtasksByWeek[isoWeek(parseYmd(state.daily.date))];
        state.daily.mode = result.mode || 'new';
        state.daily.url = result.spreadsheetUrl || '';
        state.daily.importSource = result.importSource || [];
        state.daily.needsCalendar = false;
        state.daily.calendarRowsAtLoad = [];
        state.daily.rows = (result.tasks || []).map(function(task) { return { id: uid('row-'), planId: task.planId || '', subtaskId: task.subtaskId || '', projectId: task.projectId || '', calendarKey: task.calendarKey || '', name: task.title || '', today: roundHours(task.hours), previous: roundHours(task.prevB), estimate: roundHours(task.prevC), status: dailyStatusIsComplete(task.status) ? '完了' : '', type: task.type || 'new' }; });
        await rememberDailyParentNames(state.daily.date);
        state.daily.rows.forEach(function(row) { classifyDailyRowType(row, state.daily.date); });
        try { state.daily.agenda = dayAgendaFromForecast(await ensureWeekForecastForDate(state.daily.date), state.daily.date, state.daily.rows); }
        catch (_) { state.daily.agenda = null; }
        applyDailyCalendarTasks(state.daily.date);
        linkDailyCalendarRows(state.daily.date);
        applyWeeklyHoursToDailyRows(state.daily.rows, state.daily.date);
        rememberDailyCalendarRows(state.daily.date);
        if (state.daily.date !== reloadDate) return;
        state.daily.loadedDate = reloadDate;
        renderDaily();
        markDailyDirty();
      } catch (error) { toast('再取得に失敗しました: ' + error.message, 'error'); }
      finally { hideBusy(); }
    }

    function existingNames() { syncDailyFromDom(); return state.daily.rows.map(function(row) { return row.name.trim(); }).filter(Boolean); }
    async function openCandidates(kind) {
      if (kind === 'interrupt') {
        state.candidateKind = kind;
        setCandidateDialogMode(kind);
        const dialog = document.getElementById('candidateDialog');
        showAppDialog(dialog);
        // 開く動きの途中では入力欄にフォーカスが当たらないので、開いた後で課題名の欄に当てる。
        const input = document.getElementById('dailyNewIssueTitle');
        if (input) {
          const focusName = function() { if (dialog.open || appDialogIsOpen(dialog)) input.focus(); };
          dialog.addEventListener('opened', focusName, { once: true });
          setTimeout(focusName, 300);
        }
        return;
      }
      showBusy('読み込んでいます…');
      try {
        const date = state.daily.date;
        const weekKey = isoWeek(parseYmd(date));
        let items = Object.prototype.hasOwnProperty.call(state.parentNamesByWeek || {}, weekKey)
          ? state.parentNamesByWeek[weekKey]
          : null;
        if (!items) {
          try { items = await loadImportSuggestions(date); }
          catch (error) {
            if (!sheetsQuotaError(error)) throw error;
            items = null;
          }
        }
        await rememberWeeklySubtasksForDate(date);
        if (items) {
          state.candidates = items;
          (items || []).forEach(function(item) {
            rememberWeeklyPlanName(item.title, { planId: item.planId, periodKey: item.periodKey, originWeek: item.originWeek, carryWeek: item.carryWeek, carry: !!(item.carryWeek || item.carry), prevB: item.prevB, prevC: item.prevC, plannedHours: item.prevC, calendarKey: item.calendarKey, projectId: item.projectId, startDate: item.startDate, endDate: item.endDate, undated: !!item.undated, done: item.done, completionOverride: item.completionOverride });
          });
          rememberWeeklySubtasksFromSuggestions(weekKey, items);
        } else if (!dailySelectablePlanSources(date).length) {
          throw new Error('シートの読み取りが混み合っています。1分ほど待ってから、もう一度開いてください。');
        }
        state.candidateKind = kind;
        const search = document.getElementById('candidateSearch');
        if (search) search.value = '';
        candidateSelectedKeys = {};
        candidateGroupOpen = {};
        setCandidateScope('current');
        setCandidateDialogMode(kind);
        renderCandidates();
        showAppDialog(document.getElementById('candidateDialog'));
      } catch (error) {
        toast(sheetsQuotaError(error) ? 'シートの読み取りが混み合っています。1分ほど待ってから、もう一度開いてください。' : ('候補の取得に失敗しました: ' + error.message), 'error');
      }
      finally { hideBusy(); }
    }

    function setCandidateDialogMode(kind) {
      const overlay = document.getElementById('candidateDialog');
      const interrupt = kind === 'interrupt';
      overlay.classList.toggle('is-composer-focus', interrupt);
      document.getElementById('candidateTitle').textContent = interrupt ? '今日だけの作業' : '週の課題から選ぶ';
      document.querySelector('#candidateDialog .candidate-week').hidden = interrupt;
      document.getElementById('dailyIssueComposer').hidden = !interrupt;
      document.getElementById('addCandidates').hidden = interrupt;
      document.getElementById('addDailyNewIssue').hidden = !interrupt;
    }

    function candidatePlanMatches(item, periodKey, planId, name) {
      if (!item) return false;
      const targetId = String(planId || '').trim();
      const itemId = String(item.id || item.planId || '').trim();
      if (targetId) return itemId === targetId;
      const targetName = String(name || '').trim();
      if (!targetName || String(item.name || item.title || item.aggregationKey || '').trim() !== targetName) return false;
      const itemPeriod = dailyPlanSourcePeriodKey(item, '');
      return !periodKey || !itemPeriod || itemPeriod === periodKey;
    }

    function releaseParentPlanCompletion(planId, name) {
      const update = function(item) {
        if (!item || item.completionOverride === false) return;
        if (!candidatePlanMatches(item, '', planId, name)) return;
        item.done = false;
        item.completionOverride = null;
        item.complete = false;
        item.dailyComplete = false;
        item.dailyTracked = true;
      };
      (state.daily.weekItems || []).forEach(update);
      (state.planner.items || []).forEach(update);
      (state.candidates || []).forEach(update);
      Object.keys(state.parentNamesByWeek || {}).forEach(function(weekKey) {
        (state.parentNamesByWeek[weekKey] || []).forEach(update);
      });
      [state.daily.weekSummary, state.planner.summary].forEach(function(summary) {
        (summary && summary.rows || []).forEach(function(row) {
          if (!row || row.completionOverride === false) return;
          if (!candidatePlanMatches({ id: row.planId, name: row.aggregationKey, periodKey: row.periodKey || row.originWeek }, '', planId, name)) return;
          row.done = false;
          row.completionOverride = null;
          row.complete = false;
          row.dailyComplete = false;
          row.dailyTracked = true;
        });
      });
      const meta = (state.weeklyPlanMeta || {})[name];
      if (meta && meta.completionOverride !== false && (!planId || String(meta.planId || '').trim() === String(planId).trim())) {
        meta.done = false;
        meta.completionOverride = null;
        meta.complete = false;
        meta.dailyComplete = false;
        meta.dailyTracked = true;
      }
      if (state.view === 'planning' && state.planner.summary) updatePlannerSummary();
    }

    function markCandidatePlanDoneLocally(periodKey, planId, name) {
      const update = function(item) {
        if (!candidatePlanMatches(item, periodKey, planId, name)) return;
        item.done = true;
        item.completionOverride = true;
        item.complete = true;
      };
      (state.daily.weekItems || []).forEach(update);
      (state.planner.items || []).forEach(update);
      (state.candidates || []).forEach(function(item) {
        if (candidatePlanMatches(item, periodKey, planId, name)) {
          item.done = true;
          item.completionOverride = true;
        }
      });
      Object.keys(state.parentNamesByWeek || {}).forEach(function(weekKey) {
        (state.parentNamesByWeek[weekKey] || []).forEach(function(item) {
          if (candidatePlanMatches(item, periodKey, planId, name)) {
            item.done = true;
            item.completionOverride = true;
          }
        });
      });
      [state.daily.weekSummary, state.planner.summary].forEach(function(summary) {
        (summary && summary.rows || []).forEach(function(row) {
          if (!candidatePlanMatches({ id: row.planId, name: row.aggregationKey, periodKey: row.periodKey || row.originWeek }, periodKey, planId, name)) return;
          row.done = true;
          row.completionOverride = true;
          row.complete = true;
        });
      });
      const meta = (state.weeklyPlanMeta || {})[name];
      if (meta && (!planId || String(meta.planId || '').trim() === String(planId).trim())) {
        meta.done = true;
        meta.completionOverride = true;
      }
      const weekKey = isoWeek(parseYmd(state.daily.date));
      delete state.weekForecastCache[weekKey];
      delete state.calendarCache[weekWorkspaceCacheKey(weekKey)];
    }

    async function completeCandidatePlan(button) {
      if (!button || button.disabled) return;
      const periodKey = String(button.dataset.periodKey || '').trim();
      const planId = String(button.dataset.planId || '').trim();
      const name = String(button.dataset.planName || '').trim();
      if (!periodKey || (!planId && !name)) return toast('完了にする週予定を特定できません', 'error');
      button.disabled = true;
      showBusy('週の課題を完了にしています…');
      try {
        await gas('setPlanningPlanDone', {
          periodType: 'week',
          periodKey: periodKey,
          planId: planId,
          aggregationKey: name,
          done: true
        });
        markCandidatePlanDoneLocally(periodKey, planId, name);
        renderCandidates();
        toast('「' + name + '」を完了にしました', 'success');
      } catch (error) {
        button.disabled = false;
        toast('週の課題を完了にできませんでした: ' + error.message, 'error');
      } finally {
        hideBusy();
      }
    }

    var candidateScope = 'current';
    var candidateSelectedKeys = {};
    var candidateCatalog = {};
    var candidateGroupOpen = {};
    function candidatePeriodLabel(periodKey, currentKey) {
      const key = String(periodKey || '').trim();
      if (!key || key === currentKey) return '';
      if (typeof previousWeekKey === 'function' && key === previousWeekKey(currentKey)) return '前週';
      if (typeof nextWeekKey === 'function' && key === nextWeekKey(currentKey)) return '来週';
      if (typeof mondayForWeek !== 'function') return key;
      const monday = mondayForWeek(key);
      if (!monday || isNaN(monday.getTime())) return key;
      return (monday.getUTCMonth() + 1) + '/' + monday.getUTCDate() + '週';
    }
    function candidateIssueKey(issue) {
      return [String(issue.planId || ''), String(issue.parent || ''), issue.isParent ? '' : String(issue.title || '')].join('\0');
    }
    function rememberCandidateIssue(issue) {
      candidateCatalog[candidateIssueKey(issue)] = {
        title: issue.parent,
        childName: issue.isParent ? '' : issue.title,
        planId: issue.planId || '',
        subtaskId: issue.isParent ? '' : String(issue.subtaskId || ''),
        plannedHours: roundHours(issue.plannedHours),
        previousHours: roundHours(issue.previousHours)
      };
    }
    function candidateIssueHtml(issue, showParent) {
      const planned = roundHours(issue.plannedHours);
      const previous = roundHours(issue.previousHours);
      const parent = String(issue.parent || '').trim();
      const title = String(issue.title || parent).trim();
      const meta = [];
      if (planned > 0) meta.push(hours(planned) + 'h');
      if (previous > 0) meta.push('前日まで ' + hours(previous) + 'h');
      const context = showParent && parent && title !== parent ? parent : '';
      const extra = !context && !meta.length ? dailyParentHoursLabel(issue.parent) : '';
      const tag = issue.isCalendar ? '<span class="candidate-tag">カレンダー</span>' : '';
      const hoursHtml = meta.length
        ? '<span class="candidate-hours"><span>' + escapeHtml(meta[0]) + '</span>' + (meta[1] ? '<small>' + escapeHtml(meta[1]) + '</small>' : '') + '</span>'
        : '';
      const selected = candidateSelectedKeys[candidateIssueKey(issue)] ? ' checked' : '';
      return '<div class="candidate' + (issue.isCalendar ? ' is-calendar' : '') + '"><label><md-checkbox touch-target="wrapper"' + selected + ' data-parent="' + escapeHtml(issue.parent) + '" data-title="' + escapeHtml(issue.isParent ? '' : issue.title) + '" data-plan-id="' + escapeHtml(issue.planId || '') + '" data-planned="' + hours(planned) + '" data-previous="' + hours(previous) + '"></md-checkbox><span class="candidate-copy"><strong>' + escapeHtml(title) + '</strong>' + (context || extra ? '<small>' + escapeHtml(context || extra) + '</small>' : '') + '</span>' + hoursHtml + tag + '</label></div>';
    }
    function candidateCompleteButton(group) {
      if (!group.canComplete) return '';
      return '<md-text-button class="candidate-complete" data-period-key="' + escapeHtml(group.periodKey || '') + '" data-plan-id="' + escapeHtml(group.planId || '') + '" data-plan-name="' + escapeHtml(group.parent) + '" aria-label="' + escapeHtml(group.parent) + 'を完了にする">完了にする</md-text-button>';
    }
    function candidateGroupKey(group) {
      return [String(group.planId || ''), String(group.periodKey || ''), String(group.parent || '')].join('\u001f');
    }
    // 今週の候補は、この週の終わりまでに始まる予定（期限を過ぎて続いている予定も含む）。
    // それより後に始まる予定は「これから」に分け、前倒しで今日に入れられるようにする。
    function candidateStartsByWeekEnd(group, currentKey) {
      if (group.undated) return !group.periodKey || group.periodKey <= currentKey;
      if (!group.range) return !group.periodKey || group.periodKey === currentKey;
      const weekStart = weekKeyStartYmd(currentKey);
      return !weekStart || group.range.start < addDaysYmd(weekStart, 7);
    }
    function candidateRangeHtml(group) {
      if (group.undated) return '<small class="candidate-period">期間未定</small>';
      if (!group.range) return '';
      const label = planRangeLabel(group.range);
      if (group.position === 'before') return '<small class="candidate-period is-early" title="開始日より前に着手します">' + escapeHtml(label) + ' · 前倒し</small>';
      if (group.position === 'after') return '<small class="candidate-period is-late" title="終了日を過ぎています">' + escapeHtml(label) + ' · 期限超過</small>';
      return '<small class="candidate-period">' + escapeHtml(label) + '</small>';
    }
    function candidateGroupHtml(group, currentKey, hideWeek, forceOpen) {
      const currentWeek = candidateStartsByWeekEnd(group, currentKey);
      const weekLabel = hideWeek ? '' : candidatePeriodLabel(group.periodKey, currentKey);
      const rangeHtml = candidateRangeHtml(group);
      const completeButton = candidateCompleteButton(group);
      const nested = group.issues.some(function(issue) { return !issue.isParent; });
      if (!nested) {
        const items = group.issues.map(function(issue) { return candidateIssueHtml(issue, true); }).join('');
        const empty = !items && group.canComplete
          ? '<p class="candidate-group-empty">同名の今日だけの作業があるため、追加できません。前週の課題を完了にできます。</p>'
          : '';
        const week = weekLabel ? '<small class="candidate-week-label">' + escapeHtml(weekLabel) + '</small>' : '';
        return '<div class="candidate-flat" data-week="' + (currentWeek ? 'current' : 'upcoming') + '">' + (items || empty) + rangeHtml + week + completeButton + '</div>';
      }
      const key = candidateGroupKey(group);
      const open = !!(forceOpen || candidateGroupOpen[key]);
      const selected = group.issues.filter(function(issue) { return candidateSelectedKeys[candidateIssueKey(issue)]; }).length;
      const countLabel = (selected ? selected + '/' : '') + group.issues.length + '件';
      const items = group.issues.map(function(issue) { return candidateIssueHtml(issue, false); }).join('');
      const week = rangeHtml + (weekLabel ? '<small>' + escapeHtml(weekLabel) + '</small>' : '');
      return '<section class="candidate-group' + (open ? ' is-open' : '') + (selected ? ' has-selected' : '') + '" data-group-key="' + escapeHtml(key) + '"><div class="candidate-group-head"><button type="button" class="candidate-group-toggle" aria-expanded="' + (open ? 'true' : 'false') + '"><span class="material-symbols-outlined candidate-group-icon" aria-hidden="true">' + (open ? 'expand_more' : 'chevron_right') + '</span><span class="candidate-group-copy"><span class="candidate-group-title">' + escapeHtml(group.parent) + '</span>' + week + '</span><span class="candidate-group-count">' + escapeHtml(countLabel) + '</span></button>' + completeButton + '</div><div class="candidate-group-items"' + (open ? '' : ' hidden') + '>' + items + '</div></section>';
    }
    function toggleCandidateGroup(button) {
      const group = button && button.closest('.candidate-group');
      if (!group) return;
      const key = group.dataset.groupKey || '';
      const open = !group.classList.contains('is-open');
      if (key) candidateGroupOpen[key] = open;
      group.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      const icon = button.querySelector('.candidate-group-icon');
      if (icon) icon.textContent = open ? 'expand_more' : 'chevron_right';
      const items = group.querySelector('.candidate-group-items');
      if (items) items.hidden = !open;
    }
    function syncCandidateGroupSelection() {
      document.querySelectorAll('#candidateList .candidate-group').forEach(function(group) {
        const boxes = group.querySelectorAll('md-checkbox');
        let selected = 0;
        boxes.forEach(function(box) { if (box.checked) selected += 1; });
        const count = group.querySelector('.candidate-group-count');
        if (count) count.textContent = (selected ? selected + '/' : '') + boxes.length + '件';
        group.classList.toggle('has-selected', selected > 0);
      });
    }
    function candidateBoxKey(box) {
      return [String(box.dataset.planId || ''), String(box.dataset.parent || ''), String(box.dataset.title || '')].join('\0');
    }
    function syncCandidateAction() {
      document.querySelectorAll('#candidateList md-checkbox').forEach(function(box) {
        const key = candidateBoxKey(box);
        if (box.checked) candidateSelectedKeys[key] = true;
        else delete candidateSelectedKeys[key];
        const row = box.closest('.candidate');
        if (row) row.classList.toggle('is-selected', !!box.checked);
      });
      const button = document.getElementById('addCandidates');
      if (!button) return;
      const count = selectedCandidates().length;
      button.disabled = count === 0;
      button.textContent = count ? count + '件を今日に入れる' : '選んだ課題を入れる';
      syncCandidateGroupSelection();
    }
    function setCandidateScope(scope) {
      candidateScope = scope === 'upcoming' ? 'upcoming' : 'current';
      document.querySelectorAll('#candidateScope [data-scope]').forEach(function(button) {
        const active = button.dataset.scope === candidateScope;
        setUiChoice(button, active);
      });
    }
    function renderCandidates() {
      const list = document.getElementById('candidateList');
      const groups = dailySelectableIssues(state.daily.date);
      const query = String((document.getElementById('candidateSearch') || {}).value || '').trim().toLowerCase();
      const currentKey = state.daily.date ? isoWeek(parseYmd(state.daily.date)) : '';
      candidateCatalog = {};
      let currentCount = 0;
      let upcomingCount = 0;
      groups.forEach(function(group) {
        if (candidateStartsByWeekEnd(group, currentKey)) currentCount += group.issues.length;
        else upcomingCount += group.issues.length;
        group.issues.forEach(rememberCandidateIssue);
      });
      document.querySelectorAll('#candidateScope [data-scope]').forEach(function(button) {
        const label = button.dataset.scope === 'current' ? '今週' : 'これから';
        const count = button.dataset.scope === 'current' ? currentCount : upcomingCount;
        button.label = label + ' ' + count;
      });
      if (!groups.length) {
        list.innerHTML = dailyParentNames(state.daily.date).length
          ? emptyStateHtml('今日に入れられる週の課題はありません', '予定にない作業は、一覧下の「今日だけの作業」から記録できます。')
          : emptyStateHtml('この週の予定はまだありません', '先に週予定を作るか、一覧下の「今日だけの作業」から記録してください。');
        syncCandidateAction();
        return;
      }
      const visible = [];
      const upcomingBuckets = [];
      const bucketByKey = {};
      groups.forEach(function(group) {
        const currentWeek = candidateStartsByWeekEnd(group, currentKey);
        const issues = group.issues.filter(function(issue) {
          if (!query) return true;
          const parent = String(group.parent || '').toLowerCase();
          const title = String(issue.title || '').toLowerCase();
          return parent.indexOf(query) >= 0 || title.indexOf(query) >= 0;
        });
        if (query && !issues.length) return;
        if (!query && candidateScope === 'current' && !currentWeek) return;
        if (!query && candidateScope === 'upcoming' && currentWeek) return;
        const view = { parent: group.parent, planId: group.planId, periodKey: group.periodKey, canComplete: group.canComplete, range: group.range, undated: group.undated, position: group.position, issues: issues };
        const html = candidateGroupHtml(view, currentKey, query ? currentWeek : true, !!query);
        if (query || currentWeek) {
          visible.push(html);
          return;
        }
        // これから始まる予定は、開始日の週ごとにまとめる。
        const key = group.range && !group.undated ? isoWeek(parseYmd(group.range.start)) : String(group.periodKey || '');
        if (!bucketByKey[key]) {
          bucketByKey[key] = { key: key, label: (candidatePeriodLabel(key, currentKey) || key) + 'から', html: [] };
          upcomingBuckets.push(bucketByKey[key]);
        }
        bucketByKey[key].html.push(html);
      });
      upcomingBuckets.sort(function(left, right) { return left.key < right.key ? -1 : left.key > right.key ? 1 : 0; });
      const body = query || candidateScope === 'current'
        ? visible.join('')
        : upcomingBuckets.map(function(bucket) {
          return '<section class="candidate-week-block"><p class="candidate-week-heading">' + escapeHtml(bucket.label) + '</p>' + bucket.html.join('') + '</section>';
        }).join('');
      list.innerHTML = body || '<p class="candidate-empty">' + (query ? '一致する課題はありません' : (candidateScope === 'upcoming' ? 'これから始まる課題はありません' : '今週の候補はありません')) + '</p>';
      list.querySelectorAll('md-checkbox').forEach(function(box) {
        if (candidateSelectedKeys[candidateBoxKey(box)]) box.checked = true;
      });
      Object.keys(candidateSelectedKeys).forEach(function(key) {
        if (!candidateCatalog[key]) delete candidateSelectedKeys[key];
      });
      syncCandidateAction();
    }

    function selectedCandidates() {
      return Object.keys(candidateSelectedKeys).map(function(key) {
        return candidateCatalog[key];
      }).filter(Boolean);
    }
    function closeCandidates() {
      const overlay = document.getElementById('candidateDialog');
      hideAppDialog(overlay);
      document.getElementById('dailyNewIssueTitle').value = '';
      candidateSelectedKeys = {};
      candidateCatalog = {};
      candidateGroupOpen = {};
      const search = document.getElementById('candidateSearch');
      if (search) search.value = '';
      setCandidateScope('current');
      overlay.addEventListener('closed', function() {
        if (overlay.open) return;
        overlay.classList.remove('is-composer-focus');
      }, { once: true });
    }
    function addSelectedCandidates() {
      const selected = selectedCandidates();
      const existing = existingNames();
      let added = 0;
      let skipped = 0;
      selected.forEach(function(task) {
        const name = composeDailyChildName(task.title, task.childName);
        if (!name) return;
        if (existing.indexOf(name) >= 0) { skipped++; return; }
        const draft = { id: uid('row-'), planId: task.planId || '', subtaskId: task.subtaskId || '', name: name, today: 0, previous: roundHours(task.previousHours), estimate: roundHours(task.plannedHours), status: '', type: 'new' };
        applyWeeklyHoursToDailyRows([draft], state.daily.date);
        if (!(Number(draft.previous) > 0) && Number(task.previousHours) > 0) draft.previous = roundHours(task.previousHours);
        if (!(Number(draft.estimate) > 0) && Number(task.plannedHours) > 0) draft.estimate = roundHours(task.plannedHours);
        if (draft.previous > 0) draft.type = 'ongoing';
        addDailyRow(draft, false);
        existing.push(name);
        added++;
      });
      if (added) closeCandidates();
      if (added) toast(added + '件を今日の実績に入れました', 'success');
      else if (skipped) toast('同じ名前のタスクが既にあります');
      else toast('週の課題を選んでください');
    }
    function fillDailyShareText() {
      const area = document.getElementById('reportText');
      if (!area) return;
      area.value = state.daily.rows.filter(function(row) { return String(row.name || '').trim() || row.today || row.previous || row.estimate; }).map(dailyShareLine).join('\n');
    }
    function generateReport() {
      syncDailyFromDom();
      fillDailyShareText();
    }
    async function copyReport() {
      generateReport();
      const text = document.getElementById('reportText').value;
      if (!text) return toast('コピーする内容がありません', 'error');
      try { await navigator.clipboard.writeText(text); toast('共有テキストをコピーしました', 'success'); }
      catch (_) { const area = document.getElementById('reportText'); area.select(); document.execCommand('copy'); toast('共有テキストをコピーしました', 'success'); }
    }

    const AWAY_DEFAULT_MINUTES = 10;
    const AWAY_SUSPEND_GAP_MS = 90000;
    const AWAY_RESUME_CONFIRM_MS = 120000;
    function awayMinutesValue(value) {
      const minutes = Math.round(Number(value));
      if (!Number.isFinite(minutes) || minutes < 1) return AWAY_DEFAULT_MINUTES;
      return Math.min(240, minutes);
    }
    function awaySettings() {
      const prefs = (typeof state !== 'undefined' && state && state.uiPreferences) || {};
      return { enabled: prefs.awayDetection !== false, ms: awayMinutesValue(prefs.awayMinutes) * 60000 };
    }
    function awayRecordHours(ms) {
      return Math.max(.25, roundHours(ms / 3600000));
    }
    function awayGapShouldPrompt(ms) {
      const settings = awaySettings();
      return settings.enabled && ms >= settings.ms;
    }
    function timerElapsed() {
      if (!state.timer) return 0;
      return state.timer.accumulated + (state.timer.running ? Date.now() - state.timer.startedAt : 0);
    }
    function presenceIsAway() {
      const idle = state.idle || {};
      return idle.user === 'idle' || idle.screen === 'locked';
    }
    function idleDetectorThreshold() {
      return Math.max(60000, awaySettings().ms);
    }
    function stopIdleWatch() {
      if (!state.idle) return;
      if (state.idle.controller) state.idle.controller.abort();
      state.idle.controller = null;
      state.idle.detector = null;
      state.idle.threshold = 0;
      state.idle.user = 'active';
      state.idle.screen = 'unlocked';
      state.idle.awaySince = 0;
    }
    function ensureIdleWatch() {
      if (!state.idle) return;
      if (!awaySettings().enabled) return stopIdleWatch();
      if (state.idle.detector && state.idle.threshold !== idleDetectorThreshold()) stopIdleWatch();
      if (!window.IdleDetector || state.idle.detector || state.idle.starting || state.idle.permission === 'denied') return;
      state.idle.starting = true;
      IdleDetector.requestPermission().then(function(result) {
        state.idle.permission = result;
        if (result !== 'granted' || !state.timer || !state.timer.running || state.idle.detector || !awaySettings().enabled) return;
        const detector = new IdleDetector();
        const controller = new AbortController();
        const threshold = idleDetectorThreshold();
        detector.addEventListener('change', onIdleChange);
        return detector.start({ threshold: threshold, signal: controller.signal }).then(function() {
          state.idle.detector = detector;
          state.idle.controller = controller;
          state.idle.threshold = threshold;
          state.idle.user = detector.userState || 'active';
          state.idle.screen = detector.screenState || 'unlocked';
        });
      }).catch(function() {}).then(function() { state.idle.starting = false; });
    }
    function clearAwayCandidate() {
      if (!state.timer) return;
      delete state.timer.awayFrom;
      delete state.timer.awayUntil;
    }
    // 離席の開始は「最後に在席を確認できた時刻」。スリープ中にtickが散発しても開始は動かさない。
    function markAwayCandidate(from, until) {
      if (!state.timer || !state.timer.running) return;
      const start = Math.max(from, state.timer.startedAt || from);
      if (!state.timer.awayFrom || start < state.timer.awayFrom) state.timer.awayFrom = start;
      if (until) state.timer.awayUntil = Math.max(state.timer.awayUntil || 0, until);
      persistTimer();
    }
    function settleAway(end) {
      if (!state.timer || !state.timer.awayFrom) return;
      const start = state.timer.awayFrom;
      clearAwayCandidate();
      persistTimer();
      if (end > start) noteAway(start, end);
    }
    function onIdleChange() {
      const detector = state.idle && state.idle.detector;
      if (!detector) return;
      state.idle.user = detector.userState || 'active';
      state.idle.screen = detector.screenState || 'unlocked';
      if (!state.timer || !state.timer.running || !awaySettings().enabled) {
        state.idle.awaySince = 0;
        return;
      }
      const now = Date.now();
      if (presenceIsAway()) {
        // 「idle」は閾値の間ずっと操作が無かったという意味なので、その分さかのぼる。
        const since = state.idle.user === 'idle' ? now - (state.idle.threshold || idleDetectorThreshold()) : now;
        if (!state.idle.awaySince || since < state.idle.awaySince) state.idle.awaySince = since;
        markAwayCandidate(since, 0);
        return;
      }
      state.idle.awaySince = 0;
      if (state.idle.dialog) return;
      settleAway(now);
    }
    function noteUserActivity() {
      if (!state.timer || !state.timer.running || !state.timer.awayFrom || (state.idle && state.idle.dialog)) return;
      const end = state.idle && state.idle.awaySince ? Date.now() : (state.timer.awayUntil || Date.now());
      if (state.idle) state.idle.awaySince = 0;
      settleAway(end);
    }
    function noteTimerPresence() {
      if (!state.timer || !state.timer.running || (state.idle && state.idle.dialog)) return;
      const now = Date.now();
      const lastTick = state.timer.lastSeenAt || state.timer.startedAt || now;
      state.timer.lastSeenAt = now;
      if (!awaySettings().enabled) {
        if (state.timer.awayFrom) { clearAwayCandidate(); persistTimer(); }
      } else if (now - lastTick >= AWAY_SUSPEND_GAP_MS) {
        // tickが長く止まっていた＝スリープ・蓋閉じ。止まる直前を離席開始にする。
        markAwayCandidate(lastTick, now);
        return;
      } else if (state.timer.awayFrom && state.timer.awayUntil && !presenceIsAway() && now - state.timer.awayUntil >= AWAY_RESUME_CONFIRM_MS) {
        // 復帰後しばらく途切れず動いていれば、復帰した時刻で離席を確定する。
        settleAway(state.timer.awayUntil);
        return;
      }
      if (!state.timer.seenSavedAt || now - state.timer.seenSavedAt > 15000) {
        state.timer.seenSavedAt = now;
        persistTimer();
      }
    }
    function noteAway(start, end) {
      if (!state.timer || !state.timer.running || !state.idle || state.idle.dialog) return;
      const from = Math.max(start, state.timer.startedAt || start);
      const to = end;
      const span = to - from;
      if (!awayGapShouldPrompt(span)) return;
      const hoursValue = awayRecordHours(span);
      const kept = Math.max(0, timerElapsed() - span);
      const now = Date.now();
      state.timer.accumulated = kept;
      state.timer.startedAt = now;
      state.timer.lastSeenAt = now;
      clearAwayCandidate();
      state.idle.awaySince = 0;
      state.idle.dialog = { start: from, end: to, ms: span, hours: hoursValue, rowId: state.timer.rowId, task: state.timer.task || '' };
      persistTimer();
      renderTimer();
      const when = document.getElementById('awayDialogWhen');
      const hoursEl = document.getElementById('awayDialogHours');
      const hint = document.getElementById('awayDialogTaskName');
      const select = document.getElementById('awayDialogTask');
      const name = document.getElementById('awayDialogName');
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const label = pad2(fromDate.getHours()) + ':' + pad2(fromDate.getMinutes()) + '–' + pad2(toDate.getHours()) + ':' + pad2(toDate.getMinutes());
      if (when) when.textContent = label;
      if (hoursEl) hoursEl.textContent = hours(hoursValue);
      if (hint) {
        hint.textContent = state.idle.dialog.task || '';
        if (hint.parentElement) hint.parentElement.hidden = !hint.textContent;
      }
      if (select) {
        const options = state.daily.rows.filter(function(row) {
          return row.id !== state.timer.rowId && String(row.name || '').trim();
        });
        fillSelect(select, [{ value: '', label: '作業を選択' }].concat(options.map(function(row) {
          return { value: row.id, label: row.name };
        })), '');
      }
      if (name) name.value = '';
      const dialog = document.getElementById('awayDialog');
      if (dialog) showAppDialog(dialog);
      const buddy = dialog && dialog.querySelector('.away-buddy');
      if (buddy) {
        buddy.classList.remove('is-waving');
        void buddy.offsetWidth;
        buddy.classList.add('is-waving');
      }
    }
    function closeAwayDialog() {
      const dialog = document.getElementById('awayDialog');
      if (dialog) hideAppDialog(dialog);
      if (state.idle) state.idle.dialog = null;
    }
    function addAwayHours(rowId, name, hoursValue) {
      syncDailyFromDom();
      const title = String(name || '').trim();
      let id = rowId;
      if (title) {
        const existing = state.daily.rows.find(function(row) { return String(row.name || '').trim() === title; });
        if (existing) id = existing.id;
        else {
          addDailyRow({
            id: uid('row-'),
            planId: '',
            projectId: typeof defaultAssignedProjectId === 'function' ? defaultAssignedProjectId() : '',
            name: title,
            today: hoursValue,
            previous: 0,
            estimate: hoursValue,
            status: '',
            type: 'interrupt'
          }, false);
          return title;
        }
      }
      const list = activeDailyTaskList();
      const el = list && list.querySelector('.work-card[data-id="' + id + '"]');
      if (!el) return '';
      const input = el.querySelector('.today-value');
      if (input) input.value = hours(Number(input.value) + hoursValue);
      markDailyDirty();
      syncDailyRowStatus(el);
      const row = state.daily.rows.find(function(item) { return item.id === id; });
      return row ? row.name : title;
    }
    function resolveAwayDialog(action) {
      const pending = state.idle && state.idle.dialog;
      if (!pending) return closeAwayDialog();
      if (action === 'keep' && state.timer) {
        state.timer.accumulated += pending.ms;
        persistTimer();
        renderTimer();
        closeAwayDialog();
        return;
      }
      if (action === 'move') {
        const name = document.getElementById('awayDialogName').value.trim();
        const rowId = document.getElementById('awayDialogTask').value;
        if (!name && !rowId) return toast('記録する作業を選ぶか、入力してください', 'error');
        const recordedName = addAwayHours(rowId, name, pending.hours);
        closeAwayDialog();
        toast(hours(pending.hours) + 'h を' + (recordedName || '別タスク') + 'に記録しました', 'success');
        return;
      }
      closeAwayDialog();
      toast('離席中の ' + hours(pending.hours) + 'h は休憩にしました', 'success');
    }
    function formatClock(ms) {
      const sec = Math.floor(ms / 1000);
      return pad2(Math.floor(sec / 3600)) + ':' + pad2(Math.floor(sec % 3600 / 60)) + ':' + pad2(sec % 60);
    }
    function persistTimer() { try { if (state.timer) localStorage.setItem(TIMER_KEY, JSON.stringify(state.timer)); else localStorage.removeItem(TIMER_KEY); } catch (_) {} }
    function restoreTimer() {
      if (!state.timer) {
        try { state.timer = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); } catch (_) { state.timer = null; }
      }
      if (state.timer && !state.timer.lastSeenAt) state.timer.lastSeenAt = Date.now();
      renderTimer();
      if (state.timer && state.timer.running) ensureIdleWatch();
    }
    function timerRowId(row) {
      if (!row) return '';
      if (row.dataset) return String(row.dataset.id || '');
      return String(row.id || '');
    }
    function timerRowPlanId(row) {
      if (!row) return '';
      if (row.dataset) return String(row.dataset.planId || '').trim();
      return String(row.planId || '').trim();
    }
    function timerRowCalendarKey(row) {
      if (!row) return '';
      if (row.dataset) return String(row.dataset.calendarKey || '').trim();
      return String(row.calendarKey || '').trim();
    }
    function timerRowName(row) {
      if (!row) return '';
      if (row.dataset) return composedDailyNameFromRow(row);
      return String(row.name || '').trim();
    }
    function timerIdentityMatches(planId, calendarKey, name, timer) {
      const timerPlan = String(timer && timer.planId || '').trim();
      const timerCalendar = String(timer && timer.calendarKey || '').trim();
      const timerName = String(timer && timer.task || '').trim();
      const sameName = !timerName || !name || timerName === name;
      if (timerPlan) return !!(planId && timerPlan === planId && sameName);
      if (timerCalendar) return !!(calendarKey && timerCalendar === calendarKey && sameName);
      return !!(timerName && name && timerName === name);
    }
    function timerRowIsActive(row) {
      if (!state.timer || !row) return false;
      const id = timerRowId(row);
      if (id && id === state.timer.rowId) return true;
      if (state.daily.date !== state.timer.date) return false;
      return timerIdentityMatches(timerRowPlanId(row), timerRowCalendarKey(row), timerRowName(row), state.timer);
    }
    function rebindTimerRow() {
      if (!state.timer || state.daily.date !== state.timer.date) return;
      const rows = state.daily.rows || [];
      if (rows.some(function(row) { return row.id === state.timer.rowId; })) return;
      const match = rows.find(timerRowIsActive);
      if (!match) return;
      state.timer.rowId = match.id;
      if (!state.timer.planId && match.planId) state.timer.planId = match.planId;
      if (!state.timer.calendarKey && match.calendarKey) state.timer.calendarKey = match.calendarKey;
      persistTimer();
    }
    function startTimer(rowId, confirmed) {
      syncDailyFromDom();
      const existing = state.daily.rows.find(function(item) { return item.id === rowId; });
      if (state.timer && (state.timer.rowId === rowId || timerRowIsActive(existing))) {
        if (state.timer.rowId !== rowId) {
          state.timer.rowId = rowId;
          persistTimer();
        }
        togglePauseTimer();
        return;
      }
      if (state.timer && !confirmed) {
        confirmDialog({
          title: '計測を切り替えますか？',
          message: 'いまの計測を停止して、新しい計測を始めます。',
          confirmLabel: '切り替える',
          cancelLabel: '今の計測を続ける'
        }).then(function(ok) { if (ok) startTimer(rowId, true); });
        return;
      }
      if (state.timer) finishTimer(false);
      const row = state.daily.rows.find(function(item) { return item.id === rowId; });
      const now = Date.now();
      state.timer = { rowId: rowId, task: row ? row.name : '', planId: row ? (row.planId || '') : '', calendarKey: row ? (row.calendarKey || '') : '', date: state.daily.date, startedAt: now, accumulated: 0, running: true, lastSeenAt: now };
      if (state.idle) state.idle.awaySince = 0;
      persistTimer();
      renderTimer();
      ensureIdleWatch();
    }
    function togglePauseTimer() {
      if (!state.timer) return;
      if (state.timer.running) { state.timer.accumulated += Date.now() - state.timer.startedAt; state.timer.running = false; }
      else { state.timer.startedAt = Date.now(); state.timer.running = true; }
      state.timer.lastSeenAt = Date.now();
      clearAwayCandidate();
      if (state.idle) state.idle.awaySince = 0;
      persistTimer();
      renderTimer();
      if (state.timer.running) ensureIdleWatch();
    }
    function finishTimer(record) {
      if (!state.timer) return;
      rebindTimerRow();
      const elapsed = timerElapsed();
      const rowId = state.timer.rowId;
      state.timer = null;
      if (state.idle) state.idle.awaySince = 0;
      closeAwayDialog();
      persistTimer();
      clearInterval(state.timerTick);
      state.timerTick = null;
      if (record && elapsed >= 30000) {
        const list = activeDailyTaskList();
        const el = list && list.querySelector('.work-card[data-id="' + rowId + '"]');
        if (el) {
          const input = el.querySelector('.today-value');
          const addition = Math.max(.25, Math.round(elapsed / 3600000 * 4) / 4);
          input.value = hours(Number(input.value) + addition);
          markDailyDirty();
          syncDailyRowStatus(el);
          showRecordedDailyRow(el.dataset.id, addition);
          const taskName = composedDailyNameFromRow(el);
          toast((taskName ? '「' + taskName + '」の本日実績に ' : '本日実績に ') + hours(addition) + 'h を記録しました', 'success');
        }
      }
      renderTimer();
    }
    let recordedRowTimer = null;
    let recordedRowId = '';
    let recordedRowAddition = 0;
    let recordedRowStartedAt = 0;
    let recordedRowUntil = 0;
    function recordedDailyMarkHtml(rowId) {
      if (!rowId || rowId !== recordedRowId || Date.now() > recordedRowUntil) return '';
      return '<span class="recorded-delta">+' + escapeHtml(hours(recordedRowAddition)) + 'h</span>';
    }
    function clearRecordedDailyRow() {
      recordedRowId = '';
      recordedRowAddition = 0;
      recordedRowStartedAt = 0;
      recordedRowUntil = 0;
      document.querySelectorAll('.work-card.is-recorded').forEach(function(row) { row.classList.remove('is-recorded'); });
      document.querySelectorAll('.recorded-delta').forEach(function(mark) { mark.remove(); });
    }
    function scheduleRecordedDailyRowClear() {
      clearTimeout(recordedRowTimer);
      recordedRowTimer = setTimeout(clearRecordedDailyRow, Math.max(0, recordedRowUntil - Date.now()));
    }
    function placeRecordedDelta(el) {
      const field = el.querySelector('.today-value');
      const mark = el.querySelector('.recorded-delta');
      const cell = field && (field.closest('td') || field.parentElement);
      if (!field || !mark || !cell) return;
      const fieldRect = field.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      mark.style.left = (fieldRect.left + fieldRect.width / 2 - cellRect.left) + 'px';
      mark.style.top = (fieldRect.top - cellRect.top) + 'px';
    }
    function repositionRecordedDelta() {
      if (!recordedRowId || Date.now() > recordedRowUntil) return;
      const list = activeDailyTaskList();
      if (!list) return;
      const rows = list.querySelectorAll('.work-card');
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].dataset.id !== recordedRowId) continue;
        placeRecordedDelta(rows[i]);
        return;
      }
    }
    function installRecordedDeltaListener() {
      if (placeRecordedDelta.listening) return;
      placeRecordedDelta.listening = true;
      window.addEventListener('resize', repositionRecordedDelta);
    }
    function applyRecordedDailyRow() {
      if (!recordedRowId || Date.now() > recordedRowUntil) return;
      const list = activeDailyTaskList();
      if (!list) return;
      const rows = list.querySelectorAll('.work-card');
      let el = null;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].dataset.id === recordedRowId) { el = rows[i]; break; }
      }
      document.querySelectorAll('.work-card.is-recorded').forEach(function(row) {
        if (row !== el) row.classList.remove('is-recorded');
      });
      if (!el) return;
      const cell = el.querySelector('.today-cell');
      if (cell && !cell.querySelector('.recorded-delta')) cell.insertAdjacentHTML('afterbegin', recordedDailyMarkHtml(recordedRowId));
      placeRecordedDelta(el);
      el.style.setProperty('--recorded-delay', '-' + Math.max(0, Date.now() - recordedRowStartedAt) + 'ms');
      el.classList.add('is-recorded');
      scheduleRecordedDailyRowClear();
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function showRecordedDailyRow(rowId, addition) {
      if (!rowId) return;
      recordedRowId = rowId;
      recordedRowAddition = addition;
      recordedRowStartedAt = Date.now();
      recordedRowUntil = recordedRowStartedAt + 700;
      applyRecordedDailyRow();
    }
    function cancelTimer() {
      if (!state.timer) return;
      confirmDialog({
        title: '計測をキャンセルしますか？',
        message: '計測した時間は記録されません。',
        confirmLabel: '計測をキャンセル',
        cancelLabel: '計測を続ける',
        danger: true
      }).then(function(ok) {
        if (!ok || !state.timer) return;
        finishTimer(false);
        toast('計測をキャンセルしました');
      });
    }
    function syncTimerButton(button) {
      if (!button) return;
      const row = button.closest('.work-card');
      const active = !!(row && timerRowIsActive(row));
      const running = active && !!state.timer.running;
      button.classList.toggle('is-running', running);
      button.classList.toggle('is-paused', active && !running);
      const icon = button.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = running ? 'pause' : 'play_arrow';
      const timerLabel = running ? '一時停止' : active ? '再開' : '計測を開始';
      button.setAttribute('aria-label', timerLabel);
      button.setAttribute('title', timerLabel);
    }
    function timerOnMeasuredDay() {
      return !!(state.timer && state.view === 'daily' && state.daily.date === state.timer.date);
    }
    function renderTimer() {
      const ribbon = document.getElementById('timerRibbon');
      const presence = document.getElementById('timerPresence');
      const onMeasuredDay = timerOnMeasuredDay();
      if (ribbon) {
        ribbon.hidden = false;
        ribbon.classList.toggle('is-idle', !onMeasuredDay);
        if (!onMeasuredDay) {
          ribbon.classList.remove('is-paused');
          document.getElementById('timerState').textContent = '';
          document.getElementById('timerTask').textContent = '計測していません';
          document.getElementById('timerClock').textContent = '00:00:00';
        }
      }
      if (presence) presence.hidden = !state.timer || onMeasuredDay;
      rebindTimerRow();
      const list = activeDailyTaskList();
      if (list) list.querySelectorAll('.icon-button.timer').forEach(syncTimerButton);
      clearInterval(state.timerTick);
      state.timerTick = null;
      if (!state.timer) return;
      const running = !!state.timer.running;
      const task = state.timer.task || 'タスク名未入力';
      const stateLabel = running ? '計測中' : '一時停止';
      if (ribbon && onMeasuredDay) {
        ribbon.classList.toggle('is-paused', !running);
        document.getElementById('timerState').textContent = stateLabel;
        document.getElementById('timerTask').textContent = task;
        const pauseButton = document.getElementById('pauseTimer');
        const pauseIcon = pauseButton && pauseButton.querySelector('.material-symbols-outlined');
        const pauseLabel = running ? '一時停止' : '再開';
        if (pauseIcon) pauseIcon.textContent = running ? 'pause' : 'play_arrow';
        if (pauseButton) {
          pauseButton.setAttribute('aria-label', pauseLabel);
          pauseButton.setAttribute('title', pauseLabel);
        }
        document.getElementById('timerClock').textContent = formatClock(timerElapsed());
      }
      if (presence && !onMeasuredDay) {
        presence.classList.toggle('is-paused', !running);
        document.getElementById('timerPresenceTask').textContent = task;
        document.getElementById('timerPresenceMeta').textContent = shortDateLabel(state.timer.date) + ' ' + stateLabel;
        document.getElementById('timerPresenceClock').textContent = formatClock(timerElapsed());
        presence.setAttribute('aria-label', stateLabel + 'の' + task + '、' + shortDateLabel(state.timer.date) + 'を開く');
      }
      state.timerTick = setInterval(function() {
        if (!state.timer) return;
        const text = formatClock(timerElapsed());
        const clock = document.getElementById('timerClock');
        const presenceClock = document.getElementById('timerPresenceClock');
        if (clock) clock.textContent = text;
        if (presenceClock) presenceClock.textContent = text;
        noteTimerPresence();
      }, 1000);
    }
