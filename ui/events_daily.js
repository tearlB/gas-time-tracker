    function openExternal(kind) {
      if (kind === 'gas' && SCRIPT_EDITOR_URL) return window.open(SCRIPT_EDITOR_URL, '_blank', 'noopener');
      if (kind === 'feedback' && FEEDBACK_FORM_URL) return window.open(FEEDBACK_FORM_URL, '_blank', 'noopener');
      if (kind === 'planning-sheet') {
        const targetYear = state.view === 'daily'
          ? Number(state.daily.date.slice(0, 4))
          : state.view === 'projects'
            ? Number((state.project.monthKey || projectMonthForToday()).slice(0, 4))
            : Number(state.planner.key.slice(0, 4));
        const annualFile = state.storage && (state.storage.files || []).find(function(file) { return file.year === targetYear; });
        const targetFile = annualFile || state.storage && state.storage.file;
        if (targetFile && targetFile.url) return window.open(targetFile.url, '_blank', 'noopener');
        return openPlanningSetup();
      }
      if (kind === 'sheet' && state.view === 'planning') return openExternal('planning-sheet');
      if (kind === 'sheet' && state.daily.url) return window.open(state.daily.url, '_blank', 'noopener');
      if (kind === 'sheet') {
        showBusy('スプレッドシートを確認しています…');
        gas('ensureSpreadsheetUrl', state.daily.date).then(function(url) { state.daily.url = url; window.open(url, '_blank', 'noopener'); }).catch(function(error) { toast(error.message, 'error'); }).finally(hideBusy);
      }
    }

    // 元に戻すの単位をそろえるための、入力欄ごとの名前（行と欄の種類）。
    function dailyInputHistoryKey(row, target) {
      const field = String(target && target.className || '').split(/\s+/).filter(function(name) { return name && name !== 'field'; }).sort().join('.');
      return 'daily-input:' + (row && row.dataset.id || '') + ':' + field;
    }

    function wireDailyTaskListEvents(taskList) {
      if (!taskList) return;
      taskList.addEventListener('input', function(event) {
        const row = event.target.closest('.work-card');
        if (!row) return;
        syncDailyRowStatus(row);
        syncDailyRowOrigin(row);
        markDailyDirty({ coalesce: true, key: dailyInputHistoryKey(row, event.target), deferAutoSave: true });
        if (state.timer && state.timer.rowId === row.dataset.id && (event.target.classList.contains('task-name') || event.target.classList.contains('task-parent') || event.target.classList.contains('interrupt-name'))) {
          state.timer.task = composedDailyNameFromRow(row);
          persistTimer();
          renderTimer();
        }
      });
      taskList.addEventListener('change', function(event) {
        const row = event.target.closest('.work-card');
        if (!row) return;
        if (calendarRowNameChanged(event.target)) {
          convertCalendarRowToInterrupt(row);
          return;
        }
        if (interruptRowNameMatchesCalendar(event.target) && revertInterruptRowToCalendar(row)) return;
        if (event.target.classList.contains('today-value')) {
          event.target.value = hours(numericHours(event.target.value));
          const minus = event.target.parentElement && event.target.parentElement.querySelector('.today-step[data-step="-0.25"]');
          if (minus) minus.disabled = numericHours(event.target.value) <= 0;
        }
        if (event.target.classList.contains('daily-project')) {
          const chosen = String(event.target.value || '');
          row.dataset.projectId = chosen;
          const stored = (state.daily.rows || []).find(function(item) { return item.id === row.dataset.id; });
          if (stored) stored.projectId = chosen;
        }
        syncCalendarVarianceRow(row);
        syncDailyRowStatus(row);
        syncDailyRowOrigin(row);
        if (state.timer && state.timer.rowId === row.dataset.id && (event.target.classList.contains('task-name') || event.target.classList.contains('task-parent') || event.target.classList.contains('interrupt-name'))) {
          state.timer.task = composedDailyNameFromRow(row);
          persistTimer();
          renderTimer();
        }
        markDailyDirty({ coalesce: true, key: dailyInputHistoryKey(row, event.target) });
      });
      taskList.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' || !(event.target.classList.contains('today-value') || event.target.classList.contains('interrupt-name'))) return;
        event.preventDefault();
        event.target.blur();
      });
      taskList.addEventListener('click', function(event) {
        const revertButton = event.target.closest('.calendar-revert');
        if (revertButton) {
          event.stopPropagation();
          revertInterruptRowToCalendar(revertButton.closest('.work-card'));
          return;
        }
        const stepButton = event.target.closest('.today-step');
        if (stepButton) {
          const field = stepButton.parentElement && stepButton.parentElement.querySelector('.today-value');
          if (!field || stepButton.disabled) return;
          const next = steppedHours(numericHours(field.value), Number(stepButton.dataset.step));
          field.value = hours(next);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
        const row = event.target.closest('.work-card');
        if (!row) return;
        // スマホでは、丸（完了）以外のどこを押しても編集シートを開く。
        if (event.target.closest('.daily-plan-link')) {
          openDailyPlanEditor(row);
          return;
        }
        if (isCompactLayout() && !event.target.closest('.done-check')) {
          openDailyRowSheet(row);
          return;
        }
        if (event.target.closest('.done-check')) {
          const turningOff = dailyRowComplete(row);
          setDailyRowComplete(row, !turningOff);
          if (turningOff && completionSyncEnabled()) releaseParentPlanCompletion(row.dataset.planId || '', parentNameForDaily(composedDailyNameFromRow(row), row.dataset.planId || ''));
          markDailyDirty();
          return;
        }
        if (event.target.closest('.remove')) {
          if (state.timer && state.timer.rowId === row.dataset.id) finishTimer(false);
          row.remove();
          bindDailyDraggables(activeDailyTaskList());
          markDailyDirty();
          const activeList = activeDailyTaskList();
          if (activeList && !activeList.querySelector('.work-card')) activeList.innerHTML = dailyEmptyState();
        } else if (event.target.closest('.timer')) startTimer(row.dataset.id);
      });
    }

    // スマホの行の編集シート。行は読むだけにして、ここで時間・計測・削除を操作する。
    // 操作は行の中の既存の入力欄・ボタンへそのまま渡すので、保存や編集履歴の仕組みは変わらない。
    let dailySheetRowId = '';
    function dailySheetRow() {
      return dailySheetRowId ? document.querySelector('#taskList .work-card[data-id="' + CSS.escape(dailySheetRowId) + '"]') : null;
    }
    function openDailyRowSheet(row) {
      dailySheetRowId = row.dataset.id || '';
      renderDailyRowSheet();
      document.getElementById('dailyRowSheet').hidden = false;
      document.getElementById('dailyRowSheetBackdrop').hidden = false;
    }
    function closeDailyRowSheet() {
      dailySheetRowId = '';
      document.getElementById('dailyRowSheet').hidden = true;
      document.getElementById('dailyRowSheetBackdrop').hidden = true;
    }
    function renderDailyRowSheet() {
      const row = dailySheetRow();
      const sheet = document.getElementById('dailyRowSheet');
      if (!row) { closeDailyRowSheet(); return; }
      const title = row.querySelector('.task-issue-text strong');
      const parent = row.querySelector('.task-issue-text small');
      const nameField = row.querySelector('.interrupt-name');
      const hoursField = row.querySelector('.today-value');
      const remaining = row.querySelector('.daily-remaining');
      const running = !!(state.timer && state.timer.rowId === row.dataset.id);
      sheet.innerHTML = '<div class="daily-sheet-handle" aria-hidden="true"></div>' +
        (nameField
          ? '<label class="daily-sheet-name"><span>作業名</span><input class="field" data-sheet-name maxlength="200" value="' + escapeHtml(nameField.value) + '" autocomplete="off"></label>'
          : '<div class="daily-sheet-title"><strong>' + escapeHtml(title ? title.textContent : '') + '</strong>' + (parent ? '<small>' + escapeHtml(parent.textContent) + '</small>' : '') + '</div>') +
        '<div class="daily-sheet-hours" role="group" aria-label="本日実績">' +
          '<md-icon-button data-sheet-step="-0.25" aria-label="' + hoursStepUnit() + '時間減らす"><span class="material-symbols-outlined">remove</span></md-icon-button>' +
          '<label><input class="daily-sheet-hours-input" data-sheet-hours type="number" inputmode="decimal" min="0" step="0.25" value="' + escapeHtml(hoursField ? hoursField.value : '0') + '" aria-label="本日実績（時間）"><span>時間</span></label>' +
          '<md-icon-button data-sheet-step="0.25" aria-label="' + hoursStepUnit() + '時間増やす"><span class="material-symbols-outlined">add</span></md-icon-button>' +
        '</div>' +
        '<p class="daily-remaining' + (remaining && remaining.classList.contains('is-over') ? ' is-over' : '') + '" data-sheet-remaining' + (!remaining || remaining.hidden ? ' hidden' : '') + ' title="' + escapeHtml(remaining ? remaining.title : '') + '">' + escapeHtml(remaining ? remaining.textContent : '') + '</p>' +
        '<div class="daily-sheet-actions">' +
          '<md-filled-tonal-button data-sheet-timer type="button"><span class="material-symbols-outlined" slot="icon" aria-hidden="true">' + (running ? 'check' : 'play_arrow') + '</span>' + (running ? '計測を止めて記録' : '計測を開始') + '</md-filled-tonal-button>' +
          '<md-text-button class="danger-button" data-sheet-remove type="button">削除</md-text-button>' +
          '<md-text-button data-sheet-close type="button">閉じる</md-text-button>' +
        '</div>';
    }
    // 行の入力欄へ値を入れ、行で入力したときと同じ input / change を起こす。
    function setDailyRowField(field, value, commit) {
      if (!field) return;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      if (commit) field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function wireDailyRowSheet() {
      const sheet = document.getElementById('dailyRowSheet');
      document.getElementById('dailyRowSheetBackdrop').addEventListener('click', closeDailyRowSheet);
      sheet.addEventListener('click', function(event) {
        const row = dailySheetRow();
        if (!row) { closeDailyRowSheet(); return; }
        const step = event.target.closest('[data-sheet-step]');
        if (step) {
          const input = sheet.querySelector('[data-sheet-hours]');
          const next = steppedHours(numericHours(input.value), Number(step.dataset.sheetStep));
          input.value = hours(next);
          setDailyRowField(row.querySelector('.today-value'), hours(next), true);
          return;
        }
        if (event.target.closest('[data-sheet-timer]')) {
          if (state.timer && state.timer.rowId === row.dataset.id) finishTimer(true);
          else startTimer(row.dataset.id);
          closeDailyRowSheet();
          return;
        }
        if (event.target.closest('[data-sheet-remove]')) {
          const remove = row.querySelector('.remove');
          closeDailyRowSheet();
          if (remove) remove.click();
          return;
        }
        if (event.target.closest('[data-sheet-close]')) closeDailyRowSheet();
      });
      sheet.addEventListener('input', function(event) {
        const row = dailySheetRow();
        if (!row) return;
        if (event.target.matches('[data-sheet-hours]')) setDailyRowField(row.querySelector('.today-value'), event.target.value, false);
        if (event.target.matches('[data-sheet-name]')) setDailyRowField(row.querySelector('.interrupt-name'), event.target.value, false);
      });
      sheet.addEventListener('change', function(event) {
        const row = dailySheetRow();
        if (!row) return;
        if (event.target.matches('[data-sheet-hours]')) {
          event.target.value = hours(numericHours(event.target.value));
          setDailyRowField(row.querySelector('.today-value'), event.target.value, true);
        }
        if (event.target.matches('[data-sheet-name]')) setDailyRowField(row.querySelector('.interrupt-name'), event.target.value, true);
      });
      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && dailySheetRowId) closeDailyRowSheet();
      });
    }
