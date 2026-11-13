// Display preferences only. These values never grant permissions or change ledger quantities.
export const ROLES={
 dismantle:{name:'拆弹',books:{sales:true,stock:true,egg:false},page:'count',book:'sales'},
 place:{name:'投蛋',books:{sales:false,stock:false,egg:true},page:'egg',book:'egg'}
};
export function beijingDay(at=Date.now()){return new Date(at+8*3600000).toISOString().slice(0,10);}
export function validProfile(value){
 if(!value||![1,2].includes(value.version)||!Object.hasOwn(ROLES,value.role)||!/^\d{4}-\d{2}-\d{2}$/.test(value.day)||!Number.isSafeInteger(value.updatedAt)||value.updatedAt<0)return null;
 const b=value.books;if(!b||!['sales','stock','egg'].every(k=>typeof b[k]==='boolean')||!Object.values({sales:b.sales,stock:b.stock,egg:b.egg}).some(Boolean))return null;
 const out={version:value.version,day:value.day,role:value.role,books:{sales:b.sales,stock:b.stock,egg:b.egg},tutorialPending:value.tutorialPending===true,updatedAt:value.updatedAt};
 if(['angel','devil'].includes(value.roomKind))out.roomKind=value.roomKind;
 if(value.outsideBooks&&['sales','stock','egg'].every(k=>typeof value.outsideBooks[k]==='boolean')&&['sales','stock','egg'].some(k=>value.outsideBooks[k]))out.outsideBooks={sales:value.outsideBooks.sales,stock:value.outsideBooks.stock,egg:value.outsideBooks.egg};
 if(Object.hasOwn(ROLES,value.outsideRole))out.outsideRole=value.outsideRole;
 return out;
}
export function chooseRole(role,newbie,at=Date.now(),roomKind=null){
 if(!Object.hasOwn(ROLES,role))throw Error('请选择拆弹或投蛋岗位。');
 return {version:2,day:beijingDay(at),role,books:{...ROLES[role].books},tutorialPending:Boolean(newbie),updatedAt:at,...(['angel','devil'].includes(roomKind)?{roomKind}:{})};
}
export function newestProfile(remote,local){
 const a=validProfile(remote),b=validProfile(local);return a&&(!b||a.updatedAt>=b.updatedAt)?a:b;
}
const TUTORIAL_HELP='<p>需要重看时，可以在「设置」里点击「查看新手教程」。</p><p>如果有bug或者软件有问题，或是不会用本工具的可以告知我哦，微信号<strong>L2385434375</strong>，或者给这个手机号码发短信<strong>13480041761</strong>。</p>';
const ROOM_START='<p>选择天使或恶魔后，默认进入北京时间今天对应的大群。群账本由成员共同使用。</p><p>点击顶部群名称，可查看所有成员和岗位；每个成员都能确认后移出其他成员，请核对姓名。</p><p>顶部「组队/加入组队」可以切回个人或以前的自建群。「不加入任何群聊」保留进入前正在使用的账本。</p>';
const ROOM_COMPARE='<p>点击底部「匹配比对」，先在左侧选择销售物品、右侧选择投蛋物品，再点「连接所选」。两侧都能多选，例如红娃衣＋黑娃衣对应娃衣。没有对应项可标为单独核对。全部处理完，确认后查看今日第一笔到现在的匹配和疑似问题时段。</p><p>销售可以乱序或晚补记，补齐后会重新匹配。同名物品会预先连线，请核对后确认；可断开重连。投蛋成员各自保留原物品名称，群内数量共享。</p><p>前后对应用于缩小核对时间；重复品类可能有多个候选。提示需核实，不代表已经确定有人放多或漏记。</p>';
const ROOM_END='<p>每天有新的天使和恶魔大群，选择岗位后进入当天的群。个人和自建群的数据仍保留，切换账本不清空数量。</p><p>如需更换岗位，点设置里的「切换岗位」，确认后重新加载权限。离开大群、切回个人或普通自建群后，可在设置自由开启其他功能。</p>'+TUTORIAL_HELP;
export function tutorialFor(role,daily=false){
 if(!daily)return TUTORIALS[role];
 const base=TUTORIALS[role];
 if(role==='dismantle')return [
  {title:'今天的大群与成员',page:'count',target:'.count-scope-actions',body:ROOM_START},
  {title:'拆弹岗位负责哪些记录',page:'count',target:'.count-topbar',body:'<p>在天使或恶魔大群中，拆弹岗位负责销售和拆弹库存。</p><p><strong>不能修改放蛋记录，也不能查看接下来放蛋的推荐顺序。</strong>在大群设置中无法开启放蛋；今日匹配和待核实情况仍可查看。</p>'},
  base[1],base[2],base[3],
  {title:'今日匹配与疑似时段',page:'count',target:'.reconcile-status',body:ROOM_COMPARE},
  {title:'两种库存分别清点',page:'count',target:'.count-topbar',body:'<p>拆弹岗位的库存和投蛋岗位的库存是两本独立账，即使同属天使或恶魔大群也不互通。</p><p>你在这里修改的是拆弹库存；销售与库存绑定也只影响拆弹岗位的这本库存。</p>'},
  {title:'切换岗位与收工核对',page:'settings',target:'.role-settings',body:'<p>销售页的一键复制取当前销售数量，库存页复制当前库存。到「历史」核对操作，到「统计」查看时段，按分钟时可用滑块选择小时。</p>'+ROOM_END}
 ];
 return [
  {title:'今天的大群与成员',page:'egg',target:'.workspace-bar',body:ROOM_START},
  {title:'投蛋岗位负责哪些记录',page:'egg',target:'.egg-wrap',body:'<p>在天使或恶魔大群中，投蛋岗位负责放蛋、比例和推荐。</p><p><strong>不能修改销售和拆弹库存记录，在设置里也无法开启销售。</strong>仍可查看今日匹配和待核实情况。</p>'},
  base[1],base[2],
  {title:'本轮顺序与进度',page:'egg',target:'.egg-reco',body:base[3].body+base[4].body},
  {title:'今日匹配与疑似时段',page:'egg',target:'.reconcile-status',body:ROOM_COMPARE},
  {title:'可选的投蛋库存清点',page:'settings',target:'[data-book="stock"]',body:'<p><strong>投蛋库存默认关闭。</strong>需要下班前清点时，到「设置 → 启用的功能」打开库存。</p><p>这本库存只用于独立记数，不自动扣减，不联动放蛋或销售，也不与同群拆弹岗位的库存互通。</p><p>关闭功能不会删除已经记录的库存。</p>'},
  {title:'切换岗位与收工核对',page:'settings',target:'.role-settings',body:'<p>放蛋页「查看总数」能看每种物品累计数量；「一键复制」可选当前轮进度或累计总数。历史可核对操作，统计可查看时段。独立库存页复制的是当前清点数量。</p>'+ROOM_END}
 ];
}
export const TUTORIALS={
 dismantle:[
  {title:'先确认记在哪本账',page:'count',target:'.count-scope-actions',body:'<p>一个人记，选择「个人」；几个人一起记，点击「组队/加入组队」。</p><p>加入群后，成员共同使用群账本。<strong>操作前看一下顶部名称，确认当前是个人还是群。</strong></p>'},
  {title:'准备销售和库存',page:'count',target:'.count-topbar',body:'<p>销售记录已经卖出的数量，库存记录目前剩余的数量。在「管理」里添加物品，先把库存数量填好。</p><p>销售和库存的品类分别管理。准备从零开始记销售时，销售数量保持为 0。</p><p><strong>长按物品名称或数量，可以直接拖动卡片换位置。</strong></p>'},
  {title:'销售与库存可以绑定',page:'settings',target:'.sales-stock-settings',body:'<p>在设置里开启「销售与库存绑定」，检查每个销售物品对应的库存。</p><ul><li>销售加 1，库存减 1。</li><li>销售减 1，库存补回 1。</li><li>手动调整库存，不改变销售。</li></ul><p>不开启时两本账独立记数。开启后只联动新的销量变化，不扣历史销量；库存不足时整笔销售不会保存。</p>'},
  {title:'拆出什么，就给什么加一',page:'count',target:'.count-topbar',body:'<p>在销售页面，给实际拆出的物品点「＋」。点错了，用「－」改回。<strong>红框标记上一次增加的物品。</strong></p><p>一次买多个，点击「多蛋购买」，选择 1–10 个，再依次点击物品。填满、核对并确认后，这组才正式保存，历史中会用同一个色框标记。</p>'},
  {title:'核对数量和记录',page:'count',target:'.count-summary',body:'<p>顶部显示销售总数。销售页的复制按钮复制当前销售数量，库存页复制当前库存数量。</p><p>「历史」可以核对每次操作；「统计」可以查看各时间段数量，按分钟查看时，用小时滑块选择时段。</p><p>如果同时开放蛋与销售，可以使用对账。从底部「匹配比对」进入，先连接左右两侧对应物品，两侧均支持多选。全部处理完并确认后，按今天的记录核对数量，允许销售乱序和晚补记，有差额时可查看疑似问题时段。</p>'},
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

export const AUTHOR_NOTE=`
<p>你们登录进去会看到岗位选择，一定要选对哦。先选天使或者恶魔的位置，再选拆弹或者投蛋岗位。</p>
<p>位置分为天使集装箱和恶魔集装箱，用这个工具的小伙伴不要选错哦。选错了，可以在设置里面切换回正确位置的集装箱。</p>
<p>选好天使或者恶魔的位置之后，整个集装箱的小伙伴会在同一份数据里记录。谁在这个位置上负责记数，谁去记就好了，不用各自再记一份。同一个奖品也不要两个人重复登记，记完看一下是否保存成功，避免重复或者少记。</p>
<h3>拆弹的小伙伴</h3>
<p>拆弹有销售功能和库存功能。销售功能可以帮你们记每一个兑换出去的奖品数量，晚上下班的时候需要提交给摊主看。稳妥起见，如果你们人数够，可以用本工具记＋拿纸一起记，这样会稳妥一点。</p>
<p>选择拆弹之后，应该会看到记数、历史、匹配比对、统计、比例、设置。</p>
<p>记数里面有销售记数，也有晚上清点库存的库存点数。销售里点完一个物品后的红色框框，是提醒刚刚点击的是这个物品。</p>
<p>历史可以看今天都卖出去了什么，人多的时候可以一一对比看看有没有记错。统计可以看今天各个时间段的数据。</p>
<h3>投蛋的小伙伴</h3>
<p>投蛋有放蛋功能，输入好比例，可以自动帮你们算出这一轮比较合适的投法。按照推荐顺序，系统会尽量让前后物品不重复、占比越小的物品隔得越开，让各类物品按这一轮的比例投完，就不用一直花脑子计算比例了。占比特别高、可选物品很少的时候，还是可能重复。</p>
<p>投蛋顺序如果不满意，可以点击推荐栏，刷新这一轮的顺序。</p>
<p>投蛋物品的红色框，表示刚刚投过的蛋；绿色框，是下一个推荐你投的蛋。可以不按推荐来，实际投了哪个就点哪个。每次加减记数后，系统都会按最新数量和记录重新计算这一轮接下来该投什么。</p>
<h3>拆弹和投蛋一起核对</h3>
<p>如果大家都用这个工具，建议拆弹和投蛋的小伙伴都选好自己天使或者恶魔的位置哦。新加的匹配比对，可以把销售量和投蛋量匹配起来，帮你们核实有没有蛋投多了，或者拆了但漏记了。如果不是大家都用，请忽略这一部分。</p>
<p>进入匹配比对后，先把左右两边的对应物品连起来，再确认看结果。匹配可以多选一，比如销售的红娃衣和黑娃衣，一起匹配放蛋的娃衣，这样数量就能对应上。</p>
<p>销售顺序打乱或者稍后补记也没关系，补齐后会重新匹配。有差额时可以看疑似问题时段，再一起核实；提示不代表已经确定是谁放多或者漏记了。</p>
<h3>设置与求助</h3>
<p>设置可以切换岗位，也可以设置销售和库存绑定。绑定后，销售每加一，库存自动减一；销售减回会把库存加回。手动加减库存只是入库或盘点，不会改销售数量。</p>
<p>如果猜测没错的话，有两位之前投蛋的小伙伴这两天还会干，他们应该会用这个工具，不会的话问他们就好了。</p>
<p>需要重看时，可以在设置里点击教程再看一次。</p><p>如果有bug或者软件有问题，或是不会用本工具的可以告知我哦，微信号L2385434375，或者给这个手机号码发短信13480041761。</p>`;
