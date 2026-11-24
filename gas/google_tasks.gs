/**
 * 進行中のプロジェクト課題を、ユーザー自身の Google Tasks に同期する。
 * 課題名と Google Tasks の task ID の対応は UserProperties に保存し、
 * ウェブアプリ利用者ごとに別の Google Tasks リストを扱う。
 */
var GOOGLE_TASKS_SYNC_ENABLED_PROPERTY = "googleTasks.projectIssues.enabled.v1";
var GOOGLE_TASKS_AUTO_SYNC_PROPERTY = "googleTasks.projectIssues.autoSync.v1";
var GOOGLE_TASKS_TARGET_LIST_ID_PROPERTY = "googleTasks.projectIssues.targetListId.v1";
var GOOGLE_TASKS_TARGET_LIST_TITLE_PROPERTY = "googleTasks.projectIssues.targetListTitle.v1";
var GOOGLE_TASKS_TASK_ID_PROPERTY_PREFIX = "googleTasks.projectIssues.task.";

function requireGoogleTasksService() {
  if (typeof Tasks === "undefined" || !Tasks.Tasklists || !Tasks.Tasks) {
    throw new Error("Google Tasks API が有効になっていません。Apps Script の高度なサービスで Tasks API v1 を有効にしてください。");
  }
}

function googleTasksIsNotFoundError(error) {
  var message = String(error && error.message || error || "");
  return /\b404\b|not found|requested entity was not found/i.test(message);
}

function googleTasksListAllTasklists() {
  var items = [];
  var pageToken = "";
  do {
    var options = { maxResults: 100 };
    if (pageToken) options.pageToken = pageToken;
    var response = Tasks.Tasklists.list(options) || {};
    items = items.concat(response.items || []);
    pageToken = response.nextPageToken || "";
  } while (pageToken);
  return items;
}

function googleTasksPreference(properties) {
  return {
    enabled: properties.getProperty(GOOGLE_TASKS_SYNC_ENABLED_PROPERTY) === "true",
    autoSync: properties.getProperty(GOOGLE_TASKS_AUTO_SYNC_PROPERTY) === "true",
    targetListId: properties.getProperty(GOOGLE_TASKS_TARGET_LIST_ID_PROPERTY) || "",
    targetListTitle: properties.getProperty(GOOGLE_TASKS_TARGET_LIST_TITLE_PROPERTY) || ""
  };
}

/** タスクリスト一覧を開かずに、連携と自動同期の設定を読む。 */
function getGoogleTasksSyncPreference() {
  return googleTasksPreference(appUserProperties());
}

/** 設定画面を開いたときだけ Google Tasks のタスクリスト一覧を取得する。 */
function getGoogleTasksSyncSettings() {
  requireGoogleTasksService();
  var preference = googleTasksPreference(appUserProperties());
  return {
    enabled: preference.enabled,
    autoSync: preference.autoSync,
    targetListId: preference.targetListId,
    targetListTitle: preference.targetListTitle,
    tasklists: googleTasksListAllTasklists().map(function(list) {
      return { id: list.id || "", title: list.title || "" };
    }).filter(function(list) { return list.id && list.title; })
  };
}

