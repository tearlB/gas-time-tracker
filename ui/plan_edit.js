
    // 予定の期間のドラッグ変更と、月の画面での予定の編集。
    // 週・月どちらも変更はすぐ保存し、保存の状態はヘッダーの雲アイコン（自動保存の表示）に出す。
    const monthPlanEdit = { rowId: '', timer: 0, dirty: false, invalid: '' };
    const MONTH_PLAN_AUTOSAVE_DELAY_MS = 800;

    // ---------- サーバーへの保存（月の編集・どちらのタブのドラッグでも使う） ----------
    function planFieldsToRowFields(fields) {
      const result = {};
      if (Object.prototype.hasOwnProperty.call(fields, 'startDate')) {
        result.startDate = fields.startDate;
        result.endDate = fields.endDate;
        result.undated = !fields.startDate;
      }
      if (Object.prototype.hasOwnProperty.call(fields, 'plannedHours')) result.plannedHours = fields.plannedHours;
      if (Object.prototype.hasOwnProperty.call(fields, 'note')) result.note = fields.note;
      if (Object.prototype.hasOwnProperty.call(fields, 'projectId')) result.projectId = fields.projectId;
      if (Object.prototype.hasOwnProperty.call(fields, 'done')) { result.done = fields.done; result.completionOverride = fields.done; }
      return result;
    }
    // 保存の返事を待たずに、月の画面の予定へ先に反映する（失敗したときは読み直して戻す）。
    function patchMonthRowsForPlan(planId, rowFields) {
      const data = state.month.data;
      if (!data || !Array.isArray(data.rows)) return;
      data.rows.forEach(function(row) {
        if (row && row.planId === planId) Object.assign(row, rowFields);
      });
    }
    async function updatePlanOnServer(item, fields, options) {
      options = options || {};
      const monthKey = options.monthKey || state.month.key || '';
      patchMonthRowsForPlan(item.id, planFieldsToRowFields(fields));
      if (state.view === 'month') renderMonthGantt();
      state.month.saving = true;
      state.month.savingAuto = true;
      updateSaveDock();
      try {
        await gas('updatePlanFields', { planId: item.id, originWeek: item.originWeek || '', monthKey: monthKey, fields: fields });
        invalidateProjectSnapshots();
        state.month.cache = {};
        return true;
      } catch (error) {
        toast('予定を保存できませんでした: ' + ((error && error.message) || error), 'error');
        return false;
      } finally {
        state.month.saving = false;
        state.month.savingAuto = false;
        updateSaveDock();
        // 保存の成否にかかわらず、サーバーの内容で描き直す。
        if (state.view === 'month') loadMonthGantt();
        else if (state.view === 'planning' && options.reloadPlanner) loadPlanner({ force: true, silent: true });
      }
    }

    // ---------- 月の画面の予定の編集（ダイアログ・自動保存） ----------
    function monthPlanRow(planId) {
      return (state.month.rows || []).find(function(row) { return row.id === planId; }) || null;
    }
    function monthPlanStatusText(text, isError) {
      const status = document.getElementById('monthPlanStatus');
      if (!status) return;
      status.textContent = text;
      status.classList.toggle('is-error', !!isError);
    }
    function monthPlanProjectOptions(currentId) {
      const current = String(currentId || '');
      const options = [{ value: '', label: '未設定' }];
      (Array.isArray(state.projects) ? state.projects : []).forEach(function(project) {
        if (project && project.id && (project.status !== 'archived' || project.id === current)) options.push({ value: project.id, label: project.name || project.id });
      });
      return options;
    }
    function openMonthPlanEditor(planId) {
      const row = monthPlanRow(planId);
      const dialog = document.getElementById('monthPlanDialog');
      if (!row || !dialog) return;
      const item = row.item;
      monthPlanEdit.rowId = planId;
      monthPlanEdit.dirty = false;
      monthPlanEdit.invalid = '';
      clearTimeout(monthPlanEdit.timer);
      document.getElementById('monthPlanName').textContent = item.name || '名称未入力';
      const link = document.getElementById('monthPlanIssueLink');
      const issue = planBacklogIssue(item.name, item.issueUrl);
      link.hidden = !issue;
      if (issue) { link.href = issue.url; link.querySelector('.plan-issue-link-key').textContent = issue.key; } else link.removeAttribute('href');
      const period = row.range;
      document.getElementById('monthPlanStart').value = period && !item.undated ? period.start : '';
      document.getElementById('monthPlanEnd').value = period && !item.undated ? period.end : '';
      document.getElementById('monthPlanPlanned').value = hours(item.planned);
      fillSelect(document.getElementById('monthPlanProject'), monthPlanProjectOptions(item.projectId), item.projectId || '');
      document.getElementById('monthPlanNote').value = item.note || '';
      setSwitchOn(document.getElementById('monthPlanDone'), !!row.done);
      monthPlanStatusText('変更は自動で保存されます。');
      showAppDialog(dialog);
    }
    function collectMonthPlanFields(row) {
      const startDate = String(document.getElementById('monthPlanStart').value || '').trim();
      const endDate = String(document.getElementById('monthPlanEnd').value || '').trim();
      if (!!startDate !== !!endDate) return { error: '開始日と終了日は、どちらも入れるか、どちらも空にしてください' };
      if (startDate && endDate < startDate) return { error: '終了日は開始日以降にしてください' };
      const planned = Number(document.getElementById('monthPlanPlanned').value);
      if (!isFinite(planned) || planned < 0) return { error: '予定工数は0以上で入力してください' };
      return { fields: {
        startDate: startDate, endDate: endDate, plannedHours: roundHours(planned),
        note: String(document.getElementById('monthPlanNote').value || '').trim(),
        projectId: readOutlinedSelectValue(document.getElementById('monthPlanProject')) || '',
        done: switchIsOn(document.getElementById('monthPlanDone'))
      } };
    }
    // 変わった項目だけを送る。
    function monthPlanChangedFields(row, fields) {
      const item = row.item;
      const period = row.range;
      const changed = {};
      const currentStart = period && !item.undated ? period.start : '';
      const currentEnd = period && !item.undated ? period.end : '';
      if (fields.startDate !== currentStart || fields.endDate !== currentEnd) { changed.startDate = fields.startDate; changed.endDate = fields.endDate; }
      if (roundHours(fields.plannedHours) !== roundHours(item.planned)) changed.plannedHours = fields.plannedHours;
      if (fields.note !== String(item.note || '').trim()) changed.note = fields.note;
      if (fields.projectId !== String(item.projectId || '')) changed.projectId = fields.projectId;
      if (fields.done !== !!row.done) changed.done = fields.done;
      return changed;
    }
    function scheduleMonthPlanSave() {
      clearTimeout(monthPlanEdit.timer);
      const row = monthPlanRow(monthPlanEdit.rowId);
      if (!row) return;
      const collected = collectMonthPlanFields(row);
      if (collected.error) {
        monthPlanEdit.invalid = collected.error;
        monthPlanEdit.dirty = false;
        monthPlanStatusText(collected.error, true);
        updateSaveDock();
        return;
      }
      monthPlanEdit.invalid = '';
      monthPlanEdit.dirty = Object.keys(monthPlanChangedFields(row, collected.fields)).length > 0;
      monthPlanStatusText(monthPlanEdit.dirty ? '変更時に自動保存' : '変更は自動で保存されます。');
      updateSaveDock();
      if (monthPlanEdit.dirty) monthPlanEdit.timer = setTimeout(saveMonthPlanEdits, MONTH_PLAN_AUTOSAVE_DELAY_MS);
    }
    async function saveMonthPlanEdits() {
      clearTimeout(monthPlanEdit.timer);
      monthPlanEdit.timer = 0;
      const row = monthPlanRow(monthPlanEdit.rowId);
      if (!row || state.month.saving) { if (row && monthPlanEdit.dirty) monthPlanEdit.timer = setTimeout(saveMonthPlanEdits, MONTH_PLAN_AUTOSAVE_DELAY_MS); return; }
      const collected = collectMonthPlanFields(row);
      if (collected.error) return;
      const changed = monthPlanChangedFields(row, collected.fields);
      if (!Object.keys(changed).length) { monthPlanEdit.dirty = false; updateSaveDock(); return; }
      const item = row.item;
      monthPlanStatusText('自動保存中…');
      const ok = await updatePlanOnServer(item, changed);
      monthPlanEdit.dirty = false;
      monthPlanStatusText(ok ? '自動保存済み' : '保存できませんでした。もう一度変更してください', !ok);
      updateSaveDock();
    }
    function closeMonthPlanEditor() {
      if (monthPlanEdit.timer) saveMonthPlanEdits();
      hideAppDialog(document.getElementById('monthPlanDialog'));
      monthPlanEdit.rowId = '';
    }
    function wireMonthPlanEditor() {
      const dialog = document.getElementById('monthPlanDialog');
      if (!dialog) return;
      ['monthPlanStart', 'monthPlanEnd', 'monthPlanPlanned', 'monthPlanNote'].forEach(function(id) {
        const field = document.getElementById(id);
        field.addEventListener('input', scheduleMonthPlanSave);
        field.addEventListener('change', scheduleMonthPlanSave);
      });
      document.getElementById('monthPlanProject').addEventListener('change', scheduleMonthPlanSave);
      document.getElementById('monthPlanDone').addEventListener('change', scheduleMonthPlanSave);
      document.getElementById('clearMonthPlanPeriod').addEventListener('click', function() {
        document.getElementById('monthPlanStart').value = '';
        document.getElementById('monthPlanEnd').value = '';
        scheduleMonthPlanSave();
      });
      document.getElementById('closeMonthPlan').addEventListener('click', closeMonthPlanEditor);
      document.getElementById('closeMonthPlanDone').addEventListener('click', closeMonthPlanEditor);
      document.getElementById('openMonthPlanWeek').addEventListener('click', function() {
        const planId = monthPlanEdit.rowId;
        closeMonthPlanEditor();
        if (planId) openWeekForMonthPlan(planId, '');
      });
      dialog.addEventListener('closed', function() { if (monthPlanEdit.timer) saveMonthPlanEdits(); });
    }

    // ---------- 一覧の備考をその場で編集する（週・月の予定の名前の欄） ----------
    const PLAN_NOTE_MAX_LENGTH = 2000;
    const inlinePlanNote = { planId: '', input: null, close: null, closedPlanId: '', closedAt: 0 };
    function inlinePlanNoteSource(planId) {
      if (state.view === 'month') {
        const row = monthPlanRow(planId);
        return row ? { item: row.item, local: false } : null;
      }
      const local = plannerItems().find(function(entry) { return entry && entry.id === planId; });
      if (local) return { item: local, local: true };
      const summary = state.planner.summary && plannerItemsFromSummaryRows(state.planner.summary.rows).find(function(entry) { return entry.id === planId; });
      return summary ? { item: summary, local: false } : null;
    }
    // 備考のアイコンを押すと、その横に小さな入力パネルを開く（行の高さは変えない）。
    function startInlinePlanNoteEdit(anchor) {
      const planId = anchor.dataset.planNoteId;
      const source = inlinePlanNoteSource(planId);
      if (!source || inlinePlanNote.input) return;
      const pop = document.createElement('div');
      pop.className = 'plan-note-pop';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', '備考');
      // 他の備考欄と同じ、Material の複数行の入力欄。
      const input = document.createElement('md-outlined-text-field');
      input.className = 'field plan-note-input';
      input.setAttribute('type', 'textarea');
      input.setAttribute('rows', '4');
      input.setAttribute('maxlength', String(PLAN_NOTE_MAX_LENGTH));
      input.setAttribute('label', '備考');
      input.setAttribute('placeholder', 'Ctrl+Enterで確定、Escで取り消し');
      input.setAttribute('aria-label', '備考');
      input.value = String(source.item.note || '');
      const links = document.createElement('div');
      links.className = 'plan-note-pop-links';
      const showLinks = function() {
        links.innerHTML = planNoteLinks(input.value, 3).map(function(url) {
          return '<a class="plan-note-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" title="' + escapeHtml(url) + '"><span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>' + escapeHtml(url.replace(/^https?:\/\//, '')) + '</a>';
        }).join('');
        links.hidden = !links.innerHTML;
      };
      pop.appendChild(input);
      pop.appendChild(links);
      let finished = false;
      const onScroll = function(event) { if (!pop.contains(event.target)) finish(true); };
      // パネルの外を押したら確定して閉じる。週の帯などはドラッグのために押下の既定動作を止めていて
      // フォーカスが外れない（focusout が来ない）ので、押下そのものを見て閉じる。
      const onOutsidePointer = function(event) {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (path.indexOf(pop) >= 0 || pop.contains(event.target)) return;
        finish(true);
      };
      const finish = function(commit) {
        if (finished) return;
        finished = true;
        window.removeEventListener('scroll', onScroll, true);
        document.removeEventListener('pointerdown', onOutsidePointer, true);
        inlinePlanNote.planId = '';
        inlinePlanNote.input = null;
        inlinePlanNote.close = null;
        // アイコンを押すと先にフォーカスが外れて閉じる。直後のクリックで開き直さないよう、閉じた予定と時刻を覚える。
        inlinePlanNote.closedPlanId = planId;
        inlinePlanNote.closedAt = Date.now();
        const value = input.value.trim();
        pop.remove();
        if (commit && value !== String(source.item.note || '').trim()) commitInlinePlanNote(planId, value);
        if (anchor.isConnected) anchor.focus({ preventScroll: true });
      };
      input.addEventListener('keydown', function(event) {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(true); }
      });
      input.addEventListener('input', showLinks);
      // パネルの中（リンクなど）へ移るだけなら閉じない。外へ出たら確定する。
      pop.addEventListener('focusout', function(event) {
        if (event.relatedTarget && pop.contains(event.relatedTarget)) return;
        finish(true);
      });
      inlinePlanNote.planId = planId;
      inlinePlanNote.input = input;
      inlinePlanNote.close = finish;
      document.body.appendChild(pop);
      showLinks();
      const rect = anchor.getBoundingClientRect();
      const width = pop.offsetWidth;
      pop.style.left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) + 'px';
      const below = rect.bottom + 4;
      pop.style.top = (below + pop.offsetHeight > window.innerHeight - 8 ? Math.max(8, rect.top - 4 - pop.offsetHeight) : below) + 'px';
      input.focus({ preventScroll: true });
      document.addEventListener('pointerdown', onOutsidePointer, true);
      // 開いた直後のスクロール（フォーカスや再描画によるもの）では閉じない。
      setTimeout(function() { if (!finished) window.addEventListener('scroll', onScroll, true); }, 300);
      if (typeof input.setSelectionRange === 'function') { try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {} }
    }
    function rerenderPlanLists() {
      if (state.view === 'month') renderMonthGantt();
      else renderWeekCalendar();
    }
    function commitInlinePlanNote(planId, note) {
      const source = inlinePlanNoteSource(planId);
      if (!source) return;
      if (source.local) {
        source.item.note = note;
        markPlannerChanged();
        updatePlannerSummary();
        rerenderPlanLists();
        return;
      }
      const week = state.view !== 'month';
      const monthKey = week ? String(weekKeyStartYmd(state.planner.key) || '').slice(0, 7) : state.month.key;
      updatePlanOnServer(source.item, { note: note }, { monthKey: monthKey, reloadPlanner: week });
    }
    function wireInlinePlanNote() {
      ['weekCalendar', 'monthGantt'].forEach(function(id) {
        const container = document.getElementById(id);
        if (!container) return;
        // 予定の行を開く処理より先に受けて、備考だけの操作として扱う。
        container.addEventListener('click', function(event) {
          const icon = event.target.closest('.plan-note-icon[data-plan-note-id]');
          if (!icon) return;
          event.preventDefault();
          event.stopPropagation();
          // 開いているときにもう一度押したら閉じる（押した時点で閉じていたら、開き直さない）。
          if (inlinePlanNote.close) { inlinePlanNote.close(true); return; }
          if (inlinePlanNote.closedPlanId === icon.dataset.planNoteId && Date.now() - inlinePlanNote.closedAt < 500) {
            inlinePlanNote.closedPlanId = '';
            return;
          }
          startInlinePlanNoteEdit(icon);
        }, true);
        // Enter・スペースは、ボタンの押下として扱われる。行を開く処理（月の名前の欄）へは渡さない。
        container.addEventListener('keydown', function(event) {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          if (event.target.closest && event.target.closest('.plan-note-icon')) event.stopPropagation();
        }, true);
      });
    }

    // ---------- キーボード操作（← → で前後の期間、↑ ↓ で予定の行、Enter で編集） ----------
    // 入力中・ダイアログやメニューを開いている間は動かさない。設定でショートカットを切っているときも動かさない。
    function planKeyboardBlocked(event) {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return true;
      if (state.uiPreferences && state.uiPreferences.shortcutsEnabled === false) return true;
      if (event.target.closest && event.target.closest('input, textarea, select, [contenteditable="true"], md-outlined-text-field, md-outlined-select, md-menu, .shortcut-key, .plan-note-pop')) return true;
      if (document.querySelector('md-dialog[open], dialog[open]')) return true;
      const status = document.getElementById('planStatusMenu');
      const context = document.getElementById('planContextMenu');
      return !!((status && status.open) || (context && context.open));
    }
    // 上下で行き来できる予定の行（週は今週の予定の名前の欄、月は予定の名前の欄）。
    function planRowNameElements() {
      const selector = state.view === 'month' ? '#monthGantt .month-name[data-month-plan-id]'
        : state.view === 'planning' ? '#weekCalendar .span-row[data-plan-id]:not(.span-context-row):not(.span-subtask-lane) > .span-name[data-plan-id]' : '';
      return selector ? Array.from(document.querySelectorAll(selector)).filter(function(element) { return element.offsetParent !== null; }) : [];
    }
    function focusPlanRowName(planId) {
      if (!planId) return;
      const selector = state.view === 'month' ? '#monthGantt .month-name[data-month-plan-id="' : '#weekCalendar .span-name[data-plan-id="';
      const element = document.querySelector(selector + String(planId).replace(/"/g, '\\"') + '"]');
      if (element) element.focus({ preventScroll: true });
    }
    function wirePlanKeyboard() {
      document.addEventListener('keydown', function(event) {
        if (planKeyboardBlocked(event)) return;
        const key = event.key;
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
          if (['daily', 'planning', 'month', 'projects'].indexOf(state.view) < 0) return;
          event.preventDefault();
          shiftCalendarPeriod(key === 'ArrowLeft' ? -1 : 1);
          return;
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          // 行にフォーカスがあるときだけ動かす（それ以外は、これまでどおり画面をスクロールする）。
          const current = event.target.closest && event.target.closest('.span-name[data-plan-id], .month-name[data-month-plan-id]');
          const names = planRowNameElements();
          const index = names.indexOf(current);
          if (index < 0) return;
          const next = names[index + (key === 'ArrowUp' ? -1 : 1)];
          event.preventDefault();
          if (next) next.focus();
          return;
        }
        if (key === 'Enter' || key === ' ') {
          const name = key === 'Enter' && event.target.closest && event.target.closest('#weekCalendar .span-name[data-plan-id]');
          if (name && event.target === name) { event.preventDefault(); openPlanDialog({ id: name.dataset.planId }); return; }
          // Tab で選んだ期間の帯・実績のチップは、Enter・スペースで押したことにする。
          const target = event.target.closest && event.target.closest('#weekCalendar .timeline-period[data-plan-id], #weekCalendar .span-actual, #monthGantt .timeline-period[data-plan-id]');
          if (target && event.target === target) { event.preventDefault(); target.click(); }
        }
      });
    }

    // ---------- 期間のドラッグ変更（週・月のタイムラインの帯） ----------
    // 帯の中をつかむと期間ごと動かし、左右の端をつかむと開始日・終了日を変える。端までドラッグすると自動でスクロールする。
    // 動かさずに離したときは、これまでどおり押した扱いにする（予定を開く）。
    const periodDrag = { pending: null, active: null, frame: 0, lastEvent: null };
    const PERIOD_DRAG_THRESHOLD_PX = 4;
    const PERIOD_DRAG_EDGE_PX = 8;
    const PERIOD_DRAG_SCROLL_ZONE_PX = 56;
    const PERIOD_DRAG_SCROLL_MAX_PX = 22;

    function periodDragModeOf(container) {
      return container && container.id === 'weekCalendar' ? 'week' : container && container.id === 'monthGantt' ? 'month' : '';
    }
    function periodDragHeaders(container) {
      const elements = calendarTimelineElements(periodDragModeOf(container));
      return elements ? { elements: elements, cells: Array.from(container.querySelectorAll(elements.header)) } : null;
    }
    function periodDragDateAtX(container, clientX) {
      const headers = periodDragHeaders(container);
      if (!headers || !headers.cells.length) return '';
      const attr = headers.elements.dateAttribute;
      const first = headers.cells[0].getBoundingClientRect();
      const last = headers.cells[headers.cells.length - 1].getBoundingClientRect();
      if (clientX <= first.left) return headers.cells[0].getAttribute(attr);
      if (clientX >= last.right) return headers.cells[headers.cells.length - 1].getAttribute(attr);
      const cell = headers.cells.find(function(entry) { const rect = entry.getBoundingClientRect(); return clientX >= rect.left && clientX < rect.right; });
      return cell ? cell.getAttribute(attr) : '';
    }
    function periodDragBarAt(container, event) {
      const bars = container.querySelectorAll('.timeline-period[data-plan-id]');
      for (let i = 0; i < bars.length; i++) {
        const rect = bars[i].getBoundingClientRect();
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return bars[i];
      }
      return null;
    }
    function periodDragZone(bar, clientX) {
      const rect = bar.getBoundingClientRect();
      const edge = Math.min(PERIOD_DRAG_EDGE_PX, rect.width / 3);
      if (!bar.classList.contains('continues-before') && clientX - rect.left <= edge) return 'start';
      if (!bar.classList.contains('continues-after') && rect.right - clientX <= edge) return 'end';
      return 'move';
    }
    function periodDragDaysBetween(from, to) {
      return Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86400000);
    }
    // つかんだ位置と動かし方から、新しい期間を求める。
    function periodDragNextRange(drag, pointerDate) {
      if (!pointerDate) return { start: drag.start, end: drag.end };
      if (drag.zone === 'move') {
        const delta = periodDragDaysBetween(drag.grabDate, pointerDate);
        return { start: addDaysYmd(drag.start, delta), end: addDaysYmd(drag.end, delta) };
      }
      if (drag.zone === 'start') return { start: pointerDate > drag.end ? drag.end : pointerDate, end: drag.end };
      return { start: drag.start, end: pointerDate < drag.start ? drag.start : pointerDate };
    }
    function periodDragRangeText(range) {
      return range.start === range.end ? shortYmdLabel(range.start) : shortYmdLabel(range.start) + '〜' + shortYmdLabel(range.end);
    }
    function periodDragShowHint(text, event) {
      let hint = document.getElementById('periodDragHint');
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'periodDragHint';
        hint.className = 'month-open-hint period-drag-hint';
        hint.setAttribute('role', 'status');
        document.body.appendChild(hint);
      }
      hint.textContent = text;
      hint.hidden = false;
      hint.style.left = Math.max(8, Math.min(window.innerWidth - hint.offsetWidth - 8, event.clientX + 14)) + 'px';
      hint.style.top = (event.clientY + 18) + 'px';
    }
    // 帯を動かしている間の見た目。表示している日の範囲に収めて、その場で帯を伸び縮みさせる。
    function periodDragPreview(drag, range) {
      const headers = periodDragHeaders(drag.container);
      if (!headers) return;
      const attr = headers.elements.dateAttribute;
      const dates = headers.cells.map(function(cell) { return cell.getAttribute(attr); });
      if (!dates.length) return;
      let first = dates.findIndex(function(date) { return date >= range.start; });
      let last = dates.length - 1;
      for (let i = dates.length - 1; i >= 0; i--) { if (dates[i] <= range.end) { last = i; break; } }
      if (first < 0 || last < first) { drag.bar.style.visibility = 'hidden'; return; }
      drag.bar.style.visibility = '';
      drag.bar.style.gridColumn = (first + 2) + ' / ' + (last + 3);
    }
    function periodDragApply(event) {
      const drag = periodDrag.active;
      if (!drag) return;
      const date = periodDragDateAtX(drag.container, event.clientX);
      drag.range = periodDragNextRange(drag, date);
      periodDragPreview(drag, drag.range);
      periodDragShowHint(periodDragRangeText(drag.range), event);
    }
    // つかんだまま端に近づいたら、近さに応じた速さで横にスクロールする。
    function periodDragAutoScroll() {
      const drag = periodDrag.active;
      if (!drag) return;
      const event = periodDrag.lastEvent;
      const rect = drag.container.getBoundingClientRect();
      const label = drag.container.querySelector(periodDragHeaders(drag.container).elements.label);
      const left = rect.left + (label ? label.getBoundingClientRect().width : 0);
      let speed = 0;
      if (event.clientX < left + PERIOD_DRAG_SCROLL_ZONE_PX) speed = -Math.min(1, (left + PERIOD_DRAG_SCROLL_ZONE_PX - event.clientX) / PERIOD_DRAG_SCROLL_ZONE_PX) * PERIOD_DRAG_SCROLL_MAX_PX;
      else if (event.clientX > rect.right - PERIOD_DRAG_SCROLL_ZONE_PX) speed = Math.min(1, (event.clientX - (rect.right - PERIOD_DRAG_SCROLL_ZONE_PX)) / PERIOD_DRAG_SCROLL_ZONE_PX) * PERIOD_DRAG_SCROLL_MAX_PX;
      if (speed) {
        const before = drag.container.scrollLeft;
        drag.container.scrollLeft = before + speed;
        if (drag.container.scrollLeft !== before) periodDragApply(event);
      }
      periodDrag.frame = requestAnimationFrame(periodDragAutoScroll);
    }
    function periodDragBegin(event) {
      const pending = periodDrag.pending;
      periodDrag.pending = null;
      periodDrag.active = pending;
      pending.bar.classList.add('is-dragging-period');
      pending.container.classList.add('is-period-dragging');
      // 横のスクロールの吸い付き（scroll snap）は、自動スクロールの邪魔になるので、ドラッグの間だけ止める。
      pending.snap = pending.container.style.scrollSnapType;
      pending.container.style.scrollSnapType = 'none';
      document.body.classList.add('is-period-dragging');
      if (typeof clearMonthOpenHint === 'function') clearMonthOpenHint();
      periodDrag.lastEvent = event;
      periodDragApply(event);
      periodDrag.frame = requestAnimationFrame(periodDragAutoScroll);
    }
    function periodDragEnd(commit) {
      const drag = periodDrag.active;
      periodDrag.pending = null;
      periodDrag.active = null;
      cancelAnimationFrame(periodDrag.frame);
      const hint = document.getElementById('periodDragHint');
      if (hint) hint.hidden = true;
      document.body.classList.remove('is-period-dragging');
      if (!drag) return;
      drag.container.classList.remove('is-period-dragging');
      drag.container.style.scrollSnapType = drag.snap || '';
      drag.bar.classList.remove('is-dragging-period');
      drag.bar.style.gridColumn = drag.originalColumn;
      drag.bar.style.visibility = '';
      // 離したときのクリックは、予定を開く操作ではないので打ち消す。
      const swallow = function(event) { event.stopPropagation(); event.preventDefault(); };
      document.addEventListener('click', swallow, true);
      setTimeout(function() { document.removeEventListener('click', swallow, true); }, 0);
      const range = drag.range;
      if (!commit || !range || (range.start === drag.start && range.end === drag.end)) return;
      commitPeriodDrag(drag, range);
    }
    // 週の画面で今開いている予定は、予定の編集と同じ保存（自動保存）にそろえる。ほかの週や月の予定はサーバーへ直接保存する。
    function commitPeriodDrag(drag, range) {
      const planned = drag.mode === 'week' ? plannerItems().find(function(entry) { return entry.id === drag.planId; }) : null;
      if (planned) {
        planned.startDate = range.start;
        planned.endDate = range.end;
        planned.undated = false;
        markPlannerChanged();
        updatePlannerSummary();
        toast('期間を ' + periodDragRangeText(range) + ' に変えました', 'success');
        return;
      }
      const item = drag.mode === 'month'
        ? (monthPlanRow(drag.planId) || {}).item
        : (state.planner.summary && plannerItemsFromSummaryRows(state.planner.summary.rows).find(function(entry) { return entry.id === drag.planId; }));
      const target = item || { id: drag.planId, originWeek: drag.originWeek };
      if (!target.originWeek && drag.originWeek) target.originWeek = drag.originWeek;
      const monthKey = drag.mode === 'month' ? state.month.key : String(weekKeyStartYmd(state.planner.key) || '').slice(0, 7);
      updatePlanOnServer(target, { startDate: range.start, endDate: range.end }, { monthKey: monthKey, reloadPlanner: drag.mode === 'week' }).then(function(ok) {
        if (ok) toast('期間を ' + periodDragRangeText(range) + ' に変えました', 'success');
      });
    }
    function periodDragCursorFor(container, event) {
      if (periodDrag.active) return;
      const bar = periodDragBarAt(container, event);
      if (!bar) { container.style.cursor = ''; return; }
      const zone = periodDragZone(bar, event.clientX);
      container.style.cursor = zone === 'move' ? 'grab' : 'ew-resize';
    }
    function wirePeriodDrag() {
      ['weekCalendar', 'monthGantt'].forEach(function(id) {
        const container = document.getElementById(id);
        if (!container) return;
        container.addEventListener('pointerdown', function(event) {
          if (event.button !== 0 || event.pointerType === 'touch' || isCompactLayout()) return;
          if (event.target.closest('a, button, input, select, textarea, md-icon-button, md-checkbox, .span-priority-handle')) return;
          const bar = periodDragBarAt(container, event);
          if (!bar) return;
          const grabDate = periodDragDateAtX(container, event.clientX);
          if (!grabDate) return;
          periodDrag.pending = {
            container: container, bar: bar, mode: periodDragModeOf(container), planId: bar.dataset.planId, originWeek: bar.dataset.originWeek || '',
            start: bar.dataset.start, end: bar.dataset.end, grabDate: grabDate, zone: periodDragZone(bar, event.clientX),
            startX: event.clientX, startY: event.clientY, originalColumn: bar.style.gridColumn, range: null
          };
        });
        container.addEventListener('pointermove', function(event) { periodDragCursorFor(container, event); });
      });
      window.addEventListener('pointermove', function(event) {
        if (periodDrag.pending && !periodDrag.active) {
          const pending = periodDrag.pending;
          if (Math.abs(event.clientX - pending.startX) + Math.abs(event.clientY - pending.startY) < PERIOD_DRAG_THRESHOLD_PX) return;
          periodDragBegin(event);
          return;
        }
        if (periodDrag.active) {
          event.preventDefault();
          periodDrag.lastEvent = event;
          periodDragApply(event);
        }
      });
      window.addEventListener('pointerup', function() { if (periodDrag.active) periodDragEnd(true); else periodDrag.pending = null; });
      window.addEventListener('pointercancel', function() { periodDragEnd(false); });
      window.addEventListener('keydown', function(event) { if (event.key === 'Escape' && periodDrag.active) { event.stopPropagation(); periodDragEnd(false); } }, true);
      document.addEventListener('selectstart', function(event) { if (periodDrag.active) event.preventDefault(); });
    }
