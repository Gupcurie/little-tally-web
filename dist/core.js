import {planSeed,planRandom} from './plan-random.js';
export const MAX = 999999999;
export const ZONE = 'Asia/Shanghai';
export const uid = () => {
 if(globalThis.crypto.randomUUID)return globalThis.crypto.randomUUID();
 const b=globalThis.crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
 const s=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
};
const names = ['娃衣','T恤','鼠标垫','扑克牌','掼蛋纸牌','盆栽','拼图','冰箱贴','便利贴'];
export const emptyBook = book => ({book,items:[],records:[],goal:null});
export function initialBook(book) { return {...emptyBook(book),items:names.map((name,i)=>({id:uid(),name,color:i,created:Date.now(),breakdown:book==='stock'&&name==='娃衣'?{'未拆':0,'已拆':0}:{}}))}; }
export function initialState(){ return {format:'little-tally-pocket',version:1,revision:0,sales:initialBook('sales'),stock:initialBook('stock')}; }
export const clone = value => structuredClone(value);
export function counts(book){const result=Object.fromEntries(book.items.map(i=>[i.id,0]));for(const r of book.records)result[r.itemId]=(result[r.itemId]||0)+r.delta;return result;}
export const sum = values => values.reduce((a,b)=>a+b,0);
export const total = book => sum(Object.values(counts(book)));
export const partsTotal = item => sum(Object.values(item.breakdown));
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const clockFormatters=[false,true].map(full=>new Intl.DateTimeFormat('zh-CN',{timeZone:ZONE,year:full?'numeric':undefined,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
const hourFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',hourCycle:'h23'});
export function day(at){return dayFormatter.format(at);}
export function clock(at,full=false){return clockFormatters[full?1:0].format(at);}
export function hour(at){return Number(hourFormatter.format(at));}
const minuteFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,minute:'2-digit',hourCycle:'h23'});
export function minute(at){return Number(minuteFormatter.format(at));}
export function todayRecords(book,now=Date.now()){const key=day(now);return book.records.filter(r=>day(r.at)===key);}
function requireThat(test,message){if(!test)throw new Error(message);}
function validID(value){return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);}
function validTime(value){return Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;}
export function numberInput(text){requireThat(typeof text==='string'&&/^\d+$/.test(text.trim()),'请输入 0 至 999999999 的整数。');const n=Number(text.trim());requireThat(Number.isSafeInteger(n)&&n>=0&&n<=MAX,'数量超出范围。');return n;}
export function validateBook(book){
 requireThat(book&&['sales','stock'].includes(book.book)&&Array.isArray(book.items)&&Array.isArray(book.records),'账本格式不正确。');
 requireThat(book.items.length<=200&&book.records.length<=200000,'物品或历史记录超过上限。');
 const ids=new Set(),labels=new Set(),recordIDs=new Set();
 for(const i of book.items){requireThat(i&&validID(i.id)&&!ids.has(i.id)&&typeof i.name==='string'&&i.name.trim().length>0&&i.name.length<=40&&!labels.has(i.name)&&validTime(i.created)&&Number.isSafeInteger(i.color),'物品数据无效，或名称／编号重复。');ids.add(i.id);labels.add(i.name);
  requireThat(i.breakdown&&typeof i.breakdown==='object'&&!Array.isArray(i.breakdown)&&Object.keys(i.breakdown).length<=30,'库存分项格式不正确。');
  for(const [k,v] of Object.entries(i.breakdown))requireThat(k.length>0&&k.length<=20&&k!=='未分类'&&Number.isSafeInteger(v)&&v>=0&&v<=MAX,'库存分项数据无效。');
  requireThat(book.book==='stock'||Object.keys(i.breakdown).length===0,'销售账本不能包含库存分项。');
 }
 for(const r of book.records){requireThat(r&&validID(r.id)&&!recordIDs.has(r.id)&&ids.has(r.itemId)&&Number.isSafeInteger(r.delta)&&Math.abs(r.delta)<=MAX&&validTime(r.at)&&['count','set'].includes(r.kind),'历史记录无效。');recordIDs.add(r.id);}
 for(const r of book.records){
  if(r.bindingId!==undefined)requireThat(validID(r.bindingId),'联动记录编号无效。');
  if(r.bindingPart!==undefined)requireThat(book.book==='stock'&&(r.bindingPart===null||typeof r.bindingPart==='string'&&r.bindingPart.length>0&&r.bindingPart.length<=20),'联动库存分项无效。');
 }
 const values=counts(book);for(const i of book.items)requireThat(values[i.id]>=0&&values[i.id]<=MAX&&Number.isSafeInteger(values[i.id])&&partsTotal(i)<=values[i.id],'总数不能为负、超过上限或小于库存分项合计。');
 if(book.goal)validateGoal(book,book.goal);
 return book;
}
export function validateState(state){
 requireThat(state&&state.format==='little-tally-pocket'&&state.version===1&&Number.isSafeInteger(state.revision)&&state.revision>=0&&state.sales?.book==='sales'&&state.stock?.book==='stock','本机记录格式不正确。');
 validateBook(state.sales);validateBook(state.stock);
 if(state.salesStockBinding!==undefined){
  const config=state.salesStockBinding;
  requireThat(config&&typeof config.enabled==='boolean'&&config.pairs&&typeof config.pairs==='object'&&!Array.isArray(config.pairs)&&Object.keys(config.pairs).length<=200,'销售库存绑定设置无效。');
  for(const [id,pair] of Object.entries(config.pairs))requireThat(validID(id)&&pair&&(pair.stockId===null||validID(pair.stockId))&&(pair.part===null||typeof pair.part==='string'&&pair.part.length>0&&pair.part.length<=20),'销售库存对应关系无效。');
 }
 for(const group of bindingGroups(state).values())requireThat(group.sales.length<=1&&group.stock.length<=1&&(!group.sales.length||!group.stock.length||group.sales[0].delta===-group.stock[0].delta),'销售库存联动记录不一致。');
 return state;
}
export function addItem(book,name){name=name.trim();requireThat(name.length>0&&name.length<=40&&!book.items.some(i=>i.name===name)&&book.items.length<200,'请输入不重复的名称，最多 40 字、200 类物品。');book.items.push({id:uid(),name,color:book.items.length,created:Date.now(),breakdown:{}});}
export function setCount(book,id,value,kind='set'){
 const item=book.items.find(i=>i.id===id);requireThat(item&&Number.isSafeInteger(value)&&value>=0&&value<=MAX&&value>=partsTotal(item),'数量不能为负、超过上限或低于分项合计。');
 const delta=value-counts(book)[id];if(delta===0)return;
 requireThat(book.records.length<200000,'记录已达上限，请先导出备份。');book.records.push({id:uid(),itemId:id,delta,at:Date.now(),kind});
}
export function change(book,id,delta){requireThat(delta===1||delta===-1,'加减步长无效。');setCount(book,id,counts(book)[id]+delta,'count');}
export function setPart(book,id,name,value){
 const item=book.items.find(i=>i.id===id);requireThat(book.book==='stock'&&item&&typeof name==='string'&&name.length>0&&name.length<=20&&name!=='未分类'&&Number.isSafeInteger(value)&&value>=0&&value<=MAX,'分项名称或数量无效。');
 requireThat(Object.hasOwn(item.breakdown,name)||Object.keys(item.breakdown).length<30,'最多 30 个库存分项。');
 const old=Object.hasOwn(item.breakdown,name)?item.breakdown[name]:0,delta=value-old,current=counts(book)[id],free=current-partsTotal(item);
 const next=current+(delta>0?Math.max(0,delta-free):delta);const before=clone(book);
 try{Object.defineProperty(item.breakdown,name,{value,writable:true,enumerable:true,configurable:true});setCount(book,id,next);validateBook(book);}catch(e){Object.assign(book,before);throw e;}
}
export function deletePart(book,id,name){const item=book.items.find(i=>i.id===id);requireThat(book.book==='stock'&&item,'找不到此库存物品。');delete item.breakdown[name];}
export function deleteItem(book,id){book.items=book.items.filter(i=>i.id!==id);book.records=book.records.filter(r=>r.itemId!==id);book.goal=null;}
export function deleteRecords(book,ids){const next={...book,records:book.records.filter(r=>!ids.has(r.id))};validateBook(next);book.records=next.records;}

