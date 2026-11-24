const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 共有の場所（ScriptProperties）と人ごとの場所（UserProperties）を別々に持つモック。
function createContext({ shared, user, me, owner }) {
  const store = values => {
    const map = new Map(Object.entries(values || {}));
    return {
      map,
      getProperty: key => (map.has(key) ? map.get(key) : null),
      getProperties: () => Object.fromEntries(map),
      setProperty: (key, value) => { map.set(key, String(value)); },
      setProperties: (values) => { Object.entries(values).forEach(([key, value]) => map.set(key, String(value))); },
      deleteProperty: key => { map.delete(key); }
    };
  };
  const scriptStore = store(shared);
  const userStore = store(user);
  const context = {
    console,
    PropertiesService: { getScriptProperties: () => scriptStore, getUserProperties: () => userStore },
    Session: { getEffectiveUser: () => ({ getEmail: () => me }) },
    DriveApp: { getFolderById: () => ({ getOwner: () => (owner ? { getEmail: () => owner } : null) }) }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/code.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('gas/legacy.gs', 'utf8'), context);
  return { context, scriptStore, userStore };
}
const SHARED = { appStorageFolderId: 'folder-1', appStorageMode: 'annual', appStorageYearFiles: '{"2026":"sheet2026"}' };

test('共有の場所に古い保存先の設定が残っていても読まず、未設定として自分で選んでもらう', () => {
  const { context, userStore } = createContext({ shared: SHARED, user: {}, me: 'me@example.com', owner: 'me@example.com' });
  assert.equal(context.isAnnualStorage(), false);
  assert.deepEqual(Object.keys(context.getAnnualStorageFileMap()), []);
  assert.equal(userStore.getProperty('appStorageFolderId'), null);
});

test('保存先の設定は自分の場所にだけ書き、共有の場所は変えない', () => {
  const { context, userStore, scriptStore } = createContext({ shared: SHARED, user: {}, me: 'other@example.com', owner: 'me@example.com' });
  context.setAnnualStorageFileMap({ 2026: 'mine2026' });
  assert.equal(userStore.getProperty('appStorageYearFiles'), '{"2026":"mine2026"}');
  assert.equal(scriptStore.getProperty('appStorageYearFiles'), '{"2026":"sheet2026"}');
});

test('自分の保存先の設定があれば、それを使う', () => {
  const { context } = createContext({ shared: SHARED, user: { appStorageFolderId: 'mine', appStorageMode: 'annual', appStorageYearFiles: '{"2026":"mine2026"}' }, me: 'me@example.com', owner: 'me@example.com' });
  assert.equal(context.isAnnualStorage(), true);
  assert.equal(context.getAnnualStorageFileMap()['2026'], 'mine2026');
});
