import test from 'node:test';
import assert from 'node:assert/strict';
import {beijingDay,chooseRole,validProfile,newestProfile,TUTORIALS} from '../dist/onboarding.js';

test('roles select independent feature defaults without modifying any ledger',()=>{
 const sale=chooseRole('dismantle',true),egg=chooseRole('place',false);
 assert.deepEqual(sale.books,{sales:true,stock:true,egg:false});
 assert.deepEqual(egg.books,{sales:false,stock:false,egg:true});
 assert.equal(sale.tutorialPending,true);assert.equal(egg.tutorialPending,false);
 sale.books.egg=true;assert.equal(chooseRole('dismantle',false).books.egg,false);
 assert.throws(()=>chooseRole('__proto__',true));
});
test('the daily role boundary follows Beijing midnight regardless of browser timezone',()=>{
 const before=Date.parse('2026-11-13T15:59:59.999Z'),after=before+1;
 assert.equal(beijingDay(before),'2026-11-13');assert.equal(beijingDay(after),'2026-11-14');
 assert.notEqual(chooseRole('place',false,before).day,chooseRole('place',false,after).day);
});
test('manual feature changes survive normalization and the newest account profile wins',()=>{
 const remote=chooseRole('dismantle',false,1000),local={...remote,books:{sales:true,stock:false,egg:true},updatedAt:2000};
 assert.deepEqual(newestProfile(remote,local).books,local.books);
 assert.equal(newestProfile({...remote,updatedAt:3000},local).updatedAt,3000);
 assert.equal(validProfile({...local,books:{sales:false,stock:false,egg:false}}),null);
 assert.equal(validProfile({...local,role:'admin'}),null);
 assert.equal(validProfile({...local,books:{sales:'yes'}}),null);
 assert.equal(newestProfile(null,null),null);
});
test('both job tutorials have six distinct steps and explain their own feature defaults',()=>{
 assert.equal(TUTORIALS.dismantle.length,6);assert.equal(TUTORIALS.place.length,6);
 assert.match(TUTORIALS.dismantle.map(s=>s.body).join(''),/手动调整库存，不改变销售/);
 assert.match(TUTORIALS.place.map(s=>s.body).join(''),/7\/6/);
 assert.match(TUTORIALS.place.at(-1).body,/默认只开放蛋/);
});
