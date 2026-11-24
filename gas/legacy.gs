/**
 * 古い版のデータのための処理（レガシー対応）。
 *
 * 今の形式で作ったデータには使われない。古い形式のファイルや、IDを持たない古い行を読み書きするときだけ通る。
 * 形式を変えたときの変換もここに足す（手順は gas/storage_schema.gs の先頭）。
 *
 * - 形式ごとの値の変換（APP_DB_MIGRATIONS）
 * - 形式8より前のファイルの修復（旧課題欄・重複ID・日付表記など）
 * - 予定IDを持たない古い予定へのIDの付与（budgetLegacyPlanId）
 */

// ---- 形式ごとの値の変換 ----
var APP_DB_MIGRATIONS = [
  { to: 11, description: "予定の優先順位を、週ごとの番号から全体で共通の順位（1024刻み）へ振り直す", run: appDbMigrateGlobalPlanPriority }
];
var APP_DB_PLAN_PRIORITY_STEP = 1024;

// 形式11: 優先順位は週の中での番号だったが、予定ごとに全体で共通の順位にする。
// 登録した週の古い順・週の中の順で 1024 刻みに振り直し、同じ名前の予定は最初の予定の順位を引き継ぐ。
// 前の週から引き継いだ行は、登録した週の予定と同じ順位にそろえる。
function appDbMigrateGlobalPlanPriority(spreadsheetId) {
  var values = appFetchTableValues(spreadsheetId, BUDGET_PLAN_SHEET_NAME);
  if (!values || values.length < 2) return;
  var column = function(name) { return BUDGET_PLAN_HEADER.indexOf(name); };
  var col = { type: column("期間種別"), key: column("期間キー"), name: column("集計キー"), priority: column("優先順位"), id: column("予定ID"), carry: column("繰越元週"), calendar: column("カレンダーキー") };
  var rows = values.slice(1).map(function(row, index) { return { row: row, index: index }; });
  var cell = function(entry, name) { return appDbSchemaText(entry.row[col[name]]); };
  var isWeek = function(entry) { return cell(entry, "type") === BUDGET_PERIOD_WEEK && !cell(entry, "calendar"); };
  var oldPriority = function(entry) { var value = Number(entry.row[col.priority]); return isFinite(value) ? value : entry.index; };
  var origins = rows.filter(function(entry) { return isWeek(entry) && !cell(entry, "carry"); }).sort(function(left, right) {
    var a = cell(left, "key"), b = cell(right, "key");
    return a < b ? -1 : a > b ? 1 : oldPriority(left) - oldPriority(right) || left.index - right.index;
  });
  var byName = {}, byId = {}, next = 0, priorities = {};
  origins.forEach(function(entry) {
    var name = cell(entry, "name");
    if (byName[name] == null) byName[name] = (++next) * APP_DB_PLAN_PRIORITY_STEP;
    priorities[entry.index] = byName[name];
    if (cell(entry, "id")) byId[cell(entry, "id")] = byName[name];
  });
  rows.forEach(function(entry) {
    if (!isWeek(entry) || !cell(entry, "carry")) return;
    var inherited = byId[cell(entry, "id")] != null ? byId[cell(entry, "id")] : byName[cell(entry, "name")];
    if (inherited != null) priorities[entry.index] = inherited;
  });
  var letter = appDbColumnLetter(col.priority);
  sheetsValuesUpdate(spreadsheetId, a1Range(BUDGET_PLAN_SHEET_NAME, letter + "2:" + letter + (rows.length + 1)), rows.map(function(entry) {
    return [priorities[entry.index] != null ? priorities[entry.index] : entry.row[col.priority]];
  }));
}

// ---- 形式8より前のファイルの修復 ----
// 形式8より前のファイルだけ、旧形式の値（旧課題欄・重複ID・日付表記など）まで直す修復処理を通す。
var APP_DB_LEGACY_REPAIR_BELOW = 8;

function appDbSchemaNormalizeDailyPlan(value) {
  var raw = appDbSchemaText(value);
  if (!raw) return "";
  var parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) {}
  if (parsed && typeof parsed === "object") {
    try {
      var normalized = normalizeBudgetDailyPlan(parsed);
      return Object.keys(normalized).length ? JSON.stringify(normalized) : "";
    } catch (_) {}
  }
  var result = {};
  raw.split(",").forEach(function(part) {
    var item = appDbSchemaText(part);
    var separator = item.lastIndexOf(":");
    if (separator < 1) return;
    var date = item.slice(0, separator).replace(/[/.]/g, "-");
    var hours = Number(item.slice(separator + 1));
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(date) || !isFinite(hours) || hours < 0) return;
    var pieces = date.split("-");
    result[pieces[0] + "-" + budgetPad2(pieces[1]) + "-" + budgetPad2(pieces[2])] = roundHours(hours);
  });
  return Object.keys(result).length ? JSON.stringify(result) : "";
}

