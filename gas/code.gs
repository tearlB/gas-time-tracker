const APP_STORAGE_FOLDER_ID_KEY = "appStorageFolderId";
const APP_STORAGE_PARENT_FOLDER_ID_KEY = "appStorageParentFolderId";
const APP_STORAGE_YEAR_FILES_KEY = "appStorageYearFiles";
const APP_STORAGE_MODE_KEY = "appStorageMode";
const APP_STORAGE_MODE_ANNUAL = "annual";
const APP_SPREADSHEET_DEFAULT_NAME = "まとめて工数管理データ";
const APP_MANAGED_FOLDER_DEFAULT_NAME = "まとめて工数管理さん";
const APP_STORAGE_STATUS_CACHE_KEY = "storage.status.v2";
const APP_STORAGE_STATUS_CACHE_TTL_SEC = 60;
// 保存先の確認は Drive を3回ほど呼び約0.5秒かかる。正常に設定済みなら長く使い回し、
// 保存先の変更（setAnnualStorageFileMap）と手動の再読み込み（clearAppReadCache）で消す。
const APP_STORAGE_STATUS_CONFIGURED_CACHE_TTL_SEC = 21600;
const SHEET_HEADER = ["日付", "タスク名 (PJ名など)", "本日の工数", "これまでの工数", "予定総工数", "進捗状況", "管理情報", "予定ID", "プロジェクトID", "サブタスクID"];
// 日次シートの最後の列（SHEET_HEADER の列数に合わせる）。
const DAILY_LAST_COLUMN = "J";
const DAILY_CALENDAR_INTERRUPT_PREFIX = "カレンダー今日だけ:";
const COLUMN_WIDTHS = [110, 350, 100, 100, 100, 100, 90, 160];
const SHEET_META_FIELDS = "spreadsheetId,sheets(properties(sheetId,title,index,gridProperties),basicFilter,rowGroups,tables(tableId))";
const SHEET_META_FIELDS_LIGHT = "spreadsheetId,sheets(properties(sheetId,title,index,gridProperties),basicFilter,rowGroups)";
const COLOR_HEADER_BG = { red: 74 / 255, green: 134 / 255, blue: 232 / 255 };
const COLOR_WHITE = { red: 1, green: 1, blue: 1 };
const COLOR_BORDER = { red: 204 / 255, green: 204 / 255, blue: 204 / 255 };
const VALUES_GET_OPTS = {
  valueRenderOption: "UNFORMATTED_VALUE",
  dateTimeRenderOption: "FORMATTED_STRING",
  majorDimension: "ROWS"
};
const CACHE_TTL_SEC = 21600;
const TASK_NAME_CACHE_TTL_SEC = 3600;
const SHEET_META_CACHE_TTL_SEC = 60;
// CacheService の1キー上限を避けるため、一定サイズを超えるシート値は行単位の塊に分ける。
// 日本語を含む値は UTF-8 で膨らむため、100KB より十分小さくする。
const SHEET_VALUES_CACHE_CHUNK_LIMIT = 30000;
const SHEET_VALUES_CACHE_VERSION = 2;

function normalizeStoredPlanId(value) {
  const raw = String(value == null ? "" : value).trim();
  return /^[A-Za-z0-9._:-]{1,160}$/.test(raw) ? raw : "";
}

// 保存処理の間は「書き込みモード」とし、シートの値をキャッシュではなく必ずシートから読む。
// 人がシートを並べ替え・編集した後でも、古い行位置や古い内容で上書きしないため。
// 同じ実行内で一度読んだ（または書いた）シートは、その値を使い回す。
var APP_WRITE_DEPTH = 0;
var APP_FRESH_SHEET_VALUES = {};
// 保存処理の中で書き込んだシート（保存ログ用）。キーは "ファイルID\u0000シート名"。
var APP_WRITE_TOUCHED = {};

function withUserWriteLock(callback) {
  if (APP_WRITE_DEPTH > 0) return callback();
  const lock = typeof LockService !== "undefined" && LockService.getUserLock ? LockService.getUserLock() : null;
  if (lock && !lock.tryLock(30000)) {
    throw new Error("別の画面で保存処理中です。少し待ってからもう一度お試しください。");
  }
  APP_WRITE_DEPTH += 1;
  APP_FRESH_SHEET_VALUES = {};
  APP_WRITE_TOUCHED = {};
  try {
    refreshAppPropertyStores();
    const result = callback();
    appRecordWriteLog(true, null);
    return result;
  } catch (err) {
    // 途中まで書いてから失敗した保存は、シート同士が食い違っている可能性があるので記録しておく。
    appRecordWriteLog(false, err);
    throw err;
  } finally {
    APP_WRITE_DEPTH -= 1;
    APP_FRESH_SHEET_VALUES = {};
    APP_WRITE_TOUCHED = {};
    if (lock) lock.releaseLock();
  }
}

// ---- 保存ログと、壊れたときの戻し方の案内 ----
// 保存処理で実際にシートへ書き込んだときだけ、時刻・書いたシート・成否を直近 APP_WRITE_LOG_LIMIT 件残す。
// データが壊れたときに「この時刻の版まで戻せば直りそう」と案内するために使う。
var APP_WRITE_LOG_PROPERTY = "appWriteLog.v1";
var APP_WRITE_LOG_LIMIT = 20;

function appNoteWriteTouched(spreadsheetId, rangeOrTitle) {
  if (!isAppWriteMode()) return;
  const text = String(rangeOrTitle || "");
  const match = /^'((?:[^']|'')*)'!/.exec(text);
  const title = match ? match[1].replace(/''/g, "'") : text;
  APP_WRITE_TOUCHED[String(spreadsheetId) + "\u0000" + title] = true;
}

function appSheetTitlesFromRequests(requests) {
  return (requests || []).map(function(request) {
    return request && request.addSheet && request.addSheet.properties ? request.addSheet.properties.title : "";
  }).filter(Boolean);
}