export const salesStockEnabled=state=>state.salesStockBinding?.enabled===true;
function writeBindingPair(pairs,id,pair){Object.defineProperty(pairs,id,{value:pair,writable:true,enumerable:true,configurable:true});}
export function salesStockPair(state,salesId){
 const sale=state.sales.items.find(i=>i.id===salesId);if(!sale)return null;
 const pairs=state.salesStockBinding?.pairs||{};
 if(Object.hasOwn(pairs,salesId))return pairs[salesId];
 const stock=state.stock.items.find(i=>i.name===sale.name);
 return stock?{stockId:stock.id,part:null}:null;
}
function cleanSalesStockPairs(state){
 if(!state.salesStockBinding)return;
 const pairs=state.salesStockBinding.pairs;
 for(const id of Object.keys(pairs)){
  if(!state.sales.items.some(i=>i.id===id)){delete pairs[id];continue;}
  const item=state.stock.items.find(i=>i.id===pairs[id].stockId);
  if(!item)writeBindingPair(pairs,id,{stockId:null,part:null});
  else if(pairs[id].part!==null&&!Object.hasOwn(item.breakdown,pairs[id].part))pairs[id].part=null;
 }
}
export function setSalesStockEnabled(state,enabled){
 requireThat(typeof enabled==='boolean','请选择是否绑定。');
 const next=clone(state),pairs=next.salesStockBinding?.pairs||{};
 next.salesStockBinding={enabled,pairs};cleanSalesStockPairs(next);
 for(const item of next.sales.items)if(!Object.hasOwn(pairs,item.id)){
  const stock=next.stock.items.find(i=>i.name===item.name);if(stock)writeBindingPair(pairs,item.id,{stockId:stock.id,part:null});
 }
 validateState(next);state.salesStockBinding=next.salesStockBinding;
}
export function setSalesStockPair(state,salesId,stockId,part=null){
 requireThat(state.sales.items.some(i=>i.id===salesId),'找不到销售品类。');
 const stock=state.stock.items.find(i=>i.id===stockId);
 requireThat(stockId===null||stock,'请选择对应库存品类。');
 requireThat(part===null||stock&&Object.hasOwn(stock.breakdown,part),'请选择有效的库存分项。');
 const config=clone(state.salesStockBinding||{enabled:false,pairs:{}});
 writeBindingPair(config.pairs,salesId,{stockId,part:stockId===null?null:part});state.salesStockBinding=config;
}
function linkedStockChange(stock,itemId,part,delta,record){
 const item=stock.items.find(i=>i.id===itemId);requireThat(item,'对应库存品类不存在，请到设置重新绑定。');
 const current=counts(stock)[itemId],next=current+delta;
 requireThat(next>=0&&next<=MAX,delta<0?`${item.name}库存不足，这笔销售没有保存。`:'库存数量超出上限，这次销量调整没有保存。');
 if(part!==null){
  requireThat(Object.hasOwn(item.breakdown,part),'绑定库存分项已不存在，请到设置重新选择。');
  requireThat(item.breakdown[part]+delta>=0,`${item.name}的“${part}”库存不足，这笔销售没有保存。`);
  if(delta<0)item.breakdown[part]+=delta;
 }else requireThat(delta>=0||current-partsTotal(item)>=-delta,`${item.name}的未分类库存不足，请在设置中选择扣减分项。`);
 setCount(stock,itemId,next,record.kind);
 if(part!==null&&delta>0)item.breakdown[part]+=delta;
 const paired=stock.records.at(-1);paired.at=record.at;paired.bindingId=record.bindingId;paired.bindingPart=part;
}
function bindingGroups(state){
 const groups=new Map();
 for(const book of ['sales','stock'])for(const record of state[book].records)if(validID(record.bindingId)){
  if(!groups.has(record.bindingId))groups.set(record.bindingId,{sales:[],stock:[]});groups.get(record.bindingId)[book].push(record);
 }
 return groups;
}
export function mutateBoundBook(state,kind,mutator){
 requireThat(['sales','stock'].includes(kind),'请选择销售或库存账本。');
 const next=clone(state),before=state[kind],other=kind==='sales'?'stock':'sales';mutator(next[kind]);
 const retained=new Set(next[kind].records.map(r=>r.id)),removed=before.records.filter(r=>!retained.has(r.id)&&r.bindingId);
 const removedItems=new Set(before.items.filter(i=>!next[kind].items.some(j=>j.id===i.id)).map(i=>i.id));
 const groups=bindingGroups(state),undo=new Set(),detach=new Set();
 for(const record of removed){
  const group=groups.get(record.bindingId);if(!group||group.sales.length!==1||group.stock.length!==1||group.sales[0].delta!==-group.stock[0].delta)continue;
  if(removedItems.has(record.itemId)){detach.add(record.bindingId);continue;}
  requireThat(kind!=='stock','这是销售联动的库存记录，请到销售历史撤销；库存盘点可直接改数。');
  undo.add(record.bindingId);
 }
 // Deleting a whole category preserves the other book's historical quantities.
 for(const record of next[other].records)if(detach.has(record.bindingId)){delete record.bindingId;delete record.bindingPart;}
 const partAdjustments=new Map();
 for(const id of undo){
  const record=groups.get(id).stock[0],item=next.stock.items.find(i=>i.id===record.itemId);
  if(item&&record.bindingPart!==null&&Object.hasOwn(item.breakdown,record.bindingPart)){
   if(!partAdjustments.has(item.id))partAdjustments.set(item.id,new Map());
   const parts=partAdjustments.get(item.id);parts.set(record.bindingPart,(parts.get(record.bindingPart)||0)-record.delta);
  }
 }
 for(const [itemId,parts] of partAdjustments){const item=next.stock.items.find(i=>i.id===itemId);for(const [part,delta] of parts){requireThat(item.breakdown[part]+delta>=0,'撤销会让库存分项为负，这次操作没有保存。');item.breakdown[part]+=delta;}}
 if(undo.size)next.stock.records=next.stock.records.filter(r=>!undo.has(r.bindingId));
 cleanSalesStockPairs(next);
 if(kind==='sales'&&salesStockEnabled(next)){
  const known=new Set(before.records.map(r=>r.id));
  for(const record of next.sales.records)if(!known.has(record.id)&&record.delta!==0){
   const sale=next.sales.items.find(i=>i.id===record.itemId),pair=salesStockPair(next,record.itemId);
   requireThat(pair?.stockId,`${sale?.name||'此品类'}尚未绑定库存，请先到设置选择对应品类。`);
   writeBindingPair(next.salesStockBinding.pairs,record.itemId,pair);record.bindingId=uid();
   linkedStockChange(next.stock,pair.stockId,pair.part,-record.delta,record);
  }
 }
 validateState(next);Object.assign(state,next);return state;
}
export function deleteBoundRecords(state,kind,ids){
 return mutateBoundBook(state,kind,book=>{book.records=book.records.filter(r=>!ids.has(r.id));});
}
export function replaceBoundBook(state,kind,book){
 const next=clone(state);next[kind]=clone(book);
 // An independent book import is a new baseline, not a sale/return event.
 for(const key of ['sales','stock'])for(const record of next[key].records){delete record.bindingId;delete record.bindingPart;}
 cleanSalesStockPairs(next);validateState(next);Object.assign(state,next);
}
export function parseRatio(text,mode){
 requireThat(typeof text==='string'||typeof text==='number','请输入有效比例。');const value=String(text).trim().replace(',','.');
 if(mode==='parts'){requireThat(/^\d+$/.test(value),'份数须为整数。');const n=Number(value);requireThat(Number.isSafeInteger(n)&&n>0&&n<=1000000,'比例份数须为 1 至 1000000。');return n;}
 requireThat(mode==='percent'&&/^\d+(\.\d{1,2})?$/.test(value),'百分比最多保留两位小数。');const [a,b='']=value.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));requireThat(Number.isSafeInteger(n)&&n>0&&n<=10000,'百分比须大于 0 且不超过 100%。');return n;
}
export function validateGoal(book,goal){
 requireThat(goal&&['parts','percent'].includes(goal.mode)&&goal.values&&typeof goal.values==='object'&&!Array.isArray(goal.values),'固定目标格式无效。');const entries=Object.entries(goal.values);requireThat(entries.length>0&&entries.every(([id])=>book.items.some(i=>i.id===id)),'请勾选参与的物品。');const values=entries.map(([,v])=>parseRatio(v,goal.mode));
 if(goal.mode==='percent'){const p=sum(values);requireThat(p<=10000,'目标百分比合计超过 100%。');requireThat(entries.length!==book.items.length||p===10000,'已选择全部物品时，百分比合计须为 100%。');}
}
const gcd=(a,b)=>{while(b){[a,b]=[b,a%b];}return a;};
const ceilDiv=(a,b)=>Math.floor(a/b)+(a%b?1:0);
export function ratioPlan(book,goal){
 validateGoal(book,goal);const values=Object.fromEntries(Object.entries(goal.values).map(([id,v])=>[id,parseRatio(v,goal.mode)])),c=counts(book),current=sum(Object.values(c));
 if(goal.mode==='parts'){
  const order=book.items.filter(i=>Object.hasOwn(values,i.id)).map(i=>i.id).sort((a,b)=>values[b]-values[a]);let round=Math.max(1,...order.map(id=>Math.floor(c[id]/values[id])));
  if(order.every(id=>c[id]===round*values[id]))return {additions:{},other:0,total:current,added:0,note:'固定目标已达标'};
  if(order.every(id=>c[id]>=round*values[id]))round++;
  for(const id of order){const target=round*values[id],add=target-c[id];if(add>0){requireThat(target<=MAX,'此比例需要超过单项数量上限，请调整比例。');return {additions:{[id]:add},other:0,total:current+add,added:add,note:'本轮先补这一项，补完后自动判断下一项。'};}}
 }
 const selectedTotal=sum(Object.values(values)),otherCurrent=sum(Object.entries(c).filter(([id])=>!Object.hasOwn(values,id)).map(([,n])=>n));requireThat(selectedTotal<10000||otherCurrent===0,'其他物品已有数量，请为它们预留百分比。');
 let quantum=1,lower=0;
 for(const [id,p] of Object.entries(values)){const d=10000/gcd(p,10000);quantum=quantum/gcd(quantum,d)*d;lower=Math.max(lower,ceilDiv(c[id]*10000,p));}
 if(selectedTotal<10000)lower=Math.max(lower,ceilDiv(otherCurrent*10000,10000-selectedTotal));
 const target=ceilDiv(lower,quantum)*quantum,additions={};let selectedTarget=0;for(const [id,p] of Object.entries(values)){const g=gcd(p,10000),n=target/(10000/g)*(p/g);requireThat(Number.isSafeInteger(n)&&n<=MAX,'精确比例需要超过单项数量上限，请调整比例。');additions[id]=n-c[id];selectedTarget+=n;}
 const other=target-selectedTarget-otherCurrent;requireThat(Number.isSafeInteger(other)&&other>=0&&other<=(book.items.length-Object.keys(values).length)*MAX-otherCurrent,'其他物品的数量空间不足。');
 return {additions,other,total:target,added:sum(Object.values(additions))+other,note:target===current?'固定目标已达标':'仅增加数量，达到精确百分比的最小整数方案。'};
}
export function encodeBook(book){validateBook(book);return JSON.stringify({...book,format:'little-tally-android',version:3},null,2);}
export function decodeBackup(text,expected){
 requireThat(new TextEncoder().encode(text).length<=20*1024*1024,'备份不能超过 20 MB。');let b;try{b=JSON.parse(text);}catch{throw new Error('这不是有效的 JSON 备份。');}
 requireThat(['little-tally-android','little-tally-ios','little-tally-pocket-book'].includes(b?.format)&&Number.isInteger(b.version)&&b.version>0&&b.book===expected,'备份格式不正确，或选错了销售／库存账本。');
 requireThat(Array.isArray(b.items)&&Array.isArray(b.records),'备份缺少物品或历史。');
 const book={book:b.book,items:b.items.map(i=>({...i,color:i.color??0,breakdown:i.breakdown??{}})),records:b.records.map(r=>({...r,kind:r.kind??'count'})),goal:b.goal&&Object.keys(b.goal.values??{}).length?{mode:b.goal.mode,values:Object.fromEntries(Object.entries(b.goal.values).map(([k,v])=>[k,String(v)]))}:null};
 return validateBook(book);
}
// ---------------------------------------------------------------------------
// 放蛋：按比例排产的点数账本。
// 每个物品有一个比例（份数），每轮要求各拿满 ratio 个；多出来的自动计入下一轮。
// 推荐用“理想进度差额”排队：谁落后最多先给谁，天然把占比小的物品拉得更开。
// ---------------------------------------------------------------------------
export const EGG_ZONE = ZONE;
export function emptyEgg(){return {book:'egg',items:[],records:[],goal:null};}
export function ensureEgg(state){
 if(!state||typeof state!=='object')return emptyEgg();
 if(!state.egg||typeof state.egg!=='object')state.egg=emptyEgg();
 const egg=state.egg;
 if(!Array.isArray(egg.items))egg.items=[];
 if(!Array.isArray(egg.records))egg.records=[];
 if(!('goal' in egg))egg.goal=null;
 return egg;
}
export function validateEgg(egg){
 requireThat(egg&&egg.book==='egg'&&Array.isArray(egg.items)&&Array.isArray(egg.records),'放蛋账本格式不正确。');
 requireThat(egg.items.length<=200&&egg.records.length<=200000,'物品或记录超过上限。');
 const ids=new Set(),labels=new Set(),recordIDs=new Set();
 for(const i of egg.items){
  requireThat(i&&validID(i.id)&&!ids.has(i.id)&&typeof i.name==='string'&&i.name.trim().length>0&&i.name.length<=40&&!labels.has(i.name)&&validTime(i.created)&&Number.isSafeInteger(i.color),'放蛋物品数据无效，或名称／编号重复。');
  ids.add(i.id);labels.add(i.name);
  requireThat(Number.isSafeInteger(i.ratio)&&i.ratio>=1&&i.ratio<=1000000,'每个物品的比例须为 1 至 1000000 的整数。');
  if(i.photo!==undefined&&i.photo!==null){
   requireThat(typeof i.photo==='string'&&i.photo.startsWith('data:image/')&&i.photo.length<=400000,'图片数据无效或过大。');
  }
 }
 for(const r of egg.records){requireThat(r&&validID(r.id)&&!recordIDs.has(r.id)&&ids.has(r.itemId)&&Number.isSafeInteger(r.delta)&&Math.abs(r.delta)<=MAX&&validTime(r.at)&&['count','set'].includes(r.kind),'放蛋记录无效。');recordIDs.add(r.id);}
 const values=eggCounts(egg);
 for(const i of egg.items)requireThat(values[i.id]>=0&&values[i.id]<=MAX&&Number.isSafeInteger(values[i.id]),'放蛋数量不能为负或超过上限。');
 return egg;
}
export function eggCounts(egg){const result=Object.fromEntries(egg.items.map(i=>[i.id,0]));for(const r of egg.records)result[r.itemId]=(result[r.itemId]||0)+r.delta;return result;}
export function eggRound(egg){
 const participating=egg.items.filter(i=>Number(i.ratio)>0);
 if(!participating.length)return 0;
 const c=eggCounts(egg);
 return Math.min(...participating.map(i=>Math.floor(c[i.id]/i.ratio)));
}
export function eggProgress(egg){
 const c=eggCounts(egg),round=eggRound(egg);
 return egg.items.map(i=>{const progress=c[i.id]-round*i.ratio;return {id:i.id,name:i.name,ratio:i.ratio,count:c[i.id],round,progress,left:Math.max(0,i.ratio-progress),target:i.ratio,itemRound:round+1,itemProgress:progress,overflow:Math.max(0,progress-i.ratio)};});
}
export function eggRoundComplete(egg){return eggProgress(egg).every(p=>p.left===0);}
export function eggLastPlaced(egg){const sorted=egg.records.slice().sort((a,b)=>a.at-b.at);return sorted.length?sorted[sorted.length-1].itemId:null;}
export function eggLastChange(egg,itemId){
 const item=egg.items.find(i=>i.id===itemId);
 if(item&&validTime(item.lastAt))return item.lastAt;
 for(let k=egg.records.length-1;k>=0;k--){const r=egg.records[k];if(r.itemId===itemId&&r.kind!=='delete')return r.at;}
 return 0;
}
export function eggAddItem(egg,name,ratio=1){
 name=String(name??'').trim();
 requireThat(name.length>0&&name.length<=40&&!egg.items.some(i=>i.name===name)&&egg.items.length<200,'请输入不重复的名称，最多 40 字、200 个物品。');
 requireThat(Number.isSafeInteger(ratio)&&ratio>=1&&ratio<=1000000,'比例须为 1 至 1000000 的整数。');
 egg.items.push({id:uid(),name,color:egg.items.length,created:Date.now(),ratio,lastAt:Date.now()});
}
export function eggSetRatio(egg,id,ratio){
 const item=egg.items.find(i=>i.id===id);
 requireThat(item&&Number.isSafeInteger(ratio)&&ratio>=1&&ratio<=1000000,'比例须为 1 至 1000000 的整数。');
 item.ratio=ratio;
}
export function eggSetCount(egg,id,value){
 const item=egg.items.find(i=>i.id===id);
 requireThat(item&&Number.isSafeInteger(value)&&value>=0&&value<=MAX,'数量不能为负或超过上限。');
 const delta=value-eggCounts(egg)[id];if(delta===0)return;
 requireThat(egg.records.length<200000,'记录已达上限，请先导出备份。');
 egg.records.push({id:uid(),itemId:id,delta,at:Date.now(),kind:'set'});
 item.lastAt=Date.now();
}
export function eggChange(egg,id,delta){
 requireThat(delta===1||delta===-1,'加减步长无效。');
 const item=egg.items.find(i=>i.id===id);
 requireThat(item&&eggCounts(egg)[id]+delta>=0,'数量不能为负。');
 egg.records.push({id:uid(),itemId:id,delta,at:Date.now(),kind:'count'});
 item.lastAt=Date.now();
}
export function eggDeleteRecords(egg,ids){
 const next={...egg,records:egg.records.filter(r=>!ids.has(r.id))};
 const values=eggCounts(next);
 for(const i of next.items)requireThat(values[i.id]>=0,'会删成负数，已取消这次删除。');
 egg.records=next.records;
}
export function eggTotal(egg){const c=eggCounts(egg);return sum(egg.items.map(i=>c[i.id]));}
export function eggRename(egg,id,name){
 name=String(name??'').trim();
 const item=egg.items.find(i=>i.id===id);
 requireThat(item,'找不到这个物品。');
 requireThat(name.length>0&&name.length<=40,'名字需要 1 至 40 个字。');
 requireThat(!egg.items.some(i=>i.id!==id&&i.name===name),'已经有同名物品了。');
 item.name=name;
}
export function eggSetPhoto(egg,id,photo){
 const item=egg.items.find(i=>i.id===id);
 requireThat(item,'找不到这个物品。');
 if(photo===null){delete item.photo;return;}
 requireThat(typeof photo==='string'&&photo.startsWith('data:image/')&&photo.length<=400000,'图片数据无效或过大。');
 item.photo=photo;
}
export function eggDeleteItem(egg,id){
 egg.items=egg.items.filter(i=>i.id!==id);
 egg.records=egg.records.filter(r=>r.itemId!==id);
 if(egg.goal&&Object.keys(egg.goal.values||{}).includes(id))egg.goal=null;
}
// 从实际数量重新排：本轮配额是硬限制，间隔、避免连出/ABAB 和随机性决定顺序。
// 单步推荐和整轮预览共用同一套配额、间隔与随机评分。
function eggRandom(){const value=new Uint32Array(1);globalThis.crypto.getRandomValues(value);return value[0]/4294967296;}
function eggRecommendationContext(egg){
 const items=egg.items.filter(i=>Number(i.ratio)>0).map(i=>({id:i.id,name:i.name,ratio:i.ratio}));
 const c=eggCounts(egg),round=items.length?Math.min(...items.map(i=>Math.floor(c[i.id]/i.ratio))):0;
 const gaps=new Map(),recent=[];let distance=0;
 for(let k=egg.records.length-1;k>=0;k--){
  const r=egg.records[k];if(r.delta<=0||r.kind!=='count')continue;
  if(!gaps.has(r.itemId))gaps.set(r.itemId,distance+1);
  const take=Math.min(r.delta,3-recent.length);for(let j=0;j<take;j++)recent.push(r.itemId);
  distance+=r.delta;
  if(gaps.size===items.length&&recent.length===3)break;
 }
 return {items,c,round,gaps,recent};
}
export function eggRecommendationSet(egg,count=4,random=eggRandom){
 return eggRecommendationChoices(eggRecommendationContext(egg),count,random);
}
function eggRecommendationChoices({items,c,round,gaps,recent},count,random){
 if(!items.length)return [];
 const progress=items.map(i=>({...i,progress:Math.min(i.ratio,c[i.id]-round*i.ratio)}));
 const totalRatio=sum(items.map(i=>i.ratio)),placed=sum(progress.map(i=>i.progress));
 const eligible=progress.filter(i=>i.progress<i.ratio).map(i=>({...i,left:i.ratio-i.progress}));
 if(!eligible.length)return [];
 const slots=sum(eligible.map(i=>i.left));
 // 如果还能无连出地放完，就保留这种可能，避免随机消耗配额后尾部只能连放。
 const feasible=eligible.filter(i=>i.id!==recent[0]&&eligible.every(j=>{
  const left=j.left-(j.id===i.id?1:0),limit=j.id===i.id?Math.floor((slots-1)/2):Math.ceil((slots-1)/2);
  return left<=limit;
 }));
 const scheduled=eligible.map(i=>({...i,period:totalRatio/i.ratio,
  cooldown:Math.max(1,Math.floor(totalRatio/i.ratio*0.65)),
  deficit:(placed+1)*i.ratio/totalRatio-i.progress}));
 const feasibleIDs=new Set(feasible.map(i=>i.id));
 const dominant=Math.max(...items.map(i=>i.ratio))/totalRatio>0.5;
 // 过半占比允许少量连出，避免把 5:3:1 强行锁成 A-B-A-C-A-B-A-B-A。
 let preferred=!dominant&&feasible.length?scheduled.filter(i=>feasibleIDs.has(i.id)):scheduled;
 // 为同种物品后续的最小间隔预留位置，防止拖到轮尾后被迫扎堆。
 const urgent=scheduled.filter(i=>slots<=1+(i.left-1)*i.cooldown&&(gaps.get(i.id)??Infinity)>=i.cooldown);
 if(urgent.length)preferred=urgent;
 const spaced=preferred.filter(i=>(gaps.get(i.id)??Infinity)>=i.cooldown);
 if(spaced.length)preferred=spaced;
 const lastShare=(items.find(i=>i.id===recent[0])?.ratio||0)/totalRatio;
 const noRepeat=preferred.filter(i=>i.id!==recent[0]);
 if(lastShare<=0.5&&noRepeat.length)preferred=noRepeat;
 if(recent.length===3&&recent[0]===recent[2]&&recent[0]!==recent[1]){
  const varied=preferred.filter(i=>i.id!==recent[1]&&i.deficit>=-0.75);if(varied.length)preferred=varied;
 }
 const preferredIDs=new Set(preferred.map(i=>i.id));
 // 最大熵加权抽样：P(i) ∝ 剩余配额 × exp(进度纠偏 - 连出代价 - 扎堆代价)。
 // Gumbel-max 直接从这份概率分布抽取，不是固定时刻排队或只在平分时随机。
 const repeatsAfter=i=>Math.max(0,...scheduled.map(j=>{
  const left=j.left-(i.id===j.id?1:0),others=slots-1-left;
  return left-others-(i.id===j.id?0:1);
 }));
 const unavoidable=Math.min(...scheduled.map(repeatsAfter));
 return scheduled.map(i=>{
  const share=i.ratio/totalRatio,gap=gaps.get(i.id)??Infinity;
  const repeat=i.id===recent[0]?2*(1-share):0;
  const crowding=2*Math.max(0,1-gap/i.period)**2;
  const future=2*(repeatsAfter(i)-unavoidable);
  const logWeight=Math.log(i.left)+1.1*i.deficit-repeat-crowding-future;
  const u=Math.min(1-Number.EPSILON,Math.max(Number.EPSILON,random()));
  return {id:i.id,name:i.name,ratio:i.ratio,round,score:logWeight-Math.log(-Math.log(u)),
   deficit:i.deficit,preferred:preferredIDs.has(i.id),reason:'按剩余配额随机穿插'};
 })
  .sort((a,b)=>Number(b.preferred)-Number(a.preferred)||b.score-a.score).slice(0,Math.max(0,count));
}
export function eggRecommend(egg,{random=eggRandom}={}){return eggRecommendationSet(egg,1,random)[0]||null;}
// Lazy, read-only preview. Simulated placements update the same history model,
// and the fixed starting round prevents the last pick from opening another round.
export function* eggRoundSequence(egg,{random=eggRandom,firstId=null}={}){
 yield* eggContextSequence(eggRecommendationContext(egg),random,firstId);
}
function* eggContextSequence(context,random,firstId){
 const {items,c,round,gaps,recent}=context;
 let first=items.find(i=>i.id===firstId&&c[i.id]<(round+1)*i.ratio);
 while(true){
  const pick=first||eggRecommendationChoices(context,1,random)[0];first=null;
  if(!pick)return;
  eggApplyPick(context,pick.id);
  yield pick.id;
 }
}
function eggApplyPick(context,id){
 context.c[id]++;
 for(const [key,gap] of context.gaps)context.gaps.set(key,gap+1);
 context.gaps.set(id,1);context.recent.unshift(id);context.recent.length=Math.min(3,context.recent.length);
}
// Score a complete ordering, without requiring equally spaced fixed positions.
function eggSequenceQuality(context,order){
 const gaps=new Map(context.gaps),recent=context.recent.slice(),total=sum(context.items.map(i=>i.ratio));
 const periods=new Map(context.items.map(i=>[i.id,total/i.ratio]));
 let repeats=0,minorRepeats=0,rareClose=0,spacing=0,alternating=0,streak=0,maxRun=0,last=recent[0];
 for(const id of recent){if(id!==last)break;streak++;}
 for(const id of order){
  const period=periods.get(id),gap=gaps.get(id)??Infinity;
  if(recent[0]===id){repeats++;if(period>=2)minorRepeats++;}
  streak=last===id?streak+1:1;last=id;maxRun=Math.max(maxRun,streak);
  if(period>=4&&gap<Math.floor(period*.5))rareClose++;
  spacing+=Math.min(6,Math.sqrt(period))*Math.max(0,1-gap/period)**2;
  if(recent.length===3&&id===recent[1]&&recent[0]===recent[2]&&id!==recent[0])alternating++;
  for(const [key,n] of gaps)gaps.set(key,n+1);
  gaps.set(id,1);recent.unshift(id);recent.length=Math.min(3,recent.length);
 }
 return {repeats,minorRepeats,rareClose,maxRun,energy:spacing+.7*alternating+.9*repeats};
}
function eggSequenceDistance(a,b){
 const n=Math.min(a.length,b.length);if(!n)return {changed:0,value:0};
 let changed=0;for(let k=0;k<n;k++)if(a[k]!==b[k])changed++;
 const row=new Uint16Array(n+1);
 for(let i=0;i<n;i++){let previous=0;for(let j=1;j<=n;j++){const old=row[j];row[j]=a[i]===b[j-1]?previous+1:Math.max(row[j],row[j-1]);previous=old;}}
 const pairs=new Map();for(let k=1;k<n;k++){const key=b[k-1]+'|'+b[k];pairs.set(key,(pairs.get(key)||0)+1);}
 let shared=0;for(let k=1;k<n;k++){const key=a[k-1]+'|'+a[k],left=pairs.get(key)||0;if(left){shared++;pairs.set(key,left-1);}}
 return {changed,value:.4*changed/n+.35*(1-row[n]/n)+.25*(n>1?1-shared/(n-1):changed)};
}
function eggWholeRound(context,random,{firstId,previous,total}){
 const size=Math.min(512,total),candidates=new Map();
 if(!size)return {order:[],comparison:null};
 const counts=context.items.map(i=>Math.max(0,(context.round+1)*i.ratio-context.c[i.id]));
 const ids=context.items.map(i=>i.id),byId=new Map(ids.map((id,k)=>[id,k]));
 if(!byId.has(firstId)||!counts[byId.get(firstId)])firstId=null;
 const valid=order=>{
  if(!Array.isArray(order)||order.length!==size||(firstId&&order[0]!==firstId))return false;
  const used=Array(ids.length).fill(0);for(const id of order){const k=byId.get(id);if(k===undefined||++used[k]>counts[k])return false;}return true;
 };
 const add=order=>{if(valid(order)){const key=order.join('|');if(!candidates.has(key))candidates.set(key,{order,quality:eggSequenceQuality(context,order)});}};
 const prior=previous?.slice(0,size);if(valid(prior))add(prior);
 const factorial=n=>{let v=1;for(let k=2;k<=n;k++)v*=k;return v;};
 const ways=total<=10?factorial(total)/counts.reduce((v,n)=>v*factorial(n),1):Infinity;
 const exact=ways<=10000;
 if(exact){
  const left=counts.slice(),order=[];
  const visit=()=>{if(order.length===size){add(order.slice());return;}for(let k=0;k<ids.length;k++)if(left[k]&&(!firstId||order.length||ids[k]===firstId)){left[k]--;order.push(ids[k]);visit();order.pop();left[k]++;}};
  visit();
 }else{
  const attempts=Math.max(4,Math.min(24,Math.floor(250000/(Math.max(1,ids.length**2)*size))));
  for(let trial=0;trial<attempts;trial++){
   const copy={...context,c:{...context.c},gaps:new Map(context.gaps),recent:context.recent.slice()};
   const iterator=eggContextSequence(copy,random,firstId),order=[];
   while(order.length<size){const next=iterator.next();if(next.done)break;order.push(next.value);}add(order);
  }
  const bases=[...candidates.values()];
  for(let trial=0;trial<attempts*3;trial++){
   const order=bases[Math.floor(random()*bases.length)].order.slice(),start=firstId?1:0;
   if(size-start>1){
    if(trial%3===0){for(let k=size-1;k>start;k--){const j=start+Math.floor(random()*(k-start+1));[order[k],order[j]]=[order[j],order[k]];}}
    else for(let k=0;k<2+trial%7;k++){const a=start+Math.floor(random()*(size-start)),b=start+Math.floor(random()*(size-start));[order[a],order[b]]=[order[b],order[a]];}
   }
   add(order);
  }
 }
 let good=[...candidates.values()];
 const minorRepeats=Math.min(...good.map(c=>c.quality.minorRepeats));good=good.filter(c=>c.quality.minorRepeats===minorRepeats);
 const repeats=Math.min(...good.map(c=>c.quality.repeats)),dominant=context.items.some(i=>i.ratio/sum(context.items.map(j=>j.ratio))>.5);
 // A dominant item may use one extra pair on an explicit reroll. Otherwise a
 // near-alternating tiny round can have only one acceptable arrangement.
 good=good.filter(c=>c.quality.repeats<=repeats+(valid(prior)&&dominant?1:0));
 const maxRun=Math.min(...good.map(c=>c.quality.maxRun));good=good.filter(c=>c.quality.maxRun<=Math.max(2,maxRun));
 const rareClose=Math.min(...good.map(c=>c.quality.rareClose));good=good.filter(c=>c.quality.rareClose===rareClose);
 const best=Math.min(...good.map(c=>c.quality.energy));good=good.filter(c=>c.quality.energy<=best+Math.max(1.6,size*.03));
 let comparison=null;
 if(valid(prior)){
  good.forEach(c=>c.distance=eggSequenceDistance(c.order,prior));
  const farthest=Math.max(...good.map(c=>c.distance.value)),mostChanged=Math.max(...good.map(c=>c.distance.changed));
  const diverse=good.filter(c=>c.distance.value>=farthest*.8&&c.distance.changed>=Math.min(size*.6,mostChanged*.9));
  if(diverse.length)good=diverse;
  comparison={compared:size,alternatives:good.length,exact,limited:mostChanged<size*.5};
 }
 const selected=good[Math.min(good.length-1,Math.floor(random()*good.length))];
 return {order:selected.order,comparison:comparison?{...comparison,changed:selected.distance.changed}:null};
}
export function eggRecommendationKey(egg){
 const counts=eggCounts(egg);
 return JSON.stringify([egg.items.map(i=>[i.id,i.ratio,counts[i.id]]),egg.records.slice(-16).map(r=>r.id)]);
}
const packEggContext=context=>({...context,gaps:[...context.gaps]});
const unpackEggContext=value=>({...clone(value),gaps:new Map(value.gaps)});
export function eggCreatePlan(egg,{firstId=null,previous=null}={}){
 const context=eggRecommendationContext(egg);
 const plan={version:2,key:eggRecommendationKey(egg),context:packEggContext(context),seed:planSeed(),offset:0,firstId,
  total:sum(context.items.map(i=>Math.max(0,(context.round+1)*i.ratio-context.c[i.id]))),at:Date.now()};
 const result=eggWholeRound(context,planRandom(plan.seed),{firstId,previous,total:plan.total});
 return {...plan,order:result.order,comparison:result.comparison};
}
export function eggStoredPlan(egg){
 const p=egg.recommendation;
 try{
  if(!p||![1,2].includes(p.version)||p.key!==eggRecommendationKey(egg)||!Number.isSafeInteger(p.total)||p.total<1||p.total>200000000)return null;
  if(!Number.isSafeInteger(p.offset)||p.offset<0||p.offset>200000000000||!validTime(p.at))return null;
  planRandom(p.seed,p.offset);
  const c=p.context,ids=new Set(egg.items.map(i=>i.id));
  if(!c||!Array.isArray(c.items)||c.items.length!==egg.items.length||!Number.isSafeInteger(c.round)||c.round<0||c.round>MAX)return null;
  if(!c.items.every((i,k)=>i.id===egg.items[k].id&&i.ratio===egg.items[k].ratio&&Number.isSafeInteger(c.c[i.id])&&c.c[i.id]>=0&&c.c[i.id]<=MAX))return null;
  if(!Array.isArray(c.gaps)||c.gaps.length>200||!c.gaps.every(([id,n])=>ids.has(id)&&Number.isSafeInteger(n)&&n>=1))return null;
  if(!Array.isArray(c.recent)||c.recent.length>3||!c.recent.every(id=>ids.has(id))||(p.firstId!==null&&!ids.has(p.firstId)))return null;
  const counts=eggCounts(egg);
  if(!c.items.every(i=>counts[i.id]===c.c[i.id]))return null;
  if(p.total!==sum(c.items.map(i=>Math.max(0,(c.round+1)*i.ratio-c.c[i.id]))))return null;
  if(p.version===2){
   if(!Array.isArray(p.order)||p.order.length>Math.min(512,p.total))return null;
   const used={};for(const id of p.order){if(!ids.has(id))return null;used[id]=(used[id]||0)+1;}
   if(c.items.some(i=>(used[i.id]||0)>Math.max(0,(c.round+1)*i.ratio-c.c[i.id])))return null;
  }
  return p;
 }catch{return null;}
}
export function* eggSavedSequence(plan){
 const context=unpackEggContext(plan.context);
 if(plan.version===2)for(const id of plan.order){eggApplyPick(context,id);yield id;}
 yield* eggContextSequence(context,planRandom(plan.seed,plan.offset),plan.version===2?null:plan.firstId);
}
export function eggAdvancePlan(egg,plan,placedId){
 const last=egg.records.at(-1);
 if(!plan||plan.total<=1||last?.kind!=='count'||last.delta!==1||last.itemId!==placedId)return null;
 const prior={...egg,records:egg.records.slice(0,-1),recommendation:plan};
 if(!eggStoredPlan(prior))return null;
 const context=unpackEggContext(plan.context),random=planRandom(plan.seed,plan.offset);
 if(plan.version===2&&plan.order.length){if(plan.order[0]!==placedId)return null;eggApplyPick(context,placedId);}
 else if(eggContextSequence(context,random,plan.version===2?null:plan.firstId).next().value!==placedId)return null;
 return {...plan,key:eggRecommendationKey(egg),context:packEggContext(context),offset:random.position,firstId:null,total:plan.total-1,at:Date.now(),...(plan.version===2?{order:plan.order.slice(1),comparison:null}:{})};
}
// Read-only statistics. A physical placement, a removal and a manual correction
// are distinct operations; their deltas still all contribute to the current count.
export function eggStatistics(egg,{range=0,itemId=null,now=Date.now(),hour=null}={}){
 const today=day(now),start=range===3?'':day(now-(range===1?6:range===2?29:0)*86400000);
 const counts=eggCounts(egg),round=egg.items.length?Math.min(...egg.items.map(i=>Math.floor(counts[i.id]/i.ratio))):0;
 const items=egg.items.map(i=>({...i,count:counts[i.id],progress:counts[i.id]-round*i.ratio,itemProgress:counts[i.id]-round*i.ratio,itemRound:round+1,overflow:Math.max(0,counts[i.id]-(round+1)*i.ratio),
  left:Math.max(0,i.ratio-(counts[i.id]-round*i.ratio)),added:0,removed:0,manualNet:0,net:0,records:0,lastPlacedAt:0}));
 const byId=Object.fromEntries(items.map(i=>[i.id,i]));
 const blank=()=>({added:0,removed:0,manualNet:0,net:0,records:0});
 const summary=blank(),hours=Array.from({length:24},blank),minutes=Array.from({length:60},blank),days=Object.create(null),rows=[];
 const add=(bucket,r)=>{bucket.net+=r.delta;bucket.records++;if(r.kind==='set')bucket.manualNet+=r.delta;else if(r.delta>0)bucket.added+=r.delta;else bucket.removed-=r.delta;};
 for(const r of egg.records){
  const item=byId[r.itemId];if(!item||r.at>now)continue;
  if(r.kind==='count'&&r.delta>0)item.lastPlacedAt=Math.max(item.lastPlacedAt,r.at);
  const date=day(r.at);if(date>today||(start&&date<start))continue;
  add(item,r);
  if(itemId&&r.itemId!==itemId)continue;
  rows.push(r);add(summary,r);add(hours[hourAt(r.at)],r);
  if(!days[date])days[date]=blank();add(days[date],r);
 }
 const selectedHour=Number.isInteger(hour)&&hour>=0&&hour<24?hour:
  rows.length?hours.reduce((best,bucket,h)=>bucket.added+bucket.removed>hours[best].added+hours[best].removed?h:best,0):hourAt(now);
 for(const r of rows)if(hourAt(r.at)===selectedHour)add(minutes[minute(r.at)],r);
 rows.sort((a,b)=>b.at-a.at||String(b.id).localeCompare(String(a.id)));
 return {rows,items,summary,hours,minutes,days,hour:selectedHour,start,end:today,
  total:sum(items.map(i=>i.count)),completedRounds:round,currentRound:round+1,left:sum(items.map(i=>i.left)),
  activeItems:new Set(rows.map(r=>r.itemId)).size};
}
// Keep the public option named `hour` while using the shared Beijing-time helper.
const hourAt=at=>hour(at);
export class LocalLedger {
 constructor(storage,key='little-tally-pocket-v1') {this.storage=storage;this.key=key;this.state=initialState();this.raw=null;this.readOnly=false;this.error=null;this.reload();}
 reload(){try{const raw=this.storage.getItem(this.key);if(raw!==null){this.state=validateState(JSON.parse(raw));this.raw=raw;}else{this.raw=null;}this.readOnly=false;this.error=null;}catch(e){this.readOnly=true;this.error='本地记录未能读取，原文件没有被覆盖。请先导出原文件，再从备份恢复。';}return !this.readOnly;}
 commit(mutator){requireThat(!this.readOnly,this.error||'数据处于保护状态。');const latest=this.storage.getItem(this.key);if(latest!==this.raw){this.reload();throw new Error('另一个页面更新了记录，已同步，请重试这次操作。');}const next=clone(this.state);mutator(next);next.revision++;validateState(next);const raw=JSON.stringify(next);
  try{if(this.raw)this.storage.setItem(this.key+'-previous',this.raw);this.storage.setItem(this.key,raw);}catch(e){throw new Error('浏览器未能保存，这次操作没有生效。请检查储存空间并导出备份。');}
  this.state=next;this.raw=raw;return next;
 }
 recover(sales,stock){validateBook(sales);validateBook(stock);requireThat(sales.book==='sales'&&stock.book==='stock','请选择对应的两个账本。');const next={...initialState(),sales,stock},raw=JSON.stringify(next),original=this.storage.getItem(this.key);if(original)this.storage.setItem(this.key+'-unreadable',original);this.storage.setItem(this.key,raw);this.state=next;this.raw=raw;this.readOnly=false;this.error=null;}
}
