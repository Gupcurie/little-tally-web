import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as C from '../dist/core.js';
import {chachaBlock,planRandom} from '../dist/plan-random.js';

function seeded(seed){return ()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};}
function fixture(ratios=[8,6,3,1]){
 const egg=C.emptyEgg();ratios.forEach((r,i)=>C.eggAddItem(egg,'物品'+i,r));return egg;
}
test('saved-plan random stream matches the RFC 8439 block vector and resumes at any word',()=>{
 const key=[0x03020100,0x07060504,0x0b0a0908,0x0f0e0d0c,0x13121110,0x17161514,0x1b1a1918,0x1f1e1d1c];
 assert.deepEqual(chachaBlock(key,1,[0x09000000,0x4a000000,0]),[
  0xe4e7f110,0x15593bd1,0x1fdd0f50,0xc47120a3,0xc7f4d1c7,0x0368c033,0x9aaa2204,0x4e6cd4c3,
  0x466482d2,0x09aa9f07,0x05d7c214,0xa2028bd9,0xd19c12b5,0xb94e16de,0xe883d0cb,0x4e3c50a2]);
 const stream=planRandom(key),values=Array.from({length:80},stream);
 for(const start of [0,1,15,16,39,64]){
  const resumed=planRandom(key,start);assert.deepEqual(Array.from({length:80-start},resumed),values.slice(start));
 }
});
test('serialized account plan reproduces the identical complete list and advances without storing the list',()=>{
 const egg=fixture([8,6,3,1]);egg.recommendation=C.eggCreatePlan(egg,{firstId:egg.items[2].id});
 const sequence=[...C.eggSavedSequence(egg.recommendation)],before=JSON.stringify(egg);
 assert.equal(C.eggStoredPlan(egg),egg.recommendation);
 assert.deepEqual([...C.eggSavedSequence(JSON.parse(JSON.stringify(egg.recommendation)))],sequence);
 assert.equal(JSON.stringify(egg),before);
 for(let n=0;n<sequence.length-1;n++){
  C.eggChange(egg,sequence[n],1);
  egg.recommendation=C.eggAdvancePlan(egg,egg.recommendation,sequence[n]);
  assert.ok(C.eggStoredPlan(egg));
  assert.deepEqual([...C.eggSavedSequence(egg.recommendation)],sequence.slice(n+1));
 }
 C.eggChange(egg,sequence.at(-1),1);
 assert.equal(C.eggAdvancePlan(egg,egg.recommendation,sequence.at(-1)),null);
});
test('stale or malformed saved plans are ignored and independent plans use independent Web Crypto seeds',()=>{
 const egg=fixture(),a=C.eggCreatePlan(egg),b=C.eggCreatePlan(egg);
 assert.notDeepEqual(a.seed,b.seed);
 egg.recommendation=a;C.eggChange(egg,egg.items[0].id,1);assert.equal(C.eggStoredPlan(egg),null);
 egg.recommendation=C.eggCreatePlan(egg);egg.recommendation.context.gaps=[null];assert.equal(C.eggStoredPlan(egg),null);
});
test('whole-round plans fill exactly the missing quotas and stop at the starting round end',()=>{
 const random=seeded(79);
 for(let trial=0;trial<60;trial++){
  const egg=fixture(Array.from({length:2+Math.floor(random()*8)},()=>1+Math.floor(random()*18)));
  egg.items.forEach(i=>C.eggSetCount(egg,i.id,Math.floor(random()*45)));
  const before=JSON.stringify(egg),progress=C.eggProgress(egg),sequence=[...C.eggRoundSequence(egg,{random})];
  assert.equal(sequence.length,C.sum(progress.map(p=>p.left)));
  for(const p of progress)assert.equal(sequence.filter(id=>id===p.id).length,p.left);
  assert.equal(JSON.stringify(egg),before);
 }
 assert.deepEqual([...C.eggRoundSequence(C.emptyEgg())],[]);
});
test('simulated sequence uses the same choices as recomputing after each real placement',()=>{
 const egg=fixture([8,6,3,1]),first=egg.items[3].id;
 C.eggChange(egg,first,1); // The scarce item is already placed in this round.
 const randomA=seeded(119),randomB=seeded(119),iterator=C.eggRoundSequence(egg,{random:randomA});
 const missing=C.sum(C.eggProgress(egg).map(p=>p.left));
 for(let k=0;k<missing;k++){
  const actual=iterator.next().value,expected=C.eggRecommend(egg,{random:randomB}).id;
  assert.equal(actual,expected);C.eggChange(egg,actual,1);
 }
 assert.equal(iterator.next().done,true);
});
test('a chosen first recommendation is preserved and its simulated history affects the rest',()=>{
 const egg=fixture([4,3,2]),first=egg.items[1].id;
 const randomA=seeded(6),randomB=seeded(6),iterator=C.eggRoundSequence(egg,{firstId:first,random:randomA});
 assert.equal(iterator.next().value,first);C.eggChange(egg,first,1);
 for(let k=0;k<8;k++){
  const expected=C.eggRecommend(egg,{random:randomB}).id;
  assert.equal(iterator.next().value,expected);C.eggChange(egg,expected,1);
 }
 assert.equal(iterator.next().done,true);
});
test('secure whole-round sampling varies across runs and preserves cross-round rare spacing',()=>{
 const egg=fixture([8,6,3,1]),last=egg.items[3].id;
 egg.items.forEach(i=>C.eggSetCount(egg,i.id,i.ratio-Number(i.id===last)));
 C.eggChange(egg,last,1);
 const orders=new Set();
 for(let k=0;k<40;k++){
  const sequence=[...C.eggRoundSequence(egg)];
  assert.notEqual(sequence[0],last);assert.ok(sequence.indexOf(last)>=6);
  orders.add(sequence.join(','));
 }
 assert.ok(orders.size>=25);
});
test('large quotas can be read in chunks without preparing or mutating the entire round',()=>{
 const egg=fixture([1000000,1]),before=JSON.stringify(egg);
 const iterator=C.eggRoundSequence(egg,{random:seeded(19)});
 for(let k=0;k<200;k++)assert.equal(iterator.next().done,false);
 assert.equal(JSON.stringify(egg),before);
});

