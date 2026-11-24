const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function createUi() {
  const elements = {};
  const requests = [];
  // 割り当て一覧の自動読み込みは、接続設定の呼び出し順と分けて記録する。
  const projectListRequests = [];
  const api = {
    document: { getElementById(id) {
      return elements[id] || (elements[id] = { value: '', disabled: false, listeners: {},
        addEventListener(name, listener) { this.listeners[name] = listener; },
        removeAttribute(name) { delete this[name]; },
        focus() {}
      });
    } },
    gas(name, payload) {
      if (name === 'listBacklogProjects') return new Promise((resolve, reject) => projectListRequests.push({ resolve, reject }));
      return new Promise((resolve, reject) => requests.push({ name, payload: payload && { ...payload }, resolve, reject }));
    },
    toast() {}
  };
  vm.createContext(api);
  vm.runInContext(fs.readFileSync('ui/backlog.js', 'utf8'), api);
  api.wireBacklog();
  function input(id, value) {
    elements[id].value = value;
    elements[id].listeners.input.call(elements[id]);
  }
  return { api, elements, requests, projectListRequests, input };
}

test('接続済みなら設定を開いたときにBacklogのプロジェクト一覧を自動で読み込む', async () => {
  const { api, requests, projectListRequests } = createUi();
  const loading = api.loadBacklogSettings();
  requests[0].resolve({ spaceUrl: 'https://example.backlog.jp', hasApiKey: true, configured: true });
  await loading;
  assert.equal(projectListRequests.length, 1);
});

test('未接続なら一覧を読みに行かない', async () => {
  const { api, requests, projectListRequests } = createUi();
  const loading = api.loadBacklogSettings();
  requests[0].resolve({ spaceUrl: '', hasApiKey: false, configured: false });
  await loading;
  assert.equal(projectListRequests.length, 0);
});

test('読み込み中の入力と、設定タブを開き直したときの未保存入力を消さない', async () => {
  const { api, elements, requests, input } = createUi();
  const loading = api.loadBacklogSettings();
  input('backlogSpaceUrl', 'https://new.backlog.jp');
  input('backlogApiKey', 'test-api-key');
  requests[0].resolve({ spaceUrl: 'https://old.backlog.jp', hasApiKey: true, configured: true });
  await loading;
  assert.equal(elements.backlogSpaceUrl.value, 'https://new.backlog.jp');
  assert.equal(elements.backlogApiKey.value, 'test-api-key');
  const reopening = api.loadBacklogSettings();
  requests[1].resolve({ spaceUrl: 'https://old.backlog.jp', hasApiKey: true, configured: true });
  await reopening;
  assert.equal(elements.backlogSpaceUrl.value, 'https://new.backlog.jp');
  assert.equal(elements.backlogApiKey.value, 'test-api-key');
});

test('保存失敗時はAPIキーを残し、入力し直さずに再試行できる', async () => {
  const { api, elements, requests, input } = createUi();
  input('backlogSpaceUrl', 'https://new.backlog.jp');
  input('backlogApiKey', 'test-api-key');
  const saving = api.saveBacklogConnection();
  assert.equal(elements.backlogApiKey.value, 'test-api-key');
  assert.equal(elements.backlogApiKey.disabled, true);
  requests[0].reject(new Error('一時的な接続失敗'));
  await saving;
  assert.equal(elements.backlogApiKey.value, 'test-api-key');
  assert.equal(elements.backlogApiKey.disabled, false);
  const retry = api.saveBacklogConnection();
  assert.equal(requests[1].payload.apiKey, 'test-api-key');
  requests[1].resolve({ spaceUrl: 'https://new.backlog.jp', hasApiKey: true, configured: true });
  await retry;
  assert.equal(elements.backlogApiKey.value, '********');
  assert.equal(elements.backlogApiKey.readOnly, true);
  assert.match(elements.backlogApiKey.placeholder, /登録済み/);
  assert.equal(elements.clearBacklogSettings.disabled, false);
});

test('保存開始前の古い読み込み応答で入力欄や保存結果を上書きしない', async () => {
  const { api, elements, requests, input } = createUi();
  const loading = api.loadBacklogSettings();
  input('backlogSpaceUrl', 'https://new.backlog.jp');
  input('backlogApiKey', 'test-api-key');
  const saving = api.saveBacklogConnection();
  requests[1].resolve({ spaceUrl: 'https://new.backlog.jp', hasApiKey: true, configured: true });
  await saving;
  requests[0].resolve({ spaceUrl: '', hasApiKey: false, configured: false });
  await loading;
  assert.equal(elements.backlogSpaceUrl.value, 'https://new.backlog.jp');
  assert.match(elements.backlogApiKey.placeholder, /登録済み/);
  assert.equal(elements.clearBacklogSettings.disabled, false);
});

