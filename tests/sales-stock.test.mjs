import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as C from '../dist/core.js';

function fixture(stock=10,sales=0){
 const state={...C.initialState(),sales:C.emptyBook('sales'),stock:C.emptyBook('stock')};
 C.addItem(state.sales,'甲');C.addItem(state.stock,'甲');
 const sale=state.sales.items[0].id,item=state.stock.items[0].id;
 C.setCount(state.stock,item,stock);C.setCount(state.sales,sale,sales);
 return {state,sale,item};
}
const quantities=s=>[C.total(s.sales),C.total(s.stock)];
const sell=(s,id,n=1)=>C.mutateBoundBook(s,'sales',b=>C.change(b,id,n));

test('binding defaults off and ordinary sales or inventory changes remain independent',()=>{
 const {state,sale,item}=fixture();assert.equal(C.salesStockEnabled(state),false);
 sell(state,sale);assert.deepEqual(quantities(state),[1,10]);
 C.mutateBoundBook(state,'stock',b=>C.change(b,item,1));assert.deepEqual(quantities(state),[1,11]);
});
test('enabling matches equal names without replaying past sales or changing quantities',()=>{
 const {state,sale,item}=fixture(10,3),before=[state.sales.records.length,state.stock.records.length];
 C.setSalesStockEnabled(state,true);
 assert.deepEqual(quantities(state),[3,10]);assert.deepEqual([state.sales.records.length,state.stock.records.length],before);
 assert.deepEqual(C.salesStockPair(state,sale),{stockId:item,part:null});
});
test('new sales and sales reductions update inventory in one paired transaction',()=>{
 const {state,sale}=fixture();C.setSalesStockEnabled(state,true);
 sell(state,sale);assert.deepEqual(quantities(state),[1,9]);
 const a=state.sales.records.at(-1),b=state.stock.records.at(-1);
 assert.ok(a.bindingId);assert.equal(a.bindingId,b.bindingId);assert.equal(a.at,b.at);assert.notEqual(a.id,b.id);
 sell(state,sale,-1);assert.deepEqual(quantities(state),[0,10]);C.validateState(state);
});
test('inventory additions, reductions and manual counts never change sales while binding is enabled',()=>{
 const {state,sale,item}=fixture();C.setSalesStockEnabled(state,true);
 sell(state,sale);
 C.mutateBoundBook(state,'stock',b=>C.change(b,item,1));assert.deepEqual(quantities(state),[1,10]);
 C.mutateBoundBook(state,'stock',b=>C.change(b,item,-1));assert.deepEqual(quantities(state),[1,9]);
 C.mutateBoundBook(state,'stock',b=>C.setCount(b,item,20));assert.deepEqual(quantities(state),[1,20]);
});
test('manual sales corrections mirror only their delta and turning binding off stops future coupling',()=>{
 const {state,sale,item}=fixture();C.setSalesStockEnabled(state,true);
 C.mutateBoundBook(state,'sales',b=>C.setCount(b,sale,3));assert.deepEqual(quantities(state),[3,7]);
 C.mutateBoundBook(state,'sales',b=>C.setCount(b,sale,1));assert.deepEqual(quantities(state),[1,9]);
 C.setSalesStockEnabled(state,false);sell(state,sale);assert.deepEqual(quantities(state),[2,9]);
 C.mutateBoundBook(state,'stock',b=>C.change(b,item,1));assert.deepEqual(quantities(state),[2,10]);
});
test('insufficient inventory leaves both books and all their records completely unchanged',()=>{
 const {state,sale}=fixture(0);C.setSalesStockEnabled(state,true);const before=C.clone(state);
 assert.throws(()=>sell(state,sale),/库存不足/);assert.deepEqual(state,before);
});
test('returning a sale cannot overflow inventory and a failed return preserves both books',()=>{
 const {state,sale}=fixture(C.MAX,1);C.setSalesStockEnabled(state,true);const before=C.clone(state);
 assert.throws(()=>sell(state,sale,-1),/库存数量超出上限/);assert.deepEqual(state,before);
});
test('missing matching inventory refuses a sale; manual mappings survive renaming',()=>{
 const {state,sale,item}=fixture();state.stock.items[0].name='不同名字';C.setSalesStockEnabled(state,true);
 const before=C.clone(state);assert.throws(()=>sell(state,sale),/尚未绑定/);assert.deepEqual(state,before);
 C.setSalesStockPair(state,sale,item);state.sales.items[0].name='改名销售';state.stock.items[0].name='改名库存';
 sell(state,sale);assert.deepEqual(quantities(state),[1,9]);
 C.setSalesStockPair(state,sale,null);assert.throws(()=>sell(state,sale),/尚未绑定/);
});
test('specified stock subparts are consumed and restored while unclassified shortages are rejected',()=>{
 const {state,sale,item}=fixture();C.setPart(state.stock,item,'未拆',4);C.setPart(state.stock,item,'已拆',6);C.setSalesStockEnabled(state,true);
 const before=C.clone(state);assert.throws(()=>sell(state,sale),/未分类库存不足/);assert.deepEqual(state,before);
 C.setSalesStockPair(state,sale,item,'已拆');sell(state,sale);
 assert.deepEqual(quantities(state),[1,9]);assert.deepEqual(state.stock.items[0].breakdown,{'未拆':4,'已拆':5});
 sell(state,sale,-1);assert.deepEqual(quantities(state),[0,10]);assert.equal(state.stock.items[0].breakdown['已拆'],6);
});
test('a depleted selected subpart cannot silently consume a different subpart',()=>{
 const {state,sale,item}=fixture();C.setPart(state.stock,item,'未拆',10);C.setPart(state.stock,item,'已拆',0);
 C.setSalesStockEnabled(state,true);C.setSalesStockPair(state,sale,item,'已拆');const before=C.clone(state);
 assert.throws(()=>sell(state,sale),/已拆.*库存不足/);assert.deepEqual(state,before);
});
test('deleting a linked sale reverses its original inventory movement even after unbinding',()=>{
 const {state,sale,item}=fixture();C.setPart(state.stock,item,'可售',10);C.setSalesStockEnabled(state,true);C.setSalesStockPair(state,sale,item,'可售');
 sell(state,sale);const id=state.sales.records.at(-1).id;C.setSalesStockEnabled(state,false);
 C.deleteBoundRecords(state,'sales',new Set([id]));assert.deepEqual(quantities(state),[0,10]);
 assert.equal(state.stock.items[0].breakdown['可售'],10);assert.ok(state.stock.records.every(r=>!r.bindingId));
});
test('old unlinked sales can be deleted without inventing an inventory return',()=>{
 const {state}=fixture(10,2),id=state.sales.records[0].id;C.setSalesStockEnabled(state,true);
 C.deleteBoundRecords(state,'sales',new Set([id]));assert.deepEqual(quantities(state),[0,10]);
});
test('inventory-side deletion of a sale movement is blocked without changing sales',()=>{
 const {state,sale}=fixture();C.setSalesStockEnabled(state,true);sell(state,sale);const before=C.clone(state);
 assert.throws(()=>C.deleteBoundRecords(state,'stock',new Set([state.stock.records.at(-1).id])),/销售历史撤销/);assert.deepEqual(state,before);
});
test('batch undo combines subpart deltas before validation, including an earlier return followed by resale',()=>{
 const {state,sale,item}=fixture(10,1);C.setPart(state.stock,item,'已拆',0);C.setSalesStockEnabled(state,true);C.setSalesStockPair(state,sale,item,'已拆');
 sell(state,sale,-1);sell(state,sale,1);
 const ids=new Set(state.sales.records.filter(r=>r.bindingId).map(r=>r.id));C.deleteBoundRecords(state,'sales',ids);
 assert.deepEqual(quantities(state),[1,10]);assert.equal(state.stock.items[0].breakdown['已拆'],0);
});
test('deleting a category keeps the other book quantities and detaches historical associations',()=>{
 for(const side of ['sales','stock']){
  const {state,sale,item}=fixture();C.setSalesStockEnabled(state,true);sell(state,sale);
  const before=C.total(state[side==='sales'?'stock':'sales']);
  C.mutateBoundBook(state,side,b=>C.deleteItem(b,side==='sales'?sale:item));
  assert.equal(C.total(state[side==='sales'?'stock':'sales']),before);
  assert.ok(state[side==='sales'?'stock':'sales'].records.every(r=>!r.bindingId));C.validateState(state);
 }
});
test('independent book imports establish a baseline without replaying or reversing old linked sales',()=>{
 const {state,sale}=fixture();C.setSalesStockEnabled(state,true);sell(state,sale);
 const stock=C.emptyBook('stock');C.addItem(stock,'甲');C.setCount(stock,stock.items[0].id,12);
 C.replaceBoundBook(state,'stock',stock);assert.deepEqual(quantities(state),[1,12]);
 assert.ok(state.sales.records.every(r=>!r.bindingId));assert.equal(C.salesStockPair(state,sale).stockId,null);C.validateState(state);
});
test('many sales may map to one inventory pool and multi-record edits are atomic',()=>{
 const {state,sale,item}=fixture(1);C.addItem(state.sales,'乙');const second=state.sales.items[1].id;
 C.setSalesStockEnabled(state,true);C.setSalesStockPair(state,second,item);const before=C.clone(state);
 assert.throws(()=>C.mutateBoundBook(state,'sales',b=>{C.change(b,sale,1);C.change(b,second,1);}),/库存不足/);
 assert.deepEqual(state,before);
 C.mutateBoundBook(state,'stock',b=>C.setCount(b,item,2));
 C.mutateBoundBook(state,'sales',b=>{C.change(b,sale,1);C.change(b,second,1);});assert.deepEqual(quantities(state),[2,0]);
});
test('reserved-looking item IDs cannot mutate pair-map prototypes',()=>{
 const {state,item}=fixture();state.sales.items[0].id='__proto__';C.setSalesStockEnabled(state,true);
 assert.ok(Object.hasOwn(state.salesStockBinding.pairs,'__proto__'));
 assert.equal(Object.getPrototypeOf(state.salesStockBinding.pairs),Object.prototype);
 sell(state,'__proto__');assert.equal(C.counts(state.stock)[item],9);
});

