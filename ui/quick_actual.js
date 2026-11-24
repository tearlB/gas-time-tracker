
    // どの画面からでも開ける「今日の実績」パネル。日次画面の「今日」の行をそのまま使い、
    // 時間・完了・計測・削除・プロジェクト・課題の追加は日次画面と同じ処理（と保存）に渡す。
    // 行は日次画面の一覧（画面には出ていなくても作られている）が持ち、パネルはその見え方と入口だけを担う。
    const quickActual = { open: false, loading: false, blocked: false, detailId: '' };
    const QUICK_ACTUAL_DOCK_QUERY = '(min-width: 1100px)';
    // 広い画面では、画面の右端のサイドパネルとして開く（本体を左へ寄せるので、後ろの画面が隠れない）。
    // 狭い画面では、これまでどおり下から開くシートにする。
    function quickActualCanDock() {
      return typeof matchMedia !== 'function' || matchMedia(QUICK_ACTUAL_DOCK_QUERY).matches;
    }
    function applyQuickActualDock() {
      const panel = document.getElementById('quickActualPanel');
      if (!panel) return;
      const docked = quickActual.open && quickActualCanDock();
      panel.classList.toggle('is-docked', docked);
      document.body.classList.toggle('quick-docked', docked);
    }
    // 説明文は、標準の title ではなく data-hint に移してあるので、どちらからでも読む。
    function elementHintText(element) {
      return element ? (element.getAttribute('data-hint') || element.getAttribute('title') || '') : '';
    }
    function quickActualToday() { return ymd(new Date()); }
    function quickActualRowElements() {
      const list = activeDailyTaskList();
      return list ? Array.from(list.querySelectorAll('.work-card')) : [];
    }
    function quickActualRowElement(id) {
      return quickActualRowElements().find(function(el) { return el.dataset.id === id; }) || null;
    }
    // 日次の画面が今日以外を開いているときは、そちらの表示を変えないよう、パネルでは扱わない。
    function quickActualDailyIsOtherDate() {
      return state.view === 'daily' && state.daily.date !== quickActualToday();
    }
    async function ensureQuickActualToday() {
      const today = quickActualToday();
      quickActual.blocked = quickActualDailyIsOtherDate();
      if (quickActual.blocked) return;
      if (state.daily.date === today && state.daily.loadedDate === today) return;
      // ほかの日を編集中なら、切り替える前に保存する（切り替えると未保存の変更が失われる）。
      if (state.daily.dirty && state.daily.loadedDate && state.daily.loadedDate !== today) await saveDaily();
      if (state.daily.dirty && state.daily.loadedDate && state.daily.loadedDate !== today) { quickActual.blocked = true; return; }
      state.daily.date = today;
      await loadDaily({ silent: true });
    }
    // 日次の画面が隠れている間に作られた行は、プロジェクト一覧の読み込み前の選択肢のままのことがある。
    // 未保存の変更がなければ、最新の一覧で描き直してから見せる。
    function refreshQuickActualDailyRows() {
      if (state.daily.dirty || state.daily.loadedDate !== quickActualToday() || state.view === 'daily') return;
      renderDaily();
    }
    // 「15.00」は「15」、「—」はそのまま（一覧の細い欄に収める）。
    function compactNumberText(value) {
      const number = Number(value);
      return value !== '' && isFinite(number) ? compactHours(number) : value;
    }
    // 描き直した直後は、選択部品の value がまだ反映されていない。選択済みの項目と行の値からも読む。
    function quickActualChosenProject(el, select) {
      if (select.value) return String(select.value);
      const selected = select.querySelector('md-select-option[selected]');
      return String((selected && selected.getAttribute('value')) || el.dataset.projectId || '');
    }
    function quickActualRowData(el) {
      const done = dailyRowComplete(el);
      const hoursField = el.querySelector('.today-value');
      const text = function(selector) { const node = el.querySelector(selector); return node ? node.textContent.trim() : ''; };
      // プロジェクトは日次の行が持つ選択肢と値をそのまま使う（一覧の読み込み状況に左右されない）。
      const projectSelect = el.querySelector('.daily-project');
      const inherited = el.querySelector('.daily-project-inherited');
      const originText = text('.task-origin');
      const statusBadge = el.querySelector('.daily-status');
      const nameInput = el.querySelector('.interrupt-name');
      return {
        renamable: !!nameInput,
        rawName: nameInput ? nameInput.value : '',
        status: statusBadge ? statusBadge.textContent.trim() : '',
        previousText: compactNumberText(text('.previous-value')),
        estimateText: compactNumberText(text('.estimate-value')),
        remainingText: compactNumberText(text('.daily-remaining')),
        remainingTitle: elementHintText(el.querySelector('.daily-remaining')),
        statusClass: statusBadge ? statusBadge.className.replace(/\bdaily-status\b|\bweekly-status\b/g, '').trim() : '',
        statusTitle: elementHintText(statusBadge),
        id: el.dataset.id,
        name: composedDailyNameFromRow(el) || '（名前なし）',
        done: done,
        hours: hoursField ? hoursField.value : '0',
        interrupt: el.dataset.type === 'interrupt',
        origin: el.dataset.origin || '',
        originLabel: originText,
        meta: el.dataset.type === 'interrupt' ? '' : '前日まで ' + compactNumberText(text('.previous-value')) + ' · 予定 ' + compactNumberText(text('.estimate-value')) + ' · 残り ' + compactNumberText(text('.daily-remaining')) + 'h',
        over: !!(el.querySelector('.daily-remaining') && el.querySelector('.daily-remaining').classList.contains('is-over')),
        projectId: projectSelect ? quickActualChosenProject(el, projectSelect) : null,
        projectOptions: projectSelect ? Array.from(projectSelect.querySelectorAll('md-select-option')).map(function(option) {
          const headline = option.querySelector('[slot="headline"]');
          return { value: option.getAttribute('value') || '', label: headline ? headline.textContent : '' };
        }) : [],
        inheritedProject: inherited ? inherited.textContent.trim() : '',
        running: !!(state.timer && state.timer.rowId === el.dataset.id)
      };
    }
    function quickActualProjectHtml(row) {
      if (row.projectId == null) {
        return '<p class="qa-project-text is-wide">' + escapeHtml(row.inheritedProject || '未設定') + '<small>予定の割り当てに従います</small></p>';
      }
      return '<md-outlined-select class="field quick-project is-wide" quick label="プロジェクト" aria-label="プロジェクト" value="' + escapeHtml(row.projectId) + '">' + row.projectOptions.map(function(option) {
        return '<md-select-option value="' + escapeHtml(option.value) + '"' + (option.value === row.projectId ? ' selected' : '') + '><div slot="headline">' + escapeHtml(option.label) + '</div></md-select-option>';
      }).join('') + '</md-outlined-select>';
    }
    // 行の1行目は作業名。Backlog課題は課題キーを2行目に回し、1行目には課題名だけを出す（キーで幅を使い切って名前が切れないように）。
    // 長い名前は2行まで折り返し、全文はカーソルを乗せたときに出す。
    function quickActualTitleHtml(row) {
      const match = /^([A-Za-z][A-Za-z0-9_]*-\d+)\s+(\S[\s\S]*)$/.exec(String(row.name || '').trim());
      const name = match ? match[2] : row.name;
      const sub = quickActualSubHtml(row);
      return '<span class="qa-name" title="' + escapeHtml(row.name) + '">' + escapeHtml(name) + '</span>' +
        '<span class="qa-sub">' + (match ? '<span class="qa-key">' + escapeHtml(match[1]) + '</span>' + (sub ? ' · ' : '') : '') + sub + '</span>';
    }
    // 行の2行目: 区分と残り。
    function quickActualSubHtml(row) {
      const parts = [escapeHtml(row.originLabel)];
      if (row.remainingText && row.remainingText !== '—') parts.push('<span class="' + (row.over ? 'is-over' : '') + '">残り ' + escapeHtml(row.remainingText) + 'h</span>');
      return parts.filter(Boolean).join(' · ');
    }
    // 開いた行の中身: 作業名（変えられる行は入力欄、ほかは全文）、プロジェクト、予定（今日だけの作業）、前日までと予定と残り、並べ替え・削除。
    function quickActualMoreHtml(row, position) {
      const name = row.renamable
        ? '<md-outlined-text-field class="field quick-name-input is-wide" label="作業名" maxlength="200" value="' + escapeHtml(row.rawName) + '" autocomplete="off" aria-label="作業名"></md-outlined-text-field>'
        : '<p class="qa-fullname">' + escapeHtml(row.name) + '</p>';
      const facts = row.interrupt ? '' : '<p class="qa-facts-line">前日まで <b>' + escapeHtml(row.previousText) + '</b> · 予定 <b>' + escapeHtml(row.estimateText) + '</b> · 残り <b class="' + (row.over ? 'is-over' : '') + '">' + escapeHtml(row.remainingText) + '</b></p>';
      return '<div class="qa-more">' + name + quickActualProjectHtml(row) + facts +
        '<div class="qa-actions">' +
          '<md-text-button type="button" class="quick-up"' + (position.first ? ' disabled' : '') + '>上へ</md-text-button>' +
          '<md-text-button type="button" class="quick-down"' + (position.last ? ' disabled' : '') + '>下へ</md-text-button>' +
          '<md-text-button type="button" class="quick-remove danger-button">削除</md-text-button>' +
        '</div></div>';
    }
    function quickActualRowHtml(row, position) {
      const open = row.id === quickActual.detailId;
      const runLabel = row.running ? '計測を止めて記録' : '計測を開始';
      return '<li class="qa-row' + (row.done ? ' is-done' : '') + (open ? ' is-open' : '') + '" data-quick-id="' + escapeHtml(row.id) + '">' +
        '<div class="qa-main">' +
          '<md-checkbox class="quick-done" touch-target="wrapper" title="' + (row.done ? '完了を取り消す' : '完了にする') + '" aria-label="完了"' + (row.done ? ' checked' : '') + '></md-checkbox>' +
          '<button type="button" class="qa-open" aria-expanded="' + (open ? 'true' : 'false') + '" title="' + (open ? '詳細を閉じる' : '詳細を開く') + '">' + quickActualTitleHtml(row) + '</button>' +
          '<span class="qa-stepper">' +
            '<md-icon-button touch-target="wrapper" class="quick-step" data-step="-0.25" title="' + hoursStepLabel() + '減らす" aria-label="' + hoursStepUnit() + '時間減らす"' + (numericHours(row.hours) <= 0 ? ' disabled' : '') + '><span class="material-symbols-outlined">remove</span></md-icon-button>' +
            '<md-outlined-text-field class="field number-field quick-hours" type="number" no-spinner inputmode="decimal" min="0" step="0.25" value="' + escapeHtml(row.hours) + '" aria-label="本日実績（時間）"></md-outlined-text-field>' +
            '<md-icon-button touch-target="wrapper" class="quick-step" data-step="0.25" title="' + hoursStepLabel() + '増やす" aria-label="' + hoursStepUnit() + '時間増やす"><span class="material-symbols-outlined">add</span></md-icon-button>' +
          '</span>' +
          '<md-icon-button touch-target="wrapper" class="quick-timer" aria-label="' + runLabel + '" title="' + runLabel + '"><span class="material-symbols-outlined">' + (row.running ? 'check' : 'play_arrow') + '</span></md-icon-button>' +
          // 開閉の矢印。行の名前を押しても同じだが、開けることが分かるよう、矢印を常に出す。
          '<md-icon-button touch-target="wrapper" class="qa-toggle" aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="' + (open ? '詳細を閉じる' : '詳細を開く') + '" title="' + (open ? '詳細を閉じる' : '詳細を開く（プロジェクト・予定・並べ替え・削除）') + '"><span class="material-symbols-outlined">expand_more</span></md-icon-button>' +
        '</div>' + (open ? quickActualMoreHtml(row, position) : '') +
      '</li>';
    }
    function quickActualStatusText() {
      if (state.daily.saving) return '保存中…';
      if (state.daily.dirty) return '変更時に自動保存';
      return state.daily.mode === 'edit' ? '保存済み' : '入力すると保存されます';
    }
    function quickActualSetTotals(panel, rows) {
      const total = roundHours(rows.reduce(function(sum, row) { return sum + numericHours(row.hours); }, 0));
      panel.querySelector('.quick-total b').textContent = hours(total);
      panel.querySelector('.quick-status').textContent = quickActual.blocked ? '' : quickActualStatusText();
    }
    // 入力中は描き直さず（フォーカスが外れる）、数字と状態だけを更新する。
    function renderQuickActual() {
      const panel = document.getElementById('quickActualPanel');
      if (!panel || panel.hidden) return;
      const dateLabel = quickActualToday();
      panel.querySelector('.quick-date').textContent = shortDateLabel(dateLabel) + '（' + '日月火水木金土'.charAt(parseYmd(dateLabel).getDay()) + '）';
      const list = panel.querySelector('.quick-list');
      const message = panel.querySelector('.quick-empty-box');
      const actions = panel.querySelector('.quick-actions');
      if (quickActual.blocked) {
        quickActual.detailId = '';
        list.innerHTML = '';
        message.innerHTML = '<p class="quick-empty">日次の画面が今日ではない日を開いています。</p><md-outlined-button class="quick-open-daily" type="button">今日の日次画面を開く</md-outlined-button>';
        actions.hidden = true;
        quickActualSetTotals(panel, []);
        return;
      }
      actions.hidden = false;
      const rows = quickActualRowElements().map(quickActualRowData);
      quickActualSetTotals(panel, rows);
      if (quickActual.loading && !rows.length) {
        list.innerHTML = '';
        message.innerHTML = '<p class="quick-empty">読み込んでいます…</p>';
        return;
      }
      // 開いている行がなくなったとき（削除・名前の変更で作り直されたとき）は、閉じる。
      if (quickActual.detailId && !rows.some(function(row) { return row.id === quickActual.detailId; })) quickActual.detailId = '';
      message.innerHTML = rows.length ? '' : '<p class="quick-empty">今日の実績はまだありません。下のボタンから追加してください。</p>';
      const shown = Array.from(list.querySelectorAll('.qa-row'));
      const sameRows = shown.length === rows.length && list.dataset.open === quickActual.detailId && shown.every(function(li, index) { return li.dataset.quickId === rows[index].id; });
      if (sameRows && list.contains(document.activeElement)) {
        shown.forEach(function(li, index) {
          const row = rows[index];
          li.classList.toggle('is-done', row.done);
          li.querySelector('.qa-sub').innerHTML = quickActualSubHtml(row);
          const hoursInput = li.querySelector('.quick-hours');
          if (document.activeElement !== hoursInput) hoursInput.value = row.hours;
          const minus = li.querySelector('.quick-step[data-step="-0.25"]');
          if (minus) minus.disabled = numericHours(row.hours) <= 0;
          const facts = li.querySelector('.qa-facts-line');
          if (facts) facts.innerHTML = '前日まで <b>' + escapeHtml(row.previousText) + '</b> · 予定 <b>' + escapeHtml(row.estimateText) + '</b> · 残り <b class="' + (row.over ? 'is-over' : '') + '">' + escapeHtml(row.remainingText) + '</b>';
        });
        return;
      }
      list.dataset.open = quickActual.detailId;
      list.innerHTML = rows.map(function(row, index) { return quickActualRowHtml(row, { first: index === 0, last: index === rows.length - 1 }); }).join('');
    }
    // 日次の行の並びを入れ替える（日次画面のドラッグと同じく、並びを変えたら変更として扱う）。
    function moveQuickActualRow(el, offset) {
      const rows = quickActualRowElements();
      const index = rows.indexOf(el);
      const target = rows[index + offset];
      if (index < 0 || !target) return;
      if (offset < 0) target.parentNode.insertBefore(el, target);
      else target.parentNode.insertBefore(el, target.nextSibling);
      markDailyDirty();
      renderQuickActual();
    }
    function setQuickActualHours(holder, value, commit) {
      const el = quickActualRowElement(holder.dataset.quickId);
      if (!el) return;
      setDailyRowField(el.querySelector('.today-value'), value, commit);
    }
    function removeQuickActualRow(el) {
      if (state.timer && state.timer.rowId === el.dataset.id) finishTimer(false);
      el.remove();
      const list = activeDailyTaskList();
      bindDailyDraggables(list);
      markDailyDirty();
      if (list && !list.querySelector('.work-card')) list.innerHTML = dailyEmptyState();
      quickActual.detailId = '';
      renderQuickActual();
    }
    function bindQuickActualPanel() {
      const panel = document.getElementById('quickActualPanel');
      if (!panel || panel.dataset.bound) return;
      panel.dataset.bound = '1';
      if (typeof matchMedia === 'function') matchMedia(QUICK_ACTUAL_DOCK_QUERY).addEventListener('change', applyQuickActualDock);
      panel.addEventListener('click', function(event) {
        if (event.target.closest('.quick-close')) { closeQuickActual(); return; }
        if (event.target.closest('.quick-open-day')) {
          if (!quickActualCanDock()) closeQuickActual();
          setCalendarMode('day', quickActualToday());
          return;
        }
        if (event.target.closest('.quick-open-daily')) { if (!quickActualCanDock()) closeQuickActual(); setCalendarMode('day', quickActualToday()); return; }
        if (event.target.closest('.quick-add-issue')) { openCandidates('imports'); return; }
        if (event.target.closest('.quick-add-today')) { openCandidates('interrupt'); return; }
        const holder = event.target.closest('[data-quick-id]');
        const el = holder && quickActualRowElement(holder.dataset.quickId);
        if (!holder || !el) return;
        if (event.target.closest('.qa-open, .qa-toggle')) { quickActual.detailId = quickActual.detailId === holder.dataset.quickId ? '' : holder.dataset.quickId; renderQuickActual(); return; }
        const step = event.target.closest('.quick-step');
        if (step) {
          if (step.disabled) return;
          const field = el.querySelector('.today-value');
          const next = steppedHours(numericHours(field.value), Number(step.dataset.step));
          setDailyRowField(field, hours(next), true);
          const input = holder.querySelector('.quick-hours');
          if (input) input.value = hours(next);
          renderQuickActual();
        } else if (event.target.closest('.quick-timer')) {
          if (state.timer && state.timer.rowId === el.dataset.id) finishTimer(true);
          else startTimer(el.dataset.id);
          renderQuickActual();
        } else if (event.target.closest('.quick-up')) {
          moveQuickActualRow(el, -1);
        } else if (event.target.closest('.quick-down')) {
          moveQuickActualRow(el, 1);
        } else if (event.target.closest('.quick-remove')) {
          removeQuickActualRow(el);
        }
      });
      panel.addEventListener('input', function(event) {
        const holder = event.target.closest('[data-quick-id]');
        if (!holder) return;
        if (event.target.classList.contains('quick-name-input')) {
          const nameRow = quickActualRowElement(holder.dataset.quickId);
          if (nameRow) setDailyRowField(nameRow.querySelector('.interrupt-name'), event.target.value, false);
          return;
        }
        if (event.target.classList.contains('quick-hours')) setQuickActualHours(holder, event.target.value, false);
      });
      panel.addEventListener('change', function(event) {
        const holder = event.target.closest('[data-quick-id]');
        const el = holder && quickActualRowElement(holder.dataset.quickId);
        if (!holder || !el) return;
        if (event.target.classList.contains('quick-hours')) {
          event.target.value = hours(numericHours(event.target.value));
          setQuickActualHours(holder, event.target.value, true);
        } else if (event.target.classList.contains('quick-name-input')) {
          // カレンダー行は名前を変えると今日だけの作業に変わり、行が作り直される。
          setDailyRowField(el.querySelector('.interrupt-name'), event.target.value, true);
          renderQuickActual();
        } else if (event.target.classList.contains('quick-done')) {
          const turningOff = dailyRowComplete(el);
          setDailyRowComplete(el, !turningOff);
          if (turningOff && completionSyncEnabled()) releaseParentPlanCompletion(el.dataset.planId || '', parentNameForDaily(composedDailyNameFromRow(el), el.dataset.planId || ''));
          markDailyDirty();
        } else if (event.target.classList.contains('quick-project')) {
          const select = el.querySelector('.daily-project');
          if (select) { select.value = readOutlinedSelectValue(event.target); select.dispatchEvent(new Event('change', { bubbles: true })); }
        }
      });
      panel.addEventListener('keydown', function(event) {
        // 行を開いているときの Esc は、その行を閉じる（パネルは閉じない）。
        if (event.key === 'Escape') { event.stopPropagation(); if (quickActual.detailId) { quickActual.detailId = ''; renderQuickActual(); } else closeQuickActual(); }
        if (event.key === 'Enter' && (event.target.classList.contains('quick-hours') || event.target.classList.contains('quick-name-input'))) { event.preventDefault(); event.target.blur(); }
      });
    }
    async function openQuickActual() {
      const panel = document.getElementById('quickActualPanel');
      if (!panel) return;
      bindQuickActualPanel();
      quickActual.open = true;
      panel.hidden = false;
      document.getElementById('quickActualButton').setAttribute('aria-expanded', 'true');
      applyQuickActualDock();
      quickActual.loading = true;
      renderQuickActual();
      try { await ensureQuickActualToday(); refreshQuickActualDailyRows(); }
      catch (error) { toast('今日の実績を読み込めませんでした: ' + error.message, 'error'); }
      quickActual.loading = false;
      renderQuickActual();
    }
    function closeQuickActual() {
      const panel = document.getElementById('quickActualPanel');
      if (!panel) return;
      quickActual.open = false;
      quickActual.detailId = '';
      panel.hidden = true;
      applyQuickActualDock();
      flushPendingAutoSaves();
      const button = document.getElementById('quickActualButton');
      if (button) { button.setAttribute('aria-expanded', 'false'); button.focus(); }
    }
    function toggleQuickActual() {
      if (quickActual.open) closeQuickActual();
      else openQuickActual();
    }