test('連打による重複保存や、保存と削除の同時実行を防ぐ', async () => {
  const { api, requests, input } = createUi();
  input('backlogSpaceUrl', 'https://new.backlog.jp');
  input('backlogApiKey', 'test-api-key');
  const saving = api.saveBacklogConnection();
  await api.saveBacklogConnection();
  await api.clearBacklogConnection();
  await api.loadBacklogSettings();
  assert.equal(requests.length, 1);
  requests[0].resolve({ spaceUrl: 'https://new.backlog.jp', hasApiKey: true, configured: true });
  await saving;
});

test('Google側の許可が必要な場合はリンクを表示し、APIキーを消さない', async () => {
  const { api, elements, requests, input } = createUi();
  input('backlogSpaceUrl', 'https://new.backlog.jp');
  input('backlogApiKey', 'test-api-key');
  const saving = api.saveBacklogConnection();
  requests[0].resolve({ spaceUrl: '', configured: false, hasApiKey: false, authorizationRequired: true, authorizationUrl: 'https://script.google.com/authorize-test' });
  await saving;
  assert.equal(elements.backlogApiKey.value, 'test-api-key');
  assert.equal(elements.backlogSpaceUrl.value, 'https://new.backlog.jp');
  assert.equal(elements.authorizeBacklog.hidden, false);
  assert.equal(elements.authorizeBacklog.href, 'https://script.google.com/authorize-test');
  assert.equal(elements.saveBacklogSettings.disabled, false);
  assert.match(elements.backlogConnectionStatus.textContent, /Google側.*許可/);
});

test('設定削除の成功後にだけ入力欄を空にし、遅い読み込みで復活させない', async () => {
  const { api, elements, requests, input } = createUi();
  api.renderBacklogSettings({ spaceUrl: 'https://old.backlog.jp', hasApiKey: true, configured: true });
  input('backlogApiKey', 'test-api-key');
  const loading = api.loadBacklogSettings();
  const clearing = api.clearBacklogConnection();
  assert.equal(elements.backlogApiKey.value, 'test-api-key');
  requests[1].resolve({ spaceUrl: '', hasApiKey: false, configured: false });
  await clearing;
  requests[0].resolve({ spaceUrl: 'https://old.backlog.jp', hasApiKey: true, configured: true });
  await loading;
  assert.equal(elements.backlogSpaceUrl.value, '');
  assert.equal(elements.backlogApiKey.value, '');
  assert.equal(elements.clearBacklogSettings.disabled, true);
});

test('再読み込み後は仮保存したURLとキーの伏せ字を復元し、入力し直さず接続を再試行する', async () => {
  const { api, elements, requests } = createUi();
  const loading = api.loadBacklogSettings();
  requests[0].resolve({ spaceUrl: 'https://new.backlog.jp', hasApiKey: true, configured: false, pending: true });
  await loading;
  assert.equal(elements.backlogSpaceUrl.value, 'https://new.backlog.jp');
  assert.equal(elements.backlogApiKey.value, '********');
  assert.equal(elements.backlogApiKey.readOnly, true);
  assert.match(elements.backlogApiKey.supportingText, /保存済み/);
  const retry = api.saveBacklogConnection();
  assert.equal(requests[1].payload.apiKey, '', '伏せ字をAPIキーとして送信しない');
  requests[1].resolve({ spaceUrl: 'https://new.backlog.jp', hasApiKey: true, configured: true });
  await retry;
  assert.equal(elements.backlogApiKey.value, '********');
  elements.editBacklogApiKey.listeners.click.call(elements.editBacklogApiKey);
  assert.equal(elements.backlogApiKey.value, '', '変更を始めると伏せ字は消える');
  assert.equal(elements.backlogApiKey.readOnly, false);
  assert.equal(elements.cancelBacklogApiKeyEdit.hidden, false);
  elements.cancelBacklogApiKeyEdit.listeners.click.call(elements.cancelBacklogApiKeyEdit);
  assert.equal(elements.backlogApiKey.value, '********', '変更をやめると元の表示に戻る');
  assert.equal(elements.backlogApiKey.readOnly, true);
  assert.equal(elements.editBacklogApiKey.hidden, false);
});

test('入力確定時と保存時にBacklogのURLをドメインまでに揃える', async () => {
  const { api, elements, requests, input } = createUi();
  input('backlogSpaceUrl', ' https://example.backlog.jp/// ');
  elements.backlogSpaceUrl.listeners.change();
  assert.equal(elements.backlogSpaceUrl.value, 'https://example.backlog.jp');
  input('backlogSpaceUrl', ' https://example.backlog.jp/view/DEV-123?foo=bar#details ');
  input('backlogApiKey', 'test-api-key');
  const saving = api.saveBacklogConnection();
  assert.equal(elements.backlogSpaceUrl.value, 'https://example.backlog.jp');
  assert.equal(requests[0].payload.spaceUrl, 'https://example.backlog.jp');
  requests[0].resolve({ spaceUrl: 'https://example.backlog.jp', hasApiKey: true, configured: true });
  await saving;
});
