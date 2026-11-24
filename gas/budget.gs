/**
 * 週次・月次の予実管理に使う共通ルール。
 *
 * 日次シートは既存アプリとの互換性を優先して変更しない。
 * ここでは期間・計画・集計結果のデータ契約を先に固定し、画面は
 * loadBudgetSummary / saveBudgetPlans を次の開発スライスで利用する。
 */
var BUDGET_PLAN_SHEET_NAME = "予実計画";
// 着地見込工数は既存ファイルの列位置を崩さないため残し、予定工数と同じ値を書く。
var BUDGET_PLAN_HEADER = [
  "期間種別", "期間キー", "集計キー", "予定工数", "メモ", "更新日時",
  "優先順位", "着地見込工数", "当初予定工数", "予定区分", "登録日時",
  "予定ID", "開始日", "1日上限", "繰越元週", "カレンダーキー", "完了", "日別予定JSON", "プロジェクトID", "課題URL", "進捗",
  "終了日"
];
var BUDGET_CALENDAR_INTERRUPT_PREFIX = "カレンダー今日だけ:";
// 期間未定の予定は、終了日の列にこの文字を書く（開始日・終了日が空の旧データと区別するため）。
var BUDGET_PLAN_UNDATED = "未定";
var BUDGET_PERIOD_WEEK = "week";
var BUDGET_PERIOD_MONTH = "month";

function getBudgetManagementDefinition() {
  return {
    periodTypes: [BUDGET_PERIOD_WEEK, BUDGET_PERIOD_MONTH],
    periodKeyExamples: {
      week: "2026-W34",
      month: "2026-08"
    },
    planSheetName: BUDGET_PLAN_SHEET_NAME,
    planHeader: BUDGET_PLAN_HEADER.slice()
  };
}

function normalizeBudgetPeriodType(value) {
  var raw = String(value == null ? "" : value).trim().toLowerCase();
  if (raw === BUDGET_PERIOD_WEEK || raw === "週" || raw === "weekly") return BUDGET_PERIOD_WEEK;
  if (raw === BUDGET_PERIOD_MONTH || raw === "月" || raw === "monthly") return BUDGET_PERIOD_MONTH;
  throw new Error("期間種別は week または month を指定してください。");
}

function budgetPad2(value) {
  return ("0" + value).slice(-2);
}

function roundHours(value) {
  return Math.round((Number(value) || 0) * 4) / 4;
}

function normalizeBudgetPeriodKey(periodType, value) {
  var type = normalizeBudgetPeriodType(periodType);
  var raw = String(value == null ? "" : value).trim().toUpperCase();
  var match;
  var year;
  var part;

  if (type === BUDGET_PERIOD_WEEK) {
    match = raw.match(/^(\d{4})-W(\d{1,2})$/);
    if (!match) throw new Error("週の期間キーは YYYY-Www 形式で指定してください。");
    year = parseInt(match[1], 10);
    part = parseInt(match[2], 10);
    if (part < 1 || part > 53) throw new Error("週番号は 01〜53 の範囲で指定してください。");
    return year + "-W" + budgetPad2(part);
  }

  match = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) throw new Error("月の期間キーは YYYY-MM 形式で指定してください。");
  year = parseInt(match[1], 10);
  part = parseInt(match[2], 10);
  if (part < 1 || part > 12) throw new Error("月は 01〜12 の範囲で指定してください。");
  return year + "-" + budgetPad2(part);
}

function budgetDateFromYmd(ymd) {
  return new Date(ymd + "T00:00:00Z");
}

function budgetYmd(date) {
  return date.getUTCFullYear() + "-" + budgetPad2(date.getUTCMonth() + 1) + "-" + budgetPad2(date.getUTCDate());
}

function budgetWeekRange(year, week) {
  var jan4 = budgetDateFromYmd(year + "-01-04");
  var jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  var monday = new Date(jan4.getTime() - jan4Weekday * 86400000 + (week - 1) * 7 * 86400000);
  var nextMonday = new Date(monday.getTime() + 7 * 86400000);
  return { startYmd: budgetYmd(monday), endExclusiveYmd: budgetYmd(nextMonday) };
}

function getBudgetPeriodRange(periodType, periodKey) {
  var type = normalizeBudgetPeriodType(periodType);
  var key = normalizeBudgetPeriodKey(type, periodKey);
  var match;
  var year;
  var month;
  var start;
  var next;

  if (type === BUDGET_PERIOD_WEEK) {
    match = key.match(/^(\d{4})-W(\d{2})$/);
    return budgetWeekRange(parseInt(match[1], 10), parseInt(match[2], 10));
  }

  match = key.match(/^(\d{4})-(\d{2})$/);
  year = parseInt(match[1], 10);
  month = parseInt(match[2], 10);
  start = budgetDateFromYmd(year + "-" + budgetPad2(month) + "-01");
  next = month === 12
    ? budgetDateFromYmd((year + 1) + "-01-01")
    : budgetDateFromYmd(year + "-" + budgetPad2(month + 1) + "-01");
  return { startYmd: budgetYmd(start), endExclusiveYmd: budgetYmd(next) };
}

function getBudgetPeriodKey(date, periodType, timezone) {
  var type = normalizeBudgetPeriodType(periodType);
  var tz = timezone || Session.getScriptTimeZone() || "Asia/Tokyo";
  var ymd = Utilities.formatDate(date, tz, "yyyy-MM-dd");
  var localDate = budgetDateFromYmd(ymd);
  var weekday;
  var thursday;
  var isoYear;
  var firstThursday;
  var week;

  if (type === BUDGET_PERIOD_MONTH) {
    return ymd.slice(0, 7);
  }

  weekday = (localDate.getUTCDay() + 6) % 7;
  thursday = new Date(localDate.getTime() + (3 - weekday) * 86400000);
  isoYear = thursday.getUTCFullYear();
  firstThursday = budgetDateFromYmd(isoYear + "-01-04");
  week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return isoYear + "-W" + budgetPad2(week);
}

function previousBudgetWeekKey(weekKey) {
  var range = getBudgetPeriodRange(BUDGET_PERIOD_WEEK, weekKey);
  var prev = budgetDateFromYmd(range.startYmd);
  prev.setUTCDate(prev.getUTCDate() - 7);
  return getBudgetPeriodKey(prev, BUDGET_PERIOD_WEEK, Session.getScriptTimeZone() || "Asia/Tokyo");
}

function nextBudgetWeekKey(weekKey) {
  var range = getBudgetPeriodRange(BUDGET_PERIOD_WEEK, weekKey);
  return getBudgetPeriodKey(budgetDateFromYmd(range.endExclusiveYmd), BUDGET_PERIOD_WEEK, Session.getScriptTimeZone() || "Asia/Tokyo");
}

function budgetAddDaysYmd(ymd, days) {
  var date = budgetDateFromYmd(ymd);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return budgetYmd(date);
}

// 予定の開始日・終了日のセルは、シートが日付として解釈した値（シリアル値や 2026/10/14）でも YYYY-MM-DD に戻す。
function budgetPlanDateValue(value) {
  if (value === "" || value == null) return "";
  var key = typeof formatDateCellValue === "function" ? budgetDateCellKey(value) : String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
}

function budgetWeekFridayYmd(ymd) {
  var weekday = (budgetDateFromYmd(ymd).getUTCDay() + 6) % 7;
  return weekday >= 5 ? ymd : budgetAddDaysYmd(ymd, 4 - weekday);
}

// 予定の期間（ガントのバー）。開始日が空の旧データは登録した期間の初日、
// 終了日が空なら開始日の週の金曜（開始日が土日ならその日）までとみなす。期間未定の予定は null。
function budgetPlanDateRange(plan) {
  if (plan.undated) return null;
  var periodRange = getBudgetPeriodRange(plan.periodType, plan.periodKey);
  var start = budgetPlanDateValue(plan.startDate) || periodRange.startYmd;
  var explicitEnd = budgetPlanDateValue(plan.endDate);
  var end = explicitEnd || budgetWeekFridayYmd(start);
  if (end < start) end = start;
  return { startYmd: start, endYmd: end, explicitEnd: !!explicitEnd };
}

function budgetPlanOverlapsRange(plan, startYmd, endExclusiveYmd) {
  var range = budgetPlanDateRange(plan);
  if (!range) return false;
  return range.startYmd < endExclusiveYmd && range.endYmd >= startYmd;
}

function budgetWeeklyActualsRange(weekKey, timezone) {
  var key = normalizeBudgetPeriodKey(BUDGET_PERIOD_WEEK, weekKey);
  var range = getBudgetPeriodRange(BUDGET_PERIOD_WEEK, key);
  var start = range.startYmd;
  var end = range.endExclusiveYmd;
  var cursor = key;
  var index;
  var prev;
  var tz = timezone || Session.getScriptTimeZone() || "Asia/Tokyo";
  var today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  for (index = 0; index < 16; index++) {
    try { cursor = previousBudgetWeekKey(cursor); }
    catch (err) { break; }
    if (!cursor) break;
    prev = getBudgetPeriodRange(BUDGET_PERIOD_WEEK, cursor);
    if (prev.startYmd < start) start = prev.startYmd;
  }
  if (today && today >= end) end = budgetAddDaysYmd(today, 1);
  return { startYmd: start, endExclusiveYmd: end };
}

