import {nameKey} from './reconcile-daily.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors=['#b43a5d','#277b68','#596ac0','#b56c30','#9957a8','#327f9f','#787a36'];
export function matchingItems(data){
 const out={sales:[],egg:[]};
 for(const side of ['sales','egg']){const map=new Map();for(const book of data[side+'_books']||[])for(const item of book?.items||[])map.set(item.id,{id:item.id,name:item.name});out[side]=[...map.values()];}
 return out;
}
export function validMatching(config){
 if(!config||config.version!==1||!Array.isArray(config.groups)||config.groups.length>2000||!config.singles)return false;
 const seen={sales:new Set(),egg:new Set()};
 const add=(side,ids)=>Array.isArray(ids)&&ids.length<=2000&&ids.every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id)&&!seen[side].has(id)&&Boolean(seen[side].add(id)));
 for(const group of config.groups)if(!group||!group.sales?.length||!group.egg?.length||!add('sales',group.sales)||!add('egg',group.egg))return false;
 return add('sales',config.singles.sales)&&add('egg',config.singles.egg);
}
export function coverage(items,config){
 const used={sales:new Set(),egg:new Set()},missing={sales:[],egg:[]};
 if(validMatching(config))for(const side of ['sales','egg']){for(const g of config.groups)g[side].forEach(id=>used[side].add(id));config.singles[side].forEach(id=>used[side].add(id));}
 for(const side of ['sales','egg'])missing[side]=items[side].filter(i=>!used[side].has(i.id));
 const known={sales:new Set(items.sales.map(i=>i.id)),egg:new Set(items.egg.map(i=>i.id))};
 const unknown=['sales','egg'].some(side=>[...used[side]].some(id=>!known[side].has(id)));
 return {missing,complete:validMatching(config)&&!unknown&&!missing.sales.length&&!missing.egg.length};
}
export function prepareMatching(items,saved=null,aliases=[]){
 const known={sales:new Set(items.sales.map(i=>i.id)),egg:new Set(items.egg.map(i=>i.id))},out={version:1,groups:[],singles:{sales:[],egg:[]}};
 if(validMatching(saved)){
  for(const group of saved.groups){const g={sales:group.sales.filter(id=>known.sales.has(id)),egg:group.egg.filter(id=>known.egg.has(id))};if(g.sales.length&&g.egg.length)out.groups.push(g);}
  for(const side of ['sales','egg'])out.singles[side]=saved.singles[side].filter(id=>known[side].has(id));
 }
 const missing=coverage(items,out).missing,parents=new Map();
 const root=name=>{let n=nameKey(name);while(parents.has(n))n=parents.get(n);return n;};
 for(const group of Array.isArray(aliases)?aliases:[])for(const n of group){const a=root(group[0]),b=root(n);if(a!==b)parents.set(b,a);}
 const families=new Map();for(const side of ['sales','egg'])for(const item of missing[side]){const key=root(item.name);if(!families.has(key))families.set(key,{sales:[],egg:[]});families.get(key)[side].push(item.id);}
 for(const group of families.values())if(group.sales.length&&group.egg.length)out.groups.push(group);
 return out;
}
export function connectMatching(config,sales,egg){
 if(!sales.length||!egg.length)throw Error('请在左右两侧分别选择物品。');
 const a=new Set(sales),b=new Set(egg),groups=[];
 for(const old of config.groups){const g={sales:old.sales.filter(id=>!a.has(id)),egg:old.egg.filter(id=>!b.has(id))};if(g.sales.length&&g.egg.length)groups.push(g);}
 const out={version:1,groups:[...groups,{sales:[...a],egg:[...b]}],singles:{sales:config.singles.sales.filter(id=>!a.has(id)),egg:config.singles.egg.filter(id=>!b.has(id))}};
 if(!validMatching(out))throw Error('物品对应关系无效。');return out;
}
export function soloMatching(config,sales,egg){
 const a=new Set(sales),b=new Set(egg),groups=[];if(!a.size&&!b.size)throw Error('请先选择需要单独核对的物品。');
 for(const old of config.groups){const g={sales:old.sales.filter(id=>!a.has(id)),egg:old.egg.filter(id=>!b.has(id))};if(g.sales.length&&g.egg.length)groups.push(g);}
 return {version:1,groups,singles:{sales:[...new Set([...config.singles.sales,...a])],egg:[...new Set([...config.singles.egg,...b])]}};
}
export function mappingMarkup(items,config,selection={sales:new Set(),egg:new Set()}){
 const progress=coverage(items,config),byId={sales:new Map(items.sales.map(i=>[i.id,i])),egg:new Map(items.egg.map(i=>[i.id,i]))};
 const node=(side,item,group=-1)=>`<button type="button" class="match-node ${selection[side].has(item.id)?'selected':''} ${group>=0?'linked':''}" data-action="match-select" data-side="${side}" data-id="${esc(item.id)}" aria-pressed="${selection[side].has(item.id)}" style="--pair-color:${group>=0?colors[group%colors.length]:'#b5a4aa'}"><span class="match-port">${group>=0?group+1:'○'}</span><span>${esc(item.name)}</span></button>`;
 const band=(a,b,index=-1)=>`<div class="match-band" ${index>=0?`data-pair-band="${index}"`:''}><div class="match-side">${a.map(i=>node('sales',i,index)).join('')||'<span class="match-placeholder">—</span>'}</div><div class="match-gutter"></div><div class="match-side">${b.map(i=>node('egg',i,index)).join('')||'<span class="match-placeholder">—</span>'}</div></div>`;
 const groups=config.groups.map((g,index)=>({g,index,pos:Math.min(...g.sales.map(id=>items.sales.findIndex(i=>i.id===id)))})).sort((a,b)=>a.pos-b.pos);
 return `<div class="match-explanation"><p>先选择左侧物品，再选择右侧物品，点击「连接所选」。左右都支持多选，例如红娃衣＋黑娃衣对应一个娃衣。</p><p>所有品类处理完成并确认后，才显示今日数量和疑似时段。没有对应项的物品可标为「单独核对」，仍会计入差额。</p></div><div class="match-progress">销售已处理 ${items.sales.length-progress.missing.sales.length}/${items.sales.length} 类 · 放蛋已处理 ${items.egg.length-progress.missing.egg.length}/${items.egg.length} 类</div>
 <div class="match-column-titles"><strong>拆弹 · 销售</strong><span>连线</span><strong>投蛋</strong></div><div class="match-board"><svg class="match-wires" aria-hidden="true"></svg>${progress.missing.sales.length||progress.missing.egg.length?`<div class="match-band-label">待对应</div>${band(progress.missing.sales,progress.missing.egg)}`:''}${groups.map(({g,index})=>band(g.sales.map(id=>byId.sales.get(id)).filter(Boolean),g.egg.map(id=>byId.egg.get(id)).filter(Boolean),index)).join('')}${config.singles.sales.length||config.singles.egg.length?`<div class="match-band-label">单独核对</div>${band(config.singles.sales.map(id=>byId.sales.get(id)).filter(Boolean),config.singles.egg.map(id=>byId.egg.get(id)).filter(Boolean))}`:''}</div>
 <div class="match-connect-bar"><span>已选：左 ${selection.sales.size} / 右 ${selection.egg.size}</span><button type="button" class="primary-button" data-action="match-connect" ${selection.sales.size&&selection.egg.size?'':'disabled'}>连接所选</button><button type="button" class="small-button" data-action="match-solo" ${selection.sales.size||selection.egg.size?'':'disabled'}>单独核对</button></div>
 <details class="match-groups"><summary>已连接 ${config.groups.length} 组 · 点击可断开</summary>${config.groups.map((g,index)=>`<div class="match-group-row"><span><b style="color:${colors[index%colors.length]}">${index+1}</b> ${g.sales.map(id=>esc(byId.sales.get(id)?.name||id)).join('＋')} ↔ ${g.egg.map(id=>esc(byId.egg.get(id)?.name||id)).join('＋')}</span><button type="button" class="small-button" data-action="match-unlink" data-index="${index}">断开</button></div>`).join('')}</details>
 <button type="button" class="primary-button match-confirm" data-action="match-confirm" ${progress.complete?'':'disabled'}>确认匹配，查看今日结果</button><button type="button" class="small-button" data-action="match-auto">重新预连同名物品</button>`;
}
export function drawMatchingLines(root){
 const board=root.querySelector('.match-board'),svg=board?.querySelector('.match-wires');if(!svg)return;
 const rect=board.getBoundingClientRect();svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);svg.setAttribute('width',rect.width);svg.setAttribute('height',rect.height);
 const paths=[];for(const band of board.querySelectorAll('[data-pair-band]')){
  const nodes=[...band.querySelectorAll('.match-node')],points=nodes.map(n=>{const r=n.getBoundingClientRect(),left=n.dataset.side==='sales';return {x:(left?r.right:r.left)-rect.left,y:r.top+r.height/2-rect.top,left};});
  const mid=rect.width/2,y=points.reduce((n,p)=>n+p.y,0)/points.length,color=colors[Number(band.dataset.pairBand)%colors.length];
  for(const p of points)paths.push(`<path d="M ${p.x} ${p.y} C ${(p.x+mid)/2} ${p.y}, ${(p.x+mid)/2} ${y}, ${mid} ${y}" stroke="${color}"/>`);
  paths.push(`<circle cx="${mid}" cy="${y}" r="4" fill="${color}"/>`);
 }svg.innerHTML=paths.join('');
}