/** 有効化と同期先の選択を保存する。新規リスト作成は設定画面で選んだ場合だけ行う。 */
function saveGoogleTasksSyncSettings(settings) {
  requireGoogleTasksService();
  var source = settings || {};
  var enabled = source.enabled === true;
  var autoSync = enabled && source.autoSync === true;
  var targetListId = String(source.targetListId || "").trim();
  var createListTitle = String(source.createListTitle || "").trim();
  if (createListTitle.length > 100) throw new Error("タスクリスト名は100文字以内で入力してください。");

  return withUserWriteLock(function() {
    var properties = appUserProperties();
    var tasklist = null;
    if (createListTitle) {
      if (!enabled) throw new Error("新しいリストを作る場合は、Google Tasks連携を有効にしてください。");
      tasklist = Tasks.Tasklists.insert({ title: createListTitle });
      if (!tasklist || !tasklist.id) throw new Error("Google Tasks のリストを作成できませんでした。");
      targetListId = tasklist.id;
    } else if (targetListId) {
      tasklist = googleTasksListAllTasklists().find(function(list) { return list && list.id === targetListId; }) || null;
      if (!tasklist) throw new Error("選択したタスクリストが見つかりません。設定画面で一覧を更新してください。");
    }

    if (enabled && !targetListId) throw new Error("連携を有効にするには同期先のタスクリストを選択してください。");
    properties.setProperty(GOOGLE_TASKS_SYNC_ENABLED_PROPERTY, enabled ? "true" : "false");
    properties.setProperty(GOOGLE_TASKS_AUTO_SYNC_PROPERTY, autoSync ? "true" : "false");
    if (targetListId) properties.setProperty(GOOGLE_TASKS_TARGET_LIST_ID_PROPERTY, targetListId);
    else properties.deleteProperty(GOOGLE_TASKS_TARGET_LIST_ID_PROPERTY);
    if (targetListId && tasklist && tasklist.title) properties.setProperty(GOOGLE_TASKS_TARGET_LIST_TITLE_PROPERTY, tasklist.title);
    else properties.deleteProperty(GOOGLE_TASKS_TARGET_LIST_TITLE_PROPERTY);
    return {
      enabled: enabled,
      autoSync: autoSync,
      targetListId: targetListId,
      targetListTitle: tasklist && tasklist.title || ""
    };
  });
}

// 同期先は保存済みのIDと名前を使う。リストの存在確認はタスク一覧の取得で兼ねる。
function googleTasksGetConfiguredTargetList(properties) {
  var preference = googleTasksPreference(properties);
  if (!preference.enabled) throw new Error("Google Tasks連携はオフです。設定の「Google Tasks」タブから有効にしてください。");
  if (!preference.targetListId) throw new Error("同期先が未設定です。設定の「Google Tasks」タブでタスクリストを選んでください。");
  return { id: preference.targetListId, title: preference.targetListTitle };
}

// 課題ごとに Tasks.get を呼ぶと1件100ms前後かかるため、同期先のタスクを一覧で一度に読む。
function googleTasksLoadTasksById(tasklistId) {
  var byId = {};
  var pageToken = "";
  try {
    do {
      var options = { maxResults: 100, showCompleted: true, showHidden: true, showDeleted: true };
      if (pageToken) options.pageToken = pageToken;
      var response = Tasks.Tasks.list(tasklistId, options) || {};
      (response.items || []).forEach(function(task) { if (task && task.id) byId[task.id] = task; });
      pageToken = response.nextPageToken || "";
    } while (pageToken);
  } catch (error) {
    if (!googleTasksIsNotFoundError(error)) throw error;
    throw new Error("同期先のタスクリストが見つかりません。設定画面で別のリストを選んでください。");
  }
  return byId;
}

function googleTasksIdentityPropertyKey(identity) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(identity || ""), Utilities.Charset.UTF_8);
  var hex = digest.map(function(value) {
    return ("0" + ((Number(value) + 256) % 256).toString(16)).slice(-2);
  }).join("");
  return GOOGLE_TASKS_TASK_ID_PROPERTY_PREFIX + hex;
}

