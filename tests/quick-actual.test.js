const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const template = fs.readFileSync('ui/index.template.html', 'utf8');
const source = fs.readFileSync('ui/quick_actual.js', 'utf8');

test('今日の実績パネルは、ヘッダーのボタンとパネル本体、アイコンを持つ', () => {
  assert.match(template, /id="quickActualButton"/);
  assert.match(template, /id="quickActualPanel"[^>]*hidden/);
  const names = /icon_names=([a-z_,]+)/.exec(template)[1].split(',');
  assert.ok(names.includes('edit_note'));
  assert.deepEqual(names, names.slice().sort());
});

test('今日の実績パネルは日次の行へ操作を渡し、別の保存経路を持たない', () => {
  assert.doesNotMatch(source, /saveToSpreadsheet/, '保存は日次画面と同じ処理に任せる');
  assert.match(source, /setDailyRowField\(el\.querySelector\('\.today-value'\)/, '時間は日次の行の入力欄へ渡す');
  assert.match(source, /openCandidates\('imports'\)/);
  assert.match(source, /openCandidates\('interrupt'\)/);
  assert.match(source, /quickActualDailyIsOtherDate/, '日次画面が今日以外を開いているときは扱わない');
  assert.match(template, /class="quick-add-issue"/);
  assert.match(template, /class="quick-add-today"/);
});

test('今日の実績パネルは日次の名前変更・状態・並べ替え・追加ボタン設定に沿う', () => {
  assert.match(source, /setDailyRowField\(nameRow\.querySelector\('\.interrupt-name'\)/, '名前は日次の入力欄へ渡す');
  assert.match(source, /querySelector\('\.interrupt-name'\), event\.target\.value, true\)/, '確定は日次のchangeを起こす（カレンダー行は今日だけの作業へ変わる）');
  assert.match(source, /querySelector\('\.daily-status'\)/, '状態は日次の表示を読む');
  assert.match(source, /moveQuickActualRow/);
  assert.match(source, /markDailyDirty\(\);\s*renderQuickActual/, '並べ替えは日次の変更として扱う');
  assert.doesNotMatch(source, /dailyAddIssue/, '追加ボタンを隠す設定はなくなった');
});

test('ショートカットキーは設定で割り当て、重複や不正なキーは使わない', () => {
  const source = fs.readFileSync('ui/settings.js', 'utf8');
  const from = source.indexOf('    const SHORTCUT_ACTIONS');
  const to = source.indexOf('    function persistUiPreferences', from);
  const context = { state: { uiPreferences: null } };
  require('node:vm').createContext(context);
  require('node:vm').runInContext(source.slice(from, to), context);
  assert.equal(context.normalizeShortcutKey(' T '), 't');
  assert.equal(context.normalizeShortcutKey('ab'), '');
  assert.equal(context.normalizeShortcutKey('F5'), '');
  const defaults = context.readShortcutPreferences({});
  assert.equal(defaults.today, 't');
  assert.equal(defaults.quickActual, 'a');
  const clashed = context.readShortcutPreferences({ shortcuts: { day: 'x', week: 'x', today: '' } });
  assert.equal(clashed.day, 'x');
  assert.equal(clashed.week, '', '同じキーは先の操作だけが使う');
  assert.equal(clashed.today, '', '空は使わない設定として残す');
  context.state.uiPreferences = { shortcuts: { day: 'x', week: '', month: 'm', projects: 'p', today: 't', quickActual: 'a' }, shortcutsEnabled: true };
  assert.equal(context.shortcutActionForKey('T'), 'today');
  assert.equal(context.shortcutActionForKey('w'), '');
  context.state.uiPreferences.shortcutsEnabled = false;
  assert.equal(context.shortcutActionForKey('t'), '');
});

test('ブラウザの控えはアカウントごとに分け、分ける前の控えは最初のアカウントへ引き継ぐ', () => {
  const source = fs.readFileSync('ui/core.js', 'utf8');
  const from = source.indexOf('    const USER_SCOPE_RAW');
  const to = source.indexOf('    const TIMER_KEY', from);
  const run = (scope, store) => {
    const context = { localStorage: { getItem: key => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); }, removeItem: key => { delete store[key]; } } };
    require('node:vm').createContext(context);
    require('node:vm').runInContext(source.slice(from, to).replace('<?= getUserStorageScope() ?>', scope) + ';this.scopedStorageKey = scopedStorageKey;', context);
    return context;
  };
  const store = { 'matomete-kousu-nav-v1': '{"a":1}' };
  const first = run('0123456789abcdef', store);
  assert.equal(first.scopedStorageKey('matomete-kousu-nav-v1'), 'matomete-kousu-nav-v1:0123456789abcdef');
  assert.equal(store['matomete-kousu-nav-v1:0123456789abcdef'], '{"a":1}');
  assert.equal('matomete-kousu-nav-v1' in store, false, '元の場所からは消す');
  run('fedcba9876543210', store);
  assert.equal('matomete-kousu-nav-v1:fedcba9876543210' in store, false, '別のアカウントには引き継がない');
  assert.equal(run('', {}).scopedStorageKey('x'), 'x', '識別子が取れないときは従来どおり');
});

test('ブラウザの控えはアカウントごとに分け、分ける前の控えは最初のアカウントへ引き継ぐ', () => {
  const source = fs.readFileSync('ui/core.js', 'utf8');
  const from = source.indexOf('    const USER_SCOPE_RAW');
  const to = source.indexOf('    const TIMER_KEY', from);
  const run = (scope, store) => {
    const context = { localStorage: { getItem: key => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); }, removeItem: key => { delete store[key]; } } };
    require('node:vm').createContext(context);
    require('node:vm').runInContext(source.slice(from, to).replace('<?= getUserStorageScope() ?>', scope) + ';this.scopedStorageKey = scopedStorageKey;', context);
    return context;
  };
  const store = { 'matomete-kousu-nav-v1': '{"a":1}' };
  const first = run('0123456789abcdef', store);
  assert.equal(first.scopedStorageKey('matomete-kousu-nav-v1'), 'matomete-kousu-nav-v1:0123456789abcdef');
  assert.equal(store['matomete-kousu-nav-v1:0123456789abcdef'], '{"a":1}');
  assert.equal('matomete-kousu-nav-v1' in store, false, '元の場所からは消す');
  run('fedcba9876543210', store);
  assert.equal('matomete-kousu-nav-v1:fedcba9876543210' in store, false, '別のアカウントには引き継がない');
  assert.equal(run('', {}).scopedStorageKey('x'), 'x', '識別子が取れないときは従来どおり');
});
