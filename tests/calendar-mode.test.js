const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const core = fs.readFileSync('ui/core.js', 'utf8');
function slice(start, end) {
  const from = core.indexOf(start);
  const to = core.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return core.slice(from, to);
}

function createContext(state) {
  const context = {
    state,
    isViewYmd: value => /^\d{4}-\d{2}-\d{2}$/.test(value),
    isProjectMonthKey: value => /^\d{4}-\d{2}$/.test(value),
    isViewWeekKey: value => /^\d{4}-W\d{2}$/.test(value),
    ymd: date => date.toISOString().slice(0, 10),
    isoWeek: () => '2026-W42'
  };
  vm.createContext(context);
  vm.runInContext(slice('    function calendarTargetForMode(mode) {', '    async function setCalendarMode('), context);
  return context;
}

test('日・週・月はそれぞれ最後に見ていた日付を使い、ほかの表示の移動に引きずられない', () => {
  // 月の表示で12月へ移動したあと、日・週に切り替えても、それぞれが見ていた日付のまま。
  const context = createContext({
    calendarMode: 'month',
    daily: { date: '2026-10-16' },
    planner: { type: 'week', key: '2026-W42' },
    month: { key: '2026-12' }
  });
  assert.equal(context.calendarTargetForMode('day'), '2026-10-16');
  assert.equal(context.calendarTargetForMode('week'), '2026-W42');
  assert.equal(context.calendarTargetForMode('month'), '2026-12');
});

test('まだ日付を持っていない表示は、今日を基準にする', () => {
  const context = createContext({ calendarMode: 'week', daily: { date: '' }, planner: { type: 'month', key: '2026-10' }, month: { key: '' } });
  assert.match(context.calendarTargetForMode('day'), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(context.calendarTargetForMode('week'), '2026-W42');
  assert.match(context.calendarTargetForMode('month'), /^\d{4}-\d{2}$/);
});