function appDbSchemaStableId(prefix, parts, used) {
  var source = [prefix].concat(parts || []).join("\u0000");
  var hash = 2166136261;
  for (var index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  var base = prefix + "-" + (hash >>> 0).toString(36);
  var id = base;
  var suffix = 1;
  while (used && used[id]) id = base + "-" + suffix++;
  if (used) used[id] = true;
  return id;
}

function appDbSchemaLegacyIssues(value) {
  var source = value;
  var result = [];
  var seen = {};
  if (source && typeof source === "string") {
    var raw = source.trim();
    if (!raw) return result;
    if (raw.charAt(0) === "[") {
      try { source = JSON.parse(raw); } catch (_) { source = raw; }
    }
    if (typeof source === "string") {
      source.split(/\r?\n|;/).forEach(function(part) {
        var item = appDbSchemaText(part);
        if (!item) return;
        var separator = item.lastIndexOf(":");
        var title = separator >= 0 ? appDbSchemaText(item.slice(0, separator)) : item;
        var hours = separator >= 0 ? Number(item.slice(separator + 1)) : 0;
        if (!title || seen[title]) return;
        seen[title] = true;
        result.push({ title: title, plannedHours: isFinite(hours) && hours >= 0 ? roundHours(hours) : 0 });
      });
      return result;
    }
  }
  if (Array.isArray(source)) {
    source.forEach(function(item) {
      var title = appDbSchemaText(item && (item.title != null ? item.title : item.name));
      var hours = Number(item && (item.plannedHours != null ? item.plannedHours : item.hours));
      if (!title || seen[title]) return;
      seen[title] = true;
      result.push({ title: title, plannedHours: isFinite(hours) && hours >= 0 ? roundHours(hours) : 0 });
    });
  }
  return result;
}

function appDbSchemaRepairPlanSheet(spreadsheetId, options) {
  options = options || {};
  var migrateLegacyDoneColumn = options.migrateLegacyDoneColumn !== false;
  appDbSchemaEnsureSheet(spreadsheetId, BUDGET_PLAN_SHEET_NAME, BUDGET_PLAN_HEADER);
  var table = appDbSchemaTable(spreadsheetId, BUDGET_PLAN_SHEET_NAME, BUDGET_PLAN_HEADER, APP_DB_PLAN_ALIASES);
  var legacyIssueIndex = table.header.indexOf("課題");
  // 「課題」が旧来の親予定名そのものなら、親名をサブタスクとして複製しない。
  if (legacyIssueIndex >= 0 && legacyIssueIndex === table.indexes.aggregationKey &&
      table.header.indexOf("集計キー") < 0 && table.header.indexOf("集計") < 0 &&
      table.header.indexOf("タスク名") < 0 && table.header.indexOf("aggregationKey") < 0) {
    legacyIssueIndex = -1;
  }
  var usedIds = {};
  var rows = [];
  var legacyIssues = [];
  var updatedAt = appDbSchemaNow();
  table.values.forEach(function(row, index) {
    var name = appDbSchemaText(appDbSchemaCell(row, table.indexes.aggregationKey));
    if (!name) return;
    var type = appDbSchemaNormalizePeriodType(appDbSchemaCell(row, table.indexes.periodType));
    var key = appDbSchemaNormalizePeriodKey(appDbSchemaCell(row, table.indexes.periodKey), type);
    var createdAt = appDbSchemaText(appDbSchemaCell(row, table.indexes.createdAt))
      || appDbSchemaText(appDbSchemaCell(row, table.indexes.updatedAt))
      || updatedAt;
    var planId = budgetStableId(appDbSchemaCell(row, table.indexes.planId));
    if (!planId || usedIds[planId]) planId = budgetLegacyPlanId(type, key, name, createdAt + "\u0000" + index);
    while (usedIds[planId]) planId = appDbSchemaStableId("legacy-plan", [type, key, name, index], usedIds);
    usedIds[planId] = true;
    var planned = appDbSchemaCell(row, table.indexes.plannedHours);
    var plannedNumber = Number(planned);
    if (!isFinite(plannedNumber) || plannedNumber < 0) plannedNumber = 0;
    var estimate = appDbSchemaCell(row, table.indexes.estimatedTotalHours);
    var initial = appDbSchemaCell(row, table.indexes.initialPlannedHours);
    var priority = appDbSchemaCell(row, table.indexes.priority);
    if (priority === "" || priority == null || !isFinite(Number(priority))) priority = index;
    var planKind = appDbSchemaText(appDbSchemaCell(row, table.indexes.planKind)) === "added" ? "added" : "initial";
    var dailyPlan = appDbSchemaNormalizeDailyPlan(appDbSchemaCell(row, table.indexes.dailyPlan));
    var done = appDbSchemaCell(row, table.indexes.done);
    // v1 までは保存時に未完了も FALSE と書いていた。v2 では空欄を自動判定、
    // FALSE を「自動判定を無視して未完了」とするため、初回移行時だけ FALSE を空欄へ戻す。
    if (migrateLegacyDoneColumn && done !== "" && done != null && !budgetBoolean(done)) done = "";
    rows.push([
      type,
      key,
      sanitizeEnteredString(name),
      roundHours(plannedNumber),
      sanitizeEnteredString(appDbSchemaCell(row, table.indexes.note)),
      appDbSchemaText(appDbSchemaCell(row, table.indexes.updatedAt)) || updatedAt,
      priority,
      estimate === "" || estimate == null ? roundHours(plannedNumber) : estimate,
      initial === "" || initial == null ? roundHours(plannedNumber) : initial,
      planKind,
      createdAt,
      planId,
      budgetPlanDateValue(appDbSchemaCell(row, table.indexes.startDate)) || appDbSchemaText(appDbSchemaCell(row, table.indexes.startDate)),
      appDbSchemaCell(row, table.indexes.dailyCap),
      appDbSchemaText(appDbSchemaCell(row, table.indexes.carryWeek)),
      sanitizeEnteredString(appDbSchemaCell(row, table.indexes.calendarKey)),
      done,
      dailyPlan,
      budgetStableId(appDbSchemaCell(row, table.indexes.projectId)),
      budgetIssueUrl(appDbSchemaCell(row, table.indexes.issueUrl)),
      budgetPlanProgressLabel(appDbSchemaCell(row, table.indexes.progress)),
      appDbSchemaText(appDbSchemaCell(row, table.indexes.endDate)) === BUDGET_PLAN_UNDATED
        ? BUDGET_PLAN_UNDATED
        : budgetPlanDateValue(appDbSchemaCell(row, table.indexes.endDate))
    ]);
    if (legacyIssueIndex >= 0) {
      appDbSchemaLegacyIssues(appDbSchemaCell(row, legacyIssueIndex)).forEach(function(issue) {
        legacyIssues.push({
          periodType: type,
          periodKey: key,
          parentKey: name,
          parentPlanId: planId,
          title: issue.title,
          plannedHours: issue.plannedHours
        });
      });
    }
  });
  appDbSchemaWriteTable(spreadsheetId, BUDGET_PLAN_SHEET_NAME, BUDGET_PLAN_HEADER, rows, table.values.length);
  appDbSchemaInvalidateSheetCache(spreadsheetId, BUDGET_PLAN_SHEET_NAME);
  if (typeof putCachedSheetValues === "function") putCachedSheetValues(spreadsheetId, BUDGET_PLAN_SHEET_NAME, rows);
  return { rows: rows, legacyIssues: legacyIssues };
}

function appDbSchemaPlanLookup(planRows) {
  var byName = {};
  var byId = {};
  (planRows || []).forEach(function(row) {
    var plan = budgetPersistedPlanFromRow(row);
    if (!plan) return;
    var key = plan.periodType + "\u0000" + plan.periodKey + "\u0000" + plan.aggregationKey;
    if (Object.prototype.hasOwnProperty.call(byName, key)) byName[key] = null;
    else byName[key] = plan.planId || "";
    if (plan.planId) byId[plan.planId] = plan.aggregationKey;
  });
  return { byName: byName, byId: byId };
}

function appDbSchemaNormalizeTaskDate(value) {
  var raw = appDbSchemaText(value);
  if (!raw) return "";
  var normalized = budgetDateCellKey(value, Session.getScriptTimeZone() || "Asia/Tokyo");
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : raw;
}

function appDbSchemaTaskStatus(value) {
  try { return normalizePlanningTaskStatus(value); }
  catch (_) { return PLANNING_TASK_STATUS_TODO; }
}

function appDbSchemaRepairTaskSheet(spreadsheetId, planInfo) {
  appDbSchemaEnsureSheet(spreadsheetId, PLANNING_TASK_SHEET_NAME, PLANNING_TASK_HEADER);
  var table = appDbSchemaTable(spreadsheetId, PLANNING_TASK_SHEET_NAME, PLANNING_TASK_HEADER, APP_DB_TASK_ALIASES);
  var lookup = appDbSchemaPlanLookup(planInfo.rows);
  var usedIds = {};
  var rows = [];
  var taskKeys = {};
  var updatedAt = appDbSchemaNow();

  function addTask(source, index) {
    var title = appDbSchemaText(source.title);
    var parentKey = appDbSchemaText(source.parentKey);
    if (!title || !parentKey) return;
    var type = appDbSchemaNormalizePeriodType(source.periodType);
    var key = appDbSchemaNormalizePeriodKey(source.periodKey, type);
    var parentId = budgetStableId(source.parentPlanId);
    if (!parentId) parentId = lookup.byName[type + "\u0000" + key + "\u0000" + parentKey] || "";
    var identity = type + "\u0000" + key + "\u0000" + (parentId || parentKey) + "\u0000" + title;
    if (taskKeys[identity]) return;
    taskKeys[identity] = true;
    var id = budgetStableId(source.id);
    if (!id || usedIds[id]) id = appDbSchemaStableId("legacy-subtask", [type, key, parentKey, title, index], usedIds);
    usedIds[id] = true;
    var planned = Number(source.plannedHours);
    if (!isFinite(planned) || planned < 0) planned = 0;
    rows.push([
      sanitizeEnteredString(id),
      type,
      key,
      sanitizeEnteredString(parentKey),
      sanitizeEnteredString(title),
      roundHours(planned),
      appDbSchemaNormalizeTaskDate(source.dueDate),
      appDbSchemaTaskStatus(source.status),
      sanitizeEnteredString(source.note),
      isFinite(Number(source.sortOrder)) && Number(source.sortOrder) >= 0 ? Math.floor(Number(source.sortOrder)) : index,
      appDbSchemaText(source.updatedAt) || updatedAt,
      parentId
    ]);
  }

  table.values.forEach(function(row, index) {
    addTask({
      id: appDbSchemaCell(row, table.indexes.id),
      periodType: appDbSchemaCell(row, table.indexes.periodType),
      periodKey: appDbSchemaCell(row, table.indexes.periodKey),
      parentKey: appDbSchemaCell(row, table.indexes.parentKey),
      title: appDbSchemaCell(row, table.indexes.title),
      plannedHours: appDbSchemaCell(row, table.indexes.plannedHours),
      dueDate: appDbSchemaCell(row, table.indexes.dueDate),
      status: appDbSchemaCell(row, table.indexes.status),
      note: appDbSchemaCell(row, table.indexes.note),
      sortOrder: appDbSchemaCell(row, table.indexes.sortOrder),
      updatedAt: appDbSchemaCell(row, table.indexes.updatedAt),
      parentPlanId: appDbSchemaCell(row, table.indexes.parentPlanId)
    }, index);
  });
  (planInfo.legacyIssues || []).forEach(function(issue, index) {
    addTask({
      id: "",
      periodType: issue.periodType,
      periodKey: issue.periodKey,
      parentKey: issue.parentKey,
      title: issue.title,
      plannedHours: issue.plannedHours,
      dueDate: "",
      status: PLANNING_TASK_STATUS_TODO,
      note: "",
      sortOrder: index,
      updatedAt: updatedAt,
      parentPlanId: issue.parentPlanId
    }, table.values.length + index);
  });
  appDbSchemaWriteTable(spreadsheetId, PLANNING_TASK_SHEET_NAME, PLANNING_TASK_HEADER, rows, table.values.length);
  appDbSchemaInvalidateSheetCache(spreadsheetId, PLANNING_TASK_SHEET_NAME);
  if (typeof putCachedSheetValues === "function") putCachedSheetValues(spreadsheetId, PLANNING_TASK_SHEET_NAME, rows);
  return rows;
}

function appDbSchemaRepairSimpleSheet(spreadsheetId, sheetName, canonicalHeader, aliases) {
  var existing = findSheetEntry(sheetsGetMeta(spreadsheetId), sheetName);
  if (!existing) return;
  var table = appDbSchemaTable(spreadsheetId, sheetName, canonicalHeader, aliases);
  var rows = table.values.map(function(row) {
    return canonicalHeader.map(function(_, index) {
      var field = Object.keys(aliases).filter(function(name) { return aliases[name].indexOf(canonicalHeader[index]) >= 0; })[0];
      return field ? appDbSchemaCell(row, table.indexes[field]) : "";
    });
  });
  appDbSchemaWriteTable(spreadsheetId, sheetName, canonicalHeader, rows, table.values.length);
  appDbSchemaInvalidateSheetCache(spreadsheetId, sheetName);
  if (typeof putCachedSheetValues === "function") putCachedSheetValues(spreadsheetId, sheetName, rows);
}

function appDbSchemaRepairSpreadsheet(spreadsheetId, options) {
  requireSheetsApi();
  var planInfo = appDbSchemaRepairPlanSheet(spreadsheetId, options);
  appDbSchemaRepairTaskSheet(spreadsheetId, planInfo);
  var meta = sheetsGetMeta(spreadsheetId);
  (meta.sheets || []).forEach(function(sheet) {
    var title = sheet.properties && sheet.properties.title;
    if (!title || APP_DB_RETIRED_SHEET_NAMES.indexOf(title) >= 0) return;
    if (parseSheetMonth(title)) {
      appDbSchemaRepairSimpleSheet(spreadsheetId, title, SHEET_HEADER, APP_DB_DAILY_ALIASES);
    } else if (title === WORK_CAPACITY_SHEET_NAME) {
      appDbSchemaRepairSimpleSheet(spreadsheetId, title, WORK_CAPACITY_HEADER, APP_DB_CAPACITY_ALIASES);
    } else if (title === CALENDAR_EXCLUSION_SHEET_NAME) {
      appDbSchemaRepairSimpleSheet(spreadsheetId, title, CALENDAR_EXCLUSION_HEADER, APP_DB_EXCLUSION_ALIASES);
    } else if (typeof PROJECT_SHEET_NAME !== "undefined" && title === PROJECT_SHEET_NAME) {
      appDbSchemaRepairSimpleSheet(spreadsheetId, title, PROJECT_HEADER, APP_DB_PROJECT_ALIASES);
    } else if (typeof PROJECT_MONTHLY_SHEET_NAME !== "undefined" && title === PROJECT_MONTHLY_SHEET_NAME) {
      appDbSchemaRepairSimpleSheet(spreadsheetId, title, PROJECT_MONTHLY_HEADER, APP_DB_PROJECT_MONTHLY_ALIASES);
    }
  });
  meta = sheetsGetMeta(spreadsheetId);
  // 使わなくなったシート（週次報告など）は中身が残っている可能性があるため削除しない。
  // 削除するのは、作成時に自動で付く空の既定シートだけ。
  var defaultRequests = (meta.sheets || []).map(function(sheet) {
    var title = sheet.properties && sheet.properties.title;
    var values = isDefaultSheetTitle(title) ? appDbSchemaRead(spreadsheetId, title, "A1:AZ") : [];
    var occupied = values.some(function(row) {
      return (row || []).some(function(value) { return appDbSchemaText(value) !== ""; });
    });
    return isDefaultSheetTitle(title) && !occupied
      ? { deleteSheet: { sheetId: sheet.properties.sheetId } }
      : null;
  }).filter(function(request) { return !!request; });
  var requests = defaultRequests;
  if (requests.length && (meta.sheets || []).length > requests.length) sheetsBatchUpdate(spreadsheetId, requests);
  return {
    spreadsheetId: spreadsheetId,
    version: appDbSchemaVersion(),
    removedSheets: []
  };
}

// ---- 予定IDを持たない古い予定 ----
// 予定IDのない古い予定行に、期間・名前・登録日時から決まるIDを付ける（読み込み・保存のたびに同じIDになる）。
function budgetLegacyPlanId(periodType, periodKey, aggregationKey, createdAt) {
  var source = [periodType, periodKey, aggregationKey, createdAt].join("\u0000");
  var hash = 2166136261;
  for (var i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return "legacy-" + (hash >>> 0).toString(36);
}
