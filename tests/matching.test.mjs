import test from 'node:test';
import assert from 'node:assert/strict';
import {matchingItems,validMatching,coverage,prepareMatching,connectMatching,soloMatching,mappingMarkup} from '../dist/matching.js';
import {freshAccountState,DISMANTLE_ITEMS,PLACEMENT_ITEMS} from '../dist/presets.js';
import {reconcileDaily,dayBounds} from '../dist/reconcile-daily.js';
import {validateState,total} from '../dist/core.js';
const items={sales:[{id:'red',name:'红娃衣'},{id:'black',name:'黑娃衣'},{id:'s',name:'T恤'}],egg:[{id:'cloth',name:'娃衣'},{id:'e',name:'T恤'}]};
test('new account presets have the requested order, zero counts and independent IDs',()=>{
 const a=freshAccountState(),b=freshAccountState();validateState(a);
 assert.deepEqual(a.sales.items.map(i=>i.name),DISMANTLE_ITEMS);assert.deepEqual(a.stock.items.map(i=>i.name),DISMANTLE_ITEMS);assert.deepEqual(a.egg.items.map(i=>i.name),PLACEMENT_ITEMS);
 for(const k of ['sales','stock','egg']){assert.equal(total(a[k]),0);assert.equal(a[k].records.length,0);assert.notEqual(a[k].items[0].id,b[k].items[0].id);}
});
test('setup preconnects identical names but never guesses red and black into cloth',()=>{
 const config=prepareMatching(items);assert.equal(validMatching(config),true);assert.deepEqual(config.groups,[{sales:['s'],egg:['e']}]);assert.equal(coverage(items,config).complete,false);
 assert.match(mappingMarkup(items,config),/data-action="match-confirm" disabled/);
});
test('many sales to one placement and reverse multi-select fully cover categories',()=>{
 const many=connectMatching(prepareMatching(items),['red','black'],['cloth']);assert.equal(coverage(items,many).complete,true);
 const reverse=connectMatching(prepareMatching({sales:items.egg,egg:items.sales}),['cloth'],['red','black']);assert.equal(coverage({sales:items.egg,egg:items.sales},reverse).complete,true);
 assert.doesNotMatch(mappingMarkup(items,many),/data-action="match-confirm" disabled/);
});
test('reconnecting one side leaves the former partner unresolved until explicitly handled',()=>{
 let config=connectMatching(prepareMatching(items),['red','black'],['cloth']);config=connectMatching(config,['red'],['e']);
 assert.equal(coverage(items,config).complete,false);assert.deepEqual(coverage(items,config).missing.sales.map(i=>i.id),['s']);
 config=soloMatching(config,['s'],[]);assert.equal(coverage(items,config).complete,true);
 const changed={...items,egg:[...items.egg,{id:'new',name:'新物品'}]};assert.equal(coverage(changed,config).complete,false);assert.equal(validMatching({...config,groups:[...config.groups,config.groups[0]]}),false);
});
test('saved configuration survives renaming by IDs and drops deleted item IDs',()=>{
 const saved=connectMatching(prepareMatching(items),['red','black'],['cloth']);
 const renamed={...items,egg:items.egg.map(i=>({...i,name:'新名称'+i.id}))};assert.deepEqual(prepareMatching(renamed,saved),saved);
 const removed={...items,sales:items.sales.filter(i=>i.id!=='red')};const next=prepareMatching(removed,saved);assert.equal(coverage(removed,next).complete,true);assert.equal(JSON.stringify(next).includes('"red"'),false);
});
test('ID links sum different labels and preserve shuffled-sale anomaly localization',()=>{
 const now=Date.parse('2026-11-14T13:00:00+08:00'),at=dayBounds(now).start;
 const book=(list,sequence)=>({items:list,records:sequence.map((id,i)=>({id:'rec-'+list[0].id+i,itemId:id,delta:1,at:at+1000+i*1000}))});
 const eggs=book(items.egg,['e','cloth','cloth']),sales=book(items.sales,['black','s','red']);
 const config=connectMatching(prepareMatching(items),['red','black'],['cloth']);
 const r=reconcileDaily(eggs,sales,{now,links:config});assert.equal(r.matched,3);assert.equal(r.waiting,0);assert.equal(r.unmatched,0);
 const isolated=soloMatching(config,['red','black'],['cloth']);const q=reconcileDaily(eggs,sales,{now,links:isolated});assert.equal(q.matched,1);assert.equal(q.waiting,2);assert.equal(q.unmatched,2);
});
test('explicit singles with identical labels stay separate, markup escapes labels',()=>{
 const named={sales:[{id:'a',name:'<img>'}],egg:[{id:'b',name:'<img>'}]};const config={version:1,groups:[],singles:{sales:['a'],egg:['b']}};
 assert.equal(coverage(named,config).complete,true);assert.doesNotMatch(mappingMarkup(named,config),/<img>/);
 const now=Date.now(),book=(side)=>({items:named[side],records:[{id:side,itemId:named[side][0].id,delta:1,at:now}]});
 assert.equal(reconcileDaily(book('egg'),book('sales'),{now,links:config}).matched,0);
 assert.deepEqual(matchingItems({sales_books:[{items:named.sales},{items:[{id:'a',name:'修改后'}]}],egg_books:[]}).sales,[{id:'a',name:'修改后'}]);
});
