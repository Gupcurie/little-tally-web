import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as C from '../dist/core.js';

const NOW=Date.parse('2026-11-01T03:00:00+08:00');
function fixture(){
 const egg=C.emptyEgg();C.eggAddItem(egg,'甲',6);C.eggAddItem(egg,'乙',2);
 const [a,b]=egg.items;
 const add=(id,delta,at,kind='count')=>egg.records.push({id:C.uid(),itemId:id,delta,at:Date.parse(at),kind});
 add(a.id,1,'2026-10-31T23:59:59+08:00');
 add(a.id,1,'2026-11-01T00:00:01+08:00');
 add(a.id,-1,'2026-11-01T00:01:02+08:00');
 add(a.id,5,'2026-11-01T01:30:03+08:00','set');
 add(b.id,1,'2026-11-01T01:30:05+08:00');
 add(b.id,1,'2026-10-25T02:00:00+08:00');
 return {egg,a,b,add};
}
test('egg statistics separate placements, removals and manual corrections',()=>{
 const {egg}=fixture(),s=C.eggStatistics(egg,{now:NOW});
 assert.deepEqual(s.summary,{added:2,removed:1,manualNet:5,net:6,records:4});
 assert.equal(s.total,8);assert.equal(s.completedRounds,1);assert.equal(s.left,8);
 assert.equal(s.summary.net,s.summary.added-s.summary.removed+s.summary.manualNet);
});
test('today and recent ranges use Beijing calendar days',()=>{
 const {egg}=fixture();
 assert.equal(C.eggStatistics(egg,{range:0,now:NOW}).rows.length,4);
 assert.equal(C.eggStatistics(egg,{range:1,now:NOW}).rows.length,5);
 assert.equal(C.eggStatistics(egg,{range:2,now:NOW}).rows.length,6);
 assert.equal(C.eggStatistics(egg,{range:3,now:NOW}).rows.length,6);
 assert.equal(C.eggStatistics(egg,{range:0,now:NOW}).start,'2026-11-01');
});
test('date boundaries include the first calendar day of the selected range',()=>{
 const {egg,a,add}=fixture();
 add(a.id,1,'2026-10-26T00:00:00+08:00');add(a.id,1,'2026-10-25T23:59:59+08:00');
 const s=C.eggStatistics(egg,{range:1,now:NOW});
 assert.ok(s.rows.some(r=>r.at===Date.parse('2026-10-26T00:00:00+08:00')));
 assert.ok(!s.rows.some(r=>r.at===Date.parse('2026-10-25T23:59:59+08:00')));
});
test('item filter narrows period metrics without changing global quantities',()=>{
 const {egg,a}=fixture(),s=C.eggStatistics(egg,{itemId:a.id,now:NOW});
 assert.equal(s.summary.net,5);assert.equal(s.activeItems,1);assert.equal(s.total,8);
 assert.ok(s.rows.every(r=>r.itemId===a.id));
 assert.equal(s.items[0].manualNet,5);assert.equal(s.items[0].count,6);
});
test('hours and minutes preserve removal and set deltas instead of counting them as placements',()=>{
 const {egg}=fixture(),s=C.eggStatistics(egg,{now:NOW,hour:1});
 assert.deepEqual(s.hours[0],{added:1,removed:1,manualNet:0,net:0,records:2});
 assert.deepEqual(s.minutes[30],{added:1,removed:0,manualNet:5,net:6,records:2});
 assert.equal(s.days['2026-11-01'].net,6);assert.equal(s.hour,1);
});
test('per-round fractions roll over while cumulative quantities remain intact',()=>{
 const {egg,a,add}=fixture();add(a.id,1,'2026-11-01T02:00:00+08:00');
 const s=C.eggStatistics(egg,{now:NOW}),item=s.items.find(i=>i.id===a.id);
 assert.equal(item.count,7);assert.equal(item.progress,1);assert.equal(item.ratio,6);
 assert.equal(s.total,9);assert.equal(s.currentRound,2);
});
test('statistics are read-only and tolerate empty books',()=>{
 const {egg}=fixture(),before=JSON.stringify(egg);C.eggStatistics(egg,{now:NOW});
 assert.equal(JSON.stringify(egg),before);
 const empty=C.eggStatistics(C.emptyEgg(),{now:NOW});
 assert.equal(empty.total,0);assert.equal(empty.rows.length,0);assert.equal(empty.summary.net,0);
});
test('latest placement time ignores manual corrections and statistics retain second precision',()=>{
 const {egg,a}=fixture(),s=C.eggStatistics(egg,{now:NOW});
 assert.equal(s.items.find(i=>i.id===a.id).lastPlacedAt,Date.parse('2026-11-01T00:00:01+08:00'));
 assert.equal(s.rows[0].at,Date.parse('2026-11-01T01:30:05+08:00'));
});

const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
function extracted(start,end){return source.slice(source.indexOf('function '+start+'('),source.indexOf('function '+end+'('));}
const escape=s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;');
test('the real card template places the denominator beside the round count at all sizes',()=>{
 const {egg,a,add}=fixture();add(a.id,1,'2026-11-01T02:00:00+08:00');
 const context=vm.createContext({C,state:{eggArrange:false},fmt:String,e:escape,sinceText:()=>'',icon:()=>''});
 vm.runInContext(extracted('eggCard','eggPickKey'),context);
 const markup=context.eggCard(C.eggProgress(egg).find(i=>i.id===a.id),egg);
 assert.match(markup,/class="egg-current">1<\/span><small class="egg-denominator">\/6/);
 assert.match(markup,/累计 7 个/);
});
test('statistics render in day, hour and minute views, including per-item and operation detail',()=>{
 const {egg}=fixture();
 class FixedDate extends Date{static now(){return NOW;}}
 const context=vm.createContext({C:{...C,eggStatistics:(egg,options)=>C.eggStatistics(egg,{...options,now:NOW})},Date:FixedDate,
  state:{range:3,statsItem:null,statsGran:'day',selectedHour:null,eggStatsLimit:80},eggBook:()=>egg,fmt:String,e:escape,
  pageHeading:()=>'',bookPicker:()=>'',rangePills:()=>'',legendRow:()=>'',empty:()=>'',icon:()=>''});
 vm.runInContext(extracted('eggStatsView','itemColor'),context);
 for(const gran of ['day','hour','minute']){
  context.state.statsGran=gran;const markup=context.eggStatsView();
  assert.match(markup,/操作明细/);assert.match(markup,/手动改数/);assert.match(markup,/物品数量与本轮进度/);
  assert.match(markup,/本轮 0\/6/);assert.match(markup,/2026/);
 }
});
test('recommendation feedback runs once after data or selection changes, respecting reduced motion',()=>{
 const classes=[],animations=[],state={eggMotionKey:null,eggPick:{key:'counts-a',id:'item-a'}};
 const name={animate:(...args)=>animations.push(args)};
 const box={classList:{add:name=>classes.push(name)},querySelector:()=>name};
 let reduced=false;
 const context=vm.createContext({state,main:{querySelector:()=>box},matchMedia:()=>({matches:reduced})});
 vm.runInContext(extracted('animateEggRecommendation','fitItemGrid'),context);
 context.animateEggRecommendation();context.animateEggRecommendation();assert.equal(animations.length,0);
 state.eggPick.key='counts-b';context.animateEggRecommendation();assert.equal(animations.length,1);
 context.animateEggRecommendation();assert.equal(animations.length,1);
 reduced=true;state.eggPick.id='item-b';context.animateEggRecommendation();assert.equal(animations.length,1);
 assert.deepEqual(classes,['reco-updated']);
});
