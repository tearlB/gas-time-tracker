/**
 * 週次・月次計画に紐づくサブタスク管理。
 *
 * 親タスクと予定工数は budget.gs の「予実計画」を正本とし、このシートには
 * 分解した作業だけを保存する。日次シートの形式は変更しない。
 */
var PLANNING_TASK_SHEET_NAME = "予定タスク";
var PLANNING_TASK_HEADER = [
  "ID", "期間種別", "期間キー", "親タスク", "サブタスク", "予定工数",
  "期限", "状態", "メモ", "並び順", "更新日時", "親予定ID"
];
var PLANNING_TASK_STATUS_TODO = "todo";
var PLANNING_TASK_STATUS_DOING = "doing";
var PLANNING_TASK_STATUS_DONE = "done";
var CALENDAR_EXCLUSION_SHEET_NAME = "カレンダー除外";
var CALENDAR_EXCLUSION_HEADER = ["イベントキー", "更新日時"];
var WORK_CAPACITY_SHEET_NAME = "稼働設定";
var WORK_CAPACITY_HEADER = ["日付", "稼働可能時間", "理由", "更新日時"];

function readOptionalSheetValues(spreadsheetId, sheetName, range) {
  try {
    var response = Sheets.Spreadsheets.Values.get(spreadsheetId, a1Range(sheetName, range), VALUES_GET_OPTS);
    return response.values || [];
  } catch (err) {
    if (typeof isMissingSheet === "function" && isMissingSheet(err)) return [];
    if (typeof isMissingSpreadsheet === "function" && isMissingSpreadsheet(err)) return [];
    Logger.log(sheetName + " read skipped: " + (err && err.message ? err.message : err));
    return [];
  }
}

// 無いことがあるシートを、見出し名で正本の列順にして読む。
function readOptionalTableRows(spreadsheetId, sheetName, legacyRange) {
  if (typeof appTableRowsFromValues !== "function") return readOptionalSheetValues(spreadsheetId, sheetName, legacyRange);
  return appTableRowsFromValues(sheetName, readOptionalSheetValues(spreadsheetId, sheetName, "A1:" + APP_TABLE_READ_LAST_COLUMN)).rows;
}

function loadWorkCapacitySettings(startYmd, endExclusiveYmd) {
  var result = {};
  annualSpreadsheetIdsForRange(startYmd, endExclusiveYmd).forEach(function(spreadsheetId) {
    readOptionalTableRows(spreadsheetId, WORK_CAPACITY_SHEET_NAME, "A2:D").forEach(function(row) {
      var dateKey = budgetDateCellKey(row[0], Session.getScriptTimeZone() || "Asia/Tokyo");
      if (dateKey >= startYmd && dateKey < endExclusiveYmd) result[dateKey] = { hours: Math.max(0, roundHours(row[1])), reason: String(row[2] || "") };
    });
  });
  return result;
}

function saveWorkCapacitySetting(dateValue, hoursValue, reasonValue) {
  return withUserWriteLock(function() {
    return saveWorkCapacitySettingLocked(dateValue, hoursValue, reasonValue);
  });
}

