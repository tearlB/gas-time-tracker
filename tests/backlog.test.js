const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
function context() {
  const data = {};
  const requests = [];
  const properties = {
    getProperty: key => data[key] || null,
    setProperties: next => Object.assign(data, next),
    deleteProperty: key => { delete data[key]; }
  };
  const api = {
    appUserProperties: () => properties,
    ScriptApp: {
      AuthMode: { FULL: 'FULL' }, AuthorizationStatus: { REQUIRED: 'REQUIRED' },
      getAuthorizationInfo: () => ({
        getAuthorizationStatus: () => data.authorizationRequired ? 'REQUIRED' : 'NOT_REQUIRED',
        getAuthorizationUrl: () => 'https://script.google.com/authorize-test'
      })
    },
    withUserWriteLock: fn => fn(),
    projectLoadAllPlans: () => [{ issueUrl: 'https://example.backlog.jp/view/DEV-1' }],
    UrlFetchApp: { fetch(url, options) {
      requests.push({ url, options });
      const result = url.includes('users/myself') ? { id: 7, name: '担当者' } : [
        { id: 1, issueKey: 'DEV-1', summary: '設計', status: { id: 2, name: '処理中' }, estimatedHours: 3 },
        { id: 2, issueKey: 'DEV-2', summary: '確認待ち', status: { id: 101, name: 'レビュー中' } },
        { id: 3, issueKey: 'DEV-3', summary: '完了済み', status: { id: 4, name: '完了' } }
      ];
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(result) };
    } }
  };
  vm.createContext(api);
  vm.runInContext(fs.readFileSync('gas/backlog.gs', 'utf8'), api);
  return { api, data, requests };
}

test('Backlogのキーは本人の設定に保存し、応答・URLには含めない', () => {
  const { api, data, requests } = context();
  const saved = api.saveBacklogSettings({ spaceUrl: 'https://example.backlog.jp/', apiKey: 'secret-key' });
  assert.equal(saved.configured, true);
  assert.equal(data.backlogApiKey, 'secret-key');
  assert.equal(JSON.stringify(saved).includes('secret-key'), false);
  assert.equal(requests[0].url.includes('secret-key'), false);
  assert.equal(requests[0].options.headers['Backlog-API-Key'], 'secret-key');
  assert.equal(requests[0].options.followRedirects, false);
  assert.equal(api.saveBacklogSettings({ spaceUrl: 'https://example.backlog.jp', apiKey: '' }).configured, true);
  assert.throws(() => api.saveBacklogSettings({ spaceUrl: 'https://another.backlog.jp', apiKey: '' }), /APIキー/);
  api.clearBacklogSettings();
  assert.equal(api.getBacklogSettings().hasApiKey, false);
  assert.equal(data.backlogApiKey, undefined);
});

test('許可したBacklogドメイン以外へAPIキーを送らない', () => {
  const { api, requests } = context();
  for (const url of ['http://example.backlog.jp', 'https://localhost', 'https://example.backlog.jp.evil.test', 'https://user@example.backlog.jp', 'https://example.backlog.jp:8443/path']) {
    assert.throws(() => api.saveBacklogSettings({ spaceUrl: url, apiKey: 'secret' }), /スペースURL/);
  }
  assert.equal(requests.length, 0);
  assert.equal(api.backlogNormalizeSpace('https://example.backlogtool.com'), 'https://example.backlogtool.com');
});

test('課題やプロジェクトのURLを貼っても、パス・クエリ・ハッシュを除去してスペースURLにする', () => {
  const { api, requests } = context();
  for (const url of [
    ' https://example.backlog.jp/view/DEV-123 ',
    'https://example.backlog.jp/projects/DEV?tab=issues#filter',
    'https://example.backlog.jp///',
    'https://EXAMPLE.backlog.jp?key=x'
  ]) {
    assert.equal(api.backlogNormalizeSpace(url), 'https://example.backlog.jp');
  }
  api.saveBacklogSettings({ spaceUrl: 'https://example.backlog.jp/view/DEV-123', apiKey: 'test-api-key' });
  assert.equal(requests[0].url, 'https://example.backlog.jp/api/v2/users/myself');
});

