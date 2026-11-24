    // 保存先の状態は、前回の内容を覚えておき（ブラウザに控える）、読み込み中は前回の状態を使う。
    // 状態が分からないあいだに「保存先を設定してください」を出すと、設定済みでもリロードのたびに一瞬出てしまうため。
    const STORAGE_STATUS_CACHE_KEY = typeof scopedStorageKey === 'function' ? scopedStorageKey('matomete-kousu-storage-status-v1') : 'matomete-kousu-storage-status-v1';
    function readCachedStorageStatus() {
      try {
        const cached = JSON.parse(localStorage.getItem(STORAGE_STATUS_CACHE_KEY) || 'null');
        return cached && cached.configured === true ? cached : null;
      } catch (_) { return null; }
    }
    function renderPlanningStorage(storage) {
      // 読み込み中などで保存先の情報がないときは、分かっている前回の状態を使う。なければ、案内を出さずに待つ。
      if (!storage) storage = state.storage || readCachedStorageStatus();
      if (!storage) {
        document.getElementById('planningStorage').hidden = true;
        document.getElementById('dailyStorageNotice').hidden = true;
        return;
      }
      const current = storage;
      state.storage = current;
      try { localStorage.setItem(STORAGE_STATUS_CACHE_KEY, JSON.stringify(current.configured ? current : null)); } catch (_) {}
      const bar = document.getElementById('planningStorage');
      const configured = !!current.configured;
      bar.classList.toggle('is-unset', !configured);
      bar.hidden = configured;
      document.getElementById('dailyStorageNotice').hidden = configured;
      document.getElementById('planningStorageName').textContent = configured ? current.folderName : 'データ保存先が未設定です';
      document.getElementById('planningStoragePath').textContent = configured
        ? current.folderPath + (current.years && current.years.length ? '（' + current.years.join('・') + '年）' : '')
        : '日次・予定の保存先をまとめて設定します';
      document.getElementById('openPlanningSheet').hidden = !configured;
      document.getElementById('configurePlanning').hidden = false;
      document.getElementById('configurePlanning').textContent = configured ? '保存先を変更' : '保存先を設定';
      document.getElementById('configurePlanning').className = configured ? 'ghost-button' : 'primary-button';
      document.getElementById('savePlan').disabled = !configured;
      document.getElementById('saveDaily').disabled = !configured;
      updateSaveDock();
    }

    async function ensureAnnualStorageYear(year) {
      const storage = state.storage;
      if (!storage || !storage.configured || !storage.annual) return true;
      if ((storage.years || []).indexOf(year) >= 0) return true;
      const path = storage.folderPath + ' / ' + year + '年工数管理データ';
      const created = await confirmDialog({
        title: year + '年の管理ファイルを作成しますか？',
        message: path + ' を新しく作成します。\nこの年のデータを保存するために必要です。',
        confirmLabel: '作成する',
        cancelLabel: 'キャンセル'
      });
      if (!created) return false;
      showBusy(year + '年の管理ファイルを作成しています…');
      try {
        const updated = await gas('createAnnualStorageFile', { year: year, confirmed: true });
        renderPlanningStorage(updated);
        toast(year + '年の管理ファイルを作成しました', 'success');
        return true;
      } catch (error) {
        toast('年次ファイルの作成に失敗しました: ' + error.message, 'error');
        return false;
      } finally { hideBusy(); }
    }

    function openPlanningSetup() {
      state.planner.verifiedFolder = null;
      state.planner.folderBrowser = null;
      state.planner.attachInspection = null;
      setPlanningStorageMode('create', { silent: true });
      document.getElementById('planningFolderResult').hidden = true;
      document.getElementById('createPlanningStorage').disabled = true;
      const storage = state.storage || {};
      document.getElementById('appFileName').value = storage.defaultName || 'まとめて工数管理さん';
      renderPlanningStorageCurrent();
      showAppDialog(document.getElementById('planningSetupDialog'));
      browseAppStorageFolder('');
    }

    // 設定を開いたときに、いまの保存先（どのフォルダの、どの年のファイルか）を先に見せる。
    function renderPlanningStorageCurrent() {
      const box = document.getElementById('planningStorageCurrent');
      if (!box) return;
      const storage = state.storage || {};
      box.textContent = '';
      const title = document.createElement('strong');
      const detail = document.createElement('small');
      if (storage.configured) {
        title.textContent = '現在の保存先: ' + (storage.folderName || '設定済み');
        detail.textContent = (storage.folderPath || '') + (storage.years && storage.years.length ? '（' + storage.years.join('・') + '年のファイル）' : '');
      } else {
        title.textContent = '現在の保存先: 未設定';
        detail.textContent = '下で場所を選ぶと、データの保存先を作成します。';
      }
      box.appendChild(title);
      box.appendChild(detail);
    }
    // 保存先の決め方。「新しく作る」は選んだ場所に管理フォルダを作り、「既存のフォルダを使う」は選んだ管理フォルダの年次ファイルをそのまま使う。
    const STORAGE_MODE_TEXT = {
      create: {
        note: '選んだ場所の中に「管理フォルダ」を作り、その中に年ごとの管理ファイル（スプレッドシート）を作ります。日次・予定・実績は、対象の年のファイルに保存されます。',
        label: '1. 管理フォルダを作る場所を選ぶ（Drive）',
        hint: 'クリックで選択、ダブルクリックまたは右端の「›」で中を開きます。何も選ばないと、いま開いているフォルダに作ります。',
        warning: '「確認する」を押したあとに、作成するフォルダと年次ファイルを最終確認します。確認するまではDriveに何も作成しません。'
      },
      attach: {
        note: '以前に作った管理フォルダ（「2026年…」の管理ファイルが入ったフォルダ）を選ぶと、その中のファイルをそのまま保存先にします。ファイルのコピーや移動はしません。',
        label: '1. 使う管理フォルダを選ぶ（Drive）',
        hint: 'クリックで選択、ダブルクリックまたは右端の「›」で中を開きます。何も選ばないと、いま開いているフォルダを使います。',
        warning: '「確認する」を押したあとに、使う年次ファイルを最終確認します。今年のファイルがないときだけ、そのフォルダに作成します。'
      }
    };
    function planningStorageMode() {
      return state.planner.storageMode === 'attach' ? 'attach' : 'create';
    }
    function setPlanningStorageMode(mode, options) {
      state.planner.storageMode = mode === 'attach' ? 'attach' : 'create';
      const text = STORAGE_MODE_TEXT[state.planner.storageMode];
      document.querySelectorAll('#storageModeSet [data-storage-mode]').forEach(function(button) {
        button.selected = button.dataset.storageMode === state.planner.storageMode;
      });
      document.getElementById('storageModeNote').textContent = text.note;
      document.getElementById('folderBrowserLabel').textContent = text.label;
      document.getElementById('folderBrowserHint').textContent = text.hint;
      document.getElementById('storageWarning').textContent = text.warning;
      document.getElementById('appFileName').hidden = state.planner.storageMode === 'attach';
      if (!(options && options.silent)) updatePlanningFolderPreview();
    }
    // 選んだ場所と管理フォルダ名から、実際に作られるフォルダを示す。既存のフォルダを使うときは、見つかった年次ファイルを示す。
    function updatePlanningFolderPreview() {
      const folder = state.planner.verifiedFolder;
      const box = document.getElementById('planningFolderResult');
      const files = document.getElementById('planningFolderFiles');
      const confirm = document.getElementById('createPlanningStorage');
      document.getElementById('folderSelection').textContent = folder ? '選択中: ' + folder.path : '選択中: —';
      box.hidden = !folder;
      files.hidden = true;
      files.textContent = '';
      box.classList.remove('is-missing');
      if (!folder) { confirm.disabled = true; return; }
      if (planningStorageMode() === 'create') {
        confirm.disabled = false;
        const typed = (document.getElementById('appFileName').value || '').trim();
        const name = typed || '（名前を入力してください）';
        // いま開いているフォルダに作るときは、一覧から同じ名前のフォルダがあるかすぐ分かる。
        const browser = state.planner.folderBrowser;
        const duplicate = typed && browser && browser.current && browser.current.id === folder.id
          && (browser.folders || []).some(function(entry) { return entry.name === typed; });
        box.classList.toggle('is-missing', !!duplicate);
        document.getElementById('planningFolderName').textContent = duplicate ? '同じ名前のフォルダがすでにあります' : '作成されるフォルダ';
        document.getElementById('planningFolderPath').textContent = folder.path + ' / ' + name
          + (duplicate ? '（このまま作ると同じ名前のフォルダが2つになります。そのフォルダを使うなら「既存のフォルダを使う」から選んでください）' : '');
        return;
      }
      const inspection = state.planner.attachInspection;
      if (!inspection || inspection.folderId !== folder.id) {
        confirm.disabled = true;
        document.getElementById('planningFolderName').textContent = '管理ファイルを探しています…';
        document.getElementById('planningFolderPath').textContent = folder.path;
        inspectAttachFolder(folder);
        return;
      }
      if (inspection.error || !inspection.files.length) {
        confirm.disabled = true;
        box.classList.add('is-missing');
        document.getElementById('planningFolderName').textContent = inspection.error ? '管理ファイルを確認できませんでした' : 'このフォルダには管理ファイルがありません';
        document.getElementById('planningFolderPath').textContent = inspection.error || '「2026年…」で始まる管理ファイルが入ったフォルダを選んでください。';
        return;
      }
      confirm.disabled = false;
      document.getElementById('planningFolderName').textContent = '使う管理ファイル（' + inspection.files.length + '件）';
      document.getElementById('planningFolderPath').textContent = folder.path
        + (inspection.missingCurrentYear ? '（' + inspection.currentYear + '年のファイルは、このフォルダに新しく作ります）' : '');
      inspection.files.forEach(function(file) {
        const item = document.createElement('li');
        item.textContent = file.name;
        files.appendChild(item);
      });
      files.hidden = false;
    }
    let attachInspectSeq = 0;
    async function inspectAttachFolder(folder) {
      const seq = ++attachInspectSeq;
      let result;
      try { result = await gas('inspectExistingAppStorage', folder.id); }
      catch (error) { result = { folderId: folder.id, files: [], error: error.message }; }
      if (seq !== attachInspectSeq) return;
      state.planner.attachInspection = Object.assign({ files: [] }, result, { folderId: folder.id });
      if (state.planner.verifiedFolder && state.planner.verifiedFolder.id === folder.id && planningStorageMode() === 'attach') updatePlanningFolderPreview();
    }
    function closePlanningSetup() {
      hideAppDialog(document.getElementById('planningSetupDialog'));
    }

    async function browseAppStorageFolder(folderId) {
      const list = document.getElementById('folderBrowserList');
      state.planner.verifiedFolder = null;
      updatePlanningFolderPreview();
      list.innerHTML = '<div class="folder-browser-empty">フォルダを読み込んでいます…</div>';
      try {
        const result = await gas('listAppStorageFolders', folderId || '');
        state.planner.folderBrowser = result;
        renderFolderBreadcrumb(result);
        document.getElementById('folderBrowserBack').disabled = !result.parent;
        document.getElementById('folderBrowserNote').hidden = !result.truncated;
        list.innerHTML = (result.folders || []).length ? result.folders.map(function(folder) {
          return '<div class="folder-row" role="option" tabindex="0" aria-selected="false" data-folder-id="' + escapeHtml(folder.id) + '">'
            + '<span class="material-symbols-outlined folder-row-icon" aria-hidden="true">folder</span>'
            + '<span class="folder-row-name">' + escapeHtml(folder.name) + '</span>'
            + '<md-icon-button class="folder-row-open" title="開く" aria-label="' + escapeHtml(folder.name) + ' を開く"><span class="material-symbols-outlined">chevron_right</span></md-icon-button>'
            + '</div>';
        }).join('') : '<div class="folder-browser-empty">この中にフォルダはありません</div>';
        // 何も選んでいないときは、いま開いているフォルダを作成場所にする。
        state.planner.verifiedFolder = result.current;
        updatePlanningFolderPreview();
      } catch (error) {
        list.innerHTML = '<div class="folder-browser-empty">フォルダを読み込めませんでした</div>';
        toast(error.message, 'error');
      }
    }

    function renderFolderBreadcrumb(result) {
      const nav = document.getElementById('folderBrowserPath');
      const items = result.ancestors && result.ancestors.length ? result.ancestors : [result.current];
      nav.innerHTML = items.map(function(item, index) {
        const sep = index ? '<span class="material-symbols-outlined folder-crumb-sep" aria-hidden="true">chevron_right</span>' : '';
        if (index === items.length - 1) return sep + '<span class="folder-crumb is-current" aria-current="location">' + escapeHtml(item.name) + '</span>';
        return sep + '<button class="folder-crumb" type="button" data-folder-id="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</button>';
      }).join('');
    }

    // 一覧の行を選ぶ。もう一度押すと選択を外し、開いているフォルダに戻す。
    function selectAppStorageFolderRow(row) {
      const browser = state.planner.folderBrowser;
      if (!browser) return;
      const wasSelected = row.getAttribute('aria-selected') === 'true';
      document.querySelectorAll('#folderBrowserList .folder-row').forEach(function(item) { item.setAttribute('aria-selected', 'false'); });
      if (wasSelected) {
        state.planner.verifiedFolder = browser.current;
      } else {
        row.setAttribute('aria-selected', 'true');
        const folder = (browser.folders || []).find(function(item) { return item.id === row.dataset.folderId; });
        if (!folder) return;
        state.planner.verifiedFolder = { id: folder.id, name: folder.name, path: browser.current.path + ' / ' + folder.name };
      }
      updatePlanningFolderPreview();
    }

    // 既存の管理フォルダを使う前に、使うファイルを確かめてもらう。
    async function confirmAttachPlanningStorage(folder) {
      const inspection = state.planner.attachInspection;
      if (!inspection || inspection.folderId !== folder.id || !inspection.files.length) {
        toast('管理ファイルが入ったフォルダを選んでください', 'error');
        return false;
      }
      const current = state.storage && state.storage.configured ? '\n\n今の保存先（' + (state.storage.folderPath || state.storage.folderName || '') + '）のデータはコピーしません。' : '';
      return confirmDialog({
        title: 'このフォルダを保存先にしますか？',
        message: folder.path + ' の次のファイルをそのまま使います。\n\n'
          + inspection.files.map(function(file) { return '・' + file.name; }).join('\n')
          + (inspection.missingCurrentYear ? '\n・' + inspection.currentYear + '年のファイル（新しく作成）' : '')
          + current,
        confirmLabel: '保存先にする',
        cancelLabel: 'キャンセル'
      });
    }

    async function createPlanningStorage() {
      const folder = state.planner.verifiedFolder;
      const attach = planningStorageMode() === 'attach';
      const title = document.getElementById('appFileName').value.trim();
      if (!folder) return toast('先に保存先フォルダを確認してください', 'error');
      if (attach) {
        if (!(await confirmAttachPlanningStorage(folder))) return;
      } else {
        if (!title) return toast('管理フォルダ名を入力してください', 'error');
        let preview;
        showBusy('作成する年次ファイルを確認しています…');
        try { preview = await gas('previewAnnualStorageMigration', { folderId: folder.id, title: title }); }
        catch (error) { hideBusy(); return toast(error.message, 'error'); }
        hideBusy();
        const fileList = (preview.fileNames || []).map(function(name) { return '・' + name; }).join('\n');
        const existing = preview.existingFolder;
        const warning = existing
          ? '\n\n注意: ' + preview.parentPath + ' には「' + existing.name + '」という名前のフォルダがすでにあります'
            + (existing.fileNames && existing.fileNames.length ? '（管理ファイル「' + existing.fileNames.join('」「') + '」が入っています）' : '')
            + '。作成すると、同じ名前のフォルダがもう1つできます。そのフォルダを使う場合は、キャンセルして「既存のフォルダを使う」から選んでください。'
          : '';
        const proceed = await confirmDialog({
          title: existing ? '同じ名前のフォルダがあります。作成しますか？' : 'データの保存先を作成しますか？',
          message: preview.folderPath + ' を作成し、次の年次ファイルを用意します。\n\n' + fileList + warning,
          confirmLabel: '作成する',
          cancelLabel: 'キャンセル'
        });
        if (!proceed) return;
      }
      const dailyWasDirty = state.daily.dirty;
      const plannerWasDirty = state.planner.dirty;
      showBusy('年次管理の保存先を設定しています…');
      try {
        const storage = attach
          ? await gas('attachAppStorage', { folderId: folder.id, confirmed: true })
          : await gas('migrateAppStorage', { folderId: folder.id, title: title, confirmed: true });
        state.storage = storage;
        closePlanningSetup();
        renderPlanningStorage(storage);
        clearNavigationSnapshots();
        state.project.catalogLoaded = false;
        state.project.catalogPromise = null;
        state.project.workspace = null;
        state.projects = [];
        // 新しい保存先のプロジェクト一覧をすぐ読み直す（再読み込みしなくても、実績や予定のプロジェクト名が出るように）。
        ensureProjectCatalog().catch(function() {});
        toast('年次管理の保存先を設定しました', 'success');
        state.daily.url = storage.file.url;
        if (!dailyWasDirty) await loadDaily({ force: true, silent: true });
        if (!plannerWasDirty) {
          state.planner.summary = null;
          if (state.view === 'planning') await loadPlanner({ force: true, silent: true });
          if (state.view === 'projects') {
            renderProjectStorage(storage);
            await loadProjectScreen({ force: true, silent: true });
          }
        }
      } catch (error) { toast('保存先の設定に失敗しました: ' + error.message, 'error'); }
      finally { hideBusy(); }
    }

    function renderPlanner(options) {
      options = options || {};
      if (state.calendarMode === state.planner.type) syncCalendarControl();
      const summary = state.planner.summary || { rows: [], subtasks: [], range: null };
      const capacityKey = state.planner.type + ':' + state.planner.key;
      const cachedCapacity = state.calendarCache[capacityKey];
      if (cachedCapacity && (!summary.capacity || calendarCacheIsFresh(capacityKey))) summary.capacity = cachedCapacity;
      renderPlanningStorage(summary.storage);
      document.getElementById('periodRange').textContent = rangeLabel(summary.range);
      if (state.view === 'planning') syncCalendarControl();
      if (Array.isArray(options.items)) state.planner.items = options.items.filter(function(item) { return item && !String(item.calendarKey || '').trim(); });
      else state.planner.items = plannerItemsFromSummaryRows(summary.rows);
      if (Array.isArray(options.subtasks) && state.planner.summary) state.planner.summary.subtasks = options.subtasks;
      dropCalendarAutoActualsFromPlanner();
      state.planner.items.forEach(function(item) {
        if (item.hasPlan && state.planner.type === 'week') rememberWeeklyPlanName(item.name, { carryWeek: item.carryWeek, plannedHours: item.planned, prevC: item.planned, calendarKey: item.calendarKey, projectId: item.projectId, startDate: item.startDate, endDate: item.endDate, undated: !!item.undated });
      });
      if (state.planner.type === 'week') rememberWeeklySubtasks(state.planner.key, summary.subtasks);
      updatePlannerSummary();
      finishWeekNavigationMotion();
    }

    function weekWorkspaceCacheKey(periodKey) {
      return 'weekWorkspace:' + periodKey;
    }
    function ensureWeekContinuationOverlay(weekKey, items, subtasks, range) {
      if (state.weekContinuationBusy[weekKey]) return state.weekContinuationBusy[weekKey];
      const pending = overlayOriginContinuations(weekKey, items, subtasks, range);
      state.weekContinuationBusy[weekKey] = pending;
      pending.then(function() {
        if (state.weekContinuationBusy[weekKey] === pending) delete state.weekContinuationBusy[weekKey];
      }, function() {
        if (state.weekContinuationBusy[weekKey] === pending) delete state.weekContinuationBusy[weekKey];
      });
      return pending;
    }
    function rememberCarriedWeekCaches(periodKey) {
      delete state.parentNamesByWeek[periodKey];
      delete state.weeklySubtasksByWeek[periodKey];
      delete state.weekForecastCache[periodKey];
      delete state.calendarCache[weekWorkspaceCacheKey(periodKey)];
      delete state.weekContinuationBusy[periodKey];
      delete state.calendarCache['prevWeekOverflow:' + periodKey];
      const prevKey = previousWeekKey(periodKey);
      if (prevKey) {
        delete state.calendarCache[weekWorkspaceCacheKey(prevKey)];
        delete state.weekContinuationBusy[prevKey];
        delete state.calendarCache['prevWeekOverflow:' + prevKey];
      }
      const nextKey = nextWeekKey(periodKey);
      if (nextKey) {
        delete state.calendarCache[weekWorkspaceCacheKey(nextKey)];
        delete state.weekContinuationBusy[nextKey];
      }
    }
    async function loadWeekWorkspaceCached(periodKey, fresh) {
      const cacheKey = weekWorkspaceCacheKey(periodKey);
      if (!fresh && state.calendarCache[cacheKey]) return state.calendarCache[cacheKey];
      const snap = state.weekSnapshot['week:' + periodKey];
      if (!fresh && snap && snap.summary) {
        state.calendarCache[cacheKey] = snap.summary;
        return snap.summary;
      }
      const summary = await gas('loadPlanningWorkspace', 'week', periodKey);
      state.calendarCache[cacheKey] = summary;
      return summary;
    }
    function applyContinuationMergeToPlanner(merged, options) {
      if (!merged || !merged.items) return 0;
      state.planner.items = merged.items;
      if (state.planner.summary) state.planner.summary.subtasks = merged.subtasks;
      if (state.planner.type === 'week' && state.planner.key) rememberWeeklySubtasks(state.planner.key, merged.subtasks);
      (merged.items || []).forEach(function(item) {
        if (!item || !item.hasPlan) return;
        rememberWeeklyPlanName(item.name, {
          carryWeek: item.carryWeek,
          plannedHours: item.planned,
          prevC: item.planned,
          startDate: item.startDate,
          endDate: item.endDate,
          undated: !!item.undated,
          planId: item.id,
          projectId: item.projectId,
          issueUrl: item.issueUrl
        });
      });
      if (options && options.persist === false) updatePlannerSummary();
      else {
        markPlannerChanged();
        updatePlannerSummary();
      }
      return merged.changed;
    }
    function priorWeekKeysFromItems(items) {
      const keys = [];
      (items || []).forEach(function(item) {
        const key = item && item.carryWeek;
        if (key && keys.indexOf(key) < 0) keys.push(key);
      });
      return keys;
    }
    async function loadContinuationAncestors(items) {
      const byWeek = {};
      const pending = priorWeekKeysFromItems(items).slice();
      for (let i = 0; i < 16 && pending.length; i++) {
        const key = pending.shift();
        if (!key || byWeek[key]) continue;
        try {
          const summary = await loadWeekWorkspaceCached(key);
          const rows = plannerItemsFromSummaryRows(summary.rows);
          byWeek[key] = rows;
          priorWeekKeysFromItems(rows).forEach(function(nextKey) { pending.push(nextKey); });
        } catch (_) {
          byWeek[key] = [];
        }
      }
      return byWeek;
    }
    async function continuationSourcesFromItems(items) {
      const list = items || [];
      const ancestors = await loadContinuationAncestors(list);
      return enrichContinuationSources(list, ancestors);
    }
    function attachActualsFromHistory(item, historyByWeek) {
      if (!item) return item;
      const beforeDated = actualHoursFromByDate(item.actualByDate);
      Object.keys(historyByWeek || {}).forEach(function(key) {
        const found = findPlannerItem(historyByWeek[key] || [], item.id, item.name);
        if (!found) return;
        item.actualByDate = mergeActualByDate(item.actualByDate, found.actualByDate);
      });
      const afterDated = actualHoursFromByDate(item.actualByDate);
      item.actual = roundHours(roundHours(item.actual) + Math.max(0, afterDated - beforeDated));
      return item;
    }
    const CONTINUATION_LOAD_BATCH_SIZE = 4;
    async function loadContinuationWeekSummaries(weekKey) {
      const keys = [];
      let key = previousWeekKey(weekKey);
      for (let i = 0; i < 16 && key; i++) {
        keys.push(key);
        key = previousWeekKey(key);
      }
      const summaries = {};
      for (let offset = 0; offset < keys.length; offset += CONTINUATION_LOAD_BATCH_SIZE) {
        const batch = keys.slice(offset, offset + CONTINUATION_LOAD_BATCH_SIZE);
        const loaded = await Promise.all(batch.map(function(sourceKey) {
          return loadWeekWorkspaceCached(sourceKey).then(function(summary) {
            return { key: sourceKey, summary: summary };
          }).catch(function() {
            return { key: sourceKey, summary: null };
          });
        }));
        loaded.forEach(function(entry) {
          if (entry.summary) summaries[entry.key] = entry.summary;
        });
      }
      return { keys: keys, summaries: summaries };
    }
    async function overlayOriginContinuations(weekKey, items, subtasks, range) {
      let nextItems = (items || []).slice();
      let nextSubtasks = (subtasks || []).slice();
      const historyByWeek = {};
      let changed = 0;
      const loadedWeeks = await loadContinuationWeekSummaries(weekKey);
      for (let i = 0; i < loadedWeeks.keys.length; i++) {
        const key = loadedWeeks.keys[i];
        const prevSummary = loadedWeeks.summaries[key];
        if (!prevSummary) continue;
        const rows = plannerItemsFromSummaryRows(prevSummary.rows);
        historyByWeek[key] = rows;
        const originItems = rows.filter(function(item) {
          return planIsOrigin(item) && planShouldContinue(item, prevSummary.subtasks || [], range);
        }).map(function(item) {
          const copy = Object.assign({}, item, {
            originWeek: item.originWeek || key,
            actualByDate: Object.assign({}, item.actualByDate || {})
          });
          return attachActualsFromHistory(copy, historyByWeek);
        });
        // 未完了の元予定は、対象週が始まる前でも次の週へ残す。
        // 完了済みの繰り越し分だけを外す。
        const merged = reconcileWeekContinuations({
          sourceKey: key,
          sourceItems: originItems,
          sourceSubtasks: prevSummary.subtasks || [],
          targetItems: nextItems,
          targetSubtasks: nextSubtasks,
          targetStart: range && range.startYmd || '',
          targetRange: range,
          targetKey: weekKey
        });
        nextItems = merged.items;
        nextSubtasks = merged.subtasks;
        changed += merged.changed;
      }
      nextItems = nextItems.map(function(item) {
        return attachActualsFromHistory(Object.assign({}, item, {
          actualByDate: Object.assign({}, item.actualByDate || {})
        }), historyByWeek);
      });
      const deduped = dropUnworkedDuplicatePlans(nextItems, nextSubtasks);
      return { items: deduped.items, subtasks: deduped.subtasks, changed: changed + deduped.removed };
    }
    async function applyPreviousWeekContinuations() {
      if (state.planner.type !== 'week' || !state.planner.key || !state.planner.summary) return 0;
      if (state.planner.dirty) return 0;
      const targetWeekKey = state.planner.key;
      const targetSummary = state.planner.summary;
      const targetChangeSeq = state.planner.changeSeq;
      const merged = await ensureWeekContinuationOverlay(
        targetWeekKey,
        plannerItems(),
        (targetSummary && targetSummary.subtasks) || [],
        targetSummary && targetSummary.range
      );
      if (state.planner.type !== 'week' || state.planner.key !== targetWeekKey || state.planner.summary !== targetSummary || state.planner.dirty || state.planner.changeSeq !== targetChangeSeq) return 0;
      const changed = applyContinuationMergeToPlanner(merged, { persist: false });
      if (changed && state.daily.weekKey === targetWeekKey) {
        setDailyWeekWorkspace(targetWeekKey, targetSummary, plannerItems());
        if (!state.daily.busy && !state.daily.saving && !state.daily.dirty && state.daily.date && dailyWeekKey(state.daily.date) === targetWeekKey) {
          const forecast = peekWeekForecast(state.daily.date);
          if (forecast) {
            state.daily.agenda = dayAgendaFromForecast(forecast, state.daily.date, state.daily.rows);
            applyDailyProgress(state.daily.agenda);
          }
          applyWeeklyHoursToDailyRows(state.daily.rows, state.daily.date);
          renderDaily();
        }
      }
      return changed;
    }
    async function savePlanningWeekWorkspace(periodKey, items, subtasks, calendarExclusions) {
      const payload = collectPlanningPayload({
        periodType: 'week',
        periodKey: periodKey,
        items: items,
        subtasks: subtasks,
        calendarExclusions: calendarExclusions || []
      });
      const saved = await gas('savePlanningWorkspace', payload);
      invalidateProjectSnapshots();
      rememberCarriedWeekCaches(periodKey);
      // 端末の控えも保存した内容に置き換える。古い控えが残ると、持ち越し先の週を開いたときに
      // 書き戻す前の終了日などで上書きされる。
      rememberWeekSnapshot('week', periodKey, saved, { overlay: null });
      return saved;
    }
    function continuedOriginSnapshot(item) {
      return JSON.stringify([
        item.name, roundHours(item.planned), item.note || '', item.startDate || '', item.endDate || '', !!item.undated,
        item.projectId || '', item.issueUrl || '', !!item.done, item.priority == null ? '' : item.priority,
        item.completionOverride == null ? '' : item.completionOverride, item.originWeek || '', item.carryWeek || ''
      ]);
    }
    function continuedSubtaskSnapshot(tasks) {
      return JSON.stringify((tasks || []).map(function(task) {
        return [task.id || '', task.title || '', roundHours(task.plannedHours), task.status || '', task.dueDate || '', task.note || ''];
      }).sort());
    }
    // 他の週に登録した予定を、この週の画面で変えたときは登録した週へ書き戻す。
    // 変わっていない週は書き込まない（期間が週をまたぐ予定が増えても保存を重くしない）。
    async function saveContinuedOrigins(currentKey, items, subtasks, deletions) {
      const groups = {};
      const deletedByOrigin = {};
      (deletions || []).forEach(function(entry) {
        if (!entry || !entry.originWeek || entry.originWeek === currentKey) return;
        (deletedByOrigin[entry.originWeek] = deletedByOrigin[entry.originWeek] || []).push(entry);
        if (!groups[entry.originWeek]) groups[entry.originWeek] = [];
      });
      (items || []).forEach(function(item) {
        if (!item || item.hasPlan === false || item.calendarKey) return;
        const origin = item.originWeek || item.carryWeek;
        if (!origin || origin === currentKey) return;
        (groups[origin] = groups[origin] || []).push(item);
      });
      const keys = Object.keys(groups);
      let saved = 0;
      for (let i = 0; i < keys.length; i++) {
        const originKey = keys[i];
        let summary;
        try { summary = await loadWeekWorkspaceCached(originKey, true); }
        catch (_) { continue; }
        const native = plannerItemsFromSummaryRows(summary.rows);
        let originSubs = (summary.subtasks || []).slice();
        let changed = false;
        // この週の画面で削除した、この週に登録されている予定を消す（サブタスクも一緒に消す）。
        (deletedByOrigin[originKey] || []).forEach(function(entry) {
          const found = findPlannerItem(native, entry.id, '') || (entry.id ? null : findPlannerItem(native, '', entry.name));
          if (!found) return;
          native.splice(native.indexOf(found), 1);
          originSubs = originSubs.filter(function(task) { return !planningTaskBelongsToPlan(task, found); });
          changed = true;
        });
        groups[originKey].forEach(function(update) {
          const found = findPlannerItem(native, update.id, '') || findPlannerItem(native, '', update.name);
          const updateIsBlank = !planHasLoggedActual(update) && !planContinuationIsComplete(update);
          const foundIsReal = found && (planHasLoggedActual(found) || planContinuationIsComplete(found, originSubs));
          if (found && updateIsBlank && foundIsReal) return;
          const storedCompletion = planCompletionForSave(update, (subtasks || []).concat(originSubs));
          const target = found || null;
          if (target) {
            const before = continuedOriginSnapshot(target);
            target.name = String(update.name || '').trim() || target.name;
            target.planned = roundHours(update.planned);
            target.estimatedTotal = roundHours(update.planned);
            target.note = update.note;
            target.undated = !!update.undated;
            target.startDate = target.undated ? '' : (update.startDate || target.startDate || '');
            target.endDate = target.undated ? '' : (update.endDate || target.endDate || '');
            target.projectId = update.projectId || '';
            if (update.priority != null) target.priority = update.priority;
            if (update.issueUrl) target.issueUrl = update.issueUrl;
            target.done = storedCompletion.done;
            target.completionOverride = storedCompletion.completionOverride;
            target.hasPlan = true;
            target.carryWeek = '';
            target.originWeek = originKey;
            if (update.id && !target.id) target.id = update.id;
            if (continuedOriginSnapshot(target) !== before) changed = true;
          } else {
            if (updateIsBlank) return;
            native.push(Object.assign({}, update, {
              carryWeek: '',
              originWeek: originKey,
              done: storedCompletion.done,
              completionOverride: storedCompletion.completionOverride
            }));
            changed = true;
          }
          // この週の画面で足したサブタスクも登録した週へ残す。画面側にない場合は元のまま。
          const plan = target || native[native.length - 1];
          const live = (subtasks || []).filter(function(task) { return planningTaskBelongsToPlan(task, update); });
          if (!live.length) return;
          const kept = originSubs.filter(function(task) { return !planningTaskBelongsToPlan(task, plan) && !planningTaskBelongsToPlan(task, update); });
          const previous = originSubs.filter(function(task) { return kept.indexOf(task) < 0; });
          const next = live.map(function(task) {
            return Object.assign(copyPlannerSubtask(task, plan.name), { parentPlanId: plan.id || task.parentPlanId || '', periodType: 'week', periodKey: originKey });
          });
          if (continuedSubtaskSnapshot(previous) !== continuedSubtaskSnapshot(next)) changed = true;
          originSubs = kept.concat(next);
        });
        const seenSubtasks = {};
        const beforeDedupe = originSubs.length;
        originSubs = originSubs.filter(function(task) {
          if (!task || !String(task.title || '').trim()) return false;
          const key = [String(task.parentPlanId || ''), String(task.parentKey || ''), String(task.title || '').trim(), String(roundHours(task.plannedHours))].join('\0');
          if (seenSubtasks[key]) return false;
          seenSubtasks[key] = true;
          return true;
        });
        if (originSubs.length !== beforeDedupe) changed = true;
        const cleaned = dropUnworkedDuplicatePlans(native, originSubs);
        if (cleaned.removed) changed = true;
        if (!changed) continue;
        const originItems = cleaned.items.filter(function(item) {
          return item.hasPlan !== false && planBelongsToPeriod(Object.assign({}, item, {
            originWeek: item.originWeek || originKey
          }), originKey);
        });
        await savePlanningWeekWorkspace(originKey, originItems, cleaned.subtasks, summary.calendarExclusions || []);
        saved++;
      }
      return saved;
    }
    async function pushWeekContinuationsFrom(sourceKey) {
      const nextKey = nextWeekKey(sourceKey);
      if (!nextKey || !sourceKey) return 0;
      if (state.planner.type === 'week' && state.planner.key === nextKey && state.planner.summary) {
        return applyPreviousWeekContinuations();
      }
      return 0;
    }
    async function pushWeekContinuationsForSavedWeek(weekKey) {
      if (!weekKey) return 0;
      if (state.planner.type === 'week' && state.planner.key === weekKey && state.planner.summary) {
        return pushWeekContinuationsFrom(weekKey, plannerItems(), state.planner.summary.subtasks || []);
      }
      let summary;
      try { summary = await loadWeekWorkspaceCached(weekKey, true); }
      catch (_) { return 0; }
      return pushWeekContinuationsFrom(weekKey, plannerItemsFromSummaryRows(summary.rows), summary.subtasks || []);
    }

    function importMonthlyPlansToWeek() {
      const allocation = state.planner.summary && state.planner.summary.monthlyAllocation;
      const rows = allocation && allocation.rows || [];
      if (!rows.length) return toast('先に対象月の月次予定を登録してください');
      let changed = 0;
      rows.forEach(function(source) {
        const existing = plannerItems().find(function(item) { return item.name === source.aggregationKey; });
        if (existing) {
          if (roundHours(existing.planned) === 0 && source.suggestedHours > 0) {
            existing.hasPlan = true;
            existing.planned = roundHours(source.suggestedHours);
            existing.estimatedTotal = roundHours(source.suggestedHours);
            changed++;
          }
          return;
        }
        const actualRow = (state.planner.summary.rows || []).find(function(row) { return row.aggregationKey === source.aggregationKey; });
        plannerItems().push({
          id: uid('plan-'),
          name: source.aggregationKey,
          planned: roundHours(source.suggestedHours),
          actual: actualRow ? roundHours(actualRow.actualHours) : 0,
          actualByDate: actualRow && actualRow.actualByDate || {},
          estimatedTotal: roundHours(source.suggestedHours),
          hasPlan: true,
          planKind: 'added',
          initialPlanned: roundHours(source.suggestedHours),
          createdAt: '',
          note: '',
          startDate: '',
          dailyCap: 0,
          dailyPlan: {}
        });
        changed++;
      });
      if (!changed) return toast('月予定のタスクはすでに週予定へ反映されています');
      markPlannerChanged();
      updatePlannerSummary();
      toast('月予定を週予定へ展開しました。工数を確認して保存してください', 'success');
    }

    // 週の画面に並べる予定。予定は期間（開始日〜終了日）と予定工数だけを持ち、
    // 日ごとの予定時間は割り振らない。実績は日次シートの記録をそのまま使う。
    function weekPlanRows(items, options) {
      options = options || {};
      const today = String(options.today || '');
      return (items || []).map(function(item, index) {
        const hasPlan = item.hasPlan !== false;
        const done = hasPlan && planIsComplete(item, options.subtasks);
        const range = hasPlan ? planDateRange(item, options.weekKey) : null;
        return {
          id: item.id,
          name: item.name || '名称未入力',
          index: index,
          hasPlan: hasPlan,
          planKind: item.planKind,
          plannedHours: roundHours(item.planned),
          actualHours: roundHours(item.actual),
          actualByDate: item.actualByDate || {},
          done: done,
          completionOverride: item.completionOverride,
          isCalendar: !!item.calendarKey,
          calendarKey: item.calendarKey || '',
          startDate: range ? range.start : '',
          endDate: range ? range.end : '',
          range: range,
          undated: hasPlan && !!item.undated,
          // 完了した予定も、表示期間にかかるものは出す（一覧の下の「完了」にまとめる）。隠すと日ごとの実績の合計と行が合わなくなる。
          visible: hasPlan && planVisibleInWeek(item, options.range, today, done, options.weekKey)
        };
      });
    }

    function calculateWeekPlanModel() {
      const summary = state.planner.summary || {};
      const capacity = summary.capacity;
      return {
        days: capacity && capacity.days || [],
        rows: weekPlanRows(plannerItems(), {
          range: summary.range,
          today: ymd(new Date()),
          weekKey: state.planner.key,
          subtasks: summary.subtasks
        }),
        fallback: !!(capacity && capacity.fallback),
        calendarInterruptsByDate: summary.calendarInterruptsByDate || {}
      };
    }

    function shortDateLabel(value) {
      const parts = String(value || '').split('-');
      return parts.length === 3 ? Number(parts[1]) + '/' + Number(parts[2]) : value;
    }

    function timelineDateLabel(value) {
      const date = parseYmd(value);
      return shortDateLabel(value) + '（' + ['日','月','火','水','木','金','土'][date.getDay()] + '）';
    }

    function visibleCapacityDays() {
      const range = state.planner.summary && state.planner.summary.range;
      const capacityDays = plannerCapacityDays();
      if (range) {
        const matched = capacityDays.filter(function(day) {
          return day.date >= range.startYmd && day.date < range.endExclusiveYmd;
        });
        if (matched.length) return matched;
        const days = [];
        const cursor = parseYmd(range.startYmd);
        const end = parseYmd(range.endExclusiveYmd);
        while (cursor < end) {
          const standard = standardHoursForDate(cursor);
          days.push({
            date: ymd(cursor),
            baseHours: standard,
            meetingHours: 0,
            availableHours: standard,
            events: [],
            capacityReason: '',
            capacityOverridden: false
          });
          cursor.setDate(cursor.getDate() + 1);
        }
        return days;
      }
      return capacityDays.slice(0, 7);
    }

    // 日付の下には、その日の実績と稼働時間だけを出す（予定時間は日に割り振らない）。
    function weekDayActualHours(date, rows, liveDaily) {
      if (liveDaily && liveDaily.date === date) {
        return roundHours((liveDaily.rows || []).reduce(function(total, row) {
          return total + numericHours(row && (row.today != null ? row.today : row.hours));
        }, 0));
      }
      return roundHours((rows || []).reduce(function(total, row) {
        return total + roundHours(row && row.actualByDate && row.actualByDate[date]);
      }, 0));
    }
    function weekDayLoadLabel(actualHours, baseHours) {
      const actual = roundHours(actualHours);
      const base = roundHours(baseHours);
      if (base <= 0 && !(actual > 0)) return '休み';
      return '実績 ' + compactHours(actual) + 'h / 稼働 ' + compactHours(base) + 'h';
    }
    function weekDayLoadHtml(actualHours, baseHours) {
      const actual = roundHours(actualHours);
      const base = roundHours(baseHours);
      if (base <= 0 && !(actual > 0)) return '<b>休み</b>';
      return '<b>実績 ' + compactHours(actual) + '</b><span>/ ' + compactHours(base) + 'h</span>';
    }

    // subtasks を渡すと、その一覧から探す（前後の週の予定は、前後の週のサブタスクを含めた一覧を渡す）。
    function plannerSubtasksForItem(item, subtasks) {
      if (!item || (!subtasks && !state.planner.summary)) return [];
      return (subtasks || state.planner.summary.subtasks || []).filter(function(task) {
        return planningTaskBelongsToPlan(task, item);
      }).sort(function(left, right) {
        return (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0)
          || String(left.title || '').localeCompare(String(right.title || ''));
      });
    }

    function plannerSubtaskStatus(status) {
      const value = String(status || 'todo').trim();
      if (value === 'done' || value === '完了') return { label: '完了', className: 'is-done' };
      if (value === 'doing' || value === '進行中') return { label: '進行中', className: 'is-doing' };
      return { label: '未着手', className: '' };
    }

    function plannerSubtaskTitleMatches(left, right) {
      const normalize = function(value) {
        return planIdentityName(String(value || '').trim()).replace(/[\s\u3000]+/g, ' ');
      };
      const first = normalize(left);
      const second = normalize(right);
      if (!first || !second) return false;
      return first === second || first.indexOf(second) === 0 || second.indexOf(first) === 0;
    }

    function plannerSubtaskActualMapAdd(target, source) {
      Object.keys(source || {}).forEach(function(date) {
        target[date] = roundHours((target[date] || 0) + Number(source[date] || 0));
      });
    }

    function plannerSubtaskActualByDate(item, task, actualSummary) {
      const summary = actualSummary || state.planner.summary || {};
      const title = String((task && task.title) || '').trim();
      const parent = String((item && item.name) || '').trim();
      const planIds = [];
      [item && item.id, task && task.parentPlanId].forEach(function(value) {
        const id = String(value || '').trim();
        if (id && planIds.indexOf(id) < 0) planIds.push(id);
      });

      const byPlanChild = summary.dailyActualByPlanChild || {};
      const byPlanDate = {};
      let matchedByPlan = false;
      Object.keys(byPlanChild).forEach(function(key) {
        const separator = key.indexOf('\u0000');
        if (separator < 0) return;
        const planId = key.slice(0, separator);
        const child = key.slice(separator + 1);
        if (planIds.length && planIds.indexOf(planId) < 0) return;
        if (!plannerSubtaskTitleMatches(child, title)) return;
        matchedByPlan = true;
        plannerSubtaskActualMapAdd(byPlanDate, byPlanChild[key]);
      });
      if (matchedByPlan) return byPlanDate;

      const byName = summary.dailyActualByName || {};
      const byNameDate = {};
      const normalizedParent = planIdentityName(parent).replace(/[\s\u3000]+/g, ' ');
      Object.keys(byName).forEach(function(name) {
        const normalizedName = planIdentityName(name).replace(/[\s\u3000]+/g, ' ');
        if (!normalizedParent || normalizedName.indexOf(normalizedParent) !== 0) return;
        const remainder = normalizedName.slice(normalizedParent.length).replace(/^[\s/／:：-]+/, '');
        if (!remainder || !plannerSubtaskTitleMatches(remainder, title)) return;
        plannerSubtaskActualMapAdd(byNameDate, byName[name]);
      });
      if (Object.keys(byNameDate).length) return byNameDate;
      return (task && task.actualByDate) || {};
    }

    function renderPlannerSubtasks(item, subtasks) {
      const tasks = plannerSubtasksForItem(item, subtasks);
      if (!tasks.length) return '';
      const expanded = !!((state.planner.expandedSubtasks || {})[item.id]);
      return '<button class="span-subtasks-toggle" type="button" data-parent-plan-id="' + escapeHtml(item.id || '') + '" aria-expanded="' + expanded + '" aria-label="' + escapeHtml(item.name || '予定') + ' のサブタスク ' + tasks.length + '件" title="サブタスク ' + tasks.length + '件を展開・折りたたむ"><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>';
    }

    function renderPlannerSubtaskRows(item, days, grid, actualSummary, subtasks) {
      const tasks = plannerSubtasksForItem(item, subtasks);
      if (!tasks.length) return '';
      const expanded = !!((state.planner.expandedSubtasks || {})[item.id]);
      return tasks.map(function(task, index) {
        const status = plannerSubtaskStatus(task.status);
        const actualMap = plannerSubtaskActualByDate(item, task, actualSummary);
        // サブタスクの実績合計（表示中の週の外の日も含む。親の予定の実績合計と同じ範囲）。
        const actualTotal = roundHours(Object.keys(actualMap).reduce(function(total, date) { return total + (Number(actualMap[date]) || 0); }, 0));
        const plannedHours = roundHours(task.plannedHours);
        // 実績のある日のセルだけを作る（列の線や土日の色は行の背景で描く）。
        const dateCells = (days || []).map(function(day, dayIndex) {
          const actual = roundHours(actualMap[day.date]);
          if (!(actual > 0)) return '';
          return '<div class="span-day" style="grid-column:' + (dayIndex + 2) + ';grid-row:1" data-date="' + day.date + '" data-plan-id="' + escapeHtml(item.id || '') + '">' +
            // 親の予定の実績バーと同じく、長さを工数に比例させる（1日の標準の稼働時間で列いっぱい）。
            '<span class="span-actual span-subtask-actual" style="--actual-ratio:' + Math.min(100, Math.round(actual / workdayDefaultHours() * 100)) + '%" tabindex="0" role="button" title="' + escapeHtml(task.title + ' · 実績 ' + hours(actual) + 'h') + '">' + compactHours(actual) + 'h</span>' +
          '</div>';
        }).join('');
        return '<div class="span-row span-subtask-lane' + (expanded ? ' is-visible' : '') + (index === tasks.length - 1 ? ' is-last-subtask' : '') + '" ' + grid + ' data-row-key="subtask:' + escapeHtml(item.id + ':' + task.id) + '" data-parent-plan-id="' + escapeHtml(item.id || '') + '">' +
          '<div class="span-name span-subtask-lane-name"><span class="span-subtask-check' + (status.className ? ' ' + status.className : '') + '" aria-label="' + status.label + '"></span>' +
            '<div class="span-subtask-copy">' +
            '<button class="span-subtask-edit" type="button" data-edit-subtask-id="' + escapeHtml(task.id || '') + '" data-parent-plan-id="' + escapeHtml(item.id || '') + '" title="' + escapeHtml(task.title || '名称未入力') + ' を編集">' + escapeHtml(task.title || '名称未入力') + '</button>' +
            '<small class="span-subtask-meta"><span>予定 ' + compactHours(task.plannedHours) + 'h</span>' +
            '<span class="span-subtask-actual-total' + (plannedHours > 0 && actualTotal > plannedHours ? ' is-over' : '') + '" title="' + escapeHtml('実績合計 ' + hours(actualTotal) + 'h' + (plannedHours > 0 && actualTotal > plannedHours ? '（予定を超過）' : '')) + '">実績 ' + compactHours(actualTotal) + 'h</span>' +
            (task.dueDate ? '<span>期限 ' + shortDateLabel(task.dueDate) + '</span>' : '') + '</small>' +
          '</div></div>' + dateCells + '</div>';
      }).join('');
    }

    function dayMarks(day, today) {
      const date = parseYmd(day.date);
      return {
        date: date,
        weekend: date.getDay() === 0 || date.getDay() === 6,
        saturday: date.getDay() === 6,
        sunday: date.getDay() === 0,
        today: day.date === today,
        weekday: ['日', '月', '火', '水', '木', '金', '土'][date.getDay()]
      };
    }

    function weekGridStyle(dayCount) {
      return 'style="grid-template-columns:var(--week-name-col) repeat(' + dayCount + ',var(--week-day-col,160px))"';
    }

    // 週・月で同じ期間バーを使う。列は表示期間に切り詰め、実際の開始・終了は保持する。
    function timelinePeriodModel(range, days) {
      if (!range || !days || !days.length) return null;
      const first = days.findIndex(function(day) { return day.date >= range.start && day.date <= range.end; });
      if (first < 0) return null;
      let last = first;
      while (last + 1 < days.length && days[last + 1].date <= range.end) last++;
      return {
        startColumn: first + 2,
        endColumn: last + 3,
        dayCount: last - first + 1,
        continuesBefore: range.start < days[0].date,
        continuesAfter: range.end > days[days.length - 1].date
      };
    }
    // 予定工数と累計実績は、帯が長いと見えなくなるため、帯ではなく左端の名前の欄に出す。
    function planHoursHtml(planned, actual) {
      if (!Number.isFinite(planned) || !Number.isFinite(actual)) return '';
      return '<span class="plan-hours" title="予定工数と累計実績"><span>予定 <b>' + compactHours(planned) + 'h</b></span>' +
        '<span class="plan-hours-actual' + (actual > planned && planned > 0 ? ' is-over' : '') + '">実績 <b>' + compactHours(actual) + 'h</b></span></span>';
    }
    // 実績のない日がこの日数以上続いた期間（今日より前）は、帯を塗らずに細い線で示す。
    const TIMELINE_IDLE_GAP_DAYS = 7;
    // 予定期間のうち、今日より前で実績のない日が続いている期間（開始・終了を含む）を返す。
    function timelineIdleGaps(range, actualByDate, today) {
      if (!range || !range.start || !range.end || !today) return [];
      const map = actualByDate || {};
      const last = range.end < today ? range.end : addDaysYmd(today, -1);
      const gaps = [];
      let runStart = '';
      let runLength = 0;
      const close = function(endDate) {
        if (runStart && runLength >= TIMELINE_IDLE_GAP_DAYS) gaps.push({ start: runStart, end: endDate });
        runStart = '';
        runLength = 0;
      };
      for (let date = range.start, guard = 0; date <= last && guard < 1500; date = addDaysYmd(date, 1), guard++) {
        if (roundHours(map[date]) > 0) { close(addDaysYmd(date, -1)); continue; }
        if (!runStart) runStart = date;
        runLength++;
      }
      close(last);
      return gaps;
    }
    // 帯を、表示中の日の列ごとに「塗る」「線にする」の区間へ分ける。区間は帯の中での列の位置（0始まり）。
    function timelinePeriodSegments(model, days, gaps) {
      if (!gaps.length) return null;
      const segments = [];
      for (let index = 0; index < model.dayCount; index++) {
        const date = days[model.startColumn - 2 + index].date;
        const gap = gaps.find(function(entry) { return date >= entry.start && date <= entry.end; }) || null;
        const previous = segments[segments.length - 1];
        if (previous && !!previous.gap === !!gap && previous.gap === gap) { previous.to = index + 1; continue; }
        segments.push({ from: index, to: index + 1, gap: gap });
      }
      return segments.some(function(segment) { return segment.gap; }) ? segments : null;
    }
    function timelineSegmentStyle(segment, model, marginLeft, marginRight) {
      const col = 'var(--week-day-col,160px)';
      const left = segment.from === 0 ? '0px' : 'calc(' + segment.from + ' * ' + col + ' - ' + marginLeft + 'px)';
      const right = segment.to === model.dayCount ? '0px' : 'calc(' + (model.dayCount - segment.to) + ' * ' + col + ' - ' + marginRight + 'px)';
      return 'left:' + left + ';right:' + right;
    }
    function timelinePeriodHtml(options) {
      const range = options.done ? planCompletedRange(options.range, options.actualByDate, options.today) : options.range;
      const days = options.days;
      if (!days || !days.length) return '';
      const model = timelinePeriodModel(range, days);
      const layer = '<div class="timeline-period-layer" aria-hidden="true">';
      if (!model) {
        const label = !range ? '期間未定' : range.end < days[0].date
          ? shortDateLabel(range.end) + ' 終了予定 · ' + (options.overdue ? '期限切れ' : '表示期間より前')
          : shortDateLabel(range.start) + ' 開始予定 · 表示期間より後';
        return layer + '<div class="timeline-period-outside' + (options.overdue ? ' is-overdue' : '') + '" style="grid-column:2 / -1">' +
          '<span class="material-symbols-outlined">' + (!range ? 'event' : range.end < days[0].date ? 'chevron_left' : 'chevron_right') + '</span><span>' + escapeHtml(label) + '</span></div></div>';
      }
      const compact = options.mode === 'month' ? model.dayCount < 8 : model.dayCount < 2;
      const tiny = options.mode === 'month' && model.dayCount === 1;
      const classes = ['timeline-period', options.done ? 'is-done' : options.overdue ? 'is-overdue' : '',
        model.continuesBefore ? 'continues-before' : '', model.continuesAfter ? 'continues-after' : '',
        compact ? 'is-compact' : '', tiny ? 'is-tiny' : '', options.mode === 'week' ? 'is-week' : ''].filter(Boolean).join(' ');
      // 帯の下端に、予定工数に対する実績の割合を細い線で出す。
      const progress = options.planned > 0 && Number.isFinite(options.actual)
        ? '<span class="timeline-period-progress' + (options.actual > options.planned ? ' is-over' : '') + '" style="width:' + Math.min(100, Math.round(options.actual / options.planned * 100)) + '%"></span>' : '';
      const icon = options.done ? '<span class="material-symbols-outlined timeline-period-icon">check</span>'
        : options.overdue ? '<span class="timeline-period-icon">!</span>' : '';
      // 週の帯で、長く手を付けていない期間は塗らずに線にする（復活させた予定が謎の帯に見えないように）。
      const segments = options.mode === 'week' && range && options.actualByDate
        ? timelinePeriodSegments(model, days, timelineIdleGaps(range, options.actualByDate, options.today || ymd(new Date())))
        : null;
      // 期間をドラッグで変えられる帯には、予定と期間の情報を持たせる（ui/plan_edit.js）。
      const dragAttrs = options.planId && range && !options.readOnly
        ? ' tabindex="0" role="button" title="' + escapeHtml((options.name || '名称未入力') + ' · 押して予定を編集（左右の端をドラッグで期間を変更）') + '" aria-label="' + escapeHtml((options.name || '名称未入力') + ' の予定を編集') + '" data-plan-id="' + escapeHtml(options.planId) + '" data-origin-week="' + escapeHtml(options.originWeek || '') + '" data-start="' + escapeHtml((options.range || range).start) + '" data-end="' + escapeHtml((options.range || range).end) + '"' : '';
      if (segments) return layer + timelineSegmentedPeriodHtml(options, model, range, classes, dragAttrs, segments, icon) + '</div>';
      return layer + '<div class="' + classes + '"' + dragAttrs + ' style="grid-column:' + model.startColumn + ' / ' + model.endColumn + '">' +
        (model.continuesBefore ? '<span class="timeline-period-edge">‹</span>' : '') +
        '<span class="timeline-period-caption">' + icon + '<span class="timeline-period-title">' + escapeHtml(options.name || '名称未入力') + '</span>' +
        (options.done || options.overdue || options.over ? '<span class="timeline-period-state">' + (options.done ? '完了' : options.overdue ? '期限切れ' : '工数超過') + '</span>' : '') +
        '</span>' +
        '<span class="timeline-period-meta">' + escapeHtml(planRangeLabel(range)) + '</span>' +
        (model.continuesAfter ? '<span class="timeline-period-edge is-after">›</span>' : '') + progress + '</div></div>';
    }

    // 線の区間を含む帯。帯そのもの（押す・端をドラッグする対象）は透明にし、中に塗りと線の区間を並べる。
    function timelineSegmentedPeriodHtml(options, model, range, classes, dragAttrs, segments, icon) {
      const compact = model.dayCount < 2;
      const marginLeft = model.continuesBefore ? 0 : 5;
      const marginRight = model.continuesAfter ? 0 : 5;
      let titled = false;
      const parts = segments.map(function(segment, index) {
        const style = timelineSegmentStyle(segment, model, marginLeft, marginRight);
        const edgeBefore = index === 0 && model.continuesBefore ? '<span class="timeline-period-edge">‹</span>' : '';
        const edgeAfter = index === segments.length - 1 && model.continuesAfter ? '<span class="timeline-period-edge is-after">›</span>' : '';
        if (segment.gap) {
          const label = segment.gap.start === range.start ? shortYmdLabel(range.start) + '開始' : '実績なし';
          return '<span class="timeline-period-gap" style="' + style + '" title="' + escapeHtml(shortYmdLabel(segment.gap.start) + '〜' + shortYmdLabel(segment.gap.end) + ' は実績がありません') + '">' +
            edgeBefore + '<span class="timeline-period-gap-label">' + escapeHtml(label) + '</span>' + edgeAfter + '</span>';
        }
        const showUntil = index > 0;
        const caption = '<span class="timeline-period-caption">' + (titled ? '' : icon) + '<span class="timeline-period-title">' + escapeHtml(options.name || '名称未入力') + '</span>' +
          (showUntil ? '<span class="timeline-period-until">〜' + escapeHtml(shortYmdLabel(range.end)) + '</span>' : '') +
          (!titled && (options.done || options.overdue || options.over) ? '<span class="timeline-period-state">' + (options.done ? '完了' : options.overdue ? '期限切れ' : '工数超過') + '</span>' : '') + '</span>';
        titled = true;
        const progress = index === segments.length - 1 && options.planned > 0 && Number.isFinite(options.actual)
          ? '<span class="timeline-period-progress' + (options.actual > options.planned ? ' is-over' : '') + '" style="width:' + Math.min(100, Math.round(options.actual / options.planned * 100)) + '%"></span>' : '';
        return '<span class="timeline-period-fill' + (index > 0 ? ' after-gap' : '') + (index < segments.length - 1 ? ' before-gap' : '') + '" style="' + style + '">' + edgeBefore + caption + edgeAfter + progress + '</span>';
      }).join('');
      return '<div class="' + classes + ' has-gaps' + (compact ? ' is-compact' : '') + '"' + dragAttrs + ' style="grid-column:' + model.startColumn + ' / ' + model.endColumn + '">' + parts + '</div>';
    }

    function weekSpanFlagsHtml(status, range) {
      const deviation = status && status.deviation || {};
      const flags = [];
      if (deviation.earlyDate) flags.push('<span class="span-flag is-early" title="' + escapeHtml('開始日 ' + shortDateLabel(range.start) + ' より前の ' + shortDateLabel(deviation.earlyDate) + ' から実績があります') + '">前倒し ' + shortDateLabel(deviation.earlyDate) + '〜</span>');
      if (deviation.overdue) flags.push('<span class="span-flag is-late" title="' + escapeHtml('終了日 ' + shortDateLabel(range.end) + ' を過ぎても完了していません') + '">期限切れ</span>');
      else if (deviation.lateDate) flags.push('<span class="span-flag is-late" title="' + escapeHtml('終了日 ' + shortDateLabel(range.end) + ' の後 ' + shortDateLabel(deviation.lateDate) + ' まで実績があります') + '">期限超過 〜' + shortDateLabel(deviation.lateDate) + '</span>');
      if (status && status.over) flags.push('<span class="span-flag is-late" title="実績が予定工数を超えています">工数超過</span>');
      return flags.join('');
    }

    // 描き直す直前の行（位置と見た目）を覚え、描き直した後になめらかにつなぐ。週の切り替えでは
    // スマホでは横長の表をやめ、7日分の実績の帯と予定のリストで見せる。
    function isCompactLayout() {
      return typeof matchMedia === 'function' && matchMedia('(max-width: 620px)').matches;
    }
    // スマホの一覧の1行（日の行と同じ形）。1行目は名前と右端の「実績 / 予定」、2行目は状態（色付きの文字）と期間。
    function mobileListRowHtml(options) {
      const planned = options.planned;
      const actual = options.actual;
      return '<button type="button" class="mobile-list-row ' + options.className + '" ' + options.attributes + '>' +
        '<span class="mobile-row-title">' + escapeHtml(options.title) + '</span>' +
        '<span class="mobile-row-trailing' + (actual > planned && planned > 0 ? ' is-over' : '') + '">' + compactHours(actual) + '<small> / ' + compactHours(planned) + 'h</small></span>' +
        '<span class="mobile-row-sub"><span class="mobile-status' + statusToneClass(options.status) + '">' + escapeHtml(options.statusLabel) + '</span>' + escapeHtml(options.sub) + '</span>' +
        (options.progress && planned > 0 ? '<span class="mobile-row-progress' + (actual > planned ? ' is-over' : '') + '"><span style="width:' + Math.min(100, Math.round(actual / planned * 100)) + '%"></span></span>' : '') +
      '</button>';
    }
    function renderWeekMobile(target, selectedDays) {
      releaseReorderBinding(target);
      const today = ymd(new Date());
      const summary = state.planner.summary || {};
      const liveDaily = state.daily && dailyWeekKey(state.daily.date) === state.planner.key ? state.daily : null;
      const items = overlayLiveDailyActuals(sortByPlanPriority(plannerItems()), liveDaily);
      const rows = weekPlanRows(items, { range: summary.range, today: today, weekKey: state.planner.key, subtasks: summary.subtasks });
      const daysHtml = selectedDays.map(function(day) {
        const mark = dayMarks(day, today);
        const actual = weekDayActualHours(day.date, rows, liveDaily);
        return '<button type="button" class="week-mobile-day' + (mark.today ? ' is-today' : '') + (mark.saturday ? ' is-saturday' : '') + (mark.sunday ? ' is-sunday' : '') + '" data-mobile-day="' + day.date + '" aria-label="' + escapeHtml(timelineDateLabel(day.date) + ' 実績 ' + compactHours(actual) + 'h') + '">' +
          '<small>' + mark.weekday + '</small><strong>' + mark.date.getDate() + '</strong><span>' + (actual > 0 ? compactHours(actual) + 'h' : '—') + '</span></button>';
      }).join('');
      const plans = rows.filter(function(row) { return row.visible; }).map(function(row) {
        const item = items.find(function(entry) { return entry.id === row.id; });
        const done = planIsComplete(item, summary.subtasks);
        const status = planPeriodStatus(item, row.range, today, done);
        const label = item && !done ? planProgressLabel(item, summary.subtasks) : status.label;
        const planned = roundHours(item.planned);
        const actual = roundHours(item.actual);
        return mobileListRowHtml({
          className: 'week-mobile-plan' + (done ? ' is-done' : ''), attributes: 'data-mobile-plan-id="' + escapeHtml(row.id) + '"',
          title: row.name, status: status, statusLabel: label,
          sub: (row.range ? planRangeLabel(row.range) : '期間未定') + (status.deviation && status.deviation.overdue ? ' · 期限切れ' : ''),
          planned: planned, actual: actual, progress: true
        });
      }).join('');
      target.innerHTML = '<div class="week-mobile"><div class="week-mobile-days">' + daysHtml + '</div>' +
        '<div class="week-mobile-plans">' + (plans || emptyStateHtml('この週の予定はまだありません', '下の「予定を追加」から追加できます。')) +
        '<button type="button" class="mobile-add-row" data-mobile-add-plan><span class="material-symbols-outlined" aria-hidden="true">add</span>予定を追加</button></div></div>';
      target.dataset.timelineKey = state.planner.key;
    }

    // 並べ替えのドラッグの登録は、行の数だけ時間がかかる。週の切り替えの描画を止めないよう、描き終えたあと、手が止まっているときに回す。
    let plannerDraggableBindTimer = 0;
    function scheduleBindPlannerRowDraggables() {
      if (plannerDraggableBindTimer) return;
      const run = function() {
        plannerDraggableBindTimer = 0;
        if (state.view === 'planning') bindPlannerRowDraggables();
      };
      plannerDraggableBindTimer = typeof requestIdleCallback === 'function'
        ? requestIdleCallback(run, { timeout: 400 })
        : setTimeout(run, 60);
    }
    // 通常の課題の1段目に出す文字（プロジェクト名。未設定なら空のまま、段の高さだけ残す）。
    let planRowLeadCatalogRequested = false;
    function planRowLeadText(item) {
      const id = item && item.projectId;
      if (!id) return '';
      // プロジェクトの一覧が未読み込みなら、読み込みを始める（読めたら週を描き直す。ensureProjectCatalog が行う）。
      if (!planRowLeadCatalogRequested && !state.project.catalogLoaded && !(state.projects && state.projects.length) && typeof ensureProjectCatalog === 'function') { planRowLeadCatalogRequested = true; ensureProjectCatalog(); }
      const project = (Array.isArray(state.projects) ? state.projects : []).find(function(entry) { return entry && entry.id === id; });
      return project ? (project.name || '') : '';
    }
    function renderWeekCalendar(suppliedModel) {
      if (deferWeekNavigationRender()) return;
      const target = document.getElementById('weekCalendar');
      if (!target) return;
      const selectedDays = visibleCapacityDays();
      const days = selectedDays.length ? weekTimelineDays(selectedDays) : [];
      if (!days.length) {
        releaseReorderBinding(target);
        target.innerHTML = emptyStateHtml('この週のカレンダーを準備しています', state.planner.capacityBusy ? 'Googleカレンダーを読み込んでいます…' : '「カレンダーを更新」で読み込むか、予定を追加してください。');
        return;
      }
      if (isCompactLayout()) {
        renderWeekMobile(target, selectedDays);
        return;
      }
      loadAdjacentCalendarPeriods('week', state.planner.key);
      const model = weekTimelineDisplayModel(suppliedModel || calculateWeekPlanModel());
      const today = ymd(new Date());
      const excluded = knownExcludedCalendarKeys();
      const imported = knownImportedCalendarKeys();
      const liveDaily = state.daily && dailyWeekKey(state.daily.date) === (state.planner && state.planner.key) ? state.daily : null;
      rememberWeekDisplay(state.planner.key, days, model, liveDaily);
      const interruptByDate = interruptEntriesByDate(days, model, liveDaily);
      const calendarVarianceKeys = {};
      Object.keys(interruptByDate).forEach(function(date) {
        (interruptByDate[date] || []).forEach(function(entry) {
          if (entry.calendarOrigin && entry.calendarKey) calendarVarianceKeys[entry.calendarKey] = true;
        });
      });
      const grid = weekGridStyle(days.length);
      const header = '<div class="week-head-grid" ' + grid + '><div class="week-head-label">予定</div>' + days.map(function(day) {
        const mark = dayMarks(day, today);
        const actual = weekTimelineDayActualHours(day, model, liveDaily);
        const base = roundHours(day.baseHours);
        const label = weekDayLoadLabel(actual, base);
        const classes = ['week-head-day', !day.contextOnly ? 'is-selected-period' : '', mark.saturday ? 'is-saturday' : '', mark.sunday ? 'is-sunday' : '', mark.today ? 'is-today' : ''].filter(Boolean).join(' ');
        return '<div class="' + classes + '" data-date="' + day.date + '">' +
          '<button class="week-day-open" type="button" data-date="' + day.date + '" title="' + escapeHtml(timelineDateLabel(day.date) + ' の実績を表示') + '"><small>' + mark.weekday + '</small><strong>' + mark.date.getDate() + '</strong></button>' +
          (day.contextOnly && !day.contextLoaded ? '<span class="week-context-actual">読み込み中</span>' : '<button class="capacity-edit' + (actual > base && base > 0 ? ' is-over' : (base <= 0 ? ' is-rest' : '')) + '" type="button" data-date="' + day.date + '" data-hours="' + day.baseHours + '" data-reason="' + escapeHtml(day.capacityReason || '') + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label + '。クリックして稼働時間を変更') + '">' + weekDayLoadHtml(actual, base) + '</button>') +
          ('<md-icon-button touch-target="wrapper" class="week-add" data-date="' + day.date + '" title="予定を追加" aria-label="' + day.date + ' から始まる予定を追加"><span class="material-symbols-outlined">add</span></md-icon-button>') +
        '</div>';
      }).join('') + '</div>';
      // カレンダーと今日だけは全件を出す。行の高さは、表示中の期間で一番多い日に合わせて揃う。
      const meetings = '<div class="week-meet-grid" ' + grid + ' data-row-key="meet:calendar"><div class="week-meet-label" title="Google カレンダーの予定です。日次の画面で実績に取り込むと、その日の工数になります。">カレンダー</div>' + days.map(function(day) {
        const mark = dayMarks(day, today);
        const events = (day.events || []).map(function(event, index) {
          const eventKey = calendarEventKey(event, day.date, index);
          const excludedEvent = excluded.indexOf(eventKey) >= 0;
          const importedEvent = imported.indexOf(eventKey) >= 0;
          const varianceEvent = !excludedEvent && !!calendarVarianceKeys[eventKey];
          const time = event.allDay ? '終日' : event.startTime;
          const eventHours = calendarEventHours(event);
          const classes = ['calendar-entry', 'is-event', excludedEvent ? 'is-excluded' : '', importedEvent ? 'is-imported' : '', varianceEvent ? 'is-calendar-variance' : ''].filter(Boolean).join(' ');
          const title = excludedEvent ? '実施しない予定' : 'クリックして実績を記録';
          const showCalendarName = ((state.planner.calendarSettings || {}).selectedIds || []).length > 1;
          const meta = [eventHours ? hours(eventHours) + 'h' : '', showCalendarName ? (event.calendarName || '') : ''].filter(Boolean).join(' · ');
          const entryMeta = eventHours > 0 ? compactHours(eventHours) + 'h' : '';
          return '<button class="' + classes + '" type="button" data-calendar-key="' + escapeHtml(eventKey) + '" data-date="' + day.date + '" data-event-index="' + index + '" title="' + escapeHtml([title, event.title || '', meta].filter(Boolean).join(' · ')) + '"><b><span class="calendar-entry-title">' + escapeHtml((time ? time + ' ' : '') + (event.title || 'カレンダー予定')) + '</span></b>' + (entryMeta ? '<small>' + entryMeta + '</small>' : '') + '</button>';
        });
        return '<div class="week-meet-day' + (mark.saturday ? ' is-saturday' : '') + (mark.sunday ? ' is-sunday' : '') + '">' + (events.length ? events.join('') : '<span class="week-meet-empty">' + (day.contextOnly && !day.contextLoaded ? '—' : 'なし') + '</span>') + '</div>';
      }).join('') + '</div>';
      const hasInterrupt = days.some(function(day) { return (interruptByDate[day.date] || []).length; });
      // 今日だけの行は、予定がなくても出して高さを固定する（週によって行が消えて下がずれないように）。
      const interrupts = '<div class="week-meet-grid is-interrupt" ' + grid + ' data-row-key="meet:interrupt"><div class="week-meet-label" title="その日だけの作業（割り込みなど）です。週の予定には入らず、その日の実績にだけ数えます。">今日だけ</div>' + days.map(function(day) {
        const mark = dayMarks(day, today);
        const chips = (interruptByDate[day.date] || []).map(function(entry) {
          const meta = entry.hours > 0 ? compactHours(entry.hours) + 'h' : '';
          const classes = ['calendar-entry', 'is-interrupt', entry.calendarOrigin ? 'is-calendar-interrupt' : ''].filter(Boolean).join(' ');
          const title = entry.calendarOrigin ? 'カレンダー予定から今日だけ' : (meta ? '実績 ' + meta : '今日だけの作業');
          return '<button class="' + classes + '" type="button" data-date="' + day.date + '" title="' + escapeHtml([entry.name, title].filter(Boolean).join(' · ')) + '"><b>' + escapeHtml(entry.name) + '</b>' + (entry.hours > 0 ? '<small>' + compactHours(entry.hours) + 'h</small>' : '') + '</button>';
        });
        return '<div class="week-meet-day' + (mark.saturday ? ' is-saturday' : '') + (mark.sunday ? ' is-sunday' : '') + '">' + (chips.length ? chips.join('') : '<span class="week-meet-empty">なし</span>') + '</div>';
      }).join('') + '</div>';
      const planRows = (model.rows || []).filter(function(row) { return row.visible; });
      const plannerItemsById = {};
      model.timelineItems.forEach(function(item) {
        if (item && item.id) plannerItemsById[item.id] = item;
      });
      const laneHtmlFor = function(row) {
        const item = plannerItemsById[row.id] || null;
        const range = row.range;
        const done = planIsComplete(item, model.timelineSubtasks);
        const periodStatus = planPeriodStatus(item || { planned: row.plannedHours, actual: row.actualHours, actualByDate: row.actualByDate }, range, today, done);
        // 前後の週の予定もサブタスクの行を出し、週を切り替えても行の数が変わらないようにする。
        const contextSubtasks = item && item.contextOnly ? model.timelineSubtasks : null;
        const subtaskPanel = item ? renderPlannerSubtasks(item, contextSubtasks) : '';
        const subtaskRows = item ? renderPlannerSubtaskRows(item, days, grid, model.timelineActualSummary, contextSubtasks) : '';
        const inRange = function(date) { return !!(range && date >= range.start && date <= range.end); };
        // 実績のある日のセルだけを作る。列の線・土日・前後の週の色は行の背景で描き、期間の目印は帯が持つ。
        const cells = days.map(function(day, index) {
          const actual = roundHours(row.actualByDate && row.actualByDate[day.date]);
          if (!(actual > 0)) return '';
          const filled = inRange(day.date);
          const position = filled ? 'within' : planDatePosition(range, day.date);
          const classes = ['span-day', 'has-actual',
            !filled ? (position === 'before' ? 'is-early' : position === 'after' ? 'is-late' : '') : ''
          ].filter(Boolean).join(' ');
          const where = !range ? '期間未定' : filled ? '予定期間' : position === 'before' ? '開始日より前' : '終了日より後';
          const title = [row.name, where, '実績 ' + hours(actual) + 'h'].join(' · ');
          return '<div class="' + classes + '" style="grid-column:' + (index + 2) + ';grid-row:1" data-date="' + day.date + '" data-plan-id="' + escapeHtml(row.id) + '" title="' + escapeHtml(title) + '"><span class="span-day-stack">' + weekSpanActualHtml(actual, position).replace('<em ', '<em tabindex="0" role="button" title="' + escapeHtml(row.name + ' · 実績 ' + hours(actual) + 'h（押してその日の実績を開く）') + '" aria-label="' + escapeHtml(row.name + ' ' + hours(actual) + 'h の実績の日を開く') + '" ') + '</span></div>';
        }).join('');
        const plannedTotal = item ? roundHours(item.planned) : row.plannedHours;
        const actualTotal = item ? roundHours(item.actual) : row.actualHours;
        const status = item && !done ? Object.assign({}, periodStatus, { label: planProgressLabel(item, model.timelineSubtasks) }) : periodStatus;
        const resultTitle = statusDetailTitle(status);
        const planNote = item ? String(item.note || '').trim() : '';
        const details = [row.name, range ? planRangeLabel(range) : '期間未定', '予定 ' + compactHours(plannedTotal) + 'h',
          '累計実績 ' + compactHours(actualTotal) + 'h', resultTitle, planNote ? '備考: ' + planNote : ''].filter(Boolean).join(' · ');
        if (item && item.contextOnly) {
          // 前後の週だけの予定で完了しているものは、この週を見るときには出さない（空の行に見えるため）。
          if (done) return '';
          // 前後の週だけの予定。押したときは、その予定がある週を中央へ寄せる。
          const contextDay = range && days.find(function(day) { return day.date >= range.start; }) || days[days.length - 1];
          return '<div class="span-row span-context-row' + (state.planner.expandedSubtasks && state.planner.expandedSubtasks[row.id] ? ' is-expanded' : '') + '" ' + grid + ' data-row-key="' + escapeHtml(row.id) + '"><div class="span-name is-compact" data-date="' + contextDay.date + '" title="' + escapeHtml(details) + '"><div class="span-name-copy"><div class="span-name-title">' + planSummaryTitleHtml(row.name, item.issueUrl, planRowLeadText(item)) + '</div><div class="span-name-hours-row">' + planHoursHtml(plannedTotal, actualTotal) + '<span class="span-name-status"><button type="button" class="weekly-status plan-status-button' + statusToneClass(status) + '" title="' + escapeHtml(resultTitle + '（押すとこの予定の週へ移動）') + '">' + escapeHtml(status.label) + '<span class="material-symbols-outlined" aria-hidden="true">expand_more</span></button></span></div><div class="span-name-actions">' + (subtaskPanel || '<span class="span-subtasks-spacer" aria-hidden="true"></span>') + '</div></div></div>' + timelinePeriodHtml({ range: range, days: days, name: row.name, planned: plannedTotal, actual: actualTotal, done: done, overdue: !!periodStatus.deviation.overdue, over: !!status.over, mode: 'week', actualByDate: row.actualByDate || {}, today: today, planId: item && item.hasPlan !== false && !item.calendarKey ? row.id : '', originWeek: item && item.originWeek || '' }) + cells + '</div>' + subtaskRows;
        }
        const addSubtaskControl = item ? iconButtonHtml('add', { class: 'span-subtask-add', 'touch-target': 'none', 'data-add-subtask-plan-id': item.id || '', title: 'サブタスクを追加', 'aria-label': row.name + ' にサブタスクを追加' }) : '';
        return '<div class="span-row' + (status.paceTone === 'alert' ? ' is-alert' : '') + (done ? ' is-done' : '') + (state.planner.expandedSubtasks && state.planner.expandedSubtasks[row.id] ? ' is-expanded' : '') + (state.planner.focusedPlanId === row.id ? ' is-focused' : '') + '" ' + grid + ' data-plan-id="' + escapeHtml(row.id) + '" data-row-key="' + escapeHtml(row.id) + '">' +
          '<div class="span-name is-compact" tabindex="0" data-plan-id="' + escapeHtml(row.id) + '" title="' + escapeHtml(details) + '">' +
            iconButtonHtml('drag_indicator', { class: 'span-priority-handle', 'touch-target': 'none', title: 'ドラッグして優先順位を変更', 'aria-label': row.name + ' の優先順位をドラッグで変更' }) +
            '<div class="span-name-copy' + (planNote ? ' has-note' : '') + '" role="group" aria-label="' + escapeHtml(details) + '"><div class="span-name-title">' + planSummaryTitleHtml(row.name, item && item.issueUrl, planRowLeadText(item)) + '</div>' +
            planNoteIconHtml(row.id, planNote, !!item && item.hasPlan !== false && !item.calendarKey) +
            '<div class="span-name-hours-row">' + planHoursHtml(plannedTotal, actualTotal) + '<span class="span-name-status">' + (item
              ? '<button type="button" class="weekly-status plan-status-button' + statusToneClass(status) + '" data-status-plan-id="' + escapeHtml(row.id) + '" title="' + escapeHtml(resultTitle + '（押して状態を変更）') + '" aria-haspopup="menu" aria-label="' + escapeHtml(row.name + ' の状態: ' + planProgressLabel(item) + '。押して変更') + '">' + escapeHtml(status.label) + '<span class="material-symbols-outlined" aria-hidden="true">expand_more</span></button>'
              : '<span class="weekly-status' + statusToneClass(status) + '" title="' + escapeHtml(resultTitle) + '">' + escapeHtml(status.label) + '</span>') + '</span></div>' +
            '<div class="span-name-actions">' + (subtaskPanel || '<span class="span-subtasks-spacer" aria-hidden="true"></span>') +
            '<div class="span-name-subtasks">' + (subtaskPanel ? '<span class="span-subtask-count">' + plannerSubtasksForItem(item).length + '件</span>' : '') + addSubtaskControl + '</div></div></div>' +
          '</div>' +
          timelinePeriodHtml({ range: range, days: days, name: row.name, planned: plannedTotal, actual: actualTotal, done: done, overdue: !!periodStatus.deviation.overdue, over: !!status.over, mode: 'week', actualByDate: row.actualByDate || {}, today: today, planId: item && item.hasPlan !== false && !item.calendarKey ? row.id : '', originWeek: item && item.originWeek || '' }) + cells +
        '</div>' + subtaskRows;
      };
      const lanes = planRows.length
        ? planRows.map(laneHtmlFor).join('')
        : (hasInterrupt ? '' : emptyStateHtml('この週の予定はまだありません', '日付の + から追加できます。'));
      state.planner.timelineActualSummary = model.timelineActualSummary;
      fitWeekTimelineColumns();
      patchWeekTimeline(target, '<div class="week-span" style="min-width:calc(var(--week-name-col) + ' + days.length + ' * var(--week-day-col,160px))">' + calendarTimelinePeriodsHtml('week', state.planner.key, days, grid) + header + meetings + interrupts + lanes + '</div>');
      target.dataset.timelineKey = state.planner.key;
      positionCalendarTimeline('week');
      scheduleBindPlannerRowDraggables();
    }

    function renderForecastTimeline() {
      renderWeekCalendar();
    }
