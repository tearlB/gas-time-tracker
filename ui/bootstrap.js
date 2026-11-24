    function wireEvents() {
      installRecordedDeltaListener();
      const viewMenu = document.getElementById('viewMenu');
      document.getElementById('viewMenuButton').addEventListener('click', function() { viewMenu.open = !viewMenu.open; });
      viewMenu.querySelectorAll('[data-view]').forEach(function(item) {
        item.addEventListener('click', function() {
          if (item.dataset.view === 'projects') openProjectsView();
          else setCalendarMode(item.dataset.view);
        });
      });
      document.getElementById('saveDockButton').addEventListener('click', function() {
        if (state.view === 'daily') saveDaily();
        else if (state.view === 'planning') savePlanningScreen();
        else if (appDialogIsOpen(document.getElementById('projectDialog'))) commitProjectDialog();
        else if (state.view === 'projects') saveProjectMonthEditors();
      });
      document.getElementById('undoEdit').addEventListener('click', function() { undoEdit().catch(function(error) { toast('元に戻せませんでした: ' + error.message, 'error'); }); });
      document.getElementById('redoEdit').addEventListener('click', function() { redoEdit().catch(function(error) { toast('やり直せませんでした: ' + error.message, 'error'); }); });
      document.getElementById('closeCapacityDialog').addEventListener('click', closeCapacityDialog);
      document.getElementById('cancelCapacityDialog').addEventListener('click', closeCapacityDialog);
      bindAppDialogCancel(document.getElementById('capacityDialog'), closeCapacityDialog);
      document.getElementById('commitCapacityDialog').addEventListener('click', commitCapacityDialog);
      document.getElementById('closeCalendarEvent').addEventListener('click', closeCalendarEventDialog);
      document.getElementById('cancelCalendarEvent').addEventListener('click', closeCalendarEventDialog);
      bindAppDialogCancel(document.getElementById('calendarEventDialog'), closeCalendarEventDialog);
      document.getElementById('commitCalendarEvent').addEventListener('click', commitCalendarEventDialog);
      document.getElementById('excludeCalendarEvent').addEventListener('click', excludeEditingCalendarEvent);
      document.getElementById('restoreCalendarEvent').addEventListener('click', restoreEditingCalendarEvent);
      document.getElementById('calendarEventHours').addEventListener('keydown', function(event) {
        if (event.key === 'Enter') { event.preventDefault(); commitCalendarEventDialog(); }
      });
      document.getElementById('capacityHours').addEventListener('keydown', function(event) {
        if (event.key === 'Enter') { event.preventDefault(); commitCapacityDialog(); }
      });
      document.getElementById('calendarPrev').addEventListener('click', function() { shiftCalendarPeriod(-1); });
      document.getElementById('calendarNext').addEventListener('click', function() { shiftCalendarPeriod(1); });
      document.getElementById('calendarToday').addEventListener('click', function() {
        returnToCalendarToday();
      });
      ['week', 'month'].forEach(function(mode) {
        const elements = calendarTimelineElements(mode);
        // スクロールのたびに測るとレイアウトの再計算が続いてカクつくので、1フレームに1回だけ覚える。
        let positionFrame = 0;
        if (elements) elements.target.addEventListener('scroll', function() {
          calendarScrolledAt = Date.now();
          if (positionFrame) return;
          positionFrame = requestAnimationFrame(function() { positionFrame = 0; rememberCalendarTimelinePosition(mode); });
        }, { passive: true });
        if (elements) elements.target.addEventListener('click', function(event) {
          const mobileDay = event.target.closest('[data-mobile-day]');
          if (mobileDay) { openPlannerActualDay(mobileDay.dataset.mobileDay); return; }
          if (event.target.closest('[data-mobile-add-plan]')) { openPlanDialog({}); return; }
          const mobilePlan = event.target.closest('[data-mobile-plan-id]');
          if (mobilePlan) { openPlanDialog({ id: mobilePlan.dataset.mobilePlanId }); return; }
        });
        document.getElementById(mode === 'week' ? 'retryWeekTimeline' : 'retryMonthTimeline').addEventListener('click', function() {
          loadAdjacentCalendarPeriods(mode, mode === 'week' ? state.planner.key : state.month.key, true);
        });
      });
      document.getElementById('calendarPeriodInput').addEventListener('change', function() {
        setCalendarMode(state.calendarMode, this.value);
      });
      bindDatePicker();
      wireMonthGanttEvents();
      wireMonthPlanEditor();
      wirePeriodDrag();
      wireInlinePlanNote();
      wirePlanKeyboard();
      wireBacklog();
      document.getElementById('addTask').addEventListener('click', function() { openCandidates('imports'); });
      document.getElementById('addInterrupt').addEventListener('click', function() { openCandidates('interrupt'); });
      document.getElementById('importSuggestions').addEventListener('click', function() { openCandidates('imports'); });
      document.getElementById('saveDaily').addEventListener('click', saveDaily);
      // 「未完了タスクを再取得」は、実績が空のときの案内の中に出る（描き直されるので、ここで受ける）。
      document.addEventListener('click', function(event) { if (event.target.closest && event.target.closest('#reloadDay')) reloadDaily(); });
      document.getElementById('closeCandidates').addEventListener('click', closeCandidates);
      document.getElementById('cancelCandidates').addEventListener('click', closeCandidates);
      bindAppDialogCancel(document.getElementById('candidateDialog'), closeCandidates);
      document.getElementById('candidateSearch').addEventListener('input', renderCandidates);
      document.getElementById('candidateScope').addEventListener('click', function(event) {
        const button = event.target.closest('[data-scope]');
        if (!button) return;
        setCandidateScope(button.dataset.scope);
        renderCandidates();
      });
      document.getElementById('candidateList').addEventListener('change', syncCandidateAction);
      document.getElementById('candidateList').addEventListener('click', function(event) {
        const toggle = event.target.closest('.candidate-group-toggle');
        if (toggle) {
          event.preventDefault();
          toggleCandidateGroup(toggle);
          return;
        }
        const button = event.target.closest('.candidate-complete');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        completeCandidatePlan(button);
      });
      document.getElementById('addCandidates').addEventListener('click', addSelectedCandidates);
      document.getElementById('addDailyNewIssue').addEventListener('click', addDailyCreatedIssue);
      document.getElementById('dailyNewIssueTitle').addEventListener('keydown', function(event) {
        if (event.key === 'Enter') { event.preventDefault(); addDailyCreatedIssue(); }
      });
      document.getElementById('generateReport').addEventListener('click', generateReport);
      document.getElementById('copyReport').addEventListener('click', copyReport);
      document.getElementById('timerPresence').addEventListener('click', async function() {
        if (!state.timer || !state.timer.date) return;
        if (state.view === 'projects' && !await confirmProjectMonthNavigation()) return;
        setCalendarMode('day', state.timer.date);
      });
      document.getElementById('pauseTimer').addEventListener('click', togglePauseTimer);
      document.getElementById('cancelTimer').addEventListener('click', cancelTimer);
      document.getElementById('stopTimer').addEventListener('click', function() { finishTimer(true); });
      document.getElementById('closeAwayDialog').addEventListener('click', function() { resolveAwayDialog('keep'); });
      bindAppDialogCancel(document.getElementById('awayDialog'), function() { resolveAwayDialog('keep'); });
      document.getElementById('awayDialogKeep').addEventListener('click', function() { resolveAwayDialog('keep'); });
      document.getElementById('awayDialogBreak').addEventListener('click', function() { resolveAwayDialog('break'); });
      document.getElementById('awayDialogMove').addEventListener('click', function() { resolveAwayDialog('move'); });
      document.getElementById('syncSpreadsheet').addEventListener('click', function() { syncFromSpreadsheet(); });
      // フォームのURLが未設定のときは、設定に「フィードバック」を出さない。
      document.getElementById('settingsTabFeedback').hidden = !FEEDBACK_FORM_URL;
      document.getElementById('guideFeedbackStep').hidden = !FEEDBACK_FORM_URL;
      document.getElementById('openFeedbackForm').addEventListener('click', function() { openExternal('feedback'); });
      document.getElementById('checkDataHealth').addEventListener('click', function() { runDataHealthCheck(); });
      document.getElementById('schemaBackupList').addEventListener('click', function(event) {
        const button = event.target.closest('[data-delete-backup]');
        if (button) deleteSchemaBackups([button.dataset.deleteBackup]);
      });
      document.getElementById('deleteAllSchemaBackups').addEventListener('click', function() {
        deleteSchemaBackups((state.appSettings.schemaBackups || []).map(function(item) { return item.id; }));
      });
      document.getElementById('confirmDialogOk').addEventListener('click', function() { settleConfirmDialog(true); });
      document.getElementById('confirmDialogCancel').addEventListener('click', function() { settleConfirmDialog(false); });
      bindAppDialogCancel(document.getElementById('confirmDialog'), function() { settleConfirmDialog(false); });
      // 暗い背景を押して閉じたときも、「やめる」として扱う。
      document.getElementById('confirmDialog').addEventListener('closed', function() { if (confirmDialogState.resolve) settleConfirmDialog(false); });
      document.getElementById('openAppSettings').addEventListener('click', function() { openAppSettings(); });
      document.querySelectorAll('[data-settings-tab]').forEach(function(button) {
        button.addEventListener('click', function() { selectAppSettingsTab(this.dataset.settingsTab); });
      });
      document.getElementById('closeAppSettings').addEventListener('click', closeAppSettingsDialog);
      document.getElementById('closeAppSettingsFooter').addEventListener('click', closeAppSettingsDialog);
      bindAppDialogCancel(document.getElementById('appSettingsDialog'), closeAppSettingsDialog);
      document.getElementById('appFileName').addEventListener('input', function() { updatePlanningFolderPreview(); });
      document.getElementById('manageStorage').addEventListener('click', function() { closeAppSettingsDialog(); openPlanningSetup(); });
      document.getElementById('openSheet').addEventListener('click', function() { closeAppSettingsDialog(); openExternal('planning-sheet'); });
      document.getElementById('openGas').addEventListener('click', function() { closeAppSettingsDialog(); openExternal('gas'); });
      document.getElementById('reloadPlanningCalendars').addEventListener('click', function() { ensureCalendarSettingsLoaded(true); });
      document.getElementById('saveCalendarSettings').addEventListener('click', saveCalendarSettings);
      document.getElementById('refreshPlannerCalendar').addEventListener('click', refreshPlannerCalendar);
      document.getElementById('syncProjectIssuesGoogleTasks').addEventListener('click', syncProjectIssuesGoogleTasks);
      document.getElementById('googleTasksEnabled').addEventListener('change', function() {
        const enabled = switchIsOn(this);
        document.getElementById('googleTasksAutoSync').disabled = !enabled;
        document.getElementById('syncProjectIssuesGoogleTasks').disabled = !enabled || !state.project.googleTasksEnabled;
      });
      document.getElementById('googleTasksTargetList').addEventListener('change', function() {
        document.getElementById('googleTasksNewListTitle').hidden = this.value !== '__create__';
      });
      document.getElementById('reloadGoogleTasksLists').addEventListener('click', reloadGoogleTasksSettingsLists);
      document.getElementById('saveGoogleTasksSettings').addEventListener('click', saveGoogleTasksSettings);
      document.getElementById('awayDetectionEnabled').addEventListener('change', saveUiPreferencesFromControls);
      document.getElementById('dailyShareEnabled').addEventListener('change', saveUiPreferencesFromControls);
      document.getElementById('planActualCompletionSync').addEventListener('change', saveCompletionSyncSettings);
      document.getElementById('workdayDefaultHours').addEventListener('change', saveWorkdayHoursSettings);
      document.getElementById('workdayStart').addEventListener('change', saveWorkdayTimeRangeFromControls);
      document.getElementById('workdayEnd').addEventListener('change', saveWorkdayTimeRangeFromControls);
      ['startupView', 'hoursStep', 'externalEditWatch'].forEach(function(id) {
        document.getElementById(id).addEventListener('change', saveUiPreferencesFromControls);
      });
      wireTips();
      document.getElementById('awayDetectionMinutes').addEventListener('change', saveUiPreferencesFromControls);
      ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(function(type) {
        document.addEventListener(type, noteUserActivity, { capture: true, passive: true });
      });
      document.getElementById('configureStorageDaily').addEventListener('click', openPlanningSetup);
      document.getElementById('configurePlanning').addEventListener('click', openPlanningSetup);
      document.getElementById('configureStorageProjects').addEventListener('click', openPlanningSetup);
      document.getElementById('openPlanningSheet').addEventListener('click', function() { openExternal('planning-sheet'); });
      document.getElementById('closePlanningSetup').addEventListener('click', closePlanningSetup);
      document.getElementById('cancelPlanningSetup').addEventListener('click', closePlanningSetup);
      bindAppDialogCancel(document.getElementById('planningSetupDialog'), closePlanningSetup);
      document.getElementById('folderBrowserBack').addEventListener('click', function() {
        const browser = state.planner.folderBrowser;
        if (browser && browser.parent) browseAppStorageFolder(browser.parent.id);
      });
      document.getElementById('storageModeSet').addEventListener('click', function(event) {
        const button = event.target.closest('[data-storage-mode]');
        if (button) setPlanningStorageMode(button.dataset.storageMode);
      });
      const folderList = document.getElementById('folderBrowserList');
      folderList.addEventListener('click', function(event) {
        const row = event.target.closest('.folder-row');
        if (!row) return;
        if (event.target.closest('.folder-row-open')) return browseAppStorageFolder(row.dataset.folderId);
        selectAppStorageFolderRow(row);
      });
      folderList.addEventListener('dblclick', function(event) {
        const row = event.target.closest('.folder-row');
        if (row && !event.target.closest('.folder-row-open')) browseAppStorageFolder(row.dataset.folderId);
      });
      folderList.addEventListener('keydown', function(event) {
        const row = event.target.closest('.folder-row');
        if (!row || event.target !== row) return;
        if (event.key === 'Enter') { event.preventDefault(); browseAppStorageFolder(row.dataset.folderId); }
        else if (event.key === ' ') { event.preventDefault(); selectAppStorageFolderRow(row); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
          if (next && next.classList.contains('folder-row')) next.focus();
        }
      });
      document.getElementById('folderBrowserPath').addEventListener('click', function(event) {
        const crumb = event.target.closest('button.folder-crumb');
        if (crumb) browseAppStorageFolder(crumb.dataset.folderId);
      });
      document.getElementById('createPlanningStorage').addEventListener('click', createPlanningStorage);

      loadDefaultAssignedProject();
      document.getElementById('defaultProjectAssign').addEventListener('change', function() {
        if (this.dataset.syncing === '1') return;
        const value = readOutlinedSelectValue(this);
        this.dataset.projectId = value;
        setDefaultAssignedProject(value);
      });
      document.getElementById('addProject').addEventListener('click', function() { openProjectDialog(); });
      document.getElementById('projectList').addEventListener('input', function(event) {
        const field = event.target && event.target.closest ? event.target.closest('[data-original]') : null;
        if (field) field.classList.toggle('is-dirty', String(field.value || '') !== String(field.dataset.original || ''));
        const hoursField = event.target && event.target.closest ? event.target.closest('[data-project-month-hours]') : null;
        if (hoursField) updateProjectMonthHoursPreview(hoursField.closest('.project-card'));
        if (field && field.closest('.project-month-editor')) scheduleProjectMonthAutoSave();
      });
      document.getElementById('projectList').addEventListener('focusout', function() {
        setTimeout(renderPendingProjectWorkspace, 0);
      });
      document.getElementById('projectList').addEventListener('click', function(event) {
        const button = event.target.closest('[data-project-action]');
        if (!button) return;
        const action = button.dataset.projectAction;
        if (action === 'edit') openProjectDialog(button.dataset.projectId);
        else if (action === 'issue') openProjectIssue(button.dataset.projectId);
        else if (action === 'toggle-issues') toggleProjectIssues(button.dataset.projectId);
        else if (action === 'month-mode') setProjectMonthMode(button);
      });

      wireDailyTaskListEvents(document.getElementById('taskList'));
      wireDailyRowSheet();
      // ダイアログを開くと閉じるボタンが選ばれた状態になり、枠が出てしまう。開いた直後だけ選択を外す（Tab で移れば選べる）。
      document.addEventListener('opened', function(event) {
        if (!event.target || event.target.tagName !== 'MD-DIALOG') return;
        const active = document.activeElement;
        if (active && active.classList && active.classList.contains('dialog-close')) active.blur();
      }, true);
      document.getElementById('quickActualButton').addEventListener('click', toggleQuickActual);
      document.getElementById('prevPeriod').addEventListener('click', function() { shiftCalendarPeriod(-1); });
      document.getElementById('nextPeriod').addEventListener('click', function() { shiftCalendarPeriod(1); });
      document.getElementById('currentPeriod').addEventListener('click', async function() {
        if (unsavedNeedsLeaveConfirm() && !await confirmLeaveUnsaved('今期へ移動')) return;
        discardDailyDraftForPlannerNavigation();
        state.planner.key = periodForToday(state.planner.type);
        document.getElementById('periodInput').value = state.planner.key;
        loadPlanner();
      });
      document.getElementById('periodInput').addEventListener('change', async function() {
        if (unsavedNeedsLeaveConfirm() && !await confirmLeaveUnsaved('期間を変更')) {
          this.value = state.planner.key;
          return;
        }
        discardDailyDraftForPlannerNavigation();
        state.planner.key = this.value;
        loadPlanner();
      });
      document.getElementById('addPlan').addEventListener('click', function() { openPlanDialog({}); });
      document.getElementById('savePlan').addEventListener('click', savePlanner);
      document.getElementById('weekCalendar').addEventListener('click', function(event) {
        if (state.suppressPlanClick) { event.preventDefault(); return; }
        if (event.target.closest('.span-context-row') && !event.target.closest('.span-actual')) return;
        const subtaskToggle = event.target.closest('.span-subtasks-toggle');
        if (subtaskToggle) {
          event.preventDefault();
          event.stopPropagation();
          const planId = subtaskToggle.dataset.parentPlanId;
          const expanded = state.planner.expandedSubtasks || (state.planner.expandedSubtasks = {});
          expanded[planId] = !expanded[planId];
          subtaskToggle.setAttribute('aria-expanded', String(expanded[planId]));
          subtaskToggle.closest('.span-row').classList.toggle('is-expanded', expanded[planId]);
          document.querySelectorAll('#weekCalendar .span-subtask-lane').forEach(function(row) {
            if (row.dataset.parentPlanId === planId) row.classList.toggle('is-visible', expanded[planId]);
          });
          return;
        }
        const editSubtask = event.target.closest('.span-subtask-edit');
        if (editSubtask) {
          event.preventDefault();
          event.stopPropagation();
          openPlanDialog({ id: editSubtask.dataset.parentPlanId, editSubtaskId: editSubtask.dataset.editSubtaskId });
          return;
        }
        const addSubtask = event.target.closest('[data-add-subtask-plan-id]');
        if (addSubtask) {
          event.preventDefault();
          event.stopPropagation();
          openPlanDialog({ id: addSubtask.dataset.addSubtaskPlanId, focusSubtask: true });
          return;
        }
        const priorityHandle = event.target.closest('.span-priority-handle');
        if (priorityHandle) { event.preventDefault(); event.stopPropagation(); return; }
        // 課題キーのリンクは Backlog を開くだけにして、予定ダイアログは開かない。
        if (event.target.closest('a.span-name-key')) { event.stopPropagation(); return; }
        const capacity = event.target.closest('.capacity-edit');
        if (capacity) { event.preventDefault(); event.stopPropagation(); editWorkCapacity(capacity); return; }
        const calendarEvent = event.target.closest('.calendar-entry.is-event');
        if (calendarEvent) {
          event.preventDefault();
          event.stopPropagation();
          openCalendarEventDialog(calendarEvent.dataset.calendarKey, calendarEvent.dataset.date, Number(calendarEvent.dataset.eventIndex));
          return;
        }
        const interruptChip = event.target.closest('.calendar-entry.is-interrupt');
        if (interruptChip) {
          event.preventDefault();
          event.stopPropagation();
          openPlannerActualDay(interruptChip.dataset.date);
          return;
        }
        const openDay = event.target.closest('.week-day-open');
        if (openDay) { openPlannerActualDay(openDay.dataset.date); return; }
        const add = event.target.closest('.week-add');
        if (add && add.dataset.date) { openPlanDialog({ date: add.dataset.date }); return; }
        const actual = event.target.closest('.span-actual');
        if (actual) {
          const actualCell = actual.closest('.span-day[data-date]');
          if (actualCell && actualCell.dataset.date) {
            event.preventDefault();
            event.stopPropagation();
            openPlannerActualDay(actualCell.dataset.date);
            return;
          }
        }
        const statusButton = event.target.closest('[data-status-plan-id]');
        if (statusButton) {
          event.preventDefault();
          event.stopPropagation();
          openPlanStatusMenu(statusButton.dataset.statusPlanId, statusButton);
          return;
        }
        const planName = event.target.closest('.span-name[data-plan-id]');
        if (planName && planName.dataset.planId) { openPlanDialog({ id: planName.dataset.planId }); return; }
        // 予定の編集を開くのは、左端の名前の列と、期間の帯を押したときだけ（日付のセルや行の余白では開かない）。
        const plan = event.target.closest('.timeline-period[data-plan-id]');
        if (plan && plan.dataset.planId) { openPlanDialog({ id: plan.dataset.planId }); return; }
      });
      const weekCalendar = document.getElementById('weekCalendar');
      function hoverPlanRow(row) {
        const current = weekCalendar.querySelector('.span-row.is-hover');
        if (current === row) return;
        if (current) current.classList.remove('is-hover');
        if (row) row.classList.add('is-hover');
      }
      weekCalendar.addEventListener('pointerover', function(event) {
        hoverPlanRow(event.target.closest('.span-row'));
      });
      weekCalendar.addEventListener('pointermove', function(event) {
        hoverPlanRow(event.target.closest('.span-row'));
      });
      weekCalendar.addEventListener('pointerleave', function() {
        hoverPlanRow(null);
      });
      document.getElementById('weekCalendar').addEventListener('contextmenu', function(event) {
        const row = event.target.closest('.span-row');
        if (!row || !row.dataset.planId) return;
        event.preventDefault();
        openPlanContextMenu(row.dataset.planId, event.clientX, event.clientY);
      });
      document.getElementById('planContextMenu').addEventListener('click', function(event) {
        const button = event.target.closest('[data-action]');
        if (!button || button.disabled) return;
        const planId = this.dataset.planId;
        const action = button.dataset.action;
        closePlanContextMenu();
        if (action === 'up') movePlannerItemById(planId, -1);
        else if (action === 'down') movePlannerItemById(planId, 1);
        else if (action === 'done') togglePlanComplete(planId);
        else if (action === 'edit') openPlanDialog({ id: planId });
        else if (action === 'delete') deletePlannerItemById(planId);
      });
      document.getElementById('planStatusMenu').addEventListener('click', function(event) {
        const option = event.target.closest('[data-progress]');
        if (!option) return;
        const planId = this.dataset.planId;
        closePlanStatusMenu();
        changePlanProgressStatus(planId, option.dataset.progress);
      });
      document.addEventListener('mousedown', function(event) {
        const menu = document.getElementById('planContextMenu');
        if (menu.open && !menu.contains(event.target)) closePlanContextMenu();
        const statusMenu = document.getElementById('planStatusMenu');
        if (statusMenu.open && !statusMenu.contains(event.target) && !event.target.closest('[data-status-plan-id]')) closePlanStatusMenu();
      });
      document.addEventListener('scroll', function(event) {
        closePlanContextMenu();
        const statusMenu = document.getElementById('planStatusMenu');
        if (!statusMenu.contains(event.target)) closePlanStatusMenu();
      }, true);
      // スマホ幅とPC幅をまたいだら、週・月を描き直す（表とリストを切り替える）。
      if (typeof matchMedia === 'function') {
        matchMedia('(max-width: 620px)').addEventListener('change', function() {
          syncNav();
          if (state.view === 'planning') renderWeekCalendar();
          if (state.view === 'month') renderMonthGantt();
        });
      }
      setInterval(refreshCalendarNowLines, 60000);
      window.addEventListener('resize', function() {
        closePlanContextMenu();
        closePlanStatusMenu();
        fitWeekTimelineColumns();
        refreshCalendarNowLines();
      });
      window.addEventListener('blur', function() {
        closePlanContextMenu();
        closePlanStatusMenu();
        cancelActiveReorder();
      });
      document.getElementById('closePlanDialog').addEventListener('click', closePlanDialog);
      document.getElementById('cancelPlanDialog').addEventListener('click', closePlanDialog);
      bindAppDialogCancel(document.getElementById('planDialog'), closePlanDialog);
      document.getElementById('commitPlanDialog').addEventListener('click', commitPlanDialog);
      document.getElementById('planDialogProject').addEventListener('change', function(event) {
        event.currentTarget.dataset.projectId = String(event.currentTarget.value || '');
      });
      document.getElementById('deletePlanDialog').addEventListener('click', deleteEditingPlan);
      document.getElementById('closeProjectDialog').addEventListener('click', closeProjectDialog);
      document.getElementById('cancelProjectDialog').addEventListener('click', closeProjectDialog);
      bindAppDialogCancel(document.getElementById('projectDialog'), closeProjectDialog);
      document.getElementById('commitProjectDialog').addEventListener('click', commitProjectDialog);
      document.getElementById('movePlanUp').addEventListener('click', function() { moveEditingPlan(-1); });
      document.getElementById('movePlanDown').addEventListener('click', function() { moveEditingPlan(1); });
      document.getElementById('planDialogPlanned').addEventListener('input', updatePlanDialogIssueSum);
      document.getElementById('planDialogStartDate').addEventListener('change', function() {
        const start = document.getElementById('planDialogStartDate').value;
        const endInput = document.getElementById('planDialogEndDate');
        // 開始日を終了日より後ろへ動かしたら、終了日はその週の金曜までに合わせる。
        if (isYmdText(start) && (!isYmdText(endInput.value) || endInput.value < start)) endInput.value = weekFridayYmd(start);
        updatePlanDialogPeriodHint();
      });
      document.getElementById('planDialogEndDate').addEventListener('change', updatePlanDialogPeriodHint);
      document.getElementById('clearPlanDialogPeriod').addEventListener('click', clearPlanDialogPeriod);
      document.getElementById('planDialog').addEventListener('input', function(event) {
        if (event.target && event.target.classList.contains('plan-dialog-subtask-hours')) {
          syncPlanDialogSubtasksFromDom();
          updatePlanDialogIssueSum();
        }
      });
      document.getElementById('planDialog').addEventListener('change', function(event) {
        if (event.target && event.target.classList.contains('plan-dialog-subtask-done')) {
          const row = event.target.closest('.plan-dialog-subtask-row');
          if (row) row.classList.toggle('is-done', !!event.target.checked);
          syncPlanDialogSubtasksFromDom();
          updatePlanDialogIssueSum();
        }
        if (event.target && event.target.classList.contains('plan-dialog-subtask-hours')) {
          syncPlanDialogSubtasksFromDom();
          updatePlanDialogIssueSum();
        }
      });
      document.getElementById('planDialogName').addEventListener('paste', handlePlanDialogNamePaste);
      document.getElementById('planDialogName').addEventListener('input', syncPlanDialogIssueLink);
      document.getElementById('planDialogName').addEventListener('keydown', function(event) {
        if (event.key === 'Enter') { event.preventDefault(); commitPlanDialog(); }
      });
      document.getElementById('addPlanDialogSubtask').addEventListener('click', addPlanDialogSubtask);
      document.getElementById('planDialogSubtaskList').addEventListener('click', function(event) {
        const button = event.target.closest('.remove-plan-subtask');
        if (!button) return;
        syncPlanDialogSubtasksFromDom();
        const row = button.closest('.plan-dialog-subtask-row');
        const index = row ? Number(row.dataset.index) : -1;
        if (index < 0) return;
        state.planner.editingSubtasks.splice(index, 1);
        renderPlanDialogSubtasks();
      });
      document.getElementById('planDialogSubtaskList').addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' || !event.target.classList.contains('plan-dialog-subtask-title')) return;
        event.preventDefault();
        const empty = !String(event.target.value || '').trim();
        if (empty) return;
        addPlanDialogSubtask();
      });

      document.addEventListener('keydown', function(event) {
        const modifier = event.ctrlKey || event.metaKey;
        const historyKey = String(event.key || '').toLowerCase();
        if (modifier && !event.altKey && state.view !== 'projects' && !historyUsesNativeUndo(event.target) && historyKey === 'z') {
          event.preventDefault();
          commitFocusedFieldForHistory();
          (event.shiftKey ? redoEdit() : undoEdit()).catch(function(error) { toast('編集履歴を適用できませんでした: ' + error.message, 'error'); });
          return;
        }
        if (modifier && !event.altKey && !event.shiftKey && state.view !== 'projects' && !historyUsesNativeUndo(event.target) && historyKey === 'y') {
          event.preventDefault();
          commitFocusedFieldForHistory();
          redoEdit().catch(function(error) { toast('編集履歴を適用できませんでした: ' + error.message, 'error'); });
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          if (state.view === 'daily') saveDaily();
          else if (state.view === 'planning') savePlanningScreen();
          else if (appDialogIsOpen(document.getElementById('projectDialog'))) commitProjectDialog();
          else if (state.view === 'projects') saveProjectMonthEditors();
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && state.view === 'daily') { event.preventDefault(); openCandidates('imports'); }
        // Googleカレンダーと同じく、D・W・M で日・週・月、P でプロジェクトへ切り替える。入力中やダイアログを開いている間は反応しない。
        // ショートカットキー（設定で変える）。入力中やダイアログを開いている間は反応しない。
        const typing = event.isComposing || (event.target.closest && event.target.closest('input, textarea, select, [contenteditable="true"], md-outlined-text-field, md-outlined-select, .shortcut-key'));
        const shortcut = !modifier && !event.altKey && !event.shiftKey && !typing && !document.querySelector('md-dialog[open], dialog[open]') ? shortcutActionForKey(event.key) : '';
        if (shortcut) {
          event.preventDefault();
          if (shortcut === 'quickActual') toggleQuickActual();
          else if (shortcut === 'today') returnToCalendarToday();
          else if (shortcut === 'prevPeriod') shiftCalendarPeriod(-1);
          else if (shortcut === 'nextPeriod') shiftCalendarPeriod(1);
          else if (shortcut === 'projects') openProjectsView();
          else setCalendarMode(shortcut);
          return;
        }
        if (event.key === 'Escape' && appDialogIsOpen(document.getElementById('candidateDialog'))) closeCandidates();
        if (event.key === 'Escape' && appDialogIsOpen(document.getElementById('planDialog'))) closePlanDialog();
        if (event.key === 'Escape' && appDialogIsOpen(document.getElementById('capacityDialog'))) closeCapacityDialog();
        if (event.key === 'Escape' && appDialogIsOpen(document.getElementById('appSettingsDialog')) && !appDialogIsOpen(document.getElementById('confirmDialog'))) closeAppSettingsDialog();
        if (event.key === 'Escape' && appDialogIsOpen(document.getElementById('calendarEventDialog'))) closeCalendarEventDialog();
        if (event.key === 'Escape' && appDialogIsOpen(document.getElementById('projectDialog'))) closeProjectDialog();
        if (event.key === 'Escape' && appDialogIsOpen(document.getElementById('planContextMenu'))) closePlanContextMenu();
        if (event.key === 'Escape' && document.getElementById('planStatusMenu').open) closePlanStatusMenu();
      });
      window.addEventListener('pagehide', flushPendingAutoSaves);
      window.addEventListener('beforeunload', function(event) {
        flushPendingAutoSaves();
        flushNavigationPersist();
        if (state.daily.dirty || state.planner.dirty || state.project.monthSaving || (state.view === 'projects' && projectMonthEditorsDirty()) || state.timer) { event.preventDefault(); event.returnValue = ''; }
      });
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') flushPendingAutoSaves();
        refreshVisibleCalendarIfStale(true);
        syncVisibleNavigationSnapshot();
        if (externalEditTimer) checkExternalEdits();
      });
    }

    // ⓘ の吹き出し。表やダイアログの枠で切れないよう、画面に固定した吹き出しを1つだけ使う。
    function wireTips() {
      const bubble = document.createElement('div');
      bubble.className = 'ui-tip-bubble';
      bubble.id = 'uiTipBubble';
      bubble.setAttribute('role', 'tooltip');
      bubble.hidden = true;
      document.body.appendChild(bubble);
      let current = null;
      function show(tip) {
        current = tip;
        bubble.textContent = tip.dataset.tip || '';
        bubble.hidden = false;
        const rect = tip.getBoundingClientRect();
        const width = bubble.offsetWidth;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
        const below = rect.bottom + 8 + bubble.offsetHeight <= window.innerHeight;
        bubble.style.left = left + 'px';
        bubble.style.top = (below ? rect.bottom + 8 : rect.top - bubble.offsetHeight - 8) + 'px';
        tip.setAttribute('aria-describedby', bubble.id);
      }
      function hide() {
        if (current) current.removeAttribute('aria-describedby');
        current = null;
        bubble.hidden = true;
      }
      document.addEventListener('mouseover', function(event) {
        const tip = event.target.closest && event.target.closest('.ui-tip');
        if (tip && tip !== current) show(tip);
      });
      document.addEventListener('mouseout', function(event) {
        const tip = event.target.closest && event.target.closest('.ui-tip');
        if (tip && tip === current && !tip.contains(event.relatedTarget)) hide();
      });
      document.addEventListener('focusin', function(event) {
        const tip = event.target.closest && event.target.closest('.ui-tip');
        if (tip) show(tip);
      });
      document.addEventListener('focusout', function(event) {
        if (event.target === current) hide();
      });
      // 押したとき（スマホ）は開閉し、ほかの操作には伝えない。
      document.addEventListener('click', function(event) {
        const tip = event.target.closest && event.target.closest('.ui-tip');
        if (!tip) { hide(); return; }
        event.preventDefault();
        event.stopPropagation();
        if (current === tip && !bubble.hidden) hide(); else show(tip);
      }, true);
      document.addEventListener('keydown', function(event) { if (event.key === 'Escape') hide(); });
      window.addEventListener('scroll', hide, true);
      window.addEventListener('resize', hide);
    }

    async function init() {
      wireEvents();
      state.uiPreferences = readUiPreferences();
      state.daily.date = ymd(new Date());
      state.planner.key = periodForToday('week');
      state.planner.type = 'week';
      state.project.monthKey = projectMonthForToday();
      state.month.key = periodForToday('month');
      state.month.filter = readMonthFilter();
      state.calendarMode = 'week';
      state.view = 'planning';
      applyViewState(startupViewState());
      document.getElementById('navBack').addEventListener('click', navigateBack);
      window.addEventListener('popstate', function(event) { restoreViewFromHistory(event); });
      hydrateNavigationSnapshots();
      applyUiPreferences();
      installMaterialScrollbars();
      installMaterialTooltips();
      bindShortcutSettings();
      bindGuidePanel();
      // 保存先の前回の状態を先に反映し、読み込みが終わるまでの「未設定」の一瞬の表示をなくす。
      const cachedStorage = readCachedStorageStatus();
      if (cachedStorage) renderPlanningStorage(cachedStorage);
      document.getElementById('periodInput').value = state.planner.key;
      applyViewVisibility();
      restoreTimer();
      if (state.view !== 'projects') syncCalendarControl();
      syncNav();
      updateSaveDock();
      if ('serviceWorker' in navigator && SERVICE_URL) window.addEventListener('load', function() { navigator.serviceWorker.register(SERVICE_URL + '?page=sw&v=8').catch(function() {}); });
      const storage = state.view === 'daily' || state.view === 'projects'
        ? gas('getAppStorageStatus').then(function(current) {
            renderPlanningStorage(current);
            if (state.view === 'projects') renderProjectStorage(current);
            return current;
          }).catch(function() {
            // 取得に失敗したときだけ、未設定として扱う（案内から設定できるように）。
            const unknown = { configured: false, defaultName: 'まとめて工数管理さん' };
            renderPlanningStorage(unknown);
            if (state.view === 'projects') renderProjectStorage(unknown);
            return null;
          })
        : Promise.resolve(state.storage);
      loadCalendarSourceSettings();
      const tasksPreference = refreshGoogleTasksSyncPreference();
      if (state.view === 'daily') await Promise.all([loadDaily(), storage, tasksPreference]);
      else if (state.view === 'projects') await Promise.all([loadProjectScreen(), storage, tasksPreference]);
      else if (state.view === 'month') await Promise.all([loadMonthGantt(), storage, tasksPreference]);
      else await Promise.all([loadPlanner(), storage, tasksPreference]);
      warmNavigationSnapshots();
      prefetchAdjacentDailySnapshots();
      startExternalEditWatch();
      scheduleAutoGoogleTasksSync(googleTasksSyncMonthKey());
      showGuideOnFirstRun();
    }

    function syncVisibleNavigationSnapshot() {
      if (document.visibilityState !== 'visible') return;
      if (state.view === 'daily' && isViewYmd(state.daily.date) && state.dailyCache[state.daily.date] && !snapshotIsRecent(state.dailyFetchedAt[state.daily.date], NAV_FOCUS_REFRESH_MS) && !state.daily.dirty && !state.daily.busy && !state.daily.saving) {
        refreshDailyFromServer(state.daily.date, ++state.nav.daily).catch(function() {});
        return;
      }
      if (state.view === 'planning') {
        const snapId = state.planner.type + ':' + state.planner.key;
        const snap = state.weekSnapshot[snapId];
        if (snap && snap.summary && !snapshotIsRecent(snap.fetchedAt, NAV_FOCUS_REFRESH_MS) && !state.planner.dirty && !state.planner.busy && !state.planner.saving) {
          refreshPlannerFromServer(state.planner.type, state.planner.key, ++state.nav.planner).catch(function() {});
        }
        return;
      }
      const monthKey = state.project.monthKey;
      if (state.view === 'projects' && state.projectCache[monthKey] && !snapshotIsRecent(state.projectFetchedAt[monthKey], NAV_FOCUS_REFRESH_MS) && !state.project.busy && !state.project.saving && !projectMonthEditorsDirty()) {
        refreshProjectFromServer(monthKey, ++state.nav.project).catch(function() {});
      }
    }

    // ---- シートの外部変更の自動読み直し ----
    // AIや人がスプレッドシートを直接書き換えたとき、「シートと同期」を押さなくても反映されるようにする。
    // 表示中は EXTERNAL_EDIT_POLL_MS おきと、タブに戻ったときに、外部変更の時刻だけを軽く確かめる。
    const EXTERNAL_EDIT_POLL_MS = 60 * 1000;
    const EXTERNAL_EDIT_STAMP_KEY = scopedStorageKey('matomete-kousu-external-edit-v1');
    let externalEditTimer = null;
    let externalEditChecking = false;
    // 週・月を横にスクロールした時刻。スクロール中に読み直すと描き直しでカクつくので、少し待つ。
    let calendarScrolledAt = 0;
    const EXTERNAL_EDIT_SCROLL_QUIET_MS = 3000;
    let externalEditHeldNotified = false;
    function readExternalEditStamp() {
      try { return Number(localStorage.getItem(EXTERNAL_EDIT_STAMP_KEY)) || 0; } catch (_) { return 0; }
    }
    function writeExternalEditStamp(stamp) {
      try { localStorage.setItem(EXTERNAL_EDIT_STAMP_KEY, String(stamp)); } catch (_) {}
    }
    function externalEditReloadIsHeld() {
      return !!(state.daily.dirty || state.daily.saving || state.planner.dirty || state.planner.saving
        || state.project.saving || state.project.monthSaving
        || (typeof projectMonthEditorsDirty === 'function' && projectMonthEditorsDirty()));
    }
    // 読み込み済みの控えは消さずに古い扱いにする（次に開いたときは前の内容をすぐ出して裏で読み直す）。
    function markAllSnapshotsStale() {
      Object.keys(state.dailyFetchedAt || {}).forEach(function(key) { state.dailyFetchedAt[key] = 0; });
      Object.keys(state.projectFetchedAt || {}).forEach(function(key) { state.projectFetchedAt[key] = 0; });
      Object.keys(state.weekSnapshot || {}).forEach(function(key) { if (state.weekSnapshot[key]) state.weekSnapshot[key].fetchedAt = 0; });
      Object.keys(state.calendarFetchedAt || {}).forEach(function(key) { state.calendarFetchedAt[key] = 0; });
      state.weekForecastCache = {};
      state.project.catalogLoaded = false;
      state.project.catalogPromise = null;
      markAdjacentCalendarPeriodsStale();
      flushNavigationPersist();
    }
    function refreshCurrentViewFromServer() {
      if (typeof ensureProjectCatalog === 'function') ensureProjectCatalog().catch(function() {});
      if (state.view === 'daily' && isViewYmd(state.daily.date)) return refreshDailyFromServer(state.daily.date, ++state.nav.daily);
      if (state.view === 'planning') return refreshPlannerFromServer(state.planner.type, state.planner.key, ++state.nav.planner);
      if (state.view === 'projects' && isProjectMonthKey(state.project.monthKey)) return refreshProjectFromServer(state.project.monthKey, ++state.nav.project);
      if (state.view === 'month' && !state.month.busy) return loadMonthGantt();
      return Promise.resolve();
    }
    async function checkExternalEdits() {
      if (externalEditChecking || document.visibilityState !== 'visible') return;
      externalEditChecking = true;
      try {
        const result = await gas('getExternalEditStamp');
        const stamp = Number(result && result.stamp) || 0;
        if (!stamp || stamp <= readExternalEditStamp()) return;
        // スクロール中は読み直さず、次の確認に回す（印は付けないので取りこぼさない）。
        if (Date.now() - calendarScrolledAt < EXTERNAL_EDIT_SCROLL_QUIET_MS) return;
        // 編集中・保存中は読み直さない（自動保存が終わったあとの確認で読み直す）。
        if (externalEditReloadIsHeld()) {
          if (!externalEditHeldNotified) toast('シートが外部で変更されました。編集の保存後に読み直します');
          externalEditHeldNotified = true;
          return;
        }
        externalEditHeldNotified = false;
        writeExternalEditStamp(stamp);
        markAllSnapshotsStale();
        await refreshCurrentViewFromServer();
        toast('シートの変更を読み込みました', 'success');
      } catch (_) {
        // 確認に失敗しても次の確認で取り直す。
      } finally {
        externalEditChecking = false;
      }
    }
    function externalEditWatchEnabled() {
      return !(state.uiPreferences && state.uiPreferences.externalEditWatch === false);
    }
    function stopExternalEditWatch() {
      if (externalEditTimer) clearInterval(externalEditTimer);
      externalEditTimer = null;
    }
    // 起動時に開く画面。「前回の画面」以外を選んでいれば、今日を含む期間を開く。
    function startupViewState() {
      const preference = state.uiPreferences && state.uiPreferences.startupView;
      if (preference === 'day') return { view: 'day', key: ymd(new Date()) };
      if (preference === 'week') return { view: 'week', key: periodForToday('week') };
      if (preference === 'month') return { view: 'month', key: periodForToday('month') };
      if (preference === 'projects') return { view: 'projects', key: projectMonthForToday() };
      return readStoredViewState();
    }
    function startExternalEditWatch() {
      if (externalEditTimer || !externalEditWatchEnabled()) return;
      externalEditTimer = setInterval(checkExternalEdits, EXTERNAL_EDIT_POLL_MS);
      checkExternalEdits();
    }

    async function warmNavigationSnapshots() {
      const jobs = [];
      if (state.view !== 'daily') {
        const date = calendarTargetForMode('day');
        if (isViewYmd(date)) jobs.push(prefetchDailySnapshot(date));
      }
      if (state.view !== 'planning') {
        const weekKey = state.planner.type === 'week' && state.planner.key ? state.planner.key : calendarTargetForMode('week');
        jobs.push(prefetchWeekSnapshot(weekKey));
      }
      if (state.view !== 'projects') jobs.push(prefetchProjectSnapshot(state.project.monthKey || projectMonthForToday()));
      await Promise.all(jobs);
    }

    document.addEventListener('DOMContentLoaded', init);
