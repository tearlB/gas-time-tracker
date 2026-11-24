/**
 * プロジェクトと月次の稼働計画を管理する。
 *
 * プロジェクト本体は月に依存しない台帳として保存し、年次ファイルを
 * またいで同じIDを使う。更新先は既存行が見つかった年次ファイルを優先
 * する。月次設定だけを対象月の年次ファイルへ保存する。課題（週/月の
 * 予実計画）は予実計画シートのプロジェクトIDから紐づけ、日次実績は
 * その課題IDを経由して集計する。対象月に働いた時間は、課題の週が
 * その月の外でも実績に含める。同じ予定IDは月の中で1件にまとめる。
 */
var PROJECT_SHEET_NAME = "プロジェクト";
var PROJECT_HEADER = [
  "プロジェクトID", "プロジェクト名", "説明", "状態",
  "開始日", "終了予定日", "登録日時", "更新日時"
];
var PROJECT_MONTHLY_SHEET_NAME = "プロジェクト月次";
var PROJECT_MONTHLY_HEADER = [
  "プロジェクトID", "対象月", "予定稼働時間", "稼働状況説明", "更新日時", "稼働式"
];
var PROJECT_STATUS_ACTIVE = "active";
var PROJECT_STATUS_PAUSED = "paused";
var PROJECT_STATUS_DONE = "done";
var PROJECT_STATUS_ARCHIVED = "archived";

function projectText(value) {
  return String(value == null ? "" : value).trim();
}

function projectId(value) {
  var raw = projectText(value);
  return /^[A-Za-z0-9._:-]{1,160}$/.test(raw) ? raw : "";
}

function normalizeProjectStatus(value) {
  var raw = projectText(value).toLowerCase();
  if (!raw || raw === PROJECT_STATUS_ACTIVE || raw === "進行中") return PROJECT_STATUS_ACTIVE;
  if (raw === PROJECT_STATUS_PAUSED || raw === "停止" || raw === "保留") return PROJECT_STATUS_PAUSED;
  if (raw === PROJECT_STATUS_DONE || raw === "完了") return PROJECT_STATUS_DONE;
  if (raw === PROJECT_STATUS_ARCHIVED || raw === "アーカイブ") return PROJECT_STATUS_ARCHIVED;
  throw new Error("プロジェクトの状態が不正です。");
}

function projectStatusLabel(value) {
  var status = normalizeProjectStatus(value);
  return status === PROJECT_STATUS_DONE ? "完了"
    : status === PROJECT_STATUS_PAUSED ? "保留"
      : status === PROJECT_STATUS_ARCHIVED ? "アーカイブ" : "進行中";
}

function projectYmd(value, label) {
  var raw = projectText(value);
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error((label || "日付") + "は YYYY-MM-DD 形式で指定してください。");
  var date = budgetDateFromYmd(raw);
  if (isNaN(date.getTime()) || budgetYmd(date) !== raw) throw new Error((label || "日付") + "が正しい日付ではありません。");
  return raw;
}

function projectMonthKey(value) {
  return normalizeBudgetPeriodKey(BUDGET_PERIOD_MONTH, value);
}

function projectNow() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
}

function projectNewId() {
  var uuid = typeof Utilities !== "undefined" && Utilities.getUuid ? Utilities.getUuid() : String(new Date().getTime()) + Math.random();
  return "project-" + String(uuid).replace(/[^A-Za-z0-9-]/g, "").slice(0, 120);
}

function projectAnnualSpreadsheetIds() {
  if (typeof isAnnualStorage !== "function" || !isAnnualStorage()) return [];
  var map = getAnnualStorageFileMap();
  return Object.keys(map).sort(function(left, right) { return Number(right) - Number(left); }).map(function(year) {
    return map[year];
  }).filter(function(id, index, list) { return id && list.indexOf(id) === index; });
}

function projectReadRows(spreadsheetId, sheetName) {
  if (!spreadsheetId) return [];
  try {
    var loaded = typeof loadSheetValuesDirect === "function"
      ? loadSheetValuesDirect(spreadsheetId, sheetName)
      : { values: [] };
    return loaded.values || [];
  } catch (err) {
    if (typeof isMissingSheet === "function" && isMissingSheet(err)) return [];
    throw err;
  }
}

