const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
function slice(file, start, end) {
  const s=fs.readFileSync(file,'utf8');
  return s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)));
}

test('週では完了した予定も、表示期間にかかるものは出す（グループ分けはせず、並びはそのまま。データは削除しない）', () => {
  const api = { roundHours: n=>Number(n)||0, planIsComplete: item=>item.done,
    planDateRange: ()=>({start:'2026-10-26',end:'2026-11-01'}),planVisibleInWeek: (item)=>item.id!=='out-of-range',
    planHasActualInRange: ()=>false };
  vm.createContext(api);
  vm.runInContext(slice('ui/planning_view.js','function weekPlanRows(','function calculateWeekPlanModel('),api);
  const items=[{id:'done-empty',done:true},{id:'done-actual',done:true,actualByDate:{'2026-10-27':1}},{id:'out-of-range',done:true},{id:'open',done:false}];
  const rows=api.weekPlanRows(items,{range:{startYmd:'2026-10-26',endExclusiveYmd:'2026-11-02'}});
  assert.deepEqual(Array.from(rows.filter(r=>r.visible),r=>r.id),['done-empty','done-actual','open'], '完了も出すが、期間にかからない予定は出さない');
  assert.equal(items.length,4);
  const source = fs.readFileSync('ui/planning_view.js','utf8');
  assert.doesNotMatch(source, /activeLaneRows|doneLaneRows|data-week-done-toggle|group:done/, '完了のグループ分け（見出し・折りたたみ）はしない');
  assert.match(source, /planRows\.map\(laneHtmlFor\)/, '予定の行は、並びのまま出す');
});

test('月のカレンダー予定工数は、終日・実施しない予定・実績に取り込んだ予定を数えない', () => {
  const api={Logger:{log(){}},roundHours:n=>Math.round((Number(n)||0)*4)/4};
  vm.createContext(api);vm.runInContext(fs.readFileSync('gas/planning.gs','utf8'),api);
  const events=[{id:'meeting',startTime:'10:00',endTime:'11:00'}, {id:'holiday',allDay:true}, {id:'skip',startTime:'13:00',endTime:'15:00'}];
  const result=api.planningCalendarHoursByDate([{date:'2026-10-27',events},{date:'2026-10-28',events:[]}],[api.calendarEventKey(events[2],'2026-10-27',2)]);
  assert.equal(result['2026-10-27'],1);assert.equal(result['2026-10-28'],0);
});

test('実績に取り込んだカレンダー予定（予定にした・今日だけの実績にした）はカレンダーの合計から除く', () => {
  const api={Logger:{log(){}},roundHours:n=>Math.round((Number(n)||0)*4)/4,BUDGET_CALENDAR_INTERRUPT_PREFIX:'カレンダー割り込み:',budgetCalendarKeyFromNote:()=> ''};
  vm.createContext(api);vm.runInContext(fs.readFileSync('gas/planning.gs','utf8'),api);
  const events=[{id:'a',startTime:'10:00',endTime:'11:00'},{id:'b',startTime:'13:00',endTime:'15:00'},{id:'c',startTime:'16:00',endTime:'16:30'}];
  const keyA=api.calendarEventKey(events[0],'2026-10-27',0);
  const keyB=api.calendarEventKey(events[1],'2026-10-27',1);
  const imported=api.planningImportedCalendarKeys([{calendarKey:keyA}],[['2026-10-27','今日だけ',2,0,2,'','カレンダー割り込み:'+keyB]]);
  assert.deepEqual(Array.from(imported),[keyA,keyB]);
  assert.equal(api.planningCalendarHoursByDate([{date:'2026-10-27',events}],imported)['2026-10-27'],0.5);
});

test('月の稼働取得はその月だけ、週の先読みは60日分を維持する',()=>{
  const dates=[];
  const api={ BUDGET_PERIOD_MONTH:'month',normalizeBudgetPeriodType:x=>x,normalizeBudgetPeriodKey:(t,k)=>k,
    Session:{getScriptTimeZone:()=> 'Asia/Tokyo'},Utilities:{formatDate:d=>d.toISOString().slice(0,10)},
    getBudgetPeriodRange:()=>({startYmd:'2026-10-01',endExclusiveYmd:'2026-11-01'}),
    loadSelectedCalendarEvents:(start,end)=>{dates.push([start,end]);return[];},loadWorkCapacitySettings:()=>({}),Logger:{log(){}},roundHours:n=>n };
  vm.createContext(api);vm.runInContext(fs.readFileSync('gas/planning.gs','utf8'),api);
  api.loadSelectedCalendarEvents=(start,end)=>{dates.push([start,end]);return[];};api.loadWorkCapacitySettings=()=>({});
  assert.equal(api.loadPlanningCalendarCapacity('month','2026-10').days.length,31);
  assert.equal(api.loadPlanningCalendarCapacity('week','2026-W40').days.length,60);
});

