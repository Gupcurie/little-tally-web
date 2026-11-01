import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../dist/core.js';

function book(ratios){const egg=C.emptyEgg();ratios.forEach((r,k)=>C.eggAddItem(egg,String(k),r));return egg;}
const sequence=p=>[...C.eggSavedSequence(p)];
const changed=(a,b)=>a.filter((id,k)=>id!==b[k]).length;

test('small complete-round rerolls change most positions while balanced quotas avoid adjacency',()=>{
 const egg=book([3,2,1]);let before=sequence(C.eggCreatePlan(egg));
 for(let k=0;k<50;k++){
  const plan=C.eggCreatePlan(egg,{previous:before}),after=sequence(plan);
  assert.equal(plan.version,2);assert.equal(plan.comparison.exact,true);
  assert.ok(changed(before,after)>=4);
  assert.ok(after.every((id,k)=>!k||id!==after[k-1]));
  assert.deepEqual(egg.items.map(i=>after.filter(id=>id===i.id).length),[3,2,1]);before=after;
 }
});
test('dominant tiny rounds can vary widely with at most one extra dominant pair and no minor pairs',()=>{
 for(const ratios of [[4,2,1],[5,3,1]]){
  const egg=book(ratios),dominant=egg.items[0].id;let before=sequence(C.eggCreatePlan(egg));
  for(let k=0;k<30;k++){
   const after=sequence(C.eggCreatePlan(egg,{previous:before}));
   assert.ok(changed(before,after)>=Math.floor(after.length*.6));
   const repeated=after.filter((id,k)=>k&&id===after[k-1]);
   assert.ok(repeated.length<=1);assert.ok(repeated.every(id=>id===dominant));
   assert.ok(after.every((id,k)=>k<2||id!==after[k-1]||id!==after[k-2]));before=after;
  }
 }
});
test('realistic eleven-item rounds remain exact and materially different on explicit regeneration',()=>{
 const ratios=[8,6,12,10,8,3,4,18,20,10,1],egg=book(ratios);let before=sequence(C.eggCreatePlan(egg));
 for(let k=0;k<30;k++){
  const plan=C.eggCreatePlan(egg,{previous:before}),after=sequence(plan);
  assert.equal(after.length,100);assert.ok(changed(before,after)>=60);
  assert.ok(after.every((id,k)=>!k||id!==after[k-1]));
  egg.items.forEach((item,j)=>assert.equal(after.filter(id=>id===item.id).length,ratios[j]));before=after;
 }
});
test('whole-round scoring respects actual recent history and rare spacing across a round boundary',()=>{
 const egg=book([8,6,3,1]),rare=egg.items[3].id;
 egg.items.forEach(i=>C.eggSetCount(egg,i.id,i.ratio-Number(i.id===rare)));
 C.eggChange(egg,rare,1);
 for(let k=0;k<30;k++){
  const order=sequence(C.eggCreatePlan(egg));
  assert.notEqual(order[0],rare);assert.ok(order.indexOf(rare)>=8);
 }
});
test('rare items have longer observed average gaps while whole rounds complete exactly',()=>{
 const egg=book([8,3,1]),picks=[];
 for(let r=0;r<18;r++){
  const order=sequence(C.eggCreatePlan(egg));
  order.forEach(id=>{picks.push(id);C.eggChange(egg,id,1);});assert.equal(C.eggRound(egg),r+1);
 }
 const mean=id=>{const positions=picks.map((v,k)=>v===id?k:-1).filter(k=>k>=0);return (positions.at(-1)-positions[0])/(positions.length-1);};
 assert.ok(mean(egg.items[0].id)<mean(egg.items[1].id));assert.ok(mean(egg.items[1].id)<mean(egg.items[2].id));
});
test('an unavoidable single-item tail reports limited variation without violating the remaining quota',()=>{
 const egg=book([4,1]),id=egg.items[0].id;C.eggSetCount(egg,id,1);C.eggSetCount(egg,egg.items[1].id,1);
 const plan=C.eggCreatePlan(egg,{previous:[id,id,id]});
 assert.deepEqual(sequence(plan),[id,id,id]);assert.equal(plan.comparison.limited,true);assert.equal(plan.comparison.changed,0);
});
test('large rounds bound the stored prefix and preserve its exact continuation after advancing beyond it',()=>{
 const egg=book([600,1]);let plan=C.eggCreatePlan(egg);const original=sequence(plan);
 assert.equal(plan.order.length,512);assert.equal(original.length,601);
 for(let k=0;k<520;k++){
  C.eggChange(egg,original[k],1);plan=C.eggAdvancePlan(egg,plan,original[k]);
  assert.ok(plan);assert.ok(C.eggStoredPlan({...egg,recommendation:plan}));
 }
 assert.equal(plan.order.length,0);assert.deepEqual(sequence(plan),original.slice(520));
});
test('existing version-one account plans remain readable and advance without losing their saved sequence',()=>{
 const egg=book([3,2,1]),plan={...C.eggCreatePlan(egg),version:1};delete plan.order;
 egg.recommendation=plan;assert.ok(C.eggStoredPlan(egg));
 const original=sequence(plan);C.eggChange(egg,original[0],1);
 const next=C.eggAdvancePlan(egg,plan,original[0]);assert.deepEqual(sequence(next),original.slice(1));
});