test('本人の担当課題を取得し、完了を除外し、独自の状態や取り込み済み課題を識別する', () => {
  const { api, data, requests } = context();
  data.backlogSpaceUrl = 'https://example.backlog.jp';
  data.backlogApiKey = 'secret';
  const result = api.listBacklogAssignedIssues({ offset: 100 });
  assert.deepEqual(Array.from(result.issues, issue => issue.key), ['DEV-1', 'DEV-2']);
  assert.equal(result.issues[0].imported, true);
  assert.equal(result.issues[1].estimatedHours, null);
  assert.match(requests[1].url, /assigneeId%5B%5D=7/);
  assert.match(requests[1].url, /offset=100/);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.throws(() => api.listBacklogAssignedIssues({ offset: -1 }), /取得位置/);
});

test('取得に失敗してもBacklogの応答本文やAPIキーをエラーに出さない', () => {
  const { api, data } = context();
  data.backlogSpaceUrl = 'https://example.backlog.jp'; data.backlogApiKey = 'secret';
  api.UrlFetchApp.fetch = () => ({ getResponseCode: () => 429, getContentText: () => 'secret' });
  assert.throws(() => api.listBacklogAssignedIssues({}), error => /上限/.test(error.message) && !error.message.includes('secret'));
  api.UrlFetchApp.fetch = () => { throw new Error('secret'); };
  assert.throws(() => api.listBacklogAssignedIssues({}), error => /接続できません/.test(error.message) && !error.message.includes('secret'));
});

test('外部接続が未許可なら本人の設定に仮保存し、承認先を返してAPI通信をしない', () => {
  const { api, data, requests } = context();
  data.authorizationRequired = true;
  const result = api.saveBacklogSettings({ spaceUrl: 'https://example.backlog.jp', apiKey: 'secret' });
  assert.equal(result.authorizationRequired, true);
  assert.equal(result.authorizationUrl, 'https://script.google.com/authorize-test');
  assert.equal(requests.length, 0);
  assert.equal(data.backlogApiKey, undefined);
  assert.equal(data.backlogPendingSpaceUrl, 'https://example.backlog.jp');
  assert.equal(data.backlogPendingApiKey, 'secret');
  assert.equal(result.spaceUrl, 'https://example.backlog.jp');
  assert.equal(result.hasApiKey, true);
  assert.equal(result.pending, true);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('接続失敗でも入力を仮保存し、確認済みのキーを壊さず、空欄で再試行できる', () => {
  const { api, data, requests } = context();
  data.backlogSpaceUrl = 'https://old.backlog.jp';
  data.backlogApiKey = 'old-key';
  const fetch = api.UrlFetchApp.fetch;
  api.UrlFetchApp.fetch = () => { throw new Error('DNS error'); };
  assert.throws(() => api.saveBacklogSettings({ spaceUrl: 'https://new.backlog.jp', apiKey: 'new-key' }), /接続先を見つけられません/);
  const settings = api.getBacklogSettings();
  assert.equal(settings.spaceUrl, 'https://new.backlog.jp');
  assert.equal(settings.hasApiKey, true);
  assert.equal(settings.pending, true);
  assert.equal(settings.configured, false);
  assert.equal(JSON.stringify(settings).includes('new-key'), false);
  assert.equal(data.backlogApiKey, 'old-key');
  api.UrlFetchApp.fetch = fetch;
  assert.equal(api.saveBacklogSettings({ spaceUrl: 'https://new.backlog.jp', apiKey: '' }).configured, true);
  assert.equal(requests[0].options.headers['Backlog-API-Key'], 'new-key');
  assert.equal(data.backlogApiKey, 'new-key');
  assert.equal(data.backlogPendingApiKey, undefined);
});

test('APIキーの空白や全角文字を通信前に検出する', () => {
  const { api, requests } = context();
  for (const key of ['abc def', 'abc\ndef', '全角キー']) {
    assert.throws(() => api.saveBacklogSettings({ spaceUrl: 'https://example.backlog.jp', apiKey: key }), /空白・改行・全角文字/);
  }
  assert.equal(requests.length, 0);
});

test('権限不足・DNS・証明書・タイムアウトを区別し、例外の秘密値は出さない', () => {
  const { api } = context();
  const cases = [
    ['You do not have permission to call UrlFetchApp.fetch. script.external_request secret', /Google側.*許可/],
    ['DNS error: secret', /接続先を見つけられません/],
    ['SSL certificate error secret', /暗号化通信/],
    ['Connection timed out secret', /タイムアウト/],
    ['Service invoked too many times secret', /利用上限/],
    ['Invalid header value secret', /APIキーを送信できません/]
  ];
  for (const [message, expected] of cases) {
    api.UrlFetchApp.fetch = () => { throw new Error(message); };
    assert.throws(() => api.backlogGet_('https://example.backlog.jp', 'secret', 'users/myself', {}), error => expected.test(error.message) && !error.message.includes('secret'));
  }
});

test('100件を超える一覧の続きを取得できる', () => {
  const { api, data } = context();
  data.backlogSpaceUrl = 'https://example.backlog.jp'; data.backlogApiKey = 'secret';
  api.UrlFetchApp.fetch = url => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(url.includes('users/myself') ? { id: 7 } : Array.from({length: 100}, (_, i) => ({id:i + 1, issueKey:'DEV-' + i, summary:'課題', status:{id:1}}))) });
  const result = api.listBacklogAssignedIssues({offset:0});
  assert.equal(result.hasMore, true);
  assert.equal(result.nextOffset, 100);
});

