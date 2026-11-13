// Display preferences only. These values never grant permissions or change ledger quantities.
export const ROLES={
 dismantle:{name:'拆弹',books:{sales:true,stock:true,egg:false},page:'count',book:'sales'},
 place:{name:'投蛋',books:{sales:false,stock:false,egg:true},page:'egg',book:'egg'}
};
export function beijingDay(at=Date.now()){return new Date(at+8*3600000).toISOString().slice(0,10);}
export function validProfile(value){
 if(!value||value.version!==1||!Object.hasOwn(ROLES,value.role)||!/^\d{4}-\d{2}-\d{2}$/.test(value.day)||!Number.isSafeInteger(value.updatedAt)||value.updatedAt<0)return null;
 const b=value.books;if(!b||!['sales','stock','egg'].every(k=>typeof b[k]==='boolean')||!Object.values({sales:b.sales,stock:b.stock,egg:b.egg}).some(Boolean))return null;
 return {version:1,day:value.day,role:value.role,books:{sales:b.sales,stock:b.stock,egg:b.egg},tutorialPending:value.tutorialPending===true,updatedAt:value.updatedAt};
}
export function chooseRole(role,newbie,at=Date.now()){
 if(!Object.hasOwn(ROLES,role))throw Error('请选择拆弹或投蛋岗位。');
 return {version:1,day:beijingDay(at),role,books:{...ROLES[role].books},tutorialPending:Boolean(newbie),updatedAt:at};
}
export function newestProfile(remote,local){
 const a=validProfile(remote),b=validProfile(local);return a&&(!b||a.updatedAt>=b.updatedAt)?a:b;
}
const TUTORIAL_HELP='<p>有不会或不懂的地方，可以在「设置」里点击「查看新手教程」再看一次，也可以加微信 <strong>L2385434375</strong> 询问，或者给 <strong>13480041761</strong> 发短信。</p>';
export const TUTORIALS={
 dismantle:[
  {title:'先确认记在哪本账',page:'count',target:'.count-scope-actions',body:'<p>一个人记，选择「个人」；几个人一起记，点击「组队/加入组队」。</p><p>加入群后，成员共同使用群账本。<strong>操作前看一下顶部名称，确认当前是个人还是群。</strong></p>'},
  {title:'准备销售和库存',page:'count',target:'.count-topbar',body:'<p>销售记录已经卖出的数量，库存记录目前剩余的数量。在「管理」里添加物品，先把库存数量填好。</p><p>销售和库存的品类分别管理。准备从零开始记销售时，销售数量保持为 0。</p><p><strong>长按物品名称或数量，可以直接拖动卡片换位置。</strong></p>'},
  {title:'销售与库存可以绑定',page:'settings',target:'.sales-stock-settings',body:'<p>在设置里开启「销售与库存绑定」，检查每个销售物品对应的库存。</p><ul><li>销售加 1，库存减 1。</li><li>销售减 1，库存补回 1。</li><li>手动调整库存，不改变销售。</li></ul><p>不开启时两本账独立记数。开启后只联动新的销量变化，不扣历史销量；库存不足时整笔销售不会保存。</p>'},
  {title:'拆出什么，就给什么加一',page:'count',target:'.count-topbar',body:'<p>在销售页面，给实际拆出的物品点「＋」。点错了，用「－」改回。<strong>红框标记上一次增加的物品。</strong></p><p>一次买多个，点击「多蛋购买」，选择 1–10 个，再依次点击物品。填满、核对并确认后，这组才正式保存，历史中会用同一个色框标记。</p>'},
  {title:'核对数量和记录',page:'count',target:'.count-summary',body:'<p>顶部显示销售总数。销售页的复制按钮复制当前销售数量，库存页复制当前库存数量。</p><p>「历史」可以核对每次操作；「统计」可以查看各时间段数量，按分钟查看时，用小时滑块选择时段。</p><p>如果同时开放蛋与销售，可以使用对账。对应物品请用相同名称；按今天的记录核对数量，允许销售乱序和晚补记；有差额时可查看疑似问题时段，也可合并名称略有不同的物品。</p>'},
  {title:'收工后再结算',page:'settings',target:'[data-action="day-open"]',body:'<p><strong>跨天不会自动清零。</strong>需要开始新一段时，到设置点击「开启新的一天」。销售、库存和放蛋会结算保留，新一段默认全部归零，也可以选择继承历史分段。</p><p>群账本结算前，先和同组的人确认。每次操作后，留意页面的保存状态。</p><p>拆弹岗位默认开启销售和库存，需要放蛋时，到「设置 → 启用的功能」打开。</p>'+TUTORIAL_HELP}
 ],
 place:[
  {title:'先确认个人还是群',page:'egg',target:'.workspace-bar',body:'<p>独立记录，选择「个人」；和其他人共用一套记录，选择对应的群。</p><p><strong>投蛋前看一下顶部名称，确认记在正确的账本。</strong>点击「组队/加入组队」可以建群或加入群；入群码当日 23:59 失效，已有成员仍可使用群账本。</p>'},
  {title:'设置每轮要放多少个',page:'egg',target:'[data-action="egg-tools"], [data-action="egg-add-item"]',body:'<p>第一次使用，点击「添加物品」并设置比例。已有物品时，可以在「操作」里继续添加。</p><p><strong>比例就是这个物品每轮需要放几个。</strong>例如鼠标垫比例 6，贴纸比例 2，一轮就放 6 个鼠标垫和 2 个贴纸，共 8 个。</p><p>需要调整时，到「比例」页面修改。长按物品名称或数量，可以拖动卡片换位置。</p>'},
  {title:'看绿框推荐，按实际情况记',page:'egg',target:'.egg-reco',body:'<p><span class="tutorial-green">浅绿框</span>是当前推荐；<span class="tutorial-red">红框</span>是上一次放入的物品。</p><p><strong>实际放了哪个，就给哪个点「＋」。</strong>没有按推荐放也没关系，记录后会根据最新数量和放入记录重新计算。点错了，用「－」改回。</p><p>推荐不按等待秒数变化，实际数量或放入记录改变后才重新计算。</p>'},
  {title:'查看和更换本轮顺序',page:'egg',target:'.egg-reco',body:'<p>点击推荐栏，可以查看本轮接下来建议放入的顺序，也可以重新生成整轮顺序。</p><p>重新生成只改变推荐，不增加或减少记录。<strong>名单是建议，记数以实际放入的物品为准。</strong></p><p>系统会尽量错开放置、拉开低占比物品的间隔；可选排列较少时，刷新后的变化也可能较小。</p>'},
  {title:'看懂进度和超出数量',page:'egg',target:'.egg-grid',body:'<p><strong>2/6</strong> 表示本轮已经放了 2 个，需要放 6 个。</p><p><strong>7/6</strong> 表示本轮多放了 1 个，黄色进度条显示超出部分。</p><p>所有物品都达标后，才一起进入下一轮。多放的数量会带入下一轮，不会丢失。</p>'},
  {title:'查看总数，复制记录',page:'egg',target:'.egg-header-actions',body:'<p>页面顶部显示当前轮数和总数。「查看总数」能查看每种物品的累计数量；「一键复制」可以选择当前轮进度或累计总数。</p><p>「历史」核对操作，「统计」查看时段数量。跨天不自动清零，需要结算时到设置选择「开启新的一天」，群账本结算前先和同组的人确认。</p><p><strong>投蛋岗位默认只开放蛋。</strong>需要销售、库存时，到「设置 → 启用的功能」打开。</p>'+TUTORIAL_HELP}
 ]
};
