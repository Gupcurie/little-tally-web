// Daily quantity reconciliation is order-independent. Location ranking is a heuristic,
// never proof of an actual mistake or of which repeated physical egg was redeemed.
export const nameKey=name=>String(name??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function dayBounds(now=Date.now()){
 const day=new Date(now+28800000).toISOString().slice(0,10),start=Date.parse(day+'T00:00:00+08:00');
 return {day,start,end:Math.min(now,start+86400000-1)};
}
export function validAliases(groups){
 return Array.isArray(groups)&&groups.length<=200&&groups.every(g=>Array.isArray(g)&&g.length>=2&&g.length<=400&&g.every(n=>typeof n==='string'&&n.length>0&&n.length<=80));
}
export function mergeAliases(groups,a,b){
 const left=nameKey(a),right=nameKey(b);if(!left||!right||left===right)throw Error('请选择两个不同名称。');
 const all=validAliases(groups)?groups.map(g=>g.map(nameKey)):[];const joined=new Set([left,right]),rest=[];
 for(const group of all){if(group.some(n=>joined.has(n)))group.forEach(n=>joined.add(n));else rest.push(group);}
 // Existing groups may overlap in an imported configuration; close the union fully.
 let changed=true;while(changed){changed=false;for(let i=rest.length-1;i>=0;i--)if(rest[i].some(n=>joined.has(n))){rest.splice(i,1)[0].forEach(n=>joined.add(n));changed=true;}}
 const result=[...rest,[...joined].sort()];if(!validAliases(result))throw Error('合并名称数量超过上限。');return result;
}
function aliasesFor(groups){
 const parents=new Map();const root=n=>{let key=n;while(parents.has(key)&&parents.get(key)!==key)key=parents.get(key);return key;};
 if(validAliases(groups))for(const group of groups){const names=group.map(nameKey);for(const n of names){const a=root(names[0]),b=root(n);if(a!==b)parents.set(b,a);}}
 return name=>root(nameKey(name));
}
function collect(books,bounds,canonical){
 const sources=Array.isArray(books)?books:[books],labels=new Map(),events=new Map();
 for(const book of sources)for(const item of book?.items||[])labels.set(item.id,item.name);
 let order=0;
 for(const book of sources){const names=new Map((book?.items||[]).map(i=>[i.id,labels.get(i.id)||i.name]));
  for(const r of book?.records||[]){
   if(!Number.isFinite(r.at)||r.at<bounds.start||r.at>bounds.end||r.origin==='inherit'||!Number.isSafeInteger(r.delta)||!r.delta)continue;
   const name=names.get(r.itemId);if(!name)continue;
   const event={...r,name,key:canonical(name,r.itemId),order:order++};events.set(r.id||'missing-'+event.order,event);
  }
 }
 const sorted=[...events.values()].sort((a,b)=>a.at-b.at||a.order-b.order),groups=new Map();
 for(const r of sorted){
  if(!groups.has(r.key))groups.set(r.key,{key:r.key,names:new Set(),net:0,runs:[],stack:[],debt:0,priorReduction:0});
  const group=groups.get(r.key);group.names.add(r.name);group.net+=r.delta;
  if(r.delta>0){const pay=Math.min(r.delta,group.debt);group.debt-=pay;const quantity=r.delta-pay;
   if(quantity){const run={key:r.key,name:r.name,quantity,at:r.at,recordId:r.id,order:r.order};group.runs.push(run);group.stack.push(run);}
  }else{
   let left=-r.delta;while(left&&group.stack.length){const last=group.stack.at(-1),n=Math.min(left,last.quantity);last.quantity-=n;left-=n;if(!last.quantity)group.stack.pop();}
   if(left){group.debt+=left;group.priorReduction+=left;}
  }
 }
 const runs=[...groups.values()].flatMap(g=>g.runs.filter(r=>r.quantity)).sort((a,b)=>a.at-b.at||a.order-b.order);
 let position=0;for(const run of runs){run.pos=position;position+=run.quantity;}
 return {groups,runs,total:position,first:sorted[0]?.at??null,last:sorted.at(-1)?.at??null};
}
function similar(a,b){
 const x=nameKey(a).replace(/\s/g,''),y=nameKey(b).replace(/\s/g,'');if(x===y)return true;
 if(Math.min(x.length,y.length)>=2&&(x.includes(y)||y.includes(x)))return true;
 let previous=new Uint8Array(y.length+1),best=0;
 for(const c of x){const next=new Uint8Array(y.length+1);for(let j=0;j<y.length;j++)if(c===y[j])best=Math.max(best,next[j+1]=previous[j]+1);previous=next;}
 return best>=2&&best/Math.min(x.length,y.length)>=.7;
}
export function sortSimilarRows(rows){
 const sorted=rows.slice().sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')),parent=sorted.map((_,i)=>i);
 const root=i=>{while(parent[i]!==i)i=parent[i];return i;};
 for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++)if(similar(sorted[i].name,sorted[j].name))parent[root(j)]=root(i);
 const clusters=new Map();sorted.forEach((row,i)=>{const k=root(i);if(!clusters.has(k))clusters.set(k,[]);clusters.get(k).push(row);});
 return [...clusters.values()].flat();
}
function median(values){if(!values.length)return 0;values.sort((a,b)=>a-b);return values[Math.floor(values.length/2)];}
function nearestAnchors(anchors,position){
 let lo=0,hi=anchors.length;while(lo<hi){const mid=(lo+hi)>>1;if(anchors[mid].source.pos<position)lo=mid+1;else hi=mid;}
 return {left:anchors.slice(Math.max(0,lo-8),lo),right:anchors.slice(lo,lo+8)};
}
function tightBracket(anchors,position,cache){
 let lo=0,hi=anchors.length;while(lo<hi){const mid=(lo+hi)>>1;if(anchors[mid].source.pos<position)lo=mid+1;else hi=mid;}
 if(cache.has(lo))return cache.get(lo);
 const left=anchors.slice(0,lo).sort((a,b)=>a.other.pos-b.other.pos),prefix=[];
 for(const anchor of left)prefix.push(!prefix.length||anchor.source.at>prefix.at(-1).source.at?anchor:prefix.at(-1));
 let best=null;
 for(const right of anchors.slice(lo)){
  let a=0,b=left.length;while(a<b){const mid=(a+b)>>1;if(left[mid].other.pos<right.other.pos)a=mid+1;else b=mid;}
  const before=prefix[a-1];if(before&&(!best||right.source.at-before.source.at<best.right.source.at-best.left.source.at))best={left:before,right};
 }
 cache.set(lo,best);return best;
}
function partialAnchors(source,other){
 const out=[];
 for(const [key,group] of source.groups){
  const a=group.runs.filter(r=>r.quantity),b=other.groups.get(key)?.runs.filter(r=>r.quantity)||[];
  const na=a.reduce((n,r)=>n+r.quantity,0),nb=b.reduce((n,r)=>n+r.quantity,0);if(!na||!nb)continue;
  // Quantile references use compressed quantities, including batch registrations.
  // Unequal totals cannot prove individual identity; these are fallback references only.
  const n=Math.min(8,na,nb);let ai=0,bi=0,ap=0,bp=0;
  for(let j=0;j<n;j++){
   const x=Math.floor((j+.5)*na/n),y=Math.floor((j+.5)*nb/n);
   while(ai<a.length-1&&ap+a[ai].quantity<=x)ap+=a[ai++].quantity;
   while(bi<b.length-1&&bp+b[bi].quantity<=y)bp+=b[bi++].quantity;
   out.push({source:{...a[ai],pos:a[ai].pos+x-ap},other:{...b[bi],pos:b[bi].pos+y-bp},estimated:true});
  }
 }
 return out;
}
function fallbackWindow(source,run,key,references,cache,index){
 const pair=tightBracket(references,run.pos,cache);
 const ref=a=>a?{name:a.source.name,at:a.source.at,otherAt:a.other.at}:null;
 if(pair)return {kind:'partial',from:pair.left.source.at,to:pair.right.source.at,otherFrom:pair.left.other.at,otherTo:pair.right.other.at,before:ref(pair.left),after:ref(pair.right)};
 const near=nearestAnchors(references,run.pos),left=near.left.at(-1),right=near.right[0];
 if(left||right)return {kind:left&&right?'crossed':'one-sided',from:left?.source.at??run.at,to:right?.source.at??run.at,before:ref(left),after:ref(right)};
 const position=index.get(run),before=source.runs[position-1],after=source.runs[position+1];
 if(before||after)return {kind:'neighborhood',from:before?.at??run.at,to:after?.at??run.at,before:before?{name:before.name,at:before.at}:null,after:after?{name:after.name,at:after.at}:null};
 return null;
}
function rankLocations(source,other,key,anchors,deficit,buffer,brackets,soft=[]){
 const a=source.groups.get(key)?.runs.filter(r=>r.quantity)||[],b=other.groups.get(key)?.runs.filter(r=>r.quantity)||[];
 const scores=new Map(a.map(r=>[r,0]));
 const na=a.reduce((n,r)=>n+r.quantity,0),nb=b.reduce((n,r)=>n+r.quantity,0);
 let ranked=false;
 // Exact best contextual subsequence cost for small categories; quantities never expand unboundedly.
 if(nb&&na>nb&&na<=1600&&na*nb<=300000){
  const aa=a.flatMap(r=>Array.from({length:r.quantity},(_,i)=>({run:r,pos:r.pos+i}))),bb=b.flatMap(r=>Array.from({length:r.quantity},(_,i)=>({pos:r.pos+i})));
  const width=nb+1,size=(na+1)*width,forward=new Float64Array(size),backward=new Float64Array(size);forward.fill(Infinity);backward.fill(Infinity);
  for(let i=0;i<=na;i++){forward[i*width]=0;backward[i*width+nb]=0;}
  const predicted=aa.map(unit=>{const near=nearestAnchors(anchors,unit.pos),local=[...near.left,...near.right];return local.length?unit.pos+median(local.map(a=>a.other.pos-a.source.pos)):unit.pos*(other.total||1)/(source.total||1);});
  const cost=(i,j)=>{const distance=Math.abs(predicted[i]-bb[j].pos);return distance<=buffer?distance*.15:buffer*.15+distance-buffer;};
  for(let i=1;i<=na;i++)for(let j=1;j<=Math.min(i,nb);j++)forward[i*width+j]=Math.min(forward[(i-1)*width+j],forward[(i-1)*width+j-1]+cost(i-1,j-1));
  for(let i=na-1;i>=0;i--)for(let j=nb-1;j>=0;j--)backward[i*width+j]=Math.min(backward[(i+1)*width+j],cost(i,j)+backward[(i+1)*width+j+1]);
  const optimum=forward[na*width+nb];for(const r of a)scores.set(r,Infinity);
  for(let i=0;i<na;i++){let best=Infinity;for(let j=0;j<=nb;j++)best=Math.min(best,forward[i*width+j]+backward[(i+1)*width+j]);scores.set(aa[i].run,Math.min(scores.get(aa[i].run),Math.max(0,best-optimum)));}
  ranked=true;
 }
 const available=[...anchors,...soft].filter(a=>a.source.key!==key).sort((a,b)=>a.source.pos-b.source.pos),stride=Math.max(1,Math.ceil(available.length/256));
 const references=available.filter((_,i)=>i%stride===0),fallbackCache=new Map(),index=new Map(source.runs.map((r,i)=>[r,i]));
 const locations=a.map(run=>{
  const pair=tightBracket(anchors,run.pos,brackets);
  return {at:run.at,recordId:run.recordId,quantity:Math.min(run.quantity,deficit),position:run.pos+1,
   from:pair?.left.source.at??run.at,to:pair?.right.source.at??run.at,
   before:pair?{name:pair.left.source.name,at:pair.left.source.at,otherAt:pair.left.other.at}:null,
   after:pair?{name:pair.right.source.name,at:pair.right.source.at,otherAt:pair.right.other.at}:null,
   bounded:Boolean(pair),estimated:Boolean(pair&&(pair.left.estimated||pair.right.estimated)),window:pair?null:fallbackWindow(source,run,key,references,fallbackCache,index),score:scores.get(run),ranked};
 }).sort((a,b)=>a.score-b.score||a.to-a.from-(b.to-b.from)||a.at-b.at);
 return {locations:locations.slice(0,20),candidateCount:locations.length,ambiguous:na>deficit&&locations.length>1,ranked};
}
export function reconcileDaily(eggBooks,salesBooks,{now=Date.now(),aliases=[],links=null,buffer=20}={}){
 const bounds=dayBounds(now),canonical=aliasesFor(aliases),maps={sales:new Map(),egg:new Map()};
 if(links)links.groups.forEach((group,index)=>{for(const side of ['sales','egg'])for(const id of group[side])maps[side].set(id,'pair-'+index);});
 const key=side=>links?(name,id)=>maps[side].get(id)||'single-'+side+'-'+id:canonical;
 const placed=collect(eggBooks,bounds,key('egg')),sold=collect(salesBooks,bounds,key('sales')),keys=new Set([...placed.groups.keys(),...sold.groups.keys()]);
 const rows=[...keys].map(key=>{const a=placed.groups.get(key),b=sold.groups.get(key),names=[...new Set([...(a?.names||[]),...(b?.names||[])])];const eggs=a?.net||0,sales=b?.net||0;return {key,name:names.join(' / '),names,eggs,sales,matched:Math.min(Math.max(0,eggs),Math.max(0,sales)),difference:eggs-sales,correction:(a?.priorReduction||0)+(b?.priorReduction||0)};});
 const certain=[],estimated=[];
 for(const row of rows)if(row.eggs>0&&row.eggs===row.sales){
  const a=placed.groups.get(row.key)?.runs.filter(r=>r.quantity)||[],b=sold.groups.get(row.key)?.runs.filter(r=>r.quantity)||[];
  if(row.eggs===1&&a.length===1&&b.length===1)certain.push({source:a[0],other:b[0],estimated:false});
  else if(a.length===b.length&&a.every(r=>r.quantity===1)&&b.every(r=>r.quantity===1))for(let i=0;i<a.length;i++)estimated.push({source:a[i],other:b[i],estimated:true});
 }
 // Repeated balanced labels provide explicitly estimated occurrence references.
 // Bound their count so long ledgers cannot create a quadratic UI workload.
 const capacity=Math.max(0,1024-certain.length),stride=Math.max(1,Math.ceil(estimated.length/(capacity||1)));
 const anchors=[...certain,...estimated.filter((_,i)=>capacity&&i%stride===0)].sort((a,b)=>a.source.pos-b.source.pos);
 const reverse=anchors.map(a=>({source:a.other,other:a.source,estimated:a.estimated})).sort((a,b)=>a.source.pos-b.source.pos);
 const eggBrackets=new Map(),salesBrackets=new Map(),soft=partialAnchors(placed,sold),reverseSoft=soft.map(a=>({source:a.other,other:a.source,estimated:true}));
 const issues=rows.filter(row=>row.difference!==0).map(row=>({key:row.key,name:row.name,eggs:row.eggs,sales:row.sales,quantity:Math.abs(row.difference),side:row.difference>0?'egg':'sales',...rankLocations(row.difference>0?placed:sold,row.difference>0?sold:placed,row.key,row.difference>0?anchors:reverse,Math.abs(row.difference),buffer,row.difference>0?eggBrackets:salesBrackets,row.difference>0?soft:reverseSoft)}));
 const total=field=>rows.reduce((n,row)=>n+row[field],0),waiting=rows.reduce((n,row)=>n+Math.max(0,row.difference),0),unmatched=rows.reduce((n,row)=>n+Math.max(0,-row.difference),0);
 return {version:2,...bounds,rows:sortSimilarRows(rows),issues,buffer,eggs:total('eggs'),sales:total('sales'),matched:total('matched'),waiting,unmatched,difference:total('difference'),overBuffer:waiting>buffer,correction:total('correction'),first:Math.min(placed.first??Infinity,sold.first??Infinity),status:unmatched||waiting>buffer||total('correction')?'review':waiting?'pending':'ok'};
}
const clock=at=>new Date(at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
function fallbackMarkup(location){
 const w=location.window;if(!w)return '<p>暂无其他可用记录，只能查看这条登记时间；无法据此确定实际出错时间。</p>';
 const reason={partial:'参考了其他品类的部分数量对应或批量登记；同类出现位置可能不同，这个范围是估计，不能确认具体漏记的是哪一件。','one-sided':'只有单侧跨账本参考，另一端采用本条登记时间；这是优先核对的本侧登记范围，不能排除范围外晚补记。',crossed:'前后参考在另一侧顺序交错，不能组成可靠配对；这里展示本侧邻近参考范围，不代表异常一定发生在其中。',neighborhood:'没有跨账本对应参考，这里仅展示相邻登记范围，便于翻查现场记录，不能当作已匹配出的异常时段。'}[w.kind];
 const reference=(label,r)=>r?`${label}：${esc(r.name)}（本侧 ${clock(r.at)}${Number.isFinite(r.otherAt)?'／对侧 '+clock(r.otherAt):''}）<br>`:'';
 return `<p>${reason}</p><p>${reference('前',w.before)}${reference('后',w.after)}${Number.isFinite(w.otherFrom)?`对侧参考登记：${clock(w.otherFrom)}–${clock(w.otherTo)}<br>`:''}登记时间不等于实际投蛋或兑换时间，晚补记时需要扩大核对。</p>`;
}
function locationHeading(location){
 if(location.bounded)return (location.estimated?'估计核对 ':'建议核对 ')+clock(location.from)+'–'+clock(location.to);
 if(location.window){const w=location.window;return (w.kind==='partial'?'估计核对 ':w.kind==='neighborhood'?'登记邻域 ':'本侧参考范围 ')+clock(w.from)+'–'+clock(w.to);}
 return '登记时间 '+clock(location.at);
}
export function dailyMarkup(result){
 const rows=result.rows.map(row=>`<tr><th>${esc(row.name)}</th><td>${row.eggs}</td><td>${row.sales}</td><td>${row.matched}</td><td class="${row.difference?'difference':''}">${row.difference>0?'+':''}${row.difference}</td></tr>`).join('');
 return `<p class="reconcile-summary">今日放蛋 ${result.eggs} · 今日销售 ${result.sales} · 已匹配 ${result.matched}</p><p>尚未对应销售 ${result.waiting} 个 · 销售多于放蛋 ${result.unmatched} 个</p><p class="hint">${esc(result.day)} ${Number.isFinite(result.first)?clock(result.first)+' 第一笔变动起':'暂无变动'}，截至 ${clock(result.end)}（北京时间）。允许销售乱序和晚补记；20 个为整体提醒值。相近名称只排序，合并需手动确认。</p>

 ${result.correction?'<p class="reconcile-notice">今日有减回到此前底数的调整，请核对起始数量；负数会如实显示。</p>':''}
 ${result.issues.length?'<h3>疑似问题时段</h3><p class="hint">以下为登记线索，不能确定实际多投或漏记。重复物品列出候选位置；前后记录用于缩小核对范围，不保证真实兑换按此顺序发生。</p>':''}
 ${result.issues.map(issue=>`<details class="reconcile-issue" data-issue-key="${esc(issue.key)}" ${result.issues.length===1?'open':''}><summary>${esc(issue.name)} · ${issue.side==='egg'?'尚未对应销售':'销售多于放蛋'} ${issue.quantity} 个</summary><p>今日放蛋 ${issue.eggs}，销售 ${issue.sales}。${issue.ambiguous?'存在多个可能位置，优先核对下列范围；其他候选同样可能。':'登记候选如下。'}${issue.ranked?'优先级结合前后对应和登记位置估算。':''}</p>${issue.locations.length?issue.locations.map((location,i)=>`<div class="reconcile-location"><strong>${i+1}. ${locationHeading(location)}</strong><p>${issue.side==='egg'?'放蛋':'销售'}登记 ${clock(location.at)} · 第 ${location.position} 项 · 本条最多涉及 ${location.quantity} 个</p>${location.bounded?`<p>前：${esc(location.before.name)}（本侧 ${clock(location.before.at)}／对侧 ${clock(location.before.otherAt)}）<br>后：${esc(location.after.name)}（本侧 ${clock(location.after.at)}／对侧 ${clock(location.after.otherAt)}）${location.estimated?'<br>前后含重复品类，范围根据同类出现次序推测，可能需要扩大检查。':''}</p>`:fallbackMarkup(location)}</div>`).join(''):'<p>涉及今日之前的底数调整，无法定位到当天新增记录。</p>'}${issue.candidateCount>20?`<p>共 ${issue.candidateCount} 处候选，当前展示前 20 处。</p>`:''}</details>`).join('')}
 <h3>今日数量明细</h3>
 <div class="reconcile-scroll"><table class="reconcile-table"><thead><tr><th>物品</th><th>放蛋</th><th>销售</th><th>匹配</th><th>放蛋−销售</th></tr></thead><tbody>${rows||'<tr><td colspan="5">今天还没有数量变动</td></tr>'}</tbody></table></div>`;
}
export function aliasControls(result,groups=[]){
 const names=[...new Set(result.rows.flatMap(row=>row.names))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
 const options=names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
 return `<div class="reconcile-alias"><h3>合并比对名称</h3><p class="hint">例如「掼蛋」与「掼蛋纸牌」。只合并对账，不修改原账本。</p><div class="reconcile-alias-pickers"><select data-alias-first aria-label="第一个物品"><option value="">选择第一个物品</option>${options}</select><select data-alias-second aria-label="第二个物品"><option value="">选择第二个物品</option>${options}</select><button type="button" data-reconcile-merge>合并比对</button></div>${(validAliases(groups)?groups:[]).map((g,i)=>`<div class="reconcile-alias-group"><span>${g.map(esc).join(' ↔ ')}</span><button type="button" data-reconcile-unmerge="${i}">取消合并</button></div>`).join('')}<p class="reconcile-alias-error" role="alert"></p></div>`;
}
