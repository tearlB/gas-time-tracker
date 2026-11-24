    // 月のガント表示（見るだけ）。予定はプロジェクトごとにまとめ、期間をバーに、日ごとの実績を数字で出す。
    // 編集は予定を押して、その予定がある週の画面で行う。
    const MONTH_FILTER_STORAGE_KEY = (typeof scopedStorageKey === 'function' ? scopedStorageKey('matomete-kousu-month-filter-v1') : 'matomete-kousu-month-filter-v1');

    function monthKeyRange(key) {
      const parts = String(key || '').split('-').map(Number);
      const start = parts[0] + '-' + pad2(parts[1]) + '-01';
      const next = parts[1] === 12 ? (parts[0] + 1) + '-01-01' : parts[0] + '-' + pad2(parts[1] + 1) + '-01';
      return { startYmd: start, endExclusiveYmd: next };
    }
    function monthKeyLabel(key) {
      const parts = String(key || '').split('-');
      return parts.length === 2 ? parts[0] + '年' + Number(parts[1]) + '月' : String(key || '');
    }
    function shiftMonthKey(key, delta) {
      const parts = String(key || '').split('-').map(Number);
      const date = new Date(parts[0], parts[1] - 1 + delta, 1);
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1);
    }
    function monthGanttDays(range, today) {
      const days = [];
      for (let date = range.startYmd; date < range.endExclusiveYmd; date = addDaysYmd(date, 1)) {
        const weekday = parseYmd(date).getDay();
        days.push({
          date: date,
          day: Number(date.slice(8)),
          weekday: '日月火水木金土'.charAt(weekday),
          saturday: weekday === 6,
          sunday: weekday === 0,
          today: date === today
        });
      }
      return days;
    }

    function defaultMonthFilter() {
      return { query: '', projectId: '', status: '', deviationOnly: false };
    }
    // 絞り込みはこのブラウザだけに覚える（検索語は覚えない）。
    function readMonthFilter() {
      try {
        const saved = JSON.parse(localStorage.getItem(MONTH_FILTER_STORAGE_KEY) || 'null');
        if (saved && typeof saved === 'object') {
          return Object.assign(defaultMonthFilter(), {
            projectId: String(saved.projectId || ''),
            status: saved.status === 'open' || saved.status === 'done' ? saved.status : '',
            deviationOnly: !!saved.deviationOnly
          });
        }
      } catch (_) {}
      return defaultMonthFilter();
    }
    function saveMonthFilter(filter) {
      try {
        localStorage.setItem(MONTH_FILTER_STORAGE_KEY, JSON.stringify({
          projectId: filter.projectId || '',
          status: filter.status || '',
          deviationOnly: !!filter.deviationOnly
        }));
      } catch (_) {}
    }
    function monthFilterIsActive(filter) {
      return !!(filter && (String(filter.query || '').trim() || filter.projectId || filter.status || filter.deviationOnly));
    }

    // 月に出す予定を、週の画面と同じルールで選び、状態と予定日からのずれを付ける。
    function monthGanttRows(items, range, today, subtasks) {
      return (items || []).filter(function(item) {
        return item && item.hasPlan !== false && !item.calendarKey;
      }).map(function(item) {
        const done = planIsComplete(item, subtasks);
        const period = planDateRange(item);
        return {
          id: item.id,
          item: item,
          name: item.name || '名称未入力',
          done: done,
          // 状態の表示も、週の画面のサブタスクではなく月のデータのサブタスクで決める。
          statusLabel: done ? '完了' : planProgressLabel(item, subtasks),
          range: period,
          undated: !!item.undated,
          status: planPeriodStatus(item, period, today, done),
          visible: planVisibleInWeek(item, range, today, done)
        };
      }).filter(function(row) { return row.visible; });
    }
    function monthRowHasDeviation(row) {
      const deviation = (row && row.status && row.status.deviation) || {};
      return !!(deviation.earlyDate || deviation.lateDate || deviation.overdue || (row && row.status && row.status.over));
    }
    function monthRowMatchesFilter(row, filter) {
      const query = String((filter && filter.query) || '').trim().toLowerCase();
      if (query && String(row.name || '').toLowerCase().indexOf(query) < 0) return false;
      const projectId = String((row.item && row.item.projectId) || '');
      if (filter && filter.projectId === '__none') {
        if (projectId) return false;
      } else if (filter && filter.projectId && projectId !== filter.projectId) return false;
      if (filter && filter.status === 'open' && row.done) return false;
      if (filter && filter.status === 'done' && !row.done) return false;
      if (filter && filter.deviationOnly && !monthRowHasDeviation(row)) return false;
      return true;
    }
    // プロジェクトごとにまとめる。並びはプロジェクト一覧の順で、未設定は最後。
    // 各グループの中は開始日の早い順、期間未定は最後。
    function monthGanttGroups(rows, projects) {
      const order = {};
      const names = {};
      (projects || []).forEach(function(project, index) {
        if (!project || !project.id) return;
        order[project.id] = index;
        names[project.id] = project.name || project.id;
      });
      const groups = {};
      (rows || []).forEach(function(row) {
        const id = String((row.item && row.item.projectId) || '');
        if (!groups[id]) groups[id] = { id: id, name: id ? (names[id] || 'プロジェクト（一覧にありません）') : 'プロジェクト未設定', rows: [] };
        groups[id].rows.push(row);
      });
      const rank = function(id) {
        if (!id) return Infinity;
        return Object.prototype.hasOwnProperty.call(order, id) ? order[id] : Object.keys(order).length;
      };
      return Object.keys(groups).sort(function(left, right) {
        return rank(left) - rank(right) || groups[left].name.localeCompare(groups[right].name, 'ja');
      }).map(function(id) {
        groups[id].rows.sort(function(left, right) {
          const leftStart = left.range ? left.range.start : '9999-99-99';
          const rightStart = right.range ? right.range.start : '9999-99-99';
          return leftStart < rightStart ? -1 : leftStart > rightStart ? 1 : String(left.name).localeCompare(String(right.name), 'ja');
        });
        return groups[id];
      });
    }
    // 予定を押したときに開く週。月の中で期間が始まる日、なければ月の中で最初に実績がある日、
    // それもなければ今日（今月なら）か月の初日の週を開く。
    function monthPlanAnchorDate(row, range, today) {
      const inMonth = function(date) { return date >= range.startYmd && date < range.endExclusiveYmd; };
      if (row.range) {
        const start = row.range.start < range.startYmd ? range.startYmd : row.range.start;
        if (inMonth(start) && start <= row.range.end) return start;
      }
      const actualByDate = (row.item && row.item.actualByDate) || {};
      const dates = Object.keys(actualByDate).filter(function(date) {
        return inMonth(date) && roundHours(actualByDate[date]) > 0;
      }).sort();
      if (dates.length) return dates[0];
      return inMonth(today) ? today : range.startYmd;
    }

    function monthDayClasses(day) {
      return [day.saturday ? 'is-saturday' : '', day.off ? 'is-off' : '', day.sunday ? 'is-sunday' : '', day.today ? 'is-today' : '', parseYmd(day.date).getMonth() !== parseYmd(addDaysYmd(day.date, 1)).getMonth() ? 'is-month-end' : ''].filter(Boolean).join(' ');
    }
    function monthActualHtml(actual, position) {
      const value = roundHours(actual);
      if (!(value > 0)) return '';
      const tone = position === 'before' ? ' is-early' : position === 'after' ? ' is-late' : '';
      return '<span class="month-actual' + tone + '">' + compactHours(value) + '</span>';
    }
    function monthPlanRowHtml(row, days, grid) {
      const item = row.item;
      const range = row.range;
      const inRange = function(date) { return !!(range && date >= range.start && date <= range.end); };
      const cells = days.map(function(day, index) {
        const filled = inRange(day.date);
        const prevFilled = index > 0 && inRange(days[index - 1].date);
        const nextFilled = index < days.length - 1 && inRange(days[index + 1].date);
        const actual = roundHours(item.actualByDate && item.actualByDate[day.date]);
        const position = filled ? 'within' : (range ? planDatePosition(range, day.date) : 'within');
        const classes = ['month-day', monthDayClasses(day),
          filled ? 'is-work' : '',
          filled && !prevFilled ? 'is-start' : '',
          filled && !nextFilled ? 'is-end' : '',
          filled && row.status.deviation.overdue ? 'is-overdue' : '',
          actual > 0 ? 'has-actual' : ''
        ].filter(Boolean).join(' ');
        const where = !range ? '期間未定' : filled ? '予定期間' : position === 'before' ? '開始日より前' : '終了日より後';
        const title = [row.name, timelineDateLabel(day.date), where, actual > 0 ? '実績 ' + hours(actual) + 'h' : ''].filter(Boolean).join(' · ');
        return '<div class="' + classes + '" data-month-plan-id="' + escapeHtml(row.id) + '" data-date="' + day.date + '" title="' + escapeHtml(title) + '">' + monthActualHtml(actual, position) + '</div>';
      }).join('');
      const statusLabel = row.statusLabel;
      const details = [row.name, statusLabel, range ? planRangeLabel(range) : '期間未定',
        '予定 ' + compactHours(item.planned) + 'h', '累計実績 ' + compactHours(item.actual) + 'h',
        row.status.deviation.overdue ? '期限切れ' : '', row.status.over ? '工数超過' : '', item.note || '', '押すと編集（日付の欄を押すとその週を開く）'].filter(Boolean).join(' · ');
      return '<div class="month-row month-plan' + (row.status.paceTone === 'alert' ? ' is-alert' : '') + (row.done ? ' is-done' : '') + '" ' + grid + '>' +
        '<div class="month-name" role="button" tabindex="0" data-month-plan-id="' + escapeHtml(row.id) + '" title="' + escapeHtml(details) + '" aria-label="' + escapeHtml(details) + '">' +
          '<div class="month-name-heading"><div class="month-name-title">' + planSummaryTitleHtml(row.name, item.issueUrl) + planHoursHtml(roundHours(item.planned), roundHours(item.actual)) + '</div>' +
            planNoteIconHtml(row.id, item.note, true) +
            '<span class="weekly-status' + statusToneClass(row.status) + '">' + escapeHtml(statusLabel) + '</span></div>' +
        '</div>' + cells + timelinePeriodHtml({ range: range, days: days, name: row.name, planned: roundHours(item.planned), actual: roundHours(item.actual), done: row.done, actualByDate: item.actualByDate || {}, today: ymd(new Date()), overdue: !!row.status.deviation.overdue, over: !!row.status.over, mode: 'month', planId: row.id, originWeek: item.originWeek || '' }) + '</div>';
    }

    function syncMonthFilterControls() {
      const filter = state.month.filter;
      const projectSelect = document.getElementById('monthFilterProject');
      if (projectSelect) {
        const options = [{ value: '', label: 'すべて' }].concat((state.projects || []).filter(function(project) {
          return project && project.id && (project.status !== 'archived' || project.id === filter.projectId);
        }).map(function(project) {
          return { value: project.id, label: project.name || project.id };
        })).concat([{ value: '__none', label: 'プロジェクト未設定' }]);
        const signature = JSON.stringify(options) + '\u0000' + filter.projectId;
        if (projectSelect.dataset.signature !== signature) {
          fillSelect(projectSelect, options, options.some(function(option) { return option.value === filter.projectId; }) ? filter.projectId : '');
          projectSelect.dataset.signature = signature;
        }
      }
      const statusSelect = document.getElementById('monthFilterStatus');
      if (statusSelect && readOutlinedSelectValue(statusSelect) !== filter.status) statusSelect.value = filter.status;
      const deviation = document.getElementById('monthFilterDeviation');
      if (deviation) deviation.checked = !!filter.deviationOnly;
      const clear = document.getElementById('clearMonthFilter');
      if (clear) clear.hidden = !monthFilterIsActive(filter);
    }

    function renderMonthGantt(error) {
      const target = document.getElementById('monthGantt');
      if (!target) return;
      const key = state.month.key;
      const range = calendarSurroundingRange('month', key);
      const rangeLabel = document.getElementById('monthRange');
      if (rangeLabel) rangeLabel.textContent = '表示：' + shortYmdLabel(range.startYmd) + '〜' + shortYmdLabel(addDaysYmd(range.endExclusiveYmd, -1));
      syncMonthFilterControls();
      const count = document.getElementById('monthFilterCount');
      const data = state.month.data;
      if (!data || data.periodKey !== key) {
        state.month.rows = [];
        if (count) count.textContent = '';
        target.innerHTML = error
          ? emptyStateHtml('月の予定を読み込めませんでした', String((error && error.message) || error))
          : emptyStateHtml('月の予定を読み込んでいます…', '');
        return;
      }
      if (data.storage && data.storage.configured === false) {
        state.month.rows = [];
        if (count) count.textContent = '';
        target.innerHTML = emptyStateHtml('データの保存先が未設定です', '週の画面から保存先を設定してください。');
        return;
      }
      loadAdjacentCalendarPeriods('month', key);
      const displayData = monthTimelineDisplayData(data);
      const today = ymd(new Date());
      // 行は、選んだ月に関係する予定だけ。前後の月だけに関係する予定は出さない（日付の列は前後の月まで出す）。
      const selectedRange = calendarSurroundingPeriods('month', key)[calendarWindowRadius('month')].range;
      const allRows = monthGanttRows(displayData.items, selectedRange, today, displayData.subtasks);
      const rows = allRows.filter(function(row) { return monthRowMatchesFilter(row, state.month.filter); });
      state.month.rows = rows;
      if (count) count.textContent = monthFilterIsActive(state.month.filter) ? rows.length + '件 / 全' + allRows.length + '件' : allRows.length + '件';
      if (isCompactLayout()) {
        renderMonthMobile(target, rows, allRows, range);
        return;
      }
      const days = monthGanttDays(range, today);
      const workHours = displayData.workHoursByDate || {};
      days.forEach(function(day) { day.off = workHours[day.date] != null && !(workHours[day.date] > 0); });
      const grid = 'style="grid-template-columns:var(--month-name-col) repeat(' + days.length + ',minmax(38px,1fr))"';
      const header = '<div class="month-row month-head" ' + grid + '><div class="month-name month-head-label">予定</div>' + days.map(function(day) {
        return '<button type="button" class="month-day-head ' + monthDayClasses(day) + (day.date.slice(0, 7) === key ? ' is-selected-period' : '') + '" data-month-date="' + day.date + '" title="' + escapeHtml(timelineDateLabel(day.date) + ' の実績を開く') + '"><small>' + day.weekday + '</small><strong>' + (day.day === 1 ? shortDateLabel(day.date) : day.day) + '</strong></button>';
      }).join('') + '</div>';
      const workTotals = '<div class="month-row month-totals month-work-totals" ' + grid + '><div class="month-name month-head-label">稼働時間（h）</div>' + days.map(function(day) {
        const value = workHours[day.date];
        return '<div class="month-day ' + monthDayClasses(day) + '" title="' + escapeHtml(timelineDateLabel(day.date) + (value == null ? '：稼働時間未取得' : '：稼働時間 ' + compactHours(value) + 'h')) + '"><span class="month-work-total">' + (value == null ? '—' : value > 0 ? compactHours(value) : '休') + '</span></div>';
      }).join('') + '</div>';
      const calendarTotals = '<div class="month-row month-totals month-calendar-totals" ' + grid + '><div class="month-name month-head-label">カレンダー予定（h）</div>' + days.map(function(day) {
        const value = displayData.calendarHoursByDate[day.date];
        return '<div class="month-day ' + monthDayClasses(day) + '" title="' + escapeHtml(timelineDateLabel(day.date) + (value == null ? '：カレンダー未取得' : '：カレンダー予定 ' + compactHours(value) + 'h')) + '"><span class="month-calendar-total">' + (value == null ? '—' : compactHours(value)) + '</span></div>';
      }).join('') + '</div>';
      const body = monthGanttGroups(rows, state.projects).map(function(group) {
        const collapsed = !!state.month.collapsed[group.id];
        const planned = group.rows.reduce(function(total, row) { return roundHours(total + roundHours(row.item.planned)); }, 0);
        const actual = group.rows.reduce(function(total, row) {
          return roundHours(total + actualHoursFromByDate(row.item.actualByDate, range.startYmd, range.endExclusiveYmd));
        }, 0);
        const head = '<div class="month-row month-group' + (collapsed ? ' is-collapsed' : '') + '" ' + grid + '>' +
          '<button type="button" class="month-group-toggle" data-month-group="' + escapeHtml(group.id) + '" aria-expanded="' + (collapsed ? 'false' : 'true') + '" title="' + escapeHtml(group.name) + '">' +
            '<span class="material-symbols-outlined" aria-hidden="true">' + (collapsed ? 'chevron_right' : 'expand_more') + '</span>' +
            '<strong>' + escapeHtml(group.name) + '</strong>' +
            '<small>' + group.rows.length + '件</small>' +
          '</button>' +
          '<div class="month-group-summary"><span>予定 <b>' + compactHours(planned) + '<small>h</small></b></span>' +
            '<span>表示範囲の実績 <b>' + compactHours(actual) + '<small>h</small></b></span></div></div>';
        return collapsed ? head : head + group.rows.map(function(row) { return monthPlanRowHtml(row, days, grid); }).join('');
      }).join('');
      const empty = rows.length ? '' : (allRows.length
        ? emptyStateHtml('条件に合う予定はありません', '絞り込みを変えるか、解除してください。')
        : emptyStateHtml('この月の予定はありません', '週の画面で予定を追加すると、ここにも出ます。'));
      // 行の高さが変わるとき（絞り込み、折りたたみ、読み込み後の件数の変化）は、なめらかに動かす。
      const monthRowSelector = '.month-gantt > .month-row';
      const monthRowKey = function(row) {
        const plan = row.querySelector('[data-month-plan-id]');
        const group = row.querySelector('[data-month-group]');
        return plan ? 'plan:' + plan.dataset.monthPlanId : group ? 'group:' + group.dataset.monthGroup : row.className;
      };
      const rowHeightsBefore = target.dataset.timelineKey === key && typeof captureRowHeights === 'function' ? captureRowHeights(target, monthRowSelector, monthRowKey) : null;
      target.innerHTML = '<div class="month-gantt">' + calendarTimelinePeriodsHtml('month', key, days, grid) + header + workTotals + calendarTotals + body + '</div>' + empty;
      if (rowHeightsBefore && typeof animateRowHeights === 'function') animateRowHeights(target, monthRowSelector, monthRowKey, rowHeightsBefore);
      target.dataset.timelineKey = key;
      positionCalendarTimeline('month');
    }

    // スマホでは横長のガントをやめ、プロジェクトごとの予定のリストで見せる。押すとその予定の週を開く。
    function renderMonthMobile(target, rows, allRows, range) {
      const data = state.month.data || {};
      const selected = monthKeyRange(state.month.key);
      const dates = monthGanttDays(selected, '');
      const calendar = data.calendarHoursByDate;
      const calendarHours = calendar && dates.every(function(day) { return calendar[day.date] != null; })
        ? compactHours(dates.reduce(function(total, day) { return total + numericHours(calendar[day.date]); }, 0)) + 'h' : '—';
      const actualHours = dates.reduce(function(total, day) { return total + numericHours((data.dailyTotals || {})[day.date]); }, 0);
      const workHours = data.workHoursByDate;
      const workTotal = workHours && dates.every(function(day) { return workHours[day.date] != null; })
        ? compactHours(dates.reduce(function(total, day) { return total + numericHours(workHours[day.date]); }, 0)) + 'h' : '—';
      const summary = '<div class="month-mobile-summary"><span>稼働時間 <b>' + workTotal + '</b></span><span>カレンダー予定 <b>' + calendarHours + '</b></span><span>実績 <b>' + compactHours(actualHours) + 'h</b></span></div>';
      const body = monthGanttGroups(rows, state.projects).map(function(group) {
        const collapsed = !!state.month.collapsed[group.id];
        const head = '<button type="button" class="month-mobile-group" data-month-group="' + escapeHtml(group.id) + '" aria-expanded="' + (collapsed ? 'false' : 'true') + '">' +
          '<span class="material-symbols-outlined" aria-hidden="true">' + (collapsed ? 'chevron_right' : 'expand_more') + '</span><strong>' + escapeHtml(group.name) + '</strong><small>' + group.rows.length + '件</small></button>';
        if (collapsed) return head;
        return head + group.rows.map(function(row) {
          return mobileListRowHtml({
            className: 'month-mobile-plan' + (row.done ? ' is-done' : ''), attributes: 'data-month-plan-id="' + escapeHtml(row.id) + '"',
            title: row.name, status: row.status, statusLabel: row.statusLabel,
            sub: (row.range ? planRangeLabel(row.range) : '期間未定') + (row.status.deviation.overdue ? ' · 期限切れ' : ''),
            planned: roundHours(row.item.planned), actual: roundHours(row.item.actual), progress: false
          });
        }).join('');
      }).join('');
      const empty = rows.length ? '' : (allRows.length
        ? emptyStateHtml('条件に合う予定はありません', '絞り込みを変えるか、解除してください。')
        : emptyStateHtml('この月の予定はありません', '週の画面で予定を追加すると、ここにも出ます。'));
      target.innerHTML = '<div class="month-mobile">' + summary + body + '</div>' + empty;
      target.dataset.timelineKey = state.month.key;
    }

    async function loadMonthGantt(options) {
      options = options || {};
      const key = state.month.key;
      if (!isProjectMonthKey(key)) return;
      // 前に開いた月はすぐに出し、裏で読み直す。
      state.month.data = state.month.cache[key] || null;
      renderMonthGantt();
      const seq = ++state.month.requestSeq;
      state.month.busy = true;
      try {
        const results = await Promise.all([
          gas('loadPlanningMonthGantt', key),
          (typeof ensureProjectCatalog === 'function' ? ensureProjectCatalog() : Promise.resolve([])).catch(function() { return []; })
        ]);
        if (seq !== state.month.requestSeq) return;
        state.month.cache[key] = results[0];
        if (state.month.key === key) {
          state.month.data = results[0];
          if (state.view === 'month') renderMonthGantt();
        }
      } catch (error) {
        if (seq !== state.month.requestSeq) return;
        if (!state.month.data) renderMonthGantt(error);
        toast('月の予定を読み込めませんでした: ' + ((error && error.message) || error), 'error');
      } finally {
        if (seq === state.month.requestSeq) state.month.busy = false;
      }
    }

    // クリックした日の週の画面に、その予定が出るか。週の画面の表示ルール（weekPlanRows）と同じ条件で見る。
    function monthPlanWeekVisibility(row, date) {
      const weekKey = isoWeek(parseYmd(date));
      const start = weekKeyStartYmd(weekKey);
      const range = { startYmd: start, endExclusiveYmd: addDaysYmd(start, 7) };
      const outside = !planVisibleInWeek(row.item, range, ymd(new Date()), row.done, weekKey);
      return { weekKey: weekKey, range: range, visible: !outside, reason: outside ? 'range' : '' };
    }
    function monthWeekLabel(visibility) {
      const last = addDaysYmd(visibility.range.startYmd, 6);
      return shortYmdLabel(visibility.range.startYmd) + '〜' + shortYmdLabel(last) + '（' + visibility.weekKey + '）';
    }
    // 開く先（週と、その中の予定の行）。表示されない週のときは、エラーにせず開き方を変える。
    function monthPlanOpenTarget(row, dateValue) {
      const range = calendarSurroundingRange('month', state.month.key);
      const today = ymd(new Date());
      const requested = isYmdText(dateValue) ? dateValue : monthPlanAnchorDate(row, range, today);
      // 押した日の週をそのまま開く（予定の期間外でも、別の週へ切り替えない）。
      return { date: requested, visibility: monthPlanWeekVisibility(row, requested), mode: 'direct' };
    }
    function monthOpenHintText(row, target) {
      const label = monthWeekLabel(target.visibility);
      if (target.mode === 'anchor') return 'この日の週には表示されないため、予定の期間の ' + label + ' を開きます';
      return label + ' の画面で「' + row.name + '」を開きます';
    }

    async function openWeekForMonthPlan(planId, dateValue) {
      const row = (state.month.rows || []).find(function(entry) { return entry.id === planId; });
      if (!row) return;
      const target = monthPlanOpenTarget(row, dateValue);
      await setCalendarMode('week', isoWeek(parseYmd(target.date)));
      if (state.view !== 'planning') return;
      focusPlannerRow(planId);
      const selector = '#weekCalendar .span-row[data-plan-id="' + (window.CSS && CSS.escape ? CSS.escape(planId) : planId) + '"]';
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // 月から来た行がどれか分かるよう、少しの間だけ強調する。
        element.classList.remove('is-flash');
        void element.offsetWidth;
        element.classList.add('is-flash');
        setTimeout(function() { element.classList.remove('is-flash'); }, 1800);
      }
    }

    // 押した先を、行と列の強調で前もって見せる（週の列全体と、押した日）。
    function clearMonthOpenHint() {
      const hint = document.getElementById('monthOpenHint');
      if (hint) hint.hidden = true;
      document.querySelectorAll('#monthGantt .is-open-week, #monthGantt .is-open-target').forEach(function(element) {
        element.classList.remove('is-open-week', 'is-open-target', 'is-open-fallback');
      });
    }
    function showMonthOpenHint(element, event) {
      // 期間をドラッグしている間は、開く先の説明を出さない。
      if (typeof periodDrag !== 'undefined' && (periodDrag.active || periodDrag.pending)) return clearMonthOpenHint();
      const row = (state.month.rows || []).find(function(entry) { return entry.id === element.dataset.monthPlanId; });
      if (!row) return clearMonthOpenHint();
      const target = monthPlanOpenTarget(row, element.dataset.date || '');
      clearMonthOpenHint();
      const gantt = document.getElementById('monthGantt');
      const rowElement = element.closest('.month-plan');
      const weekDates = {};
      for (let i = 0; i < 7; i++) weekDates[addDaysYmd(target.visibility.range.startYmd, i)] = true;
      const mark = function(cell, dateValue) {
        if (weekDates[dateValue]) cell.classList.add('is-open-week');
        if (dateValue === target.date) cell.classList.add('is-open-target');
      };
      if (rowElement) rowElement.querySelectorAll('.month-day[data-date]').forEach(function(cell) { mark(cell, cell.dataset.date); });
      gantt.querySelectorAll('.month-day-head[data-month-date]').forEach(function(cell) { mark(cell, cell.dataset.monthDate); });
    }
    function positionMonthOpenHint(event) {
      const hint = document.getElementById('monthOpenHint');
      if (!hint || hint.hidden || !event) return;
      const width = hint.offsetWidth;
      hint.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX + 14)) + 'px';
      hint.style.top = (event.clientY + 18) + 'px';
    }

    function wireMonthGanttEvents() {
      const query = document.getElementById('monthFilterQuery');
      query.addEventListener('input', function() {
        state.month.filter.query = String(query.value || '');
        renderMonthGantt();
      });
      document.getElementById('monthFilterProject').addEventListener('change', function(event) {
        state.month.filter.projectId = readOutlinedSelectValue(event.currentTarget) || '';
        saveMonthFilter(state.month.filter);
        renderMonthGantt();
      });
      document.getElementById('monthFilterStatus').addEventListener('change', function(event) {
        state.month.filter.status = readOutlinedSelectValue(event.currentTarget) || '';
        saveMonthFilter(state.month.filter);
        renderMonthGantt();
      });
      document.getElementById('monthFilterDeviation').addEventListener('change', function(event) {
        state.month.filter.deviationOnly = !!event.currentTarget.checked;
        saveMonthFilter(state.month.filter);
        renderMonthGantt();
      });
      document.getElementById('clearMonthFilter').addEventListener('click', function() {
        state.month.filter = defaultMonthFilter();
        query.value = '';
        saveMonthFilter(state.month.filter);
        renderMonthGantt();
      });
      const gantt = document.getElementById('monthGantt');
      gantt.addEventListener('click', function(event) {
        if (event.target.closest('a')) return;
        const group = event.target.closest('[data-month-group]');
        if (group) {
          const id = group.dataset.monthGroup;
          state.month.collapsed[id] = !state.month.collapsed[id];
          renderMonthGantt();
          return;
        }
        const day = event.target.closest('[data-month-date]');
        if (day) { setCalendarMode('day', day.dataset.monthDate); return; }
        const name = event.target.closest('.month-name[data-month-plan-id]');
        if (name) { openMonthPlanEditor(name.dataset.monthPlanId); return; }
        const bar = event.target.closest('.timeline-period[data-plan-id]');
        if (bar) { openMonthPlanEditor(bar.dataset.planId); return; }
        const plan = event.target.closest('[data-month-plan-id]');
        if (plan) openWeekForMonthPlan(plan.dataset.monthPlanId, plan.dataset.date || '');
      });
      gantt.addEventListener('mouseover', function(event) {
        const cell = event.target.closest('.month-plan .month-day[data-month-plan-id]');
        const name = event.target.closest('.month-name[data-month-plan-id]');
        if (cell) showMonthOpenHint(cell, event);
        else if (name) showMonthOpenHint(name, event);
        else clearMonthOpenHint();
      });
      gantt.addEventListener('mousemove', function(event) { positionMonthOpenHint(event); });
      gantt.addEventListener('mouseleave', clearMonthOpenHint);
      gantt.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const plan = event.target.closest('.month-name[data-month-plan-id]');
        if (!plan) return;
        event.preventDefault();
        openMonthPlanEditor(plan.dataset.monthPlanId);
      });
    }