const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
function page(egg){
 const random=seeded(921);let html='';
 const core={...C,eggRecommendationSet:(egg,count)=>C.eggRecommendationSet(egg,count,random),
  eggRoundSequence:(egg,options)=>C.eggRoundSequence(egg,{...options,random})};
 const ctx=vm.createContext({C:core,state:{eggPick:null,eggPlan:null},eggBook:()=>egg,fmt:String,e:String,
  showSheet:(title,body)=>{html=body;}});
 vm.runInContext(source.slice(source.indexOf('function eggPickKey('),source.indexOf('function eggView(')),ctx);
 return {ctx,get html(){return html;}};
}
test('opening the list preserves the visible recommendation and reopening keeps its order',()=>{
 const egg=fixture(),{ctx}=page(egg),pick=ctx.eggPickId(egg),plan=ctx.eggPlan(egg);
 assert.equal(plan.ids[0],pick);assert.equal(ctx.eggPlan(egg),plan);
 assert.equal(plan.total,18);assert.equal(plan.ids.length,18);
});
test('following the plan advances to its second item and divergence invalidates it',()=>{
 const egg=fixture(),{ctx}=page(egg),plan=ctx.eggPlan(egg),[first,second]=plan.ids;
 C.eggChange(egg,first,1);
 assert.equal(ctx.advanceEggPlan(egg,plan,first),true);
 assert.equal(ctx.eggPickId(egg),second);assert.equal(plan.ids[0],second);assert.equal(plan.total,17);
 assert.equal(ctx.eggPlan(egg),plan);
 const different=egg.items.find(i=>i.id!==second).id;C.eggChange(egg,different,1);
 assert.equal(ctx.advanceEggPlan(egg,plan,different),false);
 const replacement=ctx.eggPlan(egg);assert.notEqual(replacement,plan);assert.equal(replacement.total,16);
});
test('removals, ratio edits and cloud changes replace stale previews using actual quantities',()=>{
 const egg=fixture(),{ctx}=page(egg);
 let previous=ctx.eggPlan(egg);
 for(const change of [()=>C.eggChange(egg,egg.items[0].id,1),()=>C.eggChange(egg,egg.items[0].id,-1),
  ()=>C.eggSetRatio(egg,egg.items[1].id,2),()=>C.eggSetCount(egg,egg.items[0].id,22)]){
  change();const next=ctx.eggPlan(egg);assert.notEqual(next,previous);
  assert.equal(next.total,C.sum(C.eggProgress(egg).map(p=>p.left)));previous=next;
 }
});
test('regenerating replaces the whole plan and updates the current recommendation',()=>{
 const egg=fixture(),{ctx}=page(egg),initial=ctx.eggPlan(egg),orders=new Set([initial.ids.join(',')]);
 for(let k=0;k<20;k++){
  const plan=ctx.regenerateEggPlan(egg);assert.notEqual(plan,initial);
  assert.equal(ctx.eggPickId(egg),plan.ids[0]);orders.add(plan.ids.join(','));
 }
 assert.ok(orders.size>15);
});
test('a cloud reroll at unchanged quantities replaces the cached plan even with the same first pick',()=>{
 const egg=fixture();egg.recommendation=C.eggCreatePlan(egg,{firstId:egg.items[1].id});
 const {ctx}=page(egg),before=ctx.eggPlan(egg);
 const replacement=C.eggCreatePlan(egg,{firstId:egg.items[1].id});egg.recommendation=replacement;
 const after=ctx.eggPlan(egg);assert.notEqual(after,before);
 assert.equal(after.snapshot,replacement);assert.equal(after.ids[0],before.ids[0]);
 assert.deepEqual(Array.from(after.ids),[...C.eggSavedSequence(replacement)]);
});
test('the real page syncs recommendation metadata without count records and saves the next pick with a placement',async()=>{
 const egg=fixture(),{ctx}=page(egg),root={egg};let scheduled,commits=0;
 Object.assign(ctx,{localMode:false,eggPlanSyncTask:null,eggPlanSyncTimer:null,
  setTimeout:fn=>{scheduled=fn;return 1;},clearTimeout:()=>{},sheet:{open:false},sheetContent:{querySelector:()=>null},toast:()=>{},render:()=>{},
  ledger:{signedIn:true,loading:false,readOnly:false,saving:false,commit:async fn=>{commits++;fn(root);C.validateEgg(egg);return root;}}});
 const original=Array.from(ctx.eggPlan(egg).ids);
 ctx.queueEggPlanSync();scheduled();await ctx.eggPlanSyncTask;
 assert.equal(commits,1);assert.equal(egg.records.length,0);assert.ok(C.eggStoredPlan(egg));
 assert.deepEqual([...C.eggSavedSequence(egg.recommendation)],original);
 vm.runInContext(source.slice(source.indexOf('async function mutateEgg('),source.indexOf('async function compressImage(')),ctx);
 await ctx.mutateEgg(e=>C.eggChange(e,original[0],1),{placedId:original[0]});
 assert.equal(commits,2);assert.equal(egg.records.length,1);
 assert.deepEqual([...C.eggSavedSequence(egg.recommendation)],original.slice(1));
 assert.equal(ctx.eggPickId(egg),original[1]);
});
test('plan sheet numbers each pick through the round end and supports further chunks',()=>{
 const egg=fixture(),p=page(egg);p.ctx.showEggPlan();
 assert.match(p.html,/下一个/);assert.match(p.html,/第 2 个/);assert.match(p.html,/第 18 个/);assert.match(p.html,/本轮结束/);
 const big=page(fixture([500,1]));big.ctx.showEggPlan();
 assert.equal(big.ctx.state.eggPlan.ids.length,200);assert.match(big.html,/继续显示/);
 big.ctx.extendEggPlan(big.ctx.state.eggPlan);big.ctx.extendEggPlan(big.ctx.state.eggPlan);big.ctx.showEggPlan();
 assert.equal(big.ctx.state.eggPlan.ids.length,501);assert.match(big.html,/第 501 个/);assert.match(big.html,/本轮结束/);
});
test('recommended and last-placement outlines can coexist on the same card',()=>{
 const egg=fixture(),p=page(egg),id=egg.items[0].id;C.eggChange(egg,id,1);p.ctx.state.eggPick={id};
 Object.assign(p.ctx,{sinceText:()=>'',icon:()=>''});
 vm.runInContext(source.slice(source.indexOf('function eggCard('),source.indexOf('function eggPickKey(')),p.ctx);
 const html=p.ctx.eggCard(C.eggProgress(egg)[0],egg);
 assert.match(html,/egg-card flash recommended/);
});