function appWriteLogEntries() {
  const props = appUserProperties();
  if (!props) return [];
  try {
    const parsed = JSON.parse(props.getProperty(APP_WRITE_LOG_PROPERTY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function appRecordWriteLog(ok, err) {
  const touched = Object.keys(APP_WRITE_TOUCHED);
  if (!touched.length) return;
  try {
    const sheets = [];
    touched.forEach(function(key) {
      const title = key.split("\u0000")[1];
      if (title && sheets.indexOf(title) < 0) sheets.push(title);
    });
    appRecordLastWrite(touched);
    const entry = { at: new Date().toISOString(), ok: !!ok, sheets: sheets.slice(0, 6) };
    if (!ok) entry.error = String(err && err.message || err || "").slice(0, 200);
    const entries = appWriteLogEntries().concat([entry]).slice(-APP_WRITE_LOG_LIMIT);
    appUserProperties().setProperty(APP_WRITE_LOG_PROPERTY, JSON.stringify(entries));
  } catch (logErr) {
    Logger.log("保存ログを残せませんでした: " + (logErr && logErr.message || logErr));
  }
}

// ---- シートの直接編集の検知 ----
// アプリ以外（人がスプレッドシートを直接編集した等）の変更があれば、読み込み用のキャッシュを捨てて
// すぐアプリに反映する。ファイルの最終更新時刻と、アプリが最後に書き込んだ時刻を比べる。
// Drive への確認は1ファイルにつき APP_EXTERNAL_CHECK_TTL_SEC 秒に1回まで。
var APP_EXTERNAL_CHECK_TTL_SEC = 10;
// アプリの書き込みから Drive の更新時刻に反映されるまでの遅れを見込む幅。
// Drive の更新時刻は数十秒遅れて変わることがあり、短いと自分の保存を外部の変更と取り違えて
// 開いている画面をまるごと読み直してしまう。
var APP_EXTERNAL_WRITE_MARGIN_MS = 90000;
var APP_LAST_WRITE_PROPERTY_PREFIX = "appLastWrite:";
var APP_EXTERNAL_SEEN_PROPERTY_PREFIX = "appExternalSeen:";
var APP_EXTERNAL_CHECKED = {};

function appExternalCheckCacheKey(spreadsheetId) {
  return "ext." + spreadsheetId;
}

function appRecordLastWrite(touchedKeys) {
  const props = appUserProperties();
  if (!props) return;
  const now = String(Date.now());
  const ids = {};
  (touchedKeys || []).forEach(function(key) { ids[key.split("\u0000")[0]] = true; });
  Object.keys(ids).forEach(function(id) { props.setProperty(APP_LAST_WRITE_PROPERTY_PREFIX + id, now); });
}

// 外からの変更を見つけてキャッシュを捨てたら true。1回の実行では各ファイル1度だけ確かめる。
function appDetectExternalEdits(spreadsheetId) {
  const id = String(spreadsheetId || "").trim();
  if (!id || APP_EXTERNAL_CHECKED[id] || isAppWriteMode()) return false;
  APP_EXTERNAL_CHECKED[id] = true;
  if (typeof DriveApp === "undefined") return false;
  try {
    const cache = userCache();
    const checkKey = appExternalCheckCacheKey(id);
    if (cache.get(checkKey)) return false;
    cache.put(checkKey, "1", APP_EXTERNAL_CHECK_TTL_SEC);
    const updated = DriveApp.getFileById(id).getLastUpdated().getTime();
    const props = appUserProperties();
    const lastWrite = Number(props.getProperty(APP_LAST_WRITE_PROPERTY_PREFIX + id) || 0);
    const seen = Number(props.getProperty(APP_EXTERNAL_SEEN_PROPERTY_PREFIX + id) || 0);
    if (!(updated > Math.max(lastWrite + APP_EXTERNAL_WRITE_MARGIN_MS, seen))) return false;
    props.setProperty(APP_EXTERNAL_SEEN_PROPERTY_PREFIX + id, String(updated));
    clearAppReadCache();
    invalidateCachedSheetMeta(id);
    invalidateTaskNameCache(id);
    try { cache.remove(APP_CACHE_PROJECT_CATALOG_KEY); } catch (e) {}
    return true;
  } catch (err) {
    return false;
  }
}

// アプリを開いている間の定期確認用。各年次ファイルの外部変更を確かめ、外部の変更を最後に見つけた
// 更新時刻（全ファイルの最大）を返す。画面側はこの値が増えたら、ブラウザ内の控えを古い扱いにして読み直す。
// 読み取りの途中で先に検知された場合も値は増えるので、画面側で取りこぼさない。
function getExternalEditStamp() {
  const ids = typeof projectAnnualSpreadsheetIds === "function" ? projectAnnualSpreadsheetIds() : [];
  ids.forEach(function(id) { appDetectExternalEdits(id); });
  const props = appUserProperties();
  let stamp = 0;
  if (props) {
    ids.forEach(function(id) {
      stamp = Math.max(stamp, Number(props.getProperty(APP_EXTERNAL_SEEN_PROPERTY_PREFIX + id) || 0));
    });
  }
  return { stamp: stamp };
}

function appFormatLogTime(iso) {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, Session.getScriptTimeZone() || "Asia/Tokyo", "M/d HH:mm");
}

function appWriteLogLabel(entry) {
  return (entry.sheets || []).map(function(name) { return "「" + name + "」"; }).join("");
}

// 戻す目安の時刻。直近の保存が途中で失敗していれば、その前に正常に保存できた時刻を返す。
function appRestoreHint() {
  const entries = appWriteLogEntries();
  let failed = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry.ok) {
      if (!failed) failed = entry;
      continue;
    }
    return {
      at: entry.at,
      time: appFormatLogTime(entry.at),
      label: appWriteLogLabel(entry),
      failedAfter: failed ? { at: failed.at, time: appFormatLogTime(failed.at), label: appWriteLogLabel(failed), error: failed.error || "" } : null
    };
  }
  return failed ? { at: "", time: "", label: "", failedAfter: { at: failed.at, time: appFormatLogTime(failed.at), label: appWriteLogLabel(failed), error: failed.error || "" } } : null;
}

function appRestoreHintText() {
  let hint = null;
  try { hint = appRestoreHint(); } catch (err) {}
  if (!hint || !hint.time) return "設定の「データの点検と復元」で戻し方を確認できます。";
  return "最後にアプリが正常に保存したのは " + hint.time + "（" + hint.label + "）です。シートを直接編集して壊れた場合は、スプレッドシートの「ファイル → 変更履歴」でこの時刻の版を復元すると直る見込みです（設定の「データの点検と復元」に手順があります）。";
}

function isAppWriteMode() {
  return APP_WRITE_DEPTH > 0;
}

function appFreshSheetKey(spreadsheetId, sheetName) {
  return String(spreadsheetId) + "\u0000" + String(sheetName);
}

// ---- 表の列定義と、見出し名による読み書き ----
// アプリは各表を「正本の列順」（*_HEADER）の配列として扱う。シート上で列の順番が違ったり、
// 旧版の列名だったりしても、見出し名（storage_schema.gs の別名を含む）で正本の列順へ並べ替えて読む。
// 保存するときは、シートの列が正本の並びでなければ、値を失わない範囲で正本の並びへ直してから書く。
// アプリが知らない列や値があるときは、並べ替えで壊さないよう保存を止める。
var APP_TABLE_READ_LAST_COLUMN = "AZ";

function appTableHeader(sheetName) {
  const name = String(sheetName || "");
  if (parseSheetMonth(name)) return SHEET_HEADER;
  if (typeof BUDGET_PLAN_SHEET_NAME !== "undefined" && name === BUDGET_PLAN_SHEET_NAME) return BUDGET_PLAN_HEADER;
  if (typeof PLANNING_TASK_SHEET_NAME !== "undefined" && name === PLANNING_TASK_SHEET_NAME) return PLANNING_TASK_HEADER;
  if (typeof PROJECT_SHEET_NAME !== "undefined" && name === PROJECT_SHEET_NAME) return PROJECT_HEADER;
  if (typeof PROJECT_MONTHLY_SHEET_NAME !== "undefined" && name === PROJECT_MONTHLY_SHEET_NAME) return PROJECT_MONTHLY_HEADER;
  if (typeof WORK_CAPACITY_SHEET_NAME !== "undefined" && name === WORK_CAPACITY_SHEET_NAME) return WORK_CAPACITY_HEADER;
  if (typeof CALENDAR_EXCLUSION_SHEET_NAME !== "undefined" && name === CALENDAR_EXCLUSION_SHEET_NAME) return CALENDAR_EXCLUSION_HEADER;
  return null;
}

function appTableAliases(sheetName) {
  const name = String(sheetName || "");
  if (parseSheetMonth(name)) return typeof APP_DB_DAILY_ALIASES === "undefined" ? null : APP_DB_DAILY_ALIASES;
  if (typeof BUDGET_PLAN_SHEET_NAME !== "undefined" && name === BUDGET_PLAN_SHEET_NAME) return typeof APP_DB_PLAN_ALIASES === "undefined" ? null : APP_DB_PLAN_ALIASES;
  if (typeof PLANNING_TASK_SHEET_NAME !== "undefined" && name === PLANNING_TASK_SHEET_NAME) return typeof APP_DB_TASK_ALIASES === "undefined" ? null : APP_DB_TASK_ALIASES;
  if (typeof PROJECT_SHEET_NAME !== "undefined" && name === PROJECT_SHEET_NAME) return typeof APP_DB_PROJECT_ALIASES === "undefined" ? null : APP_DB_PROJECT_ALIASES;
  if (typeof PROJECT_MONTHLY_SHEET_NAME !== "undefined" && name === PROJECT_MONTHLY_SHEET_NAME) return typeof APP_DB_PROJECT_MONTHLY_ALIASES === "undefined" ? null : APP_DB_PROJECT_MONTHLY_ALIASES;
  if (typeof WORK_CAPACITY_SHEET_NAME !== "undefined" && name === WORK_CAPACITY_SHEET_NAME) return typeof APP_DB_CAPACITY_ALIASES === "undefined" ? null : APP_DB_CAPACITY_ALIASES;
  if (typeof CALENDAR_EXCLUSION_SHEET_NAME !== "undefined" && name === CALENDAR_EXCLUSION_SHEET_NAME) return typeof APP_DB_EXCLUSION_ALIASES === "undefined" ? null : APP_DB_EXCLUSION_ALIASES;
  return null;
}

// 正本の各列について、受け付ける見出し名（正本名が先頭、続いて旧名・別名）を返す。
function appTableColumnNames(sheetName, header) {
  const aliases = appTableAliases(sheetName) || {};
  return header.map(function(name) {
    const names = [name];
    Object.keys(aliases).forEach(function(field) {
      const list = aliases[field] || [];
      if (list.indexOf(name) < 0) return;
      list.forEach(function(alias) { if (names.indexOf(alias) < 0) names.push(alias); });
    });
    return names;
  });
}

// シートの見出し行から、正本の各列がシートの何列目にあるかを調べる。
// 正本名との完全一致を先に割り当て、残りを旧名・別名で探す（同じ列を二重に使わない）。
function appTableLayout(sheetName, headerRow) {
  const header = appTableHeader(sheetName);
  if (!header) return null;
  const cells = (headerRow || []).map(function(value) { return String(value == null ? "" : value).trim(); });
  const names = appTableColumnNames(sheetName, header);
  const used = {};
  const indexes = header.map(function() { return -1; });
  [0, 1].forEach(function(pass) {
    header.forEach(function(name, index) {
      if (indexes[index] >= 0) return;
      const candidates = pass === 0 ? [name] : names[index].slice(1);
      candidates.some(function(candidate) {
        let at = cells.indexOf(candidate);
        while (at >= 0 && used[at]) at = cells.indexOf(candidate, at + 1);
        if (at < 0) return false;
        indexes[index] = at;
        used[at] = true;
        return true;
      });
    });
  });
  const unknown = [];
  cells.forEach(function(cell, at) { if (cell && !used[at]) unknown.push({ column: at, name: cell }); });
  const found = indexes.filter(function(at) { return at >= 0; }).length;
  // 末尾の列が足りないだけ（旧版のシート）は正本の並びとみなす。
  let missingFrom = header.length;
  while (missingFrom > 0 && indexes[missingFrom - 1] < 0) missingFrom--;
  const inOrder = indexes.every(function(at, index) { return index >= missingFrom ? at < 0 : at === index; });
  return {
    header: header,
    indexes: indexes,
    used: used,
    unknown: unknown,
    recognized: found >= Math.min(2, header.length),
    canonical: inOrder && unknown.length === 0
  };
}

// 見出し行を含むシートの値を、正本の列順の行（2行目以降）にする。
function appTableRowsFromValues(sheetName, values) {
  const source = values || [];
  const layout = source.length ? appTableLayout(sheetName, source[0]) : null;
  const data = source.slice(1);
  if (!layout || !layout.recognized || layout.canonical) return { rows: data, layout: layout };
  return {
    rows: data.map(function(row) {
      return layout.indexes.map(function(at) { return at >= 0 && row && row[at] != null ? row[at] : ""; });
    }),
    layout: layout
  };
}

function appFetchTableValues(spreadsheetId, sheetName) {
  const response = Sheets.Spreadsheets.Values.get(
    spreadsheetId,
    a1Range(sheetName, "A1:" + APP_TABLE_READ_LAST_COLUMN),
    VALUES_GET_OPTS
  );
  return response.values || [];
}

function appTableReadRanges(sheetNames) {
  return (sheetNames || []).map(function(name) { return a1Range(name, "A1:" + APP_TABLE_READ_LAST_COLUMN); });
}

// 表を読む。保存処理の中では、形式の確認と列の並びの点検（必要なら正本の並びへの修正）もする。
function appReadTableRows(spreadsheetId, sheetName) {
  if (!isAppWriteMode()) return appTableRowsFromValues(sheetName, appFetchTableValues(spreadsheetId, sheetName)).rows;
  appGuardSchemaForWrite(spreadsheetId);
  return appPrepareTableForWrite(spreadsheetId, sheetName, appFetchTableValues(spreadsheetId, sheetName));
}

function appTableProblem(sheetName, message) {
  return new Error("シート「" + sheetName + "」" + message + "データを壊さないよう保存を中止しました。" + appRestoreHintText());
}

function appPrepareTableForWrite(spreadsheetId, sheetName, values) {
  const result = appTableRowsFromValues(sheetName, values);
  const layout = result.layout;
  if (!layout) return result.rows;
  if (!layout.recognized) throw appTableProblem(sheetName, "の1行目の見出しを認識できないため、");
  if (layout.unknown.length) {
    const first = layout.unknown[0];
    throw appTableProblem(sheetName, "の" + appDbColumnLetter(first.column) + "列「" + first.name + "」はアプリが使わない列のため、");
  }
  // 見出しのない列に値があると、行の並べ替えでその値だけがずれるため止める。
  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (!layout.used[c] && String(row[c] == null ? "" : row[c]).trim() !== "") {
        throw appTableProblem(sheetName, "の" + appDbColumnLetter(c) + (r + 1) + "に見出しのない列の値があるため、");
      }
    }
  }
  if (!layout.canonical) appNormalizeTableLayout(spreadsheetId, sheetName, layout.header, result.rows, values);
  return result.rows;
}

// 列の並びだけが違う表を、値を変えずに正本の並びへ書き直す。
function appNormalizeTableLayout(spreadsheetId, sheetName, header, rows, values) {
  const width = Math.max.apply(null, (values || []).map(function(row) { return (row || []).length; }).concat([header.length]));
  const lastColumn = appDbColumnLetter(header.length - 1);
  sheetsValuesUpdate(spreadsheetId, a1Range(sheetName, "A1:" + lastColumn + (rows.length + 1)), [header].concat(rows.map(function(row) {
    return header.map(function(_, index) { return row[index] == null ? "" : row[index]; });
  })));
  if (width > header.length) {
    sheetsValuesClear(spreadsheetId, a1Range(sheetName, appDbColumnLetter(header.length) + "1:" + appDbColumnLetter(width - 1) + (rows.length + 1)));
  }
  Logger.log("シート「" + sheetName + "」の列を正本の並びに直しました。");
}

