import test from 'node:test';
import assert from 'node:assert/strict';
import {startReconciliation,reconcile} from '../dist/reconcile.js';
import * as C from '../dist/core.js';
import {newSegment} from '../dist/operations.js';

function book(names, entries = []) {
  return {items:names.map((name,i)=>({id:'id-'+i,name})),records:entries.map(([itemId,delta],i)=>({id:'r-'+i,itemId:'id-'+itemId,delta,at:100+i}))};
}
test('baseline excludes all old records and allows same-time new records',()=>{
 const egg=book(['甲'],[[0,10]]),sales=book(['甲'],[[0,3]]);
 const baseline=startReconciliation(egg,sales,100);
 egg.records.push({id:'new-e',itemId:'id-0',delta:2,at:100});
 sales.records.push({id:'new-s',itemId:'id-0',delta:1,at:100});
 const result=reconcile(egg,sales,baseline);
 assert.equal(result.eggs,2);assert.equal(result.sales,1);assert.equal(result.matched,1);assert.equal(result.waiting,1);
 egg.records.shift();
 assert.equal(reconcile(egg,sales,baseline).matched,1);
});
test('sale can match the 20th pending egg but cannot skip to the 21st',()=>{
 const names=['甲','乙'],empty=book(names),baseline=startReconciliation(empty,empty,0);
 assert.equal(reconcile(book(names,[[0,19],[1,1]]),book(names,[[1,1]]),baseline).unmatched,0);
 const result=reconcile(book(names,[[0,20],[1,1]]),book(names,[[1,1]]),baseline);
 assert.equal(result.unmatched,1);assert.equal(result.overdue,1);assert.equal(result.status,'error');
});
test('out-of-order sales and grouped purchases match one by one',()=>{
 const empty=book(['甲','乙']),baseline=startReconciliation(empty,empty,0);
 const result=reconcile(book(['甲','乙'],[[0,3],[1,2]]),book(['甲','乙'],[[1,2],[0,3]]),baseline);
 assert.equal(result.matched,5);assert.equal(result.waiting,0);assert.equal(result.status,'ok');
});
test('reductions undo the latest same-item units and corrected records recompute',()=>{
 const baseline=startReconciliation(book(['甲','乙']),book(['甲','乙']),0);
 const egg=book(['甲','乙'],[[0,3],[1,1],[0,-2]]),sales=book(['甲','乙'],[[1,1],[0,2],[0,-1]]);
 const result=reconcile(egg,sales,baseline);
 assert.equal(result.matched,2);assert.equal(result.unmatched,0);
 sales.records.splice(0,1);
 assert.equal(reconcile(egg,sales,baseline).waiting,1);
});
test('large manual counts use compressed runs and report only the final 20 as pending',()=>{
 const empty=book(['甲']),baseline=startReconciliation(empty,empty,0);
 const result=reconcile(book(['甲'],[[0,999999999]]),book(['甲'],[[0,999999970]]),baseline);
 assert.equal(result.matched,999999970);assert.equal(result.waiting,20);assert.equal(result.overdue,9);
});
test('new segments start reconciliation again after inherited quantities',()=>{
 const state=C.initialState();C.ensureEgg(state);state.reconciliation=startReconciliation(state.egg,state.sales);
 const next=newSegment(state,{now:200});
 assert.equal(next.reconciliation.at,200);
 assert.equal(reconcile(next.egg,next.sales,next.reconciliation).eggs,0);
 assert.notEqual(next.reconciliation,state.reconciliation);
});
test('name normalization matches labels while reporting unknown sale categories',()=>{
 const baseline=startReconciliation(book([]),book([]),0);
 const result=reconcile(book(['Ｔ恤'],[[0,1]]),book(['T恤','鼠标垫'],[[0,1],[1,1]]),baseline);
 assert.equal(result.matched,1);assert.equal(result.unmatched,1);
});