function googleTasksProjectIssueSources(workspace, finished) {
  var byIdentity = {};
  (workspace && workspace.projects || []).forEach(function(project) {
    if (!project || project.status !== PROJECT_STATUS_ACTIVE) return;
    (project.issues || []).forEach(function(issue) {
      // 予定として保存されている課題だけ同期する。日次だけの作業とカレンダー実績は含めない。
      if (!issue || !issue.periodType) return;
      var active = issue.status === "稼働中" || issue.status === "進行中" || issue.status === "超過";
      if (finished) {
        if (!issue.done) return;
      } else if (issue.done || !active) {
        return;
      }
      var title = projectText(project.name) + " / " + projectText(issue.name);
      if (!projectText(project.id) || !projectText(project.name) || !projectText(issue.name)) return;
      var identity = project.id + "\u0000" + projectText(issue.name);
      if (!byIdentity[identity]) byIdentity[identity] = { identity: identity, title: title };
    });
  });
  return Object.keys(byIdentity).map(function(identity) { return byIdentity[identity]; }).sort(function(left, right) {
    return left.title.localeCompare(right.title, "ja");
  });
}

function googleTasksActiveProjectIssueSources(workspace) {
  return googleTasksProjectIssueSources(workspace, false);
}

function googleTasksFinishedProjectIssueSources(workspace) {
  return googleTasksProjectIssueSources(workspace, true);
}

function googleTasksSyncProjectIssue(source, tasklist, properties, tasksById) {
  var propertyKey = googleTasksIdentityPropertyKey(tasklist.id + "\u0000" + source.identity);
  var taskId = properties.getProperty(propertyKey) || "";
  var existing = taskId ? tasksById[taskId] || null : null;
  if (existing && (existing.deleted || existing.hidden)) existing = null;

  if (!existing) {
    var inserted = Tasks.Tasks.insert({ title: source.title, status: "needsAction" }, tasklist.id);
    if (!inserted || !inserted.id) throw new Error("課題「" + source.title + "」を Google Tasks に追加できませんでした。");
    properties.setProperty(propertyKey, inserted.id);
    return "created";
  }

  var patch = {};
  if (existing.title !== source.title) patch.title = source.title;
  if (existing.status !== "needsAction") {
    patch.status = "needsAction";
    patch.completed = null;
  }
  if (Object.keys(patch).length) {
    Tasks.Tasks.patch(patch, tasklist.id, existing.id);
    return "updated";
  }
  return "unchanged";
}

function googleTasksCompleteProjectIssue(source, tasklist, properties, tasksById) {
  var propertyKey = googleTasksIdentityPropertyKey(tasklist.id + "\u0000" + source.identity);
  var taskId = properties.getProperty(propertyKey) || "";
  if (!taskId) return "unchanged";
  var existing = tasksById[taskId] || null;
  if (!existing || existing.deleted || existing.hidden) {
    properties.deleteProperty(propertyKey);
    return "unchanged";
  }
  if (existing.status === "completed") return "unchanged";
  Tasks.Tasks.patch({
    id: existing.id,
    status: "completed",
    completed: new Date().toISOString()
  }, tasklist.id, existing.id);
  return "completed";
}

/** 指定月の進行中・超過の予定課題を、設定された Google Tasks リストへ追加・更新する。 */
function syncProjectIssuesToGoogleTasks(monthKey) {
  requireGoogleTasksService();
  var key = projectMonthKey(monthKey);
  googleTasksGetConfiguredTargetList(appUserProperties());
  // 課題の読み込みは時間がかかるため、保存処理を待たせないようロックの外で行う。
  var workspace = loadProjectWorkspace(key);
  var sources = googleTasksActiveProjectIssueSources(workspace);
  var finished = googleTasksFinishedProjectIssueSources(workspace);
  return withUserWriteLock(function() {
    var properties = appUserProperties();
    var tasklist = googleTasksGetConfiguredTargetList(properties);
    var tasksById = googleTasksLoadTasksById(tasklist.id);
    var result = { monthKey: key, taskListTitle: tasklist.title || "", total: sources.length, created: 0, updated: 0, unchanged: 0, completed: 0 };
    sources.forEach(function(source) {
      result[googleTasksSyncProjectIssue(source, tasklist, properties, tasksById)] += 1;
    });
    finished.forEach(function(source) {
      result[googleTasksCompleteProjectIssue(source, tasklist, properties, tasksById)] += 1;
    });
    return result;
  });
}
