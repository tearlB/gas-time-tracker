const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

// 1つの括弧の閉じ忘れ・余りがあると、画面全体が動かなくなる。個別の関数を取り出すテストでは気づけないので、
// 配信する gas/index.html の中のスクリプトを、実行せずに構文だけ確かめる。
test('gas/index.html のインラインスクリプトは、すべて構文として正しい', () => {
  const html = fs.readFileSync('gas/index.html', 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(code => code.trim());
  assert.ok(scripts.length > 0, 'スクリプトが見つかる');
  scripts.forEach((code, index) => {
    assert.doesNotThrow(() => new vm.Script(code, { filename: 'gas/index.html#script' + (index + 1) }), 'script ' + (index + 1));
  });
});
