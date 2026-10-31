import {probeConnection} from './connection.js';
import * as C from './core.js';
import {BrowserLedger} from './storage.js';
import {CloudLedger} from './cloud.js';
import {cloudConfig} from './cloud-config.js';

const icons={
 count:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 history:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',stats:'<path d="M4 20V10m8 10V4m8 16v-7"/>',ratio:'<path d="M5 19L19 5"/><circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/>',plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',arrow:'<path d="M9 5l7 7-7 7"/>',back:'<path d="M15 5l-7 7 7 7"/>',close:'<path d="M6 6l12 12M6 18L18 6"/>',install:'<path d="M12 15V3m-4 4l4-4 4 4M5 11v8a2 2 0 002 2h10a2 2 0 002-2v-8"/>',stock:'<path d="M3 7l9-4 9 4v11l-9 4-9-4zM3 7l9 4 9-4M12 11v11M7 5l10 4"/>',leaf:'<path d="M20 4C7 2 1 10 7 17c6 6 14-1 13-13zM5 20L16 9"/>',search:'<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5"/>',trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',download:'<path d="M12 3v12m-4-4l4 4 4-4M4 15v6h16v-6"/>',upload:'<path d="M12 15V3m-4 4l4-4 4 4M4 15v6h16v-6"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H4v13h4"/>',check:'<path d="M5 12l4 4L19 6"/>',edit:'<path d="M15 4l5 5M4 20l5-1L21 7l-5-5L4 14z"/>',shield:'<path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',file:'<path d="M14 3H5v18h14V8zM14 3v5h5M8 13h8M8 17h5"/>'};
const icon=(name,extra='')=>`<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.leaf}</svg>`;
const e=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const fmt=n=>Number(n).toLocaleString('zh-CN');
const title=k=>k==='sales'?'销售记数':'库存点数';
const palette=['#a8c0a1','#dbc5a7','#acb8ce','#d4aeb0','#bfb0ce','#b6c7b3','#d7c5a1','#a7bfb8','#c5bbac'];
const color=item=>palette[Math.abs(Number(item.color)||0)%palette.length];
const main=document.querySelector('#main'),nav=document.querySelector('.bottom-nav'),sheet=document.querySelector('#sheet'),sheetContent=document.querySelector('#sheet-content'),fileInput=document.querySelector('#import-file');
const localMode=new URLSearchParams(location.search).get('local')==='1';
const ledger=localMode?new BrowserLedger():new CloudLedger(cloudConfig);
let state={page:['count','history','stats','ratio','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'count',book:'sales',range:0,keyword:'',direction:0,historyLimit:80,selection:new Set(),selecting:false,itemID:null,ratioMode:'parts',ratioSelected:new Set(),ratioValues:Object.create(null),ratioPlan:null,ratioError:null,authMode:'login',baseID:'',selectedHour:null};
let toastTimer,formSubmit=null,restoreExpected=null,backupReady=null;
icons.egg='<path d="M12 3c3.6 0 6.5 4.4 6.5 9.2 0 4.4-2.9 8.3-6.5 8.3S5.5 16.6 5.5 12.2C5.5 7.4 8.4 3 12 3z"/><path d="M9.5 9.5c.6-1.2 1.5-2 2.5-2"/>';
const TAB_LABELS={count:'记数',egg:'放蛋',history:'历史',stats:'统计',ratio:'比例',settings:'设置'};
const DEFAULT_TABS=['count','egg','history','stats','ratio','settings'];
const loadTabs=()=>{try{const raw=JSON.parse(localStorage.getItem('little-tally-tabs')||'null');if(Array.isArray(raw)&&raw.length===DEFAULT_TABS.length&&DEFAULT_TABS.every(k=>raw.includes(k)))return raw;}catch{}return DEFAULT_TABS.slice();};
const saveTabs=tabs=>{try{localStorage.setItem('little-tally-tabs',JSON.stringify(tabs));}catch{}};
const loadEggMode=()=>{try{const raw=localStorage.getItem('little-tally-egg-mode');return raw===null?true:raw==='1';}catch{return true;}};
const saveEggMode=value=>{try{localStorage.setItem('little-tally-egg-mode',value?'1':'0');}catch{}};
const loadBooks=()=>{try{const raw=JSON.parse(localStorage.getItem('little-tally-books')||'null');if(raw&&typeof raw==='object')return {sales:raw.sales!==false,stock:raw.stock!==false,egg:raw.egg!==false};}catch{}return {sales:true,stock:true,egg:true};};
const saveBooks=books=>{try{localStorage.setItem('little-tally-books',JSON.stringify(books));}catch{}};
Object.assign(state,{eggPick:null,eggOnlyLeft:false,eggItemID:null,eggSelecting:false,eggSelection:new Set(),eggArrange:false,eggDraft:null,eggCols:2,tabDrag:null,books:loadBooks(),eggReroll:0,statsGran:'hour',statsItem:null});
const enabledBooks=()=>['sales','stock','egg'].filter(k=>state.books[k]);
const eggMode=()=>enabledBooks().length===1&&state.books.egg;
let TABS=loadTabs();
function book(){return ledger.state[state.book];}
function toast(text){const node=document.querySelector('#toast');node.textContent=text;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),3600);}
function timeBadge(){return ledger.savedAt?`${localMode?'本机已保存':'云端已保存'} ${C.clock(ledger.savedAt)}`:localMode?'自动保存到本机':'登录后自动保存到云端';}
function render(){
 document.body.classList.toggle('count-screen',(localMode||ledger.signedIn)&&!ledger.loading&&!ledger.readOnly&&state.page==='count'&&!state.itemID);
 document.body.classList.toggle('egg-screen',(localMode||ledger.signedIn)&&!ledger.loading&&!ledger.readOnly&&state.page==='egg'&&!state.eggItemID);
 document.querySelector('[data-icon="install"]').innerHTML=icon('install');
 if(!localMode&&(!ledger.signedIn||ledger.loading)){nav.hidden=true;main.innerHTML=loginView();return;}
 nav.hidden=false;
 nav.innerHTML=TABS.filter(p=>{if(p==='egg')return state.books.egg;if(p==='count')return state.books.sales||state.books.stock;return true;}).map(p=>`<button data-action="page" data-page="${p}" class="${state.page===p?'active':''}" ${state.page===p?'aria-current="page"':''}>${icon(p)}<span>${TAB_LABELS[p]}</span></button>`).join('');
 if(ledger.readOnly&&state.page!=='settings'){main.innerHTML=`<div class="empty">${icon('shield')}<strong>先保护好你的记录</strong><p>${e(ledger.error)}</p>${!localMode?'<button class="primary-button" data-action="sync-cloud">重新同步云端记录</button>':''}<button class="secondary-button" style="margin-top:12px" data-action="page" data-page="settings">查看恢复与备份</button></div>`;return;}
 if(state.eggItemID&&state.page==='egg')main.innerHTML=eggDetailView();
 else if(state.itemID&&state.page==='count')main.innerHTML=detailView();
 else{
  try{main.innerHTML=({count:countView,egg:eggView,history:historyView,stats:statsViewNew,ratio:ratioView,settings:settingsView}[state.page]||countView)();}
  catch(err){state.eggItemID=null;state.page='count';main.innerHTML=countView();toast('这个页面刚刚没打开，已回到记数页。');}
 }
 fitItemGrid();fitEggGrid();layoutVars();
}
function fitItemGrid(){
 const grid=main.querySelector('.count-dashboard .item-grid');if(!grid)return;
 const count=grid.children.length,{width,height}=grid.getBoundingClientRect();if(!width||!height)return;
 const gap=parseFloat(getComputedStyle(grid).gap)||8,minWidth=94,minHeight=matchMedia('(max-height:650px)').matches?94:108,maxColumns=Math.max(1,Math.min(6,Math.floor((width+gap)/(minWidth+gap))));
 let best=null;
 for(let columns=1;columns<=maxColumns;columns++){
  const rows=Math.ceil(count/columns),w=(width-gap*(columns-1))/columns,h=(height-gap*(rows-1))/rows;
  const score=Math.min(w/130,h/140)-((rows*columns-count)/Math.max(1,count))*.12;
  if(!best||score>best.score)best={columns,rows,score};
 }
 grid.style.setProperty('--item-columns',best.columns);grid.style.setProperty('--item-rows',best.rows);
 grid.classList.toggle('item-grid-scroll',(height-gap*(best.rows-1))/best.rows<minHeight);
}
function layoutVars(){
 const height=Math.round(nav.getBoundingClientRect().height);
 document.documentElement.style.setProperty('--nav-h',(height>0?height:64)+'px');
}
new ResizeObserver(()=>{fitItemGrid();fitEggGrid();}).observe(main);
function loginView(){const registering=state.authMode==='register';return `<section class="hero login-hero"><p class="section-eyebrow">KEEP EVERY LITTLE MOMENT</p><h1>每一笔，都好好收着。</h1><p class="login-description">记数、点库存，也记住小小的收获。<br>登录你的账户，接着上一次继续。</p><svg class="login-art" viewBox="0 0 108 108" aria-hidden="true"><path d="M37 28v52m17-52v52m17-52v52M23 71l63-29" fill="none" stroke="#386b4f" stroke-width="5" stroke-linecap="round"/></svg></section><section class="panel login-panel"><h2>${ledger.loading?'正在打开你的账本…':registering?'创建你的账户':'欢迎回来'}</h2><p class="inline-caption">${registering?'只需用户名和密码，不需要邮箱。':'用用户名和密码，打开自己的账本。'}</p>${ledger.error?`<div class="soft-message error">${e(ledger.error)}</div>`:''}${!ledger.loading?`<form id="account-form"><label class="field-label" for="account-username">用户名</label><input class="field-input" id="account-username" name="username" type="text" autocapitalize="none" spellcheck="false" autocomplete="username" placeholder="3–24 位字母、数字或下划线" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" required ${ledger.configured?'':'disabled'}><label class="field-label" style="margin-top:18px" for="account-password">密码</label><input class="field-input" id="account-password" name="password" type="password" autocomplete="${registering?'new-password':'current-password'}" placeholder="${registering?'至少 6 位，可用纯数字或纯字母':'请输入密码'}" ${registering?'minlength="6"':''} maxlength="128" required ${ledger.configured?'':'disabled'}>${registering?'<label class="field-label" style="margin-top:18px" for="account-confirm">确认密码</label><input class="field-input" id="account-confirm" name="confirm" type="password" autocomplete="new-password" placeholder="再输入一次密码" minlength="6" maxlength="128" required>':''}<button class="primary-button" type="submit" style="margin-top:22px" ${ledger.configured?'':'disabled'}>${icon('shield')}${registering?'注册并进入':'登录'}</button><p class="hint">用户名不区分大小写。${registering?'请保存好用户名和密码；此版本不通过邮箱找回密码。':'不同账户的记录单独保存。'}</p><div id="account-message" class="sheet-error" role="status"></div></form><button class="small-button" style="width:100%;margin-top:14px" data-action="auth-mode">${registering?'已有账户？去登录':'还没有账户？注册一个'}</button>${!ledger.configured?'<div class="soft-message warn">账户服务正在准备中，暂时不能注册或同步云端记录。</div>':''}`:''}</section><section class="panel" style="margin-top:18px"><button class="small-button" style="width:100%" data-action="check-connection">检查连接</button><div id="connection-message" class="hint" role="status" style="white-space:pre-line">遇到打不开、注册或登录失败时，可检查当前网络。</div></section><div class="login-features"><span>${icon('check')}独立账户</span><span>${icon('check')}云端保存</span><span>${icon('check')}随时导出</span></div><p class="hint" style="text-align:center">已有本机数据？登录后可从设置导入备份。</p><button class="small-button" style="width:100%;margin-top:14px" data-action="local-mode">先体验本机记数（不含云端同步）</button>`;}

function pageHeading(eyebrow,name,subtitle){return `<p class="section-eyebrow">${eyebrow}</p><h1 class="page-title">${name}</h1><p class="page-subtitle">${subtitle}</p>`;}
function empty(name='这里还没有记录',hint='去记下第一件小小的收获吧。'){return `<div class="empty">${icon('leaf')}<strong>${name}</strong><p>${hint}</p></div>`;}
function countView(){
 const b=book(),c=C.counts(b),total=C.sum(Object.values(c)),today=C.sum(C.todayRecords(b).map(r=>r.delta));
 const date=new Intl.DateTimeFormat('zh-CN',{timeZone:C.ZONE,month:'long',day:'numeric',weekday:'long'}).format(Date.now());
 return `<section class="count-dashboard"><div class="book-switch" aria-label="选择账本">${['sales','stock'].map(k=>`<button class="${state.book===k?'active':''}" data-action="book" data-book="${k}">${icon(k==='sales'?'count':'stock')}${title(k)}</button>`).join('')}</div>
 ${localMode?'<div class="mode-banner">本机体验模式 · 记录仅在当前设备 <button data-action="cloud-mode">登录云端版 →</button></div>':''}<section class="hero" aria-label="账本合计"><div class="hero-top"><div><h1>${state.book==='sales'?'随手记下每一件':'下班，点一点库存'}</h1><span class="date">${date} · 北京时间</span></div><span class="badge">${localMode?'本机体验':'云端账户'}</span></div><svg class="hero-art" viewBox="0 0 108 108" fill="none" aria-hidden="true"><path d="M37 28v52m17-52v52m17-52v52M23 71l63-29" stroke="#386b4f" stroke-width="5" stroke-linecap="round"/></svg><div class="hero-total ${String(total).length>7?'long':''}" data-testid="total">${fmt(total)}<small>件</small></div><div class="hero-bottom"><span>${b.items.length} 类物品 · 累计数量</span><span class="today">今日 ${today>=0?'+':''}${fmt(today)}</span></div></section>
 ${goalBanner(b)}<div class="heading-row count-heading"><h2>我的物品 <span class="muted" style="font-size:11px;font-weight:400;margin-left:5px">${String(b.items.length).padStart(2,'0')}</span></h2><div class="count-tools"><button class="small-button" data-action="add-item">${icon('plus')}添加</button><button class="small-button" data-action="manage">${icon('settings')}管理</button></div></div>
 ${b.items.length?`<div class="item-grid">${b.items.map(i=>`<article class="item-card"><button class="item-name" data-action="detail" data-id="${e(i.id)}"><span class="dot" style="background:${color(i)}"></span><span class="name">${e(i.name)}</span>${icon('arrow')}</button><button class="item-number ${String(c[i.id]).length>6?'long':''}" data-action="edit-count" data-id="${e(i.id)}" aria-label="修改${e(i.name)}数量">${fmt(c[i.id])}</button>${state.book==='stock'&&Object.keys(i.breakdown).length?`<div class="item-parts">${Object.entries(i.breakdown).map(([k,v])=>`${e(k)} ${fmt(v)}`).join(' · ')}</div>`:''}<div class="stepper"><button class="minus" data-action="decrease" data-id="${e(i.id)}" aria-label="${e(i.name)}减一" ${c[i.id]===0?'disabled':''}>${icon('minus')}</button><button class="plus" data-action="increase" data-id="${e(i.id)}" aria-label="${e(i.name)}加一">${icon('plus')}</button></div></article>`).join('')}</div>`:empty('还没有物品','添加第一件物品，开始记录吧。')}
 <p class="count-save green" role="status">${icon('check')}<span>${e(timeBadge())}</span><span class="count-tip">点数字改数 · 点名称查看</span></p></section>`;
}
function goalBanner(b){if(!b.goal)return '';try{const p=C.ratioPlan(b,b.goal);return `<div class="soft-message"><b>${p.added===0?'✓ 固定目标已达标':'◎ 固定目标 · 还需补充'}</b><div class="goal-chips">${b.items.filter(i=>p.additions[i.id]>0).map(i=>`<span>${e(i.name)} +${fmt(p.additions[i.id])}</span>`).join('')}${p.other>0?`<span>其他物品合计 +${fmt(p.other)}</span>`:''}</div></div>`;}catch{return '<div class="soft-message warn">固定目标需要调整，请到比例页查看。</div>';}}
function recordLine(r,selectable=false){const i=book().items.find(i=>i.id===r.itemId);return `<div class="record-wrap"><div class="row">${selectable&&state.selecting?`<input class="record-check" type="checkbox" data-record="${e(r.id)}" aria-label="选择${e(i?.name)}这条记录" ${state.selection.has(r.id)?'checked':''}>`:`<span class="record-symbol ${r.delta<0?'negative':''}">${icon(r.delta>=0?'plus':'minus')}</span>`}<div class="row-main"><div class="row-title">${e(i?.name||'物品')}</div><div class="row-meta">${e(C.clock(r.at))}${r.kind==='set'?' · 手动改数':''}</div></div><span class="row-number ${r.delta<0?'red':'green'}">${r.delta>0?'+':''}${fmt(r.delta)}</span>${!state.selecting?`<button class="delete-small" data-action="delete-record" data-id="${e(r.id)}" aria-label="删除${e(i?.name)}这条记录">${icon('trash')}</button>`:''}</div></div>`;}
function filteredRecords(){const names=Object.fromEntries(book().items.map(i=>[i.id,i.name])),today=C.day(Date.now()),days=state.range===1?7:30;const start=state.range===0?today:state.range===3?'':C.day(Date.now()-(days-1)*86400000);return book().records.filter(r=>(!state.itemID||state.page!=='history'||r.itemId===state.itemID)&&(!start||C.day(r.at)>=start)&&(!state.keyword||names[r.itemId]?.toLowerCase().includes(state.keyword.toLowerCase()))&&(state.direction===0||(state.direction===1?r.delta>0:r.delta<0))).sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id));}
function eggHistoryView(){
 const egg=eggBook(),progress=C.eggProgress(egg),byId=Object.fromEntries(progress.map(p=>[p.id,p]));
 const rows=egg.records.slice().sort((a,b)=>b.at-a.at);
 return `${pageHeading('EVERY LITTLE MOMENT','放蛋的每一笔',`共 ${fmt(C.eggTotal(egg))} 个 · ${rows.length} 条记录`)}${bookPicker()}
 <div class="heading-row"><span class="inline-caption">${rows.length} 条记录</span><button class="small-button" data-action="egg-select">${state.eggSelecting?'完成':'多选删除'}</button></div>
 ${state.eggSelecting?`<div class="selection-actions"><button data-action="egg-select-all">全选</button><button class="remove" data-action="egg-delete-selected" ${state.eggSelection.size?'':'disabled'}>删除 ${state.eggSelection.size} 条</button></div>`:''}
 <div class="panel" style="padding-top:7px;padding-bottom:7px">${rows.length?rows.slice(0,200).map(r=>eggRecordLine(r,byId[r.itemId]||{id:r.itemId,name:'物品'})).join(''):empty('还没有放蛋记录','去放蛋页放几个。')}</div>`;
}
function historyView(){
 if(state.book==='egg')return eggHistoryView();const rows=filteredRecords();return `${pageHeading('EVERY LITTLE MOMENT','每一笔，都记得',`${title(state.book)} · 时间统一使用北京时间`)}${bookPicker()}<div class="search">${icon('search')}<input type="search" aria-label="搜索物品名称" placeholder="搜索物品名称" id="history-search" value="${e(state.keyword)}"></div>${rangePills()}<div class="heading-row"><span class="inline-caption" id="history-count">${rows.length} 条记录</span><button class="small-button" data-action="select-records">${state.selecting?'完成':'多选删除'}</button></div>${state.selecting?`<div class="selection-actions"><button data-action="select-all">选择筛选结果</button><button class="remove" data-action="delete-selected" ${state.selection.size?'':'disabled'}>删除 ${state.selection.size} 条</button></div>`:''}<div class="panel" id="history-list" style="padding-top:7px;padding-bottom:7px">${historyRows(rows)}</div>`;}
