const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('ヘッダーのアイコン・タブのfavicon・インストール時のアイコンを同じ画像にそろえる', () => {
  const server = fs.readFileSync('gas/code.gs', 'utf8');
  const css = fs.readFileSync('ui/styles.css', 'utf8');
  const url = /const APP_ICON_URL = "([^"]+)"/.exec(server)[1];
  assert.match(server, /\.setFaviconUrl\(APP_ICON_URL\)/);
  assert.match(server, /icons: \[\s*\{ src: APP_ICON_URL/);
  assert.ok(css.includes('url("' + url + '")'), 'ヘッダーのアイコンも同じURL');
  assert.doesNotMatch(css, /\.brand::before \{[^}]*content: '工'/);
});
