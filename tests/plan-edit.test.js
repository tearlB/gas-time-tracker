const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('ui/plan_edit.js', 'utf8');
function load(names) {
  const context = {
    parseYmd: value => new Date(value + 'T00:00:00'), addDaysYmd: (value, days) => { const d = new Date(value + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); },
    roundHours: value => Math.round((Number(value) || 0) * 4) / 4, shortYmdLabel: value => Number(value.slice(5, 7)) + '/' + Number(value.slice(8, 10))
  };
  vm.createContext(context);
  names.forEach(name => {
    const from = source.indexOf('    function ' + name + '(');
    const to = source.indexOf('\n    }\n', from) + 7;
    vm.runInContext(source.slice(from, to), context);
  });
  return context;
}

test('期間のドラッグ: 動かすと期間ごと、端をつかむと開始日・終了日だけが変わる', () => {
  const api = load(['periodDragDaysBetween', 'periodDragNextRange', 'periodDragRangeText']);
  const drag = { start: '2026-10-27', end: '2026-10-30', grabDate: '2026-10-28', zone: 'move' };
  assert.deepEqual(JSON.parse(JSON.stringify(api.periodDragNextRange(drag, '2026-10-30'))), { start: '2026-10-29', end: '2026-11-01' });
  assert.deepEqual(JSON.parse(JSON.stringify(api.periodDragNextRange(Object.assign({}, drag, { zone: 'end' }), '2026-11-05'))), { start: '2026-10-27', end: '2026-11-05' });
  assert.deepEqual(JSON.parse(JSON.stringify(api.periodDragNextRange(Object.assign({}, drag, { zone: 'start' }), '2026-10-20'))), { start: '2026-10-20', end: '2026-10-30' });
  assert.deepEqual(JSON.parse(JSON.stringify(api.periodDragNextRange(Object.assign({}, drag, { zone: 'start' }), '2026-11-10'))), { start: '2026-10-30', end: '2026-10-30' }, '開始日は終了日を越えない');
  assert.deepEqual(JSON.parse(JSON.stringify(api.periodDragNextRange(Object.assign({}, drag, { zone: 'end' }), '2026-10-01'))), { start: '2026-10-27', end: '2026-10-27' }, '終了日は開始日より前にならない');
  assert.equal(api.periodDragRangeText({ start: '2026-10-27', end: '2026-10-27' }), '10/27');
  assert.equal(api.periodDragRangeText({ start: '2026-10-27', end: '2026-11-05' }), '10/27〜11/5');
});

test('月の予定の編集: 変わった項目だけを送り、画面の行へ先に反映する形に直す', () => {
  const api = load(['planFieldsToRowFields', 'monthPlanChangedFields']);
  const row = { done: false, range: { start: '2026-10-27', end: '2026-10-30' }, item: { planned: 6, note: '', projectId: '', undated: false } };
  assert.deepEqual(JSON.parse(JSON.stringify(api.monthPlanChangedFields(row, { startDate: '2026-10-27', endDate: '2026-10-30', plannedHours: 6, note: '', projectId: '', done: false }))), {});
  assert.deepEqual(JSON.parse(JSON.stringify(api.monthPlanChangedFields(row, { startDate: '2026-10-28', endDate: '2026-10-30', plannedHours: 8, note: 'メモ', projectId: 'p1', done: true }))), { startDate: '2026-10-28', endDate: '2026-10-30', plannedHours: 8, note: 'メモ', projectId: 'p1', done: true });
  const rowFields = api.planFieldsToRowFields({ startDate: '', endDate: '', done: true });
  assert.equal(rowFields.undated, true, '日付を空にすると期間未定');
  assert.equal(rowFields.completionOverride, true);
});

test('期間のドラッグは、ドラッグ中に表示中の週・月を切り替えない', () => {
  const core = fs.readFileSync('ui/core.js', 'utf8');
  assert.match(core, /async function activateCenteredCalendarPeriod\(mode\) \{\s*\/\/[^\n]*\n\s*if \(typeof periodDrag !== 'undefined' && periodDrag\.active\) return;/);
  assert.match(source, /scrollSnapType = 'none'/, '自動スクロールの邪魔になる吸い付きを止める');
});

test('備考のアイコン: 備考の有無で見え方が変わり、URLはリンクとして取り出す', () => {
  const comp = fs.readFileSync('ui/components.js', 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  ['escapeHtml', 'planNoteLinks', 'planNoteIconHtml'].forEach(name => {
    const from = comp.indexOf('    function ' + name + '(');
    const to = comp.indexOf('\n    }\n', from) + 7;
    vm.runInContext(comp.slice(from, to), ctx);
  });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.planNoteLinks('確認 https://example.com/a?x=1&y=2、続き\nhttps://example.com/a?x=1&y=2 https://b.example/'))), ['https://example.com/a?x=1&y=2', 'https://b.example/'], '重複を除き、日本語の句読点はURLに含めない');
  assert.equal(ctx.planNoteIconHtml('p1', '  ', true).includes('is-empty'), true);
  const withNote = ctx.planNoteIconHtml('p1', 'メモ <b>', true);
  assert.equal(withNote.includes('data-plan-note-id="p1"') && !withNote.includes('is-empty'), true);
  assert.match(withNote, /title="メモ &lt;b&gt;"/, 'ホバーで全文（HTMLは無効）');
  assert.equal(ctx.planNoteIconHtml('', 'メモ', true), '');
  assert.equal(ctx.planNoteIconHtml('p1', 'メモ', false), '');
});