function historyRows(rows){return rows.length?rows.slice(0,state.historyLimit).map(r=>recordLine(r,true)).join('')+(rows.length>state.historyLimit?`<button class="small-button" style="width:100%" data-action="more-history">加载更多（已显示 ${state.historyLimit} 条）</button>`:''):empty();}
function bookPicker(){const keys=enabledBooks();if(keys.length<2)return '';return `<div class="book-switch">${keys.map(k=>`<button data-action="book" data-book="${k}" class="${state.book===k?'active':''}">${k==='egg'?'放蛋':title(k)}</button>`).join('')}</div>`;}
function rangePills(){return `<div class="pill-row">${['今天','近7天','近30天','全部'].map((v,i)=>`<button class="${state.range===i?'active':''}" data-action="range" data-range="${i}">${v}</button>`).join('')}</div>`;}
function statsViewNew(){
 if(state.book==='egg')return eggStatsView();
 const b=book(),items=b.items,rows=filteredRecords();
 const filter=state.statsItem||null,gran=state.statsGran||'hour';
 const busiest=Array(24).fill(0);for(const r of rows)if(r.delta>0)busiest[C.hour(r.at)]+=r.delta;
 let hour=state.selectedHour;if(hour===null){let best=0;for(let h=1;h<24;h++)if(busiest[h]>busiest[best])best=h;hour=best;}
 const c=Object.fromEntries(items.map(i=>[i.id,0]));for(const r of rows)c[r.itemId]+=r.delta;
 const pos=C.sum(Object.values(c).filter(n=>n>0));
 const todayRows=C.todayRecords(b).filter(r=>!filter||r.itemId===filter).sort((x,y)=>y.at-x.at);
 const list=filter?todayRows:rows.slice().sort((x,y)=>y.at-x.at).slice(0,60);
 const activeName=filter?(items.find(i=>i.id===filter)?.name||''):'';
 return `${pageHeading('A LITTLE MORE INSIGHT','小小记录，大有发现',`${title(state.book)} · 包含加减与手动改数`)}${bookPicker()}${rangePills()}
 <div class="metric-grid"><div><small>期间净增加</small><strong>${fmt(C.sum(rows.map(r=>r.delta)))}</strong></div><div><small>记录次数</small><strong>${fmt(rows.length)}</strong></div><div><small>活跃物品</small><strong>${new Set(rows.map(r=>r.itemId)).size}</strong></div></div>
 <section class="panel"><div class="heading-row"><h2 style="margin:0">时段分布</h2><div class="book-switch"><button data-action="stats-gran" data-gran="hour" class="${gran==='hour'?'active':''}">24 小时</button><button data-action="stats-gran" data-gran="minute" class="${gran==='minute'?'active':''}">按分钟</button></div></div>
 ${rows.length?`${chartBlock(rows,items,{gran,hour:gran==='minute'?hour:null,filter})}${gran==='minute'?`<p class="hour-result">${String(hour).padStart(2,'0')}:00–${String(hour+1).padStart(2,'0')}:00 · 每分钟${filter?'（只看 '+e(activeName)+'）':''}</p>`:`<p class="hour-result">颜色代表物品，点一根柱子看那一小时的每分钟</p>`}${legendRow(items,filter)}`:empty('还没有变化','开始记数后，这里就有你的节奏。')}</section>
 <section class="panel"><h2>${filter?'今天 · '+e(activeName):'明细'}</h2>${list.length?list.map(r=>recordLine(r)).join(''):empty('这里还没有记录')}</section>
 <section class="panel"><h2>物品占比与排行</h2>${items.slice().sort((x,y)=>c[y.id]-c[x.id]).map(i=>{const p=pos?Math.max(0,c[i.id])/pos*100:0;return `<div class="rank-row"><div class="rank-title"><span>${e(i.name)}</span><small>${fmt(c[i.id])} 件 · ${p.toFixed(1)}%</small></div><div class="rank-track"><div class="rank-fill" style="width:${p}%"></div></div></div>`;}).join('')}</section>`;
}
function eggStatsView(){
 const egg=eggBook(),rows=egg.records.slice().sort((a,b)=>b.at-a.at);
 if(!egg.items.length)return `${pageHeading('A LITTLE MORE RHYTHM','放蛋的数据','添加物品后这里就有数据。')}${bookPicker()}${empty('还没有放蛋物品','去放蛋页添加。')}`;
 const total=C.eggTotal(egg),round=C.eggRound(egg),progress=C.eggProgress(egg);
 const hours=Array(24).fill(0);for(const r of rows)hours[C.hour(r.at)]+=r.delta;
 const max=Math.max(1,...hours),min=Math.min(0,...hours),height=max-min,zero=max/height*100;
 const peak=Math.max(1,...progress.map(p=>p.count));
 return `${pageHeading('A LITTLE MORE RHYTHM','放蛋的数据',`共 ${fmt(total)} 个 · 已完成 ${round} 轮 · ${egg.items.length} 个物品`)}${bookPicker()}
 <div class="metric-grid"><div><small>总件数</small><strong>${fmt(total)}</strong></div><div><small>记录次数</small><strong>${fmt(rows.length)}</strong></div><div><small>已完成轮数</small><strong>${round}</strong></div></div>
 <section class="panel"><div class="heading-row"><h2 style="margin:0">时段分布</h2><span class="badge">24 H</span></div>${rows.length?`<div class="chart" role="group" aria-label="每小时净增加柱状图">${hours.map((n,h)=>`<span class="bar-column" aria-label="${h}点${n}个"><span class="bar ${n<0?'negative':''}" style="height:${Math.abs(n)/height*100}%;top:${n>=0?(max-n)/height*100:zero}%"></span></span>`).join('')}</div><div class="chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>`:empty('还没有记录','放几个就有分布了。')}</section>
 <section class="panel"><h2>每个物品</h2>${progress.slice().sort((a,b)=>b.count-a.count).map(p=>`<div class="rank-row"><div class="rank-title"><span>${e(p.name)}</span><small>${fmt(p.count)} 个 · 比例 ${p.ratio} · 本轮 ${p.progress}/${p.ratio}</small></div><div class="rank-track"><div class="rank-fill" style="width:${Math.round(p.count/peak*100)}%"></div></div></div>`).join('')}</section>`;
}
function itemColor(index){return palette[Math.abs(index)%palette.length];}
function chartBlock(records,items,{gran='hour',hour=null,filter=null}={}){
 const buckets=gran==='minute'?60:24;
 const series=items.filter(i=>!filter||i.id===filter).map((i,idx)=>({id:i.id,name:i.name,color:itemColor(items.indexOf(i)),values:Array(buckets).fill(0)}));
 const byId=Object.fromEntries(series.map(s=>[s.id,s]));
 for(const r of records){
  if(r.delta<=0)continue;
  const s=byId[r.itemId];if(!s)continue;
  if(gran==='minute'){if(hour===null||C.hour(r.at)!==hour)continue;const m=C.minute(r.at);if(m>=0&&m<60)s.values[m]+=r.delta;}
  else s.values[C.hour(r.at)]+=r.delta;
 }
 const max=Math.max(1,...series.flatMap(s=>s.values));
 const label=gran==='minute'?'分':'点';
 return `<div class="stacked-chart" role="group" aria-label="按${gran==='minute'?'分钟':'小时'}的数量">${Array.from({length:buckets},(_,b)=>{
  const segs=series.filter(s=>s.values[b]>0).map(s=>`<span class="seg" style="height:${(s.values[b]/max*100).toFixed(1)}%;background:${s.color}" title="${e(s.name)} ${s.values[b]}"></span>`).join('');
  return `<button class="hour-col${hour===b&&gran==='minute'?' on':''}" data-action="stats-hour" data-hour="${b}" aria-label="${b}${label}">${segs}</button>`;
 }).join('')}</div>`;
}
function legendRow(items,filter){
 return `<div class="legend"><button data-action="stats-filter" data-id="" class="${!filter?'on':''}">全部物品</button>${items.map((i,idx)=>`<button data-action="stats-filter" data-id="${e(i.id)}" class="${filter===i.id?'on':''}"><span class="swatch" style="background:${itemColor(idx)}"></span>${e(i.name)}</button>`).join('')}</div>`;
}
function statsView(){
 if(state.book==='egg')return eggStatsView();
 const rows=filteredRecords(),c=Object.fromEntries(book().items.map(i=>[i.id,0]));for(const r of rows)c[r.itemId]+=r.delta;
 const hours=Array(24).fill(0);for(const r of rows)hours[C.hour(r.at)]+=r.delta;
 const max=Math.max(1,...hours),min=Math.min(0,...hours),height=max-min,zero=max/height*100,pos=C.sum(Object.values(c).filter(n=>n>0));
 return `${pageHeading('A LITTLE MORE INSIGHT','小小记录，大有发现',`${title(state.book)} · 包含加减与手动改数`)}${bookPicker()}${rangePills()}<div class="metric-grid"><div><small>期间净增加</small><strong>${fmt(C.sum(rows.map(r=>r.delta)))}</strong></div><div><small>记录次数</small><strong>${fmt(rows.length)}</strong></div><div><small>活跃物品</small><strong>${new Set(rows.map(r=>r.itemId)).size}</strong></div></div>
 <section class="panel"><div class="heading-row"><h2 style="margin:0">${state.book==='sales'?'销售时间分布':'库存变动时间分布'}</h2><span class="badge">24 H</span></div>${rows.length?`<div class="chart" role="group" aria-label="每小时净增加柱状图">${hours.map((n,h)=>`<button class="bar-column ${state.selectedHour===h?'selected':''}" style="--zero:${zero}%" data-action="hour" data-hour="${h}" aria-label="${h}点净增加${n}件"><span class="bar ${n<0?'negative':''}" style="height:${Math.abs(n)/height*100}%;top:${n>=0?(max-n)/height*100:zero}%"></span></button>`).join('')}</div><div class="chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div><p class="hour-result">${state.selectedHour!==null?`${String(state.selectedHour).padStart(2,'0')}:00–${String(state.selectedHour+1).padStart(2,'0')}:00 · 净增加 ${hours[state.selectedHour]} 件`:'点击柱形，查看这个小时的记录'}</p>`:empty('还没有变化','开始记数后，这里就有你的节奏。')}</section>
 <section class="panel"><h2>物品占比与排行</h2>${book().items.slice().sort((a,b)=>c[b.id]-c[a.id]).map(i=>{const p=pos?Math.max(0,c[i.id])/pos*100:0;return `<div class="rank-row"><div class="rank-title"><span>${e(i.name)}</span><small>${fmt(c[i.id])} 件 · ${p.toFixed(1)}%</small></div><div class="rank-track"><div class="rank-fill" style="width:${p}%"></div></div></div>`;}).join('')}<p class="hint">占比按各物品正的净增加数量计算；修正发生在哪个时间，就记入哪个时间。</p></section>`;
}
function detailView(){const i=book().items.find(i=>i.id===state.itemID);if(!i){state.itemID=null;return countView();}const c=C.counts(book()),rows=book().records.filter(r=>r.itemId===i.id).sort((a,b)=>b.at-a.at);return `<button class="back-button" data-action="detail-back">${icon('back')}返回我的物品</button><div class="detail-hero"><div class="heading-row"><h1 class="page-title" style="font-size:23px">${e(i.name)}</h1><button class="small-button" data-action="edit-count" data-id="${e(i.id)}">${icon('edit')}改数</button></div><div class="sheet-amount">${fmt(c[i.id])}<small style="font-size:13px;letter-spacing:0;margin-left:10px">件</small></div><p class="inline-caption">创建于 ${e(C.clock(i.created,true))}</p></div>${state.book==='stock'?`<section class="panel"><div class="heading-row"><h2 style="margin:0">库存分项</h2><button class="small-button" data-action="add-part" data-id="${e(i.id)}">${icon('plus')}添加</button></div><div class="stock-part-row"><span>未分类</span><b class="value" style="font-weight:400">${fmt(c[i.id]-C.partsTotal(i))}</b></div>${Object.entries(i.breakdown).map(([name,n])=>`<div class="stock-part-row"><span>${e(name)}</span><button class="value green" data-action="edit-part" data-id="${e(i.id)}" data-part="${e(name)}" aria-label="修改${e(name)}">${fmt(n)}</button><button class="red" data-action="delete-part" data-id="${e(i.id)}" data-part="${e(name)}" aria-label="删除${e(name)}分项">${icon('trash')}</button></div>`).join('')}<p class="hint">增加分项先从未分类划入，不够时增加总库存。减少分项扣减总库存；删除分项并入未分类。</p></section>`:''}<section class="panel"><h2>最近记录 <span class="muted" style="font-size:11px;font-weight:400">${rows.length} 条</span></h2>${rows.length?rows.slice(0,80).map(r=>recordLine(r)).join(''):empty('还没有记数记录')}</section>`;}
function eggRatioSwitch(){const keys=enabledBooks();if(keys.length<2)return '';return `<div class="book-switch">${keys.map(k=>`<button data-action="book" data-book="${k}" class="${state.book===k?'active':''}">${k==='egg'?'放蛋':title(k)}</button>`).join('')}</div>`;}
function eggRatioView(){
 const egg=eggBook();
 if(!egg.items.length)return `${pageHeading('RATIO','放蛋比例','先添加物品，再给每个物品设比例。')}${eggRatioSwitch()}<section class="panel">${empty('还没有放蛋物品','去放蛋页添加。')}<button class="primary-button" data-action="egg-add-item">添加物品</button></section>`;
 const draft=state.eggDraft||(state.eggDraft=Object.fromEntries(egg.items.map(i=>[i.id,String(i.ratio)])));
 const progress=C.eggProgress(egg),byId=Object.fromEntries(progress.map(p=>[p.id,p])),round=C.eggRound(egg);
 const total=C.sum(egg.items.map(i=>i.ratio));
 return `${pageHeading('RATIO','放蛋比例',`${egg.items.length} 个物品 · 一轮 ${total} 个 · 已完成 ${round} 轮`)}
 ${eggRatioSwitch()}
 <section class="panel"><h2>每个物品的比例</h2>${egg.items.map(i=>`<div class="ratio-row"><label><span>${e(i.name)}<small>现有 ${fmt(byId[i.id].count)} 个 · 本轮 ${byId[i.id].progress}/${i.ratio}</small></span></label><input class="ratio-input" data-egg-ratio="${e(i.id)}" inputmode="numeric" aria-label="${e(i.name)}的比例" value="${e(draft[i.id]??i.ratio)}"></div>`).join('')}<p class="hint">比例是“一轮里放几个”。占比越小，算法把它排得越开；一轮里每个物品都要放满自己的比例。</p><div class="button-pair" style="margin-top:14px"><button class="secondary-button" data-action="egg-ratio-reset">恢复当前</button><button class="primary-button" data-action="egg-ratio-save">固定此比例</button></div></section>
 <section class="panel"><h2>只看缺的</h2><p class="inline-caption">放满 ${total} 个正好一轮，多出来的自动算进下一轮。</p><button class="list-button" data-action="egg-only">${icon('target')}<span>${state.eggOnlyLeft?'当前：只显示还缺的':'当前：显示全部物品'}</span>${icon('arrow','chevron')}</button></section>`;
}
function ratioView(){
 if(!enabledBooks().includes(state.book))state.book=enabledBooks()[0]||'sales';
 if(state.book==='egg')return eggRatioView();
 const b=book(),c=C.counts(b),base=b.items.find(i=>i.id===state.baseID),p=state.ratioPlan;
 return `${pageHeading('A LITTLE MORE BALANCE','配比，心里有数',`${title(state.book)} · 仅增加数量，自动计算还差多少`)}${bookPicker()}<section class="panel"><h2>基准换算</h2><select class="field-select" id="base-select" aria-label="选择基准物品"><option value="">选择一个有数量的物品</option>${b.items.map(i=>`<option value="${e(i.id)}" ${state.baseID===i.id?'selected':''}>${e(i.name)} · ${c[i.id]} 件</option>`).join('')}</select>${base&&c[base.id]>0?`<div style="margin-top:12px">${b.items.map(i=>`<div class="row" style="min-height:40px"><span class="row-main row-title">${e(i.name)}</span><span class="inline-caption">${(c[i.id]/c[base.id]).toFixed(3)} 份</span></div>`).join('')}</div>`:'<p class="hint">以所选物品 1 件为基准，换算其他物品的相对数量。</p>'}</section>
 <div class="section-spacer"></div><div class="heading-row"><h2>目标配比</h2>${b.goal?'<span class="badge">已有固定目标</span>':''}</div><div class="book-switch">${[['parts','比例份数'],['percent','百分比']].map(([k,label])=>`<button data-action="ratio-mode" data-mode="${k}" class="${state.ratioMode===k?'active':''}">${label}</button>`).join('')}</div><section class="panel">${b.items.map(i=>`<div class="ratio-row"><label><input type="checkbox" data-ratio-check="${e(i.id)}" ${state.ratioSelected.has(i.id)?'checked':''}><span>${e(i.name)}<small>现有 ${fmt(c[i.id])} 件</small></span></label><input class="ratio-input" data-ratio-value="${e(i.id)}" aria-label="${e(i.name)}${state.ratioMode==='parts'?'份数':'百分比'}" inputmode="${state.ratioMode==='parts'?'numeric':'decimal'}" placeholder="${state.ratioMode==='parts'?'份数':'%'}" value="${e(state.ratioValues[i.id]??'')}" ${state.ratioSelected.has(i.id)?'':'disabled'}>${state.ratioMode==='percent'?'<span class="muted" style="font-size:12px">%</span>':''}</div>`).join('')}<p class="hint">${state.ratioMode==='parts'?'按较大份数分轮补齐，未选物品不参与。70∶1 时，80/1 先补前者 60；141/1 先补后者 1。':'输入选中物品占全部物品的百分比，最多两位小数。未选物品会保留现有数量，并计算合计还需补多少。'}</p></section><button class="primary-button" data-action="calculate">${icon('ratio')}计算补齐方案</button>${state.ratioError?`<div class="soft-message error">${e(state.ratioError)}</div>`:''}${p?`<section class="panel" style="background:#e8f0e3"><h2>${p.added?'还需补充':'✓ 固定目标已达标'}</h2><p class="inline-caption">${e(p.note)}</p>${b.items.filter(i=>p.additions[i.id]>0).map(i=>`<div class="result-line"><span>${e(i.name)}</span><strong>+${fmt(p.additions[i.id])}</strong></div>`).join('')}${p.other?`<div class="result-line"><span>其他物品合计</span><strong>+${fmt(p.other)}</strong></div>`:''}<p class="hint">补完后总量 ${fmt(p.total)} 件</p><button class="primary-button" style="margin-top:15px" data-action="save-goal">保存为固定目标</button></section>`:''}${b.goal?'<button class="small-button red" style="width:100%;margin-top:12px" data-action="clear-goal">取消当前固定目标</button>':''}`;
}
function localSettingsView(){return `${pageHeading('KEEP EVERY LITTLE MOMENT','好好收着，每一笔','本机自动保存 · 不需要注册账户')}<section class="panel"><div class="row"><span class="record-symbol">${icon('shield')}</span><div class="row-main"><div class="row-title">${ledger.readOnly?'记录处于保护状态':'自动保存已开启'}</div><div class="row-meta">${e(ledger.readOnly?ledger.error:timeBadge())}</div></div><span class="badge">本机</span></div><p class="hint">每次操作先写入成功，再更新数量；重新打开自动读取上次记录。保留上一份和跨日恢复副本，且不会自动用空数据覆盖损坏记录。</p></section>
 ${ledger.readOnly?`<section class="panel"><h2>恢复本机记录</h2>${ledger.recoverable?'<button class="primary-button" data-action="recover-local">恢复找到的本机副本</button>':'<p class="inline-caption">尚未找到有效本机副本，请从导出的完整备份恢复。</p>'}<button class="list-button" data-action="export-raw">${icon('download')}<span>导出未能读取的原文件</span>${icon('arrow','chevron')}</button><button class="list-button" data-action="import-all">${icon('upload')}<span>从完整备份恢复</span>${icon('arrow','chevron')}</button></section>`:`<section class="panel"><h2>完整备份与恢复</h2><button class="list-button" data-action="export-all">${icon('download')}<span>导出全部记录</span><span class="badge" style="flex:0">推荐</span>${icon('arrow','chevron')}</button><button class="list-button" data-action="import-all">${icon('upload')}<span>从完整备份恢复</span>${icon('arrow','chevron')}</button><button class="list-button" data-action="previous">${icon('history')}<span>找回上一份本机副本</span>${icon('arrow','chevron')}</button><button class="list-button" data-action="copy-report">${icon('copy')}<span>复制今日记数与库存</span>${icon('arrow','chevron')}</button></section><section class="panel"><h2>安卓／iOS 账本迁移</h2>${['sales','stock'].map(k=>`<button class="list-button" data-action="export-book" data-book="${k}">${icon('download')}<span>导出${title(k)}</span>${icon('arrow','chevron')}</button><button class="list-button" data-action="import-book" data-book="${k}">${icon('upload')}<span>导入${title(k)}备份</span>${icon('arrow','chevron')}</button>`).join('')}</section>`}
 <section class="panel"><h2>在手机上更顺手</h2><button class="list-button" data-action="install">${icon('install')}<span>添加到主屏幕</span>${icon('arrow','chevron')}</button><button class="list-button" data-action="persist">${icon('shield')}<span>${ledger.protection?'已获浏览器持久存储权限':'请求浏览器保留本机记录'}</span>${icon('arrow','chevron')}</button></section><div class="backup-note"><b>本机保存，也要留一份备份。</b><br>清除网站数据、换浏览器或设备，会影响本机记录。请把“全部记录”备份存到“文件”App 或自己的网盘。添加到主屏幕后，请固定从同一个入口使用；不同浏览器和主屏幕版可能拥有不同的存储空间。<br><br>网页代码可以公开访问，你的计数记录只保存在当前设备，不会上传到 GitHub。</div><p class="hint" style="text-align:center;margin-top:25px">LITTLE TALLY · 小小记网页版 1.0</p>`;}
function settingsView(){if(localMode)return localSettingsView();return `${pageHeading('KEEP EVERY LITTLE MOMENT','好好收着，每一笔','独立账户 · 云端保存 · 本机备用副本')}<section class="panel"><div class="row"><span class="record-symbol">${icon('shield')}</span><div class="row-main"><div class="row-title">${e(ledger.user?.username||'我的账户')}</div><div class="row-meta">${e(ledger.readOnly?ledger.error:timeBadge())}</div></div><span class="badge">云端账户</span></div><p class="hint">每次操作收到云端保存确认后再更新数量。再次登录读取当前账户的云端记录，其他账户不能读取你的账本。</p>${ledger.cacheWarning?`<p class="sheet-error">${e(ledger.cacheWarning)}</p>`:''}<button class="list-button" data-action="sync-cloud">${icon('history')}<span>重新同步云端记录</span>${icon('arrow','chevron')}</button></section><section class="panel"><h2>启用的功能</h2>${[['sales','销售记数'],['stock','库存点数'],['egg','放蛋']].map(([k,label])=>`<div class="row"><div class="row-main"><div class="row-title">${label}</div><div class="row-meta">${state.books[k]?'已开启':'已关闭'}</div></div><button class="small-button" data-action="book-toggle" data-book="${k}">${state.books[k]?'关闭':'开启'}</button></div>`).join('')}<p class="hint">关掉的功能会从底部导航、历史、统计、比例里一起隐藏；三个都可以同时开启。</p></section><section class="panel"><h2>底部功能顺序</h2>${TABS.map((p,i)=>`<div class="order-row"><span>${TAB_LABELS[p]}</span><span class="order-buttons"><button class="ghost small" data-action="tab-up" data-page="${p}" ${i===0?'disabled':''}>↑</button><button class="ghost small" data-action="tab-down" data-page="${p}" ${i===TABS.length-1?'disabled':''}>↓</button></span></div>`).join('')}<p class="hint">除了长按底部按钮拖动，也可以在这里上下调。</p></section><section class="panel"><h2>账户安全</h2><button class="list-button" data-action="change-password">${icon('shield')}<span>修改密码</span>${icon('arrow','chevron')}</button><p class="hint">要先输入现在的密码，再输入两次新密码。</p></section><section class="panel"><h2>备份与恢复</h2>${ledger.readOnly?`<button class="list-button" data-action="export-raw">${icon('download')}<span>导出当前原始文件</span>${icon('arrow','chevron')}</button>`:`<button class="list-button" data-action="export-all">${icon('download')}<span>导出当前账户全部记录</span>${icon('arrow','chevron')}</button>`}<button class="list-button" data-action="import-all">${icon('upload')}<span>从完整备份恢复到当前账户</span>${icon('arrow','chevron')}</button><button class="list-button" data-action="previous">${icon('history')}<span>恢复上一份云端副本</span>${icon('arrow','chevron')}</button><p class="hint">云端保留最近 5 个历史版本供恢复。它们仍位于同一数据库，重要记录请另外导出保存。</p></section>${!ledger.readOnly?`<section class="panel"><h2>账本迁移与分享</h2>${['sales','stock'].map(k=>`<button class="list-button" data-action="export-book" data-book="${k}">${icon('download')}<span>导出${title(k)}</span>${icon('arrow','chevron')}</button><button class="list-button" data-action="import-book" data-book="${k}">${icon('upload')}<span>导入${title(k)}备份</span>${icon('arrow','chevron')}</button>`).join('')}<button class="list-button" data-action="copy-report">${icon('copy')}<span>复制今日记数与库存</span>${icon('arrow','chevron')}</button></section>`:''}<section class="panel"><h2>在手机上更顺手</h2><button class="list-button" data-action="install">${icon('install')}<span>添加到主屏幕</span>${icon('arrow','chevron')}</button><button class="list-button" data-action="persist">${icon('shield')}<span>请求保留本机备用副本</span>${icon('arrow','chevron')}</button></section><button class="secondary-button" data-action="logout" ${ledger.saving?'disabled':''}>退出当前账户</button><div class="backup-note">退出登录不会删除云端记录。同一台手机换人使用，请先退出当前账户；退出时会清除本页面的账本和当前账户的本机备用副本。<br><br>免费云服务有额度和可用性限制，重要记录请定期导出到自己的“文件”App 或网盘。</div><p class="hint" style="text-align:center;margin-top:25px">LITTLE TALLY · 小小记网页版 1.1</p>`;}
// ---------------------------------------------------------------------------
// 放蛋
// ---------------------------------------------------------------------------
function eggBook(){return C.ensureEgg(ledger.state);}
function eggOrder(egg){
 const known=egg.items.map(i=>i.id),order=Array.isArray(egg.order)?egg.order.filter(id=>known.includes(id)):[];
 for(const id of known)if(!order.includes(id))order.push(id);
 return order;
}
function sinceText(at){
 if(!at)return '还没有记录';
 const seconds=Math.max(0,Math.floor((Date.now()-at)/1000));
 if(seconds<60)return seconds+' 秒';
 const minutes=Math.floor(seconds/60);
 if(minutes<60)return minutes+' 分 '+String(seconds%60).padStart(2,'0')+' 秒';
 return Math.floor(minutes/60)+' 时 '+String(minutes%60).padStart(2,'0')+' 分';
}
function eggCard(p,egg){
 const flash=C.eggLastPlaced(egg)===p.id;
 const pct=p.target?Math.min(100,Math.round(p.progress/p.target*100)):0;
 const item=egg.items.find(i=>i.id===p.id)||{};
 return `<article class="egg-card${flash?' flash':''}" data-egg="${e(p.id)}">
  <button class="egg-open" data-action="egg-detail" data-id="${e(p.id)}" aria-label="查看${e(p.name)}的记录">
   <span class="egg-head"><span class="egg-name">${e(p.name)}</span><span class="egg-round">${p.progress}/${p.target}</span></span>
   <strong class="egg-count">${fmt(p.count)}</strong>
  </button>
  <div class="egg-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${p.target}" aria-valuenow="${p.progress}"><span style="width:${pct}%"></span></div>
  <div class="egg-foot">
   <span class="egg-timer" data-timer="${e(p.id)}">${sinceText(C.eggLastChange(egg,p.id))}</span>
   ${state.eggArrange?`<span class="egg-move">
     <button data-action="egg-move" data-id="${e(p.id)}" data-step="-cols" aria-label="上移">▲</button>
     <button data-action="egg-move" data-id="${e(p.id)}" data-step="-1" aria-label="左移">◀</button>
     <button data-action="egg-move" data-id="${e(p.id)}" data-step="1" aria-label="右移">▶</button>
     <button data-action="egg-move" data-id="${e(p.id)}" data-step="cols" aria-label="下移">▼</button>
   </span>`:`<span class="egg-pair"><button class="egg-minus" data-action="egg-minus" data-id="${e(p.id)}" aria-label="${e(p.name)}减一个">−1</button><button class="egg-plus" data-action="egg-add" data-id="${e(p.id)}" aria-label="${e(p.name)}放一个">+1</button></span>`}
  </div>
 </article>`;
}
function eggPickId(egg,byId){
 const pick=C.eggRecommend(egg,{jitter:state.eggReroll?1.4:0});if(!pick)return null;
 if(state.eggReroll){const alt=C.eggRecommendationSet(egg,4).filter(p=>p.id!==C.eggLastPlaced(egg));if(alt.length)return alt[state.eggReroll%alt.length].id;}
 if(byId[pick.id])return pick.id;
 return pick.id;
}
function eggView(){
 const egg=eggBook();
 if(!egg.items.length)return `<section class="egg-empty">${icon('egg')}<strong>先添加要放的物品</strong><p>给每个物品设好比例，之后点一下就是放一个蛋。</p><div class="egg-empty-actions"><button class="primary-button" data-action="egg-add-item">添加物品</button><button class="secondary-button" data-action="page" data-page="ratio">去设比例</button></div></section>`;
 const off=state.eggRoundView?1:0;
 const progress=C.eggProgress(egg).map(p=>{
  const round=p.round+off,value=Math.min(p.ratio,Math.max(0,p.count-round*p.ratio));
  return {...p,round,progress:value,left:p.ratio-value};
 });
 const byId=Object.fromEntries(progress.map(p=>[p.id,p]));
 const ids=eggOrder(egg).filter(id=>byId[id]);
 const shown=state.eggOnlyLeft?ids.filter(id=>byId[id].left>0):ids;
 const pickId=eggPickId(egg,byId),pick=pickId?byId[pickId]:null;
 const round=C.eggRound(egg)+off+1;
 const cols=Math.max(1,state.eggCols||1),lone=shown.length>cols-1&&shown.length%cols===1;
 return `<section class="egg-wrap">
  <div class="egg-reco">
   <div class="egg-reco-main"><span class="eyebrow">最推荐放</span><strong>${pick?e(pick.name):'—'}</strong><span class="egg-reco-meta">${pick?`本轮 ${pick.progress}/${pick.target}${round?` · 已完成 ${round} 轮`:''}`:'先添加物品'}</span></div>
   <div class="egg-reco-actions">${pick?`<button class="egg-add-main" data-action="egg-add" data-id="${e(pick.id)}">放一个 +1</button>`:''}<button class="ghost small" data-action="egg-reroll">换一个</button></div>
  </div>
  <div class="egg-toolbar">
   <span class="egg-chip">第 ${round} 轮${off?'（预览）':''}</span>
   <span class="egg-chip">共 ${fmt(C.eggTotal(egg))} 个</span>
   <button class="ghost small" data-action="egg-next-round">${off?'回到本轮':'看下一轮'}</button>
   <button class="ghost small${state.eggOnlyLeft?' on':''}" data-action="egg-only">${state.eggOnlyLeft?'只看缺的':'显示全部'}</button>
   <button class="ghost small${state.eggArrange?' on':''}" data-action="egg-arrange">${state.eggArrange?'完成排列':'排列位置'}</button>
   <button class="ghost small" data-action="egg-add-item">添加物品</button>
  </div>
  <div class="egg-grid" data-columns="${state.eggCols}" data-lone="${lone?'1':'0'}">${shown.length?shown.map(id=>eggCard(byId[id],egg)).join(''):`<p class="egg-none">这一轮都放满了，继续放就会进入下一轮。</p>`}</div>
 </section>`;
}
function eggDetailView(){
 const egg=eggBook(),item=egg.items.find(i=>i.id===state.eggItemID),p=C.eggProgress(egg).find(x=>x.id===state.eggItemID);
 if(!item||!p){state.eggItemID=null;return eggView();}
 const rows=egg.records.filter(r=>r.itemId===p.id).sort((a,b)=>b.at-a.at);
 const round=p.round+1;
 return `<button class="back-button" data-action="egg-back">${icon('back')}返回放蛋</button>
 <section class="panel egg-detail-head">
  <div class="heading-row"><button class="egg-title" data-action="egg-rename" data-id="${e(item.id)}">${e(item.name)}${icon('edit','tiny')}</button><span class="badge">第 ${round} 轮 · 比例 ${p.ratio}</span></div>
  <div class="egg-detail-numbers"><div><small>当前</small><strong>${fmt(p.count)}</strong></div><div><small>本轮</small><strong>${p.progress}/${p.target}</strong></div><div><small>距上次</small><strong data-timer="${e(p.id)}">${sinceText(C.eggLastChange(egg,p.id))}</strong></div></div>
  <div class="egg-progress big" role="progressbar" aria-valuemin="0" aria-valuemax="${p.target}" aria-valuenow="${p.progress}"><span style="width:${Math.min(100,Math.round(p.progress/p.target*100))}%"></span></div>
  <div class="egg-actions-row"><button class="egg-big minus" data-action="egg-minus" data-id="${e(p.id)}">−1</button><button class="egg-big plus" data-action="egg-add" data-id="${e(p.id)}">+1</button></div>
  <p class="hint">点名字可以改名；下一轮需要 ${p.ratio} 个；全部共 ${fmt(C.eggTotal(egg))} 个。</p>
 </section>
 <section class="panel"><div class="heading-row"><h2 style="margin:0">记录 <span class="muted" style="font-size:11px;font-weight:400">${rows.length} 条</span></h2><button class="small-button" data-action="egg-select">${state.eggSelecting?'完成':'多选删除'}</button></div>
 ${state.eggSelecting?`<div class="selection-actions"><button data-action="egg-select-all">全选</button><button class="remove" data-action="egg-delete-selected" ${state.eggSelection.size?'':'disabled'}>删除 ${state.eggSelection.size} 条</button></div>`:''}
 ${rows.length?rows.slice(0,200).map(r=>eggRecordLine(r,p)).join(''):empty('还没有记录','点“放一个”就会记下时间。')}</section>`;
}
function eggRecordLine(r,p){
 const active=state.eggSelection.has(r.id);
 return `<div class="record-wrap"><div class="row${active?' picked':''}">${state.eggSelecting?`<input class="record-check" type="checkbox" data-egg-record="${e(r.id)}" aria-label="选择这条记录" ${active?'checked':''}>`:`<span class="record-symbol ${r.delta<0?'negative':''}">${icon(r.delta>=0?'plus':'minus')}</span>`}<div class="row-main"><div class="row-title">${e(p.name)}</div><div class="row-meta">${e(C.clock(r.at,true))}${r.kind==='set'?' · 手动改数':''}</div></div><span class="row-number ${r.delta<0?'red':'green'}">${r.delta>0?'+':''}${fmt(r.delta)}</span>${!state.eggSelecting?`<button class="delete-small" data-action="egg-delete-record" data-id="${e(r.id)}" aria-label="删除这条记录">${icon('trash')}</button>`:''}</div></div>`;
}
function fitEggGrid(){
 const grid=main.querySelector('.egg-grid');if(!grid)return;
 const count=grid.children.length;if(!count)return;
 const width=grid.clientWidth;if(!width)return;
 const gap=parseFloat(getComputedStyle(grid).gap)||8;
 const min=132;
 let columns=Math.max(1,Math.min(6,Math.floor((width+gap)/(min+gap))));
 columns=Math.min(columns,count);
 const rows=Math.ceil(count/columns);
 grid.style.setProperty('--egg-columns',columns);
 grid.style.setProperty('--egg-rows',rows);
 state.eggCols=columns;
}
function eggTick(){
 for(const node of main.querySelectorAll('[data-timer]')){node.textContent=sinceText(Number(node.dataset.at)||C.eggLastChange(eggBook(),node.dataset.timer));}
}
async function mutateEgg(fn){await ledger.commit(s=>fn(C.ensureEgg(s)));state.eggDraft=null;state.eggPick=null;render();}
async function compressImage(file){
 const url=URL.createObjectURL(file);
 try{
  const image=await new Promise((resolve,reject)=>{const node=new Image();node.onload=()=>resolve(node);node.onerror=reject;node.src=url;});
  const max=720,scale=Math.min(1,max/Math.max(image.width||1,image.height||1));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round((image.width||1)*scale));
  canvas.height=Math.max(1,Math.round((image.height||1)*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',0.6);
 }finally{URL.revokeObjectURL(url);}
}
function pickEggPhoto(id){
 const input=document.createElement('input');
 input.type='file';input.accept='image/*';
 input.addEventListener('change',async()=>{
  const file=input.files?.[0];if(!file)return;
  try{const data=await compressImage(file);await mutateEgg(egg=>C.eggSetPhoto(egg,id,data));toast('图片已保存。');}
  catch{toast('这张图片没能保存，换一张试试。');}
 });
 input.click();
}
function showSheet(title,body,submit=null,button='保存'){formSubmit=submit;sheetContent.innerHTML=`<div class="sheet-top"><h2 id="sheet-title">${e(title)}</h2><button class="icon-button" data-action="close-sheet" aria-label="关闭">${icon('close')}</button></div><form id="sheet-form">${body}<div class="sheet-error" id="sheet-error" role="alert"></div>${submit?`<div class="button-pair"><button class="secondary-button" type="button" data-action="close-sheet">取消</button><button class="primary-button" type="submit">${e(button)}</button></div>`:''}</form>`;if(!sheet.open)sheet.showModal();requestAnimationFrame(()=>{const input=sheetContent.querySelector('input:not([type=checkbox])');if(input){input.focus();input.select();}});}
function closeSheet(){sheet.close();formSubmit=null;}
function confirmSheet(title,text,callback,button='确认'){showSheet(title,`<p>${e(text)}</p>`,async()=>{await callback();return true;},button);}
function itemInput(id){const i=book().items.find(i=>i.id===id);if(!i)return;showSheet(`修改 ${i.name}`,`<p>输入新的累计数量，差额会保存为一条记录。</p><label class="field-label" for="amount">新的累计数量</label><input class="field-input" id="amount" name="amount" inputmode="numeric" value="${C.counts(book())[id]}">`,async fd=>{const n=C.numberInput(String(fd.get('amount')));await mutate(b=>C.setCount(b,id,n));return true;});}
async function mutate(fn,kind=state.book){await ledger.commit(s=>fn(s[kind]));state.ratioPlan=null;render();}
function loadRatio(){const g=book().goal;state.ratioMode=g?.mode||'parts';state.ratioSelected=new Set(Object.keys(g?.values||{}));state.ratioValues=Object.assign(Object.create(null),g?.values||{});state.ratioPlan=null;state.ratioError=null;state.baseID='';}
function draftGoal(){return {mode:state.ratioMode,values:Object.fromEntries([...state.ratioSelected].map(id=>[id,state.ratioValues[id]??'']))};}
async function saveDownload(content,name){const blob=new Blob([content],{type:'application/json'}),file=new File([blob],name,{type:'application/json'});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'小小记备份'});return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function backupFilename(label){return `小小记-${label}-${C.day(Date.now())}-${Date.now()}.json`;}
function report(){const sales=ledger.state.sales,stock=ledger.state.stock,t=C.counts({...sales,records:C.todayRecords(sales)}),s=C.counts(stock);return `小小记｜${C.day(Date.now())}\n\n【今天的记数】\n${sales.items.map(i=>`${i.name}：${t[i.id]} 件`).join('\n')}\n\n【当前库存数】\n${stock.items.map(i=>`${i.name}：${s[i.id]} 件`).join('\n')}\n\n时间使用北京时间，销售与库存独立。`;}
function installHelp(){const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent);showSheet('把小小记放进口袋',`<p>添加到主屏幕后，就能像 App 一样从图标打开。</p><ol class="install-steps"><li>${isIOS?'请用 Safari 打开这个网页。':'在手机浏览器中打开这个网页。'}</li><li>${isIOS?'点击浏览器的“分享”按钮。':'打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。'}</li><li>${isIOS?'选择“添加到主屏幕”，如有“作为网页 App 打开”请开启。':'确认名称为“小小记”，完成添加。'}</li></ol><div class="soft-message">建议先添加再正式记数，并固定使用同一个入口。如果已有记录，请先在设置里导出备份，再在主屏幕版导入。</div><button class="primary-button" type="button" data-action="close-sheet">知道了</button>`);}
async function action(a,node){
 const id=node.dataset.id,part=node.dataset.part;
 if(a==='check-connection'){const message=document.querySelector('#connection-message');node.disabled=true;if(message)message.textContent='正在检查，请稍候…';try{const rows=await probeConnection(cloudConfig);if(message?.isConnected)message.textContent=rows.map(x=>x.name+'：'+x.detail).join('\n')+'\n'+(rows.every(x=>x.ok)?'网络已连通，可以尝试注册或登录。':'请截取这些检查结果，方便定位连接问题。');}finally{if(node.isConnected)node.disabled=false;}return;}
 if(a==='auth-mode'){state.authMode=state.authMode==='register'?'login':'register';ledger.error=null;render();return;}
 if(a==='local-mode'||a==='cloud-mode'){const url=new URL(location.href);if(a==='local-mode')url.searchParams.set('local','1');else url.searchParams.delete('local');url.hash='count';location.assign(url.href);return;}
 if(a==='sync-cloud'){await ledger.reload();render();toast('已读取当前账户最新的云端记录。');return;}
 if(a==='logout'){confirmSheet('退出当前账户？','云端记录会保留。本页面和当前账户的本机备用副本会清除，下次登录会重新读取云端记录。',async()=>{await ledger.logout();state.itemID=null;state.selection.clear();state.ratioValues=Object.create(null);state.ratioSelected.clear();closeSheet();render();},'退出登录');return;}
 if(a==='close-sheet'){closeSheet();return;}
 if(a==='page'){state.page=node.dataset.page;state.itemID=null;state.eggItemID=null;state.eggSelecting=false;state.eggSelection.clear();state.keyword='';state.selection.clear();state.selecting=false;state.range=state.page==='history'?3:0;if(state.page!=='ratio'&&state.page!=='stats'&&state.book==='egg')state.book='sales';if(state.page==='ratio')loadRatio();history.replaceState(null,'','#'+state.page);render();window.scrollTo({top:0});return;}
 if(a==='book'){state.book=node.dataset.book;state.itemID=null;state.eggItemID=null;state.keyword='';state.selection.clear();state.selecting=false;state.ratioPlan=null;state.selectedHour=null;state.eggDraft=null;if(state.book!=='egg')loadRatio();render();return;}
 if(a==='install'){installHelp();return;}
 if(a==='detail'){state.itemID=id;render();window.scrollTo({top:0});return;}
 if(a==='detail-back'){state.itemID=null;render();return;}
 if(a==='egg-add'){const id=node.dataset.id;state.eggReroll=0;await mutateEgg(egg=>C.eggChange(egg,id,1));return;}
 if(a==='egg-minus'){const id=node.dataset.id;try{await mutateEgg(egg=>C.eggChange(egg,id,-1));}catch(err){toast(err.message);}return;}
 if(a==='egg-next-round'){state.eggRoundView=state.eggRoundView?0:1;render();return;}
 if(a==='egg-rename'){const item=eggBook().items.find(i=>i.id===id);if(!item)return;showSheet('修改名字',`<label class="field-label" for="name">物品名称</label><input class="field-input" id="name" name="name" maxlength="40" value="${e(item.name)}">`,async fd=>{await mutateEgg(egg=>C.eggRename(egg,id,String(fd.get('name')||'')));return true;});return;}
 if(a==='stats-gran'){state.statsGran=node.dataset.gran;render();return;}
 if(a==='stats-filter'){const id=node.dataset.id||null;state.statsItem=state.statsItem===id?null:id;state.range=0;state.selectedHour=null;render();return;}
 if(a==='stats-hour'){state.selectedHour=Number(node.dataset.hour);state.statsGran='minute';render();return;}
 if(a==='egg-mode'){state.books={sales:state.books.sales,stock:state.books.stock,egg:!state.books.egg};saveBooks(state.books);render();return;}
 if(a==='book-toggle'){const k=node.dataset.book,next={...state.books,[k]:!state.books[k]};if(!next.sales&&!next.stock&&!next.egg){toast('至少要留一个功能。');return;}state.books=next;saveBooks(next);if(!enabledBooks().includes(state.book))state.book=enabledBooks()[0];if(!next.egg&&state.page==='egg'){state.page='count';state.eggItemID=null;history.replaceState(null,'','#count');}if(!next.sales&&!next.stock&&state.page==='count'){state.page='egg';history.replaceState(null,'','#egg');}render();return;}
 if(a==='tab-up'||a==='tab-down'){const p=node.dataset.page,i=TABS.indexOf(p),j=a==='tab-up'?i-1:i+1;if(i<0||j<0||j>=TABS.length){return;}[TABS[i],TABS[j]]=[TABS[j],TABS[i]];saveTabs(TABS);render();return;}
 if(a==='egg-reroll'){state.eggReroll=(state.eggReroll||0)+1;render();return;}
 if(a==='egg-only'){state.eggOnlyLeft=!state.eggOnlyLeft;render();return;}
 if(a==='egg-arrange'){state.eggArrange=!state.eggArrange;render();return;}
 if(a==='egg-move'){const id=node.dataset.id,step=node.dataset.step,egg=eggBook(),order=eggOrder(egg),i=order.indexOf(id);const cols=Math.max(1,state.eggCols||1);const delta=step==='cols'?cols:step==='-cols'?-cols:Number(step);const j=i+delta;if(i<0||j<0||j>=order.length){toast('已经到头了。');return;}[order[i],order[j]]=[order[j],order[i]];await mutateEgg(egg=>{egg.order=order;});return;}
 if(a==='egg-detail'){state.eggItemID=id;state.eggSelecting=false;state.eggSelection.clear();render();window.scrollTo({top:0});return;}
 if(a==='egg-back'){state.eggItemID=null;state.eggSelecting=false;state.eggSelection.clear();render();window.scrollTo({top:0});return;}
 if(a==='egg-select'){state.eggSelecting=!state.eggSelecting;state.eggSelection.clear();render();return;}
 if(a==='egg-select-all'){const egg=eggBook(),targets=state.page==='history'?egg.records:egg.records.filter(r=>r.itemId===state.eggItemID);state.eggSelection=new Set(targets.map(r=>r.id));render();return;}
 if(a==='egg-delete-record'||a==='egg-delete-selected'){const ids=a==='egg-delete-record'?new Set([id]):new Set(state.eggSelection);confirmSheet(`删除 ${ids.size} 条记录？`,`数量和本轮进度会同步更新；${'距上次改动'}的计时不会变。`,async()=>{await mutateEgg(egg=>C.eggDeleteRecords(egg,ids));state.eggSelection.clear();},'删除记录');return;}
 if(a==='egg-add-item'){showSheet('添加放蛋物品',`<label class="field-label" for="name">物品名称</label><input class="field-input" id="name" name="name" maxlength="40" autocomplete="off" placeholder="例如：甲"><label class="field-label" style="margin-top:14px" for="ratio">比例（一轮放几个）</label><input class="field-input" id="ratio" name="ratio" inputmode="numeric" value="1" placeholder="1">`,async fd=>{const name=String(fd.get('name')||''),ratio=C.numberInput(String(fd.get('ratio')||'1'))||1;await mutateEgg(egg=>C.eggAddItem(egg,name,Math.max(1,ratio)));return true;});return;}
 if(a==='egg-ratio-save'){const egg=eggBook(),draft=state.eggDraft||{};const values={};for(const i of egg.items)values[i.id]=C.numberInput(String(draft[i.id]??i.ratio));for(const [k,v] of Object.entries(values)){if(v<1)throw new Error('比例至少为 1。');}await mutateEgg(egg=>{for(const [id,v] of Object.entries(values))C.eggSetRatio(egg,id,v);egg.goal={mode:'parts',values:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,String(v)]))};});toast('比例已固定，放蛋按新比例排。');return;}
 if(a==='egg-ratio-reset'){state.eggDraft=null;render();return;}
 if(a==='change-password'){showSheet('修改密码',`<p>先验证现在的密码，再设置新密码。</p><label class="field-label" for="old">原密码</label><input class="field-input" id="old" name="old" type="password" autocomplete="current-password" required><label class="field-label" style="margin-top:14px" for="new">新密码</label><input class="field-input" id="new" name="new" type="password" autocomplete="new-password" minlength="6" maxlength="128" required><label class="field-label" style="margin-top:14px" for="again">再输一次新密码</label><input class="field-input" id="again" name="again" type="password" autocomplete="new-password" minlength="6" maxlength="128" required>`,async fd=>{const oldValue=String(fd.get('old')||''),newValue=String(fd.get('new')||''),again=String(fd.get('again')||'');if(newValue!==again)throw new Error('两次输入的新密码不一致。');await ledger.changePassword(oldValue,newValue);toast('密码已修改，下次请用新密码登录。');return true;},'修改密码');return;}
 if(a==='edit-count'){itemInput(id);return;}
 if(a==='increase'||a==='decrease'){
  if(a==='decrease'&&state.book==='stock'){const i=book().items.find(x=>x.id===id),c=C.counts(book())[id];if(c-C.partsTotal(i)===0&&c>0){toast('未分类库存为零，请点物品名称，选择要减少的分项。');return;}}
  node.disabled=true;try{await mutate(b=>C.change(b,id,a==='increase'?1:-1));}finally{if(node.isConnected)node.disabled=false;}return;
 }
 if(a==='add-item'){showSheet('新添一件小物','<p>给它起个名字，之后随手记下来。</p><label class="field-label" for="name">物品名称</label><input class="field-input" id="name" name="name" maxlength="40" placeholder="例如：帆布袋" autocomplete="off">',async fd=>{await mutate(b=>C.addItem(b,String(fd.get('name'))));return true;});return;}
 if(a==='manage'){showSheet('管理我的物品',`<div>${book().items.map(i=>`<div class="manage-item"><strong>${e(i.name)}</strong><button type="button" class="small-button" data-action="rename-item" data-id="${e(i.id)}" aria-label="重命名${e(i.name)}">${icon('edit')}</button><button type="button" class="small-button red" data-action="delete-item" data-id="${e(i.id)}" aria-label="删除${e(i.name)}">${icon('trash')}</button></div>`).join('')}</div><p class="hint">物品只属于当前${title(state.book)}账本。</p><button type="button" class="primary-button" style="margin-top:20px" data-action="close-sheet">完成</button>`);return;}
 if(a==='rename-item'){const i=book().items.find(i=>i.id===id);showSheet('重命名物品',`<label class="field-label" for="name">物品名称</label><input class="field-input" id="name" name="name" maxlength="40" value="${e(i.name)}">`,async fd=>{await mutate(b=>{b.items.find(i=>i.id===id).name=String(fd.get('name')).trim();});return true;});return;}
 if(a==='delete-item'){const i=book().items.find(i=>i.id===id);confirmSheet(`删除 ${i.name}？`,'会删除这个物品及其全部历史，并取消当前账本的固定目标。请先确认已有备份。',async()=>{await mutate(b=>C.deleteItem(b,id));},'删除物品');return;}
 if(a==='add-part'){showSheet('添加库存分项','<p>例如：未拆、已拆、瑕疵品。新增分项的初始数量为 0。</p><label class="field-label" for="name">分项名称</label><input class="field-input" id="name" name="name" maxlength="20" autocomplete="off">',async fd=>{const name=String(fd.get('name')).trim();const i=book().items.find(i=>i.id===id);if(Object.hasOwn(i.breakdown,name))throw new Error('分项名称已存在。');await mutate(b=>C.setPart(b,id,name,0));return true;});return;}
 if(a==='edit-part'){const i=book().items.find(i=>i.id===id);showSheet(`修改 ${part}`,`<p>增加时优先从未分类划入；减少时会扣减总库存。</p><label class="field-label" for="amount">分项数量</label><input class="field-input" id="amount" name="amount" inputmode="numeric" value="${i.breakdown[part]}">`,async fd=>{const n=C.numberInput(String(fd.get('amount')));await mutate(b=>C.setPart(b,id,part,n));return true;});return;}
 if(a==='delete-part'){confirmSheet(`删除“${part}”分项？`,'其数量会并入未分类，总库存保持不变。',async()=>{await mutate(b=>C.deletePart(b,id,part));},'删除分项');return;}
 if(a==='range'){state.range=Number(node.dataset.range);state.selectedHour=null;state.selection.clear();render();return;}
 if(a==='more-history'){state.historyLimit+=80;render();return;}
 if(a==='select-records'){state.selecting=!state.selecting;state.selection.clear();render();return;}
 if(a==='select-all'){state.selection=new Set(filteredRecords().map(r=>r.id));render();return;}
 if(a==='delete-record'||a==='delete-selected'){const ids=a==='delete-record'?new Set([id]):new Set(state.selection);confirmSheet(`删除 ${ids.size} 条记录？`,'删除后数量和统计会同步更新。会导致数量为负或低于分项合计的操作不会被保存。',async()=>{await mutate(b=>C.deleteRecords(b,ids));state.selection.clear();render();},'删除记录');return;}
 if(a==='hour'){state.selectedHour=Number(node.dataset.hour);render();return;}
 if(a==='ratio-mode'){state.ratioMode=node.dataset.mode;state.ratioPlan=null;state.ratioError=null;render();return;}
 if(a==='calculate'){try{state.ratioPlan=C.ratioPlan(book(),draftGoal());state.ratioError=null;}catch(err){state.ratioPlan=null;state.ratioError=err.message;}render();return;}
 if(a==='save-goal'){const goal=draftGoal();await mutate(b=>{C.validateGoal(b,goal);b.goal=goal;});toast('固定目标已保存，记数页会实时显示缺口。');return;}
 if(a==='clear-goal'){confirmSheet('取消固定目标？','所有记数和历史都会保留。',async()=>{await mutate(b=>{b.goal=null;});},'取消目标');return;}
 if(a==='export-book'){await saveDownload(C.encodeBook(ledger.state[node.dataset.book]),backupFilename(title(node.dataset.book)));return;}
 if(a==='export-all'){await saveDownload(JSON.stringify(ledger.state,null,2),backupFilename('全部记录'));toast('请选择“存储到文件”，妥善保留备份。');return;}
 if(a==='export-raw'){await saveDownload(ledger.raw(),backupFilename('原始文件'));return;}
 if(a==='import-book'||a==='import-all'){restoreExpected=a==='import-book'?node.dataset.book:'all';fileInput.value='';fileInput.click();return;}
 if(a==='previous'||a==='recover-local'){
  const saved=a==='recover-local'?{state:ledger.recoverable?.state,savedAt:ledger.recoverable?.envelope.savedAt}:await ledger.previous();
  if(!saved?.state){toast('尚未找到有效的上一份副本。');return;}
  confirmSheet('恢复本机副本？',`副本时间：${C.clock(saved.savedAt,true)}。会替换两个账本，恢复前请先导出当前记录。`,async()=>{await ledger.restoreState(saved.state);loadRatio();render();toast('已从本机副本恢复。');},'确认恢复');return;
 }
 if(a==='persist'){const yes=await ledger.requestProtection();toast(yes?'浏览器已允许持久保留；清除网站数据仍会删除记录，请保留备份。':'浏览器暂未授予持久存储权限。自动保存仍有效，请定期导出备份。');render();return;}
 if(a==='copy-report'){try{await navigator.clipboard.writeText(report());toast('今日记数与库存已复制。');}catch{showSheet('今日记数与库存',`<textarea class="field-input" style="height:260px;padding:15px;font-size:12px;line-height:1.7" readonly aria-label="记数与库存汇总">${e(report())}</textarea><p class="hint">可长按内容，全选并复制。</p><button class="primary-button" type="button" data-action="close-sheet">完成</button>`);}return;}
}
let resizeFrame=0;
const relayout=()=>{if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;layoutVars();fitItemGrid();fitEggGrid();});};
window.addEventListener('resize',relayout);
window.addEventListener('orientationchange',relayout);
document.addEventListener('contextmenu',event=>{if(event.target.closest('.bottom-nav')||event.target.closest('.egg-card'))event.preventDefault();});
let suppressClick=false,pressTimer=null,pressTarget=null;
document.addEventListener('pointerdown',event=>{
 const tab=event.target.closest('.bottom-nav [data-page]');
 const card=event.target.closest('.egg-card');
 if(!tab&&!card)return;
 pressTarget=tab?'tab':'card';
 pressTimer=setTimeout(()=>{
  pressTimer=null;suppressClick=true;
  if(pressTarget==='card'){if(!state.eggArrange){state.eggArrange=true;render();toast('排列模式：用卡片上的方向键调位置，调完点“完成排列”。');}}
  else{state.tabDrag=tab.dataset.page;nav.classList.add('reordering');}
 },480);
},{passive:true});
document.addEventListener('pointerup',()=>{clearTimeout(pressTimer);pressTimer=null;if(state.tabDrag){state.tabDrag=null;nav.classList.remove('reordering');saveTabs(TABS);render();}});
document.addEventListener('pointercancel',()=>{clearTimeout(pressTimer);pressTimer=null;if(state.tabDrag){state.tabDrag=null;nav.classList.remove('reordering');saveTabs(TABS);}});
document.addEventListener('pointermove',event=>{
 if(pressTimer){const moved=Math.abs(event.movementX)+Math.abs(event.movementY);if(moved>6){clearTimeout(pressTimer);pressTimer=null;}}
 if(!state.tabDrag)return;
 const over=document.elementFromPoint(event.clientX,event.clientY)?.closest('.bottom-nav [data-page]');
 if(!over)return;
 const target=over.dataset.page,from=TABS.indexOf(state.tabDrag),to=TABS.indexOf(target);
 if(from<0||to<0||from===to)return;
 TABS.splice(to,0,TABS.splice(from,1)[0]);
 render();
},{passive:true});
setInterval(()=>{if(!document.hidden&&state.page==='egg'&&ledger.signedIn!==false)eggTick();},1000);
document.addEventListener('click',event=>{if(suppressClick){suppressClick=false;const node=event.target.closest('[data-action]');if(node){event.preventDefault();event.stopPropagation();return;}}const node=event.target.closest('[data-action]');if(!node)return;if(node.tagName==='BUTTON')event.preventDefault();Promise.resolve(action(node.dataset.action,node)).catch(err=>{if(err.name!=='AbortError'){toast(err.message||'这次操作未完成。');if(ledger.readOnly)render();}});});
document.addEventListener('submit',async event=>{if(event.target.id!=='account-form')return;event.preventDefault();const form=event.target,button=event.submitter,message=document.querySelector('#account-message'),values=new FormData(form),username=String(values.get('username')||''),password=String(values.get('password')||'');button.disabled=true;message.textContent=state.authMode==='register'?'正在创建账户…':'正在登录…';try{if(state.authMode==='register'){if(password!==values.get('confirm'))throw new Error('两次输入的密码不一致。');await ledger.register(username,password);}else await ledger.login(username,password);}catch(err){if(message.isConnected){message.className='sheet-error';message.textContent=err.message;}}finally{const field=form.querySelector('[name="password"]'),confirm=form.querySelector('[name="confirm"]');if(field)field.value='';if(confirm)confirm.value='';if(button.isConnected)button.disabled=false;}});

document.addEventListener('submit',async event=>{if(event.target.id!=='sheet-form')return;event.preventDefault();if(!formSubmit)return;const submit=event.submitter;if(submit)submit.disabled=true;try{document.querySelector('#sheet-error').textContent='';const done=await formSubmit(new FormData(event.target));if(done)closeSheet();}catch(err){document.querySelector('#sheet-error').textContent=err.message||'没有保存成功，请重试。';}finally{if(submit?.isConnected)submit.disabled=false;}});
document.addEventListener('change',event=>{const node=event.target;if(node.dataset.eggRecord){node.checked?state.eggSelection.add(node.dataset.eggRecord):state.eggSelection.delete(node.dataset.eggRecord);const actions=main.querySelector('.selection-actions');if(actions){const button=actions.querySelector('.remove');button.textContent=`删除 ${state.eggSelection.size} 条`;button.disabled=!state.eggSelection.size;}return;}if(node.dataset.record){node.checked?state.selection.add(node.dataset.record):state.selection.delete(node.dataset.record);const actions=main.querySelector('.selection-actions');if(actions){const button=actions.querySelector('.remove');button.textContent=`删除 ${state.selection.size} 条`;button.disabled=!state.selection.size;}return;}if(node.dataset.ratioCheck){const id=node.dataset.ratioCheck;node.checked?state.ratioSelected.add(id):state.ratioSelected.delete(id);if(!Object.hasOwn(state.ratioValues,id))state.ratioValues[id]='1';state.ratioPlan=null;state.ratioError=null;render();return;}if(node.id==='base-select'){state.baseID=node.value;render();}});
document.addEventListener('input',event=>{const node=event.target;if(node.dataset.eggRatio){if(!state.eggDraft)state.eggDraft={};state.eggDraft[node.dataset.eggRatio]=node.value;return;}if(node.id==='history-search'){state.keyword=node.value;state.selection.clear();document.querySelector('#history-list').innerHTML=historyRows(filteredRecords());document.querySelector('#history-count').textContent=`${filteredRecords().length} 条记录`;return;}if(node.dataset.ratioValue){state.ratioValues[node.dataset.ratioValue]=node.value;state.ratioPlan=null;state.ratioError=null;}});
fileInput.addEventListener('change',async()=>{const file=fileInput.files?.[0];if(!file)return;try{if(file.size>20*1024*1024)throw new Error('备份不能超过 20 MB。');const text=await file.text();if(restoreExpected==='all'){
 const next=C.validateState(JSON.parse(text));backupReady=next;const n=next.sales.records.length+next.stock.records.length;
 confirmSheet('恢复全部记录？',`备份包含两个账本，共 ${n} 条记录。会替换本机的全部记数和库存，原本机记录会另存为恢复副本。`,async()=>{await ledger.restoreState(backupReady);backupReady=null;state.itemID=null;loadRatio();render();toast('全部记录已恢复。');},'恢复两个账本');
 }else{const kind=restoreExpected,b=C.decodeBackup(text,kind);confirmSheet(`恢复${title(kind)}？`,`包含 ${b.items.length} 类物品、${b.records.length} 条记录。替换对应账本，另一个账本不受影响。`,async()=>{await ledger.commit(s=>{s[kind]=b;});state.itemID=null;loadRatio();render();toast('备份已恢复。');},'替换此账本');}}catch(err){toast(err.message||'无法读取这份备份。');}});
sheet.addEventListener('click',event=>{if(event.target===sheet){const r=sheet.getBoundingClientRect();if(event.clientY<r.top||event.clientX<r.left||event.clientX>r.right)closeSheet();}});
window.addEventListener('hashchange',()=>{const p=location.hash.slice(1);if(['count','history','stats','ratio','settings'].includes(p)){state.page=p;state.itemID=null;if(p==='ratio')loadRatio();render();}});
window.addEventListener('pageshow',()=>{if(ledger.db&&!ledger.saving)ledger.reload().then(render).catch(()=>{});});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&ledger.db&&!ledger.saving)ledger.reload().then(render).catch(()=>{});});
if(localMode&&ledger.channel)ledger.channel.onmessage=()=>{if(!ledger.saving)ledger.reload().then(()=>{render();toast('已同步本机另一页面的最新记录。');}).catch(()=>{});};
ledger.onchange=()=>{if(!localMode&&!ledger.signedIn){if(sheet.open)closeSheet();state.itemID=null;state.selection.clear();state.ratioValues=Object.create(null);state.ratioSelected.clear();state.ratioPlan=null;}render();};
await ledger.init();render();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
setInterval(()=>{if(document.visibilityState==='visible'&&!sheet.open&&['count','stats'].includes(state.page))render();},30000);