function saveWorkCapacitySettingLocked(dateValue, hoursValue, reasonValue) {
  var dateKey = String(dateValue || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("日付が不正です。");
  var hours = roundHours(hoursValue);
  if (!isFinite(hours) || hours < 0 || hours > 24) throw new Error("稼働時間は0〜24時間で指定してください。");
  var spreadsheetId = requireSpreadsheetIdForDate(dateKey);
  var existingRows = [];
  try {
    var loaded = typeof loadSheetValuesDirect === "function"
      ? loadSheetValuesDirect(spreadsheetId, WORK_CAPACITY_SHEET_NAME)
      : { values: (Sheets.Spreadsheets.Values.get(spreadsheetId, a1Range(WORK_CAPACITY_SHEET_NAME, "A2:D"), VALUES_GET_OPTS).values || []) };
    existingRows = loaded.values || [];
  }
  catch (err) { if (!isMissingSheet(err)) throw err; }
  var meta = sheetsGetMeta(spreadsheetId);
  if (!findSheetEntry(meta, WORK_CAPACITY_SHEET_NAME)) sheetsBatchUpdate(spreadsheetId, [{ addSheet: { properties: { sheetId: generateSheetId(meta), title: WORK_CAPACITY_SHEET_NAME, gridProperties: { frozenRowCount: 1 } } } }]);
  var rows = existingRows.filter(function(row) { return budgetDateCellKey(row[0], Session.getScriptTimeZone() || "Asia/Tokyo") !== dateKey; });
  rows.push([dateKey.replace(/-/g, "/"), roundHours(hours), sanitizeEnteredString(reasonValue || ""), Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss")]);
  rows.sort(function(a, b) { return String(a[0]).localeCompare(String(b[0])); });
  var values = [WORK_CAPACITY_HEADER].concat(rows);
  sheetsValuesUpdate(spreadsheetId, a1Range(WORK_CAPACITY_SHEET_NAME, "A1:D" + values.length), values);
  if (existingRows.length > rows.length) sheetsValuesClear(spreadsheetId, a1Range(WORK_CAPACITY_SHEET_NAME, "A" + (rows.length + 2) + ":D" + (existingRows.length + 1)));
  if (typeof putCachedSheetValues === "function") putCachedSheetValues(spreadsheetId, WORK_CAPACITY_SHEET_NAME, rows);
  return { date: dateKey, hours: hours, reason: String(reasonValue || "") };
}

function loadCalendarExclusions(spreadsheetId) {
  if (!spreadsheetId) return [];
  if (typeof loadSheetValuesDirect === "function") {
    var loaded = loadSheetValuesDirect(spreadsheetId, CALENDAR_EXCLUSION_SHEET_NAME);
    return (loaded.values || []).map(function(row) { return String(row[0] || ""); }).filter(Boolean);
  }
  try {
    var response = Sheets.Spreadsheets.Values.get(spreadsheetId, a1Range(CALENDAR_EXCLUSION_SHEET_NAME, "A2:A"), VALUES_GET_OPTS);
    return (response.values || []).map(function(row) { return String(row[0] || ""); }).filter(Boolean);
  } catch (err) {
    if (isMissingSheet(err)) return [];
    throw err;
  }
}

function saveCalendarExclusions(spreadsheetId, eventKeys) {
  var keys = (eventKeys || []).map(function(key) { return String(key || "").trim(); }).filter(Boolean);
  keys = keys.filter(function(key, index) { return keys.indexOf(key) === index; }).sort();
  var meta = sheetsGetMeta(spreadsheetId);
  var existing = findSheetEntry(meta, CALENDAR_EXCLUSION_SHEET_NAME);
  if (!existing) {
    sheetsBatchUpdate(spreadsheetId, [{ addSheet: { properties: { sheetId: generateSheetId(meta), title: CALENDAR_EXCLUSION_SHEET_NAME, gridProperties: { frozenRowCount: 1 } } } }]);
  }
  var oldCount = loadCalendarExclusions(spreadsheetId).length;
  var updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  var values = [CALENDAR_EXCLUSION_HEADER].concat(keys.map(function(key) { return [key, updatedAt]; }));
  sheetsValuesUpdate(spreadsheetId, a1Range(CALENDAR_EXCLUSION_SHEET_NAME, "A1:B" + values.length), values);
  if (oldCount > keys.length) sheetsValuesClear(spreadsheetId, a1Range(CALENDAR_EXCLUSION_SHEET_NAME, "A" + (keys.length + 2) + ":B" + (oldCount + 1)));
  if (typeof putCachedSheetValues === "function") putCachedSheetValues(spreadsheetId, CALENDAR_EXCLUSION_SHEET_NAME, values.slice(1));
}

function normalizePlanningTaskStatus(value) {
  var raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw || raw === "todo" || raw === "未着手") return PLANNING_TASK_STATUS_TODO;
  if (raw === "doing" || raw === "進行中") return PLANNING_TASK_STATUS_DOING;
  if (raw === "done" || raw === "完了") return PLANNING_TASK_STATUS_DONE;
  throw new Error("サブタスクの状態が不正です。");
}

function normalizePlanningDueDate(value, periodType, periodKey) {
  var raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("サブタスクの期限は YYYY-MM-DD 形式で指定してください。");
  }
  var parsed = budgetDateFromYmd(raw);
  if (isNaN(parsed.getTime()) || budgetYmd(parsed) !== raw) {
    throw new Error("サブタスクの期限が正しい日付ではありません。");
  }
  var range = getBudgetPeriodRange(periodType, periodKey);
  if (raw < range.startYmd || raw >= range.endExclusiveYmd) {
    throw new Error("サブタスクの期限は選択中の期間内に設定してください。");
  }
  return raw;
}

function normalizePlanningTask(task, index, expectedType, expectedKey, parentKeys, parentIds) {
  var source = task || {};
  var periodType = normalizeBudgetPeriodType(source.periodType || expectedType);
  var periodKey = normalizeBudgetPeriodKey(periodType, source.periodKey || expectedKey);
  var id = String(source.id == null ? "" : source.id).trim();
  var parentKey = String(source.parentKey == null ? "" : source.parentKey).trim();
  var parentPlanId = budgetStableId(source.parentPlanId);
  var title = String(source.title == null ? "" : source.title).trim();
  var plannedHours = Number(source.plannedHours);
  var sortOrder = Number(source.sortOrder);

  if (periodType !== expectedType || periodKey !== expectedKey) {
    throw new Error("一度に保存できるサブタスクは一つの期間だけです。");
  }
  if (!id || id.length > 100) throw new Error("サブタスク ID が不正です (index: " + index + ")。");
  if (parentPlanId) {
    if (!parentIds[parentPlanId]) {
      throw new Error("サブタスクの親タスクが見つかりません (index: " + index + ")。");
    }
    parentKey = parentIds[parentPlanId];
  } else if (!parentKey || !Object.prototype.hasOwnProperty.call(parentKeys, parentKey)) {
    throw new Error("サブタスクの親タスクが見つかりません (index: " + index + ")。");
  }
  if (!title) throw new Error("サブタスク名を入力してください (index: " + index + ")。");
  if (title.length > 200) throw new Error("サブタスク名は 200 文字以内で指定してください。");
  if (!isFinite(plannedHours) || plannedHours < 0) {
    throw new Error("サブタスクの予定工数は 0 以上の数値で指定してください。");
  }

  return {
    id: id,
    periodType: periodType,
    periodKey: periodKey,
    parentKey: parentKey,
    parentPlanId: parentPlanId || parentKeys[parentKey] || "",
    title: title,
    plannedHours: roundHours(plannedHours),
    dueDate: normalizePlanningDueDate(source.dueDate, periodType, periodKey),
    status: normalizePlanningTaskStatus(source.status),
    note: String(source.note == null ? "" : source.note).trim(),
    sortOrder: isFinite(sortOrder) && sortOrder >= 0 ? Math.floor(sortOrder) : index
  };
}

function normalizePlanningTasks(tasks, periodType, periodKey, plans) {
  var type = normalizeBudgetPeriodType(periodType);
  var key = normalizeBudgetPeriodKey(type, periodKey);
  var parentKeys = {};
  var parentIds = {};
  var seen = {};
  (plans || []).forEach(function(plan) {
    var name = String((plan && plan.aggregationKey) || "").trim();
    if (plan.planId) parentIds[plan.planId] = plan.aggregationKey;
    if (!name) return;
    parentKeys[name] = Object.prototype.hasOwnProperty.call(parentKeys, name) ? null : (plan.planId || "");
  });
  Object.keys(parentKeys).forEach(function(name) {
    if (parentKeys[name] == null) delete parentKeys[name];
  });
  var normalizedTasks = (tasks || []).map(function(task, index) {
    var normalized = normalizePlanningTask(task, index, type, key, parentKeys, parentIds);
    if (seen[normalized.id]) throw new Error("サブタスク ID が重複しています。");
    seen[normalized.id] = true;
    return normalized;
  });
  assertPlanningIssueHoursWithinPlans(normalizedTasks, plans);
  return normalizedTasks;
}

function assertPlanningIssueHoursWithinPlans(tasks, plans) {
  var limits = {};
  (plans || []).forEach(function(plan) {
    var hours = roundHours(Number(plan.plannedHours) || 0);
    if (plan.planId) limits[plan.planId] = hours;
    if (plan.aggregationKey) limits[plan.aggregationKey] = hours;
  });
  var totals = {};
  (tasks || []).forEach(function(task) {
    var parent = String(task.parentPlanId || task.parentKey || "").trim();
    if (!parent) return;
    totals[parent] = roundHours((totals[parent] || 0) + Number(task.plannedHours || 0));
  });
  Object.keys(totals).forEach(function(parent) {
    if (limits[parent] == null) return;
    if (totals[parent] > limits[parent]) {
      throw new Error("課題「" + parent + "」の予定工数合計が予定を超えています。");
    }
  });
}

function loadPlanningTaskRows(spreadsheetId) {
  requireSheetsApi();
  // 予定タスクも予実計画と同じくキャッシュから読む。アプリの書き込みは必ずキャッシュも更新し、
  // 保存処理の中ではシートを読み直し、シートを直接編集したときはキャッシュを捨てる（code.gs）ため、
  // 古い内容を表示し続けることはない。
  var canUseCache = typeof getCachedSheetValues === "function" && typeof putCachedSheetValues === "function";
  if (canUseCache) {
    var cached = getCachedSheetValues(spreadsheetId, PLANNING_TASK_SHEET_NAME);
    if (cached != null) return cached;
  }
  try {
    if (typeof appReadTableRows === "function") {
      var rows = appReadTableRows(spreadsheetId, PLANNING_TASK_SHEET_NAME);
      if (canUseCache) putCachedSheetValues(spreadsheetId, PLANNING_TASK_SHEET_NAME, rows);
      return rows;
    }
    var response = Sheets.Spreadsheets.Values.get(
      spreadsheetId,
      a1Range(PLANNING_TASK_SHEET_NAME, "A2:L"),
      VALUES_GET_OPTS
    );
    return response.values || [];
  } catch (err) {
    if (isMissingSheet(err)) return [];
    throw err;
  }
}

function planningTaskFromRow(row) {
  try {
    var type = normalizeBudgetPeriodType(row[1]);
    var key = normalizeBudgetPeriodKey(type, row[2]);
    return {
      id: String(row[0] || ""),
      periodType: type,
      periodKey: key,
      parentKey: String(row[3] || ""),
      title: String(row[4] || ""),
      plannedHours: roundHours(budgetNumber(row[5])),
      dueDate: row[6] === "" || row[6] == null
        ? ""
        : budgetDateCellKey(row[6], Session.getScriptTimeZone() || "Asia/Tokyo"),
      status: normalizePlanningTaskStatus(row[7]),
      note: String(row[8] || ""),
      sortOrder: Math.max(0, parseInt(row[9], 10) || 0),
      parentPlanId: budgetStableId(row[11])
    };
  } catch (err) {
    Logger.log("予定タスクの不正な行を無視しました: " + err.message);
    return null;
  }
}

function ensurePlanningTaskSheet(spreadsheetId) {
  var meta = sheetsGetMeta(spreadsheetId);
  var existing = findSheetEntry(meta, PLANNING_TASK_SHEET_NAME);
  if (existing) return existing;
  var sheetId = generateSheetId(meta);
  sheetsBatchUpdate(spreadsheetId, [{
    addSheet: {
      properties: {
        sheetId: sheetId,
        title: PLANNING_TASK_SHEET_NAME,
        gridProperties: { frozenRowCount: 1 }
      }
    }
  }]);
  sheetsValuesUpdate(spreadsheetId, a1Range(PLANNING_TASK_SHEET_NAME, "A1:L1"), [PLANNING_TASK_HEADER]);
  return { properties: { sheetId: sheetId, title: PLANNING_TASK_SHEET_NAME } };
}

function loadPlanningTasksForPeriod(spreadsheetId, periodType, periodKey) {
  var type = normalizeBudgetPeriodType(periodType);
  var key = normalizeBudgetPeriodKey(type, periodKey);
  if (!spreadsheetId) return [];
  return loadPlanningTaskRows(spreadsheetId).map(planningTaskFromRow).filter(function(task) {
    return task && task.periodType === type && task.periodKey === key;
  }).sort(function(a, b) {
    if (a.parentKey !== b.parentKey) return a.parentKey < b.parentKey ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

function planningTaskProgress(tasks) {
  var result = { total: 0, done: 0, plannedHours: 0, doneHours: 0 };
  (tasks || []).forEach(function(task) {
    result.total += 1;
    result.plannedHours += task.plannedHours;
    if (task.status === PLANNING_TASK_STATUS_DONE) {
      result.done += 1;
      result.doneHours += task.plannedHours;
    }
  });
  result.plannedHours = roundHours(result.plannedHours);
  result.doneHours = roundHours(result.doneHours);
  return result;
}

function planningCapacityStart(range, timezone) {
  return range.startYmd;
}

var PLANNING_CALENDAR_IDS_KEY = "planningCalendarIds";

function normalizeSelectedPlanningCalendarIds(ids) {
  var values = (ids || []).map(function(id) { return String(id == null ? "" : id).trim(); }).filter(Boolean);
  var unique = [];
  values.forEach(function(id) {
    if (unique.indexOf(id) < 0) unique.push(id);
  });
  return unique.length ? unique : ["primary"];
}

function calendarIdIsSelected(selectedIds, calendar) {
  var ids = selectedIds || [];
  if (calendar && ids.indexOf(calendar.id) >= 0) return true;
  return !!(calendar && calendar.primary && ids.indexOf("primary") >= 0);
}

function loadSelectedPlanningCalendarIds() {
  try {
    var raw = appUserProperties().getProperty(PLANNING_CALENDAR_IDS_KEY);
    return normalizeSelectedPlanningCalendarIds(raw ? JSON.parse(raw) : ["primary"]);
  } catch (err) {
    return ["primary"];
  }
}

function saveSelectedPlanningCalendarIds(ids) {
  var values = normalizeSelectedPlanningCalendarIds(ids);
  appUserProperties().setProperty(PLANNING_CALENDAR_IDS_KEY, JSON.stringify(values));
  return values;
}

function listPlanningCalendars() {
  var items = [];
  var pageToken = null;
  do {
    var options = {
      minAccessRole: "reader",
      maxResults: 250,
      fields: "items(id,summary,primary,accessRole),nextPageToken"
    };
    if (pageToken) options.pageToken = pageToken;
    var response = Calendar.CalendarList.list(options);
    (response.items || []).forEach(function(calendar) {
      if (!calendar || !calendar.id) return;
      items.push({
        id: calendar.id,
        name: calendar.summary || calendar.id,
        primary: !!calendar.primary
      });
    });
    pageToken = response.nextPageToken || null;
  } while (pageToken);
  items.sort(function(left, right) {
    if (left.primary !== right.primary) return left.primary ? -1 : 1;
    return String(left.name).localeCompare(String(right.name), "ja");
  });
  return items;
}

function getPlanningCalendarSettings() {
  var calendars = [];
  try { calendars = listPlanningCalendars(); }
  catch (err) {
    Logger.log("planning calendar list: " + err.message);
    throw new Error("カレンダー一覧を取得できません。Calendar APIの有効化と権限を確認してください。");
  }
  return { calendars: calendars, selectedIds: loadSelectedPlanningCalendarIds() };
}

function savePlanningCalendarSettings(payload) {
  var source = payload || {};
  var calendars = [];
  try { calendars = listPlanningCalendars(); }
  catch (err) { Logger.log("planning calendar list after save: " + err.message); }
  var requested = source.calendarIds || source.selectedIds || [];
  var normalized = requested.map(function(id) {
    var calendar = calendars.filter(function(item) { return item.id === id; })[0];
    return (calendar && calendar.primary) ? "primary" : id;
  });
  return { calendars: calendars, selectedIds: saveSelectedPlanningCalendarIds(normalized) };
}

function loadCalendarEvents(calendarId, calendarName, start, end, timezone, isPrimary) {
  var items = [];
  var pageToken = null;
  var sourceId = String(calendarId || "primary");
  var storedId = isPrimary || sourceId === "primary" ? "primary" : sourceId;
  do {
    var options = {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      showDeleted: false,
      orderBy: "startTime",
      maxResults: 2500,
      fields: "items(id,summary,status,transparency,start,end),nextPageToken"
    };
    if (pageToken) options.pageToken = pageToken;
    var response = Calendar.Events.list(sourceId, options);
    (response.items || []).forEach(function(event) {
      if (event.status === "cancelled") return;
      var allDay = !!(event.start && event.start.date);
      var startValue = allDay ? event.start.date + "T00:00:00" : event.start && event.start.dateTime;
      var endValue = allDay ? event.end.date + "T00:00:00" : event.end && event.end.dateTime;
      if (!startValue || !endValue) return;
      var eventStart = new Date(startValue);
      var eventEnd = new Date(endValue);
      items.push({
        id: event.id || "",
        calendarId: storedId,
        calendarName: calendarName || "",
        title: event.summary || "（タイトルなし）",
        allDay: allDay,
        start: eventStart,
        end: eventEnd,
        startTime: allDay ? "" : Utilities.formatDate(eventStart, timezone, "HH:mm"),
        endTime: allDay ? "" : Utilities.formatDate(eventEnd, timezone, "HH:mm"),
        blocksTime: event.transparency !== "transparent"
      });
    });
    pageToken = response.nextPageToken || null;
  } while (pageToken);
  return items;
}

function loadSelectedCalendarEvents(start, end, timezone) {
  var selectedIds = loadSelectedPlanningCalendarIds();
  var calendars = [];
  try { calendars = listPlanningCalendars(); } catch (err) { Logger.log("planning calendar names: " + err.message); }
  var names = {};
  calendars.forEach(function(calendar) { names[calendar.id] = calendar.name; if (calendar.primary) names.primary = calendar.name; });
  var items = [];
  var seen = {};
  selectedIds.forEach(function(calendarId) {
    var calendar = calendars.filter(function(item) { return item.id === calendarId; })[0];
    var isPrimary = calendarId === "primary" || !!(calendar && calendar.primary);
    var loadId = isPrimary ? "primary" : calendarId;
    if (seen[loadId]) return;
    seen[loadId] = true;
    loadCalendarEvents(loadId, names[calendarId] || names[loadId] || "", start, end, timezone, isPrimary).forEach(function(event) {
      items.push(event);
    });
  });
  return items;
}

function loadPlanningCalendarCapacity(periodType, periodKey) {
  var type = normalizeBudgetPeriodType(periodType);
  var key = normalizeBudgetPeriodKey(type, periodKey);
  var timezone = Session.getScriptTimeZone() || "Asia/Tokyo";
  var range = getBudgetPeriodRange(type, key);
  var startYmd = planningCapacityStart(range, timezone);
  var start = new Date(startYmd + "T00:00:00");
  var end = new Date(start.getTime());
  if (type === BUDGET_PERIOD_MONTH) end = new Date(range.endExclusiveYmd + "T00:00:00");
  else end.setDate(end.getDate() + 60);
  var events = [];
  try { events = loadSelectedCalendarEvents(start, end, timezone); }
  catch (err) {
    Logger.log("planning capacity calendar api: " + (err && err.message ? err.message : err));
    throw new Error("Googleカレンダーを取得できません。Calendar APIの有効化と権限を確認してください。");
  }
  var overrides = {};
  try {
    overrides = loadWorkCapacitySettings(startYmd, Utilities.formatDate(end, timezone, "yyyy-MM-dd"));
  } catch (err) {
    Logger.log("planning capacity settings skipped: " + (err && err.message ? err.message : err));
  }

  var workSettings = typeof getWorkdayHoursSettings === "function" ? getWorkdayHoursSettings() : { hours: 8, weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
  var defaultHours = workSettings.hours;
  var workStartParts = String(workSettings.start).split(":").map(Number);
  var workEndParts = String(workSettings.end).split(":").map(Number);
  var days = [];
  for (var cursor = new Date(start.getTime()); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
    var dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    var dayEnd = new Date(dayStart.getTime());
    dayEnd.setDate(dayEnd.getDate() + 1);
    var workStart = new Date(dayStart.getTime());
    workStart.setHours(workStartParts[0], workStartParts[1], 0, 0);
    var workEnd = new Date(dayStart.getTime());
    workEnd.setHours(workEndParts[0], workEndParts[1], 0, 0);
    var weekday = dayStart.getDay();
    var override = overrides[Utilities.formatDate(dayStart, timezone, "yyyy-MM-dd")];
    var baseHours = override ? override.hours : (workSettings.weekdays.indexOf(weekday) >= 0 ? defaultHours : 0);
    var intervals = [];
    var eventCount = 0;
    var dayEvents = [];
    events.forEach(function(event) {
      var eventStart = event.start;
      var eventEnd = event.end;
      if (eventStart.getTime() >= dayEnd.getTime() || eventEnd.getTime() <= dayStart.getTime()) return;
      var meetingHoursForEvent = 0;
      if (baseHours > 0 && !event.allDay && event.blocksTime) {
        var overlapStart = Math.max(workStart.getTime(), eventStart.getTime());
        var overlapEnd = Math.min(workEnd.getTime(), eventEnd.getTime());
        if (overlapEnd > overlapStart) {
          intervals.push([overlapStart, overlapEnd]);
          eventCount += 1;
          meetingHoursForEvent = roundHours((overlapEnd - overlapStart) / 3600000);
        }
      }
      var slice = calendarEventDaySlice(event, dayStart, dayEnd);
      dayEvents.push({
        id: event.id,
        calendarId: event.calendarId || "primary",
        calendarName: event.calendarName || "",
        title: event.title,
        allDay: event.allDay,
        startTime: slice.startTime,
        endTime: slice.endTime,
        blocksTime: event.blocksTime,
        meetingHours: meetingHoursForEvent,
        durationHours: slice.durationHours
      });
    });
    intervals.sort(function(left, right) { return left[0] - right[0]; });
    var meetingMs = 0;
    var mergedStart = null;
    var mergedEnd = null;
    intervals.forEach(function(interval) {
      if (mergedStart == null) { mergedStart = interval[0]; mergedEnd = interval[1]; return; }
      if (interval[0] <= mergedEnd) { mergedEnd = Math.max(mergedEnd, interval[1]); return; }
      meetingMs += mergedEnd - mergedStart;
      mergedStart = interval[0];
      mergedEnd = interval[1];
    });
    if (mergedStart != null) meetingMs += mergedEnd - mergedStart;
    var meetingHours = roundHours(meetingMs / 3600000);
    days.push({
      date: Utilities.formatDate(dayStart, timezone, "yyyy-MM-dd"),
      baseHours: roundHours(baseHours),
      meetingHours: meetingHours,
      availableHours: Math.max(0, roundHours(baseHours - meetingHours)),
      eventCount: eventCount,
      capacityReason: override ? override.reason : "",
      capacityOverridden: !!override,
      events: dayEvents
    });
  }
  return { baseHours: defaultHours, startYmd: startYmd, days: days };
}

function calendarEventKey(event, dateValue, index) {
  var calendarId = String((event && event.calendarId) || "");
  var base = String((event && event.id) || (event && event.title) || "") + ":" + String(dateValue || "") + ":" + ((event && event.startTime) || "all") + ":" + index;
  if (!calendarId || calendarId === "primary") return base;
  return calendarId + ":" + base;
}

function calendarEventTimeMinutes(value) {
  var parts = String(value == null ? "" : value).split(":");
  var hours = Number(parts[0]);
  var minutes = Number(parts[1]);
  if (!isFinite(hours)) hours = 0;
  if (!isFinite(minutes)) minutes = 0;
  return hours * 60 + minutes;
}

function calendarClockFromDate(date) {
  var hours = date.getHours();
  var minutes = date.getMinutes();
  return (hours < 10 ? "0" : "") + hours + ":" + (minutes < 10 ? "0" : "") + minutes;
}

function calendarEventDaySlice(event, dayStart, dayEnd) {
  if (!event || !event.start || !event.end) {
    return { startTime: "", endTime: "", durationHours: 0 };
  }
  var clipStartMs = Math.max(dayStart.getTime(), event.start.getTime());
  var clipEndMs = Math.min(dayEnd.getTime(), event.end.getTime());
  if (clipEndMs <= clipStartMs || event.allDay) {
    return { startTime: "", endTime: "", durationHours: 0 };
  }
  return {
    startTime: calendarClockFromDate(new Date(clipStartMs)),
    endTime: clipEndMs === dayEnd.getTime() ? "24:00" : calendarClockFromDate(new Date(clipEndMs)),
    durationHours: roundHours((clipEndMs - clipStartMs) / 3600000)
  };
}

function calendarEventDurationHours(event) {
  if (!event || event.allDay) return 0;
  if (event.durationHours != null && event.durationHours !== "") {
    var stored = Number(event.durationHours);
    if (isFinite(stored)) return Math.max(0, roundHours(stored));
  }
  if (!event.endTime) return 0;
  var duration = calendarEventTimeMinutes(event.endTime) - calendarEventTimeMinutes(event.startTime);
  if (duration < 0) duration += 24 * 60;
  return Math.max(0, roundHours(duration / 60));
}

function calendarEventPlannedHours(event) {
  return calendarEventDurationHours(event);
}

function buildDailyCalendarTasks(date, days, importedPlans, excludedKeys) {
  var target = String(date || "").trim();
  var excluded = {};
  (excludedKeys || []).forEach(function(key) {
    if (key) excluded[String(key)] = true;
  });
  var importedByKey = {};
  (importedPlans || []).forEach(function(plan) {
    var key = String((plan && plan.calendarKey) || "").trim();
    if (!key) return;
    importedByKey[key] = plan;
  });
  var day = null;
  (days || []).some(function(entry) {
    if (entry && entry.date === target) {
      day = entry;
      return true;
    }
    return false;
  });
  var tasks = [];
  var seen = {};
  function addTask(task) {
    var name = String((task && task.name) || "").trim();
    if (!name || seen[name]) return;
    seen[name] = true;
    tasks.push({
      name: name,
      estimate: roundHours(task.estimate),
      calendarKey: task.calendarKey || "",
      imported: !!task.imported
    });
  }
  ((day && day.events) || []).forEach(function(event, index) {
    var key = calendarEventKey(event, target, index);
    if (excluded[key]) return;
    if (event && event.allDay) return;
    var hours = calendarEventPlannedHours(event);
    if (!(hours > 0)) return;
    var imported = importedByKey[key];
    var name = imported
      ? String(imported.name || "").trim()
      : String((event && event.title) || "カレンダー予定").trim();
    if (!name) return;
    if (!imported && seen[name] && event && event.startTime) {
      name = (name + "（" + event.startTime + "）").slice(0, 200);
    }
    addTask({
      name: name,
      estimate: imported && Number(imported.planned) > 0 ? imported.planned : hours,
      calendarKey: key,
      imported: !!imported
    });
  });
  (importedPlans || []).forEach(function(plan) {
    var key = String((plan && plan.calendarKey) || "").trim();
    if (!key || excluded[key]) return;
    if (String((plan && plan.startDate) || "") !== target) return;
    addTask({
      name: plan.name,
      estimate: plan.planned,
      calendarKey: key,
      imported: true
    });
  });
  return tasks;
}

function calendarEventWorkOverlapHours(event) {
  if (!event || event.allDay || event.blocksTime === false) return 0;
  if (event.meetingHours != null && event.meetingHours !== "") {
    var stored = Number(event.meetingHours);
    if (isFinite(stored)) return Math.max(0, roundHours(stored));
  }
  var overlapStart = Math.max(calendarEventTimeMinutes(event.startTime), 9 * 60);
  var overlapEnd = Math.min(calendarEventTimeMinutes(event.endTime), 18 * 60);
  return Math.max(0, roundHours((overlapEnd - overlapStart) / 60));
}

function calendarEventWorkInterval(event) {
  if (!event || event.allDay || event.blocksTime === false) return null;
  if (event.startTime && event.endTime) {
    var startRaw = calendarEventTimeMinutes(event.startTime);
    var endRaw = calendarEventTimeMinutes(event.endTime);
    if (endRaw <= startRaw) endRaw += 24 * 60;
    var start = Math.max(startRaw, 9 * 60);
    var end = Math.min(endRaw, 18 * 60);
    return end > start ? [start, end] : null;
  }
  var hours = calendarEventWorkOverlapHours(event);
  if (!(hours > 0)) return null;
  var fallbackStart = Math.max(calendarEventTimeMinutes(event.startTime), 9 * 60);
  return [fallbackStart, fallbackStart + Math.round(hours * 60)];
}

function mergeCalendarMeetingHours(events) {
  var intervals = [];
  (events || []).forEach(function(event) {
    var interval = calendarEventWorkInterval(event);
    if (interval) intervals.push(interval);
  });
  intervals.sort(function(left, right) { return left[0] - right[0]; });
  var total = 0;
  var mergedStart = null;
  var mergedEnd = null;
  intervals.forEach(function(interval) {
    if (mergedStart == null) { mergedStart = interval[0]; mergedEnd = interval[1]; return; }
    if (interval[0] <= mergedEnd) { mergedEnd = Math.max(mergedEnd, interval[1]); return; }
    total += mergedEnd - mergedStart;
    mergedStart = interval[0];
    mergedEnd = interval[1];
  });
  if (mergedStart != null) total += mergedEnd - mergedStart;
  return roundHours(total / 60);
}

function adjustCapacityDaysForCalendarPlans(days, exclusions, importedKeys) {
  var skip = {};
  (exclusions || []).concat(importedKeys || []).forEach(function(key) { skip[String(key)] = true; });
  return (days || []).map(function(day) {
    var remainingEvents = (day.events || []).filter(function(event, index) {
      return !skip[calendarEventKey(event, day.date, index)];
    });
    var meetingHours = mergeCalendarMeetingHours(remainingEvents);
    return {
      date: day.date,
      baseHours: roundHours(day.baseHours),
      meetingHours: meetingHours,
      availableHours: Math.max(0, roundHours((Number(day.baseHours) || 0) - meetingHours)),
      eventCount: remainingEvents.filter(function(event) { return calendarEventWorkOverlapHours(event) > 0; }).length,
      events: day.events || [],
      capacityReason: day.capacityReason || "",
      capacityOverridden: !!day.capacityOverridden
    };
  });
}

function calculatePriorityForecast(rows, capacityDays) {
  var days = (capacityDays || []).map(function(day) {
    return { date: day.date, availableHours: Math.max(0, Number(day.availableHours) || 0), meetingHours: Number(day.meetingHours) || 0 };
  });
  var cursorIndex = 0;
  return (rows || []).filter(function(row) { return row.hasPlan !== false; }).map(function(row) {
    var remaining = Math.max(0, roundHours((Number(row.plannedHours) || 0) - (Number(row.actualHours) || 0)));
    var result = { aggregationKey: row.aggregationKey, remainingHours: remaining, startDate: "", endDate: "", allocations: [], incomplete: false };
    if (remaining <= 0) return result;
    while (cursorIndex < days.length && days[cursorIndex].availableHours <= 0) cursorIndex++;
    if (cursorIndex < days.length) result.startDate = days[cursorIndex].date;
    while (remaining > 0 && cursorIndex < days.length) {
      var day = days[cursorIndex];
      var used = Math.min(remaining, day.availableHours);
      if (used > 0) {
        result.allocations.push({ date: day.date, hours: roundHours(used) });
        day.availableHours = roundHours(day.availableHours - used);
        remaining = roundHours(remaining - used);
        result.endDate = day.date;
      }
      if (day.availableHours <= 0) cursorIndex++;
    }
    result.incomplete = remaining > 0;
    return result;
  });
}

function loadPlanningWorkspace(periodType, periodKey) {
  var type = normalizeBudgetPeriodType(periodType);
  var key = normalizeBudgetPeriodKey(type, periodKey);
  var spreadsheetId = getPlanningSpreadsheetId(type, key);
  var timezone = Session.getScriptTimeZone() || "Asia/Tokyo";
  // 振り返り範囲が年をまたぐときは、前の年のファイルの予定・サブタスクも読む（budget.gs 参照）。
  var planningSpreadsheetIds = spreadsheetId
    ? budgetPlanningSpreadsheetIds(type, key, type === BUDGET_PERIOD_WEEK ? budgetWeeklyActualsRange(key, timezone) : getBudgetPeriodRange(type, key))
    : [];
  var planModels = loadBudgetPlansFromSpreadsheets(planningSpreadsheetIds);
  var allTasks = loadPlanningTasksFromSpreadsheets(planningSpreadsheetIds);
  var summary = loadBudgetSummary(type, key, planModels, allTasks);
  var weekKeys = [key];
  var seenSubs = {};
  var tasks = [];
  if (type === BUDGET_PERIOD_WEEK) {
    (summary.rows || []).forEach(function(row) {
      if (row && row.periodKey && weekKeys.indexOf(row.periodKey) < 0) weekKeys.push(row.periodKey);
    });
  }
  weekKeys.forEach(function(week) {
    allTasks.filter(function(task) {
      return task.periodType === type && task.periodKey === week;
    }).sort(function(left, right) {
      if (left.parentKey !== right.parentKey) return left.parentKey < right.parentKey ? -1 : 1;
      return left.sortOrder - right.sortOrder;
    }).forEach(function(task) {
      var stamp = String((task && task.id) || "") + "\u0000" + String((task && task.parentKey) || "") + "\u0000" + String((task && task.title) || "");
      if (seenSubs[stamp]) return;
      seenSubs[stamp] = true;
      tasks.push(task);
    });
  });
  summary.subtasks = tasks;
  summary.subtaskProgress = planningTaskProgress(tasks);
  summary.storage = getAppStorageStatus();
  summary.monthlyAllocation = type === BUDGET_PERIOD_WEEK ? loadMonthlyAllocationForWeek(key, planModels) : null;
  summary.calendarExclusions = loadCalendarExclusions(spreadsheetId);
  return summary;
}

// 月のガント表示（見るだけ）。月にかかる各週を週の画面と同じ選び方・実績の結びつけで集計し、
// 予定IDでまとめて返す。表示する予定の最終的な絞り込みは画面側で週の画面と同じルールを使う。
function planningImportedCalendarKeys(plans, dailyRows) {
  var keys = [];
  (plans || []).forEach(function(plan) {
    var key = String((plan && (plan.calendarKey || budgetCalendarKeyFromNote(plan.note))) || "").trim();
    if (key) keys.push(key);
  });
  (dailyRows || []).forEach(function(row) {
    var mark = String((row && row[6]) == null ? "" : row[6]).trim();
    if (mark.indexOf(BUDGET_CALENDAR_INTERRUPT_PREFIX) !== 0) return;
    var key = mark.slice(BUDGET_CALENDAR_INTERRUPT_PREFIX.length).trim();
    if (key) keys.push(key);
  });
  return keys;
}

function planningCalendarHoursByDate(days, excludedKeys) {
  var excluded = {};
  (excludedKeys || []).forEach(function(key) { excluded[key] = true; });
  var totals = {};
  (days || []).forEach(function(day) {
    totals[day.date] = roundHours((day.events || []).reduce(function(total, event, index) {
      return total + (excluded[calendarEventKey(event, day.date, index)] ? 0 : calendarEventDurationHours(event));
    }, 0));
  });
  return totals;
}

function loadPlanningMonthGantt(monthKey) {
  var key = normalizeBudgetPeriodKey(BUDGET_PERIOD_MONTH, monthKey);
  var range = getBudgetPeriodRange(BUDGET_PERIOD_MONTH, key);
  var timezone = Session.getScriptTimeZone() || "Asia/Tokyo";
  var weekKeys = budgetWeekKeysForRange(range.startYmd, range.endExclusiveYmd, timezone);
  var dailyRange = budgetWeeklyActualsRange(weekKeys[0], timezone);
  if (dailyRange.endExclusiveYmd < range.endExclusiveYmd) dailyRange.endExclusiveYmd = range.endExclusiveYmd;
  var dailyRows = [];
  annualSpreadsheetIdsForRange(dailyRange.startYmd, dailyRange.endExclusiveYmd).forEach(function(spreadsheetId) {
    loadBudgetDailyRowsForYmdRange(spreadsheetId, dailyRange.startYmd, dailyRange.endExclusiveYmd).forEach(function(row) {
      dailyRows.push(row);
    });
  });
  var plansBySheet = {};
  var tasks = [];
  function plansFor(weekKey) {
    var spreadsheetId = getPlanningSpreadsheetId(BUDGET_PERIOD_WEEK, weekKey);
    if (!spreadsheetId) return [];
    if (!plansBySheet[spreadsheetId]) {
      plansBySheet[spreadsheetId] = loadBudgetPlanRows(spreadsheetId).map(budgetPersistedPlanFromRow).filter(function(plan) { return !!plan; });
      loadPlanningTaskRows(spreadsheetId).map(planningTaskFromRow).forEach(function(task) { if (task) tasks.push(task); });
    }
    return plansBySheet[spreadsheetId];
  }
  var ganttPlans = [];
  weekKeys.forEach(function(weekKey) { Array.prototype.push.apply(ganttPlans, plansFor(weekKey)); });
  dailyRows = budgetResolveDailyRowNames(dailyRows, ganttPlans, tasks);
  var rows = mergeBudgetGanttWeekRows(weekKeys.map(function(weekKey) {
    return calculateBudgetSummary(BUDGET_PERIOD_WEEK, weekKey, plansFor(weekKey), dailyRows, timezone).rows;
  }));
  var planIds = {};
  var planNames = {};
  rows.forEach(function(row) {
    if (row.planId) planIds[row.planId] = true;
    planNames[row.periodKey + "\u0000" + row.aggregationKey] = true;
  });
  var subtasks = tasks.filter(function(task) {
    if (task.periodType !== BUDGET_PERIOD_WEEK) return false;
    if (task.parentPlanId) return !!planIds[task.parentPlanId];
    return !!planNames[task.periodKey + "\u0000" + task.parentKey];
  });
  var calendarHours = null;
  var workHours = null;
  try {
    var capacity = loadPlanningCalendarCapacity(BUDGET_PERIOD_MONTH, key);
    workHours = {};
    (capacity.days || []).forEach(function(day) { workHours[day.date] = roundHours(day.baseHours); });
    var calendarExclusions = [];
    annualSpreadsheetIdsForRange(range.startYmd, range.endExclusiveYmd).forEach(function(id) {
      calendarExclusions = calendarExclusions.concat(loadCalendarExclusions(id));
    });
    // 予定や今日だけの実績として取り込んだカレンダー予定は、実績側で数えるので、カレンダーの合計から除く。
    calendarHours = planningCalendarHoursByDate(capacity.days, calendarExclusions.concat(planningImportedCalendarKeys(ganttPlans, dailyRows)));
  } catch (err) { Logger.log("month calendar: " + String(err && err.message || err)); }
  return {
    periodType: BUDGET_PERIOD_MONTH,
    periodKey: key,
    range: range,
    weekKeys: weekKeys,
    rows: rows,
    subtasks: subtasks,
    dailyTotals: budgetDailyTotalsForRange(dailyRows, range, timezone),
    calendarHoursByDate: calendarHours,
    workHoursByDate: workHours,
    storage: getAppStorageStatus()
  };
}

function planningTasksToRetain(existingTasks, periodType, periodKey, savedPlans, livingPlans) {
  var type = normalizeBudgetPeriodType(periodType);
  var key = normalizeBudgetPeriodKey(type, periodKey);
  var savedIds = {};
  var savedNames = {};
  (savedPlans || []).forEach(function(plan) {
    if (plan && plan.planId) savedIds[plan.planId] = true;
    var savedName = String(plan && plan.aggregationKey || "").trim();
    if (savedName) savedNames[savedName] = true;
  });
  var livingIds = {};
  var livingNames = {};
  (livingPlans || []).forEach(function(plan) {
    if (!plan) return;
    if (plan.planId) livingIds[plan.planId] = true;
    var livingName = String(plan.aggregationKey || "").trim();
    if (livingName) livingNames[livingName] = true;
  });
  return (existingTasks || []).filter(function(task) {
    if (!task || task.periodType !== type || task.periodKey !== key) return false;
    var parentId = String(task.parentPlanId || "").trim();
    if (parentId) {
      if (savedIds[parentId]) return false;
      return !!livingIds[parentId];
    }
    var parentName = String(task.parentKey || "").trim();
    if (!parentName || savedNames[parentName]) return false;
    return !!livingNames[parentName];
  });
}

// 予定の一部の項目だけを変える（月のガントの編集・ドラッグ用）。変えられるのは期間・予定工数・メモ・プロジェクト・完了だけ。
// 名前やサブタスクは、日次の実績とのひもづけがあるので、週の画面で編集する。
// 同じ予定IDの行は、取り込み元の週と、その月にかかる週のシートにある分をまとめて更新する。
function planFieldChanges_(fields) {
  var source = fields || {};
  var changes = {};
  if (Object.prototype.hasOwnProperty.call(source, "startDate") || Object.prototype.hasOwnProperty.call(source, "endDate")) {
    var startDate = String(source.startDate || "").trim();
    var endDate = String(source.endDate || "").trim();
    if (startDate || endDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
        throw new Error("期間が不正です。開始日は終了日以前にしてください。");
      }
      changes.period = { startDate: startDate, endDate: endDate, undated: false };
    } else {
      changes.period = { startDate: "", endDate: "", undated: true };
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, "plannedHours")) {
    var planned = Number(source.plannedHours);
    if (!isFinite(planned) || planned < 0 || planned > 10000) throw new Error("予定工数は0以上の数値で指定してください。");
    changes.plannedHours = roundHours(planned);
  }
  if (Object.prototype.hasOwnProperty.call(source, "note")) {
    var note = String(source.note == null ? "" : source.note).trim();
    if (note.length > 2000) throw new Error("メモは2000文字以内で入力してください。");
    changes.note = note;
  }
  if (Object.prototype.hasOwnProperty.call(source, "projectId")) changes.projectId = budgetStableId(source.projectId);
  if (Object.prototype.hasOwnProperty.call(source, "done")) changes.done = source.done === true;
  if (!Object.keys(changes).length) throw new Error("変更する項目がありません。");
  return changes;
}

function updatePlanFields(payload) {
  return withUserWriteLock(function() {
    var source = payload || {};
    var planId = budgetStableId(source.planId);
    if (!planId) throw new Error("予定を特定できません。");
    var changes = planFieldChanges_(source.fields);
    var timezone = Session.getScriptTimeZone() || "Asia/Tokyo";
    var weekKeys = [];
    function addWeek(key) { if (key && weekKeys.indexOf(key) < 0) weekKeys.push(key); }
    if (source.originWeek) addWeek(normalizeBudgetPeriodKey(BUDGET_PERIOD_WEEK, source.originWeek));
    if (source.monthKey) {
      var monthRange = getBudgetPeriodRange(BUDGET_PERIOD_MONTH, normalizeBudgetPeriodKey(BUDGET_PERIOD_MONTH, source.monthKey));
      budgetWeekKeysForRange(monthRange.startYmd, monthRange.endExclusiveYmd, timezone).forEach(addWeek);
    }
    var seenSheets = {};
    var updated = 0;
    weekKeys.forEach(function(weekKey) {
      var spreadsheetId = getPlanningSpreadsheetId(BUDGET_PERIOD_WEEK, weekKey);
      if (!spreadsheetId || seenSheets[spreadsheetId]) return;
      seenSheets[spreadsheetId] = true;
      var all = loadBudgetPlanRows(spreadsheetId).map(budgetPersistedPlanFromRow).filter(function(plan) { return !!plan; });
      var periods = {};
      all.forEach(function(plan) {
        if (plan.planId !== planId || plan.calendarKey) return;
        if (changes.period) {
          plan.startDate = changes.period.startDate;
          plan.endDate = changes.period.endDate;
          plan.undated = changes.period.undated;
        }
        if (changes.plannedHours != null) { plan.plannedHours = changes.plannedHours; plan.estimatedTotalHours = changes.plannedHours; }
        if (changes.note != null) plan.note = changes.note;
        if (changes.projectId != null) plan.projectId = changes.projectId;
        if (changes.done != null) { plan.done = changes.done; plan.autoComplete = false; plan.completionOverride = changes.done ? true : false; }
        periods[plan.periodType + "\u0000" + plan.periodKey] = plan;
        updated++;
      });
      Object.keys(periods).forEach(function(id) {
        var target = periods[id];
        var samePeriod = all.filter(function(plan) { return plan.periodType === target.periodType && plan.periodKey === target.periodKey; });
        saveBudgetPlans({ periodType: target.periodType, periodKey: target.periodKey, plans: samePeriod }, { skipSummary: true });
      });
    });
    if (!updated) throw new Error("対象の予定が見つかりません。");
    return { planId: planId, updated: updated };
  });
}

function savePlanningWorkspace(payload) {
  return withUserWriteLock(function() {
    var source = payload || {};
    var periodType = normalizeBudgetPeriodType(source.periodType);
    var periodKey = normalizeBudgetPeriodKey(periodType, source.periodKey);
    var plans = normalizeBudgetPlans({ plans: source.plans || [] });
    plans.forEach(function(plan) {
      if (plan.periodType !== periodType || plan.periodKey !== periodKey) {
        throw new Error("一度に保存できる予定は一つの期間だけです。");
      }
    });
    var shouldUpdateTasks = Array.isArray(source.subtasks);
    var tasks = shouldUpdateTasks ? normalizePlanningTasks(source.subtasks, periodType, periodKey, plans) : [];
    var spreadsheetId = requirePlanningSpreadsheetId(periodType, periodKey);
    if (Array.isArray(source.calendarExclusions)) saveCalendarExclusions(spreadsheetId, source.calendarExclusions);
    if (!shouldUpdateTasks) {
      saveBudgetPlans({ periodType: periodType, periodKey: periodKey, plans: plans }, { skipSummary: true });
      return loadPlanningWorkspace(periodType, periodKey);
    }
    var existingRows = loadPlanningTaskRows(spreadsheetId);
    var existingTasks = existingRows.map(planningTaskFromRow).filter(function(task) { return !!task; });
    // 親タスクを先に保存し、繰り越し元など今回の週に含まれない予定のサブタスクを残す。
    saveBudgetPlans({ periodType: periodType, periodKey: periodKey, plans: plans }, { skipSummary: true });
    var livingPlans = loadBudgetPlanRows(spreadsheetId).map(budgetPersistedPlanFromRow).filter(function(plan) {
      return !!plan;
    });
    var retained = planningTasksToRetain(existingTasks, periodType, periodKey, plans, livingPlans);
    var taskIds = {};
    tasks.forEach(function(task) { if (task && task.id) taskIds[task.id] = true; });
    retained = retained.filter(function(task) { return !(task && task.id && taskIds[task.id]); });
    var existing = existingTasks.filter(function(task) {
      return task.periodType !== periodType || task.periodKey !== periodKey;
    });
    var merged = existing.concat(retained).concat(tasks).sort(function(a, b) {
      var left = a.periodType + a.periodKey + a.parentKey + ("000000" + a.sortOrder).slice(-6);
      var right = b.periodType + b.periodKey + b.parentKey + ("000000" + b.sortOrder).slice(-6);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    var timezone = Session.getScriptTimeZone() || "Asia/Tokyo";
    var updatedAt = Utilities.formatDate(new Date(), timezone, "yyyy/MM/dd HH:mm:ss");
    var values = [PLANNING_TASK_HEADER].concat(merged.map(function(task) {
      return [
        sanitizeEnteredString(task.id), task.periodType, task.periodKey,
        sanitizeEnteredString(task.parentKey), sanitizeEnteredString(task.title), task.plannedHours,
        task.dueDate, task.status, sanitizeEnteredString(task.note), task.sortOrder, updatedAt,
        task.parentPlanId
      ];
    }));

    ensurePlanningTaskSheet(spreadsheetId);
    sheetsValuesUpdate(spreadsheetId, a1Range(PLANNING_TASK_SHEET_NAME, "A1:L" + values.length), values);
    if (existingRows.length > merged.length) {
      sheetsValuesClear(
        spreadsheetId,
        a1Range(PLANNING_TASK_SHEET_NAME, "A" + (merged.length + 2) + ":L" + (existingRows.length + 1))
      );
    }
    if (typeof putCachedSheetValues === "function") putCachedSheetValues(spreadsheetId, PLANNING_TASK_SHEET_NAME, values.slice(1));
    return loadPlanningWorkspace(periodType, periodKey);
  });
}