test('選択したBacklog課題を一度だけ取り込み、予定工数のない課題は0・期間未定にする', () => {
  const items = [];
  const api = {
    state: { view: 'planning', planner: { key: '2026-W44' }, weekSnapshot: {} },
    plannerItems: () => items, defaultAssignedProjectId: () => 'project-1',
    isViewYmd: value => /^\d{4}-\d{2}-\d{2}$/.test(value), roundHours: value => Number(value) || 0,
    uid: () => 'plan-' + items.length, nextPlanPriority: () => (items.length + 1) * 1024,
    document: { getElementById: () => ({}) }, hideAppDialog() {}, markPlannerChanged() {}, updatePlannerSummary() {}, toast() {}
  };
  vm.createContext(api);
  vm.runInContext(fs.readFileSync('ui/backlog.js', 'utf8'), api);
  vm.runInContext("backlogImport.weekKey='2026-W44';backlogImport.issues=[{id:'1',key:'DEV-1',title:'設計',url:'https://example.backlog.jp/view/DEV-1',estimatedHours:null}];backlogImport.selected.add('1');", api);
  api.addBacklogSelectedIssues();
  api.addBacklogSelectedIssues();
  assert.equal(items.length, 1);
  assert.equal(items[0].planned, 0);
  assert.equal(items[0].undated, true);
  assert.equal(items[0].projectId, 'project-1');
});

test('本人のIDは控えておき、課題の取得のたびに問い合わせず、未設定は例外にせず知らせる', () => {
  const { api, data, requests } = context();
  assert.equal(api.listBacklogAssignedIssues({}).needsSetup, true);
  assert.equal(requests.length, 0);
  data.backlogSpaceUrl = 'https://example.backlog.jp';
  data.backlogApiKey = 'secret';
  api.listBacklogAssignedIssues({ offset: 0 });
  assert.equal(requests.filter(request => request.url.includes('users/myself')).length, 1);
  api.listBacklogAssignedIssues({ offset: 0 });
  assert.equal(requests.filter(request => request.url.includes('users/myself')).length, 1, '2回目は本人情報を取り直さない');
  api.clearBacklogSettings();
  assert.equal(data.backlogUserId == null, true);
});

function backlogDiffApi(items) {
  const source = fs.readFileSync('ui/backlog.js', 'utf8');
  const from = source.indexOf('    // 取り込み済みの予定と、Backlogの今の値との差');
  const to = source.indexOf('    function renderBacklogIssues()');
  const toasts = [];
  const api = {
    plannerItems: () => items, isViewYmd: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)),
    roundHours: value => Math.round((Number(value) || 0) * 4) / 4, compactHours: value => String(Math.round((Number(value) || 0) * 4) / 4),
    shortYmdLabel: value => Number(value.slice(5, 7)) + '/' + Number(value.slice(8, 10)),
    escapeHtml: value => String(value), markPlannerChanged: () => { api.changed = true; }, updatePlannerSummary() {}, renderBacklogIssues() {},
    toast: (message, kind) => toasts.push([message, kind]), plannerSubtasksForItem: () => [], issueHoursExceedPlan: (planned, sub) => sub > planned,
    backlogImport: { issues: [] }, toasts, changed: false
  };
  vm.createContext(api);
  vm.runInContext(source.slice(from, to), api);
  return api;
}

