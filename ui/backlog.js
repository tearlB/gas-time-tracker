    const backlogImport = { issues: [], selected: new Set(), offset: 0, hasMore: false, busy: false, error: '', weekKey: '', request: 0 };
    const backlogConnection = { request: 0, editRevision: 0, dirty: false, busy: false, configured: false, keyStored: false };
    // 保存済みを示す固定の伏せ字。実際のAPIキーは取得せず、この値を送信しない。
    const BACKLOG_STORED_KEY_MASK = '********';
    function normalizeBacklogSpaceInput() {
      const field = document.getElementById('backlogSpaceUrl');
      const value = String(field.value || '').trim();
      const match = /^(https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:backlog\.(?:jp|com)|backlogtool\.com))(?=[/?#]|$)/i.exec(value);
      field.value = match ? match[1].toLowerCase() : value;
      return field.value;
    }
    function setBacklogConnectionBusy(busy) {
      backlogConnection.busy = busy;
      ['backlogSpaceUrl', 'backlogApiKey', 'saveBacklogSettings', 'editBacklogApiKey', 'cancelBacklogApiKeyEdit'].forEach(function(id) {
        document.getElementById(id).disabled = busy;
      });
      document.getElementById('clearBacklogSettings').disabled = busy || !backlogConnection.configured;
    }
    function renderBacklogSettings(settings, options) {
      options = options || {};
      const space = document.getElementById('backlogSpaceUrl');
      const key = document.getElementById('backlogApiKey');
      if (options.updateSpace !== false) space.value = settings.spaceUrl || '';
      if (options.resetKeyDisplay || (!backlogConnection.dirty && !key.value)) {
        backlogConnection.keyStored = !!settings.hasApiKey;
        key.value = settings.hasApiKey ? BACKLOG_STORED_KEY_MASK : '';
        key.readOnly = !!settings.hasApiKey;
      }
      key.placeholder = settings.hasApiKey ? '登録済み（変更するときだけ入力）' : 'APIキー';
      key.supportingText = settings.hasApiKey
        ? settings.pending ? '入力したキーを保存済み（接続確認待ち）' : '登録済み。変更する場合は「APIキーを変更」を押してください。'
        : '';
      if (options.resetKeyDisplay) backlogConnection.editingKey = false;
      document.getElementById('editBacklogApiKey').hidden = !backlogConnection.keyStored || !!backlogConnection.editingKey;
      document.getElementById('cancelBacklogApiKeyEdit').hidden = !backlogConnection.editingKey;
      backlogConnection.configured = !!settings.configured || !!settings.pending;
      const authorization = document.getElementById('authorizeBacklog');
      authorization.hidden = !settings.authorizationRequired || !settings.authorizationUrl;
      if (!authorization.hidden) authorization.href = settings.authorizationUrl;
      else authorization.removeAttribute('href');
      document.getElementById('backlogConnectionStatus').textContent = settings.authorizationRequired
        ? 'Google側で外部接続の許可が必要です。上のリンクから許可したあと、もう一度「接続を確認して保存」を押してください。'
        : settings.pending ? '入力した接続設定を保存しました。接続確認待ちです。'
        : settings.configured
        ? '接続設定済み' + (settings.userName ? ' · ' + settings.userName : '') : '未設定';
      document.getElementById('clearBacklogSettings').disabled = backlogConnection.busy || !backlogConnection.configured;
    }
    async function loadBacklogSettings() {
      if (backlogConnection.busy) return;
      const request = ++backlogConnection.request;
      const revision = backlogConnection.editRevision;
      const space = document.getElementById('backlogSpaceUrl');
      const initialSpace = space.value;
      try {
        const settings = await gas('getBacklogSettings');
        if (request !== backlogConnection.request || backlogConnection.busy) return;
        renderBacklogSettings(settings, { updateSpace: !backlogConnection.dirty && revision === backlogConnection.editRevision && space.value === initialSpace });
        if (settings.configured) loadBacklogProjectMap({ silent: true });
      } catch (error) {
        if (request === backlogConnection.request) toast('Backlog設定を取得できませんでした: ' + error.message, 'error');
      }
    }
    async function saveBacklogConnection() {
      if (backlogConnection.busy) return;
      const field = document.getElementById('backlogApiKey');
      const payload = { spaceUrl: normalizeBacklogSpaceInput(), apiKey: backlogConnection.keyStored ? '' : field.value };
      ++backlogConnection.request;
      setBacklogConnectionBusy(true);
      try {
        const settings = await gas('saveBacklogSettings', payload);
        if (settings.authorizationRequired) {
          renderBacklogSettings(settings, { updateSpace: false });
          toast('Googleの接続権限を許可してから、もう一度保存してください');
          return;
        }
        renderBacklogSettings(settings, { resetKeyDisplay: true });
        backlogConnection.dirty = false;
        toast('Backlogの接続を確認して保存しました', 'success');
        if (settings.configured) loadBacklogProjectMap({ silent: true });
      } catch (error) { toast(error.message, 'error'); }
      finally { payload.apiKey = ''; setBacklogConnectionBusy(false); }
    }
    async function clearBacklogConnection() {
      if (backlogConnection.busy) return;
      ++backlogConnection.request;
      setBacklogConnectionBusy(true);
      try {
        renderBacklogSettings(await gas('clearBacklogSettings'), { resetKeyDisplay: true });
        backlogConnection.dirty = false;
        backlogProjectMap.projects = [];
        backlogProjectMap.map = {};
        try { localStorage.removeItem(backlogProjectMapLocalKey()); } catch (_) {}
        try { renderBacklogProjectMap(); } catch (_) {}
        backlogProjectMapStatus('');
        toast('Backlogの接続設定を削除しました');
      } catch (error) { toast(error.message, 'error'); }
      finally { setBacklogConnectionBusy(false); }
    }
    function backlogIssueIsImported(issue) {
      const candidates = plannerItems().concat(Object.values(state.weekSnapshot || {}).flatMap(function(snapshot) {
        return snapshot.overlay && snapshot.overlay.items || plannerItemsFromSummaryRows(snapshot.summary && snapshot.summary.rows);
      }));
      return !!issue.imported || candidates.some(function(item) { return item.issueUrl === issue.url; });
    }
    // 取り込み済みの予定と、Backlogの今の値との差。Backlog側に値がないものは、手で入れた値を消さないよう差にしない。
    function backlogImportedPlanItem(issue) {
      return plannerItems().find(function(item) { return item.issueUrl === issue.url; }) || null;
    }
    function backlogIssuePeriod(issue) {
      const start = isViewYmd(issue.startDate) ? issue.startDate : '';
      const end = isViewYmd(issue.dueDate) ? issue.dueDate : '';
      return { startDate: start || end, endDate: end || start, undated: !start && !end };
    }
    function backlogPeriodText(period) {
      if (period.undated || !period.startDate) return '期間未定';
      return period.startDate === period.endDate ? shortYmdLabel(period.startDate) : shortYmdLabel(period.startDate) + '〜' + shortYmdLabel(period.endDate);
    }
    function backlogIssueDiff(issue, item) {
      const diffs = [];
      if (!item) return diffs;
      if (issue.estimatedHours != null && roundHours(issue.estimatedHours) !== roundHours(item.planned)) {
        diffs.push({ label: '予定工数', from: compactHours(item.planned) + 'h', to: compactHours(issue.estimatedHours) + 'h' });
      }
      const period = backlogIssuePeriod(issue);
      if (!period.undated) {
        const current = { startDate: item.startDate || '', endDate: item.endDate || '', undated: !!item.undated };
        if (current.undated || current.startDate !== period.startDate || current.endDate !== period.endDate) {
          diffs.push({ label: '期間', from: backlogPeriodText(current), to: backlogPeriodText(period) });
        }
      }
      return diffs;
    }
    function backlogImportedRowHtml(issue) {
      const item = backlogImportedPlanItem(issue);
      const diffs = backlogIssueDiff(issue, item);
      const detail = ['取り込み済み', issue.dueDate ? '期限 ' + shortYmdLabel(issue.dueDate) : '期限なし', issue.estimatedHours == null ? '予定工数なし' : '予定 ' + compactHours(issue.estimatedHours) + 'h'].join(' · ');
      const note = !item ? '<small class="backlog-diff-note">別の週で取り込んだ予定です。その週を開いて確認してください。</small>'
        : diffs.length ? '<small class="backlog-diff">Backlogと違います: ' + diffs.map(function(diff) { return escapeHtml(diff.label + ' ' + diff.from + ' → ' + diff.to); }).join(' / ') + '</small>' : '';
      return '<div class="candidate is-imported"><span class="backlog-imported-body"><strong>' + escapeHtml(issue.key + ' ' + issue.title) + '</strong><small>' + escapeHtml(detail) + '</small>' + note + '</span>' +
        (diffs.length ? '<md-text-button type="button" data-backlog-apply="' + escapeHtml(issue.id) + '">Backlogの値を反映</md-text-button>' : '') + '</div>';
    }
    function applyBacklogIssueToPlan(issueId) {
      const issue = backlogImport.issues.find(function(entry) { return entry.id === issueId; });
      const item = issue && backlogImportedPlanItem(issue);
      if (!issue || !item) return toast('この週に取り込んだ予定が見つかりません', 'error');
      const diffs = backlogIssueDiff(issue, item);
      if (!diffs.length) return;
      if (issue.estimatedHours != null) {
        const planned = roundHours(issue.estimatedHours);
        const subtaskHours = (typeof plannerSubtasksForItem === 'function' ? plannerSubtasksForItem(item) : []).reduce(function(sum, task) { return roundHours(sum + task.plannedHours); }, 0);
        if (typeof issueHoursExceedPlan === 'function' && issueHoursExceedPlan(planned, subtaskHours)) {
          return toast('サブタスクの予定工数の合計（' + compactHours(subtaskHours) + 'h）がBacklogの予定工数を超えるため反映できません。サブタスクを先に直してください', 'error');
        }
        item.planned = planned;
        item.estimatedTotal = planned;
      }
      const period = backlogIssuePeriod(issue);
      if (!period.undated) {
        item.startDate = period.startDate;
        item.endDate = period.endDate;
        item.undated = false;
      }
      markPlannerChanged();
      updatePlannerSummary();
      renderBacklogIssues();
      toast('「' + item.name + '」にBacklogの' + diffs.map(function(diff) { return diff.label; }).join('・') + 'を反映しました', 'success');
    }
    function renderBacklogIssues() {
      const list = document.getElementById('backlogIssueList');
      const query = String(document.getElementById('backlogIssueQuery').value || '').trim().toLowerCase();
      // 取り込み済みは選べないので、選べる課題を上に出す。
      const matched = backlogImport.issues.filter(function(issue) { return (issue.key + ' ' + issue.title).toLowerCase().indexOf(query) >= 0; });
      const issues = matched.filter(function(issue) { return !backlogIssueIsImported(issue); }).concat(matched.filter(backlogIssueIsImported));
      list.innerHTML = backlogImport.error && !issues.length ? emptyStateHtml('Backlogの課題を取得できませんでした', backlogImport.error) : issues.length ? issues.map(function(issue) {
        const imported = backlogIssueIsImported(issue);
        if (imported) return backlogImportedRowHtml(issue);
        return '<label class="candidate"><md-checkbox touch-target="wrapper" data-backlog-issue-id="' + escapeHtml(issue.id) + '"' + (imported ? ' disabled' : '') + (backlogImport.selected.has(issue.id) ? ' checked' : '') + '></md-checkbox><span><strong>' + escapeHtml(issue.key + ' ' + issue.title) + '</strong><small>' + escapeHtml([imported ? '取り込み済み' : issue.status, issue.dueDate ? '期限 ' + shortYmdLabel(issue.dueDate) : '期限なし', issue.estimatedHours == null ? '予定工数なし' : '予定 ' + compactHours(issue.estimatedHours) + 'h'].join(' · ')) + '</small></span></label>';
      }).join('') : emptyStateHtml(backlogImport.busy ? '課題を読み込んでいます…' : query ? '条件に合う課題はありません' : '担当する未完了課題はありません', backlogImport.hasMore ? '「続きを取得」でほかの課題を確認できます。' : '');
      document.getElementById('backlogImportStatus').textContent = backlogImportStatusText();
      const selectable = issues.filter(function(issue) { return !backlogIssueIsImported(issue); });
      const selectAll = document.getElementById('selectAllBacklogIssues');
      selectAll.disabled = !selectable.length;
      selectAll.textContent = selectable.length && selectable.every(function(issue) { return backlogImport.selected.has(issue.id); }) ? '選択を解除' : '表示中をすべて選択';
      document.getElementById('loadMoreBacklogIssues').hidden = !backlogImport.hasMore;
      document.getElementById('loadMoreBacklogIssues').disabled = backlogImport.busy;
      document.getElementById('addBacklogIssues').disabled = backlogImport.busy || !backlogImport.selected.size;
    }
    function backlogImportStatusText() {
      if (backlogImport.error) return backlogImport.error;
      if (backlogImport.busy && backlogImport.issues.length) return '最新の課題を取得しています… · ' + backlogImport.selected.size + '件選択';
      const changed = backlogImport.issues.filter(function(issue) { return backlogIssueDiff(issue, backlogImportedPlanItem(issue)).length; }).length;
      return backlogImport.issues.length + '件取得 · ' + backlogImport.selected.size + '件選択' + (changed ? ' · Backlogと違う予定 ' + changed + '件' : '');
    }
    async function loadBacklogIssues(reset) {
      if (backlogImport.busy) return;
      backlogImport.busy = true;
      backlogImport.error = '';
      // 読み直すあいだも前回の一覧を出したままにし、届いたら入れ替える（空白の画面を待たせない）。
      const offset = reset ? 0 : backlogImport.offset;
      const request = ++backlogImport.request;
      renderBacklogIssues();
      try {
        const result = await gas('listBacklogAssignedIssues', { offset: offset });
        if (request !== backlogImport.request) return;
        if (result.needsSetup) {
          backlogImport.busy = false;
          backlogImport.issues = [];
          hideAppDialog(document.getElementById('backlogImportDialog'));
          await openAppSettings('backlog');
          return;
        }
        if (reset) backlogImport.issues = [];
        result.issues.forEach(function(issue) {
          if (!backlogImport.issues.some(function(entry) { return entry.id === issue.id; })) backlogImport.issues.push(issue);
        });
        if (reset) {
          const ids = new Set(backlogImport.issues.map(function(issue) { return issue.id; }));
          Array.from(backlogImport.selected).forEach(function(id) { if (!ids.has(id)) backlogImport.selected.delete(id); });
        }
        backlogImport.offset = result.nextOffset;
        backlogImport.hasMore = result.hasMore;
      } catch (error) {
        if (request !== backlogImport.request) return;
        backlogImport.error = error.message;
        toast(error.message, 'error');
      } finally {
        if (request === backlogImport.request) { backlogImport.busy = false; renderBacklogIssues(); }
      }
    }
    async function openBacklogImport() {
      if (state.planner.busy || !state.planner.summary) return toast('週予定の読み込みが終わってから追加してください');
      // 設定の確認を待たずに、すぐ開く。前回の一覧があればそのまま出し、裏で最新にする。
      // 未設定のときは、取得の応答（needsSetup）で設定画面へ案内する。
      backlogImport.request++;
      backlogImport.busy = false;
      backlogImport.weekKey = state.planner.key;
      const query = document.getElementById('backlogIssueQuery');
      query.value = '';
      showAppDialog(document.getElementById('backlogImportDialog'));
      renderBacklogIssues();
      query.focus();
      await loadBacklogIssues(true);
    }
    // Backlogのプロジェクトに割り当てたアプリのプロジェクト。なくなった・終了したものは使わない。
    function backlogAssignedProjectId(issue) {
      const id = String(issue && issue.appProjectId || '');
      if (!id) return '';
      const projects = Array.isArray(state.projects) ? state.projects : [];
      return projects.some(function(project) { return project && project.id === id && project.status !== 'archived'; }) ? id : '';
    }
    const backlogProjectMap = { map: {}, projects: [], busy: false, shown: false };
    // 前回読み込んだBacklogのプロジェクト一覧。設定を開いた瞬間に出し、裏で最新に入れ替える。
    function backlogProjectMapLocalKey() { return scopedStorageKey('matomete-kousu-backlog-projects-v1'); }
    function rememberBacklogProjectMap() {
      try { localStorage.setItem(backlogProjectMapLocalKey(), JSON.stringify({ map: backlogProjectMap.map, projects: backlogProjectMap.projects })); } catch (_) {}
    }
    function showRememberedBacklogProjectMap() {
      if (backlogProjectMap.shown) return;
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(backlogProjectMapLocalKey()) || 'null'); } catch (_) {}
      if (!stored || !Array.isArray(stored.projects) || !stored.projects.length) return;
      // アプリのプロジェクト一覧がまだないと、割り当てが「割り当てない」に見えてしまうので出さない。
      if (typeof state === 'undefined' || !Array.isArray(state.projects) || !state.projects.length) return;
      backlogProjectMap.map = stored.map && typeof stored.map === 'object' ? stored.map : {};
      backlogProjectMap.projects = stored.projects;
      renderBacklogProjectMap();
    }
    function backlogProjectMapStatus(text, isError) {
      const status = document.getElementById('backlogProjectMapStatus');
      if (!status) return;
      status.textContent = text || '';
      if (status.classList) status.classList.toggle('is-error', !!isError);
    }
    function renderBacklogProjectMap() {
      const list = document.getElementById('backlogProjectMapList');
      if (!list) return;
      list.textContent = '';
      const options = [{ value: '', label: '割り当てない' }];
      (Array.isArray(state.projects) ? state.projects : []).forEach(function(project) {
        if (project && project.id && project.status !== 'archived') options.push({ value: project.id, label: project.name || project.id });
      });
      backlogProjectMap.projects.forEach(function(project) {
        const row = document.createElement('div');
        row.className = 'backlog-project-map-row';
        const label = document.createElement('div');
        label.className = 'backlog-project-map-name';
        const name = document.createElement('strong');
        name.textContent = project.name || project.key;
        const key = document.createElement('small');
        key.textContent = project.key;
        label.appendChild(name);
        label.appendChild(key);
        const select = document.createElement('md-outlined-select');
        select.className = 'field';
        select.setAttribute('aria-label', (project.name || project.key) + ' に割り当てるプロジェクト');
        const current = String(backlogProjectMap.map[project.key] || '');
        fillSelect(select, options, options.some(function(option) { return option.value === current; }) ? current : '');
        select.addEventListener('change', function() { saveBacklogProjectAssignment(project.key, readOutlinedSelectValue(select) || ''); });
        row.appendChild(label);
        row.appendChild(select);
        list.appendChild(row);
      });
    }
    async function saveBacklogProjectAssignment(projectKey, projectId) {
      const next = Object.assign({}, backlogProjectMap.map);
      if (projectId) next[projectKey] = projectId; else delete next[projectKey];
      backlogProjectMapStatus('保存中…');
      try {
        const result = await gas('saveBacklogProjectMap', { map: next });
        backlogProjectMap.map = result.map || next;
        rememberBacklogProjectMap();
        backlogProjectMapStatus('保存しました');
      } catch (error) { backlogProjectMapStatus('保存できませんでした: ' + error.message, true); }
    }
    // silent: 設定を開いたときの自動読み込み。前回の一覧があればそれを出したまま裏で更新する。
    async function loadBacklogProjectMap(options) {
      const silent = !!(options && options.silent);
      if (backlogProjectMap.busy) return;
      if (silent) { try { showRememberedBacklogProjectMap(); } catch (_) {} }
      backlogProjectMap.busy = true;
      backlogProjectMapStatus(silent && backlogProjectMap.projects.length ? '更新中…' : '読み込み中…');
      try {
        // アプリのプロジェクト一覧が未読み込みだと選択肢が空になるので、先に読み込む。
        const [result] = await Promise.all([gas('listBacklogProjects'), typeof ensureProjectCatalog === 'function' ? ensureProjectCatalog() : null]);
        backlogProjectMap.map = result.map || {};
        backlogProjectMap.projects = result.projects || [];
        backlogProjectMap.shown = true;
        rememberBacklogProjectMap();
        renderBacklogProjectMap();
        backlogProjectMapStatus(backlogProjectMap.projects.length ? '' : 'Backlogのプロジェクトが見つかりませんでした');
      } catch (error) { backlogProjectMapStatus(error.message, true); }
      finally { backlogProjectMap.busy = false; }
    }
    function addBacklogSelectedIssues() {
      if (backlogImport.busy || state.planner.busy || state.view !== 'planning' || state.planner.key !== backlogImport.weekKey) return;
      const fallbackProjectId = defaultAssignedProjectId();
      let added = 0;
      backlogImport.issues.forEach(function(issue) {
        if (!backlogImport.selected.has(issue.id) || backlogIssueIsImported(issue)) return;
        const projectId = backlogAssignedProjectId(issue) || fallbackProjectId;
        const start = isViewYmd(issue.startDate) ? issue.startDate : '';
        const end = isViewYmd(issue.dueDate) ? issue.dueDate : '';
        const planned = roundHours(issue.estimatedHours);
        const priority = typeof nextPlanPriority === 'function' ? nextPlanPriority(issue.key + ' ' + issue.title) : plannerItems().reduce(function(max, item) { return Math.max(max, Number(item.priority) || 0); }, 0) + 1024;
        plannerItems().push({
          id: uid('plan-'), name: (issue.key + ' ' + issue.title).slice(0, 200), issueUrl: issue.url,
          planned: planned, initialPlanned: planned, estimatedTotal: planned, actual: 0, actualByDate: {},
          hasPlan: true, planKind: 'added', priority: priority, projectId: projectId,
          startDate: start || end, endDate: end || start, undated: !start && !end, note: '', progress: '', done: false
        });
        added++;
      });
      if (!added) return toast('選択した課題はすでに取り込み済みです');
      hideAppDialog(document.getElementById('backlogImportDialog'));
      markPlannerChanged();
      updatePlannerSummary();
      toast(added + '件を週予定に追加しました。予定工数と期間を確認してください', 'success');
    }
    function wireBacklog() {
      document.getElementById('importBacklog').addEventListener('click', openBacklogImport);
      document.getElementById('saveBacklogSettings').addEventListener('click', saveBacklogConnection);
      document.getElementById('loadBacklogProjects').addEventListener('click', function() { loadBacklogProjectMap(); });
      document.getElementById('clearBacklogSettings').addEventListener('click', clearBacklogConnection);
      document.getElementById('backlogSpaceUrl').addEventListener('change', normalizeBacklogSpaceInput);
      document.getElementById('backlogSpaceUrl').addEventListener('blur', normalizeBacklogSpaceInput);
      // 変更を始めると伏せ字は消えて新しいキーを入力でき、「変更をやめる」で元の伏せ字に戻せる。
      document.getElementById('editBacklogApiKey').addEventListener('click', function() {
        if (backlogConnection.busy) return;
        const field = document.getElementById('backlogApiKey');
        backlogConnection.editingKey = true;
        backlogConnection.keyStored = false;
        backlogConnection.dirty = true;
        ++backlogConnection.editRevision;
        field.readOnly = false;
        field.value = '';
        field.supportingText = '新しいAPIキーを入力してください。';
        this.hidden = true;
        document.getElementById('cancelBacklogApiKeyEdit').hidden = false;
        field.focus();
      });
      document.getElementById('cancelBacklogApiKeyEdit').addEventListener('click', function() {
        if (backlogConnection.busy) return;
        const field = document.getElementById('backlogApiKey');
        backlogConnection.editingKey = false;
        backlogConnection.keyStored = true;
        field.value = BACKLOG_STORED_KEY_MASK;
        field.readOnly = true;
        field.supportingText = '登録済み。変更する場合は「APIキーを変更」を押してください。';
        this.hidden = true;
        document.getElementById('editBacklogApiKey').hidden = false;
      });
      ['backlogSpaceUrl', 'backlogApiKey'].forEach(function(id) {
        document.getElementById(id).addEventListener('input', function() {
          ++backlogConnection.editRevision;
          backlogConnection.dirty = true;
          if (id === 'backlogApiKey' && this.value !== BACKLOG_STORED_KEY_MASK) {
            backlogConnection.keyStored = false;
            this.readOnly = false;
            backlogConnection.editingKey = true;
            document.getElementById('editBacklogApiKey').hidden = true;
            document.getElementById('cancelBacklogApiKeyEdit').hidden = false;
          }
        });
      });
      document.getElementById('closeBacklogImport').addEventListener('click', function() { hideAppDialog(document.getElementById('backlogImportDialog')); });
      document.getElementById('cancelBacklogImport').addEventListener('click', function() { hideAppDialog(document.getElementById('backlogImportDialog')); });
      document.getElementById('reloadBacklogIssues').addEventListener('click', function() { loadBacklogIssues(true); });
      document.getElementById('loadMoreBacklogIssues').addEventListener('click', function() { loadBacklogIssues(false); });
      document.getElementById('backlogIssueQuery').addEventListener('input', renderBacklogIssues);
      document.getElementById('backlogIssueList').addEventListener('click', function(event) {
        const button = event.target.closest('[data-backlog-apply]');
        if (button) applyBacklogIssueToPlan(button.dataset.backlogApply);
      });
      document.getElementById('backlogIssueList').addEventListener('change', function(event) {
        const id = event.target.dataset.backlogIssueId;
        if (!id) return;
        if (event.target.checked) backlogImport.selected.add(id); else backlogImport.selected.delete(id);
        renderBacklogIssues();
      });
      document.getElementById('selectAllBacklogIssues').addEventListener('click', function() {
        const query = String(document.getElementById('backlogIssueQuery').value || '').trim().toLowerCase();
        const selectable = backlogImport.issues.filter(function(issue) {
          return (issue.key + ' ' + issue.title).toLowerCase().indexOf(query) >= 0 && !backlogIssueIsImported(issue);
        });
        const all = selectable.length && selectable.every(function(issue) { return backlogImport.selected.has(issue.id); });
        selectable.forEach(function(issue) { if (all) backlogImport.selected.delete(issue.id); else backlogImport.selected.add(issue.id); });
        renderBacklogIssues();
      });
      document.getElementById('addBacklogIssues').addEventListener('click', addBacklogSelectedIssues);
    }