function projectWriteRows(spreadsheetId, sheetName, header, rows, lastColumn) {
  var existing = projectReadRows(spreadsheetId, sheetName);
  var meta = sheetsGetMeta(spreadsheetId);
  var sheet = findSheetEntry(meta, sheetName);
  if (!sheet) {
    sheetsBatchUpdate(spreadsheetId, [{
      addSheet: {
        properties: {
          sheetId: generateSheetId(meta),
          title: sheetName,
          gridProperties: { frozenRowCount: 1 }
        }
      }
    }]);
  }
  var values = [header].concat(rows || []);
  sheetsValuesUpdate(spreadsheetId, a1Range(sheetName, "A1:" + lastColumn + values.length), values);
  if (existing.length > (rows || []).length) {
    sheetsValuesClear(spreadsheetId, a1Range(sheetName, "A" + ((rows || []).length + 2) + ":" + lastColumn + (existing.length + 1)));
  }
  if (typeof putCachedSheetValues === "function") putCachedSheetValues(spreadsheetId, sheetName, rows || []);
}

function ensureProjectSheet(spreadsheetId) {
  var meta = sheetsGetMeta(spreadsheetId);
  var existing = findSheetEntry(meta, PROJECT_SHEET_NAME);
  if (existing) return existing;
  var sheetId = generateSheetId(meta);
  sheetsBatchUpdate(spreadsheetId, [{
    addSheet: {
      properties: {
        sheetId: sheetId,
        title: PROJECT_SHEET_NAME,
        gridProperties: { frozenRowCount: 1 }
      }
    }
  }]);
  sheetsValuesUpdate(spreadsheetId, a1Range(PROJECT_SHEET_NAME, "A1:H1"), [PROJECT_HEADER]);
  return { properties: { sheetId: sheetId, title: PROJECT_SHEET_NAME } };
}

function ensureProjectMonthlySheet(spreadsheetId) {
  var meta = sheetsGetMeta(spreadsheetId);
  var existing = findSheetEntry(meta, PROJECT_MONTHLY_SHEET_NAME);
  if (existing) return existing;
  var sheetId = generateSheetId(meta);
  sheetsBatchUpdate(spreadsheetId, [{
    addSheet: {
      properties: {
        sheetId: sheetId,
        title: PROJECT_MONTHLY_SHEET_NAME,
        gridProperties: { frozenRowCount: 1 }
      }
    }
  }]);
  sheetsValuesUpdate(spreadsheetId, a1Range(PROJECT_MONTHLY_SHEET_NAME, "A1:F1"), [PROJECT_MONTHLY_HEADER]);
  return { properties: { sheetId: sheetId, title: PROJECT_MONTHLY_SHEET_NAME } };
}

function projectFromRow(row) {
  var id = projectId(row && row[0]);
  var name = projectText(row && row[1]);
  if (!id || !name) return null;
  var startDate = "";
  var endDate = "";
  try { startDate = projectYmd(row[4], "開始日"); } catch (_) {}
  try { endDate = projectYmd(row[5], "終了予定日"); } catch (_) {}
  return {
    id: id,
    name: name,
    description: projectText(row[2]),
    status: normalizeProjectStatus(row[3]),
    statusLabel: projectStatusLabel(row[3]),
    startDate: startDate,
    endDate: endDate,
    createdAt: projectText(row[6]),
    updatedAt: projectText(row[7])
  };
}

function projectMonthlyFromRow(row) {
  var id = projectId(row && row[0]);
  if (!id) return null;
  var monthKey;
  try { monthKey = projectMonthKey(row[1]); } catch (_) { return null; }
  var hours = Number(row[2]);
  if (!isFinite(hours) || hours < 0) hours = 0;
  return {
    projectId: id,
    monthKey: monthKey,
    plannedHours: roundHours(hours),
    statusNote: projectText(row[3]),
    updatedAt: projectText(row[4]),
    plannedShareText: projectShareTextFromCell(row[5])
  };
}