const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
test('the actual settings view shows a default-off switch and mapping/part selectors after enabling',()=>{
 const {state}=fixture(),context=vm.createContext({C,ledger:{state,readOnly:false},e:String,fmt:String});
 vm.runInContext(source.slice(source.indexOf('function salesStockSettingsView('),source.indexOf('function localSettingsView(')),context);
 assert.match(context.salesStockSettingsView(),/开启绑定/);assert.match(context.salesStockSettingsView(),/当前关闭/);
 C.setSalesStockEnabled(state,true);const markup=context.salesStockSettingsView();
 assert.match(markup,/关闭绑定/);assert.match(markup,/data-binding-sales=/);assert.match(markup,/data-binding-part=/);assert.match(markup,/库存加减和盘点不改销售/);
});
test('the actual page mutation saves both books in one commit',async()=>{
 const {state,sale}=fixture();C.setSalesStockEnabled(state,true);let saved=C.clone(state),commits=0;
 const context=vm.createContext({C,state:{book:'sales',ratioPlan:null},eggPlanSyncTimer:null,eggPlanSyncTask:null,clearTimeout:()=>{},render:()=>{},
  ledger:{commit:async fn=>{const next=C.clone(saved);fn(next);C.validateState(next);saved=next;commits++;}}});
 vm.runInContext(source.slice(source.indexOf('async function mutateState('),source.indexOf('function loadRatio(')),context);
 await context.mutate(b=>C.change(b,sale,1));assert.equal(commits,1);assert.deepEqual(quantities(saved),[1,9]);
});
test('sales copy uses current card quantities across dates instead of operation deltas',()=>{
 const {state,sale}=fixture();const now=Date.parse('2026-11-01T00:10:00+08:00');
 state.sales.records=[
  {id:C.uid(),itemId:sale,delta:2,kind:'count',at:Date.parse('2026-10-31T23:59:59+08:00')},
  {id:C.uid(),itemId:sale,delta:3,kind:'count',at:Date.parse('2026-11-01T00:00:00+08:00')},
  {id:C.uid(),itemId:sale,delta:-1,kind:'count',at:now-1000},
  {id:C.uid(),itemId:sale,delta:4,kind:'set',at:now}];
 const ctx=vm.createContext({C,ledger:{state},fmt:String});
 vm.runInContext(source.slice(source.indexOf('function currentSalesReport('),source.indexOf('async function copyCountReport(')),ctx);
 const text=ctx.currentSalesReport(state.sales,now);
 assert.match(text,/统计时间：/);assert.match(text,/合计：8 件/);assert.doesNotMatch(text,/退回|手动改数|净增|累计/);
 assert.match(text,/甲：8 件/);
});
test('count screens label their own copy report and only sales highlights the latest recorded item',()=>{
 const {state,sale}=fixture();C.addItem(state.sales,'乙');C.setCount(state.sales,sale,1);
 C.setCount(state.sales,state.sales.items[1].id,1);state.sales.records.at(-1).at-=86400000;
 const ctx=vm.createContext({C,state:{book:'sales',books:{sales:true,stock:true}},ledger:{},workspaceLabel:()=>'',book:()=>state.sales,fmt:String,e:String,localMode:false,icon:()=>'',
  color:()=>'',goalBanner:()=>'',empty:()=>'',timeBadge:()=>''});
 vm.runInContext(source.slice(source.indexOf('function countView('),source.indexOf('function goalBanner(')),ctx);
 const salesMarkup=ctx.countView();assert.match(salesMarkup,/data-action="copy-count-report"/);assert.equal((salesMarkup.match(/sales-flash/g)||[]).length,1);
 assert.match(salesMarkup,new RegExp('class="item-card sales-flash"><button[^>]+data-id="'+sale+'"'));
 ctx.state.book='stock';ctx.book=()=>state.stock;
 const stockMarkup=ctx.countView();assert.match(stockMarkup,/data-action="copy-count-report"/);assert.match(stockMarkup,/复制库存/);assert.doesNotMatch(stockMarkup,/复制销售/);assert.doesNotMatch(stockMarkup,/sales-flash|recommended/);
});
test('count copy follows the active book and handles clipboard denial',async()=>{
 const {state,sale,item}=fixture();C.change(state.sales,sale,1);C.setCount(state.stock,item,88);
 let text='',fallback='',selected=false;
 const ctx=vm.createContext({C,ledger:{state},state:{book:'stock'},fmt:String,e:String,toast:()=>{},
  navigator:{clipboard:{writeText:async value=>{text=value;}}},showSheet:(title,body)=>{fallback=body;},requestAnimationFrame:fn=>fn(),
  sheetContent:{querySelector:()=>({focus(){},select(){selected=true;}})}});
 vm.runInContext(source.slice(source.indexOf('function currentSalesReport('),source.indexOf('function installHelp(')),ctx);
 await ctx.copyCountReport();assert.match(text,/当前库存情况/);assert.match(text,/88 件/);ctx.state.book='sales';await ctx.copyCountReport();assert.match(text,/当前销售情况/);assert.match(text,/合计：1 件/);assert.doesNotMatch(text,/88|退回/);
 ctx.navigator.clipboard.writeText=async()=>{throw Error('Denied');};await ctx.copyCountReport();
 assert.match(fallback,/当前销售情况/);assert.match(fallback,/readonly/);assert.equal(selected,true);
});


test('reducing a previous-day sale from two to zero copies zero, never minus two',async()=>{
 const {state,sale,item}=fixture();C.setCount(state.sales,sale,2);state.sales.records.at(-1).at-=86400000;C.change(state.sales,sale,-1);C.change(state.sales,sale,-1);C.setCount(state.stock,item,7);
 let text='';const ctx=vm.createContext({C,ledger:{state},state:{book:'sales'},fmt:String,e:String,navigator:{clipboard:{writeText:async value=>{text=value;}}},toast:()=>{}});
 vm.runInContext(source.slice(source.indexOf('function currentSalesReport('),source.indexOf('function installHelp(')),ctx);
 await ctx.copyCountReport();assert.match(text,/甲：0 件/);assert.match(text,/合计：0 件/);assert.doesNotMatch(text,/-2|−2|退回|净增/);
 ctx.state.book='stock';await ctx.copyCountReport();assert.match(text,/合计：7 件/);assert.match(text,/当前库存/);
});
