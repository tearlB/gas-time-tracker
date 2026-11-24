    function projectMonthForToday() {
      return periodForToday('month');
    }
    function projectIssueWeekKey(monthKey, today) {
      const key = isProjectMonthKey(monthKey) ? monthKey : projectMonthForToday();
      const now = today && typeof today.getFullYear === 'function' ? today : new Date();
      const todayMonth = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
      if (key === todayMonth) return isoWeek(now);
      let weekKey = isoWeek(parseYmd(key + '-01'));
      const monday = mondayForWeek(weekKey);
      const mondayMonth = monday.getUTCFullYear() + '-' + pad2(monday.getUTCMonth() + 1);
      if (mondayMonth !== key) weekKey = nextWeekKey(weekKey);
      return weekKey;
    }
    function shiftProjectMonthKey(key, delta) {
      const parts = String(key || projectMonthForToday()).split('-').map(Number);
      const date = new Date(parts[0], parts[1] - 1 + delta, 1);
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1);
    }
    function projectMonthLabel(key) {
      const parts = String(key || '').split('-').map(Number);
      return parts.length === 2 && parts[0] && parts[1] ? parts[0] + '年' + pad2(parts[1]) + '月' : '対象月';
    }
    function projectDateRangeLabel(project) {
      const start = project && project.startDate ? String(project.startDate).replace(/-/g, '.') : '';
      const end = project && project.endDate ? String(project.endDate).replace(/-/g, '.') : '';
      if (start && end) return start + ' — ' + end;
      if (start) return start + ' 開始';
      if (end) return end + ' まで';
      return '期間未設定';
    }
    function projectStatusLabelText(status) {
      const labels = { active: '進行中', paused: '保留', done: '完了', archived: 'アーカイブ' };
      return labels[String(status || '')] || '進行中';
    }
    function projectStatusClass(status) {
      const value = String(status || 'active');
      return labelsForProjectStatus(value) ? value : 'active';
    }
    function labelsForProjectStatus(status) {
      return { active: true, paused: true, done: true, archived: true }[String(status || '')];
    }
    function projectMonthlyStatusClass(status) {
      const value = String(status || '');
      if (value === '超過' || value === '予定未設定') return 'is-alert';
      if (value === '一致' || value === '稼働中') return 'is-ok';
      if (value === '未着手') return 'is-ahead';
      return '';
    }
    function projectIssueStatusClass(status) {
      if (String(status || '') === '超過') return 'is-alert';
      if (String(status || '') === '進行中' || String(status || '') === '稼働中') return 'is-ok';
      if (String(status || '') === '未着手') return 'is-ahead';
      return '';
    }
    function signedProjectHours(value) {
      const rounded = roundHours(value);
      return (rounded > 0 ? '+' : '') + hours(rounded);
    }
    function projectPercent(value) {
      return value == null || !isFinite(Number(value)) ? '—' : Math.round(Number(value) * 100) + '%';
    }
    function projectRemainingText(value) {
      if (value == null || value === '') return '—';
      const rounded = roundHours(value);
      return rounded < 0 ? signedProjectHours(rounded) : hours(rounded);
    }
    function projectById(id) {
      const target = String(id || '');
      return (state.projects || []).find(function(project) { return project && project.id === target; }) || null;
    }
    const DEFAULT_PROJECT_KEY = (typeof scopedStorageKey === 'function' ? scopedStorageKey('matomete-kousu-default-project') : 'matomete-kousu-default-project');
    function loadDefaultAssignedProject() {
      try { state.project.defaultProjectId = localStorage.getItem(DEFAULT_PROJECT_KEY) || ''; }
      catch (_) { state.project.defaultProjectId = state.project.defaultProjectId || ''; }
    }
    function defaultAssignedProjectId() {
      const id = String(state.project.defaultProjectId || '');
      if (!id) return '';
      const projects = Array.isArray(state.projects) ? state.projects : [];
      if (!projects.length) return id;
      const match = projects.find(function(project) { return project && project.id === id && project.status !== 'archived'; });
      return match ? id : '';
    }
    function setDefaultAssignedProject(id) {
      const next = String(id || '');
      state.project.defaultProjectId = next;
      try {
        if (next) localStorage.setItem(DEFAULT_PROJECT_KEY, next);
        else localStorage.removeItem(DEFAULT_PROJECT_KEY);
      } catch (_) {}
    }
    function syncDefaultProjectAssign() {
      const select = document.getElementById('defaultProjectAssign');
      if (!select) return;
      const projects = (Array.isArray(state.projects) ? state.projects : []).filter(function(project) {
        return project && project.status !== 'archived';
      });
      const current = defaultAssignedProjectId();
      if (projects.length && String(state.project.defaultProjectId || '') && !current) setDefaultAssignedProject('');
      select.dataset.syncing = '1';
      fillSelect(select, [{ value: '', label: '未設定' }].concat(projects.map(function(project) {
        return { value: project.id, label: project.name };
      })), current);
      const finish = function() { select.dataset.syncing = ''; };
      if (select.updateComplete && typeof select.updateComplete.then === 'function') select.updateComplete.then(finish);
      else finish();
    }
    function planDialogProjectSelection() {
      const select = document.getElementById('planDialogProject');
      if (!select) return '';
      const value = String(select.value || '');
      if (value) return value;
      const stored = String(select.dataset.projectId || '');
      if (stored) return stored;
      const option = select.querySelector('md-select-option[selected]');
      return option ? String(option.value || '') : '';
    }
    function syncPlanDialogProjects(selectedId) {
      const select = document.getElementById('planDialogProject');
      if (!select) return;
      const current = selectedId == null ? planDialogProjectSelection() : String(selectedId || '');
      const projects = (Array.isArray(state.projects) ? state.projects : []).filter(function(project) {
        return project && (project.status !== 'archived' || project.id === current);
      });
      const chosen = projects.some(function(project) { return project.id === current; }) ? current : '';
      fillSelect(select, [{ value: '', label: 'プロジェクト未設定' }].concat(projects.map(function(project) {
        return { value: project.id, label: project.name + (project.statusLabel ? '（' + project.statusLabel + '）' : '') };
      })), chosen);
      const hint = document.getElementById('planDialogProjectHint');
      if (hint) hint.textContent = chosen
        ? 'この予定の実績を、選んだプロジェクトの月次に集計します。'
        : 'プロジェクトを選ばないと、この予定の実績はプロジェクトに集計されません。';
    }
    function ensureProjectCatalog() {
      if (state.project.catalogLoaded) return Promise.resolve(state.projects || []);
      if (state.project.catalogPromise) return state.project.catalogPromise;
      const pending = gas('loadProjectCatalog').then(function(projects) {
        state.project.catalogLoaded = true;
        state.projects = Array.isArray(projects) ? projects : [];
        syncPlanDialogProjects();
        if (state.view === 'daily' && !state.daily.dirty && !state.daily.busy && !state.daily.saving && state.daily.loadedDate === state.daily.date) renderDaily();
        // 週の予定の行は、1段目にプロジェクト名を出す。一覧が読めたら、週も描き直す。
        if (state.view === 'planning' && typeof scheduleCalendarTimelineRender === 'function') scheduleCalendarTimelineRender('week');
        return state.projects;
      }).catch(function() {
        state.projects = state.projects || [];
        syncPlanDialogProjects();
        return state.projects;
      }).finally(function() {
        if (state.project.catalogPromise === pending) state.project.catalogPromise = null;
      });
      state.project.catalogPromise = pending;
      return pending;
    }
    function renderProjectStorage(storage) {
      // 保存先の情報がないとき（読み込み中）は、前回の状態を使う。なければ案内を出さずに待つ。
      if (!storage && typeof readCachedStorageStatus === 'function') storage = state.storage || readCachedStorageStatus();
      if (!storage) {
        const waiting = document.getElementById('projectStorageNotice');
        if (waiting) waiting.hidden = true;
        return;
      }
      const current = storage;
      state.storage = current;
      const configured = !!current.configured;
      const notice = document.getElementById('projectStorageNotice');
      if (notice) notice.hidden = configured;
      const configure = document.getElementById('configureStorageProjects');
      if (configure) configure.textContent = configured ? '保存先を変更' : '保存先を設定';
      const add = document.getElementById('addProject');
      if (add) add.disabled = false;
    }
    function projectWorkspaceFallback(monthKey, message) {
      return {
        monthKey: monthKey,
        projects: [],
        totals: { plannedHours: 0, actualHours: 0, varianceHours: 0, onePersonMonthHours: 0, unallocatedHours: 0, plannedShareRate: null, actualShareRate: null, consumptionRate: null, projectCount: 0, activeCount: 0, alertCount: 0 },
        capacity: { availableHours: 0, baseHours: 0, meetingHours: 0, calendarAvailable: false },
        storage: state.storage,
        error: message || ''
      };
    }
    function parseProjectMonthHours(input, monthHours) {
      const raw = String(input == null ? '' : input).trim().replace(/　/g, ' ').replace(/％/g, '%').replace(/／/g, '/').replace(/×/g, '*');
      if (!raw) return { ok: true, hours: 0, share: null, linked: false, formula: '' };
      const month = Number(monthHours);
      const monthOk = isFinite(month) && month > 0;
      function fromShare(share) {
        if (!isFinite(month) || month < 0) return { ok: false, error: '割合の基準時間が不正です' };
        if (!isFinite(share) || share < 0) return { ok: false, error: '割合が不正です' };
        const computed = roundHours(month * share);
        if (computed > 744) return { ok: false, error: '予定稼働時間は744時間以下にしてください' };
        return { ok: true, hours: computed, share: share, linked: true, formula: raw };
      }
      let match = raw.match(/^(?:月の|1人月の)?\s*(\d+(?:\.\d+)?)\s*%$/);
      if (match) return fromShare(Number(match[1]) / 100);
      match = raw.match(/^(?:月の|1人月の)?\s*(\d+(?:\.\d+)?)\s*割$/);
      if (match) return fromShare(Number(match[1]) / 10);
      match = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
      if (match) {
        const denominator = Number(match[2]);
        if (!(denominator > 0)) return { ok: false, error: '割合が不正です' };
        return fromShare(Number(match[1]) / denominator);
      }
      match = raw.match(/^(?:\*|月\s*\*|1人月\s*\*)\s*(\d+(?:\.\d+)?)$/);
      if (match) return fromShare(Number(match[1]));
      match = raw.match(/^(\d+(?:\.\d+)?)\s*h?$/i);
      if (match) {
        const direct = roundHours(Number(match[1]));
        if (direct < 0 || direct > 744) return { ok: false, error: '予定稼働時間は0〜744時間で入力してください' };
        return { ok: true, hours: direct, share: monthOk ? direct / month : null, linked: false, formula: '' };
      }
      return { ok: false, error: '時間（80）、割合（50%、3割、1/2）、または *0.5 で入力してください' };
    }
    function parseProjectMonthPlan(input, monthHours, mode) {
      if (mode === 'share') {
        const raw = String(input == null ? '' : input).trim();
        if (!raw) return { ok: true, hours: 0, share: null, linked: true, formula: '' };
        if (/^\d+(?:\.\d+)?$/.test(raw.replace(/％/g, '%'))) return parseProjectMonthHours(raw + '%', monthHours);
        const parsed = parseProjectMonthHours(raw, monthHours);
        if (parsed.ok && !parsed.linked) return { ok: false, error: '割合は 50 または 50% で入力してください' };
        return parsed;
      }
      const parsed = parseProjectMonthHours(input, monthHours);
      if (parsed.ok && parsed.linked) return { ok: false, error: '固定では時間を入力してください' };
      return parsed;
    }
    function projectMonthModeOf(project) {
      return project && project.plannedShareText ? 'share' : 'hours';
    }
    function projectMonthFieldValue(project) {
      if (project && project.plannedShareText) {
        const basis = Number(project.onePersonMonthHours) > 0 ? project.onePersonMonthHours : 160;
        const parsed = parseProjectMonthHours(project.plannedShareText, basis);
        if (parsed.ok && parsed.share != null) {
          const pct = Math.round(parsed.share * 1000) / 10;
          return pct % 1 === 0 ? String(pct) : pct.toFixed(1);
        }
        return project.plannedShareText;
      }
      return project && project.hasMonthlyPlan ? hours(project.plannedHours) : '';
    }
    function projectShareBasisHours(project) {
      // 割合は、月の稼働時間から固定時間のプロジェクトを引いた残りに対する割合。
      const basis = project && project.shareBasisHours != null ? project.shareBasisHours : project && project.onePersonMonthHours;
      return Math.max(0, roundHours(Number(basis || 0)));
    }
    function projectMonthPreviewText(input, monthHours, mode) {
      const month = Number(monthHours);
      const monthOk = isFinite(month) && month > 0;
      const shareMode = mode === 'share';
      if (!String(input == null ? '' : input).trim()) {
        if (shareMode) return '固定を除いた稼働 ' + compactHours(month) + 'h に対する割合を入れます（50 なら ' + compactHours(roundHours(month * 0.5)) + 'h）';
        return '月の合計が変わっても、この時間のままです';
      }
      const parsed = parseProjectMonthPlan(input, monthHours, shareMode ? 'share' : 'hours');
      if (!parsed.ok) return parsed.error;
      if (!shareMode) return hours(parsed.hours) + 'h。月の合計が変わっても、この時間のままです';
      // 計算の中身がひと目で分かるよう、式をそのまま出す。
      const percent = Math.round(parsed.share * 1000) / 10;
      return '固定を除いた稼働 ' + compactHours(month) + 'h × ' + percent + '% ＝ ' + compactHours(parsed.hours) + 'h。固定時間を変えると、この時間も変わります';
    }
    function projectMonthCardMode(card) {
      const box = card && card.querySelector('.project-month-hours');
      return box && box.dataset.monthMode === 'share' ? 'share' : 'hours';
    }
    function updateProjectMonthHoursPreview(card) {
      if (!card) return;
      const input = card.querySelector('[data-project-month-hours]');
      const preview = card.querySelector('[data-project-month-preview]');
      if (!input || !preview) return;
      const project = projectById(card.dataset.projectId);
      const mode = projectMonthCardMode(card);
      const month = projectShareBasisHours(project, mode);
      preview.textContent = projectMonthPreviewText(input.value, month, mode);
      preview.classList.toggle('is-error', !parseProjectMonthPlan(input.value, month, mode).ok);
    }
    function setProjectMonthMode(button) {
      const card = button && button.closest('.project-card');
      const box = card && card.querySelector('.project-month-hours');
      const input = card && card.querySelector('[data-project-month-hours]');
      if (!card || !box || !input) return;
      const next = button.dataset.monthMode === 'share' ? 'share' : 'hours';
      const previous = projectMonthCardMode(card);
      if (next === previous) { setUiChoice(button, true); return; }
      const project = projectById(card.dataset.projectId);
      const month = projectShareBasisHours(project, previous);
      const nextBasis = projectShareBasisHours(project, next);
      const parsed = parseProjectMonthPlan(input.value, month, previous);
      box.dataset.monthMode = next;
      Array.prototype.forEach.call(box.querySelectorAll('[data-project-action="month-mode"]'), function(item) {
        setUiChoice(item, item.dataset.monthMode === next);
      });
      if (parsed.ok && String(input.value || '').trim()) {
        if (next === 'share' && nextBasis > 0) {
          const pct = Math.round((parsed.hours / nextBasis) * 1000) / 10;
          input.value = pct % 1 === 0 ? String(pct) : pct.toFixed(1);
        } else if (next === 'share') {
          input.value = '0';
        } else if (next === 'hours') {
          input.value = hours(parsed.hours);
        }
      }
      input.label = next === 'share' ? '固定を除いた稼働に対する割合（%）' : '予定稼働（時間）';
      input.placeholder = next === 'share' ? '50' : '80';
      input.classList.add('is-dirty');
      updateProjectMonthHoursPreview(card);
      scheduleProjectMonthAutoSave();
    }
    function projectIssuePeriodText(issue) {
      const prefix = issue && issue.periodType === 'month' ? '月 ' : '週 ';
      const keys = issue && Array.isArray(issue.periodKeys) && issue.periodKeys.length ? issue.periodKeys : [issue && issue.periodKey];
      return prefix + keys.filter(Boolean).join('、');
    }
    function projectIssuesOpen(projectId) {
      const open = state.project.openIssueIds;
      return !!(open && open[projectId]);
    }
    function toggleProjectIssues(projectId) {
      const id = String(projectId || '');
      if (!id) return;
      const openIssueIds = state.project.openIssueIds || (state.project.openIssueIds = {});
      openIssueIds[id] = !openIssueIds[id];
      const cards = document.querySelectorAll('.project-card');
      let card = null;
      for (let i = 0; i < cards.length; i++) {
        if (cards[i].dataset.projectId === id) { card = cards[i]; break; }
      }
      if (!card) return;
      const open = !!openIssueIds[id];
      const box = card.querySelector('.project-issues');
      const body = card.querySelector('.project-issues-body');
      const button = card.querySelector('.project-issues-toggle');
      const icon = button && button.querySelector('.material-symbols-outlined');
      if (box) box.classList.toggle('is-open', open);
      if (body) body.hidden = !open;
      if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (icon) icon.textContent = open ? 'expand_more' : 'chevron_right';
    }
    function projectCardHtml(project) {
        const monthlyStatus = project.monthlyStatus || '未設定';
        const monthlyClass = projectMonthlyStatusClass(monthlyStatus);
        const issues = project.issues || [];
        const issueHtml = issues.length
          ? '<ul class="project-issue-list">' + issues.map(function(issue) {
              const period = projectIssuePeriodText(issue);
              const issueStatus = issue.status || '未着手';
              return '<li class="project-issue-row">' +
                '<div class="project-issue-name"><strong>' + escapeHtml(issue.name || '名称未入力') + '</strong><small>' + escapeHtml(period) + (issue.note ? ' · ' + escapeHtml(issue.note) : '') + '</small></div>' +
                '<span class="project-issue-hours">' + (roundHours(issue.plannedHours) > 0 ? '予定 ' + hours(issue.plannedHours) + 'h' : '予定なし') + '</span>' +
                '<span class="project-issue-hours">実績 ' + hours(issue.actualHours) + 'h</span>' +
                '<span class="project-issue-status weekly-status ' + projectIssueStatusClass(issueStatus) + '">' + escapeHtml(issueStatus) + '</span>' +
              '</li>';
            }).join('') + '</ul>'
          : '<p class="project-empty-issues">この月に紐づいた課題はありません。「課題を登録」から予定を追加できます。</p>';
        return '<article class="project-card' + (monthlyStatus === '超過' || (project.hasMonthlyPlan && roundHours(project.remainingHours) < 0) ? ' is-over' : '') + '" data-project-id="' + escapeHtml(project.id) + '">' +
          '<div class="project-card-head"><div class="project-card-copy"><div class="project-card-title"><h3>' + escapeHtml(project.name) + '</h3><span class="project-status is-' + projectStatusClass(project.status) + '">' + escapeHtml(project.statusLabel || projectStatusLabelText(project.status)) + '</span><span class="weekly-status ' + monthlyClass + '">' + escapeHtml(monthlyStatus) + '</span></div>' +
            (project.description ? '<p>' + escapeHtml(project.description) + '</p>' : '') + '<div class="project-meta"><span>' + escapeHtml(projectDateRangeLabel(project)) + '</span><span>課題 ' + issues.length + '件</span></div></div>' +
            '<div class="project-card-actions"><md-filled-button class="primary-button" type="button" data-project-action="issue" data-project-id="' + escapeHtml(project.id) + '">課題を登録</md-filled-button><md-outlined-button class="ghost-button" type="button" data-project-action="edit" data-project-id="' + escapeHtml(project.id) + '">編集</md-outlined-button></div></div>' +
          '<div class="project-metrics">' +
            projectMetricHtml('予定稼働', hours(project.plannedHours), 'h') +
            projectMetricHtml('課題の予定', hours(project.taskPlannedHours), 'h') +
            projectMetricHtml('実績', hours(project.actualHours), 'h') +
            projectMetricHtml('予定の残り', projectRemainingText(project.hasMonthlyPlan ? project.remainingHours : null), 'h', project.hasMonthlyPlan && roundHours(project.remainingHours) < 0 ? 'is-alert' : '') +
          '</div>' +
          '<details class="project-month-settings"' + ((state.project.openSettings || {})[project.id] ? ' open' : '') + '><summary>月次設定・稼働状況を編集</summary><div class="project-month-editor"><div class="project-month-hours" data-month-mode="' + projectMonthModeOf(project) + '" data-original-mode="' + projectMonthModeOf(project) + '"><div class="project-month-field-heading"><span>予定稼働</span>' + choiceGroupHtml({ className: 'project-month-mode', label: '予定稼働の決め方', selected: projectMonthModeOf(project), items: [
            { value: 'hours', label: '固定', attributes: { 'data-project-action': 'month-mode', 'data-month-mode': 'hours', 'data-project-id': project.id } },
            { value: 'share', label: '割合', attributes: { 'data-project-action': 'month-mode', 'data-month-mode': 'share', 'data-project-id': project.id } }
          ] }) + '</div><md-outlined-text-field class="field" label="' + (projectMonthModeOf(project) === 'share' ? '固定を除いた稼働に対する割合（%）' : '予定稼働（時間）') + '" data-project-month-hours data-original="' + escapeHtml(projectMonthFieldValue(project)) + '" value="' + escapeHtml(projectMonthFieldValue(project)) + '" placeholder="' + (projectMonthModeOf(project) === 'share' ? '50' : '80') + '"></md-outlined-text-field><p class="project-month-preview" data-project-month-preview>' + escapeHtml(projectMonthPreviewText(projectMonthFieldValue(project), projectShareBasisHours(project, projectMonthModeOf(project)), projectMonthModeOf(project))) + '</p></div><div class="project-month-note"><div class="project-month-field-heading"><span>稼働状況</span></div><md-outlined-text-field class="field" label="稼働状況の説明" type="textarea" rows="2" maxlength="2000" data-project-status-note data-original="' + escapeHtml(project.statusNote || '') + '" value="' + escapeHtml(project.statusNote || '') + '"></md-outlined-text-field></div></div></details>' +
          '<div class="project-issues' + (projectIssuesOpen(project.id) ? ' is-open' : '') + '"><button class="project-issues-toggle" type="button" data-project-action="toggle-issues" data-project-id="' + escapeHtml(project.id) + '" aria-expanded="' + (projectIssuesOpen(project.id) ? 'true' : 'false') + '"><span class="material-symbols-outlined" aria-hidden="true">' + (projectIssuesOpen(project.id) ? 'expand_more' : 'chevron_right') + '</span><h4>この月の課題</h4><span class="project-issues-count">' + issues.length + '件</span></button><div class="project-issues-body"' + (projectIssuesOpen(project.id) ? '' : ' hidden') + '>' + issueHtml + '</div></div>' +
        '</article>';
    }
    function renderProjectScreen() {
      const workspace = state.project.workspace || projectWorkspaceFallback(state.project.monthKey);
      const monthKey = workspace.monthKey || state.project.monthKey || projectMonthForToday();
      state.project.monthKey = monthKey;
      const totals = workspace.totals || {};
      const projects = Array.isArray(workspace.projects) ? workspace.projects : [];
      if (state.view === 'projects') syncCalendarControl();
      document.getElementById('projectMonthHeading').textContent = projectMonthLabel(monthKey) + 'のプロジェクト';
      const capacityHours = roundHours(totals.onePersonMonthHours || 0);
      const unallocatedHours = roundHours(totals.unallocatedHours == null ? capacityHours - roundHours(totals.plannedHours) : totals.unallocatedHours);
      const capacityMeta = document.getElementById('projectCapacityMeta');
      document.getElementById('projectCapacityHours').textContent = hours(capacityHours);
      if (capacityMeta) capacityMeta.textContent = workspace.capacity && workspace.capacity.calendarAvailable === false
        ? '稼働可能時間（カレンダー未取得）'
        : '稼働可能時間の合計';
      document.getElementById('projectPlanHours').textContent = hours(totals.plannedHours);
      document.getElementById('projectPlanMeta').textContent = '1人月の配分 ' + projectPercent(totals.plannedShareRate);
      document.getElementById('projectActualHours').textContent = hours(totals.actualHours);
      document.getElementById('projectConsumeMeta').textContent = '1人月の使用 ' + projectPercent(totals.actualShareRate);
      document.getElementById('projectUnallocatedHours').textContent = projectRemainingText(unallocatedHours);
      document.getElementById('projectUnallocatedMeta').textContent = unallocatedHours < 0
        ? 'プロジェクト予定が1人月を超過'
        : '1人月 − プロジェクト予定';
      const unallocatedCard = document.getElementById('projectUnallocatedCard');
      if (unallocatedCard) unallocatedCard.classList.toggle('is-alert', unallocatedHours < 0);
      const statusSummary = document.getElementById('projectStatusSummary');
      const statusMeta = document.getElementById('projectStatusMeta');
      const alertCount = Number(totals.alertCount || 0);
      if (statusSummary) statusSummary.textContent = alertCount ? '要確認' : totals.activeCount ? '稼働中' : '—';
      if (statusMeta) statusMeta.textContent = '稼働中 ' + Number(totals.activeCount || 0) + ' · 要確認 ' + alertCount;
      renderProjectStorage(workspace.storage || state.storage);
      const list = document.getElementById('projectList');
      state.project.openSettings = state.project.openSettings || {};
      list.querySelectorAll('.project-card').forEach(function(card) {
        const settings = card.querySelector('.project-month-settings');
        if (settings) state.project.openSettings[card.dataset.projectId] = settings.open;
      });
      if (!projects.length) {
        list.innerHTML = workspace.error
          ? emptyStateHtml('プロジェクトを読み込めませんでした', workspace.error)
          : emptyStateHtml('プロジェクトを登録してください', '登録したプロジェクトに予定画面の課題を紐づけると、月次の稼働状況を確認できます。');
        syncDefaultProjectAssign();
        syncPlanDialogProjects();
        updateSaveDock();
        return;
      }
      list.innerHTML = projects.map(projectCardHtml).join('');
      syncDefaultProjectAssign();
      syncPlanDialogProjects();
      updateSaveDock();
    }
    function presentProjectSnapshot(monthKey, workspace) {
      state.project.workspace = workspace || projectWorkspaceFallback(monthKey);
      state.project.catalogLoaded = true;
      state.projects = state.project.workspace.projects || [];
      state.project.paintedDigest = navigationDigest(state.project.workspace);
      renderProjectScreen();
    }
    function projectRefreshIsHeld() {
      const dialog = document.getElementById('projectDialog');
      if (appDialogIsOpen(dialog)) return true;
      return state.project.monthSaving || projectMonthEditorsDirty() || navigationViewHoldsFocus('projectsView');
    }
    async function loadProjectBlocking(monthKey, token, force) {
      try {
        const workspace = (!force && state.projectCache[monthKey]) || await gas('loadProjectWorkspace', monthKey);
        if (state.nav.project !== token || state.project.monthKey !== monthKey) return;
        refreshGoogleTasksSyncPreference().catch(function() {});
        if (state.nav.project !== token || state.project.monthKey !== monthKey) return;
        rememberProjectSnapshot(monthKey, workspace || projectWorkspaceFallback(monthKey));
        presentProjectSnapshot(monthKey, state.projectCache[monthKey]);
      } catch (error) {
        if (state.nav.project !== token || state.project.monthKey !== monthKey) return;
        state.project.workspace = projectWorkspaceFallback(monthKey, error.message);
        state.project.catalogLoaded = false;
        renderProjectScreen();
        toast('プロジェクトの読み込みに失敗しました: ' + error.message, 'error');
      }
    }
    async function refreshProjectFromServer(monthKey, token) {
      const workspace = await gas('loadProjectWorkspace', monthKey);
      if (state.nav.project !== token) return;
      rememberProjectSnapshot(monthKey, workspace);
      if (!navigationRefreshIsCurrent(token, state.nav.project, state.project.monthKey === monthKey, false)) return;
      if (projectRefreshIsHeld()) return;
      const digest = navigationDigest(workspace);
      if (digest === state.project.paintedDigest) return;
      presentProjectSnapshot(monthKey, workspace);
    }
    async function prefetchProjectSnapshot(monthKey) {
      if (!isProjectMonthKey(monthKey) || state.projectCache[monthKey]) return;
      const startedAt = Date.now();
      try {
        const workspace = await gas('loadProjectWorkspace', monthKey);
        if ((state.projectFetchedAt[monthKey] || 0) >= startedAt) return;
        if (workspace) rememberProjectSnapshot(monthKey, workspace);
      } catch (_) {}
    }
    async function loadProjectScreen(options) {
      options = options || {};
      if (state.project.saving && !options.duringSave) return;
      const monthKey = isProjectMonthKey(state.project.monthKey) ? state.project.monthKey : projectMonthForToday();
      state.project.monthKey = monthKey;
      persistViewState();
      return runScreenLoad({
        hasSnapshot: function() { return !!state.projectCache[monthKey]; },
        options: {
          force: !!options.force,
          refresh: options.refresh,
          recent: snapshotIsRecent(state.projectFetchedAt[monthKey])
        },
        silent: !!options.silent,
        isBusy: function() { return state.project.busy && state.project.loadingKey === monthKey; },
        markBusy: function(busy) {
          if (busy) {
            state.project.busy = true;
            state.project.loadingKey = monthKey;
            return;
          }
          if (state.project.loadingKey === monthKey) {
            state.project.busy = false;
            state.project.loadingKey = '';
          }
        },
        showBusy: function() { showBusy('プロジェクトを読み込んでいます…'); },
        hideBusy: hideBusy,
        paintCached: function() { presentProjectSnapshot(monthKey, state.projectCache[monthKey]); },
        beginRefresh: function() { return ++state.nav.project; },
        refresh: function(token) { return refreshProjectFromServer(monthKey, token); },
        onRefreshError: function(error) {
          if (!state.projectCache[monthKey]) toast('プロジェクトの読み込みに失敗しました: ' + error.message, 'error');
        },
        loadBlocking: function() { return loadProjectBlocking(monthKey, ++state.nav.project, !!options.force); }
      });
    }
    function projectMonthEditorsDirty() {
      return dirtyProjectMonthCards().length > 0;
    }
    async function confirmProjectMonthNavigation() {
      return !projectMonthEditorsDirty() || confirmLeaveUnsaved('月を移動');
    }
    async function selectProjectMonth(monthKey) {
      if (!isProjectMonthKey(monthKey) || !await confirmProjectMonthNavigation()) return;
      state.project.monthKey = monthKey;
      syncCalendarControl();
      await loadProjectScreen();
    }
    function changeProjectMonth(delta) {
      if (state.project.busy) return;
      selectProjectMonth(shiftProjectMonthKey(state.project.monthKey || projectMonthForToday(), delta));
    }
    async function openProjectsView(monthKey) {
      if (state.view === 'daily' && dailyNeedsLeaveConfirm() && !await confirmLeaveUnsaved('プロジェクト画面へ移動')) return;
      if (state.view === 'planning' && unsavedNeedsLeaveConfirm() && !await confirmLeaveUnsaved('プロジェクト画面へ移動')) return;
      const nextMonth = isProjectMonthKey(monthKey) ? monthKey : (state.project.monthKey || projectMonthForToday());
      state.view = 'projects';
      state.calendarMode = 'week';
      state.project.monthKey = nextMonth;
      applyViewVisibility();
      syncNav();
      updateSaveDock();
      persistViewState();
      await loadProjectScreen();
    }
    function openProjectDialog(projectIdValue) {
      const id = String(projectIdValue || '');
      const project = id ? projectById(id) : null;
      if (id && !project) {
        ensureProjectCatalog().then(function() { if (projectById(id)) openProjectDialog(id); });
        return;
      }
      state.project.editingId = project ? project.id : '';
      document.getElementById('projectDialogTitle').textContent = project ? 'プロジェクトを編集' : 'プロジェクトを登録';
      document.getElementById('projectDialogName').value = project ? project.name : '';
      document.getElementById('projectDialogStatus').value = project ? (project.status || 'active') : 'active';
      document.getElementById('projectDialogStartDate').value = project ? (project.startDate || '') : '';
      document.getElementById('projectDialogEndDate').value = project ? (project.endDate || '') : '';
      document.getElementById('projectDialogDescription').value = project ? (project.description || '') : '';
      document.getElementById('commitProjectDialog').textContent = project ? '更新' : '登録';
      showAppDialog(document.getElementById('projectDialog'));
      document.getElementById('projectDialogName').focus();
      ensureProjectCatalog();
    }
    function closeProjectDialog() {
      hideAppDialog(document.getElementById('projectDialog'));
      state.project.editingId = '';
      state.project.saving = false;
    }
    async function commitProjectDialog() {
      if (state.project.saving) return;
      const name = document.getElementById('projectDialogName').value.trim();
      if (!name) return toast('プロジェクト名を入力してください', 'error');
      if (!state.storage || !state.storage.configured) {
        openPlanningSetup();
        return toast('プロジェクトを保存する前にDriveの保存先を設定してください');
      }
      if (!(await ensureAnnualStorageYear(Number(state.storage.currentYear || new Date().getFullYear())))) return;
      const button = document.getElementById('commitProjectDialog');
      state.project.saving = true;
      button.disabled = true;
      showBusy('プロジェクトを保存しています…');
      state.nav.project += 1;
      try {
        await gas('saveProject', {
          id: state.project.editingId || '',
          name: name,
          status: document.getElementById('projectDialogStatus').value,
          startDate: document.getElementById('projectDialogStartDate').value || '',
          endDate: document.getElementById('projectDialogEndDate').value || '',
          description: document.getElementById('projectDialogDescription').value.trim()
        });
        const workspace = await gas('loadProjectWorkspace', state.project.monthKey || projectMonthForToday());
        rememberProjectSnapshot(workspace.monthKey || state.project.monthKey, workspace);
        state.project.workspace = workspace;
        state.project.monthKey = workspace.monthKey || state.project.monthKey;
        state.project.catalogLoaded = true;
        state.projects = workspace.projects || [];
        closeProjectDialog();
        renderProjectScreen();
        scheduleAutoGoogleTasksSync(googleTasksSyncMonthKey());
        toast('プロジェクトを保存しました', 'success');
      } catch (error) {
        toast('プロジェクトの保存に失敗しました: ' + error.message, 'error');
      } finally {
        state.project.saving = false;
        button.disabled = false;
        hideBusy();
      }
    }
    // 月次設定はカードごとに data-original と比べて未保存を判定し、入力が止まったら自動保存する。
    function projectMonthCardValues(card) {
      const hoursInput = card && card.querySelector('[data-project-month-hours]');
      const noteInput = card && card.querySelector('[data-project-status-note]');
      return {
        hours: hoursInput ? String(hoursInput.value || '') : '',
        note: noteInput ? String(noteInput.value || '') : '',
        mode: projectMonthCardMode(card)
      };
    }
    function projectMonthCardDirty(card) {
      const box = card && card.querySelector('.project-month-hours');
      if (box && box.dataset.originalMode && box.dataset.originalMode !== projectMonthCardMode(card)) return true;
      return Array.from(card ? card.querySelectorAll('.project-month-editor .field[data-original]') : []).some(function(field) {
        return String(field.value || '') !== String(field.dataset.original || '');
      });
    }
    function dirtyProjectMonthCards() {
      return Array.from(document.querySelectorAll('#projectList .project-card')).filter(projectMonthCardDirty);
    }
    function projectMonthCardEntry(card) {
      const project = projectById(card.dataset.projectId);
      const values = projectMonthCardValues(card);
      return {
        card: card,
        project: project,
        values: values,
        parsed: project ? parseProjectMonthPlan(values.hours, projectShareBasisHours(project, values.mode), values.mode) : { ok: false, error: 'プロジェクトが見つかりません' }
      };
    }
    function projectMonthInvalidEntry() {
      return dirtyProjectMonthCards().map(projectMonthCardEntry).find(function(entry) { return !entry.parsed.ok; }) || null;
    }
    function projectMonthYearNeedsFile(monthKey) {
      const storage = state.storage;
      return !!(storage && storage.configured && storage.annual && (storage.years || []).indexOf(Number(String(monthKey || '').slice(0, 4))) < 0);
    }
    function markProjectMonthCardSaved(entry) {
      const card = entry.card;
      if (!card || !card.isConnected) return;
      const current = projectMonthCardValues(card);
      if (current.hours !== entry.values.hours || current.note !== entry.values.note || current.mode !== entry.values.mode) return;
      const box = card.querySelector('.project-month-hours');
      if (box) box.dataset.originalMode = entry.values.mode;
      Array.prototype.forEach.call(card.querySelectorAll('.project-month-editor .field[data-original]'), function(field) {
        field.dataset.original = String(field.value || '');
        field.classList.remove('is-dirty');
      });
    }
    function projectMonthEditorHoldsFocus() {
      const active = document.activeElement;
      return !!(active && active.closest && active.closest('#projectList .project-month-editor'));
    }
    function renderPendingProjectWorkspace() {
      if (!state.project.renderPending || state.project.monthSaving) return;
      if (projectMonthEditorsDirty() || projectMonthEditorHoldsFocus()) return;
      state.project.renderPending = false;
      renderProjectScreen();
    }
    function cancelProjectMonthAutoSave() {
      if (state.project.autoSaveTimer) clearTimeout(state.project.autoSaveTimer);
      state.project.autoSaveTimer = null;
    }
    function scheduleProjectMonthAutoSave(delayMs) {
      cancelProjectMonthAutoSave();
      updateSaveDock();
      if (!state.storage || !state.storage.configured || projectMonthYearNeedsFile(state.project.monthKey)) return;
      if (!dirtyProjectMonthCards().some(function(card) { return projectMonthCardEntry(card).parsed.ok; })) return;
      state.project.autoSaveTimer = setTimeout(function() {
        state.project.autoSaveTimer = null;
        saveProjectMonthEditors({ auto: true });
      }, delayMs == null ? AUTO_SAVE_DELAY_MS : delayMs);
    }
    async function saveProjectMonthEditors(options) {
      options = options || {};
      const auto = !!options.auto;
      cancelProjectMonthAutoSave();
      if (state.project.monthSaving) { state.project.monthSaveQueued = true; return; }
      const monthKey = state.project.monthKey || projectMonthForToday();
      const entries = dirtyProjectMonthCards().map(projectMonthCardEntry);
      if (!entries.length) {
        if (!auto) toast('保存する変更はありません');
        updateSaveDock();
        return;
      }
      if (!state.storage || !state.storage.configured) {
        if (!auto) {
          openPlanningSetup();
          toast('月次設定を保存する前にDriveの保存先を設定してください');
        }
        return;
      }
      const invalid = entries.find(function(entry) { return !entry.parsed.ok; });
      if (invalid && !auto) toast(invalid.parsed.error, 'error');
      const valid = entries.filter(function(entry) { return entry.parsed.ok; });
      if (!valid.length) { updateSaveDock(); return; }
      if (auto && projectMonthYearNeedsFile(monthKey)) { updateSaveDock(); return; }
      if (!auto && !(await ensureAnnualStorageYear(Number(monthKey.slice(0, 4))))) return;
      state.project.monthSaving = true;
      state.project.monthSaveQueued = false;
      state.nav.project += 1;
      updateSaveDock();
      let failed = null;
      let savedCount = 0;
      try {
        for (let i = 0; i < valid.length; i++) {
          const entry = valid[i];
          await gas('saveProjectMonthly', {
            projectId: entry.project.id,
            monthKey: monthKey,
            plannedHours: entry.parsed.hours,
            plannedShareText: entry.parsed.linked ? entry.parsed.formula : '',
            statusNote: entry.values.note.trim()
          });
          savedCount += 1;
          markProjectMonthCardSaved(entry);
        }
      } catch (error) {
        failed = error;
      }
      if (savedCount && state.project.monthKey === monthKey) {
        try {
          const workspace = await gas('loadProjectWorkspace', monthKey);
          rememberProjectSnapshot(monthKey, workspace);
          if (state.project.monthKey === monthKey && state.view === 'projects') {
            state.project.workspace = workspace;
            state.projects = workspace.projects || [];
            state.project.paintedDigest = navigationDigest(workspace);
            state.project.renderPending = true;
          }
        } catch (_) {}
      }
      state.project.monthSaving = false;
      if (failed) {
        state.project.autoSaveRetryCount = auto ? Math.min(8, (state.project.autoSaveRetryCount || 0) + 1) : 0;
        toast((auto ? '自動保存に失敗しました: ' : '月次設定の保存に失敗しました: ') + failed.message, 'error');
      } else {
        state.project.autoSaveRetryCount = 0;
        if (!auto) toast('月次設定を保存しました', 'success');
      }
      if (savedCount) scheduleAutoGoogleTasksSync(monthKey);
      renderPendingProjectWorkspace();
      if (state.project.monthSaveQueued || dirtyProjectMonthCards().length) {
        scheduleProjectMonthAutoSave(failed && state.project.autoSaveRetryCount ? autoSaveRetryDelay(state.project.autoSaveRetryCount) : undefined);
      }
      updateSaveDock();
    }