function budgetDateCellKey(value, timezone) {
  var raw = formatDateCellValue(value, timezone || Session.getScriptTimeZone() || "Asia/Tokyo");
  return String(raw || "").replace(/\//g, "-");
}

function isBudgetDateInPeriod(value, periodType, periodKey, timezone) {
  var dateKey = budgetDateCellKey(value, timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  var range = getBudgetPeriodRange(periodType, periodKey);
  return dateKey >= range.startYmd && dateKey < range.endExclusiveYmd;
}

function budgetStableId(value) {
  var raw = String(value == null ? "" : value).trim();
  return /^[A-Za-z0-9._:-]{1,160}$/.test(raw) ? raw : "";
}

function budgetBoolean(value) {
  var raw = String(value == null ? "" : value).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "完了" || raw === BUDGET_PLAN_AUTO_COMPLETE;
}

// 完了列の「自動」は、日次やサブタスクの状態からアプリが自動で完了にしたもの（手で付けた TRUE と区別する）。
// 完了として扱うが、手での指定（TRUE/FALSE）ではないので自動判定のまま扱う。
var BUDGET_PLAN_AUTO_COMPLETE = "自動";

function budgetIsAutoCompleteCell(value) {
  return String(value == null ? "" : value).trim() === BUDGET_PLAN_AUTO_COMPLETE;
}

// 完了列は TRUE/FALSE/空欄の3状態で扱う。FALSE は自動判定を明示的に未完了へ上書きする。
// 画面で完了になっている予定は、保存時に TRUE を書く。空欄はまだ書き戻していない未完了。
function budgetCompletionOverride(value) {
  if (value == null || String(value).trim() === "" || budgetIsAutoCompleteCell(value)) return null;
  return budgetBoolean(value);
}

function normalizeBudgetDailyPlan(value) {
  var source = value;
  if (typeof source === "string") {
    if (!source.trim()) return {};
    try { source = JSON.parse(source); } catch (_) { return {}; }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  var result = {};
  Object.keys(source).sort().forEach(function(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    var hours = Number(source[date]);
    if (isFinite(hours) && hours >= 0) result[date] = roundHours(hours);
  });
  return result;
}

function normalizeBudgetPlan(plan, index) {
  var source = plan || {};
  var periodType = normalizeBudgetPeriodType(source.periodType);
  var periodKey = normalizeBudgetPeriodKey(periodType, source.periodKey);
  var aggregationKey = String(source.aggregationKey == null ? source.subject : source.aggregationKey).trim();
  var plannedHours = Number(source.plannedHours);
  var priority = source.priority == null || source.priority === "" ? index : parseInt(source.priority, 10);
  var initialPlannedHours = source.initialPlannedHours == null || source.initialPlannedHours === "" ? plannedHours : Number(source.initialPlannedHours);
  var planKind = source.planKind === "added" ? "added" : "initial";
  var planId = budgetStableId(source.planId || source.id);
  var undated = source.undated === true || budgetBoolean(source.undated) ||
    String(source.endDate == null ? "" : source.endDate).trim() === BUDGET_PLAN_UNDATED;
  var startDate = undated ? "" : budgetPlanDateValue(source.startDate);
  var endDate = undated ? "" : budgetPlanDateValue(source.endDate);
  var dailyCap = Number(source.dailyCap);
  var carryWeek = String(source.carryWeek == null ? "" : source.carryWeek).trim();
  var calendarKey = String(source.calendarKey == null ? "" : source.calendarKey).trim();
  var projectId = budgetStableId(source.projectId);
  var issueUrl = budgetIssueUrl(source.issueUrl);
  var completionOverride = budgetCompletionOverride(source.completionOverride);
  var progress = budgetPlanProgress(source.progress);

  if (!aggregationKey) throw new Error("予実計画の集計キーが空です (index: " + index + ")。");
  if (aggregationKey.length > 200) throw new Error("予実計画の集計キーは 200 文字以内で指定してください。");
  if (!isFinite(plannedHours) || plannedHours < 0) {
    throw new Error("予実計画の予定工数は 0 以上の数値で指定してください (index: " + index + ")。");
  }
  if (!isFinite(priority) || priority < 0) priority = index;
  if (!isFinite(initialPlannedHours) || initialPlannedHours < 0) initialPlannedHours = plannedHours;
  if (startDate && endDate && endDate < startDate) endDate = startDate;
  if (!isFinite(dailyCap) || dailyCap <= 0) dailyCap = 0;
  if (carryWeek && !/^\d{4}-W\d{2}$/.test(carryWeek)) carryWeek = "";

  return {
    periodType: periodType,
    periodKey: periodKey,
    aggregationKey: aggregationKey,
    plannedHours: roundHours(plannedHours),
    note: String(source.note == null ? "" : source.note).trim(),
    priority: priority,
    estimatedTotalHours: roundHours(plannedHours),
    initialPlannedHours: roundHours(initialPlannedHours),
    planKind: planKind,
    createdAt: String(source.createdAt == null ? "" : source.createdAt).trim(),
    planId: planId,
    startDate: startDate,
    endDate: endDate,
    undated: undated,
    dailyCap: roundHours(dailyCap),
    carryWeek: carryWeek,
    calendarKey: calendarKey,
    projectId: projectId,
    issueUrl: issueUrl,
    done: budgetBoolean(source.done),
    autoComplete: completionOverride == null && budgetBoolean(source.done) && (source.autoComplete === true || budgetIsAutoCompleteCell(source.done)),
    completionOverride: completionOverride,
    progress: progress,
    dailyPlan: normalizeBudgetDailyPlan(source.dailyPlan)
  };
}

function normalizeBudgetPlans(payload) {
  var source = Array.isArray(payload) ? payload : (payload && payload.plans) || [];
  var result = [];
  var seen = {};

  source.forEach(function(plan, index) {
    var normalized = normalizeBudgetPlan(plan, index);
    var identity = normalized.planId
      ? normalized.periodType + "\u0000" + normalized.periodKey + "\u0000id\u0000" + normalized.planId
      : normalized.periodType + "\u0000" + normalized.periodKey + "\u0000name\u0000" + normalized.aggregationKey;
    if (seen[identity]) {
      throw new Error(normalized.planId
        ? "同じ期間・予定IDの予実計画が重複しています。"
        : "同じ期間・集計キーの予実計画が重複しています。");
    }
    seen[identity] = true;
    result.push(normalized);
  });
  return result;
}

function budgetNumber(value) {
  var number = parseFloat(value);
  return isFinite(number) ? number : 0;
}

function budgetDailyTaskIsComplete(row) {
  return String(row && row[5] != null ? row[5] : "").trim() === "完了";
}

function budgetPlanNoteIsDone(note) {
  return /(^|\n)done:(1|true)(\n|$)/i.test(String(note == null ? "" : note));
}

function budgetPlanSubjectKey(plan) {
  if (!plan) return "";
  return String(plan.planId || plan.aggregationKey || "").trim();
}

function budgetUniquePlanByName(plans) {
  var counts = {};
  var unique = {};
  (plans || []).forEach(function(plan) {
    var name = String((plan && plan.aggregationKey) || "").trim();
    if (!name) return;
    counts[name] = (counts[name] || 0) + 1;
  });
  (plans || []).forEach(function(plan) {
    var name = String((plan && plan.aggregationKey) || "").trim();
    if (!name || counts[name] !== 1) return;
    unique[name] = plan;
  });
  return unique;
}

function budgetPlanIdentityName(name) {
  var raw = String(name == null ? "" : name).trim();
  var match = raw.match(/^(前週繰越|前週繰り越し)[\s\u3000]+(.+)$/);
  return match ? String(match[2] || "").trim() : raw;
}

function budgetDailyRowIsCalendarAuto(row) {
  return String((row && row[6]) == null ? "" : row[6]).trim() === "カレンダー";
}

function budgetDailyRowIsInterrupt(row) {
  var mark = String((row && row[6]) == null ? "" : row[6]).trim();
  return mark === "割り込み" || mark.indexOf(BUDGET_CALENDAR_INTERRUPT_PREFIX) === 0;
}

function budgetDailyRowIsCalendarInterrupt(row) {
  var mark = String((row && row[6]) == null ? "" : row[6]).trim();
  return mark.indexOf(BUDGET_CALENDAR_INTERRUPT_PREFIX) === 0;
}

function budgetCalendarKeyFromMark(mark) {
  var value = String(mark == null ? "" : mark).trim();
  if (value.indexOf(BUDGET_CALENDAR_INTERRUPT_PREFIX) !== 0) return "";
  return value.slice(BUDGET_CALENDAR_INTERRUPT_PREFIX.length).trim();
}

function budgetDailyBelongsToPlan(dailyName, planName) {
  var daily = budgetPlanIdentityName(dailyName);
  var plan = budgetPlanIdentityName(planName);
  var next;
  if (!daily || !plan) return false;
  if (daily === plan) return true;
  if (daily.length <= plan.length || daily.indexOf(plan) !== 0) return false;
  next = daily.charAt(plan.length);
  return next === " " || next === "\u3000" || next === "/" || next === "\uff0f" || next === ":" || next === "\uff1a" || next === "-";
}

function budgetParentKeyForDailyName(dailyName, planNames) {
  var daily = String(dailyName == null ? "" : dailyName).trim();
  var best = "";
  (planNames || []).forEach(function(planName) {
    if (budgetDailyBelongsToPlan(daily, planName) && budgetPlanIdentityName(planName).length > budgetPlanIdentityName(best).length) best = planName;
  });
  return best || daily;
}

function budgetChildNameForDaily(dailyName, parentName) {
  var daily = String(dailyName == null ? "" : dailyName).trim();
  var parent = String(parentName == null ? "" : parentName).trim();
  if (!parent || !daily || daily === parent || !budgetDailyBelongsToPlan(daily, parent)) return "";
  return daily.slice(parent.length).replace(/^[\s\u3000/／:：-]+/, "");
}

function budgetHoursBeforeDateFromActualByDate(actualByDate, dateYmd) {
  var total = 0;
  var date = String(dateYmd || "");
  Object.keys(actualByDate || {}).forEach(function(key) {
    if (String(key) < date) total += budgetNumber(actualByDate[key]);
  });
  return roundHours(total);
}

function budgetWeeklyDailyHoursContext(dateYmd, plans, dailyRows, subtasks, timezone) {
  var targetYmd = String(dateYmd || "").trim();
  var tz = timezone || Session.getScriptTimeZone() || "Asia/Tokyo";
  var actualBefore = {};
  var hoursByExactName = {};
  // 振り返り範囲でいちばん古い行に保存されている「これまでの工数」（範囲より前の履歴）。
  var baseByExactName = {};
  var hoursByPlanChild = {};
  var latestDailyByPlan = {};
  var planKeys = (plans || []).map(function(plan) { return plan.aggregationKey; });
  var plansById = {};
  var uniqueByName = budgetUniquePlanByName(plans);
  (plans || []).forEach(function(plan) { if (plan.planId) plansById[plan.planId] = plan; });
  (dailyRows || []).forEach(function(row) {
    var rowYmd = budgetDateCellKey(row[0], tz);
    var name = String(row[1] == null ? "" : row[1]).trim();
    if (!name || !rowYmd || rowYmd >= targetYmd) return;
    if (budgetDailyRowIsCalendarAuto(row) || budgetDailyRowIsInterrupt(row)) return;
    hoursByExactName[name] = roundHours((hoursByExactName[name] || 0) + budgetNumber(row[2]));
    if (!baseByExactName[name] || rowYmd < baseByExactName[name].date) baseByExactName[name] = { date: rowYmd, previous: budgetNumber(row[3]) };
    var linkedPlan = plansById[budgetStableId(row[7])];
    if (!linkedPlan) linkedPlan = uniqueByName[budgetParentKeyForDailyName(name, planKeys)] || null;
    var parentKey = linkedPlan ? linkedPlan.aggregationKey : budgetParentKeyForDailyName(name, planKeys);
    actualBefore[parentKey] = (actualBefore[parentKey] || 0) + budgetNumber(row[2]);
    if (linkedPlan && linkedPlan.planId) {
      actualBefore[linkedPlan.planId] = (actualBefore[linkedPlan.planId] || 0) + budgetNumber(row[2]);
      var child = budgetChildNameForDaily(name, linkedPlan.aggregationKey);
      if (child) {
        var stamp = linkedPlan.planId + "\0" + child;
        hoursByPlanChild[stamp] = roundHours((hoursByPlanChild[stamp] || 0) + budgetNumber(row[2]));
      }
    }
    if (linkedPlan) {
      var planKey = budgetPlanSubjectKey(linkedPlan);
      var latestByName = latestDailyByPlan[planKey] || (latestDailyByPlan[planKey] = {});
      var previousDaily = latestByName[name];
      if (!previousDaily || rowYmd >= previousDaily.date) {
        latestByName[name] = { date: rowYmd, complete: budgetDailyTaskIsComplete(row) };
      }
    }
  });
  Object.keys(actualBefore).forEach(function(key) {
    actualBefore[key] = roundHours(actualBefore[key]);
  });
  var completedByPlan = {};
  Object.keys(latestDailyByPlan).forEach(function(planKey) {
    var dailies = latestDailyByPlan[planKey];
    var names = Object.keys(dailies);
    completedByPlan[planKey] = names.length > 0 && names.every(function(name) {
      return !!dailies[name].complete;
    });
  });
  // 予定に結び付かない作業の「これまでの工数」は、保存値ではなく実績から計算し直す。
  // 過去の日の工数を直したとき、翌日以降にも反映されるようにする。
  var previousByExactName = {};
  Object.keys(hoursByExactName).forEach(function(name) {
    previousByExactName[name] = roundHours((baseByExactName[name] ? baseByExactName[name].previous : 0) + hoursByExactName[name]);
  });
  return {
    plans: plans || [],
    subtasks: subtasks || [],
    hoursByExactName: hoursByExactName,
    previousByExactName: previousByExactName,
    hoursByPlanChild: hoursByPlanChild,
    actualBefore: actualBefore,
    completedByPlan: completedByPlan
  };
}

function budgetWeeklySyncedHoursForDailyTask(task, dateYmd, plans, subtasks, hoursByExactName, actualBefore, hoursByPlanChild, previousByExactName) {
  var name = String((task && (task.title || task.name)) || "").trim();
  var type = String((task && task.type) || "");
  var previous = roundHours(task && (task.prevB != null ? task.prevB : task.previous));
  var estimate = roundHours(task && (task.prevC != null ? task.prevC : task.estimate));
  var calendar = type === "calendar" || type === "calendar-imported";
  var interrupt = type === "interrupt";
  if (!name || calendar || interrupt) {
    if (interrupt) {
      previous = 0;
      estimate = roundHours(task && (task.hours != null ? task.hours : task.today));
    }
    return { prevB: previous, prevC: estimate, previous: previous, estimate: estimate };
  }
  var plan = budgetPlanForDailyTask(task, plans);
  if (!plan) {
    if (previousByExactName && Object.prototype.hasOwnProperty.call(previousByExactName, name)) previous = roundHours(previousByExactName[name]);
    return { prevB: previous, prevC: estimate, previous: previous, estimate: estimate };
  }
  var planName = plan.aggregationKey || plan.name || plan.title;
  var linkedSubtask = (subtasks || []).filter(function(entry) {
    return task.subtaskId && String(entry.id || "") === String(task.subtaskId)
      && budgetPlanningSubtaskMatchesParent(entry, planName, plan.planId);
  })[0];
  var child = linkedSubtask ? String(linkedSubtask.title || "").trim() : budgetChildNameForDaily(name, planName);
  var planned = roundHours(plan.plannedHours != null ? plan.plannedHours : plan.planned);
  var parentPrevious = plan.actualByDate
    ? budgetHoursBeforeDateFromActualByDate(plan.actualByDate, dateYmd)
    : roundHours((actualBefore && actualBefore[planName]) || plan.prevB || 0);
  if (!child) {
    return { prevB: parentPrevious, prevC: planned, previous: parentPrevious, estimate: planned };
  }
  var sub = null;
  (subtasks || []).some(function(entry) {
    if (!budgetPlanningSubtaskMatchesParent(entry, planName, plan.planId) || String(entry.title || "").trim() !== child) return false;
    sub = entry;
    return true;
  });
  var childEstimate = sub ? roundHours(sub.plannedHours) : planned;
  var planChildStamp = String(plan.planId || "") + "\0" + child;
  var childPrevious = hoursByPlanChild && Object.prototype.hasOwnProperty.call(hoursByPlanChild, planChildStamp)
    ? roundHours(hoursByPlanChild[planChildStamp])
    : hoursByExactName && Object.prototype.hasOwnProperty.call(hoursByExactName, name)
    ? roundHours(hoursByExactName[name])
    : hoursByExactName && Object.prototype.hasOwnProperty.call(hoursByExactName, child)
      ? roundHours(hoursByExactName[child])
      : sub && sub.prevB != null && Number(sub.prevB) > 0
        ? roundHours(sub.prevB)
        : previous;
  return { prevB: childPrevious, prevC: childEstimate, previous: childPrevious, estimate: childEstimate };
}

function applyBudgetWeeklyHoursToDailyTasks(dateYmd, tasks, context) {
  var source = context || {};
  return (tasks || []).map(function(task) {
    var synced = budgetWeeklySyncedHoursForDailyTask(
      task,
      dateYmd,
      source.plans,
      source.subtasks,
      source.hoursByExactName,
      source.actualBefore,
      source.hoursByPlanChild,
      source.previousByExactName
    );
    var next = {};
    Object.keys(task || {}).forEach(function(key) { next[key] = task[key]; });
    next.prevB = synced.prevB;
    next.prevC = synced.prevC;
    if (Object.prototype.hasOwnProperty.call(next, "previous")) next.previous = synced.previous;
    if (Object.prototype.hasOwnProperty.call(next, "estimate")) next.estimate = synced.estimate;
    return next;
  });
}

function calculateBudgetSummary(periodType, periodKey, planRows, dailyRows, timezone) {
  var type = normalizeBudgetPeriodType(periodType);
  var key = normalizeBudgetPeriodKey(type, periodKey);
  var tz = timezone || Session.getScriptTimeZone() || "Asia/Tokyo";
  var allPlans = normalizeBudgetPlans(planRows || []);
  var plans = type === BUDGET_PERIOD_WEEK
    ? selectWeeklyPlansForDailySuggestions(allPlans, key, dailyRows, tz)
    : allPlans.filter(function(plan) {
      return plan.periodType === type && plan.periodKey === key;
    });
  var planBySubject = {};
  var planById = {};
  var actualByKey = {};
  var actualByKeyAndDate = {};
  var actualByExactNameAndDate = {};
  var actualByPlanChildAndDate = {};
  var calendarInterruptsByDate = {};
  var latestDailyByParent = {};
  var subjects = {};
  var uniqueByName = budgetUniquePlanByName(plans);

  plans.forEach(function(plan) {
    var subject = budgetPlanSubjectKey(plan);
    planBySubject[subject] = plan;
    if (plan.planId) planById[plan.planId] = plan;
    subjects[subject] = true;
  });
  var planKeys = (plans || []).map(function(plan) { return plan.aggregationKey; });

  (dailyRows || []).forEach(function(row) {
    if (budgetDailyRowIsCalendarAuto(row)) return;
    var inPeriod = isBudgetDateInPeriod(row[0], type, key, tz);
    var dailyName = String(row[1] == null ? "" : row[1]).trim();
    if (!dailyName) return;
    var rowPlanId = budgetStableId(row[7]);
    var linkedPlan = planById[rowPlanId];
    // 期間外の行で別の予定IDを持つものは、同名で作り直した予定へ名前で寄せない。
    // 寄せると過去の「完了」や実績が新しい予定に引き継がれてしまう。
    if (!linkedPlan && (inPeriod || !rowPlanId)) linkedPlan = uniqueByName[budgetParentKeyForDailyName(dailyName, planKeys)] || null;
    var aggregationKey = linkedPlan
      ? linkedPlan.aggregationKey
      : budgetParentKeyForDailyName(dailyName, planKeys);
    var subjectKey = linkedPlan ? budgetPlanSubjectKey(linkedPlan) : aggregationKey;
    if (!inPeriod && !(type === BUDGET_PERIOD_WEEK && linkedPlan)) return;
    actualByKey[subjectKey] = (actualByKey[subjectKey] || 0) + budgetNumber(row[2]);
    var actualDate = budgetDateCellKey(row[0], tz);
    var dailyActuals = actualByKeyAndDate[subjectKey] || (actualByKeyAndDate[subjectKey] = {});
    dailyActuals[actualDate] = (dailyActuals[actualDate] || 0) + budgetNumber(row[2]);
    if (budgetDailyRowIsCalendarInterrupt(row)) {
      var calendarEntries = calendarInterruptsByDate[actualDate] || (calendarInterruptsByDate[actualDate] = []);
      var calendarKey = budgetCalendarKeyFromMark(row[6]);
      var calendarEntry = calendarEntries.find(function(entry) {
        return (calendarKey && entry.calendarKey === calendarKey) || (!calendarKey && entry.name === dailyName);
      });
      if (calendarEntry) calendarEntry.hours = roundHours(calendarEntry.hours + budgetNumber(row[2]));
      else calendarEntries.push({ name: dailyName, hours: roundHours(budgetNumber(row[2])), calendarKey: calendarKey });
    }
    if (!budgetDailyRowIsInterrupt(row)) {
      var exactActuals = actualByExactNameAndDate[dailyName] || (actualByExactNameAndDate[dailyName] = {});
      exactActuals[actualDate] = roundHours((exactActuals[actualDate] || 0) + budgetNumber(row[2]));
      if (linkedPlan && linkedPlan.planId) {
        var child = budgetChildNameForDaily(dailyName, linkedPlan.aggregationKey);
        if (child) {
          var stamp = linkedPlan.planId + "\0" + child;
          var childActuals = actualByPlanChildAndDate[stamp] || (actualByPlanChildAndDate[stamp] = {});
          childActuals[actualDate] = roundHours((childActuals[actualDate] || 0) + budgetNumber(row[2]));
        }
      }
    }
    var parentDailies = latestDailyByParent[subjectKey] || (latestDailyByParent[subjectKey] = {});
    var previousDaily = parentDailies[dailyName];
    if (!previousDaily || actualDate >= previousDaily.date) {
      parentDailies[dailyName] = { date: actualDate, complete: budgetDailyTaskIsComplete(row) };
    }
    subjects[subjectKey] = true;
  });

  var syncCompletion = typeof planActualCompletionSyncEnabled === 'function' && planActualCompletionSyncEnabled();
  var rows = Object.keys(subjects).map(function(subjectKey) {
    var plan = planBySubject[subjectKey];
    var aggregationKey = plan ? plan.aggregationKey : subjectKey;
    var plannedHours = plan ? plan.plannedHours : 0;
    var actualHours = roundHours(actualByKey[subjectKey] || 0);
    var varianceHours = roundHours(actualHours - plannedHours);
    var consumptionRate = plannedHours > 0
      ? Math.round(actualHours / plannedHours * 10000) / 10000
      : null;
    var status = !plan ? "計画なし" : plannedHours === 0
      ? (actualHours > 0 ? "計画超過" : "未設定")
      : actualHours > plannedHours ? "超過" : actualHours === plannedHours ? "一致" : "未消化";
    var dailies = latestDailyByParent[subjectKey] || {};
    var dailyNames = Object.keys(dailies);
    var dailyTracked = dailyNames.length > 0;
    var dailyComplete = dailyTracked && dailyNames.every(function(name) { return dailies[name].complete; });
    var complete = !!(plan && plan.completionOverride === false)
      ? false
      : (syncCompletion && dailyComplete) || !!(plan && (plan.done || budgetPlanNoteIsDone(plan.note)));

    return {
      periodType: type,
      periodKey: plan ? plan.periodKey : key,
      originWeek: plan && plan.periodType === BUDGET_PERIOD_WEEK ? plan.periodKey : "",
      aggregationKey: aggregationKey,
      hasPlan: !!plan,
      note: plan ? plan.note : "",
      priority: plan ? plan.priority : Number.MAX_SAFE_INTEGER,
      estimatedTotalHours: plan ? plan.plannedHours : actualHours,
      initialPlannedHours: plan ? plan.initialPlannedHours : 0,
      planKind: plan ? plan.planKind : "unplanned",
      createdAt: plan ? plan.createdAt : "",
      planId: plan ? plan.planId : "",
      startDate: plan ? plan.startDate : "",
      endDate: plan ? plan.endDate : "",
      undated: !!(plan && plan.undated),
      dailyCap: plan ? plan.dailyCap : 0,
      carryWeek: plan ? plan.carryWeek : "",
      calendarKey: plan ? plan.calendarKey : "",
      projectId: plan ? plan.projectId : "",
      issueUrl: plan ? plan.issueUrl : "",
      done: !!(plan && plan.done),
      completionOverride: plan ? plan.completionOverride : null,
      progress: plan ? plan.progress : "",
      dailyPlan: plan ? plan.dailyPlan : {},
      remainingHours: plan ? Math.max(0, roundHours(plan.plannedHours - actualHours)) : 0,
      plannedHours: plannedHours,
      actualHours: actualHours,
      actualByDate: actualByKeyAndDate[subjectKey] || {},
      varianceHours: varianceHours,
      consumptionRate: consumptionRate,
      dailyTracked: dailyTracked,
      dailyComplete: dailyComplete,
      complete: complete,
      status: status
    };
  }).sort(function(left, right) {
    return left.priority - right.priority
      || (left.aggregationKey < right.aggregationKey ? -1 : left.aggregationKey > right.aggregationKey ? 1 : 0)
      || (left.planId < right.planId ? -1 : left.planId > right.planId ? 1 : 0);
  });

  var totals = rows.reduce(function(total, row) {
    total.plannedHours += row.plannedHours;
    total.actualHours += row.actualHours;
    total.varianceHours += row.varianceHours;
    if (row.planKind === "added") total.addedPlannedHours += row.plannedHours;
    else if (row.hasPlan) total.initialPlannedHours += row.initialPlannedHours;
    return total;
  }, { plannedHours: 0, actualHours: 0, varianceHours: 0, initialPlannedHours: 0, addedPlannedHours: 0 });
  totals.plannedHours = roundHours(totals.plannedHours);
  totals.actualHours = roundHours(totals.actualHours);
  totals.varianceHours = roundHours(totals.varianceHours);
  totals.initialPlannedHours = roundHours(totals.initialPlannedHours);
  totals.addedPlannedHours = roundHours(totals.addedPlannedHours);
  totals.consumptionRate = totals.plannedHours > 0
    ? Math.round(totals.actualHours / totals.plannedHours * 10000) / 10000
    : null;

  return {
    periodType: type,
    periodKey: key,
    range: getBudgetPeriodRange(type, key),
    rows: rows,
    totals: totals,
    dailyActualByName: actualByExactNameAndDate,
    dailyActualByPlanChild: actualByPlanChildAndDate,
    calendarInterruptsByDate: calendarInterruptsByDate
  };
}

function loadBudgetPlanRows(spreadsheetId) {
  requireSheetsApi();
  var canUseCache = typeof getCachedSheetValues === "function" && typeof putCachedSheetValues === "function";
  if (canUseCache) {
    var cached = getCachedSheetValues(spreadsheetId, BUDGET_PLAN_SHEET_NAME);
    if (cached != null) return cached;
  }
  try {
    var values = typeof appReadTableRows === "function"
      ? appReadTableRows(spreadsheetId, BUDGET_PLAN_SHEET_NAME)
      : (Sheets.Spreadsheets.Values.get(spreadsheetId, a1Range(BUDGET_PLAN_SHEET_NAME, "A2:V"), VALUES_GET_OPTS).values || []);
    if (canUseCache) putCachedSheetValues(spreadsheetId, BUDGET_PLAN_SHEET_NAME, values);
    return values;
  } catch (err) {
    if (isMissingSheet(err)) return [];
    throw err;
  }
}

function listBudgetDailySheetNamesForYmdRange(spreadsheetId, startYmd, endExclusiveYmd) {
  var start = budgetDateFromYmd(startYmd);
  var end = budgetDateFromYmd(endExclusiveYmd);
  end.setUTCDate(end.getUTCDate() - 1);
  if (!(end >= start)) return [];
  var startSerial = start.getUTCFullYear() * 12 + start.getUTCMonth();
  var endSerial = end.getUTCFullYear() * 12 + end.getUTCMonth();
  var meta = sheetsGetMeta(spreadsheetId);

  return (meta.sheets || []).map(function(sheet) {
    var parsed = parseSheetMonth(sheet.properties && sheet.properties.title);
    if (!parsed) return null;
    var serial = parsed.year * 12 + parsed.month - 1;
    return serial >= startSerial && serial <= endSerial ? sheet.properties.title : null;
  }).filter(function(name) { return !!name; });
}

function listBudgetDailySheetNames(spreadsheetId, periodType, periodKey) {
  var range = getBudgetPeriodRange(periodType, periodKey);
  return listBudgetDailySheetNamesForYmdRange(spreadsheetId, range.startYmd, range.endExclusiveYmd);
}

function loadBudgetDailyRowsForYmdRange(spreadsheetId, startYmd, endExclusiveYmd) {
  var names = listBudgetDailySheetNamesForYmdRange(spreadsheetId, startYmd, endExclusiveYmd);
  if (names.length === 0) return [];
  var valuesByName = {};
  var missingNames = [];
  var canUseCache = typeof getCachedSheetValues === "function" && typeof putCachedSheetValues === "function";
  if (canUseCache && typeof prefetchCachedSheetValues === "function") prefetchCachedSheetValues(spreadsheetId, names);
  names.forEach(function(name) {
    var cached = canUseCache ? getCachedSheetValues(spreadsheetId, name) : null;
    if (cached != null) valuesByName[name] = cached;
    else missingNames.push(name);
  });
  if (missingNames.length) {
    var byHeader = typeof appTableReadRanges === "function";
    var fetched = sheetsValuesBatchGet(spreadsheetId, byHeader ? appTableReadRanges(missingNames) : missingNames.map(function(name) {
      return a1Range(name, "A2:I");
    }));
    missingNames.forEach(function(name, index) {
      valuesByName[name] = byHeader ? appTableRowsFromValues(name, fetched[index] || []).rows : fetched[index] || [];
      if (canUseCache) putCachedSheetValues(spreadsheetId, name, valuesByName[name]);
    });
  }
  var rows = [];
  names.forEach(function(name) {
    (valuesByName[name] || []).forEach(function(row) { rows.push(row); });
  });
  return rows;
}

function loadBudgetDailyRows(spreadsheetId, periodType, periodKey) {
  var range = getBudgetPeriodRange(periodType, periodKey);
  return loadBudgetDailyRowsForYmdRange(spreadsheetId, range.startYmd, range.endExclusiveYmd);
}

function budgetWeekdayCount(startYmd, endExclusiveYmd) {
  var cursor = budgetDateFromYmd(startYmd);
  var end = budgetDateFromYmd(endExclusiveYmd);
  var count = 0;
  while (cursor < end) {
    var day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function calculateMonthlyAllocationForWeek(weekKey, planRows) {
  var normalizedWeekKey = normalizeBudgetPeriodKey(BUDGET_PERIOD_WEEK, weekKey);
  var weekRange = getBudgetPeriodRange(BUDGET_PERIOD_WEEK, normalizedWeekKey);
  var plans = normalizeBudgetPlans(planRows || []).filter(function(plan) {
    return plan.periodType === BUDGET_PERIOD_MONTH;
  });
  var byTask = {};
  var monthKeys = [];
  var cursor = budgetDateFromYmd(weekRange.startYmd);
  var weekEnd = budgetDateFromYmd(weekRange.endExclusiveYmd);

  while (cursor < weekEnd) {
    var monthKey = budgetYmd(cursor).slice(0, 7);
    if (monthKeys.indexOf(monthKey) < 0) monthKeys.push(monthKey);
    var monthRange = getBudgetPeriodRange(BUDGET_PERIOD_MONTH, monthKey);
    var overlapStart = weekRange.startYmd > monthRange.startYmd ? weekRange.startYmd : monthRange.startYmd;
    var overlapEnd = weekRange.endExclusiveYmd < monthRange.endExclusiveYmd ? weekRange.endExclusiveYmd : monthRange.endExclusiveYmd;
    var monthWeekdays = budgetWeekdayCount(monthRange.startYmd, monthRange.endExclusiveYmd);
    var overlapWeekdays = budgetWeekdayCount(overlapStart, overlapEnd);
    plans.filter(function(plan) { return plan.periodKey === monthKey; }).forEach(function(plan) {
      var row = byTask[plan.aggregationKey] || {
        aggregationKey: plan.aggregationKey,
        monthlyPlannedHours: 0,
        suggestedHours: 0,
        note: plan.note || "",
        monthKeys: []
      };
      row.monthlyPlannedHours += plan.plannedHours;
      row.suggestedHours += monthWeekdays > 0 ? plan.plannedHours * overlapWeekdays / monthWeekdays : 0;
      row.monthKeys.push(monthKey);
      byTask[plan.aggregationKey] = row;
    });
    cursor = budgetDateFromYmd(monthRange.endExclusiveYmd);
  }

  var rows = Object.keys(byTask).sort().map(function(name) {
    var row = byTask[name];
    row.monthlyPlannedHours = roundHours(row.monthlyPlannedHours);
    row.suggestedHours = roundHours(row.suggestedHours);
    return row;
  });
  return { weekKey: normalizedWeekKey, monthKeys: monthKeys, rows: rows };
}

function loadMonthlyAllocationForWeek(weekKey, planModels) {
  if (planModels != null) return calculateMonthlyAllocationForWeek(weekKey, planModels);
  var range = getBudgetPeriodRange(BUDGET_PERIOD_WEEK, weekKey);
  var spreadsheetIds = annualSpreadsheetIdsForRange(range.startYmd, range.endExclusiveYmd);
  var rows = [];
  spreadsheetIds.forEach(function(spreadsheetId) {
    loadBudgetPlanRows(spreadsheetId).forEach(function(row) { rows.push(row); });
  });
  return calculateMonthlyAllocationForWeek(
    weekKey,
    rows.map(budgetPersistedPlanFromRow).filter(function(plan) { return !!plan; })
  );
}

function budgetPlanIsOrigin(plan) {
  if (!plan || plan.periodType !== BUDGET_PERIOD_WEEK) return false;
  if (plan.calendarKey || budgetCalendarKeyFromNote(plan.note)) return false;
  if (plan.done || budgetPlanNoteIsDone(plan.note)) return false;
  if (plan.carryWeek || budgetCarryWeekFromNote(plan.note)) return false;
  return true;
}

// 期間（開始日〜終了日）で表示する週予定。繰り越しの写しやカレンダー由来の行は除く。
function budgetPlanIsSpanPlan(plan) {
  if (!plan || plan.periodType !== BUDGET_PERIOD_WEEK) return false;
  if (plan.calendarKey || budgetCalendarKeyFromNote(plan.note)) return false;
  if (plan.carryWeek || budgetCarryWeekFromNote(plan.note)) return false;
  return true;
}

var BUDGET_PLAN_LOOKBACK_WEEKS = 16;
// 実績画面で前倒し着手できるよう、この週数先までの未完了予定を候補に出す。
var BUDGET_PLAN_UPCOMING_WEEKS = 4;

// 週の画面に載せる予定を選ぶ。保存先は登録した週のまま、期間がこの週にかかる予定、
// この週に実績がある予定（前倒し・期限後の作業）、未完了のまま残る前の週の予定を含める。
// options.includeUpcoming は実績画面の候補用で、これから始まる未完了の予定も含める。
function selectWeeklyPlansForDailySuggestions(allPlans, weekKey, dailyRows, timezone, options) {
  var key = String(weekKey || "").trim();
  var includeUpcoming = !!(options && options.includeUpcoming);
  var range = getBudgetPeriodRange(BUDGET_PERIOD_WEEK, key);
  var actualPlanIds = {};
  (dailyRows || []).forEach(function(row) {
    if (!isBudgetDateInPeriod(row[0], BUDGET_PERIOD_WEEK, key, timezone)) return;
    var id = budgetStableId(row[7]);
    if (id) actualPlanIds[id] = true;
  });
  var native = [];
  var seen = {};
  (allPlans || []).forEach(function(plan) {
    if (!plan || plan.periodType !== BUDGET_PERIOD_WEEK || plan.periodKey !== key) return;
    if (plan.calendarKey || budgetCalendarKeyFromNote(plan.note)) return;
    if (plan.carryWeek || budgetCarryWeekFromNote(plan.note)) return;
    native.push(plan);
    if (plan.planId) seen[plan.planId] = true;
    else seen[plan.aggregationKey] = true;
  });
  var others = [];
  // 優先順位は予定ごとに全体で共通（登録した週の値が正本）なので、引き継いだ予定もそのまま使う。
  function addOther(plan) {
    var id = plan.planId || plan.aggregationKey;
    if (seen[id]) return;
    seen[id] = true;
    others.push(plan);
  }
  function plansInWeek(periodKey) {
    return (allPlans || []).filter(function(plan) { return plan && plan.periodKey === periodKey; });
  }
  function worksThisWeek(plan) {
    return budgetPlanIsSpanPlan(plan) && (
      (plan.planId && actualPlanIds[plan.planId]) ||
      budgetPlanOverlapsRange(plan, range.startYmd, range.endExclusiveYmd)
    );
  }
  var cursor = key;
  var index;
  for (index = 0; index < BUDGET_PLAN_LOOKBACK_WEEKS; index++) {
    try { cursor = previousBudgetWeekKey(cursor); }
    catch (err) { break; }
    if (!cursor || cursor === key) break;
    plansInWeek(cursor).forEach(function(plan) {
      if (budgetPlanIsOrigin(plan) || worksThisWeek(plan)) addOther(plan);
    });
  }
  cursor = key;
  for (index = 0; index < BUDGET_PLAN_LOOKBACK_WEEKS; index++) {
    try { cursor = nextBudgetWeekKey(cursor); }
    catch (err) { break; }
    if (!cursor || cursor === key) break;
    var upcoming = includeUpcoming && index < BUDGET_PLAN_UPCOMING_WEEKS;
    plansInWeek(cursor).forEach(function(plan) {
      if (worksThisWeek(plan) || (upcoming && budgetPlanIsOrigin(plan))) addOther(plan);
    });
  }
  return native.concat(others);
}

// 期間にかかる週キーを順に返す（月のガント表示用）。
function budgetWeekKeysForRange(startYmd, endExclusiveYmd, timezone) {
  var keys = [];
  var key = getBudgetPeriodKey(budgetDateFromYmd(startYmd), BUDGET_PERIOD_WEEK, timezone || Session.getScriptTimeZone() || "Asia/Tokyo");
  for (var index = 0; index < 8 && key; index++) {
    keys.push(key);
    var next = nextBudgetWeekKey(key);
    if (getBudgetPeriodRange(BUDGET_PERIOD_WEEK, next).startYmd >= endExclusiveYmd) break;
    key = next;
  }
  return keys;
}

// 月のガント表示に出す予定の行。週ごとの集計を予定IDでまとめ、日ごとの実績は日付で重ねる。
function mergeBudgetGanttWeekRows(weekRows) {
  var byId = {};
  var order = [];
  (weekRows || []).forEach(function(rows) {
    (rows || []).forEach(function(row) {
      if (!row || !row.hasPlan || row.calendarKey) return;
      var id = row.planId || (row.periodKey + "\u0000" + row.aggregationKey);
      var found = byId[id];
      if (!found) {
        found = {};
        Object.keys(row).forEach(function(field) { found[field] = row[field]; });
        found.actualByDate = {};
        Object.keys(row.actualByDate || {}).forEach(function(date) { found.actualByDate[date] = row.actualByDate[date]; });
        byId[id] = found;
        order.push(id);
        return;
      }
      Object.keys(row.actualByDate || {}).forEach(function(date) {
        if (found.actualByDate[date] == null) found.actualByDate[date] = row.actualByDate[date];
      });
      if (budgetNumber(row.actualHours) > budgetNumber(found.actualHours)) found.actualHours = row.actualHours;
    });
  });
  return order.map(function(id) { return byId[id]; });
}

// 日ごとの実績合計（予定にない作業も含む）。カレンダーの自動行は数えない。
function budgetDailyTotalsForRange(dailyRows, range, timezone) {
  var totals = {};
  (dailyRows || []).forEach(function(row) {
    if (budgetDailyRowIsCalendarAuto(row)) return;
    if (!String(row[1] == null ? "" : row[1]).trim()) return;
    var date = budgetDateCellKey(row[0], timezone);
    if (!(date >= range.startYmd && date < range.endExclusiveYmd)) return;
    totals[date] = roundHours((totals[date] || 0) + budgetNumber(row[2]));
  });
  return totals;
}

function budgetNoteField(note, field) {
  var lines = String(note == null ? "" : note).split("\n");
  var index = 0;
  for (index = 0; index < lines.length; index++) {
    var match = String(lines[index] || "").match(/^(start|cap|carry|cal|done|day):(.*)$/);
    if (!match) break;
    if (match[1] === field) return String(match[2] || "").trim();
  }
  return "";
}

function budgetRestNote(note) {
  var lines = String(note == null ? "" : note).split("\n");
  var index = 0;
  while (index < lines.length && /^(start|cap|carry|cal|done|day):/.test(String(lines[index] || ""))) index++;
  return lines.slice(index).join("\n").trim();
}

function budgetDailyCapFromNote(note) {
  var value = Number(budgetNoteField(note, "cap"));
  return isFinite(value) && value > 0 ? roundHours(value) : 0;
}

function budgetDoneFromNote(note) {
  return budgetBoolean(budgetNoteField(note, "done"));
}

function budgetCompletionOverrideFromNote(note) {
  return budgetCompletionOverride(budgetNoteField(note, "done"));
}

function budgetDailyPlanFromNote(note) {
  return normalizeBudgetDailyPlan(budgetNoteField(note, "day"));
}

function budgetCarryWeekFromNote(note) {
  var value = budgetNoteField(note, "carry");
  return /^\d{4}-W\d{2}$/.test(value) ? value : "";
}

function budgetCalendarKeyFromNote(note) {
  return budgetNoteField(note, "cal");
}

function budgetStartDateFromNote(note) {
  var value = String(budgetNoteField(note, "start") || "").trim().replace(/[\/.]/g, "-");
  var match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return "";
  return match[1] + "-" + budgetPad2(match[2]) + "-" + budgetPad2(match[3]);
}

// 予定とサブタスクは、その期間（ISO週・月）の年のファイルに保存される。実績の振り返り範囲が
// 年をまたぐときは、範囲にかかる前の年のファイルの予定・サブタスクも読む（1月に前年12月から
// 続く予定や繰越元が見えるように）。書き込みは常にその期間の年のファイルだけに行う。
function budgetPlanningSpreadsheetIds(periodType, periodKey, dailyRange) {
  var primary = getPlanningSpreadsheetId(periodType, periodKey);
  var ids = primary ? [primary] : [];
  if (dailyRange && typeof annualSpreadsheetIdsForRange === "function") {
    annualSpreadsheetIdsForRange(dailyRange.startYmd, dailyRange.endExclusiveYmd).forEach(function(id) {
      if (id && ids.indexOf(id) < 0) ids.push(id);
    });
  }
  return ids;
}

function loadBudgetPlansFromSpreadsheets(spreadsheetIds) {
  var seen = {};
  var plans = [];
  (spreadsheetIds || []).forEach(function(spreadsheetId) {
    loadBudgetPlanRows(spreadsheetId).map(budgetPersistedPlanFromRow).forEach(function(plan) {
      if (!plan) return;
      var stamp = [plan.planId, plan.periodType, plan.periodKey, plan.aggregationKey].join("\u0000");
      if (seen[stamp]) return;
      seen[stamp] = true;
      plans.push(plan);
    });
  });
  return plans;
}

function loadPlanningTasksFromSpreadsheets(spreadsheetIds) {
  if (typeof loadPlanningTaskRows !== "function" || typeof planningTaskFromRow !== "function") return [];
  var seen = {};
  var tasks = [];
  (spreadsheetIds || []).forEach(function(spreadsheetId) {
    loadPlanningTaskRows(spreadsheetId).map(planningTaskFromRow).forEach(function(task) {
      if (!task) return;
      var stamp = [task.id, task.periodType, task.periodKey, task.parentKey, task.title].join("\u0000");
      if (seen[stamp]) return;
      seen[stamp] = true;
      tasks.push(task);
    });
  });
  return tasks;
}

function loadWeeklyDailyHoursContext(dateStr) {
  var targetYmd = String(dateStr == null ? "" : dateStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetYmd)) return null;
  var timezone = Session.getScriptTimeZone() || "Asia/Tokyo";
  var weekKey = getBudgetPeriodKey(new Date(targetYmd + "T12:00:00"), BUDGET_PERIOD_WEEK, timezone);
  var spreadsheetId = getPlanningSpreadsheetId(BUDGET_PERIOD_WEEK, weekKey);
  if (!spreadsheetId) {
    return { weekKey: weekKey, plans: [], subtasks: [], hoursByExactName: {}, hoursByPlanChild: {}, actualBefore: {}, timezone: timezone };
  }
  var dailyRange = budgetWeeklyActualsRange(weekKey, timezone);
  var planningSpreadsheetIds = budgetPlanningSpreadsheetIds(BUDGET_PERIOD_WEEK, weekKey, dailyRange);
  var allPlans = loadBudgetPlansFromSpreadsheets(planningSpreadsheetIds);
  var plans = selectWeeklyPlansForDailySuggestions(
    allPlans,
    weekKey,
    null,
    timezone,
    { includeUpcoming: true }
  );
  var dailyRows = [];
  var seenDays = {};
  var weekKeys = [weekKey];
  plans.forEach(function(plan) {
    if (plan.periodKey && weekKeys.indexOf(plan.periodKey) < 0) weekKeys.push(plan.periodKey);
  });
  annualSpreadsheetIdsForRange(dailyRange.startYmd, dailyRange.endExclusiveYmd).forEach(function(dailySpreadsheetId) {
    loadBudgetDailyRowsForYmdRange(dailySpreadsheetId, dailyRange.startYmd, dailyRange.endExclusiveYmd).forEach(function(row) {
      var stamp = budgetDateCellKey(row[0], timezone) + "\u0000" + String(row[1] == null ? "" : row[1]).trim() + "\u0000" + String(row[7] == null ? "" : row[7]).trim();
      if (seenDays[stamp]) return;
      seenDays[stamp] = true;
      dailyRows.push(row);
    });
  });
  var subtasks = [];
  var seenSubs = {};
  var allTasks = [];
  if (typeof loadPlanningTaskRows === "function" && typeof planningTaskFromRow === "function") {
    allTasks = loadPlanningTasksFromSpreadsheets(planningSpreadsheetIds);
    weekKeys.forEach(function(key) {
      allTasks.filter(function(task) {
        return task.periodType === BUDGET_PERIOD_WEEK && task.periodKey === key;
      }).sort(function(left, right) {
        if (left.parentKey !== right.parentKey) return left.parentKey < right.parentKey ? -1 : 1;
        return left.sortOrder - right.sortOrder;
      }).forEach(function(task) {
        var stamp = String((task && task.id) || "") + "\u0000" + String((task && task.parentKey) || "") + "\u0000" + String((task && task.title) || "");
        if (seenSubs[stamp]) return;
        seenSubs[stamp] = true;
        subtasks.push(task);
      });
    });
  }
  dailyRows = budgetResolveDailyRowNames(dailyRows, allPlans, allTasks);
  var counted = budgetWeeklyDailyHoursContext(targetYmd, plans, dailyRows, subtasks, timezone);
  counted.weekKey = weekKey;
  counted.timezone = timezone;
  return counted;
}

// options.dropCompleted: 前日からの繰り越しで、週の予定が完了のものは入れない（締切前でも完了なら続きの作業はない）。
function applyWeeklyPlanHoursToDailyTasks(dateStr, tasks, options) {
  try {
    var context = loadWeeklyDailyHoursContext(dateStr);
    if (!context) return tasks || [];
    var source = tasks || [];
    if (options && options.dropCompleted) {
      source = source.filter(function(task) {
        var planId = budgetStableId(task && task.planId);
        if (!planId) return true;
        var plan = (context.plans || []).filter(function(item) { return String(item.planId || "").trim() === planId; })[0];
        return !plan || !budgetPlanSuggestionIsComplete(plan, context);
      });
    }
    return applyBudgetWeeklyHoursToDailyTasks(dateStr, source, context);
  } catch (err) {
    Logger.log("週予定との同期をスキップしました: " + err.message);
    return tasks || [];
  }
}

function budgetPlanningSubtaskMatchesParent(task, parentName, planId) {
  var title = String((task && task.title) || "").trim();
  if (!title) return false;
  var parentPlanId = String((task && task.parentPlanId) || "").trim();
  var id = String(planId || "").trim();
  if (id && parentPlanId) return parentPlanId === id;
  var parentKey = String((task && task.parentKey) || "").trim();
  var parent = String(parentName || "").trim();
  if (!parent) return false;
  return parentKey === parent;
}

function budgetPlanForDailyTask(task, plans) {
  var planId = budgetStableId(task && (task.planId || task.parentPlanId));
  var plan = null;
  var name;
  var best = null;
  var bestLen = -1;
  var conflict = false;
  if (planId) {
    (plans || []).some(function(item) {
      if (String(item.planId || item.id || "").trim() === planId) {
        plan = item;
        return true;
      }
      return false;
    });
    return plan;
  }
  name = String((task && (task.title || task.name)) || "").trim();
  if (!name) return null;
  (plans || []).forEach(function(item) {
    var key = String((item && (item.aggregationKey || item.name || item.title)) || "").trim();
    var len;
    var bestId;
    var itemId;
    if (!key || (key !== name && !budgetDailyBelongsToPlan(name, key))) return;
    len = budgetPlanIdentityName(key).length;
    if (len > bestLen) {
      best = item;
      bestLen = len;
      conflict = false;
      return;
    }
    if (len !== bestLen || !best) return;
    bestId = String(best.planId || best.id || "").trim();
    itemId = String(item.planId || item.id || "").trim();
    if ((bestId || itemId) && bestId !== itemId) conflict = true;
  });
  return conflict ? null : best;
}

function budgetComposeDailyChildName(parentName, childName) {
  var parent = String(parentName || "").trim();
  var child = String(childName || "").trim();
  if (!parent) return child;
  if (!child) return parent;
  if (budgetDailyBelongsToPlan(child, parent)) return child;
  return parent + " " + child;
}

// 日次行にサブタスクID（10列目）があるときは、今の親予定名とサブタスク名から行の名前を組み立て直す。
// 置き換えるのは集計に使うメモリ上の値だけで、シートの値は変えない。
// 予定名やサブタスク名を後から変えても、過去の実績が同じサブタスクに集計されるようにする。
function budgetDailyRowsHaveSubtaskIds(rows) {
  return (rows || []).some(function(row) { return !!budgetStableId(row && row[9]); });
}

function budgetResolveDailyRowNames(rows, plans, tasks) {
  if (!budgetDailyRowsHaveSubtaskIds(rows)) return rows || [];
  var tasksById = {};
  (tasks || []).forEach(function(task) { if (task && task.id && !tasksById[task.id]) tasksById[task.id] = task; });
  var plansById = {};
  (plans || []).forEach(function(plan) { if (plan && plan.planId && !plansById[plan.planId]) plansById[plan.planId] = plan; });
  return rows.map(function(row) {
    var task = tasksById[budgetStableId(row && row[9])];
    if (!task) return row;
    var plan = plansById[budgetStableId(row[7])] || plansById[budgetStableId(task.parentPlanId)];
    var name = budgetComposeDailyChildName(plan ? plan.aggregationKey : task.parentKey, task.title);
    if (!name || name === String(row[1] == null ? "" : row[1]).trim()) return row;
    var next = row.slice();
    next[1] = name;
    return next;
  });
}

function budgetPlanSuggestionIsComplete(plan, context) {
  if (!plan || plan.completionOverride === false) return false;
  if (plan.completionOverride === true || plan.done || budgetPlanNoteIsDone(plan.note)) return true;

  var planKey = budgetPlanSubjectKey(plan);
  var completedByPlan = context && context.completedByPlan || {};
  if (typeof planActualCompletionSyncEnabled === 'function' && planActualCompletionSyncEnabled() && planKey && completedByPlan[planKey]) return true;

  var subtasks = (context && context.subtasks || []).filter(function(task) {
    return budgetPlanningSubtaskMatchesParent(task, plan.aggregationKey, plan.planId);
  });
  if (subtasks.length && subtasks.every(function(task) {
    var status = String(task && task.status || "").trim();
    return status === "done" || status === "完了";
  })) return true;

  return false;
}

function getBudgetPlanSuggestionsForDate(dateStr) {
  var context = loadWeeklyDailyHoursContext(dateStr);
  if (!context || !context.plans.length) return [];
  return context.plans.filter(function(plan) {
    return !budgetPlanSuggestionIsComplete(plan, context);
  }).map(function(plan) {
    var carryWeek = plan.carryWeek || budgetCarryWeekFromNote(plan.note);
    var calendarKey = plan.calendarKey || budgetCalendarKeyFromNote(plan.note);
    var hoursByExactName = context.hoursByExactName || {};
    return {
      title: plan.aggregationKey,
      parentKey: plan.aggregationKey,
      planId: plan.planId,
      periodType: plan.periodType,
      periodKey: plan.periodKey,
      originWeek: plan.periodType === BUDGET_PERIOD_WEEK ? plan.periodKey : "",
      hours: 0,
      prevB: roundHours((plan.planId && context.actualBefore[plan.planId]) || context.actualBefore[plan.aggregationKey] || 0),
      prevC: plan.plannedHours,
      status: "",
      type: "planning",
      carryWeek: carryWeek,
      carry: !!carryWeek,
      calendarKey: calendarKey,
      startDate: plan.startDate || budgetStartDateFromNote(plan.note),
      endDate: plan.endDate || "",
      undated: !!plan.undated,
      done: !!plan.done,
      completionOverride: plan.completionOverride,
      progress: plan.progress || "",
      projectId: plan.projectId || "",
      subtasks: (context.subtasks || []).filter(function(task) {
        return budgetPlanningSubtaskMatchesParent(task, plan.aggregationKey, plan.planId);
      }).map(function(task) {
        var name = budgetComposeDailyChildName(plan.aggregationKey, task.title);
        return {
          id: String(task.id || ""),
          title: String(task.title || "").trim(),
          parentKey: plan.aggregationKey,
          parentPlanId: plan.planId || String(task.parentPlanId || ""),
          plannedHours: roundHours(task.plannedHours),
          prevB: roundHours((context.hoursByPlanChild || {})[String(plan.planId || "") + "\0" + String(task.title || "").trim()] || hoursByExactName[name] || hoursByExactName[String(task.title || "").trim()] || 0),
          prevC: roundHours(task.plannedHours),
          sortOrder: task.sortOrder || 0
        };
      })
    };
  });
}

function budgetPlansToPersistAsComplete(summaryRows, subtasks) {
  return (summaryRows || []).filter(function(row) {
    if (!row || !row.hasPlan || !row.planId) return false;
    if (row.completionOverride === false || row.completionOverride === true || row.done) return false;
    if (row.dailyTracked && !row.dailyComplete) return false;
    if (row.dailyComplete || row.complete) return true;
    var tasks = (subtasks || []).filter(function(task) {
      return budgetPlanningSubtaskMatchesParent(task, row.aggregationKey, row.planId);
    });
    return tasks.length > 0 && tasks.every(function(task) {
      var status = String(task && task.status || "").trim();
      return status === "done" || status === "完了";
    });
  });
}

function budgetPlansToReleaseCompletion(summaryRows) {
  return (summaryRows || []).filter(function(row) {
    if (!row || !row.hasPlan || !row.planId) return false;
    if (row.completionOverride === false) return false;
    if (!(row.done || row.completionOverride === true)) return false;
    return !!(row.dailyTracked && !row.dailyComplete);
  });
}

function budgetDayRowsChangedPlanCompletion(beforeRows, afterRows) {
  function flags(rows) {
    var map = {};
    (rows || []).forEach(function(row) {
      if (!row || budgetDailyRowIsInterrupt(row) || budgetDailyRowIsCalendarAuto(row)) return;
      var name = String(row[1] == null ? "" : row[1]).trim();
      if (!name) return;
      var id = budgetStableId(row[7]) || "";
      var key = id + "\0" + name;
      var complete = String(row[5] == null ? "" : row[5]).trim() === "完了";
      if (!Object.prototype.hasOwnProperty.call(map, key)) map[key] = complete;
      else map[key] = map[key] && complete;
    });
    return map;
  }
  var before = flags(beforeRows);
  var after = flags(afterRows);
  var keys = {};
  Object.keys(before).forEach(function(key) { keys[key] = true; });
  Object.keys(after).forEach(function(key) { keys[key] = true; });
  var changed = false;
  Object.keys(keys).forEach(function(key) {
    var left = Object.prototype.hasOwnProperty.call(before, key) ? before[key] : false;
    var right = Object.prototype.hasOwnProperty.call(after, key) ? after[key] : false;
    if (left !== right) changed = true;
  });
  return changed;
}

function savedRowsIncludePlanCompletion(rows) {
  return (rows || []).some(function(row) {
    if (String(row && row[5] || "").trim() !== "完了") return false;
    if (budgetDailyRowIsInterrupt(row) || budgetDailyRowIsCalendarAuto(row)) return false;
    return true;
  });
}

function persistEffectivePlanCompletion(periodType, periodKey) {
  var type = normalizeBudgetPeriodType(periodType);
  var key = normalizeBudgetPeriodKey(type, periodKey);
  var spreadsheetId = getPlanningSpreadsheetId(type, key);
  var subtasks = [];
  if (spreadsheetId) {
    var dailyRange = type === BUDGET_PERIOD_WEEK ? budgetWeeklyActualsRange(key, Session.getScriptTimeZone() || "Asia/Tokyo") : getBudgetPeriodRange(type, key);
    subtasks = loadPlanningTasksFromSpreadsheets(budgetPlanningSpreadsheetIds(type, key, dailyRange));
  }
  var summary = loadBudgetSummary(type, key, null, subtasks);
  var stampByPeriod = {};
  var releaseByPeriod = {};
  budgetPlansToPersistAsComplete(summary.rows, subtasks).forEach(function(row) {
    var origin = row.originWeek || row.periodKey;
    if (!origin || !row.planId) return;
    (stampByPeriod[origin] = stampByPeriod[origin] || {})[row.planId] = true;
  });
  budgetPlansToReleaseCompletion(summary.rows).forEach(function(row) {
    var origin = row.originWeek || row.periodKey;
    if (!origin || !row.planId) return;
    if (stampByPeriod[origin]) delete stampByPeriod[origin][row.planId];
    (releaseByPeriod[origin] = releaseByPeriod[origin] || {})[row.planId] = true;
  });
  var periodKeys = {};
  Object.keys(stampByPeriod).forEach(function(origin) { periodKeys[origin] = true; });
  Object.keys(releaseByPeriod).forEach(function(origin) { periodKeys[origin] = true; });
  Object.keys(periodKeys).forEach(function(originKey) {
    var originSpreadsheetId = getPlanningSpreadsheetId(type, originKey);
    if (!originSpreadsheetId) return;
    var periodPlans = loadBudgetPlanRows(originSpreadsheetId).map(budgetPersistedPlanFromRow).filter(function(plan) {
      return plan && plan.periodType === type && plan.periodKey === originKey;
    });
    var stampIds = stampByPeriod[originKey] || {};
    var releaseIds = releaseByPeriod[originKey] || {};
    var changed = false;
    periodPlans.forEach(function(plan) {
      if (releaseIds[plan.planId]) {
        if (plan.completionOverride === false) return;
        if (plan.completionOverride !== true && !plan.done) return;
        plan.done = false;
        plan.autoComplete = false;
        plan.completionOverride = null;
        changed = true;
        return;
      }
      if (!stampIds[plan.planId]) return;
      if (plan.completionOverride === false || plan.completionOverride === true) return;
      plan.done = true;
      plan.autoComplete = true;
      plan.completionOverride = null;
      changed = true;
    });
    if (changed) saveBudgetPlans({ periodType: type, periodKey: originKey, plans: periodPlans }, { skipSummary: true });
  });
}

// 予定IDが空の日次行に、その週の予定から名前で1つに決まるものの予定IDを保存時に書き込む。
// 読むたびの名前照合に頼らず、後で予定名を変えたり同名の予定が増えたりしても結び付きが残るようにする。
// 名前で1つに決まらないとき（同名の予定が複数ある・どれにも当たらない）は空のままにする。
// 行は [日付, タスク名, 本日, これまで, 予定総工数, 進捗, 管理情報, 予定ID, プロジェクトID]。
function budgetFillDailyPlanIds(dateStr, rows) {
  var targetYmd = String(dateStr == null ? "" : dateStr).trim();
  var needsFill = (rows || []).some(function(row) {
    return row && String(row[1] || "").trim() && !budgetStableId(row[7]) && !budgetDailyRowIsCalendarAuto(row) && !budgetDailyRowIsInterrupt(row);
  });
  if (!needsFill || !/^\d{4}-\d{2}-\d{2}$/.test(targetYmd)) return rows;
  var timezone = Session.getScriptTimeZone() || "Asia/Tokyo";
  var weekKey = getBudgetPeriodKey(new Date(targetYmd + "T12:00:00"), BUDGET_PERIOD_WEEK, timezone);
  var range = getBudgetPeriodRange(BUDGET_PERIOD_WEEK, weekKey);
  var plans = selectWeeklyPlansForDailySuggestions(
    loadBudgetPlansFromSpreadsheets(budgetPlanningSpreadsheetIds(BUDGET_PERIOD_WEEK, weekKey, range)),
    weekKey,
    null,
    timezone,
    { includeUpcoming: true }
  ).filter(function(plan) { return plan && plan.planId; });
  var planNames = plans.map(function(plan) { return plan.aggregationKey; });
  var uniqueByName = budgetUniquePlanByName(plans);
  return rows.map(function(row) {
    var name = String(row && row[1] || "").trim();
    if (!name || budgetStableId(row[7]) || budgetDailyRowIsCalendarAuto(row) || budgetDailyRowIsInterrupt(row)) return row;
    var plan = uniqueByName[budgetParentKeyForDailyName(name, planNames)];
    if (!plan) return row;
    var next = row.slice();
    next[7] = plan.planId;
    if (!budgetStableId(next[8]) && plan.projectId) next[8] = plan.projectId;
    return next;
  });
}

function persistEffectivePlanCompletionForDate(dateStr, savedRows, previousRows) {
  if (typeof planActualCompletionSyncEnabled !== 'function' || !planActualCompletionSyncEnabled()) return;
  var changed = budgetDayRowsChangedPlanCompletion(previousRows || [], savedRows);
  if (!savedRowsIncludePlanCompletion(savedRows) && !changed) return;
  var targetYmd = String(dateStr == null ? "" : dateStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetYmd)) return;
  var timezone = Session.getScriptTimeZone() || "Asia/Tokyo";
  var weekKey = getBudgetPeriodKey(new Date(targetYmd + "T12:00:00"), BUDGET_PERIOD_WEEK, timezone);
  persistEffectivePlanCompletion(BUDGET_PERIOD_WEEK, weekKey);
}

/** 候補画面から元の週予定を完了扱いにする */
function setPlanningPlanDone(payload) {
  var source = payload || {};
  var periodType = normalizeBudgetPeriodType(source.periodType || BUDGET_PERIOD_WEEK);
  var periodKey;
  var planId = budgetStableId(source.planId || source.id);
  var name = String(source.aggregationKey || source.name || source.title || "").trim();
  if (periodType !== BUDGET_PERIOD_WEEK) throw new Error("候補から完了にできるのは週予定だけです。");
  periodKey = normalizeBudgetPeriodKey(periodType, source.periodKey);
  if (!planId && !name) throw new Error("完了にする週予定を特定できません。");

  return withUserWriteLock(function() {
    var spreadsheetId = requirePlanningSpreadsheetId(periodType, periodKey);
    var allPlans = loadBudgetPlanRows(spreadsheetId).map(budgetPersistedPlanFromRow).filter(function(plan) {
      return !!plan;
    });
    var periodPlans = allPlans.filter(function(plan) {
      return plan.periodType === periodType && plan.periodKey === periodKey;
    });
    var matches = periodPlans.filter(function(plan) {
      if (planId) return plan.planId === planId;
      return plan.aggregationKey === name;
    });
    if (matches.length === 0) throw new Error("指定した週予定が見つかりません。");
    if (matches.length > 1) throw new Error("同名の週予定が複数あるため、完了状態を変更できません。");
    matches[0].done = source.done == null ? true : budgetBoolean(source.done);
    matches[0].completionOverride = matches[0].done;
    return saveBudgetPlans({ periodType: periodType, periodKey: periodKey, plans: periodPlans });
  });
}

function ensureBudgetPlanSheet(spreadsheetId) {
  var meta = sheetsGetMeta(spreadsheetId);
  var existing = findSheetEntry(meta, BUDGET_PLAN_SHEET_NAME);
  if (existing) return existing;

  var sheetId = generateSheetId(meta);
  sheetsBatchUpdate(spreadsheetId, [{
    addSheet: {
      properties: {
        sheetId: sheetId,
        title: BUDGET_PLAN_SHEET_NAME,
        gridProperties: { frozenRowCount: 1 }
      }
    }
  }]);
  sheetsValuesUpdate(spreadsheetId, a1Range(BUDGET_PLAN_SHEET_NAME, "A1:V1"), [BUDGET_PLAN_HEADER]);
  return { properties: { sheetId: sheetId, title: BUDGET_PLAN_SHEET_NAME } };
}

// 予定の進捗。完了は「完了」列で持つので、ここでは未着手・進行中だけを保持する（空欄は自動）。
function budgetPlanProgress(value) {
  var raw = String(value == null ? "" : value).trim().toLowerCase();
  if (raw === "doing" || raw === "進行中") return "doing";
  if (raw === "todo" || raw === "未着手") return "todo";
  return "";
}

function budgetPlanProgressLabel(value) {
  var progress = budgetPlanProgress(value);
  return progress === "doing" ? "進行中" : progress === "todo" ? "未着手" : "";
}

// 課題URLは外部リンクとして画面に出すため、http(s) の URL だけを保持する。
// 課題URLはBacklogの課題ページ（https）だけを保存する。ほかのURLや http は保存しない。
function budgetIssueUrl(value) {
  var url = String(value == null ? "" : value).trim();
  if (!url || url.length > 500) return "";
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:backlog\.(?:jp|com)|backlogtool\.com)\/view\/[A-Za-z0-9_]+-\d+(?:[?#][^\s"'<>]*)?$/i.test(url)) return "";
  return url;
}

function budgetPersistedPlanFromRow(row, index) {
  try {
    var legacyNote = String(row[4] || "");
    var hasDoneCell = row[16] !== "" && row[16] != null;
    var createdAt = row[10] || row[5];
    return normalizeBudgetPlan({
      periodType: row[0],
      periodKey: row[1],
      aggregationKey: row[2],
      plannedHours: row[3],
      note: budgetRestNote(legacyNote),
      priority: row[6],
      estimatedTotalHours: row[7],
      initialPlannedHours: row[8],
      planKind: row[9],
      createdAt: createdAt,
      planId: row[11] || budgetLegacyPlanId(row[0], row[1], row[2], createdAt),
      startDate: row[12] || budgetStartDateFromNote(legacyNote),
      dailyCap: row[13] === "" || row[13] == null ? budgetDailyCapFromNote(legacyNote) : row[13],
      carryWeek: row[14] || budgetCarryWeekFromNote(legacyNote),
      calendarKey: row[15] || budgetCalendarKeyFromNote(legacyNote),
      projectId: row[18] || "",
      issueUrl: row[19] || "",
      progress: row[20] || "",
      endDate: row[21] || "",
      done: hasDoneCell ? row[16] : budgetDoneFromNote(legacyNote),
      completionOverride: hasDoneCell ? budgetCompletionOverride(row[16]) : budgetCompletionOverrideFromNote(legacyNote),
      dailyPlan: row[17] || budgetDailyPlanFromNote(legacyNote)
    }, index || 0);
  } catch (err) {
    Logger.log("予実計画の不正な行を無視しました: " + err.message);
    return null;
  }
}

// 繰り越した予定は週をまたいで同じ予定IDを持つ。名前や課題URLを変えたら
// 他の期間の同じ予定にも反映し、次の繰り越しで古い名前へ戻らないようにする。
function budgetPropagatePlanIdentity(plans, previousById, otherPlans) {
  var changedById = {};
  plans.forEach(function(plan) {
    var previous = plan.planId && previousById[plan.planId];
    if (!previous) return;
    if (previous.aggregationKey === plan.aggregationKey && previous.issueUrl === plan.issueUrl) return;
    changedById[plan.planId] = { previousName: previous.aggregationKey, plan: plan };
  });
  if (!Object.keys(changedById).length) return;
  var namesByPeriod = {};
  otherPlans.forEach(function(plan) {
    var period = plan.periodType + "\u0000" + plan.periodKey;
    (namesByPeriod[period] = namesByPeriod[period] || {})[plan.aggregationKey] = plan.planId;
  });
  otherPlans.forEach(function(plan) {
    var change = plan.planId && changedById[plan.planId];
    if (!change) return;
    var names = namesByPeriod[plan.periodType + "\u0000" + plan.periodKey];
    var nextName = change.plan.aggregationKey;
    // その期間に同名の別予定がある場合は、名前だけ付け替えない。
    var nameTaken = names[nextName] && names[nextName] !== plan.planId;
    if (plan.aggregationKey === change.previousName && !nameTaken) {
      delete names[plan.aggregationKey];
      plan.aggregationKey = nextName;
      names[nextName] = plan.planId;
    }
    plan.issueUrl = change.plan.issueUrl;
  });
}

function saveBudgetPlans(payload, options) {
  options = options || {};
  var source = payload || {};
  var periodType = normalizeBudgetPeriodType(source.periodType);
  var periodKey = normalizeBudgetPeriodKey(periodType, source.periodKey);
  var plans = normalizeBudgetPlans({ plans: source.plans || [] });
  plans.forEach(function(plan) {
    if (plan.periodType !== periodType || plan.periodKey !== periodKey) {
      throw new Error("一度に保存できる予実計画は一つの期間だけです。");
    }
  });

  var spreadsheetId = requirePlanningSpreadsheetId(periodType, periodKey);
  var allExisting = loadBudgetPlanRows(spreadsheetId).map(budgetPersistedPlanFromRow).filter(function(plan) {
    return !!plan;
  });
  var previousPeriodPlans = allExisting.filter(function(plan) {
    return plan.periodType === periodType && plan.periodKey === periodKey;
  });
  var existing = allExisting.filter(function(plan) {
    return plan.periodType !== periodType || plan.periodKey !== periodKey;
  });
  var merged = existing.concat(plans).sort(function(a, b) {
    var left = a.periodType + a.periodKey + ("0000000000000" + a.priority).slice(-13) + a.aggregationKey;
    var right = b.periodType + b.periodKey + ("0000000000000" + b.priority).slice(-13) + b.aggregationKey;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  var timezone = Session.getScriptTimeZone() || "Asia/Tokyo";
  var updatedAt = Utilities.formatDate(new Date(), timezone, "yyyy/MM/dd HH:mm:ss");
  var previousById = {};
  var previousByKey = {};
  previousPeriodPlans.forEach(function(plan) {
    if (plan.planId) previousById[plan.planId] = plan;
    else previousByKey[plan.aggregationKey] = plan;
  });
  var hasInitialSnapshot = previousPeriodPlans.length > 0;
  plans.forEach(function(plan) {
    var previous = (plan.planId && previousById[plan.planId]) || (!plan.planId && previousByKey[plan.aggregationKey]);
    // 画面から保存すると完了の予定は done だけが届くので、前回が自動の完了で、手で指定し直していなければ自動のまま残す。
    if (previous && previous.autoComplete && plan.done && plan.completionOverride == null) plan.autoComplete = true;
    if (previous) {
      plan.initialPlannedHours = previous.initialPlannedHours;
      plan.planKind = previous.planKind;
      plan.createdAt = previous.createdAt || updatedAt;
      plan.planId = previous.planId;
    } else if (plan.createdAt) {
      // タスク名の編集時も、画面へ返した初回スナップショットを引き継ぐ。
      plan.createdAt = plan.createdAt;
    } else {
      plan.initialPlannedHours = plan.plannedHours;
      // 前週繰越や月予定展開など、画面側が明示した追加予定は
      // まだ当初予定のない週でも追加予定として保持する。
      plan.planKind = plan.planKind === "added" ? "added" : hasInitialSnapshot ? "added" : "initial";
      plan.createdAt = updatedAt;
    }
    if (!plan.planId) {
      plan.planId = budgetLegacyPlanId(plan.periodType, plan.periodKey, plan.aggregationKey, plan.createdAt);
    }
  });
  budgetPropagatePlanIdentity(plans, previousById, existing);
  var oldRowCount = loadBudgetPlanRows(spreadsheetId).length;
  var values = [BUDGET_PLAN_HEADER].concat(merged.map(function(plan) {
    return [
      plan.periodType,
      plan.periodKey,
      sanitizeEnteredString(plan.aggregationKey),
      plan.plannedHours,
      sanitizeEnteredString(plan.note),
      updatedAt,
      plan.priority,
      plan.estimatedTotalHours,
      plan.initialPlannedHours,
      plan.planKind,
      plan.createdAt,
      plan.planId,
      plan.startDate,
      plan.dailyCap || "",
      plan.carryWeek,
      sanitizeEnteredString(plan.calendarKey),
      plan.completionOverride == null ? (plan.done ? (plan.autoComplete ? BUDGET_PLAN_AUTO_COMPLETE : "TRUE") : "") : (plan.completionOverride ? "TRUE" : "FALSE"),
      Object.keys(plan.dailyPlan || {}).length ? JSON.stringify(plan.dailyPlan) : "",
      plan.projectId || "",
      sanitizeEnteredString(plan.issueUrl),
      budgetPlanProgressLabel(plan.progress),
      plan.undated ? BUDGET_PLAN_UNDATED : (plan.endDate || "")
    ];
  }));
  ensureBudgetPlanSheet(spreadsheetId);
  sheetsValuesUpdate(spreadsheetId, a1Range(BUDGET_PLAN_SHEET_NAME, "A1:V" + values.length), values);
  if (oldRowCount > merged.length) {
    sheetsValuesClear(spreadsheetId, a1Range(BUDGET_PLAN_SHEET_NAME, "A" + (merged.length + 2) + ":V" + (oldRowCount + 1)));
  }
  if (typeof putCachedSheetValues === "function") putCachedSheetValues(spreadsheetId, BUDGET_PLAN_SHEET_NAME, values.slice(1));
  return options.skipSummary ? {
    periodType: periodType,
    periodKey: periodKey,
    rows: merged
  } : loadBudgetSummary(periodType, periodKey);
}

function loadBudgetSummary(periodType, periodKey, planModelsOverride, tasksOverride) {
  var type = normalizeBudgetPeriodType(periodType);
  var key = normalizeBudgetPeriodKey(type, periodKey);
  var planningSpreadsheetId = getPlanningSpreadsheetId(type, key);
  var timezone = Session.getScriptTimeZone() || "Asia/Tokyo";
  var range = getBudgetPeriodRange(type, key);
  var dailyRange = type === BUDGET_PERIOD_WEEK ? budgetWeeklyActualsRange(key, timezone) : range;
  var dailySpreadsheetIds = annualSpreadsheetIdsForRange(dailyRange.startYmd, dailyRange.endExclusiveYmd);
  var dailyRows = [];
  dailySpreadsheetIds.forEach(function(spreadsheetId) {
    loadBudgetDailyRowsForYmdRange(spreadsheetId, dailyRange.startYmd, dailyRange.endExclusiveYmd).forEach(function(row) {
      dailyRows.push(row);
    });
  });
  var planModels = planModelsOverride == null
    ? (planningSpreadsheetId ? loadBudgetPlansFromSpreadsheets(budgetPlanningSpreadsheetIds(type, key, dailyRange)) : [])
    : planModelsOverride;
  if (budgetDailyRowsHaveSubtaskIds(dailyRows)) {
    var tasks = tasksOverride || (planningSpreadsheetId ? loadPlanningTasksFromSpreadsheets(budgetPlanningSpreadsheetIds(type, key, dailyRange)) : []);
    dailyRows = budgetResolveDailyRowNames(dailyRows, planModels, tasks);
  }
  return calculateBudgetSummary(
    type,
    key,
    planModels,
    dailyRows,
    timezone
  );
}
