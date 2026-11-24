    // アプリバーの期間を押すと開く日付選択。Material 3 の Docked date picker の形に合わせる。
    // 日は日付、週はその日を含む週、月は12か月の一覧から選ぶ。週は月曜始まり（ISO 週）。
    const datePicker = { mode: 'week', year: 0, month: 0, focus: '' };
    const DATE_PICKER_WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];

    function datePickerElement() {
      return document.getElementById('datePicker');
    }
    function datePickerIsOpen() {
      const picker = datePickerElement();
      return !!(picker && !picker.hidden);
    }
    // いま表示している期間の代表の日付（日は当日、週は月曜、月は1日）。
    function datePickerSelectedDate(mode) {
      if (mode === 'day') return state.daily.date;
      if (mode === 'projects') return state.project.monthKey + '-01';
      if (mode === 'month') return state.month.key + '-01';
      const monday = mondayForWeek(state.planner.key);
      return ymd(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
    }
    function openDatePicker() {
      const picker = datePickerElement();
      if (!picker) return;
      datePicker.mode = state.view === 'projects' ? 'projects' : state.calendarMode;
      datePicker.focus = datePickerSelectedDate(datePicker.mode);
      const focus = parseYmd(datePicker.focus);
      datePicker.year = focus.getFullYear();
      datePicker.month = focus.getMonth();
      picker.hidden = false;
      document.getElementById('calendarPeriodButton').setAttribute('aria-expanded', 'true');
      renderDatePicker();
      focusDatePickerCell();
    }
    function closeDatePicker(restoreFocus) {
      const picker = datePickerElement();
      if (!picker || picker.hidden) return;
      picker.hidden = true;
      const button = document.getElementById('calendarPeriodButton');
      button.setAttribute('aria-expanded', 'false');
      if (restoreFocus) button.focus();
    }
    function toggleDatePicker() {
      if (datePickerIsOpen()) closeDatePicker(true);
      else openDatePicker();
    }

    function datePickerDayCells() {
      const today = ymd(new Date());
      const selected = datePickerSelectedDate(datePicker.mode);
      const selectedWeek = datePicker.mode === 'week' ? isoWeek(parseYmd(selected)) : '';
      const first = new Date(datePicker.year, datePicker.month, 1);
      const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7));
      const weeks = [];
      for (let row = 0; row < 6; row++) {
        const cells = [];
        let inSelectedWeek = false;
        for (let column = 0; column < 7; column++) {
          const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + row * 7 + column);
          const value = ymd(date);
          const inWeek = !!selectedWeek && isoWeek(date) === selectedWeek;
          inSelectedWeek = inSelectedWeek || inWeek;
          const classes = ['date-picker-day',
            date.getMonth() !== datePicker.month ? 'is-outside' : '',
            value === today ? 'is-today' : '',
            datePicker.mode === 'day' && value === selected ? 'is-selected' : '',
            inWeek ? 'is-in-week' : '',
            inWeek && column === 0 ? 'is-week-start' : '',
            inWeek && column === 6 ? 'is-week-end' : ''
          ].filter(Boolean).join(' ');
          cells.push('<button type="button" class="' + classes + '" role="gridcell" data-date="' + value + '" tabindex="' + (value === datePicker.focus ? '0' : '-1') + '"' +
            (datePicker.mode === 'day' && value === selected || inWeek && column === 0 ? ' aria-selected="true"' : '') +
            ' aria-label="' + escapeHtml((date.getMonth() + 1) + '月' + date.getDate() + '日' + (value === today ? '（今日）' : '')) + '"><span>' + date.getDate() + '</span></button>');
        }
        weeks.push('<div class="date-picker-week' + (inSelectedWeek ? ' is-selected-week' : '') + '" role="row">' + cells.join('') + '</div>');
      }
      return '<div class="date-picker-weekdays" aria-hidden="true">' + DATE_PICKER_WEEKDAYS.map(function(label) { return '<span>' + label + '</span>'; }).join('') + '</div>' +
        '<div class="date-picker-grid' + (datePicker.mode === 'week' ? ' is-week-mode' : '') + '" role="grid">' + weeks.join('') + '</div>';
    }
    function datePickerMonthCells() {
      const thisMonth = ymd(new Date()).slice(0, 7);
      const selectedMonth = datePicker.mode === 'projects' ? state.project.monthKey : state.month.key;
      const cells = [];
      for (let month = 0; month < 12; month++) {
        const value = datePicker.year + '-' + pad2(month + 1);
        const classes = ['date-picker-month', value === selectedMonth ? 'is-selected' : '', value === thisMonth ? 'is-today' : ''].filter(Boolean).join(' ');
        cells.push('<button type="button" class="' + classes + '" data-month="' + value + '" tabindex="' + (value + '-01' === datePicker.focus ? '0' : '-1') + '"' +
          (value === selectedMonth ? ' aria-selected="true"' : '') + '>' + (month + 1) + '月</button>');
      }
      return '<div class="date-picker-months" role="grid">' + cells.join('') + '</div>';
    }
    function renderDatePicker() {
      const picker = datePickerElement();
      if (!picker) return;
      const monthMode = (datePicker.mode === 'month' || datePicker.mode === 'projects');
      const title = monthMode ? datePicker.year + '年' : datePicker.year + '年' + (datePicker.month + 1) + '月';
      const unit = monthMode ? '年' : '月';
      picker.innerHTML = '<div class="date-picker-header">' +
        '<span class="date-picker-title" aria-live="polite">' + escapeHtml(title) + '</span>' +
        '<md-icon-button touch-target="wrapper" data-date-picker-shift="-1" aria-label="前の' + unit + '"><span class="material-symbols-outlined">chevron_left</span></md-icon-button>' +
        '<md-icon-button touch-target="wrapper" data-date-picker-shift="1" aria-label="次の' + unit + '"><span class="material-symbols-outlined">chevron_right</span></md-icon-button>' +
        '</div>' + (monthMode ? datePickerMonthCells() : datePickerDayCells());
    }
    function focusDatePickerCell() {
      const picker = datePickerElement();
      const cell = picker && picker.querySelector('[tabindex="0"]');
      if (cell) cell.focus();
    }
    function shiftDatePickerView(delta) {
      if ((datePicker.mode === 'month' || datePicker.mode === 'projects')) {
        datePicker.year += delta;
        datePicker.focus = datePicker.year + datePicker.focus.slice(4);
      } else {
        const next = new Date(datePicker.year, datePicker.month + delta, 1);
        datePicker.year = next.getFullYear();
        datePicker.month = next.getMonth();
        const focus = parseYmd(datePicker.focus);
        const last = new Date(datePicker.year, datePicker.month + 1, 0).getDate();
        datePicker.focus = ymd(new Date(datePicker.year, datePicker.month, Math.min(focus.getDate(), last)));
      }
      renderDatePicker();
    }
    // キーボードで日付（月）を動かす。表示中の月から出たら、その月を表示する。
    function moveDatePickerFocus(days, months) {
      const focus = parseYmd(datePicker.focus);
      const next = (datePicker.mode === 'month' || datePicker.mode === 'projects')
        ? new Date(focus.getFullYear(), focus.getMonth() + months, 1)
        : new Date(focus.getFullYear(), focus.getMonth() + months, focus.getDate() + days);
      datePicker.focus = ymd(next);
      datePicker.year = next.getFullYear();
      if (datePicker.mode !== 'month') datePicker.month = next.getMonth();
      renderDatePicker();
      focusDatePickerCell();
    }
    function chooseDatePickerValue(value) {
      const mode = datePicker.mode;
      closeDatePicker(true);
      if (mode === 'projects') selectProjectMonth(value);
      else if (mode === 'month') setCalendarMode('month', value);
      else if (mode === 'week') setCalendarMode('week', isoWeek(parseYmd(value)));
      else setCalendarMode('day', value);
    }

    function bindDatePicker() {
      const picker = datePickerElement();
      const button = document.getElementById('calendarPeriodButton');
      if (!picker || !button) return;
      button.addEventListener('click', toggleDatePicker);
      picker.addEventListener('click', function(event) {
        const shift = event.target.closest('[data-date-picker-shift]');
        if (shift) {
          shiftDatePickerView(Number(shift.dataset.datePickerShift));
          return;
        }
        const cell = event.target.closest('[data-date], [data-month]');
        if (cell) chooseDatePickerValue(cell.dataset.date || cell.dataset.month);
      });
      picker.addEventListener('keydown', function(event) {
        const monthMode = (datePicker.mode === 'month' || datePicker.mode === 'projects');
        const moves = {
          ArrowLeft: [-1, monthMode ? -1 : 0], ArrowRight: [1, monthMode ? 1 : 0],
          ArrowUp: [-7, monthMode ? -3 : 0], ArrowDown: [7, monthMode ? 3 : 0],
          PageUp: [0, monthMode ? -12 : -1], PageDown: [0, monthMode ? 12 : 1]
        };
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeDatePicker(true);
          return;
        }
        const move = moves[event.key];
        if (!move || !event.target.closest('[data-date], [data-month]')) return;
        event.preventDefault();
        moveDatePickerFocus(monthMode ? 0 : move[0], move[1]);
      });
      // 外側を押したら閉じる。
      document.addEventListener('pointerdown', function(event) {
        if (!datePickerIsOpen()) return;
        if (picker.contains(event.target) || button.contains(event.target)) return;
        closeDatePicker(false);
      }, true);
      window.addEventListener('resize', function() { closeDatePicker(false); });
    }
