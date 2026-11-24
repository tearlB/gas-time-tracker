/** Backlogから本人の担当課題を読み込む。認証情報はUserPropertiesにのみ保存する。 */
var BACKLOG_SPACE_PROPERTY = 'backlogSpaceUrl';
var BACKLOG_API_KEY_PROPERTY = 'backlogApiKey';
var BACKLOG_USER_ID_PROPERTY = 'backlogUserId';
var BACKLOG_PROJECT_MAP_PROPERTY = 'backlogProjectMap';
var BACKLOG_PENDING_SPACE_PROPERTY = 'backlogPendingSpaceUrl';
var BACKLOG_PENDING_KEY_PROPERTY = 'backlogPendingApiKey';

function backlogAuthorizationStatus_() {
  var info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, ['https://www.googleapis.com/auth/script.external_request']);
  var required = info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED;
  return { authorizationRequired: required, authorizationUrl: required ? info.getAuthorizationUrl() : '' };
}

function backlogNormalizeSpace(value) {
  var text = String(value || '').trim();
  var match = /^(https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:backlog\.(?:jp|com)|backlogtool\.com))(?=[/?#]|$)/i.exec(text);
  if (!match) {
    throw new Error('BacklogのスペースURLを入力してください（https://スペース名.backlog.jp など）。');
  }
  return match[1].toLowerCase();
}

function getBacklogSettings() {
  var properties = appUserProperties();
  var pendingSpace = properties.getProperty(BACKLOG_PENDING_SPACE_PROPERTY) || '';
  var pending = !!(pendingSpace && properties.getProperty(BACKLOG_PENDING_KEY_PROPERTY));
  var spaceUrl = pending ? pendingSpace : properties.getProperty(BACKLOG_SPACE_PROPERTY) || '';
  var hasApiKey = !!properties.getProperty(pending ? BACKLOG_PENDING_KEY_PROPERTY : BACKLOG_API_KEY_PROPERTY);
  var access = backlogAuthorizationStatus_();
  return { spaceUrl: spaceUrl, hasApiKey: hasApiKey, configured: !pending && !!(spaceUrl && hasApiKey), pending: pending, authorizationRequired: access.authorizationRequired, authorizationUrl: access.authorizationUrl };
}

/** Backlogのプロジェクトキー（課題キーの「-」より前）→ このアプリのプロジェクトID。本人の設定として保存する。 */
function backlogProjectMap_() {
  try {
    var parsed = JSON.parse(appUserProperties().getProperty(BACKLOG_PROJECT_MAP_PROPERTY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) { return {}; }
}

function backlogProjectKeyOfIssue_(issueKey) {
  var match = /^(.+)-\d+$/.exec(String(issueKey || ''));
  return match ? match[1] : '';
}

function getBacklogProjectMap() {
  return { map: backlogProjectMap_() };
}

function saveBacklogProjectMap(payload) {
  return withUserWriteLock(function() {
    var source = payload && payload.map && typeof payload.map === 'object' ? payload.map : {};
    var next = {};
    Object.keys(source).forEach(function(key) {
      var value = String(source[key] || '').trim();
      if (!value) return;
      if (!/^[A-Za-z0-9_]{1,50}$/.test(key) || value.length > 100) throw new Error('プロジェクトの割り当てが不正です。');
      next[key] = value;
    });
    if (Object.keys(next).length > 500) throw new Error('割り当てが多すぎます。');
    var stored = {}; stored[BACKLOG_PROJECT_MAP_PROPERTY] = JSON.stringify(next);
    appUserProperties().setProperties(stored);
    return { map: next };
  });
}

/** 接続済みのスペースにあるBacklogプロジェクトの一覧と、いまの割り当て。 */
function listBacklogProjects() {
  var properties = appUserProperties();
  var space = properties.getProperty(BACKLOG_SPACE_PROPERTY) || '';
  var key = properties.getProperty(BACKLOG_API_KEY_PROPERTY) || '';
  if (!space || !key) throw new Error('先にBacklogの接続を設定してください。');
  var projects = backlogGet_(space, key, 'projects', { archived: 'false' });
  if (!Array.isArray(projects)) throw new Error('Backlogのプロジェクト一覧を読み取れませんでした。');
  return {
    map: backlogProjectMap_(),
    projects: projects.filter(function(project) { return project && project.projectKey; }).map(function(project) {
      return { key: String(project.projectKey), name: String(project.name || '') };
    })
  };
}

function backlogFetchError_(error, spaceUrl) {
  // 例外の本文はURLやヘッダーを含み得るため、そのまま画面・ログへ出さない。
  var message = String(error && error.message || '');
  if (/script\.external_request|permission.*UrlFetch|UrlFetch.*permission|権限.*UrlFetch|UrlFetch.*権限|Authorization is required|承認が必要/i.test(message)) {
    return new Error('Google側で外部接続の許可が必要です。Backlog設定の「Googleの接続権限を許可」から許可し、もう一度保存してください。');
  }
  if (/DNS|resolve|host not found|address unavailable|名前.*解決/i.test(message)) {
    return new Error('Backlogの接続先を見つけられませんでした。スペースURL（' + spaceUrl + '）を確認してください。');
  }
  if (/SSL|TLS|certificate|証明書/i.test(message)) {
    return new Error('Backlogの暗号化通信を確立できませんでした。スペースURLと接続先の証明書を確認してください。');
  }
  if (/timed? ?out|timeout|タイムアウト/i.test(message)) {
    return new Error('Backlogへの接続がタイムアウトしました。少し待ってから再試行してください。');
  }
  if (/too many|limit exceeded|割り当て|呼び出し回数/i.test(message)) {
    return new Error('Google側の外部接続の利用上限に達しました。時間をおいて再試行してください。');
  }
  if (/header.*invalid|invalid.*header|ヘッダー.*無効/i.test(message)) {
    return new Error('APIキーを送信できませんでした。キーに空白や全角文字が入っていないか確認してください。');
  }
  return new Error('Backlogへ接続できませんでした。スペースURL（' + spaceUrl + '）と接続制限を確認して再試行してください。');
}

function backlogGet_(spaceUrl, apiKey, path, params) {
  var space = backlogNormalizeSpace(spaceUrl);
  var query = Object.keys(params || {}).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  }).join('&');
  var response;
  try {
    response = UrlFetchApp.fetch(space + '/api/v2/' + path + (query ? '?' + query : ''), {
      method: 'get', headers: { 'Backlog-API-Key': apiKey }, muteHttpExceptions: true, followRedirects: false
    });
  } catch (error) { throw backlogFetchError_(error, space); }
  var code = response.getResponseCode();
  if (code === 401) throw new Error('BacklogのAPIキーを確認してください（HTTP 401）。');
  if (code === 403) throw new Error('Backlogへのアクセスが拒否されました（HTTP 403）。APIキー・閲覧権限・接続元IP制限を確認してください。');
  if (code === 429) throw new Error('Backlogの取得回数の上限に達しました。時間をおいて再試行してください。');
  if (code !== 200) throw new Error('Backlogの取得に失敗しました（HTTP ' + code + '）。スペースURLを確認してください。');
  try { return JSON.parse(response.getContentText()); }
  catch (_) { throw new Error('Backlogからの応答を読み取れませんでした。'); }
}

function saveBacklogSettings(payload) {
  return withUserWriteLock(function() {
    payload = payload || {};
    var properties = appUserProperties();
    var space = backlogNormalizeSpace(payload.spaceUrl);
    var previousSpace = properties.getProperty(BACKLOG_SPACE_PROPERTY) || '';
    var key = String(payload.apiKey || '').trim();
    if (!key && space === properties.getProperty(BACKLOG_PENDING_SPACE_PROPERTY)) key = properties.getProperty(BACKLOG_PENDING_KEY_PROPERTY) || '';
    if (!key && space === previousSpace) key = properties.getProperty(BACKLOG_API_KEY_PROPERTY) || '';
    if (!key || key.length > 1000) throw new Error('APIキーを入力してください。');
    if (/[^\x21-\x7e]/.test(key)) throw new Error('APIキーに空白・改行・全角文字が含まれています。キーだけをコピーして入力してください。');
    // 接続エラーやGoogleの承認で画面を再読み込みしても、入力した設定は失わない。
    // 確認済みの接続とは分け、キーは本人のUserPropertiesだけに保存する。
    properties.setProperties((function() { var draft = {}; draft[BACKLOG_PENDING_SPACE_PROPERTY] = space; draft[BACKLOG_PENDING_KEY_PROPERTY] = key; return draft; })());
    if (backlogAuthorizationStatus_().authorizationRequired) return getBacklogSettings();
    var user = backlogGet_(space, key, 'users/myself', {});
    if (!user || !(Number(user.id) > 0)) throw new Error('Backlogの本人情報を取得できませんでした。');
    // 本人のIDは接続確認のときに控え、課題の取得のたびに問い合わせない（取得が速くなる）。
    properties.setProperties((function() { var next = {}; next[BACKLOG_SPACE_PROPERTY] = space; next[BACKLOG_API_KEY_PROPERTY] = key; next[BACKLOG_USER_ID_PROPERTY] = String(user.id); return next; })());
    properties.deleteProperty(BACKLOG_PENDING_SPACE_PROPERTY);
    properties.deleteProperty(BACKLOG_PENDING_KEY_PROPERTY);
    var result = getBacklogSettings();
    result.userName = String(user.name || '');
    return result;
  });
}

function clearBacklogSettings() {
  return withUserWriteLock(function() {
    var properties = appUserProperties();
    properties.deleteProperty(BACKLOG_SPACE_PROPERTY);
    properties.deleteProperty(BACKLOG_API_KEY_PROPERTY);
    properties.deleteProperty(BACKLOG_PENDING_SPACE_PROPERTY);
    properties.deleteProperty(BACKLOG_PENDING_KEY_PROPERTY);
    properties.deleteProperty(BACKLOG_USER_ID_PROPERTY);
    return getBacklogSettings();
  });
}

function listBacklogAssignedIssues(payload) {
  payload = payload || {};
  var properties = appUserProperties();
  var space = properties.getProperty(BACKLOG_SPACE_PROPERTY) || '';
  var key = properties.getProperty(BACKLOG_API_KEY_PROPERTY) || '';
  // 未設定でも例外にせず知らせる。画面は課題の取得と設定の確認を別々に待たずに、設定画面へ案内できる。
  if (!space || !key) return { needsSetup: true, issues: [], hasMore: false, nextOffset: 0, userName: '' };
  var offset = Number(payload.offset || 0);
  if (!isFinite(offset) || offset < 0 || offset % 100 !== 0 || offset > 100000) throw new Error('取得位置が不正です。');
  var user = { id: properties.getProperty(BACKLOG_USER_ID_PROPERTY) || '', name: '' };
  if (!(Number(user.id) > 0)) {
    user = backlogGet_(space, key, 'users/myself', {});
    if (!user || !(Number(user.id) > 0)) throw new Error('Backlogの本人情報を取得できませんでした。');
    var cached = {}; cached[BACKLOG_USER_ID_PROPERTY] = String(user.id);
    properties.setProperties(cached);
  }
  var issues = backlogGet_(space, key, 'issues', { 'assigneeId[]': user.id, count: 100, offset: offset, sort: 'updated', order: 'desc' });
  if (!Array.isArray(issues)) throw new Error('Backlogの課題一覧を読み取れませんでした。');
  var projectMap = backlogProjectMap_();
  var importedUrls = {};
  if (typeof projectLoadAllPlans === 'function') projectLoadAllPlans().forEach(function(plan) {
    if (plan.issueUrl) importedUrls[plan.issueUrl] = true;
  });
  return {
    userName: String(user.name || ''),
    hasMore: issues.length === 100,
    nextOffset: offset + issues.length,
    issues: issues.filter(function(issue) { return issue && Number(issue.status && issue.status.id) !== 4; }).map(function(issue) {
      return {
        id: String(issue.id), key: String(issue.issueKey || ''), title: String(issue.summary || ''),
        status: String(issue.status && issue.status.name || ''),
        estimatedHours: issue.estimatedHours == null ? null : Math.max(0, Number(issue.estimatedHours) || 0),
        startDate: String(issue.startDate || '').slice(0, 10), dueDate: String(issue.dueDate || '').slice(0, 10),
        appProjectId: String(projectMap[backlogProjectKeyOfIssue_(issue.issueKey)] || ''),
        imported: !!importedUrls[space + '/view/' + encodeURIComponent(issue.issueKey)],
        url: space + '/view/' + encodeURIComponent(issue.issueKey)
      };
    })
  };
}
