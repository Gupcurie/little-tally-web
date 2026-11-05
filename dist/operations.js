import * as C from './core.js';
export function applyBundle(state,ids){
 if(!Array.isArray(ids)||ids.length<1||ids.length>10)throw Error('每组请选择1至10件物品。');
 const groupId=C.uid(),bytes=new Uint32Array(1);crypto.getRandomValues(bytes);const groupColor=['#d92f4b','#7262b4','#277e78','#aa6330','#397bb2','#a14c85'][bytes[0]%6];
 for(const id of ids){const before=state.sales.records.length;C.mutateBoundBook(state,'sales',book=>C.change(book,id,1));for(const record of state.sales.records.slice(before))Object.assign(record,{groupId,groupColor,groupSize:ids.length});}
 return groupId;
}
export function segmentSummary(state){
 return Object.fromEntries(['sales','stock','egg'].map(key=>{const book=state[key]||C.emptyEgg(),counts=key==='egg'?C.eggCounts(book):C.counts(book);return [key,{items:book.items.map(i=>({name:i.name,ratio:i.ratio||1,quantity:counts[i.id]||0,...(key==='stock'?{breakdown:{...i.breakdown}}:{})})),total:C.sum(book.items.map(i=>counts[i.id]||0))}];}));
}
export function newSegment(current,{inherit=[],books=[],now=Date.now()}={}){
 const next=C.clone(current);next.periodStartedAt=now;
 for(const key of ['sales','stock','egg']){
  const book=key==='egg'?C.ensureEgg(next):next[key];book.records=[];book.goal=null;
  if(key==='egg')delete book.recommendation;else for(const i of book.items)i.breakdown=Object.fromEntries(Object.keys(i.breakdown||{}).map(k=>[k,0]));
  if(!books.includes(key))continue;
  const totals=new Map();for(const period of inherit)for(const i of period.summary?.[key]?.items||[]){const old=totals.get(i.name)||{item:i,total:0,parts:{}};old.total+=i.quantity;if(key==='stock')for(const [part,n] of Object.entries(i.breakdown||{}))Object.defineProperty(old.parts,part,{value:(Object.hasOwn(old.parts,part)?old.parts[part]:0)+n,writable:true,enumerable:true,configurable:true});totals.set(i.name,old);}
  for(const [name,{item,total,parts}] of totals){
   if(!Number.isSafeInteger(total)||total<0||total>C.MAX)throw Error('继承数量超过上限。');
   let target=book.items.find(i=>i.name===name);if(!target){if(key==='egg')C.eggAddItem(book,name,item.ratio||1);else C.addItem(book,name);target=book.items.at(-1);}
   if(key==='egg')C.eggSetCount(book,target.id,total);else{C.setCount(book,target.id,total);if(key==='stock')target.breakdown=parts;}
  }
 }
 C.validateState(next);C.validateEgg(C.ensureEgg(next));return next;
}
export function selectPeriods(periods,start,end){
 const from=Date.parse(start+'T00:00:00+08:00'),to=Date.parse(end+'T23:59:59.999+08:00');
 if(!Number.isFinite(from)||!Number.isFinite(to)||from>to)throw Error('请选择有效的起止日期。');
 return periods.filter(p=>p.endedAt>=from&&p.endedAt<=to);
}
