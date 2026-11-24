var PLAN_ACTUAL_COMPLETION_SYNC_KEY = 'planActualCompletionSync';

function planActualCompletionSyncEnabled() {
  return PropertiesService.getUserProperties().getProperty(PLAN_ACTUAL_COMPLETION_SYNC_KEY) === 'true';
}

function getPlanActualCompletionSyncSettings() {
  return { enabled: planActualCompletionSyncEnabled() };
}

function savePlanActualCompletionSyncSettings(payload) {
  return withUserWriteLock(function() {
    var enabled = !!(payload && payload.enabled === true);
    PropertiesService.getUserProperties().setProperty(PLAN_ACTUAL_COMPLETION_SYNC_KEY, String(enabled));
    return { enabled: enabled };
  });
}

// 勤務時間の設定（本人の設定）。日ごとに変えた稼働時間（稼働設定シート）がない日は、これを使う。
// - hours: 勤務日1日の標準の稼働時間
// - weekdays: 勤務する曜日（0=日〜6=土）。それ以外の曜日は0h
// - start/end: カレンダーの予定を稼働時間から差し引く時間帯
var WORKDAY_DEFAULT_HOURS_KEY = 'workdayDefaultHours';
var WORKDAY_WEEKDAYS_KEY = 'workdayWeekdays';
var WORKDAY_TIME_RANGE_KEY = 'workdayTimeRange';
var WORKDAY_DEFAULT_HOURS_FALLBACK = 8;
var WORKDAY_WEEKDAYS_FALLBACK = [1, 2, 3, 4, 5];
var WORKDAY_START_FALLBACK = '09:00';
var WORKDAY_END_FALLBACK = '18:00';

function normalizeWorkdayDefaultHours(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  var hours = Number(value);
  if (!isFinite(hours) || hours <= 0 || hours > 24) return null;
  return Math.round(hours * 4) / 4;
}

function normalizeWorkdayWeekdays(value) {
  var list = Array.isArray(value) ? value : String(value == null ? '' : value).split(',');
  var seen = {};
  list.forEach(function(item) {
    if (String(item).trim() === '') return;
    var day = Number(item);
    if (day >= 0 && day <= 6 && Math.floor(day) === day) seen[day] = true;
  });
  return Object.keys(seen).map(Number).sort(function(a, b) { return a - b; });
}

function normalizeWorkdayTime(value) {
  var match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  var hour = Number(match[1]);
  var minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) return null;
  return (hour < 10 ? '0' : '') + hour + ':' + match[2];
}

function workdayTimeMinutes(value) {
  var parts = String(value).split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function workdayUserProperties() {
  try { return PropertiesService.getUserProperties(); } catch (err) { return null; }
}

function workdayDefaultHours() {
  var props = workdayUserProperties();
  return (props && normalizeWorkdayDefaultHours(props.getProperty(WORKDAY_DEFAULT_HOURS_KEY))) || WORKDAY_DEFAULT_HOURS_FALLBACK;
}

function workdayWeekdays() {
  var props = workdayUserProperties();
  var raw = props ? props.getProperty(WORKDAY_WEEKDAYS_KEY) : null;
  return raw === null || raw === undefined ? WORKDAY_WEEKDAYS_FALLBACK.slice() : normalizeWorkdayWeekdays(raw);
}

function workdayTimeRange() {
  var props = workdayUserProperties();
  var raw = props ? props.getProperty(WORKDAY_TIME_RANGE_KEY) : null;
  var parts = String(raw || '').split('-');
  var start = normalizeWorkdayTime(parts[0]);
  var end = normalizeWorkdayTime(parts[1]);
  if (!start || !end || workdayTimeMinutes(end) <= workdayTimeMinutes(start)) return { start: WORKDAY_START_FALLBACK, end: WORKDAY_END_FALLBACK };
  return { start: start, end: end };
}

// その曜日（0=日〜6=土）の標準の稼働時間。
function workdayHoursForWeekday(weekday, settings) {
  var current = settings || getWorkdayHoursSettings();
  return current.weekdays.indexOf(Number(weekday)) >= 0 ? current.hours : 0;
}

function getWorkdayHoursSettings() {
  var range = workdayTimeRange();
  return { hours: workdayDefaultHours(), weekdays: workdayWeekdays(), start: range.start, end: range.end };
}

// 送られた項目だけを保存する（hours / weekdays / start と end）。
function saveWorkdayHoursSettings(payload) {
  payload = payload || {};
  var updates = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'hours')) {
    var hours = normalizeWorkdayDefaultHours(payload.hours);
    if (hours === null) throw new Error('1日の稼働時間は0より大きく24以下で入力してください。');
    updates[WORKDAY_DEFAULT_HOURS_KEY] = String(hours);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'weekdays')) {
    // 空のときも「未設定（標準の月〜金）」と区別できるよう none を保存する。
    updates[WORKDAY_WEEKDAYS_KEY] = normalizeWorkdayWeekdays(payload.weekdays).join(',') || 'none';
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'start') || Object.prototype.hasOwnProperty.call(payload, 'end')) {
    var start = normalizeWorkdayTime(payload.start);
    var end = normalizeWorkdayTime(payload.end);
    if (!start || !end) throw new Error('勤務時間帯は「9:00」の形で入力してください。');
    if (workdayTimeMinutes(end) <= workdayTimeMinutes(start)) throw new Error('勤務時間帯の終わりは始まりより後にしてください。');
    updates[WORKDAY_TIME_RANGE_KEY] = start + '-' + end;
  }
  return withUserWriteLock(function() {
    var props = PropertiesService.getUserProperties();
    Object.keys(updates).forEach(function(key) { props.setProperty(key, updates[key]); });
    return getWorkdayHoursSettings();
  });
}
