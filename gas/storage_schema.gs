/**
 * 保存先スプレッドシートの自己修復。
 *
 * シートの列番号をアプリ側で固定してしまうと、列追加・並び替え・古い
 * バージョンからの移行で値の意味がずれる。ここでは列名を見て現在の
 * 正本形式へ並べ直し、同じファイルではスキーマバージョンを記録する。
 * 次に構造を変えるときは APP_DB_SCHEMA_VERSION を上げるだけで、既存の
 * 年次ファイルも最初のアクセス時に同じ処理を通る。
 */
var APP_DB_SCHEMA_VERSION = 11;
var APP_DB_SCHEMA_VERSION_KEY_PREFIX = "appDbSchemaVersion:";
var APP_DB_SCHEMA_READ_LAST_COL = "AZ";
var APP_DB_RETIRED_SHEET_NAMES = ["週次報告"];
var APP_DB_SCHEMA_RUN = {};
// ファイルの形式番号は、そのスプレッドシート自体に（シートからは見えない開発者メタデータとして）記録する。
// 以前は ScriptProperties にだけ記録していたため、まだ記録のないファイルはそちらの値を引き継ぐ。
var APP_DB_SCHEMA_METADATA_KEY = "matometeKousuKanri.schemaVersion";
var APP_DB_SCHEMA_LOG_SHEET_NAME = "形式変更履歴";
var APP_DB_SCHEMA_LOG_HEADER = ["日時", "変更前の形式", "変更後の形式", "バックアップ", "内容"];
var APP_DB_SCHEMA_BACKUP_FOLDER_NAME = "バックアップ";
// 年次ファイルごとに残すバックアップの数。移行に成功したら、これより古いものはゴミ箱へ移す。
var APP_DB_SCHEMA_BACKUP_KEEP = 3;

// 形式（列の構成や値の意味）を変えるときの手順:
// 1. *_HEADER と、このファイルの APP_DB_*_ALIASES を更新する。列名を変えるときは旧名を別名に残す。
// 2. APP_DB_SCHEMA_VERSION を1つ上げる。
// 3. 列の追加・削除・並べ替え・改名だけなら、ここに処理を足す必要はない（正本の並びへの修復で済む）。
//    値の変換が要るときは、gas/legacy.gs の APP_DB_MIGRATIONS に { to: 新しい番号, description, run } を追記する。
//    run は正本の並びに直った後のシートに対して1回だけ呼ばれる。
// 4. tests/schema-migration.test.js に、旧形式のサンプルから新形式へ移れることのテストを足す。
// 移行の前には必ずファイルを丸ごとコピーしてバックアップを作り、「形式変更履歴」シートに記録する。
// 形式ごとの値の変換（APP_DB_MIGRATIONS）は gas/legacy.gs にまとめている。

