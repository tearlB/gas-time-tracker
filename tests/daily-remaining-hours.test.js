const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('ui/daily.js', 'utf8');
const start = source.indexOf('    function syncDailyRowSyncedHours(');
const end = source.indexOf('    function syncDailyRowIssueField(', start);

function renderRemaining(type, previous, estimate, today) {
  const classes = new Set();
  const remaining = {
    hidden: true,
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
  const row = {
    dataset: { type, previous, estimate },
    querySelector(selector) {
      if (selector === '.today-value') return { value: today };
      if (selector === '.daily-remaining') return remaining;
      return null;
    }
  };
  const context = {
    document: { querySelector: () => null },
    numericHours: value => Math.max(0, Number(value) || 0),
    hours: value => Number(value).toFixed(2),
    liveHours: value => String(value)
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  context.syncDailyRowSyncedHours(row);
  return remaining;
}

test('今日だけの実績も残り工数0.00を表示し、空欄にしない', () => {
  for (const today of [0, 1.25, 3]) {
    const value = renderRemaining('interrupt', 4, 8, today);
    assert.equal(value.textContent, '0.00');
    assert.equal(value.hidden, false);
    assert.equal(value.classList.contains('is-over'), false);
  }
});

test('予定の残り工数は本日の入力を含めて計算し、超過は負数にする', () => {
  assert.equal(renderRemaining('saved', 2, 8, 1.25).textContent, '4.75');
  assert.equal(renderRemaining('saved', 2, 8, 6).textContent, '0.00');
  const over = renderRemaining('saved', 2, 8, 7);
  assert.equal(over.textContent, '-1.00');
  assert.equal(over.classList.contains('is-over'), true);
});

test('予定0hでも実績があれば、その分をマイナスで表示する', () => {
  const value = renderRemaining('saved', 0.5, 0, 1);
  assert.equal(value.textContent, '-1.50');
  assert.equal(value.hidden, false);
  assert.equal(value.classList.contains('is-over'), true);
});

test('予定工数も実績もない場合はダッシュを表示する', () => {
  const value = renderRemaining('saved', 0, 0, 0);
  assert.equal(value.textContent, '—');
  assert.equal(value.hidden, false);
});