function appDbColumnLetter(index) {
  let number = Number(index) + 1;
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

// 保存の前に、ファイルの形式がこのアプリの形式と同じか確かめる（古ければ移行し、新しければ止める）。
function appGuardSchemaForWrite(spreadsheetId) {
  if (typeof ensureDatabaseSchema !== "function") return;
  const state = ensureDatabaseSchema(spreadsheetId);
  if (state && state.newer) {
    throw new Error("このスプレッドシートは新しい版のアプリで形式" + state.fileVersion + "に更新されています（このアプリは形式" + state.version + "）。データを壊さないよう保存を中止しました。画面を再読み込みするか、最新版のアプリを開いてください。");
  }
}

// 形式の移行でシートを書き直した後は、この実行内で読んだ値を捨てる。
function appForgetFreshSheets(spreadsheetId) {
  const prefix = String(spreadsheetId) + "\u0000";
  Object.keys(APP_FRESH_SHEET_VALUES).forEach(function(key) {
    if (key.indexOf(prefix) === 0) delete APP_FRESH_SHEET_VALUES[key];
  });
}

// アプリのアイコン。タブのfavicon、インストール時のアイコン、画面ヘッダーのアイコンを同じ画像にそろえる（ui/styles.css の .brand::before も同じURL）。
const APP_ICON_URL = "https://fonts.gstatic.com/s/e/notoemoji/latest/1f5d3_fe0f/512.png";

function doGet(e) {
  const page = e && e.parameter ? e.parameter.page : "";

  if (page === "manifest") {
    return ContentService.createTextOutput(JSON.stringify(buildWebManifest()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (page === "sw") {
    return ContentService.createTextOutput(HtmlService.createHtmlOutputFromFile("sw").getContent())
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // 初回の同意画面でドライブ・カレンダーなどの許可を外して進むと、アプリが動かないまま開いてしまう。
  // 許可が足りないときは、アプリの代わりに許可をやり直す画面を出す。
  const gate = appAuthorizationGate();
  if (gate) {
    return HtmlService.createHtmlOutput(buildAuthorizationGateHtml(gate.url, getServiceUrl()))
      .setTitle("まとめて工数管理さん")
      .setFaviconUrl(APP_ICON_URL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("まとめて工数管理さん")
    .setFaviconUrl(APP_ICON_URL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// このアプリが使う権限（ドライブ・スプレッドシート・カレンダー・ToDo リストなど）のうち、
// まだ許可されていないものがあれば、許可をやり直すURLを返す。確かめられないときは止めない。
function appAuthorizationGate() {
  try {
    const info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    if (info.getAuthorizationStatus() !== ScriptApp.AuthorizationStatus.REQUIRED) return null;
    return { url: info.getAuthorizationUrl() || "" };
  } catch (err) {
    return null;
  }
}

function appEscapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// 許可をやり直す画面。許可は別のタブで行い、終わったらこの画面を開き直す。
function buildAuthorizationGateHtml(authorizationUrl, serviceUrl) {
  const auth = appEscapeHtml(authorizationUrl);
  const reload = appEscapeHtml(serviceUrl);
  return [
    '<!doctype html><html lang="ja"><head><meta charset="utf-8">',
    '<style>',
    'body{margin:0;background:#f0f4f9;color:#1f1f1f;font-family:Roboto,"Noto Sans JP",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;}',
    '.wrap{max-width:520px;margin:12vh auto 0;padding:32px 28px;background:#fff;border-radius:16px;box-sizing:border-box;}',
    '@media (max-width:560px){.wrap{margin:16px;padding:24px 20px;}}',
    'h1{margin:0 0 12px;font-size:1.25rem;font-weight:500;}',
    'p{margin:0 0 12px;color:#444746;font-size:.875rem;line-height:1.7;}',
    'ol{margin:0 0 20px;padding-left:1.4em;color:#444746;font-size:.875rem;line-height:1.8;}',
    '.actions{display:flex;flex-wrap:wrap;gap:8px;}',
    'a.button{display:inline-flex;align-items:center;height:40px;padding:0 20px;border-radius:20px;font-size:.875rem;font-weight:500;text-decoration:none;}',
    'a.primary{background:#0b57d0;color:#fff;}',
    'a.secondary{border:1px solid #747775;color:#0b57d0;}',
    '</style></head><body><main class="wrap">',
    '<h1>アクセスの許可が必要です</h1>',
    '<p>このアプリは、Google ドライブ・スプレッドシート・カレンダー・ToDo リストなどを読み書きして動きます。まだ許可されていないものがあるため、開けません。</p>',
    '<ol><li>「許可する」を押し、開いた画面で<strong>すべての項目にチェックを入れて</strong>許可します。</li>',
    '<li>許可が終わったら、「開き直す」を押します。</li></ol>',
    '<div class="actions">',
    auth ? '<a class="button primary" href="' + auth + '" target="_blank" rel="noopener">許可する</a>' : '',
    '<a class="button secondary" href="' + (reload || '#') + '" target="_top">開き直す</a>',
    '</div></main></body></html>'
  ].join("");
}

// フィードバック用のGoogleフォームのURL。空のときは、設定に「フィードバック」を出さない。
const FEEDBACK_FORM_URL = "";

function getFeedbackFormUrl() {
  return /^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/.test(FEEDBACK_FORM_URL) ? FEEDBACK_FORM_URL : "";
}

function getServiceUrl() {
  try {
    return ScriptApp.getService().getUrl() || "";
  } catch (err) {
    return "";
  }
}

// ブラウザに控える内容をアカウントごとに分けるための識別子。メールアドレスそのものは画面に出さず、ハッシュの先頭を使う。
function getUserStorageScope() {
  try {
    var email = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
    if (!email) return "";
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email, Utilities.Charset.UTF_8);
    return digest.slice(0, 8).map(function(byte) {
      return ("0" + (byte < 0 ? byte + 256 : byte).toString(16)).slice(-2);
    }).join("");
  } catch (err) {
    return "";
  }
}

function getScriptEditorUrl() {
  try {
    return "https://script.google.com/home/projects/" + ScriptApp.getScriptId() + "/edit";
  } catch (err) {
    return "";
  }
}

function buildWebManifest() {
  const baseUrl = getServiceUrl();
  return {
    id: baseUrl || "matomete-kousu-kanri-san",
    name: "まとめて工数管理さん",
    short_name: "まとめて工数管理さん",
    description: "日々の工数と週次・月次の予定をまとめて管理するツール",
    start_url: baseUrl || ".",
    scope: baseUrl || ".",
    display: "standalone",
    orientation: "any",
    icons: [
      { src: APP_ICON_URL, sizes: "512x512", type: "image/png", purpose: "any" }
    ],
    background_color: "#f0f4f9",
    theme_color: "#f0f4f9",
    lang: "ja"
  };
}

function loadDataForDate(dateStr) {
  const ctx = createDateContext(dateStr);
  const result = {
    mode: "new",
    tasks: [],
    spreadsheetUrl: null,
    importSource: [],
    needCalendar: false
  };

  const spreadsheetId = getSpreadsheetIdForDate(dateStr);
  if (!spreadsheetId) {
    result.tasks = [];
    result.importSource = [];
    return result;
  }

  const loaded = loadSheetValuesDirect(spreadsheetId, ctx.sheetName);
  const saved = extractSavedTasks(loaded.values, ctx.targetFormatted, ctx.tz);
  result.spreadsheetUrl = buildSpreadsheetUrl(
    spreadsheetId,
    getCachedSheetId(spreadsheetId, ctx.sheetName)
  );

  if (saved) {
    result.mode = saved.mode;
    result.tasks = applyWeeklyPlanHoursToDailyTasks(dateStr, saved.tasks);
    result.importSource = [];
    result.needCalendar = true;
    return result;
  }

  const ongoing = loadOngoingTasks(spreadsheetId, ctx, loaded.values);
  result.tasks = applyWeeklyPlanHoursToDailyTasks(dateStr, ongoing, { dropCompleted: true });
  result.importSource = result.tasks.slice();
  return result;
}

/** 空として保存された日をクリアし、カレンダー・未完了タスクから新規登録用データを返す */
function reloadDayAsNew(dateStr) {
  return withUserWriteLock(function() { return reloadDayAsNewLocked(dateStr); });
}

function reloadDayAsNewLocked(dateStr) {
  const ctx = createDateContext(dateStr);
  const spreadsheetId = getSpreadsheetIdForDate(dateStr);
  let url = null;

  if (spreadsheetId) {
    if (typeof ensureDatabaseSchema === "function") ensureDatabaseSchema(spreadsheetId);
    const loaded = loadSheetValuesDirect(spreadsheetId, ctx.sheetName);
    if (!loaded.missing && loaded.values.length > 0) {
      const wb = createWorkbook(spreadsheetId);
      let sheet = null;
      const sheetId = getCachedSheetId(spreadsheetId, ctx.sheetName);
      if (typeof sheetId === "number") {
        sheet = { properties: { sheetId: sheetId, title: ctx.sheetName } };
      } else {
        sheet = findSheetEntry(ensureMeta(wb), ctx.sheetName);
      }
      if (sheet) writeDateRows(wb, sheet, loaded.values, ctx, []);
    }
    url = buildSpreadsheetUrl(spreadsheetId, getCachedSheetId(spreadsheetId, ctx.sheetName));
  }

  const currentValues = spreadsheetId
    ? loadSheetValuesDirect(spreadsheetId, ctx.sheetName).values
    : [];
  const ongoing = spreadsheetId ? loadOngoingTasks(spreadsheetId, ctx, currentValues) : [];
  const tasks = applyWeeklyPlanHoursToDailyTasks(dateStr, ongoing, { dropCompleted: true });
  return {
    mode: "new",
    tasks: tasks,
    spreadsheetUrl: url,
    importSource: tasks.slice(),
    needCalendar: false
  };
}

function getEventsAndCarryOverForDate(wb, ctx) {
  const spreadsheetId = wb && wb.id ? wb.id : getSpreadsheetIdForDate(ctx.targetFormatted);
  const currentValues = spreadsheetId
    ? (wb ? ensureSheetValues(wb, ctx.sheetName) : loadSheetValuesDirect(spreadsheetId, ctx.sheetName).values)
    : [];
  return spreadsheetId ? loadOngoingTasks(spreadsheetId, ctx, currentValues) : [];
}

function getCalendarTasks(ctx) {
  const result = [];
  try {
    const events = CalendarApp.getDefaultCalendar().getEventsForDay(ctx.targetDate);
    events.forEach(function(event) {
      if (event.isAllDayEvent()) return;
      const title = event.getTitle();
      let hrs = (event.getEndTime() - event.getStartTime()) / (1000 * 60 * 60);
      hrs = Math.max(0, Math.round(hrs * 4) / 4);
      result.push({
        title: title,
        hours: hrs,
        prevB: 0,
        prevC: hrs,
        status: "",
        type: "calendar"
      });
    });
  } catch (e) {
    Logger.log("calendar: " + e.message);
  }
  return result;
}

function rowToOngoingTask(row) {
  return {
    title: row[1],
    hours: 0,
    prevB: Math.max(0, Math.round(((parseFloat(row[2]) || 0) + (parseFloat(row[3]) || 0)) * 4) / 4),
    prevC: Math.max(0, Math.round((parseFloat(row[4]) || 0) * 4) / 4),
    status: row[5] || "",
    type: "ongoing",
    planId: normalizeStoredPlanId(row[7]),
    projectId: normalizeStoredPlanId(row[8]),
    subtaskId: normalizeStoredPlanId(row[9])
  };
}

function dailySavedTypeFromMark(mark) {
  const value = String(mark == null ? "" : mark).trim();
  if (value === "カレンダー") return "calendar";
  if (value === "割り込み") return "interrupt";
  if (value.indexOf(DAILY_CALENDAR_INTERRUPT_PREFIX) === 0) return "interrupt";
  return "saved";
}

function dailyCalendarKeyFromMark(mark) {
  const value = String(mark == null ? "" : mark).trim();
  if (value.indexOf(DAILY_CALENDAR_INTERRUPT_PREFIX) !== 0) return "";
  return value.slice(DAILY_CALENDAR_INTERRUPT_PREFIX.length).trim();
}

function dailyRowIsSameDayOnly(row) {
  const type = dailySavedTypeFromMark(row && row[6]);
  return type === "calendar" || type === "interrupt";
}

function dailyTaskIsComplete(row) {
  return String(row[5] || "").trim() === "完了";
}

function ongoingTasksFromLatestDate(values, ctx) {
  if (!values || values.length === 0) return [];
  let lastDateStr = "";
  for (let i = 0; i < values.length; i++) {
    const dateStr = formatDateCellValue(values[i][0], ctx.tz);
    if (dateStr && dateStr < ctx.targetFormatted && dateStr > lastDateStr) lastDateStr = dateStr;
  }
  if (!lastDateStr) return [];
  const result = [];
  for (let i = 0; i < values.length; i++) {
    if (formatDateCellValue(values[i][0], ctx.tz) !== lastDateStr) continue;
    if (dailyRowIsSameDayOnly(values[i])) continue;
    if (String(values[i][1] || "").trim() !== "" && !dailyTaskIsComplete(values[i])) {
      result.push(rowToOngoingTask(values[i]));
    }
  }
  return result;
}

function loadOngoingTasks(spreadsheetId, ctx, currentValues) {
  const fromCurrent = ongoingTasksFromLatestDate(currentValues, ctx);
  const hasEarlierDateInCurrentSheet = (currentValues || []).some(function(row) {
    const dateValue = formatDateCellValue(row[0], ctx.tz);
    return !!dateValue && dateValue < ctx.targetFormatted;
  });
  if (hasEarlierDateInCurrentSheet) return fromCurrent;
  const prevName = previousMonthSheetName(ctx.sheetName);
  if (!prevName) return [];
  let previousSpreadsheetId = spreadsheetId;
  const previousYearMatch = prevName.match(/^(\d{4})年/);
  if (previousYearMatch && isAnnualStorage()) {
    previousSpreadsheetId = getSpreadsheetIdForYear(previousYearMatch[1]);
  }
  return previousSpreadsheetId
    ? ongoingTasksFromLatestDate(loadSheetValuesDirect(previousSpreadsheetId, prevName).values, ctx)
    : [];
}

/** 保存済み日でも使える週予定の親タスク候補 */
function getImportSuggestions(dateStr, existingTitles) {
  var cacheKey = "importSuggestions:" + String(dateStr || "");
  var cached = null;
  try {
    var raw = userCache().get(cacheKey);
    if (raw) cached = JSON.parse(raw);
  } catch (err) {}
  var all = cached || getBudgetPlanSuggestionsForDate(dateStr);
  if (!cached) {
    try {
      var encoded = JSON.stringify(all || []);
      if (encoded.length <= 90000) userCache().put(cacheKey, encoded, 45);
    } catch (err) {}
  }
  return filterImportSuggestions(all, existingTitles);
}

/** 過去に保存したタスク名の候補一覧（最近使った順、最大400件） */
function getTaskNameSuggestions() {
  const spreadsheetIds = isAnnualStorage()
    ? Object.keys(getAnnualStorageFileMap()).sort(function(a, b) { return Number(b) - Number(a); }).map(function(year) { return getAnnualStorageFileMap()[year]; })
    : [];
  if (!spreadsheetIds.length) return [];
  const cacheIdentity = spreadsheetIds[0];
  const cached = isAnnualStorage() ? null : getCachedTaskNames(cacheIdentity);
  if (cached) return cached;
  const tz = Session.getScriptTimeZone() || "Asia/Tokyo";
  const seen = {};
  const result = [];
  spreadsheetIds.forEach(function(spreadsheetId) {
    const wb = createWorkbook(spreadsheetId);
    const names = listMonthSheetNamesUpToDate(ensureMeta(wb), new Date(), tz);
    ensureSheetValuesList(wb, names);
    collectTaskNameSuggestions(wb, tz).forEach(function(name) {
      if (seen[name] || result.length >= 400) return;
      seen[name] = true;
      result.push(name);
    });
  });
  if (!isAnnualStorage()) putCachedTaskNames(cacheIdentity, result);
  return result;
}

function saveToSpreadsheet(payload) {
  return withUserWriteLock(function() {
    const ctx = createDateContext(payload.date);
    const spreadsheetId = requireSpreadsheetIdForDate(payload.date);
    let newRows = buildRowsForSave(payload, ctx.targetFormatted);
    if (typeof budgetFillDailyPlanIds === "function") newRows = budgetFillDailyPlanIds(payload.date, newRows);
    requireSheetsApi();

    if (typeof ensureDatabaseSchema === "function") ensureDatabaseSchema(spreadsheetId);

    const loaded = loadSheetValuesDirect(spreadsheetId, ctx.sheetName);
    if (loaded.missing) {
      const wb = createWorkbook(spreadsheetId);
      const created = buildNewSheetSetup(ensureMeta(wb), ctx.sheetName);
      sheetsBatchUpdate(spreadsheetId, created.requests);
      const sheet = { properties: { sheetId: created.sheetId, title: ctx.sheetName } };
      writeDateRows(wb, sheet, [], ctx, newRows, { presentation: true });
      putCachedSheetId(spreadsheetId, ctx.sheetName, created.sheetId);
      putCachedSheetValues(spreadsheetId, ctx.sheetName, newRows);
      invalidateTaskNameCache(spreadsheetId);
      if (typeof persistEffectivePlanCompletionForDate === "function") persistEffectivePlanCompletionForDate(payload.date, newRows);
      return buildSpreadsheetUrl(spreadsheetId, created.sheetId);
    }

    const url = writeDateRowsFast(spreadsheetId, ctx, loaded.values, newRows);
    invalidateTaskNameCache(spreadsheetId);
    if (typeof persistEffectivePlanCompletionForDate === "function") {
      persistEffectivePlanCompletionForDate(payload.date, newRows, rowsForFormattedDate(loaded.values, ctx.targetFormatted, ctx.tz));
    }
    return url;
  });
}

function rowsForFormattedDate(values, targetFormatted, tz) {
  const rows = [];
  (values || []).forEach(function(row) {
    if (formatDateCellValue(row[0], tz) === targetFormatted) rows.push(row);
  });
  return rows;
}

function getSpreadsheetUrl(dateStr) {
  const spreadsheetId = getSpreadsheetIdForDate(dateStr);
  if (!spreadsheetId) return null;
  return buildSpreadsheetUrlForDate(spreadsheetId, dateStr);
}

function ensureSpreadsheetUrl(dateStr) {
  return buildSpreadsheetUrlForDate(requireSpreadsheetIdForDate(dateStr), dateStr);
}

function createDateContext(dateStr) {
  const tz = Session.getScriptTimeZone();
  const targetDate = new Date(dateStr);
  return {
    tz: tz,
    targetDate: targetDate,
    targetFormatted: Utilities.formatDate(targetDate, tz, "yyyy/MM/dd"),
    sheetName: Utilities.formatDate(targetDate, tz, "yyyy年MM月")
  };
}

function filterImportSuggestions(all, existingTitles) {
  return (all || []).filter(function(task) {
    const title = String(task.title || "").trim();
    if (!title || task.type !== "planning") return false;
    return true;
  });
}

function extractSavedTasks(values, targetFormatted, tz) {
  if (!values || values.length === 0) return null;
  const savedTasks = [];
  let hasEmptyMarker = false;
  let found = false;
  for (let i = 0; i < values.length; i++) {
    if (formatDateCellValue(values[i][0], tz) !== targetFormatted) continue;
    found = true;
    if (values[i][6] === "空") {
      hasEmptyMarker = true;
      continue;
    }
    savedTasks.push({
      title: values[i][1],
      hours: Math.max(0, Math.round((parseFloat(values[i][2]) || 0) * 4) / 4),
      prevB: Math.max(0, Math.round((parseFloat(values[i][3]) || 0) * 4) / 4),
      prevC: Math.max(0, Math.round((parseFloat(values[i][4]) || 0) * 4) / 4),
      status: values[i][5] || "",
      type: dailySavedTypeFromMark(values[i][6]),
      planId: normalizeStoredPlanId(values[i][7]),
      projectId: normalizeStoredPlanId(values[i][8]),
      subtaskId: normalizeStoredPlanId(values[i][9]),
      calendarKey: dailyCalendarKeyFromMark(values[i][6])
    });
  }
  if (!found) return null;
  if (hasEmptyMarker && savedTasks.length === 0) return { mode: "empty", tasks: [] };
  if (savedTasks.length > 0) return { mode: "edit", tasks: savedTasks };
  return null;
}

function collectTaskNameSuggestions(wb, tz) {
  const names = listMonthSheetNamesUpToDate(ensureMeta(wb), new Date(), tz);
  ensureSheetValuesList(wb, names);
  const stats = {};
  let recencySeq = 0;
  for (let s = names.length - 1; s >= 0; s--) {
    const values = wb.valuesBySheet[names[s]] || [];
    for (let i = 0; i < values.length; i++) {
      const name = String(values[i][1] || "").trim();
      if (!name) continue;
      if (dailyRowIsSameDayOnly(values[i])) continue;
      recencySeq++;
      stats[name] = recencySeq;
    }
  }
  return Object.keys(stats)
    .sort(function(a, b) {
      return stats[b] - stats[a];
    })
    .slice(0, 400);
}

function listMonthSheetNamesUpToDate(meta, targetDate, tz) {
  const targetYear = parseInt(Utilities.formatDate(targetDate, tz, "yyyy"), 10);
  const targetMonth = parseInt(Utilities.formatDate(targetDate, tz, "MM"), 10);
  const items = [];
  (meta.sheets || []).forEach(function(sh) {
    const name = sh.properties.title;
    const parsed = parseSheetMonth(name);
    if (!parsed) return;
    if (parsed.year < targetYear || (parsed.year === targetYear && parsed.month <= targetMonth)) {
      items.push({ name: name, sort: parsed.year * 12 + parsed.month });
    }
  });
  items.sort(function(a, b) {
    return b.sort - a.sort;
  });
  return items.map(function(item) {
    return item.name;
  });
}

function parseSheetMonth(sheetName) {
  const match = String(sheetName || "").match(/^(\d{4})年(\d{2})月$/);
  if (!match) return null;
  return { year: parseInt(match[1], 10), month: parseInt(match[2], 10) };
}

function previousMonthSheetName(sheetName) {
  const parsed = parseSheetMonth(sheetName);
  if (!parsed) return null;
  if (parsed.month === 1) return (parsed.year - 1) + "年12月";
  return parsed.year + "年" + pad2(parsed.month - 1) + "月";
}

function buildRowsForSave(payload, targetFormatted) {
  if (!payload.tasks || payload.tasks.length === 0) {
    return [[targetFormatted, "", 0, 0, 0, "", "空", "", "", ""]];
  }
  return payload.tasks.map(function(task) {
    const calendarKey = String(task.calendarKey == null ? "" : task.calendarKey).trim();
    const mark = task.interrupt
      ? (task.calendarInterrupt && calendarKey ? DAILY_CALENDAR_INTERRUPT_PREFIX + calendarKey : "割り込み")
      : task.calendar ? "カレンダー" : "";
    return [
      targetFormatted,
      sanitizeEnteredString(task.name),
      Math.max(0, Math.round((parseFloat(task.a) || 0) * 4) / 4),
      Math.max(0, Math.round((parseFloat(task.b) || 0) * 4) / 4),
      Math.max(0, Math.round((parseFloat(task.c) || 0) * 4) / 4),
      sanitizeEnteredString(task.d),
      sanitizeEnteredString(mark),
      normalizeStoredPlanId(task.planId),
      normalizeStoredPlanId(task.projectId),
      normalizeStoredPlanId(task.subtaskId)
    ];
  });
}

function mergeRowsForDate(oldValues, targetFormatted, tz, newRows) {
  const kept = [];
  for (let i = 0; i < oldValues.length; i++) {
    if (formatDateCellValue(oldValues[i][0], tz) !== targetFormatted) {
      kept.push(toWriteRow(oldValues[i], tz));
    }
  }
  const combined = kept.concat(newRows);
  combined.sort(function(a, b) {
    if (a[0] === b[0]) return 0;
    return a[0] < b[0] ? -1 : 1;
  });
  return combined;
}

function toWriteRow(row, tz) {
  return [
    formatDateCellValue(row[0], tz),
    sanitizeEnteredString(row[1]),
    parseFloat(row[2]) || 0,
    parseFloat(row[3]) || 0,
    parseFloat(row[4]) || 0,
    sanitizeEnteredString(row[5]),
    row[6] != null ? String(row[6]) : "",
    normalizeStoredPlanId(row[7]),
    normalizeStoredPlanId(row[8]),
    normalizeStoredPlanId(row[9])
  ];
}

function sanitizeEnteredString(value) {
  if (value == null) return "";
  const s = String(value);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function findDateBlock(values, targetFormatted, tz) {
  const idxs = [];
  for (let i = 0; i < values.length; i++) {
    if (formatDateCellValue(values[i][0], tz) === targetFormatted) idxs.push(i);
  }
  if (idxs.length === 0) return null;
  const start = idxs[0];
  const end = idxs[idxs.length - 1];
  return {
    start: start,
    end: end,
    count: idxs.length,
    contiguous: end - start + 1 === idxs.length
  };
}

function writeDateRowsFast(spreadsheetId, ctx, oldValues, newRows) {
  const sheetName = ctx.sheetName;
  const block = findDateBlock(oldValues, ctx.targetFormatted, ctx.tz);
  const sheetId = getCachedSheetId(spreadsheetId, sheetName);
  const atEnd = !block || block.end === oldValues.length - 1;
  const canPatch = block && block.contiguous && block.count === newRows.length;

  if (canPatch) {
    const startRow = block.start + 2;
    sheetsValuesUpdate(
      spreadsheetId,
      a1Range(sheetName, "A" + startRow + ":" + DAILY_LAST_COLUMN + (startRow + newRows.length - 1)),
      newRows
    );
    const combined = oldValues.slice();
    for (let i = 0; i < newRows.length; i++) combined[block.start + i] = newRows[i];
    putCachedSheetValues(spreadsheetId, sheetName, combined);
    return buildSpreadsheetUrl(spreadsheetId, sheetId);
  }

  if (atEnd && (!block || block.contiguous)) {
    const startIdx = block ? block.start : oldValues.length;
    const startRow = startIdx + 2;
    sheetsValuesUpdate(
      spreadsheetId,
      a1Range(sheetName, "A" + startRow + ":" + DAILY_LAST_COLUMN + (startRow + newRows.length - 1)),
      newRows
    );
    if (block && newRows.length < block.count) {
      sheetsValuesClear(
        spreadsheetId,
        a1Range(sheetName, "A" + (startRow + newRows.length) + ":" + DAILY_LAST_COLUMN + (block.end + 2))
      );
    }
    const kept = block ? oldValues.slice(0, block.start) : oldValues.slice();
    const combined = kept.concat(newRows);
    putCachedSheetValues(spreadsheetId, sheetName, combined);
    return buildSpreadsheetUrl(spreadsheetId, sheetId);
  }

  const wb = createWorkbook(spreadsheetId);
  const entry = findSheetEntry(ensureMeta(wb), sheetName) || {
    properties: { sheetId: sheetId, title: sheetName }
  };
  if (entry.properties && typeof entry.properties.sheetId === "number") {
    putCachedSheetId(spreadsheetId, sheetName, entry.properties.sheetId);
  }
  writeDateRows(wb, entry, oldValues, ctx, newRows, {});
  return buildSpreadsheetUrl(spreadsheetId, entry.properties.sheetId);
}

function writeDateRows(wb, sheet, oldValues, ctx, newRows, options) {
  options = options || {};
  const sheetId = sheet.properties.sheetId;
  const sheetName = sheet.properties.title;
  const combined = mergeRowsForDate(oldValues || [], ctx.targetFormatted, ctx.tz, newRows);
  const oldCount = (oldValues || []).length;
  const newCount = combined.length;

  if (newCount > 0) {
    const writeValues = options.presentation ? [SHEET_HEADER].concat(combined) : combined;
    const startRow = options.presentation ? 1 : 2;
    sheetsValuesUpdate(wb.id, a1Range(sheetName, "A" + startRow + ":" + DAILY_LAST_COLUMN + (newCount + 1)), writeValues);
  }
  if (oldCount > newCount) {
    sheetsValuesClear(wb.id, a1Range(sheetName, "A" + (newCount + 2) + ":" + DAILY_LAST_COLUMN + (oldCount + 1)));
  }

  const requests = [];
  requests.push.apply(requests, buildClearStructureRequests(sheet));
  if (oldCount > newCount) {
    requests.push({
      deleteDimension: {
        range: {
          sheetId: sheetId,
          dimension: "ROWS",
          startIndex: newCount + 1,
          endIndex: oldCount + 1
        }
      }
    });
  }
  if (newCount > 0) {
    requests.push.apply(requests, numberFormatRequests(sheetId, 1, newCount + 1));
    requests.push.apply(requests, groupByDateRequests(sheetId, combined, ctx.tz));
    requests.push({
      setBasicFilter: {
        filter: {
          range: {
            sheetId: sheetId,
            startRowIndex: 0,
            endRowIndex: newCount + 1,
            startColumnIndex: 0,
            endColumnIndex: 8
          }
        }
      }
    });
  }
  if (options.presentation) {
    requests.push.apply(requests, presentationRequests(sheetId, newCount + 1));
  }
  applySheetRequests(wb.id, requests);
  wb.valuesBySheet[sheetName] = combined;
  putCachedSheetValues(wb.id, sheetName, combined);
  if (typeof sheetId === "number") putCachedSheetId(wb.id, sheetName, sheetId);
}

function buildClearStructureRequests(sheet) {
  const sheetId = sheet.properties.sheetId;
  const requests = [];
  if (sheet.basicFilter) {
    requests.push({ clearBasicFilter: { sheetId: sheetId } });
  }
  const groups = (sheet.rowGroups || []).slice().sort(function(a, b) {
    return (b.depth || 0) - (a.depth || 0);
  });
  groups.forEach(function(group) {
    if (!group.range) return;
    requests.push({ deleteDimensionGroup: { range: group.range } });
  });
  (sheet.tables || []).forEach(function(table) {
    if (!table.tableId) return;
    requests.push({ deleteTable: { tableId: table.tableId } });
  });
  return requests;
}

function buildNewSheetSetup(meta, sheetName) {
  const sheetId = generateSheetId(meta);
  const requests = [{
    addSheet: {
      properties: {
        sheetId: sheetId,
        title: sheetName,
        gridProperties: { frozenRowCount: 1 }
      }
    }
  }];
  requests.push.apply(requests, columnWidthRequests(sheetId));
  requests.push.apply(requests, headerStyleRequests(sheetId));
  (meta.sheets || []).forEach(function(sh) {
    if (sh.properties && isDefaultSheetTitle(sh.properties.title)) {
      requests.push({ deleteSheet: { sheetId: sh.properties.sheetId } });
    }
  });
  return { sheetId: sheetId, requests: requests };
}

function isDefaultSheetTitle(title) {
  return title === "シート1" || title === "Sheet1";
}

function generateSheetId(meta) {
  const used = {};
  (meta.sheets || []).forEach(function(sh) {
    used[String(sh.properties.sheetId)] = true;
  });
  for (let n = 0; n < 20; n++) {
    const id = Math.floor(Math.random() * 2147483646) + 1;
    if (!used[String(id)]) return id;
  }
  let fallback = 1;
  while (used[String(fallback)]) fallback++;
  return fallback;
}

function columnWidthRequests(sheetId) {
  return COLUMN_WIDTHS.map(function(width, index) {
    return {
      updateDimensionProperties: {
        range: { sheetId: sheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 },
        properties: { pixelSize: width },
        fields: "pixelSize"
      }
    };
  });
}

function headerStyleRequests(sheetId) {
  return [{
    repeatCell: {
      range: { sheetId: sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLOR_HEADER_BG,
          textFormat: { foregroundColor: COLOR_WHITE, bold: true },
          horizontalAlignment: "CENTER"
        }
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
    }
  }];
}

function numberFormatRequests(sheetId, startRowIndex, endRowIndex) {
  return [
    {
      repeatCell: {
        range: { sheetId: sheetId, startRowIndex: startRowIndex, endRowIndex: endRowIndex, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy/MM/dd" } } },
        fields: "userEnteredFormat.numberFormat"
      }
    },
    {
      repeatCell: {
        range: { sheetId: sheetId, startRowIndex: startRowIndex, endRowIndex: endRowIndex, startColumnIndex: 2, endColumnIndex: 5 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.00" } } },
        fields: "userEnteredFormat.numberFormat"
      }
    }
  ];
}

function presentationRequests(sheetId, endRowIndex) {
  const requests = headerStyleRequests(sheetId);
  if (endRowIndex > 1) {
    requests.push({
      repeatCell: {
        range: { sheetId: sheetId, startRowIndex: 1, endRowIndex: endRowIndex, startColumnIndex: 0, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLOR_WHITE,
            textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: false }
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)"
      }
    });
  }
  requests.push({
    updateBorders: {
      range: { sheetId: sheetId, startRowIndex: 0, endRowIndex: endRowIndex, startColumnIndex: 0, endColumnIndex: 8 },
      top: borderStyle(),
      bottom: borderStyle(),
      left: borderStyle(),
      right: borderStyle(),
      innerHorizontal: borderStyle(),
      innerVertical: borderStyle()
    }
  });
  return requests;
}

function borderStyle() {
  return { style: "SOLID", color: COLOR_BORDER };
}

function groupByDateRequests(sheetId, rows, tz) {
  const requests = [];
  let startIdx = 0;
  while (startIdx < rows.length) {
    const dateStr = formatDateCellValue(rows[startIdx][0], tz);
    let endIdx = startIdx;
    while (endIdx + 1 < rows.length && formatDateCellValue(rows[endIdx + 1][0], tz) === dateStr) {
      endIdx++;
    }
    if (endIdx > startIdx) {
      requests.push({
        addDimensionGroup: {
          range: {
            sheetId: sheetId,
            dimension: "ROWS",
            startIndex: startIdx + 1,
            endIndex: endIdx + 2
          }
        }
      });
    }
    startIdx = endIdx + 1;
  }
  return requests;
}

function requireSheetsApi() {
  if (typeof Sheets === "undefined" || !Sheets.Spreadsheets) {
    throw new Error("Google Sheets API が有効ではありません。GAS エディタ左の「サービス」から Google Sheets API を追加してください。");
  }
}

function quoteSheetName(name) {
  return "'" + String(name).replace(/'/g, "''") + "'";
}

function a1Range(sheetName, a1) {
  return quoteSheetName(sheetName) + "!" + a1;
}

// PropertiesService は1件読むごとに数十msかかるため、1回の実行中は getProperties() で
// まとめて読んだ値を使い回す。書き込みは即時に反映し、手元の値も更新する。
// getProperties を持たない環境（テストの簡易モックなど）では元のオブジェクトをそのまま使う。
var APP_PROPERTY_STORES = {};

function appUserProperties() {
  return appPropertyStore("user");
}

function appScriptProperties() {
  return appPropertyStore("script");
}

// 保存先（フォルダ・年ごとのファイル・保存方式）の設定は人ごとに持つ。共有の場所に置くと、誰かが設定を
// 変えたときに全員の保存先が切り替わり、他の人の保存先を見に行ってしまうため。共有の場所（ScriptProperties）は読まない。
// 人ごとの場所がない環境（テストなど）だけ、共有の場所を使う。
function appStorageProperties() {
  var user = appUserProperties();
  if (!user || typeof PropertiesService === "undefined" || typeof PropertiesService.getUserProperties !== "function") return appScriptProperties();
  return user;
}

function appPropertyStore(kind) {
  if (APP_PROPERTY_STORES[kind]) return APP_PROPERTY_STORES[kind];
  if (typeof PropertiesService === "undefined") return null;
  var factory = kind === "user" ? PropertiesService.getUserProperties : PropertiesService.getScriptProperties;
  if (typeof factory !== "function") return null;
  var source = factory.call(PropertiesService);
  if (!source || typeof source.getProperties !== "function") return source;
  var values = null;
  function load() {
    if (!values) values = source.getProperties() || {};
    return values;
  }
  var store = {
    getProperty: function(key) {
      var value = load()[key];
      return value == null ? null : String(value);
    },
    getProperties: function() {
      return Object.assign({}, load());
    },
    getKeys: function() {
      return Object.keys(load());
    },
    setProperty: function(key, value) {
      source.setProperty(key, value);
      if (values) values[key] = String(value);
      return store;
    },
    setProperties: function(properties, deleteAllOthers) {
      source.setProperties(properties, deleteAllOthers === true);
      values = null;
      return store;
    },
    deleteProperty: function(key) {
      source.deleteProperty(key);
      if (values) delete values[key];
      return store;
    },
    deleteAllProperties: function() {
      source.deleteAllProperties();
      values = {};
      return store;
    }
  };
  APP_PROPERTY_STORES[kind] = store;
  return store;
}

// 別の実行が書き換えた値を読むため、ロック取得後は読み直す。
function refreshAppPropertyStores() {
  APP_PROPERTY_STORES = {};
}

// CacheService も1件ごとに数十msかかる。1回の実行中は読んだ値を手元に持ち、
// あるスプレッドシートのキーを初めて読むときは、同じ実行でよく使うキーを getAll でまとめて読む。
var APP_CACHE_MEMO = null;
var APP_CACHE_PREFETCHED = {};
var APP_CACHE_PROJECT_CATALOG_KEY = "projectCatalog:v1";

function userCache() {
  if (APP_CACHE_MEMO) return APP_CACHE_MEMO;
  var source = CacheService.getUserCache();
  if (!source || typeof source.getAll !== "function") return source;
  var known = {};
  function remember(key, value) {
    known[key] = value == null ? null : String(value);
  }
  function fetchAll(keys) {
    var missing = keys.filter(function(key) { return !Object.prototype.hasOwnProperty.call(known, key); });
    if (!missing.length) return;
    var found = source.getAll(missing) || {};
    missing.forEach(function(key) { remember(key, found[key]); });
  }
  var memo = {
    get: function(key) {
      if (!Object.prototype.hasOwnProperty.call(known, key)) fetchAll(appCachePrefetchKeys(key).concat([key]));
      return known[key];
    },
    getAll: function(keys) {
      fetchAll(keys || []);
      var result = {};
      (keys || []).forEach(function(key) { if (known[key] != null) result[key] = known[key]; });
      return result;
    },
    put: function(key, value, ttl) {
      if (ttl == null) source.put(key, value); else source.put(key, value, ttl);
      remember(key, value);
    },
    putAll: function(entries, ttl) {
      if (ttl == null) source.putAll(entries); else source.putAll(entries, ttl);
      Object.keys(entries || {}).forEach(function(key) { remember(key, entries[key]); });
    },
    remove: function(key) {
      source.remove(key);
      remember(key, null);
    },
    removeAll: function(keys) {
      source.removeAll(keys);
      (keys || []).forEach(function(key) { remember(key, null); });
    }
  };
  APP_CACHE_MEMO = memo;
  return memo;
}

// 初回の読み取りでは共通キーを、スプレッドシートごとのキーではそのファイルの主な表とメタ情報を一緒に読む。
// 月別の日次シートは件数が多く大きいため含めない（必要な月だけ getCachedSheetValuesList でまとめて読む）。
function appCachePrefetchKeys(key) {
  var keys = [];
  if (!APP_CACHE_PREFETCHED.__global) {
    APP_CACHE_PREFETCHED.__global = true;
    keys.push(APP_STORAGE_STATUS_CACHE_KEY, APP_CACHE_PROJECT_CATALOG_KEY);
  }
  var spreadsheetId = appCacheSpreadsheetIdFromKey(key);
  if (spreadsheetId && !APP_CACHE_PREFETCHED[spreadsheetId]) {
    APP_CACHE_PREFETCHED[spreadsheetId] = true;
    keys.push(sheetMetaCacheKey(spreadsheetId), appExternalCheckCacheKey(spreadsheetId));
    appCachePrefetchSheetNames().forEach(function(sheetName) {
      keys.push(sheetValuesCacheKey(spreadsheetId, sheetName));
    });
  }
  return keys;
}

function appCachePrefetchSheetNames() {
  return [
    typeof BUDGET_PLAN_SHEET_NAME === "undefined" ? "" : BUDGET_PLAN_SHEET_NAME,
    typeof PLANNING_TASK_SHEET_NAME === "undefined" ? "" : PLANNING_TASK_SHEET_NAME,
    typeof PROJECT_SHEET_NAME === "undefined" ? "" : PROJECT_SHEET_NAME,
    typeof PROJECT_MONTHLY_SHEET_NAME === "undefined" ? "" : PROJECT_MONTHLY_SHEET_NAME,
    typeof WORK_CAPACITY_SHEET_NAME === "undefined" ? "" : WORK_CAPACITY_SHEET_NAME,
    typeof CALENDAR_EXCLUSION_SHEET_NAME === "undefined" ? "" : CALENDAR_EXCLUSION_SHEET_NAME
  ].filter(function(name) { return !!name; });
}

function appCacheSpreadsheetIdFromKey(key) {
  var text = String(key || "");
  var match = /^sv\.[^.]+\.([^.]+)\./.exec(text) || /^(?:sm|sid|tn|ext)\.([^.]+)/.exec(text);
  return match ? match[1] : "";
}

var SHEET_CACHE_EPOCH_PROPERTY = "sheetCacheEpoch";

function sheetCacheEpoch() {
  try {
    var props = appUserProperties();
    if (!props) return "0";
    var epoch = props.getProperty(SHEET_CACHE_EPOCH_PROPERTY);
    return epoch ? String(epoch) : "0";
  } catch (e) {
    return "0";
  }
}

function clearAppReadCache() {
  var props = appUserProperties();
  if (props) props.setProperty(SHEET_CACHE_EPOCH_PROPERTY, String(new Date().getTime()));
  invalidateAppStorageStatusCache();
  return true;
}

function sheetValuesCacheKey(spreadsheetId, sheetName) {
  return "sv." + sheetCacheEpoch() + "." + spreadsheetId + "." + sheetName;
}

function sheetValuesCacheChunkKey(spreadsheetId, sheetName, index) {
  return sheetValuesCacheKey(spreadsheetId, sheetName) + ".c" + index;
}

function sheetIdCacheKey(spreadsheetId, sheetName) {
  return "sid." + spreadsheetId + "." + sheetName;
}

function sheetMetaCacheKey(spreadsheetId) {
  return "sm." + spreadsheetId;
}

function getCachedSheetMeta(spreadsheetId) {
  appDetectExternalEdits(spreadsheetId);
  try {
    var raw = userCache().get(sheetMetaCacheKey(spreadsheetId));
    return raw == null ? null : JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function putCachedSheetMeta(spreadsheetId, meta) {
  try {
    var raw = JSON.stringify(meta || null);
    if (raw.length <= 90000) userCache().put(sheetMetaCacheKey(spreadsheetId), raw, SHEET_META_CACHE_TTL_SEC);
  } catch (e) {}
}

function invalidateCachedSheetMeta(spreadsheetId) {
  try { userCache().remove(sheetMetaCacheKey(spreadsheetId)); } catch (e) {}
}

function taskNameCacheKey(spreadsheetId) {
  return "tn." + spreadsheetId;
}

function getCachedSheetValues(spreadsheetId, sheetName) {
  if (isAppWriteMode()) {
    const fresh = APP_FRESH_SHEET_VALUES[appFreshSheetKey(spreadsheetId, sheetName)];
    return fresh ? fresh.slice() : null;
  }
  appDetectExternalEdits(spreadsheetId);
  try {
    const cache = userCache();
    const raw = cache.get(sheetValuesCacheKey(spreadsheetId, sheetName));
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    // 旧版の単一キー形式も読み続けられるようにする。
    if (Array.isArray(parsed)) return parsed;
    const chunkCount = parsed && parsed.version === SHEET_VALUES_CACHE_VERSION
      ? Number(parsed.chunkCount)
      : NaN;
    if (!isFinite(chunkCount) || chunkCount < 1 || Math.floor(chunkCount) !== chunkCount) return null;
    const chunkKeys = Array.from({ length: chunkCount }, function(_, index) {
      return sheetValuesCacheChunkKey(spreadsheetId, sheetName, index);
    });
    const chunkValues = typeof cache.getAll === "function"
      ? cache.getAll(chunkKeys)
      : chunkKeys.reduce(function(result, key) {
          result[key] = cache.get(key);
          return result;
        }, {});
    const values = [];
    for (let i = 0; i < chunkKeys.length; i++) {
      const chunkRaw = chunkValues[chunkKeys[i]];
      if (chunkRaw == null) return null;
      const chunk = JSON.parse(chunkRaw);
      if (!Array.isArray(chunk)) return null;
      Array.prototype.push.apply(values, chunk);
    }
    return values;
  } catch (e) {
    return null;
  }
}

// 複数シートのキャッシュを続けて読む前に、見出しのキーを1回の getAll で手元に読み込んでおく。
function prefetchCachedSheetValues(spreadsheetId, sheetNames) {
  try {
    var cache = userCache();
    if (!cache || typeof cache.getAll !== "function" || !sheetNames || sheetNames.length < 2) return;
    cache.getAll(sheetNames.map(function(sheetName) { return sheetValuesCacheKey(spreadsheetId, sheetName); }));
  } catch (e) {}
}

function putCachedSheetValues(spreadsheetId, sheetName, values) {
  if (isAppWriteMode()) APP_FRESH_SHEET_VALUES[appFreshSheetKey(spreadsheetId, sheetName)] = (Array.isArray(values) ? values : []).slice();
  try {
    const source = Array.isArray(values) ? values : [];
    const raw = JSON.stringify(source);
    const cache = userCache();
    const baseKey = sheetValuesCacheKey(spreadsheetId, sheetName);
    if (raw.length <= SHEET_VALUES_CACHE_CHUNK_LIMIT) {
      cache.put(baseKey, raw, CACHE_TTL_SEC);
      return;
    }

    const chunks = [];
    let current = [];
    let currentLength = 2;
    source.forEach(function(row) {
      const rowRaw = JSON.stringify(row);
      if (current.length && currentLength + rowRaw.length + 1 > SHEET_VALUES_CACHE_CHUNK_LIMIT) {
        chunks.push(JSON.stringify(current));
        current = [];
        currentLength = 2;
      }
      // 1行だけで上限を超える場合は、壊れたキャッシュを作らず次回読み込みに任せる。
      if (rowRaw.length + 2 > SHEET_VALUES_CACHE_CHUNK_LIMIT) {
        throw new Error("sheet cache row is too large");
      }
      current.push(row);
      currentLength += rowRaw.length + (current.length > 1 ? 1 : 0);
    });
    if (current.length || !chunks.length) chunks.push(JSON.stringify(current));

    const chunkValues = {};
    chunks.forEach(function(chunk, index) {
      chunkValues[sheetValuesCacheChunkKey(spreadsheetId, sheetName, index)] = chunk;
    });
    if (typeof cache.putAll === "function") cache.putAll(chunkValues, CACHE_TTL_SEC);
    else Object.keys(chunkValues).forEach(function(key) { cache.put(key, chunkValues[key], CACHE_TTL_SEC); });
    cache.put(baseKey, JSON.stringify({ version: SHEET_VALUES_CACHE_VERSION, chunkCount: chunks.length }), CACHE_TTL_SEC);
  } catch (e) {
    // 新しい値を置けなかった場合に古い値が残ると、次の読み込みで古い内容を返すため消しておく。
    try { userCache().remove(sheetValuesCacheKey(spreadsheetId, sheetName)); } catch (removeErr) {}
  }
}

function getCachedSheetId(spreadsheetId, sheetName) {
  try {
    const raw = userCache().get(sheetIdCacheKey(spreadsheetId, sheetName));
    if (raw == null || raw === "") return null;
    const id = parseInt(raw, 10);
    return isFinite(id) ? id : null;
  } catch (e) {
    return null;
  }
}

function putCachedSheetId(spreadsheetId, sheetName, sheetId) {
  if (typeof sheetId !== "number") return;
  try {
    userCache().put(sheetIdCacheKey(spreadsheetId, sheetName), String(sheetId), CACHE_TTL_SEC);
  } catch (e) {}
}

function getCachedTaskNames(spreadsheetId) {
  appDetectExternalEdits(spreadsheetId);
  try {
    const raw = userCache().get(taskNameCacheKey(spreadsheetId));
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function putCachedTaskNames(spreadsheetId, names) {
  try {
    const raw = JSON.stringify(names || []);
    if (raw.length > 90000) return;
    userCache().put(taskNameCacheKey(spreadsheetId), raw, TASK_NAME_CACHE_TTL_SEC);
  } catch (e) {}
}

function invalidateTaskNameCache(spreadsheetId) {
  try {
    userCache().remove(taskNameCacheKey(spreadsheetId));
  } catch (e) {}
}

function loadSheetValuesDirect(spreadsheetId, sheetName) {
  requireSheetsApi();
  const cached = getCachedSheetValues(spreadsheetId, sheetName);
  if (cached) return { values: cached, missing: false };

  try {
    const values = appReadTableRows(spreadsheetId, sheetName);
    putCachedSheetValues(spreadsheetId, sheetName, values);
    return { values: values, missing: false };
  } catch (e) {
    if (isMissingSheet(e)) return { values: [], missing: true };
    throw e;
  }
}

function createWorkbook(spreadsheetId) {
  requireSheetsApi();
  return { id: spreadsheetId, meta: null, valuesBySheet: {} };
}

function ensureMeta(wb) {
  if (wb.meta) return wb.meta;
  try {
    wb.meta = sheetsGetMeta(wb.id);
  } catch (e) {
    throw e;
  }
  return wb.meta;
}

function sheetsGetMeta(spreadsheetId) {
  const cached = getCachedSheetMeta(spreadsheetId);
  if (cached) return cached;
  try {
    const meta = Sheets.Spreadsheets.get(spreadsheetId, { fields: SHEET_META_FIELDS });
    putCachedSheetMeta(spreadsheetId, meta);
    return meta;
  } catch (e) {
    if (/quota exceeded|rate limit|too many requests|\b429\b/i.test(String(e && e.message || e))) throw e;
    Logger.log("sheetsGetMeta tables field: " + e.message);
    const meta = Sheets.Spreadsheets.get(spreadsheetId, { fields: SHEET_META_FIELDS_LIGHT });
    putCachedSheetMeta(spreadsheetId, meta);
    return meta;
  }
}

function findSheetEntry(meta, sheetName) {
  const sheets = (meta && meta.sheets) || [];
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].properties && sheets[i].properties.title === sheetName) return sheets[i];
  }
  return null;
}

function ensureSheetValues(wb, sheetName) {
  if (!sheetName) return [];
  if (Object.prototype.hasOwnProperty.call(wb.valuesBySheet, sheetName)) {
    return wb.valuesBySheet[sheetName] || [];
  }
  const loaded = loadSheetValuesDirect(wb.id, sheetName);
  wb.valuesBySheet[sheetName] = loaded.values;
  return loaded.values;
}

function ensureSheetValuesList(wb, sheetNames) {
  const missing = [];
  const seen = {};
  const meta = ensureMeta(wb);
  for (let i = 0; i < sheetNames.length; i++) {
    const name = sheetNames[i];
    if (!name || seen[name]) continue;
    seen[name] = true;
    if (Object.prototype.hasOwnProperty.call(wb.valuesBySheet, name)) continue;
    if (!findSheetEntry(meta, name)) {
      wb.valuesBySheet[name] = [];
      continue;
    }
    missing.push(name);
  }
  if (missing.length === 0) return;

  for (let start = 0; start < missing.length; start += 50) {
    const chunk = missing.slice(start, start + 50);
    const batches = sheetsValuesBatchGet(wb.id, appTableReadRanges(chunk));
    for (let i = 0; i < chunk.length; i++) {
      wb.valuesBySheet[chunk[i]] = appTableRowsFromValues(chunk[i], batches[i] || []).rows;
      putCachedSheetValues(wb.id, chunk[i], wb.valuesBySheet[chunk[i]]);
    }
  }
}

function sheetsValuesBatchGet(spreadsheetId, ranges) {
  if (!ranges || ranges.length === 0) return [];
  const res = Sheets.Spreadsheets.Values.batchGet(spreadsheetId, {
    ranges: ranges,
    valueRenderOption: VALUES_GET_OPTS.valueRenderOption,
    dateTimeRenderOption: VALUES_GET_OPTS.dateTimeRenderOption,
    majorDimension: VALUES_GET_OPTS.majorDimension
  });
  return (res.valueRanges || []).map(function(vr) {
    return vr.values || [];
  });
}

function sheetsValuesUpdate(spreadsheetId, range, values) {
  if (!values || values.length === 0) return;
  if (isAppWriteMode()) appGuardSchemaForWrite(spreadsheetId);
  appNoteWriteTouched(spreadsheetId, range);
  Sheets.Spreadsheets.Values.update(
    { range: range, majorDimension: "ROWS", values: values },
    spreadsheetId,
    range,
    { valueInputOption: "USER_ENTERED" }
  );
}

function sheetsValuesClear(spreadsheetId, range) {
  if (isAppWriteMode()) appGuardSchemaForWrite(spreadsheetId);
  appNoteWriteTouched(spreadsheetId, range);
  Sheets.Spreadsheets.Values.clear({}, spreadsheetId, range);
}

function sheetsBatchUpdate(spreadsheetId, requests) {
  if (!requests || requests.length === 0) return null;
  if (isAppWriteMode()) appGuardSchemaForWrite(spreadsheetId);
  appSheetTitlesFromRequests(requests).forEach(function(title) { appNoteWriteTouched(spreadsheetId, title); });
  const result = Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheetId);
  const changesSheetMeta = requests.some(function(request) {
    return !!(request.addSheet || request.deleteSheet || request.updateSheetProperties
      || request.addTable || request.deleteTable || request.setBasicFilter || request.clearBasicFilter
      || request.addDimensionGroup || request.deleteDimensionGroup || request.appendDimension || request.deleteDimension);
  });
  if (changesSheetMeta) invalidateCachedSheetMeta(spreadsheetId);
  return result;
}

function applySheetRequests(spreadsheetId, requests) {
  if (!requests || requests.length === 0) return;
  try {
    sheetsBatchUpdate(spreadsheetId, requests);
  } catch (e) {
    Logger.log("applySheetRequests: " + e.message);
    const fallback = requests.filter(function(req) {
      return !req.addDimensionGroup && !req.deleteDimensionGroup && !req.deleteTable;
    });
    if (fallback.length > 0 && fallback.length < requests.length) {
      try {
        sheetsBatchUpdate(spreadsheetId, fallback);
      } catch (e2) {
        Logger.log("applySheetRequests fallback: " + e2.message);
      }
    }
  }
}

function isMissingSpreadsheet(err) {
  const msg = String(err && (err.message || err));
  return /Requested entity was not found/i.test(msg) ||
    /Requested file could not be found/i.test(msg);
}

function isMissingSheet(err) {
  const msg = String(err && (err.message || err));
  return /Unable to parse range/i.test(msg) ||
    /Unable to parse the specified range/i.test(msg) ||
    /Requested sheet not found/i.test(msg);
}

function formatDateCellValue(value, tz) {
  if (value === "" || value == null) return "";
  if (typeof value === "number" && isFinite(value)) {
    return sheetsSerialToDateString(value);
  }
  if (value instanceof Date || Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) return "";
    return Utilities.formatDate(value, tz || Session.getScriptTimeZone(), "yyyy/MM/dd");
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    return m[1] + "/" + pad2(m[2]) + "/" + pad2(m[3]);
  }
  return s;
}

function sheetsSerialToDateString(serial) {
  const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return utc.getUTCFullYear() + "/" + pad2(utc.getUTCMonth() + 1) + "/" + pad2(utc.getUTCDate());
}

function pad2(value) {
  return ("0" + value).slice(-2);
}

function spreadsheetUrlForSheet(wb, sheetName) {
  let sheetId = getCachedSheetId(wb.id, sheetName);
  if (typeof sheetId !== "number") {
    const entry = findSheetEntry(ensureMeta(wb), sheetName);
    sheetId = entry && entry.properties ? entry.properties.sheetId : null;
    if (typeof sheetId === "number") putCachedSheetId(wb.id, sheetName, sheetId);
  }
  return buildSpreadsheetUrl(wb.id, sheetId);
}

function buildSpreadsheetUrl(spreadsheetId, sheetId) {
  let url = "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/edit";
  if (typeof sheetId === "number") url += "#gid=" + sheetId;
  return url;
}

function buildSpreadsheetUrlForDate(spreadsheetId, dateStr) {
  let sheetId = null;
  if (dateStr) {
    const tz = Session.getScriptTimeZone();
    const sheetName = Utilities.formatDate(new Date(dateStr), tz, "yyyy年MM月");
    sheetId = getCachedSheetId(spreadsheetId, sheetName);
    if (typeof sheetId !== "number") {
      try {
        const meta = Sheets.Spreadsheets.get(spreadsheetId, {
          fields: "sheets.properties(sheetId,title)"
        });
        const entry = findSheetEntry(meta, sheetName);
        if (entry && entry.properties) {
          sheetId = entry.properties.sheetId;
          putCachedSheetId(spreadsheetId, sheetName, sheetId);
        }
      } catch (e) {
        Logger.log("buildSpreadsheetUrlForDate: " + e.message);
      }
    }
  }
  return buildSpreadsheetUrl(spreadsheetId, sheetId);
}

function currentStorageYear() {
  return parseInt(Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Tokyo", "yyyy"), 10);
}

function normalizeStorageYear(value) {
  const year = parseInt(value, 10);
  if (!isFinite(year) || year < 2000 || year > 2200) throw new Error("年の指定が不正です。");
  return year;
}

function storageYearFromDate(dateValue) {
  const raw = String(dateValue == null ? "" : dateValue).trim();
  const match = raw.match(/^(\d{4})[-/]/);
  return match ? normalizeStorageYear(match[1]) : currentStorageYear();
}

function storageYearFromPeriod(periodType, periodKey) {
  const key = normalizeBudgetPeriodKey(periodType, periodKey);
  return normalizeStorageYear(key.slice(0, 4));
}

function getAnnualStorageFileMap(props) {
  const raw = (props || appStorageProperties()).getProperty(APP_STORAGE_YEAR_FILES_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (err) { return {}; }
}

function setAnnualStorageFileMap(map, props) {
  (props || appStorageProperties()).setProperty(APP_STORAGE_YEAR_FILES_KEY, JSON.stringify(map || {}));
  invalidateAppStorageStatusCache();
}

function isAnnualStorage() {
  return appStorageProperties().getProperty(APP_STORAGE_MODE_KEY) === APP_STORAGE_MODE_ANNUAL;
}

function getSpreadsheetIdForYear(year) {
  const normalizedYear = normalizeStorageYear(year);
  if (!isAnnualStorage()) return null;
  return getAnnualStorageFileMap()[String(normalizedYear)] || null;
}

function getSpreadsheetIdForDate(dateStr) {
  return getSpreadsheetIdForYear(storageYearFromDate(dateStr));
}

function requireSpreadsheetIdForYear(year) {
  const id = getSpreadsheetIdForYear(year);
  if (id) return id;
  if (isAnnualStorage()) throw new Error("年次ファイルがありません: " + year + "年。保存先画面から作成してください。");
  throw new Error("アプリの保存先が未設定です。旧スプレッドシートは自動で読み込みません。保存先画面から設定してください。");
}

function requireSpreadsheetIdForDate(dateStr) {
  return requireSpreadsheetIdForYear(storageYearFromDate(dateStr));
}

function annualSpreadsheetIdsForRange(startYmd, endExclusiveYmd) {
  if (!isAnnualStorage()) return [];
  const firstYear = storageYearFromDate(startYmd);
  const last = new Date(endExclusiveYmd + "T00:00:00Z");
  last.setUTCDate(last.getUTCDate() - 1);
  const lastYear = last.getUTCFullYear();
  const map = getAnnualStorageFileMap();
  const ids = [];
  for (let year = firstYear; year <= lastYear; year++) {
    if (map[String(year)] && ids.indexOf(map[String(year)]) < 0) ids.push(map[String(year)]);
  }
  return ids;
}

function extractDriveResourceId(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  const folderMatch = raw.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const fileMatch = raw.match(/\/d\/([A-Za-z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(raw) ? raw : "";
}

function planningFolderPath(folder) {
  const names = [folder.getName()];
  let current = folder;
  for (let depth = 0; depth < 12; depth++) {
    const parents = current.getParents();
    if (!parents.hasNext()) break;
    current = parents.next();
    names.unshift(current.getName());
  }
  return names.join(" / ");
}

function inspectAppStorageFolder(folderInput) {
  const folderId = extractDriveResourceId(folderInput);
  if (!folderId) throw new Error("DriveフォルダのURLまたはIDを入力してください。");
  try {
    const folder = DriveApp.getFolderById(folderId);
    return {
      id: folder.getId(),
      name: folder.getName(),
      path: planningFolderPath(folder),
      url: "https://drive.google.com/drive/folders/" + folder.getId()
    };
  } catch (err) {
    throw new Error("指定したDriveフォルダを確認できません。URLとアクセス権を確認してください。");
  }
}

function listAppStorageFolders(parentFolderId) {
  try {
    const root = DriveApp.getRootFolder();
    const folder = parentFolderId ? DriveApp.getFolderById(parentFolderId) : root;
    const iterator = folder.getFolders();
    const folders = [];
    while (iterator.hasNext() && folders.length < 500) {
      const child = iterator.next();
      folders.push({ id: child.getId(), name: child.getName() });
    }
    folders.sort(function(left, right) { return left.name.localeCompare(right.name, "ja"); });
    let parent = null;
    if (folder.getId() !== root.getId()) {
      const parents = folder.getParents();
      if (parents.hasNext()) {
        const parentFolder = parents.next();
        parent = { id: parentFolder.getId(), name: parentFolder.getId() === root.getId() ? "マイドライブ" : parentFolder.getName() };
      }
    }
    // パンくず用に、マイドライブから現在地までのフォルダを順に返す。
    const ancestors = [];
    let cursor = folder;
    for (let depth = 0; depth < 12; depth++) {
      const isRoot = cursor.getId() === root.getId();
      ancestors.unshift({ id: cursor.getId(), name: isRoot ? "マイドライブ" : cursor.getName() });
      if (isRoot) break;
      const ups = cursor.getParents();
      if (!ups.hasNext()) break;
      cursor = ups.next();
    }
    return {
      current: {
        id: folder.getId(),
        name: folder.getId() === root.getId() ? "マイドライブ" : folder.getName(),
        path: ancestors.map(function(item) { return item.name; }).join(" / ")
      },
      ancestors: ancestors,
      parent: parent,
      folders: folders,
      truncated: iterator.hasNext()
    };
  } catch (err) {
    throw new Error("Driveのフォルダ一覧を取得できません。アクセス権を確認してください。");
  }
}

function getPlanningSpreadsheetId(periodType, periodKey) {
  if (isAnnualStorage() && periodType && periodKey) {
    return getSpreadsheetIdForYear(storageYearFromPeriod(periodType, periodKey));
  }
  if (isAnnualStorage()) return getSpreadsheetIdForYear(currentStorageYear());
  return null;
}

function requirePlanningSpreadsheetId(periodType, periodKey) {
  const props = appStorageProperties();
  if (!isAnnualStorage() || !props.getProperty(APP_STORAGE_FOLDER_ID_KEY)) {
    throw new Error("アプリ全体の保存先が未設定です。保存先を確認してデータを移行してください。");
  }
  const spreadsheetId = getPlanningSpreadsheetId(periodType, periodKey);
  if (!spreadsheetId) {
    const year = periodType && periodKey ? storageYearFromPeriod(periodType, periodKey) : currentStorageYear();
    throw new Error(year + "年の管理ファイルがありません。保存先画面から作成してください。");
  }
  return spreadsheetId;
}

function appStorageFileInfo(spreadsheetId) {
  if (!spreadsheetId) return null;
  const file = DriveApp.getFileById(spreadsheetId);
  return {
    id: spreadsheetId,
    name: file.getName(),
    url: buildSpreadsheetUrl(spreadsheetId, null)
  };
}

function invalidateAppStorageStatusCache() {
  try { userCache().remove(APP_STORAGE_STATUS_CACHE_KEY); } catch (e) {}
}

function getAppStorageStatus() {
  try {
    const raw = userCache().get(APP_STORAGE_STATUS_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  const status = loadAppStorageStatus();
  const ttl = status && status.configured && !status.error
    ? APP_STORAGE_STATUS_CONFIGURED_CACHE_TTL_SEC
    : APP_STORAGE_STATUS_CACHE_TTL_SEC;
  try { userCache().put(APP_STORAGE_STATUS_CACHE_KEY, JSON.stringify(status), ttl); } catch (e) {}
  return status;
}

function loadAppStorageStatus() {
  const props = appStorageProperties();
  const folderId = props.getProperty(APP_STORAGE_FOLDER_ID_KEY);
  const base = {
    configured: false,
    defaultName: APP_MANAGED_FOLDER_DEFAULT_NAME,
    annual: isAnnualStorage(),
    currentYear: currentStorageYear()
  };
  if (!folderId) return base;
  try {
    const folder = DriveApp.getFolderById(folderId);
    const yearMap = getAnnualStorageFileMap(props);
    const years = Object.keys(yearMap).sort();
    const currentId = yearMap[String(base.currentYear)];
    if (!currentId) return base;
    base.configured = true;
    base.folderId = folder.getId();
    base.folderName = folder.getName();
    base.folderPath = planningFolderPath(folder);
    base.folderUrl = "https://drive.google.com/drive/folders/" + folder.getId();
    base.file = appStorageFileInfo(currentId);
    base.files = years.map(function(year) {
      const info = appStorageFileInfo(yearMap[year]);
      info.year = parseInt(year, 10);
      return info;
    });
    base.years = years.map(function(year) { return parseInt(year, 10); });
    return base;
  } catch (err) {
    base.error = "保存先または年次ファイルを確認できません: " + err.message;
    return base;
  }
}

function createSpreadsheetInFolder(title, folder) {
  const created = Sheets.Spreadsheets.create({
    properties: {
      title: title,
      locale: "ja_JP",
      timeZone: Session.getScriptTimeZone() || "Asia/Tokyo"
    }
  });
  DriveApp.getFileById(created.spreadsheetId).moveTo(folder);
  // 新しく作ったファイルは最初から最新の形式なので、移行（とバックアップ）の対象にしない。
  if (typeof markDatabaseSchemaCurrent === "function") markDatabaseSchemaCurrent(created.spreadsheetId);
  return created.spreadsheetId;
}

function migrationYearFromPeriodKey(value) {
  const match = String(value == null ? "" : value).match(/^(\d{4})-/);
  return match ? parseInt(match[1], 10) : null;
}

function overwriteAnnualControlSheets(spreadsheetId, year, data) {
  data = data || {};
  data.planRows = data.planRows || [];
  data.taskRows = data.taskRows || [];
  const planRows = data.planRows.filter(function(row) { return migrationYearFromPeriodKey(row[1]) === year; });
  const taskRows = data.taskRows.filter(function(row) { return migrationYearFromPeriodKey(row[2]) === year; });
  ensureBudgetPlanSheet(spreadsheetId);
  ensurePlanningTaskSheet(spreadsheetId);
  const oldPlanCount = loadBudgetPlanRows(spreadsheetId).length;
  const oldTaskCount = loadPlanningTaskRows(spreadsheetId).length;
  sheetsValuesUpdate(spreadsheetId, a1Range(BUDGET_PLAN_SHEET_NAME, "A1:V" + (planRows.length + 1)), [BUDGET_PLAN_HEADER].concat(planRows));
  sheetsValuesUpdate(spreadsheetId, a1Range(PLANNING_TASK_SHEET_NAME, "A1:L" + (taskRows.length + 1)), [PLANNING_TASK_HEADER].concat(taskRows));
  if (oldPlanCount > planRows.length) sheetsValuesClear(spreadsheetId, a1Range(BUDGET_PLAN_SHEET_NAME, "A" + (planRows.length + 2) + ":V" + (oldPlanCount + 1)));
  if (oldTaskCount > taskRows.length) sheetsValuesClear(spreadsheetId, a1Range(PLANNING_TASK_SHEET_NAME, "A" + (taskRows.length + 2) + ":L" + (oldTaskCount + 1)));
  if (typeof putCachedSheetValues === "function") {
    putCachedSheetValues(spreadsheetId, BUDGET_PLAN_SHEET_NAME, planRows);
    putCachedSheetValues(spreadsheetId, PLANNING_TASK_SHEET_NAME, taskRows);
  }
  if (typeof ensureDatabaseSchema === "function") ensureDatabaseSchema(spreadsheetId);
}

function pruneAnnualDailySheets(spreadsheetId, year) {
  const meta = sheetsGetMeta(spreadsheetId);
  const requests = (meta.sheets || []).map(function(sheet) {
    const parsed = parseSheetMonth(sheet.properties && sheet.properties.title);
    return parsed && parsed.year !== year ? { deleteSheet: { sheetId: sheet.properties.sheetId } } : null;
  }).filter(function(request) { return !!request; });
  if (requests.length) sheetsBatchUpdate(spreadsheetId, requests);
}

function createAnnualSpreadsheet(year, folder, migrationData) {
  const title = year + "年工数管理データ";
  const spreadsheetId = createSpreadsheetInFolder(title, folder);
  overwriteAnnualControlSheets(spreadsheetId, year, migrationData || { planRows: [], taskRows: [] });
  pruneAnnualDailySheets(spreadsheetId, year);
  return spreadsheetId;
}

function createAnnualStorageFile(config) {
  const source = config || {};
  if (source.confirmed !== true) throw new Error("作成前の確認が完了していません。");
  if (!isAnnualStorage()) throw new Error("年次管理の保存先が未設定です。");
  const year = normalizeStorageYear(source.year);
  const props = appStorageProperties();
  const map = getAnnualStorageFileMap(props);
  if (map[String(year)]) return getAppStorageStatus();
  const folder = DriveApp.getFolderById(props.getProperty(APP_STORAGE_FOLDER_ID_KEY));
  const spreadsheetId = createAnnualSpreadsheet(year, folder, { planRows: [], taskRows: [] });
  map[String(year)] = spreadsheetId;
  setAnnualStorageFileMap(map, props);
  return getAppStorageStatus();
}

function previewAnnualStorageMigration(config) {
  const source = config || {};
  const folderInfo = inspectAppStorageFolder(source.folderId || source.folderInput);
  const title = String(source.title || APP_MANAGED_FOLDER_DEFAULT_NAME).trim();
  if (!title || title.length > 120) throw new Error("フォルダ名は1〜120文字で入力してください。");
  const migrationData = isAnnualStorage()
    ? { years: Object.keys(getAnnualStorageFileMap()).map(Number).concat([currentStorageYear()]).filter(function(year, index, years) { return years.indexOf(year) === index; }).sort(function(a, b) { return a - b; }) }
    : { years: [currentStorageYear()] };
  // 選んだ場所に同じ名前のフォルダがすでにあれば知らせる（作ると同じ名前のフォルダが2つになる）。
  let existingFolder = null;
  try {
    const same = DriveApp.getFolderById(folderInfo.id).getFoldersByName(title);
    if (same.hasNext()) {
      const folder = same.next();
      let files = [];
      try { files = findExistingAnnualStorageFiles(folder).map(function(file) { return file.name; }); } catch (err) {}
      existingFolder = { id: folder.getId(), name: folder.getName(), fileNames: files };
    }
  } catch (err) {}
  return {
    parentPath: folderInfo.path,
    folderName: title,
    folderPath: folderInfo.path + " / " + title,
    existingFolder: existingFolder,
    years: migrationData.years,
    fileNames: migrationData.years.map(function(year) { return year + "年工数管理データ"; })
  };
}

// すでにある管理フォルダの中から、年ごとの管理ファイルを探す。
// 名前が「2026年…」で始まり、予実計画のシートを持つスプレッドシートを年次ファイルとみなす。
// 形式変更のバックアップ（名前に「移行前」を含む）は除き、同じ年が複数あれば新しく更新された方を使う。
function findExistingAnnualStorageFiles(folder) {
  const byYear = {};
  const iterator = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (iterator.hasNext()) {
    const file = iterator.next();
    const name = file.getName();
    const match = name.match(/^(\d{4})年/);
    if (!match || name.indexOf("移行前") >= 0) continue;
    const year = parseInt(match[1], 10);
    if (year < 2000 || year > 2100) continue;
    let titles = [];
    try {
      titles = ((sheetsGetMeta(file.getId()) || {}).sheets || []).map(function(sheet) { return sheet.properties && sheet.properties.title; });
    } catch (err) { continue; }
    if (titles.indexOf(BUDGET_PLAN_SHEET_NAME) < 0) continue;
    const updated = file.getLastUpdated().getTime();
    if (byYear[year] && byYear[year].updated >= updated) continue;
    byYear[year] = { year: year, id: file.getId(), name: name, url: file.getUrl(), updated: updated };
  }
  return Object.keys(byYear).sort().map(function(year) {
    const entry = byYear[year];
    return { year: entry.year, id: entry.id, name: entry.name, url: entry.url };
  });
}

function inspectExistingAppStorage(folderId) {
  const folderInfo = inspectAppStorageFolder(folderId);
  const files = findExistingAnnualStorageFiles(DriveApp.getFolderById(folderInfo.id));
  const currentYear = currentStorageYear();
  return {
    folderId: folderInfo.id,
    folderPath: folderInfo.path,
    files: files,
    currentYear: currentYear,
    missingCurrentYear: !files.some(function(file) { return file.year === currentYear; })
  };
}

// すでにある管理フォルダを、そのまま保存先にする（ファイルはコピーも移動もしない）。
// その年のファイルだけがないときは、同じフォルダに作る。
function attachAppStorage(config) {
  const source = config || {};
  if (source.confirmed !== true) throw new Error("設定前の確認が完了していません。");
  const found = inspectExistingAppStorage(source.folderId);
  if (!found.files.length) throw new Error("このフォルダには管理ファイル（年ごとのスプレッドシート）がありません。");
  const props = appStorageProperties();
  const folder = DriveApp.getFolderById(found.folderId);
  const yearMap = {};
  found.files.forEach(function(file) { yearMap[String(file.year)] = file.id; });
  if (found.missingCurrentYear) {
    requireSheetsApi();
    yearMap[String(found.currentYear)] = createAnnualSpreadsheet(found.currentYear, folder, { planRows: [], taskRows: [] });
  }
  const parents = folder.getParents();
  if (parents.hasNext()) props.setProperty(APP_STORAGE_PARENT_FOLDER_ID_KEY, parents.next().getId());
  props.setProperty(APP_STORAGE_FOLDER_ID_KEY, folder.getId());
  props.setProperty(APP_STORAGE_MODE_KEY, APP_STORAGE_MODE_ANNUAL);
  setAnnualStorageFileMap(yearMap, props);
  if (typeof ensureDatabaseSchema === "function") {
    Object.keys(yearMap).forEach(function(year) { ensureDatabaseSchema(yearMap[year]); });
  }
  return getAppStorageStatus();
}

function migrateAppStorage(config) {
  const source = config || {};
  if (source.confirmed !== true) throw new Error("作成前の確認が完了していません。");
  const folderInfo = inspectAppStorageFolder(source.folderId || source.folderInput);
  const title = String(source.title || APP_MANAGED_FOLDER_DEFAULT_NAME).trim();
  if (!title || title.length > 120) throw new Error("フォルダ名は1〜120文字で入力してください。");

  requireSheetsApi();
  const props = appStorageProperties();
  const sourceStorageFolderId = props.getProperty(APP_STORAGE_FOLDER_ID_KEY);
  const sourceParentFolderId = props.getProperty(APP_STORAGE_PARENT_FOLDER_ID_KEY);
  const sourceYearMap = props.getProperty(APP_STORAGE_YEAR_FILES_KEY);
  const sourceMode = props.getProperty(APP_STORAGE_MODE_KEY);
  const parentFolder = DriveApp.getFolderById(folderInfo.id);
  let managedFolder = null;
  const createdSpreadsheetIds = [];
  try {
    managedFolder = parentFolder.createFolder(title);
    const yearMap = {};
    if (sourceMode === APP_STORAGE_MODE_ANNUAL) {
      const oldYearMap = getAnnualStorageFileMap(props);
      Object.keys(oldYearMap).sort().forEach(function(year) {
        const spreadsheetId = DriveApp.getFileById(oldYearMap[year]).makeCopy(year + "年工数管理データ", managedFolder).getId();
        createdSpreadsheetIds.push(spreadsheetId);
        yearMap[String(year)] = spreadsheetId;
      });
      const currentYear = currentStorageYear();
      if (!yearMap[String(currentYear)]) {
        const spreadsheetId = createAnnualSpreadsheet(currentYear, managedFolder, { planRows: [], taskRows: [] });
        createdSpreadsheetIds.push(spreadsheetId);
        yearMap[String(currentYear)] = spreadsheetId;
      }
    } else {
      const year = currentStorageYear();
      const spreadsheetId = createAnnualSpreadsheet(year, managedFolder, { planRows: [], taskRows: [] });
      createdSpreadsheetIds.push(spreadsheetId);
      yearMap[String(year)] = spreadsheetId;
    }
    props.setProperty(APP_STORAGE_PARENT_FOLDER_ID_KEY, folderInfo.id);
    props.setProperty(APP_STORAGE_FOLDER_ID_KEY, managedFolder.getId());
    props.setProperty(APP_STORAGE_MODE_KEY, APP_STORAGE_MODE_ANNUAL);
    setAnnualStorageFileMap(yearMap, props);
    if (typeof ensureDatabaseSchema === "function") {
      Object.keys(yearMap).forEach(function(year) { ensureDatabaseSchema(yearMap[year]); });
    }
    return getAppStorageStatus();
  } catch (err) {
    if (sourceStorageFolderId) props.setProperty(APP_STORAGE_FOLDER_ID_KEY, sourceStorageFolderId); else props.deleteProperty(APP_STORAGE_FOLDER_ID_KEY);
    if (sourceParentFolderId) props.setProperty(APP_STORAGE_PARENT_FOLDER_ID_KEY, sourceParentFolderId); else props.deleteProperty(APP_STORAGE_PARENT_FOLDER_ID_KEY);
    if (sourceYearMap) props.setProperty(APP_STORAGE_YEAR_FILES_KEY, sourceYearMap); else props.deleteProperty(APP_STORAGE_YEAR_FILES_KEY);
    if (sourceMode) props.setProperty(APP_STORAGE_MODE_KEY, sourceMode); else props.deleteProperty(APP_STORAGE_MODE_KEY);
    createdSpreadsheetIds.forEach(function(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (cleanupError) { Logger.log(cleanupError.message); } });
    if (managedFolder) { try { managedFolder.setTrashed(true); } catch (cleanupFolderError) { Logger.log(cleanupFolderError.message); } }
    throw err;
  }
}
