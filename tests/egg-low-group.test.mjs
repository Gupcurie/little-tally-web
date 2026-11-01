import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../dist/core.js';
import {planRandom} from '../dist/plan-random.js';

function fixture(ratios){const egg=C.emptyEgg();ratios.forEach((r,k)=>C.eggAddItem(egg,String(k),r));return egg;}
const sequence=p=>[...C.eggSavedSequence(p)];
function seeded(seed){return ()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};}
function fixedSeeds(t){
 const random=seeded(19381);
 t.mock.method(globalThis.crypto,'getRandomValues',array=>{for(let k=0;k<array.length;k++)array[k]=Math.floor(random()*4294967296);return array;});
}
function assertSeparated(order,low){
 for(let k=1;k<order.length;k++)assert.ok(!low.has(order[k])||!low.has(order[k-1]),`low items clustered at ${k}`);
}

test('different low-ratio categories stay apart through whole-round regeneration while quotas and variation survive',t=>{
 fixedSeeds(t);
 for(const ratios of [[10,8,1,1],[8,6,3,1],[8,6,12,10,8,3,4,18,20,10,1]]){
  const egg=fixture(ratios),total=C.sum(ratios),low=new Set(egg.items.filter(i=>i.ratio*2<=Math.max(...ratios)&&i.ratio*ratios.length<total&&i.ratio*4<=total).map(i=>i.id));
  let previous;const orders=new Set();
  for(let k=0;k<40;k++){
   const order=sequence(C.eggCreatePlan(egg,{previous}));assertSeparated(order,low);
   egg.items.forEach((i,j)=>assert.equal(order.filter(id=>id===i.id).length,ratios[j]));
   if(previous&&ratios.length===11)assert.ok(order.filter((id,j)=>id!==previous[j]).length>=order.length*.5);
   orders.add(order.join('|'));previous=order;
  }
  assert.ok(orders.size>=25,'spacing must still leave many different orders');
 }
});

test('an actual low-category placement cools down other low categories, even if it was not recommended',t=>{
 fixedSeeds(t);
 const egg=fixture([10,8,1,1]),low=new Set(egg.items.slice(2).map(i=>i.id));
 const before=JSON.stringify(egg);C.eggCreatePlan(egg);assert.equal(JSON.stringify(egg),before);
 C.eggChange(egg,egg.items[3].id,1);
 for(let seed=1;seed<=60;seed++){
  const order=[...C.eggRoundSequence(egg,{random:seeded(seed)})];
  assert.ok(order.slice(0,5).every(id=>!low.has(id)));
  assert.ok(!low.has(sequence(C.eggCreatePlan(egg))[0]));
 }
});

test('the group interval carries across round boundaries and refers to a different low item',t=>{
 fixedSeeds(t);
 const egg=fixture([10,8,1,1]),last=egg.items[3].id,low=new Set(egg.items.slice(2).map(i=>i.id));
 egg.items.forEach(i=>C.eggSetCount(egg,i.id,i.ratio-Number(i.id===last)));C.eggChange(egg,last,1);
 assert.equal(C.eggRound(egg),1);
 for(let k=0;k<40;k++){
  const order=sequence(C.eggCreatePlan(egg));
  assert.ok(order.findIndex(id=>low.has(id))>=5);assertSeparated(order,low);
 }
});

test('only-low remaining tails finish without dropping a quota or getting stuck',t=>{
 fixedSeeds(t);
 const egg=fixture([10,8,1,1]);egg.items.slice(0,2).forEach(i=>C.eggSetCount(egg,i.id,i.ratio));
 for(let k=0;k<20;k++){
  const order=sequence(C.eggCreatePlan(egg));assert.equal(order.length,2);
  assert.deepEqual(new Set(order),new Set(egg.items.slice(2).map(i=>i.id)));
 }
});

test('uniform ratios retain the previous random scheduling instead of treating every category as rare',()=>{
 const egg=fixture([1,1,1,1,1,1,1,1,1,1,1]);
 const plan=C.eggCreatePlan(egg),legacy={...plan,version:1,seed:[1,2,3,4,5,6,7,8],context:{...plan.context}};
 delete legacy.context.rareSpacing;
 assert.deepEqual([...C.eggRoundSequence(egg,{random:planRandom(legacy.seed)})],sequence(legacy));
});

test('legacy v1 and exhausted-prefix v2 plans reproduce their original saved random stream',()=>{
 const egg=fixture([8,6,3,1]),base=C.eggCreatePlan(egg);
 // Captured from the production model before the group-spacing update.
 const expected=[3,1,2,0,1,0,2,0,1,0,2,0,1,0,1,0,1,0].map(k=>egg.items[k].id);
 for(const version of [1,2]){
  const plan={...base,version,order:[],seed:[1,2,3,4,5,6,7,8],context:{...base.context}};delete plan.context.rareSpacing;
  assert.ok(C.eggStoredPlan({...egg,recommendation:plan}));assert.deepEqual(sequence(plan),expected);
  const copy=structuredClone(egg);C.eggChange(copy,expected[0],1);
  assert.deepEqual(sequence(C.eggAdvancePlan(copy,plan,expected[0])),expected.slice(1));
 }
});

test('large-round group spacing continues across the stored prefix and saved advances',t=>{
 fixedSeeds(t);
 const egg=fixture([600,20,1,1]),low=new Set(egg.items.slice(1).map(i=>i.id));
 let plan=C.eggCreatePlan(egg);const order=sequence(plan);
 assert.equal(plan.order.length,512);assert.equal(order.length,622);assertSeparated(order,low);
 for(let k=0;k<515;k++){C.eggChange(egg,order[k],1);plan=C.eggAdvancePlan(egg,plan,order[k]);assert.ok(plan);}
 assert.equal(plan.context.rareSpacing,1);assert.deepEqual(sequence(plan),order.slice(515));
});
