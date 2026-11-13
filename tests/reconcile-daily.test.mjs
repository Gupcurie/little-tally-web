import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileDaily,dayBounds,mergeAliases,sortSimilarRows,dailyMarkup} from '../dist/reconcile-daily.js';
import * as C from '../dist/core.js';
import {newSegment} from '../dist/operations.js';
const now=Date.parse('2026-11-14T12:00:00+08:00'),start=dayBounds(now).start;
function book(sequence,offset=0){const names=[...new Set(sequence)],items=names.map((name,i)=>({id:'i'+i,name}));return {items,records:sequence.map((name,i)=>({id:'r'+i,itemId:items.find(it=>it.name===name).id,delta:1,at:start+8*3600000+offset+i*10000}))};}
test('the exact user example matches all six shuffled sales and isolates the missing fourth egg',()=>{
 const egg=book(['鼠标垫','便利贴','支架','娃衣','拼图','冰箱贴','盆栽']),sales=book(['支架','鼠标垫','便利贴','盆栽','拼图','冰箱贴'],60000);
 const result=reconcileDaily(egg,sales,{now});assert.equal(result.matched,6);assert.equal(result.waiting,1);assert.equal(result.unmatched,0);assert.equal(result.issues.length,1);
 const issue=result.issues[0],location=issue.locations[0];assert.equal(issue.name,'娃衣');assert.equal(location.position,4);assert.equal(location.at,egg.records[3].at);assert.equal(location.from,egg.records[2].at);assert.equal(location.to,egg.records[4].at);assert.equal(location.bounded,true);
 sales.items.push({id:'late','name':'娃衣'});sales.records.push({id:'late',itemId:'late',delta:1,at:now-1});const corrected=reconcileDaily(egg,sales,{now});assert.equal(corrected.status,'ok');assert.equal(corrected.issues.length,0);
});
test('all shuffled category orders match by quantities beyond the old 20-item cutoff',()=>{
 const egg=book(['甲','乙','丙']);egg.records[0].delta=100;
 const sales=book(['丙','乙','甲']);sales.records[2].delta=100;
 const result=reconcileDaily(egg,sales,{now});assert.equal(result.matched,102);assert.equal(result.status,'ok');
});
test('matching respects multiplicities and total balance never masks swapped item counts',()=>{
 const result=reconcileDaily(book(['甲','甲','乙']),book(['甲','乙','乙']),{now});assert.equal(result.eggs,result.sales);assert.equal(result.matched,2);assert.equal(result.waiting,1);assert.equal(result.unmatched,1);assert.equal(result.issues.length,2);
});
test('Beijing day excludes yesterday and future records, includes the first record before opening comparison',()=>{
 const egg=book(['甲','甲','甲']);egg.records[0].at=start-1;egg.records[2].at=now+1;assert.equal(reconcileDaily(egg,book([]),{now}).eggs,1);
 assert.equal(dayBounds(Date.parse('2026-11-13T16:00:00Z')).day,'2026-11-14');
});
test('today archives are combined, inherited openings excluded and duplicated record ids counted once',()=>{
 const archived=book(['甲']),current=structuredClone(archived);current.records.push({id:'inherited',itemId:'i0',delta:10,at:now-2,origin:'inherit'});current.records.push({id:'current',itemId:'i0',delta:1,at:now-1});
 const result=reconcileDaily([archived,current],book(['甲','甲']),{now});assert.equal(result.eggs,2);assert.equal(result.matched,2);
});
test('reductions undo recent entries and negative daily adjustments remain visible',()=>{
 const egg=book(['甲','甲']);egg.records.push({id:'undo',itemId:'i0',delta:-1,at:now-2});assert.equal(reconcileDaily(egg,book(['甲']),{now}).status,'ok');
 const sales=book(['乙']);sales.records[0].delta=-2;const result=reconcileDaily(book([]),sales,{now});assert.equal(result.sales,-2);assert.equal(result.correction,2);assert.match(dailyMarkup(result),/负数会如实显示/);
});
test('manual aliases support one-to-many names, transitive merging and Unicode normalization',()=>{
 let aliases=mergeAliases([],'掼蛋','掼蛋纸牌');aliases=mergeAliases(aliases,'掼蛋纸牌','掼蛋牌');
 const result=reconcileDaily(book(['掼蛋','Ｔ恤']),book(['掼蛋牌','T恤']),{now,aliases});assert.equal(result.matched,2);assert.equal(result.status,'ok');assert.equal(reconcileDaily(book(['掼蛋']),book(['掼蛋纸牌']),{now}).matched,0);
});
test('related labels become adjacent without being auto-merged',()=>{
 const rows=['支架','娃衣','磁吸支架','掼蛋纸牌','盆栽','掼蛋'].map(name=>({name})),sorted=sortSimilarRows(rows).map(r=>r.name);
 assert.equal(Math.abs(sorted.indexOf('支架')-sorted.indexOf('磁吸支架')),1);assert.equal(Math.abs(sorted.indexOf('掼蛋')-sorted.indexOf('掼蛋纸牌')),1);
});
test('repeated categories retain alternative locations instead of claiming one exact event',()=>{
 const result=reconcileDaily(book(['甲','娃衣','乙','娃衣','丙']),book(['甲','乙','娃衣','丙'],60000),{now}),issue=result.issues[0];assert.equal(issue.name,'娃衣');assert.equal(issue.candidateCount,2);assert.equal(issue.ambiguous,true);assert.equal(issue.ranked,true);assert.match(dailyMarkup(result),/多个可能位置/);
});
test('large bulk counts stay compressed and pending tolerance is global',()=>{
 const egg=book(['甲','乙']);egg.records[0].delta=999999999;egg.records[1].delta=12;
 const sale=book(['甲']);sale.records[0].delta=999999990;
 const result=reconcileDaily(egg,sale,{now});assert.equal(result.waiting,21);assert.equal(result.overBuffer,true);assert.equal(result.issues[0].locations.length,1);
});
test('new segments mark opening inheritance and retain comparison aliases',()=>{
 const state=C.initialState();C.ensureEgg(state);state.reconciliation={version:1,enabled:true,at:0,egg:{lastId:null,excluded:[],quantities:{}},sales:{lastId:null,excluded:[],quantities:{}},aliases:[['掼蛋','掼蛋纸牌']]};
 const next=newSegment(state,{now,books:['sales'],inherit:[{summary:{sales:{items:[{name:'甲',quantity:5}]}}}]});assert.deepEqual(next.reconciliation.aliases,state.reconciliation.aliases);assert.equal(next.sales.records[0].origin,'inherit');assert.equal(reconcileDaily(next.egg,next.sales,{now:Date.now()}).sales,0);
});
test('rendered candidate labels and alias names are escaped',()=>{
 const result=reconcileDaily(book(['<img onerror=alert(1)>']),book([]),{now});assert.doesNotMatch(dailyMarkup(result),/<img/);
});
test('reported bracket is the narrowest compatible pair among all unique surrounding anchors',()=>{
 const names=['前甲','前乙','前丙','缺项','后甲','后乙','后丙'];let seed=71;
 for(let trial=0;trial<40;trial++){
  const salesNames=names.filter(n=>n!=='缺项');for(let i=salesNames.length-1;i>0;i--){seed=(seed*1664525+1013904223)>>>0;const j=seed%(i+1);[salesNames[i],salesNames[j]]=[salesNames[j],salesNames[i]];}
  const egg=book(names),sales=book(salesNames,60000),location=reconcileDaily(egg,sales,{now}).issues[0].locations[0];let minimum=Infinity;
  for(let i=0;i<3;i++)for(let j=4;j<names.length;j++)if(salesNames.indexOf(names[i])<salesNames.indexOf(names[j]))minimum=Math.min(minimum,egg.records[j].at-egg.records[i].at);
  if(Number.isFinite(minimum)){assert.equal(location.bounded,true);assert.equal(location.to-location.from,minimum);}else assert.equal(location.bounded,false);
 }
});
test('ordinary repeated balanced items supply explicitly estimated ranges, with alternatives retained',()=>{
 const result=reconcileDaily(book(['鼠标垫','娃衣','支架','贴纸','鼠标垫','娃衣','支架','贴纸']),book(['支架','鼠标垫','贴纸','鼠标垫','支架','娃衣','贴纸'],60000),{now});
 const issue=result.issues.find(i=>i.name==='娃衣');assert.equal(issue.candidateCount,2);assert.equal(issue.ambiguous,true);assert.ok(issue.locations.some(l=>l.bounded&&l.estimated));assert.match(dailyMarkup(result),/前后含重复品类/);
});
