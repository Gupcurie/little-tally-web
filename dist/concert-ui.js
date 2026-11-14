// Presentation only: product names never change ledger identities, quantities or matching rules.
export function concertTheme({signedIn=false,workspace=null,dailyRoom=null,today}={}){
 if(!signedIn||!workspace?.id||!dailyRoom||dailyRoom.day!==today||!['angel','devil'].includes(dailyRoom.kind)||!['dismantle','place'].includes(dailyRoom.role))return 'plain';
 if(workspace.daily_kind&&workspace.daily_kind!==dailyRoom.kind)return 'plain';
 if(workspace.day&&workspace.day!==today)return 'plain';
 return dailyRoom.kind;
}
export const themeAssets={
 angel:{world:'./assets/concert/white-world.webp',mobile:'./assets/concert/white-mobile.webp',poster:'./assets/concert/white-playlist.webp',name:'天使集装箱',english:'WHITE PLAYLIST'},
 devil:{world:'./assets/concert/black-world.webp',mobile:'./assets/concert/black-mobile.webp',poster:'./assets/concert/black-playlist.webp',name:'恶魔集装箱',english:'BLACK PLAYLIST'}
};
export const productAliases=[
 {key:'magnet',pattern:/冰箱(?:磁性|磁吸|磁力)?[贴貼帖]|冰箱磁[铁鐵]|冰箱磁[贴貼]|[亚亞]克力拼[图圖](?:冰箱[贴貼])?(?:盲袋)?/},
 {key:'guandan',pattern:/[掼摜惯慣灌贯貫][蛋弹彈]/},
 {key:'notes',pattern:/便利[贴貼帖签簽]|便[签簽笺箋]|便[条條][纸紙]|[记記事備备忘]+[贴貼]|n次[贴貼]/},
 {key:'mousepad',pattern:/鼠[标標][垫墊毯]|滑鼠[垫墊]|鼠[垫墊]|桌[垫墊]/},
 {key:'doll-red',pattern:/娃(?:娃)?(?:衣|服|[卫衛]衣|外套)|玩偶(?:衣服|服|外套)|黑煤球衣服/},
 {key:'planter',pattern:/盆栽|盆[植载載]|向日葵|向[阳陽]而生|[种種]植罐|[种種]子罐|花盆/},
 {key:'stand',pattern:/支架|磁吸架|手[机機]架|磁吸/},
 {key:'puzzle',pattern:/拼[图圖]|[拼拚][图圖]筒/},
 {key:'poker',pattern:/[扑撲]克|[纸紙]牌/},
 {key:'tshirt',pattern:/t恤|tshirt|tee(?:shirt)?|短袖|t衫|[体體]恤/}
];
export function productKey(name){
 const n=String(name??'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,''),match=productAliases.find(x=>x.pattern.test(n));
 if(!match)return null;
 if(match.key==='mousepad')return /黑|black/.test(n)?'mousepad-black':'mousepad';
 if(match.key==='doll-red')return /红|紅|red/.test(n)?'doll-red':/黑|black/.test(n)?'doll-black':'doll-red';
 return match.key;
}
export function productMarkup(name){
 const key=productKey(name);return key?`<span class="concert-product" aria-hidden="true"><img src="./assets/products/${key}.webp" alt="" decoding="async" draggable="false"></span>`:'';
}
export function installOutlineFilters(){
 // A still-cached pre-release HTML shell must also be able to load the new app.
 if(!document.querySelector('link[href*="concert-ui.css"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='./concert-ui.css';document.head.append(link);}
 const shell=document.querySelector('.app-shell'),header=document.querySelector('.app-header');
 if(shell&&!document.getElementById('concert-sidebar'))shell.insertAdjacentHTML('afterbegin','<aside id="concert-sidebar" class="concert-sidebar" aria-label="工作台"></aside>');
 if(shell&&!document.getElementById('concert-rail'))shell.insertAdjacentHTML('beforeend','<aside id="concert-rail" class="concert-rail" hidden></aside>');
 if(header&&!header.querySelector('.concert-header-scope'))header.insertAdjacentHTML('beforeend','<div class="concert-breadcrumb"></div><div class="concert-header-scope"></div>');
 const brand=header?.querySelector('.brand-mark');if(brand)brand.src='./assets/concert/mars-mark.webp';
 if(document.getElementById('concert-outline-filters'))return;
 document.body.insertAdjacentHTML('beforeend',`<svg id="concert-outline-filters" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none"><defs>${['dark','light'].map(t=>`<filter id="concert-outline-${t}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="0.85" result="expanded"/><feFlood flood-color="${t==='dark'?'#15121a':'#fff'}"/><feComposite in2="expanded" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`).join('')}</defs></svg>`);
}