test('週移動では行を一度だけ動かし、同じ週の再取得では動かさない', () => {
  const effects = [];
  let top = 100;
  const row = { dataset: { rowKey: 'plan-1' }, getBoundingClientRect: () => ({top,bottom:top+72,height:72}), animate: (frames, options) => {effects.push({frames,options});return {cancel(){}};} };
  const target = { dataset: { timelineKey: '2026-W44' }, querySelector: selector => selector === '.week-span' ? {} : null, querySelectorAll: () => [row] };
  const api = { state: {view:'planning',planner:{key:'2026-W44'}},document:{getElementById:()=>target},window:{innerHeight:900},motionAllowed:()=>true };
  vm.createContext(api);
  vm.runInContext(slice('ui/planning_timeline.js','const weekNavigationMotion =','// 同じ行はDOMを残し'),api);
  api.prepareWeekNavigationMotion('2026-W45');
  api.state.planner.key='2026-W45';target.dataset.timelineKey='2026-W45';top=140;
  api.finishWeekNavigationMotion();
  assert.equal(effects.length,1);
  assert.equal(effects[0].frames[0].transform,'translateY(-40px)');
  api.finishWeekNavigationMotion();
  api.prepareWeekNavigationMotion('2026-W45');
  api.finishWeekNavigationMotion();
  assert.equal(effects.length,1,'再取得・同じ週では再生しない');
  api.motionAllowed=()=>false;
  api.prepareWeekNavigationMotion('2026-W46');
  api.state.planner.key='2026-W46';target.dataset.timelineKey='2026-W46';
  api.finishWeekNavigationMotion();
  assert.equal(effects.length,1,'視差効果を減らす設定を尊重する');
});

test('週移動中の再取得による描画はアニメーション後の一回にまとめる', async () => {
  let complete;
  const finished = new Promise(resolve => {complete=resolve;});
  const row = {dataset:{rowKey:'plan'},getBoundingClientRect:()=>({top:100,bottom:172,height:72}),animate:()=>({cancel(){},finished})};
  const target = {dataset:{timelineKey:'old'},querySelector:s=>s==='.week-span'?{}:null,querySelectorAll:()=>[row]};
  const scheduled=[];
  const api={state:{view:'planning',planner:{key:'old'}},document:{getElementById:()=>target},window:{innerHeight:900},motionAllowed:()=>true,scheduleCalendarTimelineRender:mode=>scheduled.push(mode)};
  vm.createContext(api);
  vm.runInContext(slice('ui/planning_timeline.js','const weekNavigationMotion =','// 同じ行はDOMを残し'),api);
  api.prepareWeekNavigationMotion('next');
  api.state.planner.key='next';target.dataset.timelineKey='next';
  row.getBoundingClientRect=()=>({top:140,bottom:212,height:72});
  api.finishWeekNavigationMotion();
  assert.equal(api.deferWeekNavigationRender(),true);
  assert.equal(api.deferWeekNavigationRender(),true);
  assert.equal(scheduled.length,0);
  complete();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(api.deferWeekNavigationRender(),false);
  assert.deepEqual(scheduled,['week']);
});

test('並べ替えの操作部品は残る行で再利用し、削除した行の分だけ破棄する', () => {
  let created=0, killed=0, removed=0;
  const firstHandle={}, secondHandle={};
  const rows=[{querySelector:()=>firstHandle}];
  const parent={querySelectorAll:()=>rows};
  const api={
    window:{
      addEventListener(){},
      uiLibraries:{gsap:{},Draggable:{create:()=>{
        created++;
        return [{kill(){killed++;}}];
      }}}
    },
    document:{
      body:{appendChild(){}},
      createElement:()=>({style:{},remove(){removed++;}})
    }
  };
  vm.createContext(api);
  vm.runInContext(fs.readFileSync('ui/motion.js','utf8'),api);
  const options={selector:'.row',handleSelector:'.handle'};
  api.bindReorderDraggables(parent,options);
  api.bindReorderDraggables(parent,options);
  assert.equal(created,1);
  assert.equal(killed,0);
  rows.push({querySelector:()=>secondHandle});
  api.bindReorderDraggables(parent,options);
  assert.equal(created,2);
  rows.shift();
  api.bindReorderDraggables(parent,options);
  assert.equal(created,2);
  assert.equal(killed,1);
  assert.equal(removed,1);
});