var APP_DB_PLAN_ALIASES = {
  periodType: ["期間種別", "期間", "periodType"],
  periodKey: ["期間キー", "週キー", "月キー", "periodKey"],
  aggregationKey: ["集計キー", "集計", "タスク名", "aggregationKey", "課題"],
  plannedHours: ["予定工数", "plannedHours"],
  note: ["メモ", "note"],
  updatedAt: ["更新日時", "updatedAt"],
  priority: ["優先順位", "priority"],
  estimatedTotalHours: ["着地見込工数", "見込工数", "estimatedTotalHours"],
  initialPlannedHours: ["当初予定工数", "initialPlannedHours"],
  planKind: ["予定区分", "planKind"],
  createdAt: ["登録日時", "作成日時", "createdAt"],
  planId: ["予定ID", "計画ID", "planId", "id"],
  startDate: ["開始日", "startDate"],
  dailyCap: ["1日上限", "一日上限", "dailyCap"],
  carryWeek: ["繰越元週", "繰り越し元週", "carryWeek"],
  calendarKey: ["カレンダーキー", "calendarKey"],
  done: ["完了", "complete", "done"],
  dailyPlan: ["日別予定JSON", "日別予定", "dailyPlan"],
  projectId: ["プロジェクトID", "projectId", "project"],
  issueUrl: ["課題URL", "issueUrl"],
  progress: ["進捗", "progress"],
  endDate: ["終了日", "終了予定日", "endDate"]
};
var APP_DB_TASK_ALIASES = {
  id: ["ID", "サブタスクID", "taskId", "id"],
  periodType: ["期間種別", "期間", "periodType"],
  periodKey: ["期間キー", "週キー", "月キー", "periodKey"],
  parentKey: ["親タスク", "親課題", "集計キー", "parentKey"],
  title: ["サブタスク", "課題", "タスク名", "title"],
  plannedHours: ["予定工数", "plannedHours"],
  dueDate: ["期限", "締切", "dueDate"],
  status: ["状態", "ステータス", "status"],
  note: ["メモ", "note"],
  sortOrder: ["並び順", "順序", "sortOrder"],
  updatedAt: ["更新日時", "updatedAt"],
  parentPlanId: ["親予定ID", "親計画ID", "parentPlanId"]
};
var APP_DB_DAILY_ALIASES = {
  date: ["日付", "date"],
  title: ["タスク名 (PJ名など)", "タスク名", "課題", "title"],
  today: ["本日の工数", "本日工数", "today"],
  previous: ["これまでの工数", "前日まで", "previous"],
  estimate: ["予定総工数", "予定工数", "estimate"],
  status: ["進捗状況", "状態", "status"],
  mark: ["管理情報", "管理", "mark"],
  planId: ["予定ID", "計画ID", "planId"],
  projectId: ["プロジェクトID", "projectId", "project"],
  subtaskId: ["サブタスクID", "subtaskId"]
};
var APP_DB_CAPACITY_ALIASES = {
  date: ["日付", "date"],
  hours: ["稼働可能時間", "稼働時間", "hours"],
  reason: ["理由", "メモ", "reason"],
  updatedAt: ["更新日時", "updatedAt"]
};
var APP_DB_EXCLUSION_ALIASES = {
  key: ["イベントキー", "予定キー", "eventKey", "key"],
  updatedAt: ["更新日時", "updatedAt"]
};
var APP_DB_PROJECT_ALIASES = {
  id: ["プロジェクトID", "ID", "projectId", "id"],
  name: ["プロジェクト名", "名前", "name", "projectName"],
  description: ["説明", "概要", "description"],
  status: ["状態", "ステータス", "status"],
  startDate: ["開始日", "startDate"],
  endDate: ["終了予定日", "終了日", "endDate"],
  createdAt: ["登録日時", "作成日時", "createdAt"],
  updatedAt: ["更新日時", "updatedAt"]
};
var APP_DB_PROJECT_MONTHLY_ALIASES = {
  projectId: ["プロジェクトID", "projectId"],
  monthKey: ["対象月", "月", "monthKey", "month"],
  plannedHours: ["予定稼働時間", "予定時間", "plannedHours"],
  statusNote: ["稼働状況説明", "稼働状況", "説明", "statusNote", "note"],
  updatedAt: ["更新日時", "updatedAt"],
  plannedShareText: ["稼働式", "割合", "plannedShareText"]
};

// 旧テストや段階的なGAS反映で projects.gs がまだロードされていない
// コンテキストでは、従来のスキーマ番号を維持する。実運用（全ファイルを
// GASへ反映した状態）ではプロジェクト用の3へ進める。
function appDbSchemaVersion() {
  return typeof PROJECT_SHEET_NAME === "undefined" ? APP_DB_SCHEMA_VERSION - 1 : APP_DB_SCHEMA_VERSION;
}

function appDbSchemaPropertyKey(spreadsheetId) {
  return APP_DB_SCHEMA_VERSION_KEY_PREFIX + String(spreadsheetId || "");
}

function appDbSchemaText(value) {
  return String(value == null ? "" : value).trim();
}

