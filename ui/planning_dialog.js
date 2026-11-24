    function planDialogMetaText(item, index) {
      // 新しい予定には見せる情報がないので空にする（空のときは表示しない）。
      if (!item) return '';
      const parts = ['実績 ' + hours(item.actual) + 'h'];
      const priorityItems = plannerPriorityItems();
      const position = index != null ? index : priorityItems.findIndex(function(entry) { return entry.id === item.id; });
      if (position >= 0) parts.push('優先順 ' + (position + 1) + ' / ' + priorityItems.length);
      return parts.join(' · ');
    }
    // 日付の＋から開いた新しい予定の期間の初期値。押した日から、その週の金曜まで。
    function defaultPlanDialogRange(date) {
      return { start: date, end: weekFridayYmd(date) };
    }
    // 開始日・終了日の入力から期間を決める。両方空なら期間未定、片方だけならエラー。
    function planDialogPeriodFromInputs(startValue, endValue) {
      const start = String(startValue || '').trim();
      const end = String(endValue || '').trim();
      if (!start && !end) return { undated: true, startDate: '', endDate: '', error: '' };
      if (!isYmdText(start) || !isYmdText(end)) return { undated: false, startDate: start, endDate: end, error: '開始日と終了日は両方入れるか、両方空にしてください' };
      if (end < start) return { undated: false, startDate: start, endDate: end, error: '終了日は開始日以降にしてください' };
      return { undated: false, startDate: start, endDate: end, error: '' };
    }
    function updatePlanDialogPeriodHint() {
      const hint = document.getElementById('planDialogPeriodHint');
      if (!hint) return;
      const period = planDialogPeriodFromInputs(
        document.getElementById('planDialogStartDate').value,
        document.getElementById('planDialogEndDate').value
      );
      const clear = document.getElementById('clearPlanDialogPeriod');
      if (clear) clear.hidden = period.undated;
      hint.classList.toggle('is-over', !!period.error);
      hint.textContent = period.error
        ? period.error + '。'
        : period.undated
          ? '日付を入れなければ期間未定として登録します。完了するまで毎週の画面に出ます。'
          : 'この期間を予定として押さえます。日ごとの時間は決めず、実績だけを記録します。';
    }
    function clearPlanDialogPeriod() {
      document.getElementById('planDialogStartDate').value = '';
      document.getElementById('planDialogEndDate').value = '';
      updatePlanDialogPeriodHint();
    }

    function focusPlannerRow(planId) {
      state.planner.focusedPlanId = planId || '';
      document.querySelectorAll('#weekCalendar .span-row[data-plan-id]').forEach(function(row) {
        row.classList.toggle('is-focused', !!planId && row.dataset.planId === planId);
      });
    }

    function openPlanDialog(options) {
      options = options || {};
      const item = options.id ? plannerItems().find(function(entry) { return entry.id === options.id; }) : null;
      focusPlannerRow('');
      state.planner.editingId = item ? item.id : '';
      state.planner.editingDate = options.date || (item && item.startDate) || '';
      document.getElementById('planDialogTitle').textContent = item ? (item.hasPlan ? '予定を編集' : '実績のみ') : '予定を追加';
      const nameLocked = planNameLocked(item);
      const nameInput = document.getElementById('planDialogName');
      const nameText = document.getElementById('planDialogNameText');
      nameInput.value = item ? item.name : '';
      nameInput.hidden = nameLocked;
      nameText.hidden = !nameLocked;
      nameText.textContent = item ? item.name : '';
      state.planner.editingIssueUrl = item ? (item.issueUrl || '') : '';
      syncPlanDialogIssueLink();
      const presetProjectId = item ? (item.projectId || '') : (options.projectId || (typeof defaultAssignedProjectId === 'function' ? defaultAssignedProjectId() : ''));
      syncPlanDialogProjects(presetProjectId);
      document.getElementById('planDialogPlanned').value = item ? hours(item.planned) : '';
      document.getElementById('planDialogNote').value = item ? (item.note || '') : '';
      // 日付の＋から開いたら、その日から週の金曜までを入れておく。
      // 「予定を追加」からは空で開き、入れなければ期間未定になる。
      // 日付が空の旧データは、期間未定に変わらないよう登録した週の月〜金を入れて開く。
      const period = item
        ? (item.hasPlan !== false ? planDateRange(item, state.planner.key) : null)
        : (options.date ? defaultPlanDialogRange(options.date) : null);
      document.getElementById('planDialogStartDate').value = period ? period.start : '';
      document.getElementById('planDialogEndDate').value = period ? period.end : '';
      updatePlanDialogPeriodHint();
      const progressSelect = document.getElementById('planDialogProgress');
      const progressValue = item ? planProgressStatus(item) : 'todo';
      fillSelect(progressSelect, ['todo', 'doing', 'done'].map(function(value) {
        return { value: value, label: PLAN_PROGRESS_LABELS[value] };
      }), progressValue);
      progressSelect.dataset.initial = progressValue;
      progressSelect.disabled = false;
      document.getElementById('planDialogMeta').textContent = planDialogMetaText(item);
      const deleteButton = document.getElementById('deletePlanDialog');
      deleteButton.hidden = !item || !item.hasPlan;
      deleteButton.textContent = '削除';
      document.getElementById('planDialogPriority').hidden = !item || plannerPriorityItems().every(function(entry) { return entry.id !== item.id; });
      if (item) updatePlanDialogPriorityButtons();
      document.getElementById('commitPlanDialog').textContent = item ? '更新' : '追加';
      state.planner.editingSubtasks = item
        ? ((state.planner.summary && state.planner.summary.subtasks) || []).filter(function(task) {
            return planningTaskBelongsToPlan(task, item);
          }).map(function(task) { return copyPlannerSubtask(task, item.name); })
        : [];
      renderPlanDialogSubtasks();
      updatePlanDialogIssueSum();
      showAppDialog(document.getElementById('planDialog'));
      if (options.focusSubtask) addPlanDialogSubtask();
      else if (options.editSubtaskId) {
        const row = Array.from(document.querySelectorAll('#planDialogSubtaskList .plan-dialog-subtask-row')).find(function(entry) {
          return entry.dataset.id === options.editSubtaskId;
        });
        if (row) row.querySelector('.plan-dialog-subtask-title').focus();
      }
      else if (nameLocked) document.getElementById('planDialogPlanned').focus();
      else nameInput.focus();
      ensureProjectCatalog().then(function() {
        if (appDialogIsOpen(document.getElementById('planDialog'))) syncPlanDialogProjects(item ? (item.projectId || '') : (options.projectId || (typeof defaultAssignedProjectId === 'function' ? defaultAssignedProjectId() : '')));
      });
    }

    function applyPlanDialogProgress(item, subtasks) {
      const select = document.getElementById('planDialogProgress');
      const value = readOutlinedSelectValue(select) || 'todo';
      // 触っていなければ完了状態だけ従来どおり反映し、未着手・進行中の自動判定は残す。
      if (value === select.dataset.initial && value !== 'done') {
        setPlanCompletion(item, false, subtasks);
        return;
      }
      setPlanProgressStatus(item, value, subtasks);
    }
    function closePlanDialog() {
      const editedId = state.planner.editingId;
      hideAppDialog(document.getElementById('planDialog'));
      state.planner.editingId = '';
      state.planner.editingDate = '';
      state.planner.editingSubtasks = [];
      state.planner.editingIssueUrl = '';
      focusPlannerRow('');
      // 矢印キーで続けて操作できるよう、閉じたら編集していた行へフォーカスを戻す。
      if (editedId && state.view === 'planning') focusPlanRowName(editedId);
    }
    function syncPlanDialogSubtasksFromDom() {
      const rows = Array.from(document.querySelectorAll('#planDialogSubtaskList .plan-dialog-subtask-row'));
      if (!rows.length) return;
      const before = state.planner.editingSubtasks || [];
      state.planner.editingSubtasks = rows.map(function(row, index) {
        const current = before.find(function(task) { return task.id && task.id === row.dataset.id; }) || before[index] || {};
        const check = row.querySelector('.plan-dialog-subtask-done');
        const status = check ? (check.checked ? 'done' : (current.status === 'done' ? 'todo' : current.status || 'todo')) : (current.status || 'todo');
        return {
          id: row.dataset.id || current.id || uid('sub-'),
          parentKey: current.parentKey || '',
          parentPlanId: current.parentPlanId || state.planner.editingId || '',
          title: String((row.querySelector('.plan-dialog-subtask-title') || {}).value || '').slice(0, 200),
          plannedHours: numericHours((row.querySelector('.plan-dialog-subtask-hours') || {}).value),
          dueDate: current.dueDate || '',
          status: status,
          note: current.note || '',
          sortOrder: index
        };
      });
    }
    // サブタスクごとの実績（表示している期間の合計）。週の画面で使っている集計をそのまま使う。
    function planDialogSubtaskActual(task) {
      const item = findPlannerItem(plannerItems(), state.planner.editingId, '');
      if (!item || !String(task.title || '').trim()) return 0;
      const map = plannerSubtaskActualByDate(item, task, state.planner.timelineActualSummary);
      return roundHours(Object.keys(map).reduce(function(sum, date) { return sum + (Number(map[date]) || 0); }, 0));
    }
    function renderPlanDialogSubtasks() {
      const list = document.getElementById('planDialogSubtaskList');
      const tasks = state.planner.editingSubtasks || [];
      if (!tasks.length) {
        list.innerHTML = '<div class="subtask-empty">サブタスクを追加してください。</div>';
        updatePlanDialogIssueSum();
        return;
      }
      list.innerHTML = tasks.map(function(task, index) {
        const actual = planDialogSubtaskActual(task);
        const over = actual > roundHours(task.plannedHours) && roundHours(task.plannedHours) > 0;
        return '<div class="plan-dialog-subtask-row' + (task.status === 'done' ? ' is-done' : '') + '" data-id="' + escapeHtml(task.id || '') + '" data-index="' + index + '">' +
          '<md-checkbox touch-target="wrapper" class="plan-dialog-subtask-done"' + (task.status === 'done' ? ' checked' : '') + ' aria-label="完了"></md-checkbox>' +
          '<md-outlined-text-field class="field plan-dialog-subtask-title" placeholder="サブタスク名" aria-label="サブタスク名" value="' + escapeHtml(task.title || '') + '"></md-outlined-text-field>' +
          '<md-outlined-text-field class="field number-field plan-dialog-subtask-hours" type="number" min="0" step="0.25" aria-label="予定工数" value="' + liveHours(task.plannedHours) + '" suffix-text="h"></md-outlined-text-field>' +
          '<span class="plan-dialog-subtask-actual' + (over ? ' is-over' : '') + '" title="表示している期間の実績の合計">' + (actual > 0 ? compactHours(actual) + 'h' : '—') + '</span>' +
          '<md-icon-button touch-target="wrapper" class="icon-button remove-plan-subtask" aria-label="サブタスクを削除"><span class="material-symbols-outlined">close</span></md-icon-button></div>';
      }).join('');
      updatePlanDialogIssueSum();
    }
    function addPlanDialogSubtask() {
      syncPlanDialogSubtasksFromDom();
      (state.planner.editingSubtasks || (state.planner.editingSubtasks = [])).push({
        id: uid('sub-'),
        parentKey: '',
        parentPlanId: state.planner.editingId || '',
        title: '',
        plannedHours: 0,
        dueDate: '',
        status: 'todo',
        note: '',
        sortOrder: state.planner.editingSubtasks.length
      });
      renderPlanDialogSubtasks();
      const titles = document.querySelectorAll('#planDialogSubtaskList .plan-dialog-subtask-title');
      if (titles.length) titles[titles.length - 1].focus();
    }
    function editingIssuePlannedHours() {
      return (state.planner.editingSubtasks || []).reduce(function(sum, task) {
        return roundHours(sum + task.plannedHours);
      }, 0);
    }
    function issueHoursExceedPlan(planned, issueHours) {
      return roundHours(issueHours) > roundHours(planned);
    }
    function updatePlanDialogIssueSum() {
      const el = document.getElementById('planDialogIssueSum');
      if (!el) return;
      const tasks = state.planner.editingSubtasks || [];
      if (!tasks.length) {
        el.hidden = true;
        el.textContent = '';
        el.classList.remove('is-over');
        return;
      }
      const planned = roundHours(document.getElementById('planDialogPlanned').value);
      const issueHours = editingIssuePlannedHours();
      const over = issueHoursExceedPlan(planned, issueHours);
      el.hidden = false;
      const actual = roundHours(tasks.reduce(function(sum, task) { return sum + planDialogSubtaskActual(task); }, 0));
      const done = tasks.filter(function(task) { return task.status === 'done'; }).length;
      el.textContent = '完了 ' + done + '/' + tasks.length + '件 · サブタスク合計 予定 ' + compactHours(issueHours) + 'h（この予定 ' + compactHours(planned) + 'h）· 実績 ' + compactHours(actual) + 'h';
      el.classList.toggle('is-over', over);
    }
    function collectEditingSubtasks(parentName) {
      const parent = String(parentName || '').trim();
      if (!parent) return [];
      syncPlanDialogSubtasksFromDom();
      const next = [];
      for (let index = 0; index < (state.planner.editingSubtasks || []).length; index++) {
        const task = state.planner.editingSubtasks[index];
        const title = String(task.title || '').trim();
        if (!title) continue;
        next.push(copyPlannerSubtask(Object.assign({}, task, { title: title, sortOrder: next.length }), parent));
      }
      return next;
    }
    function applyCollectedSubtasks(parentName, parentPlanId, tasks) {
      const parent = String(parentName || '').trim();
      if (!parent || !tasks) return;
      tasks.forEach(function(task) {
        task.parentKey = parent;
        task.parentPlanId = parentPlanId || task.parentPlanId || '';
      });
      if (!state.planner.summary) state.planner.summary = { rows: [], subtasks: [] };
      const others = (state.planner.summary.subtasks || []).filter(function(task) {
        return !planningTaskBelongsToPlan(task, { id: parentPlanId, name: parent });
      });
      state.planner.summary.subtasks = others.concat(tasks);
      if (state.planner.type === 'week') rememberWeeklySubtasks(state.planner.key, state.planner.summary.subtasks);
    }

    function findCapacityEvent(dateValue, eventKey, eventIndex) {
      const days = (state.planner.summary && state.planner.summary.capacity && state.planner.summary.capacity.days) || [];
      const day = days.find(function(entry) { return entry.date === dateValue; });
      if (!day) return null;
      if (eventIndex != null && day.events && day.events[eventIndex]) {
        const event = day.events[eventIndex];
        if (calendarEventKey(event, dateValue, eventIndex) === eventKey) return { day: day, event: event, index: eventIndex };
      }
      const index = (day.events || []).findIndex(function(event, current) {
        return calendarEventKey(event, dateValue, current) === eventKey;
      });
      return index >= 0 ? { day: day, event: day.events[index], index: index } : null;
    }

    function openCalendarEventDialog(eventKey, dateValue, eventIndex) {
      const found = findCapacityEvent(dateValue, eventKey, eventIndex);
      if (!found) return;
      const excluded = excludedCalendarKeys().indexOf(eventKey) >= 0;
      state.planner.editingEvent = { key: eventKey, date: dateValue, index: found.index };
      document.getElementById('calendarEventTitle').textContent = found.event.title || 'カレンダー予定';
      document.getElementById('calendarEventWhen').textContent = timelineDateLabel(dateValue) + ' · ' + (found.event.allDay ? '終日' : ((found.event.startTime || '') + (found.event.endTime ? '–' + found.event.endTime : ''))) + (excluded ? ' · 実施しない' : '');
      let recorded = state.daily.loadedDate === dateValue && state.daily.rows.find(function(row) { return row.calendarKey === eventKey; });
      if (!recorded) {
        // 日次を開いていないときは、週の画面が読んでいる、実績に回した記録（前後の週を含む）から探す。
        const model = weekTimelineDisplayModel(calculateWeekPlanModel());
        const entry = ((model.calendarInterruptsByDate || {})[dateValue] || []).find(function(item) { return item.calendarKey === eventKey; });
        if (entry) recorded = { today: roundHours(entry.hours) };
      }
      document.getElementById('calendarEventHours').value = hours(recorded && recorded.today > 0 ? recorded.today : calendarEventHours(found.event));
      document.getElementById('excludeCalendarEvent').hidden = excluded;
      document.getElementById('restoreCalendarEvent').hidden = !excluded;
      document.getElementById('commitCalendarEvent').hidden = excluded;
      document.getElementById('commitCalendarEvent').textContent = recorded && recorded.today > 0 ? '実績を更新' : '実績で記録';
      showAppDialog(document.getElementById('calendarEventDialog'));
      document.getElementById('calendarEventHours').focus();
    }

    function closeCalendarEventDialog() {
      hideAppDialog(document.getElementById('calendarEventDialog'));
      state.planner.editingEvent = null;
    }

    async function commitCalendarEventDialog() {
      const editing = state.planner.editingEvent;
      if (!editing) return;
      const found = findCapacityEvent(editing.date, editing.key, editing.index);
      if (!found) return;
      const rawHours = Number(document.getElementById('calendarEventHours').value);
      if (!Number.isFinite(rawHours) || rawHours <= 0 || !isQuarterHour(rawHours)) {
        return toast('実績時間は0.25h単位で入力してください', 'error');
      }
      const actualHours = roundHours(rawHours);
      closeCalendarEventDialog();
      try {
        const opened = await openPlannerActualDay(editing.date);
        if (!opened || state.daily.loadedDate !== editing.date) return;
        const task = dailyCalendarTasksForDate(editing.date).find(function(entry) { return entry.calendarKey === editing.key; });
        const existing = state.daily.rows.find(function(row) { return row.calendarKey === editing.key; });
        const estimate = task ? roundHours(task.estimate) : roundHours(calendarEventHours(found.event));
        const row = existing || {
          id: uid('row-'), planId: task && task.planId || '', calendarKey: editing.key,
          projectId: typeof defaultAssignedProjectId === 'function' ? defaultAssignedProjectId() : '',
          name: task && task.name || found.event.title || 'カレンダー予定',
          today: 0, previous: 0, estimate: estimate, status: '', type: task && task.imported ? 'calendar-imported' : 'calendar'
        };
        row.today = actualHours;
        row.status = actualHours >= estimate ? '完了' : '';
        if (!existing) state.daily.rows.push(row);
        renderDaily();
        markDailyDirty();
        await saveDaily();
      } catch (error) {
        toast('カレンダー予定の実績を記録できませんでした: ' + error.message, 'error');
      }
    }

    function excludeEditingCalendarEvent() {
      const editing = state.planner.editingEvent;
      if (!editing) return;
      excludeCalendarPlan(state.planner.key, editing.key);
      removeCalendarPlanImport(editing.key);
      markPlannerChanged();
      closeCalendarEventDialog();
      updatePlannerSummary();
    }

    function restoreEditingCalendarEvent() {
      const editing = state.planner.editingEvent;
      if (!editing) return;
      restoreCalendarPlan(editing.key, state.planner.key);
      markPlannerChanged();
      closeCalendarEventDialog();
      updatePlannerSummary();
    }

    function planDialogNameValue() {
      const editing = state.planner.editingId
        ? plannerItems().find(function(entry) { return entry.id === state.planner.editingId; })
        : null;
      return editing && planNameLocked(editing) ? String(editing.name || '') : document.getElementById('planDialogName').value;
    }
    function syncPlanDialogIssueLink() {
      const link = document.getElementById('planDialogIssueLink');
      const issue = planBacklogIssue(planDialogNameValue(), state.planner.editingIssueUrl);
      link.hidden = !issue;
      if (!issue) return;
      link.href = issue.url;
      link.querySelector('.plan-issue-link-key').textContent = issue.key;
    }
    // Backlog からコピーした「課題キー 件名」を貼ると、リンク先の課題URLも一緒に覚える。
    function handlePlanDialogNamePaste(event) {
      const data = event.clipboardData;
      if (!data) return;
      const issue = backlogIssueFromClipboard(data.getData('text/html'), data.getData('text/plain'));
      if (!issue) return;
      event.preventDefault();
      const field = document.getElementById('planDialogName');
      const value = String(field.value || '');
      const start = field.selectionStart == null ? value.length : field.selectionStart;
      const end = field.selectionEnd == null ? value.length : field.selectionEnd;
      field.value = (value.slice(0, start) + issue.name + value.slice(end)).slice(0, 200);
      state.planner.editingIssueUrl = issue.url;
      syncPlanDialogIssueLink();
    }

    function commitPlanDialog() {
      const editing = state.planner.editingId
        ? plannerItems().find(function(entry) { return entry.id === state.planner.editingId; })
        : null;
      const nameInput = document.getElementById('planDialogName');
      const name = editing
        ? (planNameLocked(editing) ? String(editing.name || '').trim() : nameInput.value.trim())
        : nameInput.value.trim();
      const planned = Math.max(0, roundHours(document.getElementById('planDialogPlanned').value));
      const note = document.getElementById('planDialogNote').value.trim();
      const selectedProjectId = planDialogProjectSelection();
      const period = planDialogPeriodFromInputs(
        document.getElementById('planDialogStartDate').value,
        document.getElementById('planDialogEndDate').value
      );
      const undated = period.undated;
      const startDate = period.startDate;
      const endDate = period.endDate;
      const issueUrl = planBacklogIssue(name, state.planner.editingIssueUrl) ? state.planner.editingIssueUrl : '';
      if (!name) return toast('タスク名を入力してください', 'error');
      if (period.error) {
        updatePlanDialogPeriodHint();
        return toast(period.error, 'error');
      }
      if (!editing && plannerItems().some(function(item) { return item.name === name; })) {
        return toast('タスク名「' + name + '」が重複しています', 'error');
      }
      const nextSubtasks = collectEditingSubtasks(name);
      if (!nextSubtasks) return;
      const issueHours = nextSubtasks.reduce(function(sum, task) { return roundHours(sum + task.plannedHours); }, 0);
      if (issueHoursExceedPlan(planned, issueHours)) {
        updatePlanDialogIssueSum();
        return toast('サブタスクの予定工数の合計が予定を超えています（' + hours(issueHours) + 'h / ' + hours(planned) + 'h）', 'error');
      }
      if (editing) {
        const item = editing;
        const previousName = String(item.name || '').trim();
        item.issueUrl = issueUrl;
        renamePlannerNameReferences(item, previousName, name);
        item.name = name;
        item.planned = planned;
        item.estimatedTotal = planned;
        item.startDate = startDate;
        item.endDate = endDate;
        item.undated = undated;
        item.note = note;
        item.projectId = selectedProjectId;
        applyPlanDialogProgress(item, nextSubtasks);
        item.hasPlan = true;
      } else {
        const hasSaved = plannerItems().some(function(item) { return item.hasPlan; });
        const newPlanId = uid('plan-');
        plannerItems().push({
          id: newPlanId,
          name: name,
          planned: planned,
          actual: 0,
          actualByDate: {},
          estimatedTotal: planned,
          hasPlan: true,
          planKind: hasSaved ? 'added' : 'initial',
          initialPlanned: planned,
          createdAt: '',
          priority: nextPlanPriority(name),
          note: note,
          startDate: startDate,
          endDate: endDate,
          undated: undated,
          dailyCap: 0,
          dailyPlan: {},
          originWeek: state.planner.type === 'week' ? state.planner.key : '',
          projectId: selectedProjectId,
          issueUrl: issueUrl,
          done: false,
          completionOverride: null
        });
        applyPlanDialogProgress(plannerItems()[plannerItems().length - 1], nextSubtasks);
        rememberWeeklyPlanName(name, { planId: newPlanId, projectId: selectedProjectId });
      }
      const savedPlan = editing || plannerItems()[plannerItems().length - 1];
      applyCollectedSubtasks(name, savedPlan && savedPlan.id, nextSubtasks);
      markPlannerChanged();
      closePlanDialog();
      updatePlannerSummary();
      const shown = (calculateWeekPlanModel().rows || []).find(function(row) { return savedPlan && row.id === savedPlan.id; });
      if (shown && !shown.visible && !undated) {
        toast('「' + name + '」は ' + planRangeLabel({ start: startDate, end: endDate }) + ' の予定です。その期間の週に表示されます', 'success');
      }
    }

    async function deletePlannerItemById(id) {
      const item = plannerItems().find(function(entry) { return entry.id === id; });
      if (!item) return false;
      const ok = await confirmDialog({
        title: '「' + item.name + '」を削除しますか？',
        message: 'この予定を週予定から削除します。',
        confirmLabel: '削除する',
        cancelLabel: 'キャンセル',
        danger: true
      });
      if (!ok) return false;
      removePlannerSubtasksForParent(item.name, item.id);
      state.planner.items = plannerItems().filter(function(entry) { return entry.id !== item.id; });
      // 前の週などで登録した予定は、この週の保存では消えないので、登録元の週から消す分として覚えておく。
      const origin = item.originWeek || item.carryWeek;
      if (state.planner.type === 'week' && origin && origin !== state.planner.key && item.hasPlan !== false) {
        (state.planner.deletedOrigins || (state.planner.deletedOrigins = [])).push({ id: item.id || '', name: item.name || '', originWeek: origin, periodKey: state.planner.key });
      }
      markPlannerChanged();
      if (state.planner.editingId === id) closePlanDialog();
      updatePlannerSummary();
      return true;
    }

    function deleteEditingPlan() {
      deletePlannerItemById(state.planner.editingId);
    }

    function movePlannerItemById(id, delta) {
      const priorityItems = plannerPriorityItems();
      const priorityIndex = priorityItems.findIndex(function(entry) { return entry.id === id; });
      const nextPriorityIndex = priorityIndex + delta;
      if (priorityIndex < 0 || nextPriorityIndex < 0 || nextPriorityIndex >= priorityItems.length) return;
      const moved = priorityItems[priorityIndex];
      priorityItems[priorityIndex] = priorityItems[nextPriorityIndex];
      priorityItems[nextPriorityIndex] = moved;
      assignPlanPriorities(priorityItems);
      markPlannerChanged();
      updatePlannerSummary();
      if (state.planner.editingId === id) {
        document.getElementById('planDialogMeta').textContent = planDialogMetaText(moved, nextPriorityIndex);
        updatePlanDialogPriorityButtons();
      }
    }

    function updatePlanDialogPriorityButtons() {
      const items = plannerPriorityItems();
      const index = items.findIndex(function(entry) { return entry.id === state.planner.editingId; });
      document.getElementById('movePlanUp').disabled = index <= 0;
      document.getElementById('movePlanDown').disabled = index < 0 || index >= items.length - 1;
    }

    function moveEditingPlan(delta) {
      movePlannerItemById(state.planner.editingId, delta);
    }

    function plannerRowOrder() {
      return Array.prototype.map.call(document.querySelectorAll('#weekCalendar .span-row[data-plan-id]'), function(row) {
        return row.dataset.planId;
      });
    }

    function reorderPlannerItemsByPriorityOrder(order) {
      const items = plannerItems();
      const priorityItems = plannerPriorityItems();
      if (!priorityItems.length) return false;
      const priorityIds = priorityItems.map(function(item) { return item.id; });
      const requested = [];
      (order || []).forEach(function(id) {
        if (priorityIds.indexOf(id) >= 0 && requested.indexOf(id) < 0) requested.push(id);
      });
      priorityIds.forEach(function(id) {
        if (requested.indexOf(id) < 0) requested.push(id);
      });
      if (requested.join('\0') === priorityIds.join('\0')) return false;
      const byId = {};
      priorityItems.forEach(function(item) { byId[item.id] = item; });
      assignPlanPriorities(requested.map(function(id) { return byId[id]; }));
      return true;
    }

    function plannerReorderBlock(row) {
      const block = [row];
      let next = row.nextElementSibling;
      while (next && next.classList && next.classList.contains('span-subtask-lane') && next.dataset.parentPlanId === row.dataset.planId) {
        block.push(next);
        next = next.nextElementSibling;
      }
      return block;
    }

    function bindPlannerRowDraggables() {
      const calendar = document.getElementById('weekCalendar');
      const parent = calendar && calendar.querySelector('.week-span');
      if (!parent) {
        if (calendar) releaseReorderBinding(calendar);
        return;
      }
      bindReorderDraggables(parent, {
        bindKey: calendar,
        selector: '.span-row[data-plan-id]',
        handleSelector: '.span-priority-handle',
        keyOf: function(row) { return row.dataset.planId; },
        blockFor: plannerReorderBlock,
        canDrag: function(row) {
          const item = plannerItems().find(function(entry) { return entry.id === row.dataset.planId; });
          return !!(item && item.hasPlan !== false);
        },
        onPress: function(row) {
          focusPlannerRow(row.dataset.planId);
        },
        onFinish: function(list, changed) {
          focusPlannerRow('');
          // つかんで離しただけでも、離した瞬間のクリックで予定の詳細が開かないようにする。
          state.suppressPlanClick = true;
          setTimeout(function() { state.suppressPlanClick = false; }, 300);
          if (!changed) return;
          if (reorderPlannerItemsByPriorityOrder(plannerRowOrder())) {
            markPlannerChanged();
            updatePlannerSummary({ skipCalendar: true });
            schedulePlannerReorderPaint();
          } else {
            renderWeekCalendar();
          }
        },
        onCancel: function() {
          focusPlannerRow('');
          state.suppressPlanClick = true;
          setTimeout(function() { state.suppressPlanClick = false; }, 300);
          renderWeekCalendar();
        }
      });
    }

    function closePlanContextMenu() {
      const menu = document.getElementById('planContextMenu');
      if (!menu || !menu.open) return;
      menu.close();
      menu.dataset.planId = '';
    }

    function closePlanStatusMenu() {
      const menu = document.getElementById('planStatusMenu');
      if (!menu || !menu.open) return;
      menu.close();
      menu.dataset.planId = '';
    }

    function openPlanStatusMenu(planId, button) {
      const item = plannerItems().find(function(entry) { return entry.id === planId; });
      if (!item || !button) return;
      closePlanContextMenu();
      const menu = document.getElementById('planStatusMenu');
      const current = planProgressStatus(item);
      menu.dataset.planId = planId;
      menu.querySelectorAll('[data-progress]').forEach(function(option) {
        option.selected = option.dataset.progress === current;
        option.classList.toggle('is-current', option.dataset.progress === current);
      });
      const rect = button.getBoundingClientRect();
      const anchor = document.getElementById('planStatusMenuAnchor');
      anchor.style.left = Math.max(8, rect.left) + 'px';
      anchor.style.top = Math.max(8, rect.bottom + 4) + 'px';
      menu.show();
    }

    function changePlanProgressStatus(planId, status) {
      const item = plannerItems().find(function(entry) { return entry.id === planId; });
      if (!item || planProgressStatus(item) === status) return;
      setPlanProgressStatus(item, status);
      markPlannerChanged();
      updatePlannerSummary();
    }

    function openPlanContextMenu(planId, x, y) {
      const items = plannerPriorityItems();
      const index = items.findIndex(function(entry) { return entry.id === planId; });
      const item = items[index];
      if (!item) return;
      focusPlannerRow(planId);
      const menu = document.getElementById('planContextMenu');
      menu.dataset.planId = planId;
      menu.querySelector('[data-action="up"]').disabled = index <= 0;
      menu.querySelector('[data-action="down"]').disabled = index >= items.length - 1;
      const deleteItem = menu.querySelector('[data-action="delete"]');
      deleteItem.hidden = false;
      deleteItem.querySelector('[slot="headline"]').textContent = '削除';
      const doneButton = menu.querySelector('[data-action="done"]');
      doneButton.querySelector('[slot="headline"]').textContent = planIsComplete(item) ? '完了を取り消す' : '完了にする';
      doneButton.disabled = false;
      const anchor = document.getElementById('planContextMenuAnchor');
      anchor.style.left = Math.max(8, x) + 'px';
      anchor.style.top = Math.max(8, y) + 'px';
      menu.show();
    }

    function editWorkCapacity(element) {
      const dateValue = element.dataset.date;
      document.getElementById('capacityDialog').dataset.date = dateValue;
      document.getElementById('capacityDialogDate').textContent = timelineDateLabel(dateValue);
      document.getElementById('capacityHours').value = hours(element.dataset.hours || 0);
      document.getElementById('capacityReason').value = element.dataset.reason || '';
      showAppDialog(document.getElementById('capacityDialog'));
      document.getElementById('capacityHours').focus();
    }
    function closeCapacityDialog() {
      hideAppDialog(document.getElementById('capacityDialog'));
    }
    async function commitCapacityDialog() {
      const dateValue = document.getElementById('capacityDialog').dataset.date;
      const hoursValue = roundHours(document.getElementById('capacityHours').value);
      const reason = document.getElementById('capacityReason').value;
      if (!dateValue) return;
      if (!isFinite(hoursValue) || hoursValue < 0 || hoursValue > 24) return toast('稼働時間は0〜24時間で入力してください', 'error');
      showBusy('稼働時間を保存しています…');
      try {
        const saved = await gas('saveWorkCapacitySetting', dateValue, hoursValue, reason);
        applyWorkCapacitySetting({
          date: (saved && saved.date) || dateValue,
          hours: saved && saved.hours != null ? saved.hours : hoursValue,
          reason: saved && saved.reason != null ? saved.reason : reason
        });
        commitEditHistory();
        closeCapacityDialog();
        renderForecastTimeline();
        toast(timelineDateLabel(dateValue) + ' を ' + hours(hoursValue) + 'h に設定しました', 'success');
      } catch (error) { toast('稼働時間を保存できませんでした: ' + error.message, 'error'); }
      finally { hideBusy(); }
    }

    function markPlannerChanged(options) {
      state.planner.dirty = true;
      state.planner.changeSeq += 1;
      commitEditHistory(options);
    }

    function collectPlannerSubtasksFrom(items, subtasks, periodType, periodKey) {
      const parentNames = {};
      const parentIds = {};
      (items || []).forEach(function(item) {
        const name = String(item.name || '').trim();
        if (item.hasPlan !== false && name) {
          parentNames[name] = item;
          if (item.id) parentIds[item.id] = item;
        }
      });
      const seen = {};
      return (subtasks || []).map(function(task) {
        // 前の週の予定タスクを、今週の同名課題へ足すと工数が倍になり保存できない。
        if (periodKey && task && task.periodKey && String(task.periodKey) !== String(periodKey)) return null;
        const byId = task && task.parentPlanId && parentIds[task.parentPlanId];
        if (task && task.parentPlanId && !byId) return null;
        // 古い/再生成された親予定IDが残っていても、保存時に親名で再結合する。
        const parent = byId || parentNames[task && task.parentKey];
        if (!parent) return null;
        const copied = copyPlannerSubtask(task, parent.name);
        copied.parentPlanId = parent.id || '';
        return copied;
      }).filter(function(task) {
        if (!task || !task.title) return false;
        // 同じ親に同名の作業を複数登録できる。タイトルではなくIDで重複判定する。
        const key = task.id || ((task.parentPlanId || task.parentKey) + '\0' + task.title);
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      }).map(function(task, index) {
        task.sortOrder = index;
        if (periodType) task.periodType = periodType;
        if (periodKey) task.periodKey = periodKey;
        return task;
      });
    }
    function collectPlanningPayload(options) {
      const periodType = options.periodType;
      const periodKey = options.periodKey;
      const plans = [], seenIds = {}, seenNames = {};
      const items = (options.items || []).filter(function(item) {
        if (!item || item.hasPlan === false) return false;
        // 他の週から重ねた予定は、この週の新しい予定行として保存しない。
        // 保存すると日次の実績と完了チェックが外れ、作りたての未完了予定に見える。
        // サーバーが前週から引き継いだ行は carryWeek が空で originWeek だけ持つため、
        // originWeek だけでも判定する（繰り越し処理が失敗した状態で保存すると重複行になる）。
        const carriedFrom = String(item.carryWeek || '').trim();
        if (carriedFrom && carriedFrom !== periodKey) return false;
        const origin = String(item.originWeek || '').trim();
        if (origin && origin !== periodKey) return false;
        return true;
      });
      items.forEach(function(item, planIndex) {
        const name = String(item.name || '').trim();
        const planned = roundHours(item.planned);
        const planId = String(item.id || '').trim();
        if (!name) throw new Error('タスク名を入力してください。');
        if (planId) {
          if (seenIds[planId]) {
            if (item.projectId) {
              const prior = plans.find(function(plan) { return plan.planId === planId; });
              if (prior && !prior.projectId) prior.projectId = item.projectId;
            }
            return;
          }
          seenIds[planId] = true;
        } else if (seenNames[name]) {
          throw new Error('タスク名「' + name + '」が重複しています。');
        } else {
          seenNames[name] = true;
        }
        if (!isFinite(planned) || planned < 0) throw new Error(name + ' の予定工数が不正です。');
        const storedCompletion = planCompletionForSave(item, options.subtasks);
        if (planPriorityValue(item) == null) item.priority = (planIndex + 1) * PLAN_PRIORITY_STEP;
        plans.push({
          periodType: periodType,
          periodKey: periodKey,
          aggregationKey: name,
          plannedHours: planned,
          estimatedTotalHours: planned,
          initialPlannedHours: roundHours(item.initialPlanned),
          planKind: item.planKind,
          createdAt: item.createdAt,
          planId: item.id,
          note: restPlanNote(item.note),
          startDate: item.startDate,
          endDate: item.endDate || '',
          undated: !!item.undated,
          dailyCap: item.dailyCap,
          carryWeek: item.carryWeek || '',
          calendarKey: item.calendarKey,
          projectId: item.projectId || '',
          issueUrl: planBacklogIssue(name, item.issueUrl) ? item.issueUrl : '',
          done: storedCompletion.done,
          completionOverride: storedCompletion.completionOverride,
          progress: normalizePlanProgress(item.progress),
          dailyPlan: normalizePlanDailyPlan(item.dailyPlan),
          priority: planPriorityValue(item)
        });
      });
      const payload = {
        periodType: periodType,
        periodKey: periodKey,
        plans: plans,
        calendarExclusions: options.calendarExclusions || []
      };
      if (Array.isArray(options.subtasks)) {
        payload.subtasks = collectPlannerSubtasksFrom(items, options.subtasks, periodType, periodKey);
        const limits = {};
        const totals = {};
        const limitNames = {};
        plans.forEach(function(plan) {
          if (plan.planId) limits[plan.planId] = roundHours(plan.plannedHours);
          limits[plan.aggregationKey] = roundHours(plan.plannedHours);
          if (plan.planId) limitNames[plan.planId] = plan.aggregationKey;
          limitNames[plan.aggregationKey] = plan.aggregationKey;
        });
        payload.subtasks.forEach(function(task) {
          const parent = task.parentPlanId || task.parentKey;
          totals[parent] = roundHours((totals[parent] || 0) + Number(task.plannedHours || 0));
        });
        Object.keys(totals).forEach(function(parent) {
          if (limits[parent] == null) return;
          const totalHours = totals[parent];
          const limitHours = limits[parent];
          if (issueHoursExceedPlan(limitHours, totalHours)) {
            parent = limitNames[parent] || parent;
            throw new Error('課題「' + parent + '」の予定工数合計が予定を超えています（' + hours(totalHours) + 'h / ' + hours(limitHours) + 'h）。');
          }
        });
      }
      return payload;
    }
    function collectPlanner() {
      return collectPlanningPayload({
        periodType: state.planner.type,
        periodKey: state.planner.key,
        items: plannerItems(),
        subtasks: state.planner.summary && Array.isArray(state.planner.summary.subtasks)
          ? state.planner.summary.subtasks
          : null,
        calendarExclusions: excludedCalendarKeys()
      });
    }
    function collectPlannerSubtasks() {
      return collectPlannerSubtasksFrom(
        plannerItems(),
        (state.planner.summary && state.planner.summary.subtasks) || [],
        state.planner.type,
        state.planner.key
      );
    }

    let plannerReorderPaint = 0;

    function schedulePlannerReorderPaint() {
      const token = ++plannerReorderPaint;
      setTimeout(function() {
        if (token !== plannerReorderPaint) return;
        if (reorderDrag) {
          schedulePlannerReorderPaint();
          return;
        }
        renderWeekCalendar();
      }, 200);
    }

    function updatePlannerSummary(options) {
      options = options || {};
      let planned = 0, actual = 0, planCount = 0, addedCount = 0;
      const today = ymd(new Date());
      const model = calculateWeekPlanModel();
      const rowById = {};
      (model.rows || []).forEach(function(row) { rowById[row.id] = row; });
      const statuses = [];
      plannerItems().forEach(function(item) {
        const row = rowById[item.id];
        // この週の画面に出ていない予定（期間が先の週など）は集計に入れない。
        if (item.hasPlan !== false && row && !row.visible) return;
        planned += roundHours(item.planned);
        actual += roundHours(item.actual);
        if (item.hasPlan !== false && plannerHasWorkHours(item.planned, item.actual)) { planCount++; if (item.planKind === 'added') addedCount++; }
        if (item.hasPlan === false || !plannerHasWorkHours(item.planned, item.actual)) return;
        statuses.push(planPeriodStatus(item, row && row.range, today, planIsComplete(item)));
      });
      const rollup = statusRollup(statuses);
      document.getElementById('planHours').textContent = hours(planned);
      document.getElementById('actualHours').textContent = hours(actual);
      document.getElementById('planCount').textContent = '当初 ' + (planCount - addedCount) + ' / 追加 ' + addedCount + 'タスク';
      document.getElementById('consumeRate').textContent = planned > 0 ? '消化率 ' + Math.round(actual / planned * 100) + '%' : '消化率 —';
      applyStatusCard('statusSummaryCard', 'weekStatus', 'statusMeta', rollup);
      if (!options.skipCalendar) renderWeekCalendar(model);
      updateSaveDock();
      schedulePlannerAutoSave();
    }

    async function savePlanner(options) {
      options = options || {};
      const auto = !!options.auto;
      if (state.planner.saving) { state.planner.saveQueued = true; return; }
      if (!state.storage || !state.storage.configured) {
        openPlanningSetup();
        return toast('予定を保存する前にDriveの保存先を設定してください');
      }
      let payload;
      cancelPlannerAutoSave();
      try { payload = collectPlanner(); } catch (error) { return toast(error.message, 'error'); }
      const saveSeq = state.planner.changeSeq;
      const saveType = state.planner.type;
      const saveKey = state.planner.key;
      state.planner.saving = true;
      state.planner.savingSeq = saveSeq;
      state.planner.savingAuto = auto;
      updateSaveDock();
      if (!auto) showBusy('この期間の予定を保存しています…');
      state.nav.planner += 1;
      try {
        const liveItems = plannerItems().slice();
        const liveSubtasks = ((state.planner.summary && state.planner.summary.subtasks) || []).slice();
        const saved = await gas('savePlanningWorkspace', payload);
        invalidateProjectSnapshots();
        state.planner.autoSaveRetryCount = 0;
        delete state.parentNamesByWeek[payload.periodKey];
        delete state.weeklySubtasksByWeek[payload.periodKey];
        delete state.weekForecastCache[payload.periodKey];
        rememberCarriedWeekCaches(payload.periodKey);
        let continuationError = null;
        if (saveType === 'week') {
          const deletions = (state.planner.deletedOrigins || []).filter(function(entry) {
            return entry.periodKey === saveKey && !liveItems.some(function(item) { return entry.id ? item.id === entry.id : item.name === entry.name; });
          });
          try {
            await saveContinuedOrigins(saveKey, liveItems, liveSubtasks, deletions);
            state.planner.deletedOrigins = (state.planner.deletedOrigins || []).filter(function(entry) { return deletions.indexOf(entry) < 0; });
          }
          catch (error) { continuationError = error; }
        }
        // 持ち越し元の書き戻しを待つ間の変更も、保存済み扱いにしない。
        const unchanged = saveSeq === state.planner.changeSeq && saveType === state.planner.type && saveKey === state.planner.key;
        if (continuationError) {
          state.planner.dirty = true;
          toast('持ち越し予定の完了状態を保存できませんでした: ' + continuationError.message, 'error');
        } else if (unchanged) {
          state.planner.summary = saved;
          state.planner.dirty = false;
          state.planner.changeSeq = 0;
          if (saveType === 'week') {
            if (!auto) {
              try { await applyPreviousWeekContinuations(); }
              catch (_) { updatePlannerSummary(); }
            } else {
              // 自動保存直後は画面上の liveItems を維持し、過去16週の再読込は行わない。
              // 持ち越し元の保存は上で完了しているため、次回の明示的な読込で整合する。
              state.planner.items = liveItems;
              if (state.planner.summary) state.planner.summary.subtasks = liveSubtasks;
              updatePlannerSummary();
            }
            setDailyWeekWorkspace(saveKey, state.planner.summary, plannerItems());
            rememberWeekSnapshot(saveType, saveKey, state.planner.summary, {
              overlay: { items: plannerItems().slice(), subtasks: ((state.planner.summary && state.planner.summary.subtasks) || []).slice() }
            });
            startPlannerCapacityLoad();
          } else {
            renderPlanner();
            startPlannerCapacityLoad();
          }
        }
        if (!auto && !continuationError) toast('この期間の予定を保存しました', 'success');
        if (!continuationError) scheduleAutoGoogleTasksSync(googleTasksSyncMonthKey());
      } catch (error) {
        if (auto) state.planner.autoSaveRetryCount = Math.min(8, state.planner.autoSaveRetryCount + 1);
        toast((auto ? '自動保存に失敗しました: ' : '予定の保存に失敗しました: ') + error.message, 'error');
      } finally {
        state.planner.saving = false;
        state.planner.savingAuto = false;
        if (!auto) hideBusy();
        updateSaveDock();
        if (state.planner.dirty) schedulePlannerAutoSave(auto && state.planner.autoSaveRetryCount ? autoSaveRetryDelay(state.planner.autoSaveRetryCount) : undefined);
        state.planner.saveQueued = false;
      }
    }
