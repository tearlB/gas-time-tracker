    // 中央の期間の前後は表示専用データとして期間ごとに保持し、保存対象へ追加しない。
    // 中央が移っても、読み込み済みの期間はそのまま使い回す。
    const ADJACENT_PERIOD_TTL_MS = 3 * 60 * 1000;
    const adjacentCalendarPeriods = { week: { key: '' }, month: { key: '' } };
    const weekNavigationMotion = { key: '', before: new Map(), animations: [], active: false, repaint: false, generation: 0 };
    function prepareWeekNavigationMotion(nextKey) {
      weekNavigationMotion.key = '';
      weekNavigationMotion.before.clear();
      const target = document.getElementById('weekCalendar');
      if (!target || state.view !== 'planning' || target.dataset.timelineKey === nextKey || !motionAllowed()) return;
      if (!target.querySelector('.week-span') || target.querySelector('.week-span.is-reordering')) return;
      target.querySelectorAll('.span-row[data-row-key]').forEach(function(row) {
        weekNavigationMotion.before.set(row.dataset.rowKey, row.getBoundingClientRect().top);
      });
      // 連続移動では、動いている途中の見た目を次の出発点にする。
      weekNavigationMotion.generation++;
      weekNavigationMotion.animations.forEach(function(animation) { animation.cancel(); });
      weekNavigationMotion.animations = [];
      weekNavigationMotion.active = false;
      weekNavigationMotion.repaint = false;
      weekNavigationMotion.key = nextKey;
    }
    function deferWeekNavigationRender() {
      if (!weekNavigationMotion.active) return false;
      weekNavigationMotion.repaint = true;
      return true;
    }
    // 週のデータが揃ったときに一度だけ動かす。稼働時間・前後の週の再取得では動かさない。
    function finishWeekNavigationMotion() {
      if (!weekNavigationMotion.key || weekNavigationMotion.key !== state.planner.key || state.view !== 'planning') return;
      const target = document.getElementById('weekCalendar');
      const before = weekNavigationMotion.before;
      weekNavigationMotion.key = '';
      weekNavigationMotion.before = new Map();
      if (!target || target.dataset.timelineKey !== state.planner.key || !motionAllowed()) return;
      const rows = Array.from(target.querySelectorAll('.span-row[data-row-key]')).map(function(row) {
        return { row: row, rect: row.getBoundingClientRect(), top: before.get(row.dataset.rowKey) };
      });
      rows.forEach(function(entry) {
        if (!entry.row.animate || entry.rect.height === 0 || entry.rect.bottom < 0 || entry.rect.top > window.innerHeight) return;
        const delta = entry.top == null ? 0 : entry.top - entry.rect.top;
        const frames = entry.top == null ? [{ opacity: 0 }, { opacity: 1 }]
          : Math.abs(delta) >= 1 ? [{ transform: 'translateY(' + delta + 'px)' }, { transform: 'translateY(0)' }] : null;
        if (!frames) return;
        weekNavigationMotion.animations.push(entry.row.animate(frames, { duration: 280, easing: 'cubic-bezier(.2, 0, 0, 1)' }));
      });
      if (!weekNavigationMotion.animations.length) return;
      weekNavigationMotion.active = true;
      const generation = weekNavigationMotion.generation;
      Promise.allSettled(weekNavigationMotion.animations.map(function(animation) { return animation.finished; })).then(function() {
        if (generation !== weekNavigationMotion.generation) return;
        weekNavigationMotion.active = false;
        weekNavigationMotion.animations = [];
        if (weekNavigationMotion.repaint) {
          weekNavigationMotion.repaint = false;
          if (state.view === 'planning') scheduleCalendarTimelineRender('week');
        }
      });
    }
    // 同じ行はDOMを残し、カレンダー取得後に全行の部品を作り直すのを避ける。
    function weekRowKey(row) { return row.getAttribute('data-row-key') || row.className; }
    function patchWeekTimeline(target, markup) {
      if (target._timelineMarkup === markup && target.firstElementChild && target.firstElementChild.classList.contains('week-span')) return;
      // 行の高さが変わる（カレンダー予定の件数など）ときは、なめらかに動かす。
      // 表示する週が切り替わる描き直しでは動かさない（週の移動の動きが別にあり、重なると重くなる）。
      const sameWeek = target.dataset.timelineKey === state.planner.key;
      const heightsBefore = sameWeek && typeof captureRowHeights === 'function' ? captureRowHeights(target, '.week-span > *', weekRowKey) : null;
      const template = document.createElement('template');
      template.innerHTML = markup;
      const nextRoot = template.content.firstElementChild;
      let root = target.firstElementChild;
      if (!root || !root.classList.contains('week-span')) {
        target.replaceChildren(nextRoot);
        root = nextRoot;
        Array.from(root.children).forEach(function(row) { row._timelineMarkup = row.outerHTML; });
      } else {
        root.setAttribute('style', nextRoot.getAttribute('style') || '');
        const byKey = new Map();
        const keyOf = function(row) { return row.getAttribute('data-row-key') || row.className; };
        Array.from(root.children).forEach(function(row) { byKey.set(keyOf(row), row); });
        let cursor = root.firstElementChild;
        const kept = new Set();
        Array.from(nextRoot.children).forEach(function(row) {
          const html = row.outerHTML;
          const previous = byKey.get(keyOf(row));
          const node = previous && previous._timelineMarkup === html ? previous : row;
          node._timelineMarkup = html;
          kept.add(node);
          if (node === cursor) cursor = cursor.nextElementSibling;
          else root.insertBefore(node, cursor);
        });
        Array.from(root.children).forEach(function(row) { if (!kept.has(row)) row.remove(); });
      }
      target._timelineMarkup = markup;
      if (heightsBefore && typeof animateRowHeights === 'function') animateRowHeights(target, '.week-span > *', weekRowKey, heightsBefore);
    }
    function resetAdjacentCalendarPeriods() {
      ['week', 'month'].forEach(function(mode) {
        const entry = adjacentCalendarPeriods[mode];
        entry.key = '';
        entry.farFor = '';
        entry.snapshots = {};
        entry.fetchedAt = {};
        entry.loading = {};
        entry.errors = {};
      });
    }
    resetAdjacentCalendarPeriods();
    // 保存のあとは、読み込み済みの前後の期間を消さずに古い扱いにし、次に描くときに読み直させる。
    function markAdjacentCalendarPeriodsStale() {
      ['week', 'month'].forEach(function(mode) { adjacentCalendarPeriods[mode].fetchedAt = {}; });
    }
    // 中央から外れた期間を、読み込み済みの前後データとして残す。
    function rememberAdjacentCalendarPeriod(mode, key, data) {
      if (!key || !data) return;
      const entry = adjacentCalendarPeriods[mode];
      entry.snapshots[key] = data;
      entry.fetchedAt[key] = Date.now();
    }
    function calendarNeighborKeys(mode, key) {
      return calendarSurroundingPeriods(mode, key).map(function(period) { return period.key; }).filter(function(value) { return value !== key; });
    }

    // 表示する範囲は、中央の期間の前後に何期間ずつ並べるか。週は前後2週ずつ（5週）、月は前後1か月ずつ（3か月）。
    // 週を広げているのは、隣の週へ進んでも描き直さずにスクロールを続けられるようにするため。
    const CALENDAR_WINDOW_RADIUS = { week: 2, month: 1 };
    function calendarWindowRadius(mode) { return CALENDAR_WINDOW_RADIUS[mode] || 1; }
    function shiftWeekKey(key, delta) {
      let result = key;
      for (let i = 0; i < Math.abs(delta); i++) result = delta < 0 ? previousWeekKey(result) : nextWeekKey(result);
      return result;
    }
    function calendarSurroundingPeriods(mode, key) {
      const radius = calendarWindowRadius(mode);
      const keys = [];
      for (let offset = -radius; offset <= radius; offset++) keys.push(mode === 'month' ? shiftMonthKey(key, offset) : shiftWeekKey(key, offset));
      return keys.map(function(value) {
        if (mode === 'month') return { key: value, range: monthKeyRange(value) };
        const monday = mondayForWeek(value);
        const start = monday.toISOString().slice(0, 10);
        return { key: value, range: { startYmd: start, endExclusiveYmd: addDaysYmd(start, 7) } };
      });
    }
    function calendarSurroundingRange(mode, key) {
      const periods = calendarSurroundingPeriods(mode, key);
      return { startYmd: periods[0].range.startYmd, endExclusiveYmd: periods[periods.length - 1].range.endExclusiveYmd };
    }
    function calendarSelectedStart(mode, key) {
      return calendarSurroundingPeriods(mode, key)[calendarWindowRadius(mode)].range.startYmd;
    }
    // 2つの期間キーの差（期間の数。後ろなら正）。
    function calendarPeriodDelta(mode, fromKey, toKey) {
      if (mode === 'month') {
        const from = fromKey.split('-').map(Number);
        const to = toKey.split('-').map(Number);
        return (to[0] - from[0]) * 12 + (to[1] - from[1]);
      }
      return Math.round((mondayForWeek(toKey).getTime() - mondayForWeek(fromKey).getTime()) / 604800000);
    }
    function mergeCalendarTimelineItems(primary, others, primaryRange) {
      const items = [];
      const byId = new Map();
      function add(item, central) {
        const id = item.hasPlan === false ? '__actual__' + item.name : item.id || (item.originWeek + '\u0000' + item.name);
        let found = byId.get(id);
        if (!found) {
          found = Object.assign({}, item, { actualByDate: {}, contextOnly: !central });
          byId.set(id, found);
          items.push(found);
        }
        Object.keys(item.actualByDate || {}).forEach(function(date) {
          // 指定週の編集中データを、その週の範囲では常に優先する。
          const isPrimaryDate = primaryRange && date >= primaryRange.startYmd && date < primaryRange.endExclusiveYmd;
          if (!central && isPrimaryDate && !found.contextOnly) return;
          found.actualByDate[date] = item.actualByDate[date];
        });
        found.actual = Math.max(roundHours(found.actual), roundHours(item.actual));
      }
      (primary || []).forEach(function(item) { add(item, true); });
      (others || []).forEach(function(item) { add(item, false); });
      return items;
    }
    // 前後の週の予定は、その週を中央に表示したときと同じもの（持ち越して重ねた予定を含む）を使う。
    // 行がその週を中央にしたときと変わらないので、週を切り替えても行が増減しない。
    function calendarSnapshotItems(snapshot) {
      const stored = state.weekSnapshot && snapshot.periodKey && state.weekSnapshot['week:' + snapshot.periodKey];
      const overlay = snapshot.items || (stored && stored.overlay && stored.overlay.items);
      const base = overlay ? overlay.map(function(item) { return Object.assign({}, item); }) : plannerItemsFromSummaryRows(snapshot.rows);
      return base.map(function(item) {
        const actualByDate = {};
        Object.keys(item.actualByDate || {}).forEach(function(date) {
          if (date >= snapshot.range.startYmd && date < snapshot.range.endExclusiveYmd) actualByDate[date] = item.actualByDate[date];
        });
        return Object.assign({}, item, { actualByDate: actualByDate });
      });
    }
    function calendarAdjacentSnapshots(mode, key) {
      const entry = adjacentCalendarPeriods[mode];
      return calendarNeighborKeys(mode, key).map(function(value) { return entry.snapshots[value]; }).filter(Boolean);
    }
    function calendarTimelinePeriodsHtml(mode, key, days, grid) {
      const segments = calendarSurroundingPeriods(mode, key).map(function(period) {
        const first = days.findIndex(function(day) { return day.date === period.range.startYmd; });
        const count = days.filter(function(day) { return day.date >= period.range.startYmd && day.date < period.range.endExclusiveYmd; }).length;
        const text = mode === 'month' ? monthKeyLabel(period.key) : shortDateLabel(period.range.startYmd) + '〜' + shortDateLabel(addDaysYmd(period.range.endExclusiveYmd, -1)) + ' · ' + period.key;
        return '<div class="timeline-periods-segment' + (period.key === key ? ' is-selected-period' : '') + '" style="grid-column:' + (first + 2) + ' / span ' + count + '"><span class="timeline-periods-caption">' +
          '<span class="timeline-periods-title" title="' + escapeHtml(text) + '">' + escapeHtml(text) + '</span></span></div>';
      }).join('');
      return '<div class="timeline-periods" ' + grid + '><div class="timeline-periods-label">' + (mode === 'month' ? '月' : '週') + '</div>' + segments + '</div>';
    }
    function updateCalendarAdjacentStatus(mode) {
      const entry = adjacentCalendarPeriods[mode];
      const status = document.getElementById(mode === 'week' ? 'weekTimelineStatus' : 'monthTimelineStatus');
      const retry = document.getElementById(mode === 'week' ? 'retryWeekTimeline' : 'retryMonthTimeline');
      const neighbors = entry.key ? calendarNeighborKeys(mode, entry.key) : [];
      const errors = neighbors.filter(function(value) { return entry.errors[value]; });
      const loading = neighbors.some(function(value) { return entry.loading[value]; });
      if (status) status.textContent = errors.length ? '前後の期間を一部読み込めませんでした' : loading ? '前後の期間を読み込んでいます…' : '横にスクロールすると前後の' + (mode === 'week' ? '週' : '月') + 'の予定と実績も見られます';
      if (retry) retry.hidden = !errors.length || loading;
    }
    // 週は予定・実績に加えてカレンダーも読み、中央の週と同じ見た目で出す。
    function loadAdjacentWeekCalendar(periodKey) {
      if (typeof weekCapacityCacheKey !== 'function') return Promise.resolve();
      const cacheKey = weekCapacityCacheKey(periodKey);
      if (calendarCacheIsFresh(cacheKey)) return Promise.resolve();
      return gas('loadPlanningCalendarCapacity', 'week', periodKey).then(function(capacity) {
        rememberCalendarCapacity(cacheKey, capacity);
      }).catch(function() {});
    }
    // 読み込んだ前後の期間を、中央へ移ったときにすぐ描けるよう画面のキャッシュにも入れる。
    function seedAdjacentCalendarCaches(mode, periodKey, data) {
      if (mode === 'month') {
        if (state.month.cache) state.month.cache[periodKey] = data;
        return;
      }
      if (typeof weekWorkspaceCacheKey === 'function' && state.calendarCache) state.calendarCache[weekWorkspaceCacheKey(periodKey)] = data;
      if (typeof prefetchWeekSnapshot === 'function') prefetchWeekSnapshot(periodKey);
    }
    function loadAdjacentCalendarPeriods(mode, key, force) {
      const entry = adjacentCalendarPeriods[mode];
      entry.key = key;
      // 1期間ぶんを読み込む。すでに新しい内容があるか、読み込み中なら、何もしない（null）。
      const startOne = function(periodKey) {
        const fresh = entry.snapshots[periodKey] && Date.now() - (entry.fetchedAt[periodKey] || 0) < ADJACENT_PERIOD_TTL_MS;
        if (entry.loading[periodKey] || (fresh && !force)) return null;
        entry.loading[periodKey] = true;
        delete entry.errors[periodKey];
        const request = mode === 'week'
          ? Promise.all([gas('loadPlanningWorkspace', 'week', periodKey), loadAdjacentWeekCalendar(periodKey)]).then(function(results) { return results[0]; })
          : gas('loadPlanningMonthGantt', periodKey);
        return request.then(function(data) {
          rememberAdjacentCalendarPeriod(mode, periodKey, data);
          seedAdjacentCalendarCaches(mode, periodKey, data);
        }).catch(function(error) {
          entry.errors[periodKey] = String(error && error.message || error);
        }).finally(function() {
          entry.loading[periodKey] = false;
          // 中央が移って前後でなくなった期間は、描き直さない。
          const current = mode === 'week' ? state.planner.key : state.month.key;
          const visible = mode === 'week' ? state.view === 'planning' : state.view === 'month';
          if (!visible || calendarNeighborKeys(mode, current).indexOf(periodKey) < 0) return;
          updateCalendarAdjacentStatus(mode);
          scheduleCalendarTimelineRender(mode);
        });
      };
      // 近い期間（すぐ隣）を先に、その外側は、隣が終わってから読む（一度にたくさん呼んで、近い期間の読み込みを遅らせないため）。
      const keys = calendarNeighborKeys(mode, key);
      const near = keys.filter(function(periodKey) { return Math.abs(calendarPeriodDelta(mode, key, periodKey)) <= 1; });
      const far = keys.filter(function(periodKey) { return near.indexOf(periodKey) < 0; });
      const nearPending = near.map(startOne).filter(Boolean);
      updateCalendarAdjacentStatus(mode);
      Promise.all(nearPending).then(function() {
        if (entry.key !== key) return null;
        return Promise.all(far.map(startOne).filter(Boolean));
      }).then(function() {
        // 表示する範囲の外側も、続けて先に読んでおく（さらに先へスクロールしたとき、読み込み待ちにならないように）。
        if (entry.key === key) setTimeout(function() { prefetchFarCalendarPeriods(mode, key); }, 400);
      });
    }
    // 前後のさらに外側（2つ先）の期間を、前後の読み込みの後に1つずつ読む。描画はしない（中央が移ったときに使う）。
    function farCalendarKeys(mode, key) {
      const periods = calendarSurroundingPeriods(mode, key);
      if (periods.length < 2) return [];
      const first = periods[0].key;
      const last = periods[periods.length - 1].key;
      return mode === 'month' ? [shiftMonthKey(first, -1), shiftMonthKey(last, 1)] : [previousWeekKey(first), nextWeekKey(last)];
    }
    function prefetchFarCalendarPeriods(mode, key) {
      const entry = adjacentCalendarPeriods[mode];
      if (entry.key !== key || entry.farFor === key) return;
      if ((mode === 'week' ? state.view !== 'planning' : state.view !== 'month')) return;
      entry.farFor = key;
      let chain = Promise.resolve();
      farCalendarKeys(mode, key).forEach(function(periodKey) {
        chain = chain.then(function() {
          const fresh = entry.snapshots[periodKey] && Date.now() - (entry.fetchedAt[periodKey] || 0) < ADJACENT_PERIOD_TTL_MS;
          if (entry.key !== key || entry.loading[periodKey] || fresh) return null;
          entry.loading[periodKey] = true;
          const request = mode === 'week'
            ? Promise.all([gas('loadPlanningWorkspace', 'week', periodKey), loadAdjacentWeekCalendar(periodKey)]).then(function(results) { return results[0]; })
            : gas('loadPlanningMonthGantt', periodKey);
          return request.then(function(data) {
            rememberAdjacentCalendarPeriod(mode, periodKey, data);
            seedAdjacentCalendarCaches(mode, periodKey, data);
          }).catch(function() {}).finally(function() { entry.loading[periodKey] = false; });
        });
      });
    }
    // 前後の期間の読み込みが続けて終わったときの描き直しを、1フレームに1回にまとめる（動きの途中でかくつかないように）。
    const calendarTimelineRenderFrames = { week: 0, month: 0 };
    function scheduleCalendarTimelineRender(mode) {
      if (calendarTimelineRenderFrames[mode]) return;
      const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function(callback) { return setTimeout(callback, 16); };
      calendarTimelineRenderFrames[mode] = frame(function() {
        calendarTimelineRenderFrames[mode] = 0;
        if (mode === 'week') {
          if (!document.querySelector('.week-span.is-reordering')) renderWeekCalendar();
        } else renderMonthGantt();
      });
    }
    // 実績画面で入力中の時間を、保存と読み直しを待たずに週の帯へ出す。その日の値は入力中の内容で置き換える。
    function overlayLiveDailyActuals(items, liveDaily) {
      if (!liveDaily || !liveDaily.date || liveDaily.loadedDate !== liveDaily.date || !Array.isArray(liveDaily.rows)) return items;
      const date = liveDaily.date;
      return items.map(function(item) {
        if (!item) return item;
        let matched = false;
        let live = 0;
        liveDaily.rows.forEach(function(row) {
          if (!row || dailyRowIsInterrupt(row)) return;
          const belongs = row.planId ? row.planId === item.id : dailyBelongsToPlan(row.name, item.name);
          if (!belongs) return;
          matched = true;
          live += numericHours(row.today != null ? row.today : row.hours);
        });
        const before = roundHours(item.actualByDate && item.actualByDate[date]);
        live = roundHours(live);
        if ((!matched && !(before > 0)) || live === before) return item;
        const actualByDate = Object.assign({}, item.actualByDate || {});
        if (live > 0) actualByDate[date] = live;
        else delete actualByDate[date];
        return Object.assign({}, item, { actualByDate: actualByDate, actual: roundHours(roundHours(item.actual) - before + live) });
      });
    }
    function liveDailyForWeek(weekKey) {
      // 日次の行をまだ読み込んでいない（日の画面を開く前の空の状態）ときは使わない。空の行で週のその日の実績を0にしてしまうため。
      const daily = state.daily;
      if (!daily || !daily.date || daily.loadedDate !== daily.date) return null;
      return dailyWeekKey(daily.date) === weekKey ? daily : null;
    }
    function weekTimelineDisplayModel(baseModel) {
      const key = state.planner.key;
      const snapshots = calendarAdjacentSnapshots('week', key);
      const extraItems = snapshots.flatMap(calendarSnapshotItems);
      const items = mergeCalendarTimelineItems(overlayLiveDailyActuals(plannerItems(), liveDailyForWeek(key)), extraItems, state.planner.summary && state.planner.summary.range);
      const range = calendarSurroundingRange('week', key);
      const subtasks = (state.planner.summary && state.planner.summary.subtasks || []).concat(snapshots.flatMap(function(snapshot) { return snapshot.subtasks || []; }));
      // 行は、表示中の週に関係する予定だけ。前後の週だけに関係する予定は出さない（日付の列は前後の週まで出す）。
      const selectedRange = calendarSurroundingPeriods('week', key)[calendarWindowRadius('week')].range;
      const rows = weekPlanRows(sortByPlanPriority(items), { range: selectedRange, weekKey: key, today: ymd(new Date()), subtasks: subtasks });
      const actualSummary = {};
      ['dailyActualByPlanChild', 'dailyActualByName'].forEach(function(field) {
        const merged = {};
        const primary = state.planner.summary && state.planner.summary[field] || {};
        Object.keys(primary).forEach(function(name) { merged[name] = Object.assign({}, primary[name]); });
        snapshots.forEach(function(snapshot) {
          const source = snapshot[field] || {};
          Object.keys(source).forEach(function(name) {
            if (!merged[name]) merged[name] = {};
            Object.keys(source[name]).forEach(function(date) {
              if (date >= snapshot.range.startYmd && date < snapshot.range.endExclusiveYmd) merged[name][date] = source[name][date];
            });
          });
        });
        actualSummary[field] = merged;
      });
      // カレンダー予定から実績に回した記録は、前後の週の分も集める（点線の表示を、どの週でも同じにするため）。
      const calendarInterruptsByDate = Object.assign({}, baseModel.calendarInterruptsByDate || {});
      snapshots.forEach(function(snapshot) {
        const source = snapshot.calendarInterruptsByDate || {};
        Object.keys(source).forEach(function(date) {
          if (date >= snapshot.range.startYmd && date < snapshot.range.endExclusiveYmd) calendarInterruptsByDate[date] = source[date];
        });
      });
      return Object.assign({}, baseModel, { calendarInterruptsByDate: calendarInterruptsByDate, rows: rows, primaryRows: baseModel.rows, timelineItems: items, timelineSubtasks: subtasks, timelineActualSummary: actualSummary });
    }
    // 週を中央に表示していたときの、日ごとの見え方（実績・稼働・カレンダーの予定）を覚えておく。
    // 隣の週へ移って前後の週になっても、その週の表示が変わらないように、覚えた内容をそのまま使う。
    const weekDisplayMemory = {};
    function rememberWeekDisplay(weekKey, days, model, liveDaily) {
      if (!weekKey) return;
      const entry = { at: Date.now(), days: {} };
      days.forEach(function(day) {
        if (day.contextOnly) return;
        entry.days[day.date] = { actual: weekTimelineDayActualHours(day, model, liveDaily), day: Object.assign({}, day) };
      });
      weekDisplayMemory[weekKey] = entry;
      // 古い順に捨てて、8週分までにする。
      Object.keys(weekDisplayMemory).sort(function(left, right) { return weekDisplayMemory[right].at - weekDisplayMemory[left].at; }).slice(8).forEach(function(key) { delete weekDisplayMemory[key]; });
    }
    // 覚えた表示を使うのは、直近のあいだだけ（ほかの画面で実績を直した後に、古い数字を出し続けないため）。
    const WEEK_DISPLAY_MEMORY_TTL_MS = 90 * 1000;
    function rememberedWeekDisplay(date) {
      const entry = weekDisplayMemory[isoWeek(parseYmd(date))];
      return entry && Date.now() - entry.at < WEEK_DISPLAY_MEMORY_TTL_MS && entry.days[date] || null;
    }
    function weekTimelineDayActualHours(day, model, liveDaily) {
      if (!day.contextOnly) return weekDayActualHours(day.date, model.primaryRows, liveDaily);
      const remembered = rememberedWeekDisplay(day.date);
      if (remembered) return remembered.actual;
      const snapshot = calendarAdjacentSnapshots('week', state.planner.key).find(function(entry) { return day.date >= entry.range.startYmd && day.date < entry.range.endExclusiveYmd; });
      return snapshot ? weekDayActualHours(day.date, plannerItemsFromSummaryRows(snapshot.rows), null) : 0;
    }
    function weekTimelineDays(selectedDays) {
      const range = calendarSurroundingRange('week', state.planner.key);
      const byDate = {};
      selectedDays.forEach(function(day) { byDate[day.date] = day; });
      const snapshots = calendarAdjacentSnapshots('week', state.planner.key);
      const loaded = new Set(snapshots.map(function(snapshot) { return snapshot.periodKey; }));
      // 前後の週のカレンダー（予定・稼働時間）は、その週のキャッシュから出す。
      const capacityByDate = {};
      calendarNeighborKeys('week', state.planner.key).forEach(function(periodKey) {
        const capacity = typeof weekCapacityCacheKey === 'function' && state.calendarCache ? state.calendarCache[weekCapacityCacheKey(periodKey)] : null;
        (capacity && capacity.days || []).forEach(function(day) {
          if (isoWeek(parseYmd(day.date)) === periodKey) capacityByDate[day.date] = day;
        });
      });
      const result = [];
      for (let date = range.startYmd; date < range.endExclusiveYmd; date = addDaysYmd(date, 1)) {
        const remembered = byDate[date] ? null : rememberedWeekDisplay(date);
        // 直前まで中央にしていた週は、そのときの見え方をそのまま使う。
        result.push(byDate[date] || (remembered ? Object.assign({}, remembered.day, { contextOnly: true, contextLoaded: true }) : Object.assign({ date: date, events: [], baseHours: standardHoursForDate(date) }, capacityByDate[date] || {}, {
          contextOnly: true,
          contextLoaded: loaded.has(isoWeek(parseYmd(date)))
        })));
      }
      return result;
    }
    function monthTimelineDisplayData(data) {
      const snapshots = calendarAdjacentSnapshots('month', state.month.key);
      const items = mergeCalendarTimelineItems(plannerItemsFromSummaryRows(data.rows), snapshots.flatMap(calendarSnapshotItems), monthKeyRange(state.month.key));
      const dailyTotals = Object.assign({}, ...snapshots.map(function(snapshot) { return snapshot.dailyTotals || {}; }), data.dailyTotals || {});
      const calendarHoursByDate = {};
      snapshots.concat([data]).forEach(function(snapshot) {
        if (!snapshot.calendarHoursByDate) return;
        Object.assign(calendarHoursByDate, snapshot.calendarHoursByDate);
      });
      const workHoursByDate = {};
      snapshots.concat([data]).forEach(function(snapshot) {
        if (snapshot.workHoursByDate) Object.assign(workHoursByDate, snapshot.workHoursByDate);
      });
      const subtasks = (data.subtasks || []).concat(snapshots.flatMap(function(snapshot) { return snapshot.subtasks || []; }));
      return { items: items, dailyTotals: dailyTotals, calendarHoursByDate: calendarHoursByDate, workHoursByDate: workHoursByDate, subtasks: subtasks };
    }
