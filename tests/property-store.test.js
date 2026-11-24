const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function context() {
  const data = { existingSetting: 'keep' };
  const calls = [];
  const properties = {
    getProperties: () => ({ ...data }),
    setProperties(values, deleteAllOthers) {
      assert.equal(typeof deleteAllOthers, 'boolean', 'GoogleのAPIは第2引数にnull/undefinedを受け付けない');
      calls.push(deleteAllOthers);
      if (deleteAllOthers) for (const key of Object.keys(data)) delete data[key];
      Object.assign(data, values);
    },
    deleteProperty(key) { delete data[key]; }
  };
  const api = {
    APP_PROPERTY_STORES: {},
    PropertiesService: { getUserProperties: () => properties },
    withUserWriteLock: callback => callback(),
    ScriptApp: {
      AuthMode: { FULL: 'FULL' }, AuthorizationStatus: { REQUIRED: 'REQUIRED' },
      getAuthorizationInfo: () => ({ getAuthorizationStatus: () => 'NOT_REQUIRED' })
    },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{"id":1,"name":"担当者"}' }) }
  };
  vm.createContext(api);
  const code = fs.readFileSync('gas/code.gs', 'utf8');
  vm.runInContext(
    code.slice(code.indexOf('function appUserProperties()'), code.indexOf('function appScriptProperties()')) +
    code.slice(code.indexOf('function appPropertyStore(kind)'), code.indexOf('function refreshAppPropertyStores()')),
    api
  );
  vm.runInContext(fs.readFileSync('gas/backlog.gs', 'utf8'), api);
  return { api, data, calls };
}

test('プロパティ一括保存は第2引数を省略してもfalseを渡し、既存設定を残す', () => {
  const { api, data, calls } = context();
  const store = api.appUserProperties();
  assert.equal(store.getProperty('existingSetting'), 'keep');
  store.setProperties({ newSetting: 'saved' });
  assert.deepEqual(calls, [false]);
  assert.equal(data.existingSetting, 'keep');
  assert.equal(store.getProperty('newSetting'), 'saved', '保存後は読み込み済みの控えも更新する');
  store.setProperties({ otherSetting: 'saved' }, false);
  assert.equal(data.newSetting, 'saved');
  store.setProperties({ onlySetting: 'saved' }, true);
  assert.deepEqual(calls, [false, false, true]);
  assert.deepEqual(data, { onlySetting: 'saved' });
});

test('実際のプロパティラッパー経由でもBacklogの仮保存と接続設定保存が成功する', () => {
  const { api, data, calls } = context();
  const result = api.saveBacklogSettings({ spaceUrl: 'https://example.backlog.jp/', apiKey: 'test-api-key' });
  assert.equal(result.configured, true);
  assert.equal(data.backlogSpaceUrl, 'https://example.backlog.jp');
  assert.equal(data.backlogApiKey, 'test-api-key');
  assert.equal(data.existingSetting, 'keep');
  assert.equal(data.backlogPendingApiKey, undefined);
  assert.deepEqual(calls, [false, false]);
});
