import test from 'node:test';
import assert from 'node:assert/strict';
import {concertTheme,productKey,productMarkup} from '../dist/concert-ui.js';
test('only a current daily group gets its theme; names, private profiles, ordinary teams and past rooms do not',()=>{
 const today='2026-11-15',room={kind:'angel',day:today,role:'dismantle'},workspace={id:'team',daily_kind:'angel',day:today};
 assert.equal(concertTheme({signedIn:true,workspace,dailyRoom:room,today}),'angel');
 assert.equal(concertTheme({signedIn:true,workspace:{...workspace,daily_kind:'devil'},dailyRoom:{...room,kind:'devil',role:'place'},today}),'devil');
 for(const x of [{signedIn:false,workspace,dailyRoom:room},{signedIn:true,workspace:null,dailyRoom:room},{signedIn:true,workspace:{id:'custom',name:'天使大群'},dailyRoom:null},{signedIn:true,workspace,dailyRoom:{...room,day:'2026-11-14'}},{signedIn:true,workspace:{...workspace,day:'2026-11-14'},dailyRoom:room},{signedIn:true,workspace:{...workspace,daily_kind:'devil'},dailyRoom:room},{signedIn:true,workspace,dailyRoom:{...room,kind:'other'}},{signedIn:true,workspace,dailyRoom:{...room,role:'admin'}}])assert.equal(concertTheme({...x,today}),'plain');
});
test('product aliases and explicit colors are visual only, with deterministic uncolored defaults',()=>{
 const groups={planter:'盆栽/向日葵盆栽/种植罐/种子罐/花盆/向阳而生',guandan:'掼蛋/掼蛋纸牌/摜蛋撲克/惯蛋/灌蛋/贯蛋',poker:'扑克/扑克牌/撲克牌/纸牌/紙牌',magnet:'冰箱贴/冰箱帖/冰箱磁贴/冰箱磁铁/亚克力拼图冰箱贴盲袋/亚克力拼图',notes:'便利贴/便利帖/便签/便笺/便条纸/记事贴/备忘贴/N次贴',mousepad:'鼠标垫/白鼠标垫/白色鼠标垫/滑鼠垫/鼠垫/桌垫','mousepad-black':'黑鼠标垫/黑色鼠标垫/鼠标垫黑色',puzzle:'拼图/拼圖/拼图筒','doll-red':'娃衣/娃衣q/红娃衣/红色娃衣/红色连帽娃衣/娃娃衣/玩偶衣服/娃服/黑煤球红色娃衣','doll-black':'黑娃衣/黑色娃衣/黑连帽娃衣/娃衣黑色/黑娃娃衣/黑色玩偶衣服',stand:'磁吸支架/手机支架/支架/手机架/磁吸架/手機支架/手机磁吸支架',tshirt:'T恤/t-shirt/T 衫/短袖/体恤/tshirt'};
 for(const [key,names] of Object.entries(groups))for(const name of names.split('/'))assert.equal(productKey(name),key,name);
 assert.equal(productKey('其它商品'),null);assert.equal(productMarkup('其它商品'),'');
 assert.match(productMarkup('黑娃衣'),/doll-black\.webp/);assert.doesNotMatch(productMarkup('<script>便利贴</script>'),/<script>/);
});