// スプレッドシートは「70%」を数値 0.7 に変えて保存するため、読み戻すときに割合へ戻す。
function projectShareTextFromCell(value) {
  var text = projectText(value).replace(/^'/, "");
  if (typeof value === "number" && isFinite(value) || /^\d+(?:\.\d+)?$/.test(text)) {
    var number = Number(text);
    if (isFinite(number) && number > 0 && number <= 1) return Math.round(number * 1000) / 10 + "%";
  }
  return text;
}

function parseProjectMonthlyHours(input, monthHours) {
  var raw = projectText(input).replace(/　/g, " ").replace(/％/g, "%").replace(/／/g, "/").replace(/×/g, "*");
  if (!raw) return { ok: true, hours: 0, share: null, linked: false, formula: "" };
  var month = Number(monthHours);
  var monthOk = isFinite(month) && month > 0;
  function fromShare(share) {
    if (!isFinite(month) || month < 0) return { ok: false, error: "割合の基準時間が不正です" };
    if (!isFinite(share) || share < 0) return { ok: false, error: "割合が不正です" };
    var computed = roundHours(month * share);
    if (computed > 744) return { ok: false, error: "予定稼働時間は744時間以下にしてください" };
    return { ok: true, hours: computed, share: share, linked: true, formula: raw };
  }
  var match = raw.match(/^(?:月の|1人月の)?\s*(\d+(?:\.\d+)?)\s*%$/);
  if (match) return fromShare(Number(match[1]) / 100);
  match = raw.match(/^(?:月の|1人月の)?\s*(\d+(?:\.\d+)?)\s*割$/);
  if (match) return fromShare(Number(match[1]) / 10);
  match = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (match) {
    var denominator = Number(match[2]);
    if (!(denominator > 0)) return { ok: false, error: "割合が不正です" };
    return fromShare(Number(match[1]) / denominator);
  }
  match = raw.match(/^(?:\*|月\s*\*|1人月\s*\*)\s*(\d+(?:\.\d+)?)$/);
  if (match) return fromShare(Number(match[1]));
  match = raw.match(/^(\d+(?:\.\d+)?)\s*h?$/i);
  if (match) {
    var direct = roundHours(Number(match[1]));
    if (direct < 0 || direct > 744) return { ok: false, error: "予定稼働時間は0〜744時間で入力してください" };
    return { ok: true, hours: direct, share: monthOk ? direct / month : null, linked: false, formula: "" };
  }
  return { ok: false, error: "時間（80）、割合（50%、3割、1/2）、または *0.5 で入力してください" };
}

function projectMonthlyShareBasis(monthHours, projects, settings, excludedProjectId) {
  var fixedHours = projects.reduce(function(total, project) {
    var setting = settings[project.id];
    if (project.id === excludedProjectId || !setting || projectText(setting.plannedShareText)) return total;
    return total + Number(setting.plannedHours || 0);
  }, 0);
  // 割合は、月の稼働時間から固定時間のプロジェクトを引いた残りに対する割合。
  return { fixedHours: roundHours(fixedHours), hours: Math.max(0, roundHours(monthHours - fixedHours)) };
}

function projectMonthlyPlannedHours(setting, monthHours) {
  if (!setting) return 0;
  var formula = projectText(setting.plannedShareText);
  if (formula) {
    var parsed = parseProjectMonthlyHours(formula, monthHours);
    if (parsed.ok && parsed.linked) return parsed.hours;
  }
  return roundHours(setting.plannedHours);
}

function projectFallbackCapacityDays(monthKey) {
  var range = getBudgetPeriodRange(BUDGET_PERIOD_MONTH, projectMonthKey(monthKey));
  var overrides = {};
  try { overrides = loadWorkCapacitySettings(range.startYmd, range.endExclusiveYmd); } catch (_) {}
  var workSettings = typeof getWorkdayHoursSettings === "function" ? getWorkdayHoursSettings() : { hours: 8, weekdays: [1, 2, 3, 4, 5] };
  var days = [];
  var cursor = budgetDateFromYmd(range.startYmd);
  while (budgetYmd(cursor) < range.endExclusiveYmd) {
    var dateKey = budgetYmd(cursor);
    var override = overrides[dateKey];
    var baseHours = override ? roundHours(override.hours) : (workSettings.weekdays.indexOf(cursor.getUTCDay()) >= 0 ? workSettings.hours : 0);
    days.push({ date: dateKey, baseHours: baseHours, meetingHours: 0, availableHours: baseHours });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function projectCapacityForMonth(monthKey) {
  var key = projectMonthKey(monthKey);
  var range = getBudgetPeriodRange(BUDGET_PERIOD_MONTH, key);
  var days = [];
  var calendarAvailable = true;
  var calendarError = "";
  try {
    var loaded = loadPlanningCalendarCapacity(BUDGET_PERIOD_MONTH, key);
    days = (loaded && loaded.days || []).filter(function(day) {
      return day && day.date >= range.startYmd && day.date < range.endExclusiveYmd;
    });
    if (typeof adjustCapacityDaysForCalendarPlans === "function") {
      var spreadsheetId = getSpreadsheetIdForYear(Number(key.slice(0, 4)));
      var exclusions = spreadsheetId && typeof loadCalendarExclusions === "function"
        ? loadCalendarExclusions(spreadsheetId) : [];
      var importedKeys = spreadsheetId && typeof loadBudgetPlanRows === "function"
        ? loadBudgetPlanRows(spreadsheetId).map(budgetPersistedPlanFromRow).map(function(plan) { return plan && plan.calendarKey || ""; }).filter(Boolean)
        : [];
      days = adjustCapacityDaysForCalendarPlans(days, exclusions, importedKeys);
    }
    if (!days.length) days = projectFallbackCapacityDays(key);
  } catch (err) {
    calendarAvailable = false;
    calendarError = String(err && err.message || err || "");
    days = projectFallbackCapacityDays(key);
  }
  var baseHours = 0;
  var meetingHours = 0;
  var availableHours = 0;
  days.forEach(function(day) {
    baseHours = roundHours(baseHours + Number(day.baseHours || 0));
    meetingHours = roundHours(meetingHours + Number(day.meetingHours || 0));
    availableHours = roundHours(availableHours + Number(day.availableHours == null ? day.baseHours : day.availableHours));
  });
  return {
    monthKey: key,
    baseHours: roundHours(baseHours),
    meetingHours: roundHours(meetingHours),
    availableHours: roundHours(availableHours),
    workdayCount: days.filter(function(day) { return Number(day.baseHours || 0) > 0; }).length,
    calendarAvailable: calendarAvailable,
    calendarError: calendarError
  };
}

function loadProjectCatalog() {
  try {
    var cachedCatalog = userCache().get(APP_CACHE_PROJECT_CATALOG_KEY);
    if (cachedCatalog) return JSON.parse(cachedCatalog);
  } catch (err) {}
  var byId = {};
  projectAnnualSpreadsheetIds().forEach(function(spreadsheetId) {
    projectReadRows(spreadsheetId, PROJECT_SHEET_NAME).forEach(function(row) {
      var project = projectFromRow(row);
      if (!project) return;
      var previous = byId[project.id];
      if (!previous || String(project.updatedAt || project.createdAt) >= String(previous.updatedAt || previous.createdAt)) byId[project.id] = project;
    });
  });
  var projects = Object.keys(byId).map(function(id) { return byId[id]; }).sort(function(left, right) {
    return String(left.name).localeCompare(String(right.name), "ja");
  });
  try {
    var encodedCatalog = JSON.stringify(projects);
    if (encodedCatalog.length <= 90000) userCache().put(APP_CACHE_PROJECT_CATALOG_KEY, encodedCatalog, 120);
  } catch (err) {}
  return projects;
}

function loadProjectMonthlySettings(monthKey) {
  var key = projectMonthKey(monthKey);
  var spreadsheetId = getSpreadsheetIdForYear(Number(key.slice(0, 4)));
  if (!spreadsheetId) return [];
  var byId = {};
  projectReadRows(spreadsheetId, PROJECT_MONTHLY_SHEET_NAME).forEach(function(row) {
    var item = projectMonthlyFromRow(row);
    if (!item || item.monthKey !== key) return;
    var previous = byId[item.projectId];
    if (!previous || String(item.updatedAt) >= String(previous.updatedAt)) byId[item.projectId] = item;
  });
  return Object.keys(byId).map(function(id) { return byId[id]; });
}

function projectLoadAllPlans() {
  var plans = [];
  var seen = {};
  projectAnnualSpreadsheetIds().forEach(function(spreadsheetId) {
    loadBudgetPlanRows(spreadsheetId).map(budgetPersistedPlanFromRow).forEach(function(plan) {
      if (!plan) return;
      var identity = projectPlanIdentity(plan);
      if (seen[identity]) return;
      seen[identity] = true;
      plans.push(plan);
    });
  });
  return plans;
}

function projectPlanOverlapsRange(plan, range) {
  if (!plan || !range) return false;
  var planRange;
  try { planRange = getBudgetPeriodRange(plan.periodType, plan.periodKey); } catch (_) { return false; }
  return planRange.startYmd < range.endExclusiveYmd && planRange.endExclusiveYmd > range.startYmd;
}

function projectPlanIsDone(plan) {
  if (!plan || plan.completionOverride === false) return false;
  return !!(plan.done || plan.completionOverride === true);
}

function projectIssueKey(plan) {
  if (!plan) return "";
  return plan.planId ? "id\u0000" + plan.planId : projectPlanIdentity(plan);
}

function projectPlanIdentity(plan) {
  if (!plan) return "";
  return String(plan.periodType || "") + "\u0000" + String(plan.periodKey || "") + "\u0000" + String(plan.planId || plan.aggregationKey || "");
}

function projectActualRowsForMonth(monthKey) {
  var key = projectMonthKey(monthKey);
  var range = getBudgetPeriodRange(BUDGET_PERIOD_MONTH, key);
  var rows = [];
  var ids = {};
  projectAnnualSpreadsheetIds().forEach(function(spreadsheetId) {
    loadBudgetDailyRowsForYmdRange(spreadsheetId, range.startYmd, range.endExclusiveYmd).forEach(function(row) {
      var stamp = budgetDateCellKey(row[0], Session.getScriptTimeZone() || "Asia/Tokyo") + "\u0000" + String(row[1] || "") + "\u0000" + String(row[7] || "");
      if (ids[stamp]) return;
      ids[stamp] = true;
      rows.push(row);
    });
  });
  return rows;
}

// 実績1行ごとに全部の予定を探し直すと、実績と予定が多いほど遅くなる。予定IDごとの一覧・プロジェクト付きの予定・
// 期間の計算結果を先にまとめておき、行ごとの照らし合わせではそれを引く。
function projectPlanLookup(plans) {
  var lookup = { byId: {}, assigned: [], ranges: {} };
  (plans || []).forEach(function(plan) {
    if (!plan) return;
    if (plan.planId) (lookup.byId[plan.planId] = lookup.byId[plan.planId] || []).push(plan);
    if (plan.projectId) lookup.assigned.push(plan);
  });
  return lookup;
}

function projectPlanForDailyRow(row, plans, lookup) {
  lookup = lookup || projectPlanLookup(plans);
  var planId = budgetStableId(row && row[7]);
  var date = projectText(row && row[0]);
  try { date = budgetDateCellKey(row && row[0], Session.getScriptTimeZone() || "Asia/Tokyo"); } catch (_) {}
  function planIncludesDate(plan) {
    if (!plan || !date) return false;
    var rangeKey = plan.periodType + "\u0000" + plan.periodKey;
    var range = lookup.ranges[rangeKey];
    if (range === undefined) {
      try { range = getBudgetPeriodRange(plan.periodType, plan.periodKey); } catch (_) { range = null; }
      lookup.ranges[rangeKey] = range;
    }
    return !!range && date >= range.startYmd && date < range.endExclusiveYmd;
  }
  if (planId) {
    var linked = lookup.byId[planId] || [];
    var assigned = linked.filter(function(plan) { return plan.projectId; });
    var datedAssigned = assigned.filter(planIncludesDate);
    if (datedAssigned.length) return datedAssigned[0];
    if (assigned.length) return assigned[0];
    // 予定IDがある行は、未設定の予定や別の同名課題へ付け替えない。
    return null;
  }
  var name = projectText(row && row[1]);
  if (!name) return null;
  var datedMatches = lookup.assigned.filter(function(plan) {
    return planIncludesDate(plan) && budgetDailyBelongsToPlan(name, plan.aggregationKey);
  });
  if (datedMatches.length === 1) return datedMatches[0];
  var identities = {};
  datedMatches.forEach(function(plan) { identities[plan.planId || projectPlanIdentity(plan)] = plan; });
  var identityKeys = Object.keys(identities);
  return identityKeys.length === 1 ? identities[identityKeys[0]] : null;
}

function projectIssueStatus(plannedHours, actualHours) {
  var planned = roundHours(plannedHours);
  var actual = roundHours(actualHours);
  if (!(planned > 0)) return actual > 0 ? "進行中" : "未着手";
  if (actual > planned) return "超過";
  if (actual > 0) return "進行中";
  return "未着手";
}

function projectMonthlyStatus(plannedHours, actualHours, hasPlan) {
  var planned = roundHours(plannedHours);
  var actual = roundHours(actualHours);
  if (!hasPlan) return actual > 0 ? "予定未設定" : "未設定";
  if (actual > planned) return "超過";
  if (planned > 0 && actual === planned) return "一致";
  if (actual > 0) return "稼働中";
  return "未着手";
}

function loadProjectWorkspace(monthKey) {
  var key = projectMonthKey(monthKey);
  var capacity = projectCapacityForMonth(key);
  var projects = loadProjectCatalog();
  var settings = {};
  loadProjectMonthlySettings(key).forEach(function(item) { settings[item.projectId] = item; });
  var monthRange = getBudgetPeriodRange(BUDGET_PERIOD_MONTH, key);
  var allPlans = projectLoadAllPlans();
  var actualRows = projectActualRowsForMonth(key);
  var actualByProject = {};
  var actualByIssue = {};
  var planLookup = projectPlanLookup(allPlans);
  actualRows.forEach(function(row) {
    var plan = projectPlanForDailyRow(row, allPlans, planLookup);
    // サブタスクIDがある行は、名前が変わっていてもサブタスク（予定のプロジェクトに属する）として扱う。
    var childName = plan ? (budgetStableId(row && row[9]) || budgetChildNameForDaily(projectText(row && row[1]), plan.aggregationKey)) : "";
    var ownProjectId = childName ? "" : budgetStableId(row && row[8]);
    var planProject = plan ? budgetStableId(plan.projectId) : "";
    var project = planProject || ownProjectId;
    if (!project) return;
    var hours = budgetNumber(row[2]);
    var issueKey = planProject ? projectIssueKey(plan) : projectText(row && row[1]);
    if (!issueKey) return;
    var bucket = project + "\u0000" + issueKey;
    actualByProject[project] = roundHours((actualByProject[project] || 0) + hours);
    actualByIssue[bucket] = roundHours((actualByIssue[bucket] || 0) + hours);
  });
  var issuesByProject = {};
  var seenIssue = {};
  allPlans.forEach(function(plan) {
    if (!plan.projectId) return;
    var bucket = plan.projectId + "\u0000" + projectIssueKey(plan);
    var overlaps = projectPlanOverlapsRange(plan, monthRange);
    var actual = roundHours(actualByIssue[bucket] || 0);
    if (!overlaps && !(actual > 0)) return;
    var existing = seenIssue[bucket];
    if (!existing) {
      existing = {
        id: projectIssueKey(plan),
        name: plan.aggregationKey,
        periodType: plan.periodType,
        periodKey: plan.periodKey,
        periodKeys: [plan.periodKey],
        plannedHours: roundHours(plan.plannedHours),
        actualHours: actual,
        overlaps: overlaps,
        note: plan.note || "",
        planKind: plan.planKind || "initial",
        done: projectPlanIsDone(plan)
      };
      seenIssue[bucket] = existing;
      var projectIssues = issuesByProject[plan.projectId] || (issuesByProject[plan.projectId] = []);
      projectIssues.push(existing);
      return;
    }
    if (existing.periodKeys.indexOf(plan.periodKey) < 0) existing.periodKeys.push(plan.periodKey);
    var preferIncoming = overlaps
      ? (!existing.overlaps || String(plan.periodKey) > String(existing.periodKey))
      : (!existing.overlaps && String(plan.periodKey) > String(existing.periodKey));
    if (!preferIncoming) return;
    existing.done = projectPlanIsDone(plan);
    existing.name = plan.aggregationKey;
    existing.periodType = plan.periodType;
    existing.periodKey = plan.periodKey;
    existing.plannedHours = roundHours(plan.plannedHours);
    existing.note = plan.note || existing.note;
    existing.planKind = plan.planKind || existing.planKind;
    existing.overlaps = true;
  });
  Object.keys(actualByIssue).forEach(function(bucket) {
    if (seenIssue[bucket]) return;
    var splitAt = bucket.indexOf("\u0000");
    if (splitAt < 0) return;
    var project = bucket.slice(0, splitAt);
    var name = bucket.slice(splitAt + 1);
    if (!project || !name) return;
    var issue = {
      id: name,
      name: name,
      periodType: "",
      periodKey: key,
      periodKeys: [key],
      plannedHours: 0,
      actualHours: roundHours(actualByIssue[bucket] || 0),
      overlaps: true,
      note: "",
      planKind: ""
    };
    seenIssue[bucket] = issue;
    var projectIssues = issuesByProject[project] || (issuesByProject[project] = []);
    projectIssues.push(issue);
  });
  Object.keys(issuesByProject).forEach(function(projectIdValue) {
    issuesByProject[projectIdValue].forEach(function(issue) {
      issue.periodKeys.sort();
      issue.varianceHours = roundHours(issue.actualHours - issue.plannedHours);
      issue.status = projectIssueStatus(issue.plannedHours, issue.actualHours);
      delete issue.overlaps;
    });
  });
  var shareBasis = projectMonthlyShareBasis(capacity.availableHours, projects, settings);
  var rows = projects.map(function(project) {
    var setting = settings[project.id] || null;
    var planned = projectMonthlyPlannedHours(setting, shareBasis.hours);
    var actual = roundHours(actualByProject[project.id] || 0);
    var hasPlan = !!setting;
    var issues = (issuesByProject[project.id] || []).sort(function(left, right) {
      return String(left.periodKey).localeCompare(String(right.periodKey)) || String(left.name).localeCompare(String(right.name), "ja");
    });
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      statusLabel: project.statusLabel,
      startDate: project.startDate,
      endDate: project.endDate,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      monthKey: key,
      hasMonthlyPlan: hasPlan,
      plannedHours: planned,
      taskPlannedHours: roundHours(issues.reduce(function(total, issue) { return total + issue.plannedHours; }, 0)),
      actualHours: actual,
      varianceHours: hasPlan ? roundHours(actual - planned) : null,
      remainingHours: hasPlan ? roundHours(planned - actual) : null,
      onePersonMonthHours: capacity.availableHours,
      shareBasisHours: shareBasis.hours,
      plannedShareRate: capacity.availableHours > 0 ? planned / capacity.availableHours : null,
      actualShareRate: capacity.availableHours > 0 ? actual / capacity.availableHours : null,
      consumptionRate: planned > 0 ? Math.round(actual / planned * 10000) / 10000 : null,
      monthlyStatus: projectMonthlyStatus(planned, actual, hasPlan),
      statusNote: setting ? setting.statusNote : "",
      plannedShareText: setting ? setting.plannedShareText : "",
      issues: issues
    };
  });
  var totals = rows.reduce(function(total, row) {
    total.plannedHours = roundHours(total.plannedHours + row.plannedHours);
    total.actualHours = roundHours(total.actualHours + row.actualHours);
    total.projectCount += 1;
    if (row.status === PROJECT_STATUS_ACTIVE) total.activeCount += 1;
    if (row.monthlyStatus === "超過" || row.monthlyStatus === "予定未設定") total.alertCount += 1;
    return total;
  }, { plannedHours: 0, actualHours: 0, projectCount: 0, activeCount: 0, alertCount: 0 });
  totals.varianceHours = roundHours(totals.actualHours - totals.plannedHours);
  totals.consumptionRate = totals.plannedHours > 0 ? Math.round(totals.actualHours / totals.plannedHours * 10000) / 10000 : null;
  totals.onePersonMonthHours = capacity.availableHours;
  totals.fixedPlannedHours = shareBasis.fixedHours;
  totals.shareBasisHours = shareBasis.hours;
  totals.capacityBaseHours = capacity.baseHours;
  totals.meetingHours = capacity.meetingHours;
  totals.unallocatedHours = roundHours(capacity.availableHours - totals.plannedHours);
  totals.plannedShareRate = capacity.availableHours > 0 ? totals.plannedHours / capacity.availableHours : null;
  totals.actualShareRate = capacity.availableHours > 0 ? totals.actualHours / capacity.availableHours : null;
  return {
    monthKey: key,
    projects: rows,
    totals: totals,
    capacity: capacity,
    storage: getAppStorageStatus()
  };
}

function projectFindSpreadsheetId(projectIdValue) {
  var id = projectId(projectIdValue);
  if (!id) return "";
  var found = "";
  projectAnnualSpreadsheetIds().some(function(spreadsheetId) {
    var match = projectReadRows(spreadsheetId, PROJECT_SHEET_NAME).some(function(row) {
      return projectId(row && row[0]) === id;
    });
    if (match) { found = spreadsheetId; return true; }
    return false;
  });
  return found;
}

function normalizeProjectPayload(payload) {
  var source = payload || {};
  var id = projectId(source.id || source.projectId);
  var name = projectText(source.name || source.projectName);
  var startDate = projectYmd(source.startDate, "開始日");
  var endDate = projectYmd(source.endDate, "終了予定日");
  if (!name) throw new Error("プロジェクト名を入力してください。");
  if (name.length > 200) throw new Error("プロジェクト名は 200 文字以内で指定してください。");
  if (projectText(source.description).length > 2000) throw new Error("プロジェクトの説明は 2000 文字以内で指定してください。");
  if (startDate && endDate && endDate < startDate) throw new Error("終了予定日は開始日以降にしてください。");
  return {
    id: id,
    name: name,
    description: projectText(source.description),
    status: normalizeProjectStatus(source.status),
    startDate: startDate,
    endDate: endDate
  };
}

function saveProject(payload) {
  return withUserWriteLock(function() {
    var source = payload || {};
    var next = normalizeProjectPayload(source);
    var existingProjects = loadProjectCatalog();
    var duplicate = existingProjects.find(function(project) {
      return project.name === next.name && project.id !== next.id;
    });
    if (duplicate) throw new Error("同名のプロジェクトがすでにあります。");
    next.id = next.id || projectNewId();
    var existing = existingProjects.find(function(project) { return project.id === next.id; }) || null;
    var spreadsheetId = existing ? projectFindSpreadsheetId(next.id) : "";
    if (!spreadsheetId) {
      var year = source.year == null || source.year === "" ? currentStorageYear() : normalizeStorageYear(source.year);
      spreadsheetId = requireSpreadsheetIdForYear(year);
    }
    var rows = projectReadRows(spreadsheetId, PROJECT_SHEET_NAME).filter(function(row) {
      return projectId(row && row[0]) !== next.id;
    });
    var now = projectNow();
    var createdAt = existing && existing.createdAt || now;
    rows.push([
      next.id, sanitizeEnteredString(next.name), sanitizeEnteredString(next.description), next.status,
      next.startDate, next.endDate, createdAt, now
    ]);
    rows.sort(function(left, right) { return String(left[1]).localeCompare(String(right[1]), "ja"); });
    ensureProjectSheet(spreadsheetId);
    projectWriteRows(spreadsheetId, PROJECT_SHEET_NAME, PROJECT_HEADER, rows, "H");
    try { userCache().remove(APP_CACHE_PROJECT_CATALOG_KEY); } catch (err) {}
    return Object.assign({}, next, { createdAt: createdAt, updatedAt: now, statusLabel: projectStatusLabel(next.status) });
  });
}

function normalizeProjectMonthlyPayload(payload) {
  var source = payload || {};
  var projectIdValue = projectId(source.projectId || source.id);
  var monthKey = projectMonthKey(source.monthKey || source.month);
  var plannedHours = Number(source.plannedHours);
  if (!projectIdValue) throw new Error("月次設定のプロジェクトIDが不正です。");
  if (!isFinite(plannedHours) || plannedHours < 0 || plannedHours > 744) throw new Error("月の予定稼働時間は0〜744時間で指定してください。");
  var statusNote = projectText(source.statusNote || source.note);
  if (statusNote.length > 2000) throw new Error("稼働状況の説明は 2000 文字以内で指定してください。");
  var plannedShareText = projectText(source.plannedShareText);
  if (plannedShareText) {
    var parsedShare = parseProjectMonthlyHours(plannedShareText, 0);
    if (!parsedShare.ok || !parsedShare.linked) throw new Error(parsedShare.error || "稼働式が不正です。");
    plannedShareText = parsedShare.formula;
  }
  return { projectId: projectIdValue, monthKey: monthKey, plannedHours: roundHours(plannedHours), statusNote: statusNote, plannedShareText: plannedShareText };
}

function saveProjectMonthly(payload) {
  return withUserWriteLock(function() {
    var next = normalizeProjectMonthlyPayload(payload);
    var projects = loadProjectCatalog();
    if (!projects.some(function(project) { return project.id === next.projectId; })) throw new Error("指定したプロジェクトが見つかりません。");
    if (next.plannedShareText) {
      var settings = {};
      loadProjectMonthlySettings(next.monthKey).forEach(function(item) { settings[item.projectId] = item; });
      var capacity = projectCapacityForMonth(next.monthKey);
      var basis = projectMonthlyShareBasis(capacity.availableHours, projects, settings, next.projectId);
      var parsed = parseProjectMonthlyHours(next.plannedShareText, basis.hours);
      if (!parsed.ok) throw new Error(parsed.error);
      next.plannedHours = parsed.hours;
    }
    var spreadsheetId = requireSpreadsheetIdForYear(Number(next.monthKey.slice(0, 4)));
    var rows = projectReadRows(spreadsheetId, PROJECT_MONTHLY_SHEET_NAME).filter(function(row) {
      return !(projectId(row && row[0]) === next.projectId && projectText(row && row[1]) === next.monthKey);
    });
    var updatedAt = projectNow();
    rows.push([next.projectId, next.monthKey, next.plannedHours, sanitizeEnteredString(next.statusNote), updatedAt, next.plannedShareText ? "'" + next.plannedShareText : ""]);
    rows.sort(function(left, right) { return String(left[1]).localeCompare(String(right[1])) || String(left[0]).localeCompare(String(right[0])); });
    ensureProjectMonthlySheet(spreadsheetId);
    projectWriteRows(spreadsheetId, PROJECT_MONTHLY_SHEET_NAME, PROJECT_MONTHLY_HEADER, rows, "F");
    return Object.assign({}, next, { updatedAt: updatedAt });
  });
}

function saveProjectWorkspace(payload) {
  var source = payload || {};
  var monthKey = source.monthKey || source.month;
  if (!monthKey) {
    monthKey = projectMonthKey(Utilities.formatDate(
      new Date(), Session.getScriptTimeZone() || "Asia/Tokyo", "yyyy-MM"
    ));
  }
  monthKey = projectMonthKey(monthKey);
  var projectPayload = Object.assign({}, source.project || source);
  if (projectPayload.year == null || projectPayload.year === "") projectPayload.year = Number(monthKey.slice(0, 4));
  var project = saveProject(projectPayload);
  if (source.monthly) {
    var monthlySource = source.monthly || {};
    saveProjectMonthly({
      projectId: project.id,
      monthKey: monthKey,
      plannedHours: monthlySource.plannedHours == null ? 0 : monthlySource.plannedHours,
      statusNote: monthlySource.statusNote == null ? "" : monthlySource.statusNote,
      plannedShareText: monthlySource.plannedShareText == null ? "" : monthlySource.plannedShareText
    });
  }
  return loadProjectWorkspace(monthKey);
}
