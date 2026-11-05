import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as C from '../dist/core.js';

const html=readFileSync(new URL('../deploy/admin/static/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../deploy/admin/static/app.js',import.meta.url),'utf8');
class Element {
 constructor(){this.children=[];this.value='';this.hidden=false;this.listeners={};this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 appendChild(child){this.children.push(child);return child;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 setAttribute(name,value){this[name]=String(value);}
}
async function loadPage({missingUpdated=false,failApi=false,recommendation=null}={}){
 const nodes=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 if(missingUpdated)delete nodes.updated;
 const account={id:'00000000-0000-4000-8000-000000000001',username:'test-account',items:11,records:2,revision:3,created_at:'2026-11-01T00:00:00Z',last_sign_in_at:null,
  books:{sales:{items:9,records:0,lines:[]},stock:{items:0,records:0,lines:[]},egg:{items:2,records:2,total:2,round:1,lines:[{name:'放蛋奖品',total:2,ratio:1}]}}};
 const timers=[];nodes['auto-refresh'].checked=true;
 const context=vm.createContext({document:{getElementById:id=>nodes[id]||null,createElement:()=>new Element(),cookie:'',visibilityState:'visible',addEventListener:()=>{}},window:{location:{href:''}},Date,Set,setTimeout,setInterval:fn=>{timers.push(fn);return 1;},fetch:async url=>{
  if(failApi&&url.endsWith('/accounts'))return {status:503,ok:false,json:async()=>({error:'BACKEND_UNAVAILABLE'})};
  return {status:200,ok:true,json:async()=>url.endsWith('/recommendation')?{egg:recommendation}:url.endsWith('/audit')?{entries:[]}:{accounts:[JSON.parse(JSON.stringify(account))],summary:{total:1,active:1,banned:0,with_ledger:1,items:11,records:2,signed_in_7d:1},generated_at:1793491200}};
 }});
 // Run real event wiring, fetch, summary rendering and row rendering from the shipped script.
 const withoutAutoLoad=script.replace(/\nload\(\);\s*$/,'');
 vm.runInContext(withoutAutoLoad,context);
 await vm.runInContext('load()',context);
 Object.defineProperty(nodes,'context',{value:context});Object.defineProperty(nodes,'sourceAccount',{value:account});Object.defineProperty(nodes,'timers',{value:timers});
 return nodes;
}
test('admin HTML supplies every directly referenced static element',()=>{
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 for(const m of script.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(m[1]),'missing '+m[1]);
});
test('successful account fetch renders summary and account rows without a false backend error',async()=>{
 const nodes=await loadPage();
 assert.equal(nodes['s-items'].textContent,'11');
 assert.equal(nodes.rows.children.length,1);
 assert.match(nodes.rows.textContent,/test-account/);
 assert.match(nodes.updated.textContent,/更新于/);
 assert.equal(nodes.error.hidden,true);
});
test('missing optional timestamp cannot stop account list rendering',async()=>{
 const nodes=await loadPage({missingUpdated:true});
 assert.equal(nodes.rows.children.length,1);
 assert.equal(nodes.error.hidden,true);
});
test('a real API failure is reported as a read failure rather than a page-render error',async()=>{
 const nodes=await loadPage({failApi:true});
 assert.match(nodes.error.textContent,/读取账号失败.*BACKEND_UNAVAILABLE/);
 assert.doesNotMatch(nodes.error.textContent,/页面显示异常/);
});
test('aggregate book picker offers sales, stock and egg',()=>{
 for(const key of ['sales','stock','egg'])assert.match(html,new RegExp('<option value="'+key+'">'));
});
test('account list and detail display egg book counts with the right name and ratio',async()=>{
 const nodes=await loadPage();
 assert.match(nodes.rows.textContent,/放蛋：2 物品 \/ 2 记录/);
 vm.runInContext('openDetail(ACCOUNTS[0])',nodes.context);
 assert.match(nodes['d-body'].textContent,/放蛋账本 · 2 物品 \/ 2 记录/);
 assert.match(nodes['d-body'].textContent,/总数 2 个 · 已完成 1 轮/);
 assert.match(nodes['d-body'].textContent,/比例 1/);
});
test('egg sum and difference results are labeled as egg rather than stock',async()=>{
 const nodes=await loadPage();
 for(const op of ['sum','diff']){
  vm.runInContext('renderAggregate('+JSON.stringify({book:'egg',op,users:[{username:'a'},{username:'b'}],rows:[{name:'奖品',values:[5,3],sum:8,diff:2}]})+')',nodes.context);
  assert.match(nodes['a-title'].textContent,/放蛋账本/);
  assert.doesNotMatch(nodes['a-title'].textContent,/库存/);
  assert.match(nodes['a-body'].textContent,op==='sum'?/合计/:/差值 A−B/);
 }
});

test('account detail loads the saved client recommendation and matching complete remaining list',async()=>{
 const egg=C.emptyEgg();C.eggAddItem(egg,'甲',3);C.eggAddItem(egg,'乙',2);
 egg.recommendation=C.eggCreatePlan(egg,{firstId:egg.items[1].id});
 const nodes=await loadPage({recommendation:JSON.parse(JSON.stringify(egg))});
 nodes.context.Core=C;vm.runInContext('loadRecommendationCore=async()=>Core',nodes.context);
 const target=new Element(),button=new Element();nodes.context.target=target;nodes.context.button=button;
 await vm.runInContext('loadAccountEggPlan(ACCOUNTS[0],target,button)',nodes.context);
 assert.match(target.textContent,/当前推荐：乙/);assert.match(target.textContent,/第 5 个/);assert.match(target.textContent,/本轮结束/);
 const list=target.children.find(e=>e.children.length===5);
 assert.deepEqual(list.children.map(e=>e.children[1].textContent),[...C.eggSavedSequence(egg.recommendation)].map(id=>egg.items.find(i=>i.id===id).name));
 assert.equal(button.disabled,false);
});
test('unsynchronized accounts show a clear placeholder rather than another random plan',async()=>{
 const nodes=await loadPage();nodes.context.Core=C;vm.runInContext('loadRecommendationCore=async()=>Core',nodes.context);
 const target=new Element(),button=new Element();nodes.context.target=target;nodes.context.button=button;
 await vm.runInContext('loadAccountEggPlan(ACCOUNTS[0],target,button)',nodes.context);
 assert.match(target.textContent,/尚未同步/);assert.doesNotMatch(target.textContent,/当前推荐：/);
});

test('timestamps handle ISO offsets and milliseconds and always show Beijing seconds',async()=>{
 const nodes=await loadPage();
 assert.equal(vm.runInContext("fmtDate('2026-11-01T02:07:51.206317+00:00')",nodes.context),'2026-11-01 10:07:51');
 assert.equal(vm.runInContext("fmtDate('2026-11-01T02:07:51Z')",nodes.context),'2026-11-01 10:07:51');
 assert.equal(vm.runInContext("fmtDate(Date.parse('2026-11-01T02:07:51Z'))",nodes.context),'2026-11-01 10:07:51');
});
test('manual refresh detects ledger changes and later metadata saves do not erase the ledger-change notice',async()=>{
 const nodes=await loadPage();
 Object.assign(nodes.sourceAccount,{data_fingerprint:'original'});await vm.runInContext('load()',nodes.context);
 Object.assign(nodes.sourceAccount,{data_fingerprint:'changed',revision:4});
 nodes.sourceAccount.books.egg.records=3;nodes.sourceAccount.books.egg.total=3;
 await nodes['reload-top'].listeners.click();
 assert.match(nodes.rows.textContent,/检测到账本变动/);assert.match(nodes.rows.textContent,/放蛋记录 2→3/);
 assert.match(nodes.changes.textContent,/1 个账号账本变动/);
 nodes.sourceAccount.revision=5;nodes.sourceAccount.recommendation_synced_at=1793491200000;
 await vm.runInContext('load()',nodes.context);
 assert.match(nodes.changes.textContent,/1 个账号仅推荐或保存状态更新/);
 assert.match(nodes.rows.textContent,/检测到账本变动/);
});
test('automatic refresh observes updates, can be paused and skips hidden pages',async()=>{
 const nodes=await loadPage();
 nodes.sourceAccount.revision=4;
 await nodes.timers[0]();assert.match(nodes.rows.textContent,/检测到同步更新/);
 nodes['auto-refresh'].checked=false;nodes.sourceAccount.revision=5;
 await nodes.timers[0]();assert.match(nodes.rows.textContent,/rev 4/);
 nodes['auto-refresh'].checked=true;nodes.context.document.visibilityState='hidden';
 await nodes.timers[0]();assert.match(nodes.rows.textContent,/rev 4/);
 nodes.context.document.visibilityState='visible';await nodes.timers[0]();assert.match(nodes.rows.textContent,/rev 5/);
});
test('refreshing an open account detail updates its quantities and version state',async()=>{
 const nodes=await loadPage();vm.runInContext('openDetail(ACCOUNTS[0])',nodes.context);
 nodes.sourceAccount.revision=4;nodes.sourceAccount.books.egg.total=7;nodes.sourceAccount.recommendation_version=2;
 await nodes['d-refresh'].listeners.click();
 assert.match(nodes['d-body'].textContent,/总数 7 个/);assert.match(nodes['d-body'].textContent,/整轮推荐已同步/);
 assert.equal(nodes['d-refresh'].disabled,false);
});


test('all three books copy separate multi-account results including negative totals and account order',async()=>{
 const nodes=await loadPage();let copied='';nodes.context.capture=text=>{copied=text;return true;};
 vm.runInContext('copyText=async text=>capture(text)',nodes.context);
 for(const book of ['egg','sales','stock'])for(const op of ['sum','diff']){
  const data={book,op,users:[{username:'甲'},{username:'乙'},{username:'丙'}],rows:[{name:'奖品',values:[5,3,4],sum:12,diff:-2}]};
  vm.runInContext('renderAggregate('+JSON.stringify(data)+')',nodes.context);
  const copy=nodes['a-body'].children.find(e=>e.textContent==='一键复制结果');assert.ok(copy);await copy.listeners.click();
  assert.match(copied,op==='diff'?/甲 − 乙 − 丙/:/甲 \+ 乙 \+ 丙/);
  assert.match(copied,op==='diff'?/总计\t-2/:/总计\t12/);
  assert.match(copied,new RegExp({egg:'放蛋',sales:'销售',stock:'库存'}[book]+'账本'));
 }
});