function appDbSchemaColumnName(index) {
  var number = Number(index) + 1;
  var result = "";
  while (number > 0) {
    var remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function appDbSchemaRead(spreadsheetId, sheetName, range) {
  try {
    var response = Sheets.Spreadsheets.Values.get(
      spreadsheetId,
      a1Range(sheetName, range),
      VALUES_GET_OPTS
    );
    return response.values || [];
  } catch (err) {
    if (isMissingSheet(err)) return [];
    throw err;
  }
}

function appDbSchemaIndexMap(header, aliases) {
  var map = {};
  Object.keys(aliases || {}).forEach(function(field) {
    map[field] = -1;
    (aliases[field] || []).some(function(alias) {
      var index = (header || []).indexOf(alias);
      if (index < 0) return false;
      map[field] = index;
      return true;
    });
  });
  return map;
}

function appDbSchemaHeaderLooksKnown(header, aliases) {
  var known = 0;
  var values = header || [];
  Object.keys(aliases || {}).forEach(function(field) {
    if ((aliases[field] || []).some(function(alias) { return values.indexOf(alias) >= 0; })) known++;
  });
  return known >= 2;
}

function appDbSchemaTable(spreadsheetId, sheetName, canonicalHeader, aliases) {
  var first = appDbSchemaRead(spreadsheetId, sheetName, "A1:" + APP_DB_SCHEMA_READ_LAST_COL + "1");
  var rawHeader = first.length ? (first[0] || []).map(appDbSchemaText) : [];
  var hasHeader = appDbSchemaHeaderLooksKnown(rawHeader, aliases);
  var header = hasHeader ? rawHeader : canonicalHeader.slice();
  var values = appDbSchemaRead(
    spreadsheetId,
    sheetName,
    (hasHeader ? "A2:" : "A1:") + APP_DB_SCHEMA_READ_LAST_COL
  );
  return {
    header: header,
    rawHeader: rawHeader,
    hasHeader: hasHeader,
    values: values,
    indexes: appDbSchemaIndexMap(header, aliases)
  };
}

function appDbSchemaCell(row, index) {
  return index != null && index >= 0 ? (row && row[index] != null ? row[index] : "") : "";
}

function appDbSchemaNow() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
}

function appDbSchemaEnsureSheet(spreadsheetId, sheetName, header) {
  var meta = sheetsGetMeta(spreadsheetId);
  var existing = findSheetEntry(meta, sheetName);
  if (existing) return existing;
  var sheetId = generateSheetId(meta);
  sheetsBatchUpdate(spreadsheetId, [{
    addSheet: {
      properties: {
        sheetId: sheetId,
        title: sheetName,
        gridProperties: { frozenRowCount: 1 }
      }
    }
  }]);
  sheetsValuesUpdate(
    spreadsheetId,
    a1Range(sheetName, "A1:" + appDbSchemaColumnName(header.length - 1) + "1"),
    [header]
  );
  return { properties: { sheetId: sheetId, title: sheetName } };
}

function appDbSchemaWriteTable(spreadsheetId, sheetName, header, rows, oldRowCount) {
  var lastColumn = appDbSchemaColumnName(header.length - 1);
  var values = [header].concat(rows || []);
  sheetsValuesUpdate(
    spreadsheetId,
    a1Range(sheetName, "A1:" + lastColumn + values.length),
    values
  );
  if (Number(oldRowCount) > (rows || []).length) {
    sheetsValuesClear(
      spreadsheetId,
      a1Range(sheetName, "A" + ((rows || []).length + 2) + ":" + lastColumn + (Number(oldRowCount) + 1))
    );
  }
}

function appDbSchemaInvalidateSheetCache(spreadsheetId, sheetName) {
  if (typeof userCache !== "function") return;
  try {
    var cache = userCache();
    var baseKey = sheetValuesCacheKey(spreadsheetId, sheetName);
    var raw = cache.get(baseKey);
    var parsed = raw ? JSON.parse(raw) : null;
    cache.remove(baseKey);
    var chunkCount = parsed && parsed.version === SHEET_VALUES_CACHE_VERSION ? Number(parsed.chunkCount) : 0;
    for (var index = 0; index < chunkCount && index < 500; index++) {
      cache.remove(sheetValuesCacheChunkKey(spreadsheetId, sheetName, index));
    }
  } catch (_) {}
}

function appDbSchemaNormalizePeriodType(value) {
  try { return normalizeBudgetPeriodType(value); }
  catch (_) { return appDbSchemaText(value); }
}

function appDbSchemaNormalizePeriodKey(value, type) {
  try { return normalizeBudgetPeriodKey(type, value); }
  catch (_) { return appDbSchemaText(value); }
}

// 形式8より前のファイルの修復処理（appDbSchemaRepairSpreadsheet など）は gas/legacy.gs にまとめている。

function appDbSchemaReadFileVersion(spreadsheetId) {
  var response = Sheets.Spreadsheets.get(spreadsheetId, {
    fields: "developerMetadata(metadataId,metadataKey,metadataValue)"
  }) || {};
  var found = (response.developerMetadata || []).filter(function(entry) {
    return entry && entry.metadataKey === APP_DB_SCHEMA_METADATA_KEY;
  })[0];
  if (!found) return { version: null, metadataId: null };
  var version = parseInt(found.metadataValue, 10);
  return { version: isFinite(version) ? version : 0, metadataId: found.metadataId };
}

function appDbSchemaWriteFileVersion(spreadsheetId, version, metadataId) {
  var request = metadataId != null
    ? {
        updateDeveloperMetadata: {
          dataFilters: [{ developerMetadataLookup: { metadataId: metadataId } }],
          developerMetadata: { metadataValue: String(version) },
          fields: "metadataValue"
        }
      }
    : {
        createDeveloperMetadata: {
          developerMetadata: {
            metadataKey: APP_DB_SCHEMA_METADATA_KEY,
            metadataValue: String(version),
            location: { spreadsheet: true },
            visibility: "DOCUMENT"
          }
        }
      };
  sheetsBatchUpdate(spreadsheetId, [request]);
}

// 移行の前に、ファイルを同じフォルダ内の「バックアップ」フォルダへ丸ごとコピーする。
function appDbSchemaBackupFolderFor(file, create) {
  var parents = file.getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var folders = parent.getFoldersByName(APP_DB_SCHEMA_BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return create ? parent.createFolder(APP_DB_SCHEMA_BACKUP_FOLDER_NAME) : null;
}

function appDbSchemaBackupPrefix(file) {
  return file.getName() + "（形式";
}

function appDbSchemaBackup(spreadsheetId, fromVersion, toVersion) {
  var file = DriveApp.getFileById(spreadsheetId);
  var folder = appDbSchemaBackupFolderFor(file, true);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Tokyo", "yyyy-MM-dd HHmm");
  var name = appDbSchemaBackupPrefix(file) + fromVersion + "→" + toVersion + " 移行前 " + stamp + "）";
  return file.makeCopy(name, folder).getUrl();
}

// その年次ファイルのバックアップを新しい順に APP_DB_SCHEMA_BACKUP_KEEP 件だけ残し、古いものはゴミ箱へ移す。
// 片付けに失敗しても移行自体は成功しているので、エラーにはしない。
function appDbSchemaPruneBackups(spreadsheetId) {
  try {
    var file = DriveApp.getFileById(spreadsheetId);
    var folder = appDbSchemaBackupFolderFor(file, false);
    if (!folder) return 0;
    var prefix = appDbSchemaBackupPrefix(file);
    var backups = [];
    var files = folder.getFiles();
    while (files.hasNext()) {
      var backup = files.next();
      if (backup.getId() === spreadsheetId || backup.isTrashed() || backup.getName().indexOf(prefix) !== 0) continue;
      backups.push(backup);
    }
    backups.sort(function(left, right) { return right.getDateCreated().getTime() - left.getDateCreated().getTime(); });
    backups.slice(APP_DB_SCHEMA_BACKUP_KEEP).forEach(function(old) { old.setTrashed(true); });
    return Math.max(0, backups.length - APP_DB_SCHEMA_BACKUP_KEEP);
  } catch (err) {
    if (typeof Logger !== "undefined") Logger.log("古いバックアップを片付けられませんでした: " + (err && err.message || err));
    return 0;
  }
}

// 年次ファイルと同じフォルダにある「バックアップ」フォルダを返す（年次ファイルごと、重複なし）。
function appDbSchemaBackupFolders() {
  var folders = [];
  var seen = {};
  var map = typeof getAnnualStorageFileMap === "function" ? getAnnualStorageFileMap() : {};
  Object.keys(map).forEach(function(year) {
    var id = map[year];
    if (!id) return;
    var parents;
    try { parents = DriveApp.getFileById(id).getParents(); } catch (err) { return; }
    while (parents.hasNext()) {
      var backups = parents.next().getFoldersByName(APP_DB_SCHEMA_BACKUP_FOLDER_NAME);
      while (backups.hasNext()) {
        var folder = backups.next();
        if (seen[folder.getId()]) continue;
        seen[folder.getId()] = true;
        folders.push(folder);
      }
    }
  });
  return folders;
}

/** 形式変更の前に作ったバックアップの一覧（新しい順）。 */
function listSchemaBackups() {
  var annualIds = {};
  var map = typeof getAnnualStorageFileMap === "function" ? getAnnualStorageFileMap() : {};
  Object.keys(map).forEach(function(year) { if (map[year]) annualIds[map[year]] = true; });
  var items = [];
  appDbSchemaBackupFolders().forEach(function(folder) {
    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (annualIds[file.getId()] || file.isTrashed()) continue;
      items.push({
        id: file.getId(),
        name: file.getName(),
        createdAt: Utilities.formatDate(file.getDateCreated(), Session.getScriptTimeZone() || "Asia/Tokyo", "yyyy/MM/dd HH:mm"),
        size: Number(file.getSize()) || 0,
        url: file.getUrl()
      });
    }
  });
  return items.sort(function(left, right) { return left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0; });
}

/** バックアップを Drive のゴミ箱へ移す（30日以内なら Drive から戻せる）。バックアップフォルダ内のファイル以外は扱わない。 */
function trashSchemaBackups(fileIds) {
  var allowed = {};
  listSchemaBackups().forEach(function(item) { allowed[item.id] = true; });
  var targets = (Array.isArray(fileIds) ? fileIds : []).map(function(id) { return String(id || "").trim(); }).filter(Boolean);
  // 1件でも対象外があれば、どれも削除しない。
  if (targets.some(function(id) { return !allowed[id]; })) throw new Error("バックアップフォルダにないファイルは削除できません。");
  targets.forEach(function(id) { DriveApp.getFileById(id).setTrashed(true); });
  return { trashed: targets.length, backups: listSchemaBackups() };
}

function appDbSchemaAppendLog(spreadsheetId, fromVersion, toVersion, backupUrl, description) {
  appDbSchemaEnsureSheet(spreadsheetId, APP_DB_SCHEMA_LOG_SHEET_NAME, APP_DB_SCHEMA_LOG_HEADER);
  var existing = appDbSchemaRead(spreadsheetId, APP_DB_SCHEMA_LOG_SHEET_NAME, "A1:E");
  var row = existing.length + 1;
  sheetsValuesUpdate(spreadsheetId, a1Range(APP_DB_SCHEMA_LOG_SHEET_NAME, "A" + row + ":E" + row), [[
    appDbSchemaNow(), String(fromVersion), String(toVersion), backupUrl || "", description || ""
  ]]);
}

// 移行の内容を、実行前に確かめるための説明（実データは変えない）。
// 形式8より前のファイルだけ、旧形式の値まで直す修復処理を通す（APP_DB_LEGACY_REPAIR_BELOW は gas/legacy.gs）。
// 形式8以降の移行では列の並びと見出しだけをそろえ、値は変えない。

function appDbSchemaMigrationSteps(fromVersion, toVersion) {
  var steps = [fromVersion < APP_DB_LEGACY_REPAIR_BELOW
    ? "旧形式の列名・並び・値を修復"
    : "列の並びと見出しを最新の形式にそろえる（値は変えない）"];
  if (fromVersion < 2) steps.push("旧形式の完了列（FALSE）を空欄へ戻す");
  APP_DB_MIGRATIONS.filter(function(migration) {
    return migration.to > fromVersion && migration.to <= toVersion;
  }).sort(function(left, right) { return left.to - right.to; }).forEach(function(migration) {
    steps.push("形式" + migration.to + ": " + migration.description);
  });
  return steps;
}

// アプリの表をすべて、値を変えずに最新の列の並び・見出しへそろえる。
// 先に全シートを点検し、アプリが知らない列などがあれば何も書き換えずに中止する。
function appDbSchemaInspectLayouts(spreadsheetId) {
  return (sheetsGetMeta(spreadsheetId).sheets || []).map(function(sheet) {
    var title = sheet.properties && sheet.properties.title;
    if (!title || !appTableHeader(title)) return null;
    var values = appFetchTableValues(spreadsheetId, title);
    if (!values.length) return null;
    var layout = appTableLayout(title, values[0]);
    var problem = !layout.recognized ? "の1行目の見出しを認識できないため、"
      : layout.unknown.length ? "の" + appDbColumnLetter(layout.unknown[0].column) + "列「" + layout.unknown[0].name + "」はアプリが使わない列のため、"
      : "";
    for (var r = 1; !problem && r < values.length; r++) {
      var row = values[r] || [];
      for (var c = 0; c < row.length; c++) {
        if (!layout.used[c] && appDbSchemaText(row[c]) !== "") {
          problem = "の" + appDbColumnLetter(c) + (r + 1) + "に見出しのない列の値があるため、";
          break;
        }
      }
    }
    if (problem) throw new Error("シート「" + title + "」" + problem + "形式の移行を中止しました（シートは変更していません）。");
    return { title: title, values: values, layout: layout };
  }).filter(function(table) { return !!table; });
}

function appDbSchemaNormalizeLayouts(spreadsheetId, inspected) {
  var tables = inspected || appDbSchemaInspectLayouts(spreadsheetId);
  tables.forEach(function(table) {
    var header = table.layout.header;
    if (!table.layout.canonical) {
      appNormalizeTableLayout(spreadsheetId, table.title, header, appTableRowsFromValues(table.title, table.values).rows, table.values);
    } else if ((table.values[0] || []).length < header.length) {
      // 新しい列が末尾に足されただけなら、見出し行に列名を書き足す。
      sheetsValuesUpdate(spreadsheetId, a1Range(table.title, "A1:" + appDbColumnLetter(header.length - 1) + "1"), [header]);
    }
    appDbSchemaInvalidateSheetCache(spreadsheetId, table.title);
  });
  return { spreadsheetId: spreadsheetId, version: appDbSchemaVersion(), normalizedSheets: tables.length };
}

function appDbSchemaMigrate(spreadsheetId, fromVersion, toVersion, metadataId) {
  var legacy = fromVersion < APP_DB_LEGACY_REPAIR_BELOW;
  // 先に点検する（問題があればバックアップも作らずに中止し、保存のたびにコピーが増えないようにする）。
  var inspected = legacy ? null : appDbSchemaInspectLayouts(spreadsheetId);
  // バックアップが作れないときは移行しない（呼び出し元の保存も止まる）。
  var backupUrl = appDbSchemaBackup(spreadsheetId, fromVersion, toVersion);
  var steps = appDbSchemaMigrationSteps(fromVersion, toVersion);
  var result = legacy
    ? appDbSchemaRepairSpreadsheet(spreadsheetId, { migrateLegacyDoneColumn: fromVersion < 2 })
    : appDbSchemaNormalizeLayouts(spreadsheetId, inspected);
  APP_DB_MIGRATIONS.filter(function(migration) {
    return migration.to > fromVersion && migration.to <= toVersion;
  }).sort(function(left, right) { return left.to - right.to; }).forEach(function(migration) {
    migration.run(spreadsheetId);
  });
  appDbSchemaAppendLog(spreadsheetId, fromVersion, toVersion, backupUrl, steps.join(" / "));
  appDbSchemaWriteFileVersion(spreadsheetId, toVersion, metadataId);
  if (typeof appForgetFreshSheets === "function") appForgetFreshSheets(spreadsheetId);
  appDbSchemaPruneBackups(spreadsheetId);
  result.backupUrl = backupUrl;
  return result;
}

// アプリが新しく作ったファイルに、最新の形式番号を記録する。
function markDatabaseSchemaCurrent(spreadsheetId) {
  var id = String(spreadsheetId || "").trim();
  if (!id) return null;
  var current = appDbSchemaVersion();
  APP_DB_SCHEMA_RUN[id] = { spreadsheetId: id, version: current, fileVersion: current, repaired: false, newer: false };
  appDbSchemaWriteFileVersion(id, current, null);
  var props = typeof appScriptProperties === "function" ? appScriptProperties() : null;
  if (props) props.setProperty(appDbSchemaPropertyKey(id), String(current));
  return APP_DB_SCHEMA_RUN[id];
}

// ファイルの形式を確かめ、古ければバックアップを取ってから移行する。
// 戻り値の newer が true のときは、このアプリより新しい形式のファイル（保存してはいけない）。
function ensureDatabaseSchema(spreadsheetId) {
  var id = String(spreadsheetId || "").trim();
  if (!id) return null;
  if (APP_DB_SCHEMA_RUN[id]) return APP_DB_SCHEMA_RUN[id];
  var props = typeof appScriptProperties === "function" ? appScriptProperties() : null;
  var key = appDbSchemaPropertyKey(id);
  var current = appDbSchemaVersion();
  var file = appDbSchemaReadFileVersion(id);
  var legacyVersion = props ? Number(props.getProperty(key) || 0) : 0;
  var fileVersion = file.version == null ? legacyVersion : file.version;
  var state = { spreadsheetId: id, version: current, fileVersion: fileVersion, repaired: false, newer: fileVersion > current };
  APP_DB_SCHEMA_RUN[id] = state;
  if (state.newer) return state;
  if (fileVersion === current) {
    // 以前の記録方法（ScriptProperties）から、ファイル自体への記録へ引き継ぐ。データは変えない。
    if (file.version == null) appDbSchemaWriteFileVersion(id, current, null);
    return state;
  }
  var holdKey = "schemaRepairHold:" + id;
  try {
    if (CacheService.getScriptCache().get(holdKey)) {
      state.deferred = true;
      return state;
    }
  } catch (err) {}
  try {
    var result = appDbSchemaMigrate(id, fileVersion, current, file.metadataId);
    if (props) props.setProperty(key, String(current));
    state.repaired = true;
    state.fileVersion = current;
    state.backupUrl = result.backupUrl;
    return state;
  } catch (err) {
    if (!/quota exceeded|rate limit|too many requests|Read requests/i.test(String(err && err.message || err))) throw err;
    try { CacheService.getScriptCache().put(holdKey, "1", 60); } catch (holdErr) {}
    state.deferred = true;
    return state;
  }
}

function ensureDatabaseSchemaForDate(dateStr) {
  if (typeof getSpreadsheetIdForDate !== "function") return null;
  var id = getSpreadsheetIdForDate(dateStr);
  return id ? ensureDatabaseSchema(id) : null;
}

// ---- データの点検 ----
// 年次ファイルのアプリの表を読み、壊れていそうな箇所を一覧にする（シートは変更しない）。
// 見つかったときは、保存ログから「この時刻の版まで戻せば直りそう」という目安も返す。
var APP_DB_HEALTH_PROBLEM_LIMIT = 50;

function appDbHealthCell(column, row) {
  return appDbColumnLetter(column) + row;
}

function appDbHealthInspectFile(spreadsheetId, year, problems) {
  var file = year + "年";
  function add(sheet, message, cell) {
    if (problems.length < APP_DB_HEALTH_PROBLEM_LIMIT) problems.push({ file: file, sheet: sheet, cell: cell || "", message: message });
  }
  var tables = {};
  (sheetsGetMeta(spreadsheetId).sheets || []).forEach(function(sheet) {
    var title = sheet.properties && sheet.properties.title;
    if (!title || !appTableHeader(title)) return;
    var values = appFetchTableValues(spreadsheetId, title);
    if (!values.length) return;
    var layout = appTableLayout(title, values[0]);
    if (!layout.recognized) return add(title, "1行目の見出しを認識できません。", "A1");
    layout.unknown.forEach(function(entry) { add(title, "アプリが使わない列「" + entry.name + "」があります。", appDbHealthCell(entry.column, 1)); });
    for (var r = 1; r < values.length; r++) {
      var raw = values[r] || [];
      for (var c = 0; c < raw.length; c++) {
        if (!layout.used[c] && appDbSchemaText(raw[c]) !== "") { add(title, "見出しのない列に値があります。", appDbHealthCell(c, r + 1)); break; }
      }
    }
    tables[title] = appTableRowsFromValues(title, values).rows;
  });
  return tables;
}

function appDbHealthCheckTables(year, tables, allPlanIds, problems) {
  var file = year + "年";
  function add(sheet, message, cell) {
    if (problems.length < APP_DB_HEALTH_PROBLEM_LIMIT) problems.push({ file: file, sheet: sheet, cell: cell || "", message: message });
  }
  var timezone = Session.getScriptTimeZone() || "Asia/Tokyo";
  var plans = tables[BUDGET_PLAN_SHEET_NAME] || [];
  var seenPlans = {};
  plans.forEach(function(row, index) {
    var line = index + 2;
    if (!appDbSchemaText(row[2])) {
      if (row.some(function(value) { return appDbSchemaText(value) !== ""; })) add(BUDGET_PLAN_SHEET_NAME, "予定名（集計キー）が空の行があります。", "C" + line);
      return;
    }
    var planId = budgetStableId(row[11]);
    if (!planId) return add(BUDGET_PLAN_SHEET_NAME, "予定IDが空です。", "L" + line);
    var stamp = planId + "\u0000" + appDbSchemaText(row[0]) + "\u0000" + appDbSchemaText(row[1]);
    if (seenPlans[stamp]) add(BUDGET_PLAN_SHEET_NAME, "同じ期間に同じ予定IDの行が重なっています（" + seenPlans[stamp] + "行目と）。", "L" + line);
    seenPlans[stamp] = line;
  });
  var tasks = tables[PLANNING_TASK_SHEET_NAME] || [];
  var seenTasks = {};
  tasks.forEach(function(row, index) {
    var line = index + 2;
    if (!row.some(function(value) { return appDbSchemaText(value) !== ""; })) return;
    var id = appDbSchemaText(row[0]);
    if (!id) add(PLANNING_TASK_SHEET_NAME, "サブタスクのIDが空です。", "A" + line);
    else if (seenTasks[id]) add(PLANNING_TASK_SHEET_NAME, "サブタスクのIDが重なっています（" + seenTasks[id] + "行目と）。", "A" + line);
    else seenTasks[id] = line;
    var parentPlanId = budgetStableId(row[11]);
    // 予実計画と予定タスクの保存の間で失敗すると、親のない予定タスクが残る。
    if (parentPlanId && !allPlanIds[parentPlanId]) add(PLANNING_TASK_SHEET_NAME, "親の予定（予定ID " + parentPlanId + "）が見つかりません。", "L" + line);
  });
  Object.keys(tables).forEach(function(title) {
    var month = parseSheetMonth(title);
    if (!month) return;
    var prefix = month.year + "-" + (month.month < 10 ? "0" : "") + month.month + "-";
    tables[title].forEach(function(row, index) {
      var line = index + 2;
      if (!row.some(function(value) { return appDbSchemaText(value) !== ""; })) return;
      var dateKey = budgetDateCellKey(row[0], timezone);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return add(title, "日付が空か、日付として読めません。", "A" + line);
      if (dateKey.indexOf(prefix) !== 0) add(title, "このシートの月ではない日付（" + dateKey + "）です。", "A" + line);
      [2, 3, 4].forEach(function(column) {
        var value = row[column];
        if (value !== "" && value != null && !isFinite(Number(value))) add(title, "工数が数値ではありません（「" + value + "」）。", appDbColumnLetter(column) + line);
      });
    });
  });
}

function appDbHealthLog(limit) {
  return appWriteLogEntries().slice(-(limit || 10)).reverse().map(function(entry) {
    return { time: appFormatLogTime(entry.at), ok: !!entry.ok, label: appWriteLogLabel(entry), error: entry.error || "" };
  });
}

/** 設定画面用：直近の保存ログと戻す目安（シートは読まない）。 */
function getDataHealthSummary() {
  return { hint: appRestoreHint(), log: appDbHealthLog(10) };
}

/** 年次ファイルを点検し、壊れていそうな箇所と戻す目安を返す（シートは変更しない）。 */
function checkDataHealth() {
  var map = typeof getAnnualStorageFileMap === "function" ? getAnnualStorageFileMap() : {};
  var years = Object.keys(map).filter(function(year) { return !!map[year]; }).sort();
  var problems = [];
  var tablesByYear = {};
  var allPlanIds = {};
  years.forEach(function(year) {
    try {
      tablesByYear[year] = appDbHealthInspectFile(map[year], year, problems);
    } catch (err) {
      problems.push({ file: year + "年", sheet: "", cell: "", message: "ファイルを読めませんでした: " + (err && err.message || err) });
      return;
    }
    (tablesByYear[year][BUDGET_PLAN_SHEET_NAME] || []).forEach(function(row) {
      var planId = budgetStableId(row[11]);
      if (planId) allPlanIds[planId] = true;
    });
  });
  years.forEach(function(year) {
    if (tablesByYear[year]) appDbHealthCheckTables(year, tablesByYear[year], allPlanIds, problems);
  });
  return {
    checkedAt: appFormatLogTime(new Date().toISOString()),
    problems: problems,
    truncated: problems.length >= APP_DB_HEALTH_PROBLEM_LIMIT,
    hint: appRestoreHint(),
    log: appDbHealthLog(10)
  };
}
