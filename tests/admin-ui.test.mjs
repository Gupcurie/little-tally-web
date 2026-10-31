import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../deploy/admin/static/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../deploy/admin/static/app.js',import.meta.url),'utf8');
class Element {
 constructor(){this.children=[];this.value='';this.hidden=false;this.listeners={};this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 appendChild(child){this.children.push(child);return child;}
 addEventListener(name,fn){this.listeners[name]=fn;}
}
async function loadPage({missingUpdated=false,failApi=false}={}){
 const nodes=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 if(missingUpdated)delete nodes.updated;
 const account={id:'00000000-0000-4000-8000-000000000001',username:'test-account',items:11,records:2,revision:3,created_at:'2026-11-01T00:00:00Z',last_sign_in_at:null};
 const context=vm.createContext({document:{getElementById:id=>nodes[id]||null,createElement:()=>new Element(),cookie:''},window:{location:{href:''}},Date,Set,setTimeout,fetch:async url=>{
  if(failApi&&url.endsWith('/accounts'))return {status:503,ok:false,json:async()=>({error:'BACKEND_UNAVAILABLE'})};
  return {status:200,ok:true,json:async()=>url.endsWith('/audit')?{entries:[]}:{accounts:[account],summary:{total:1,active:1,banned:0,with_ledger:1,items:11,records:2,signed_in_7d:1},generated_at:1793491200}};
 }});
 // Run real event wiring, fetch, summary rendering and row rendering from the shipped script.
 const withoutAutoLoad=script.replace(/\nload\(\);\s*$/,'');
 vm.runInContext(withoutAutoLoad,context);
 await vm.runInContext('load()',context);
 return nodes;
}
test('admin HTML supplies every directly referenced static element',()=>{
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 for(const m of script.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(m[1]),'missing '+m[1]);
});
test('successful account fetch renders summary and account rows without a false backend error',async()=>{
 const nodes=await loadPage();
 assert.equal(nodes['s-items'].textContent,'11');
 assert.equal(nodes.rows.children.length,1);
 assert.match(nodes.rows.textContent,/test-account/);
 assert.match(nodes.updated.textContent,/更新于/);
 assert.equal(nodes.error.hidden,true);
});
test('missing optional timestamp cannot stop account list rendering',async()=>{
 const nodes=await loadPage({missingUpdated:true});
 assert.equal(nodes.rows.children.length,1);
 assert.equal(nodes.error.hidden,true);
});
test('a real API failure is reported as a read failure rather than a page-render error',async()=>{
 const nodes=await loadPage({failApi:true});
 assert.match(nodes.error.textContent,/读取账号失败.*BACKEND_UNAVAILABLE/);
 assert.doesNotMatch(nodes.error.textContent,/页面显示异常/);
});
