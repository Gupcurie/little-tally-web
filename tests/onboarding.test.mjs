import test from 'node:test';
import assert from 'node:assert/strict';
import {beijingDay,chooseRole,validProfile,newestProfile,TUTORIALS,tutorialFor} from '../dist/onboarding.js';

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
test('daily profiles retain the outside feature choices and both daily tutorials explain protected jobs and optional stock',()=>{
 const profile=validProfile({...chooseRole('place',true,Date.now(),'angel'),outsideBooks:{sales:true,stock:true,egg:false},outsideRole:'dismantle'});
 assert.equal(profile.version,2);assert.equal(profile.roomKind,'angel');assert.deepEqual(profile.outsideBooks,{sales:true,stock:true,egg:false});
 for(const role of ['dismantle','place']){const tutorial=tutorialFor(role,true);assert.equal(tutorial.length,8);assert.match(tutorial.map(e=>e.body).join(''),/不加入任何群聊/);assert.match(tutorial.at(-1).body,/L2385434375/);}
 assert.match(tutorialFor('place',true).map(e=>e.body).join(''),/投蛋库存默认关闭/);
});
import {AUTHOR_NOTE} from '../dist/onboarding.js';
test('author note preserves role, matching and support guidance without promising impossible sequences',()=>{
 assert.ok(AUTHOR_NOTE.indexOf('天使集装箱')<AUTHOR_NOTE.indexOf('拆弹的小伙伴'));
 for(const text of ['销售功能和库存功能','红娃衣和黑娃衣','手动加减库存','L2385434375','13480041761'])assert.ok(AUTHOR_NOTE.includes(text));
 assert.ok(AUTHOR_NOTE.includes('尽量'));assert.ok(AUTHOR_NOTE.includes('还是可能重复'));assert.ok(!AUTHOR_NOTE.includes('每一件物品前后都不重复'));
});