test('取り込み済みの予定とBacklogの予定工数・期間の差を出し、反映できる', () => {
  const item = { id: 'plan-1', name: 'DEV-1 件名', issueUrl: 'https://example.backlog.jp/view/DEV-1', planned: 6, estimatedTotal: 6, startDate: '2026-10-27', endDate: '2026-10-30', undated: false };
  const api = backlogDiffApi([item]);
  const issue = { id: '1', url: item.issueUrl, estimatedHours: 8, startDate: '2026-10-27', dueDate: '2026-11-05' };
  api.backlogImport.issues = [issue];
  const diffs = api.backlogIssueDiff(issue, item);
  assert.deepEqual(Array.from(diffs, diff => diff.label), ['予定工数', '期間']);
  assert.equal(diffs[0].to, '8h');
  assert.equal(diffs[1].to, '10/27〜11/5');
  api.applyBacklogIssueToPlan('1');
  assert.equal(item.planned, 8);
  assert.equal(item.estimatedTotal, 8);
  assert.equal(item.endDate, '2026-11-05');
  assert.equal(api.changed, true);
  assert.equal(api.backlogIssueDiff(issue, item).length, 0, '反映後は差がない');
});

test('Backlogに予定工数・期間がなければ、手で入れた値を差にせず上書きしない', () => {
  const item = { planned: 5, startDate: '2026-10-27', endDate: '2026-10-28', undated: false };
  const api = backlogDiffApi([item]);
  assert.equal(api.backlogIssueDiff({ estimatedHours: null, startDate: '', dueDate: '' }, item).length, 0);
  assert.equal(api.backlogIssueDiff({ estimatedHours: 5, startDate: '', dueDate: '2026-10-28' }, item).length, 1, '期限だけなら期間は1日になる');
});

test('サブタスクの合計がBacklogの予定工数を超えるときは反映しない', () => {
  const item = { id: 'p', name: 'x', issueUrl: 'u', planned: 10, estimatedTotal: 10, startDate: '', endDate: '', undated: true };
  const api = backlogDiffApi([item]);
  api.plannerSubtasksForItem = () => [{ plannedHours: 6 }, { plannedHours: 3 }];
  api.backlogImport.issues = [{ id: '1', url: 'u', estimatedHours: 4, startDate: '', dueDate: '' }];
  api.applyBacklogIssueToPlan('1');
  assert.equal(item.planned, 10);
  assert.equal(api.toasts[0][1], 'error');
});

test('Backlogのプロジェクトとアプリのプロジェクトの割り当てを保存し、課題に付けて返す', () => {
  const { api, data } = context();
  data.backlogSpaceUrl = 'https://example.backlog.jp';
  data.backlogApiKey = 'secret';
  assert.deepEqual(JSON.parse(JSON.stringify(api.saveBacklogProjectMap({ map: { DEV: 'project-a', BAD: '' } }))), { map: { DEV: 'project-a' } });
  assert.throws(() => api.saveBacklogProjectMap({ map: { 'a b': 'x' } }), /不正/);
  assert.equal(api.backlogProjectKeyOfIssue_('DEMO_APP_WEB-34'), 'DEMO_APP_WEB');
  const result = api.listBacklogAssignedIssues({});
  assert.equal(result.issues[0].appProjectId, 'project-a');
  assert.equal(result.issues[1].appProjectId, 'project-a', '同じプロジェクトの課題には同じ割り当てが付く');
  api.saveBacklogProjectMap({ map: {} });
  assert.equal(api.listBacklogAssignedIssues({}).issues[0].appProjectId, '', '割り当てを外すと付かない');
});
