const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function htmlOutput(kind, content) {
  const output = { kind: kind, content: content || '', setTitle() { return output; }, setFaviconUrl() { return output; }, addMetaTag() { return output; } };
  return output;
}

function loadServer(status) {
  const context = {
    console,
    ScriptApp: {
      AuthMode: { FULL: 'FULL' },
      AuthorizationStatus: { REQUIRED: 'REQUIRED', NOT_REQUIRED: 'NOT_REQUIRED' },
      getAuthorizationInfo() {
        if (status === 'throw') throw new Error('unavailable');
        return { getAuthorizationStatus: () => status, getAuthorizationUrl: () => 'https://script.google.com/auth?a=1&b="x"' };
      },
      getService() { return { getUrl: () => 'https://script.google.com/a/macros/example/s/abc/exec' }; }
    },
    HtmlService: {
      createHtmlOutput(content) { return htmlOutput('gate', content); },
      createTemplateFromFile() { return { evaluate: () => htmlOutput('app') }; }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/code.gs', 'utf8'), context);
  return context;
}

test('権限が足りないときは、アプリの代わりに許可をやり直す画面を出す', () => {
  const page = loadServer('REQUIRED').doGet({ parameter: {} });
  assert.equal(page.kind, 'gate');
  assert.match(page.content, /アクセスの許可が必要です/);
  assert.match(page.content, /href="https:\/\/script\.google\.com\/auth\?a=1&amp;b=&quot;x&quot;" target="_blank"/);
  assert.match(page.content, /href="https:\/\/script\.google\.com\/a\/macros\/example\/s\/abc\/exec" target="_top">開き直す/);
});

test('許可済み、または確かめられないときは、そのままアプリを開く', () => {
  assert.equal(loadServer('NOT_REQUIRED').doGet({ parameter: {} }).kind, 'app');
  assert.equal(loadServer('throw').doGet({ parameter: {} }).kind, 'app');
});
