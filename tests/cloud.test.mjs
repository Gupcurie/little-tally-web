import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudLedger} from '../dist/cloud.js';
import * as C from '../dist/core.js';
function fixture(){
 const sessions={A:{user:{id:'account-a',email:'a@example.invalid'},access_token:'token-a'},B:{user:{id:'account-b',email:'b@example.invalid'},access_token:'token-b'}};
 let session=sessions.A;const rows=new Map(),requests=[],caches=[];
 const auth={getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session?.user}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signInWithOtp:async()=>({error:null}),signOut:async()=>{session=null;return {error:null};}};
 const cacheFactory=scope=>{const c={scope,db:true,protection:false,state:null,cleared:false,init:async()=>c,restoreState:async s=>{c.state=C.clone(s);},clear:async()=>{c.state=null;c.cleared=true;c.db=null;}};caches.push(c);return c;};
 const fetcher=async(url,options)=>{
  requests.push({url,options});const owner=options.headers.Authorization==='Bearer token-a'?'account-a':options.headers.Authorization==='Bearer token-b'?'account-b':null;
  if(!owner)return Response.json({message:'unauthorized'},{status:401});
  if(url.includes('tally_ledgers?'))return Response.json(rows.has(owner)?[rows.get(owner)]:[]);
  if(url.endsWith('rpc/tally_save')){const p=JSON.parse(options.body),old=rows.get(owner);if(old?.mutation===p.p_mutation)return Response.json({revision:old.revision,updated_at:old.updated_at,replayed:true});if((old?.revision??0)!==p.p_expected_revision)return Response.json({message:'TALLY_CONFLICT'},{status:400});const revision=(old?.revision??0)+1,row={payload:{...p.p_snapshot,revision},revision,mutation:p.p_mutation,updated_at:new Date().toISOString()};rows.set(owner,row);return Response.json({revision,updated_at:row.updated_at});}
  return Response.json([]);
 };
 const createClient=()=>({auth});
 return {sessions,setSession:s=>{session=s;},rows,requests,caches,auth,createClient,cacheFactory,fetcher,make(extra={}){return new CloudLedger({url:'https://backend.example.invalid',publishableKey:'public-test-key'},{createClient,fetcher,cacheFactory,...extra});}};
}
test('cloud acknowledgement persists records across a fresh login',async()=>{const f=fixture(),a=f.make();await a.init();const id=a.state.sales.items[0].id;await a.commit(s=>C.change(s.sales,id,1));const b=f.make();await b.init();assert.equal(C.counts(b.state.sales)[id],1);assert.equal(b.cloudRevision,1);a.channel?.close();b.channel?.close();});
test('saved egg recommendation shares the exact sequence through cloud reload and advances atomically with a placement',async()=>{
 const f=fixture(),a=f.make();await a.init();
 await a.commit(s=>{const egg=C.ensureEgg(s);[['甲',8],['乙',6],['丙',1],['丁',1]].forEach(([name,ratio])=>C.eggAddItem(egg,name,ratio));egg.recommendation=C.eggCreatePlan(egg);});
 const original=[...C.eggSavedSequence(a.state.egg.recommendation)],b=f.make();await b.init();
 assert.deepEqual([...C.eggSavedSequence(b.state.egg.recommendation)],original);
 assert.equal(b.state.egg.recommendation.context.rareSpacing,1);
 const beforeRecords=a.state.egg.records.length;
 await a.commit(s=>{const egg=s.egg,previous=egg.recommendation;C.eggChange(egg,original[0],1);egg.recommendation=C.eggAdvancePlan(egg,previous,original[0]);});
 await b.reload();assert.equal(b.state.egg.records.length,beforeRecords+1);
 assert.ok(C.eggStoredPlan(b.state.egg));assert.deepEqual([...C.eggSavedSequence(b.state.egg.recommendation)],original.slice(1));
 assert.equal(C.total(b.state.sales),0);a.channel?.close();b.channel?.close();
});
test('sales-stock binding persists across login and its sale/inventory movement is acknowledged together',async()=>{
 const f=fixture(),a=f.make();await a.init();
 const sale=a.state.sales.items[0].id,stock=a.state.stock.items[0].id;
 await a.commit(s=>{C.setCount(s.stock,stock,10);C.setSalesStockEnabled(s,true);});
 await a.commit(s=>C.mutateBoundBook(s,'sales',b=>C.change(b,sale,1)));
 const b=f.make();await b.init();assert.equal(C.salesStockEnabled(b.state),true);
 assert.equal(C.counts(b.state.sales)[sale],1);assert.equal(C.counts(b.state.stock)[stock],9);
 assert.equal(b.state.sales.records.at(-1).bindingId,b.state.stock.records.at(-1).bindingId);
 const before=b.cloudRevision;await assert.rejects(b.commit(s=>C.mutateBoundBook(s,'sales',book=>C.setCount(book,sale,20))),/库存不足/);
 assert.equal(b.cloudRevision,before);assert.equal(C.counts(b.state.stock)[stock],9);
 f.setSession(f.sessions.B);await b.setSession(f.sessions.B);assert.equal(C.salesStockEnabled(b.state),false);
 a.channel?.close();b.channel?.close();
});
test('changing account clears the previous rendered ledger and local cache',async()=>{const f=fixture(),a=f.make();await a.init();await a.commit(s=>C.setCount(s.sales,s.sales.items[0].id,12));f.setSession(f.sessions.B);await a.setSession(f.sessions.B);assert.equal(a.user.id,'account-b');assert.equal(C.total(a.state.sales),0);assert.equal(f.caches[0].cleared,true);await a.commit(s=>C.setCount(s.sales,s.sales.items[0].id,7));assert.equal(C.total(f.rows.get('account-a').payload.sales),12);assert.equal(C.total(f.rows.get('account-b').payload.sales),7);a.channel?.close();});
test('logout retains cloud data while erasing the current local account view',async()=>{const f=fixture(),a=f.make();await a.init();await a.commit(s=>C.change(s.sales,s.sales.items[0].id,1));await a.logout();assert.equal(a.signedIn,false);assert.equal(a.user,null);assert.equal(C.total(a.state.sales),0);assert.equal(f.caches[0].cleared,true);assert.equal(C.total(f.rows.get('account-a').payload.sales),1);a.channel?.close();});
test('late cloud response from A cannot be written to or displayed as B',async()=>{const f=fixture();let release,started;const waiting=new Promise(r=>started=r),gate=new Promise(r=>release=r);let writes=0;const a=f.make({fetcher:async(url,options)=>{if(url.endsWith('rpc/tally_save')&&++writes===1){started();await gate;}return f.fetcher(url,options);}});await a.init();const promise=a.commit(s=>C.setCount(s.sales,s.sales.items[0].id,55));await waiting;f.setSession(f.sessions.B);await a.setSession(f.sessions.B);release();await assert.rejects(promise);assert.equal(a.user.id,'account-b');assert.equal(C.total(a.state.sales),0);assert.equal(f.rows.has('account-b'),false);a.channel?.close();});
test('a lost response retries the same mutation and increments only once',async()=>{const f=fixture();let once=true;const a=f.make({fetcher:async(url,options)=>{const result=await f.fetcher(url,options);if(url.endsWith('rpc/tally_save')&&once){once=false;throw new Error('response lost');}return result;}});await a.init();await a.commit(s=>C.change(s.sales,s.sales.items[0].id,1));assert.equal(C.total(a.state.sales),1);assert.equal(a.cloudRevision,1);const writes=f.requests.filter(r=>r.url.endsWith('rpc/tally_save')).map(r=>JSON.parse(r.options.body));assert.equal(writes[0].p_mutation,writes[1].p_mutation);a.channel?.close();});
test('cross-device conflict reloads the newer snapshot instead of overwriting it',async()=>{const f=fixture(),a=f.make(),b=f.make();await a.init();await b.init();await a.commit(s=>C.setCount(s.sales,s.sales.items[0].id,8));await assert.rejects(b.commit(s=>C.change(s.sales,s.sales.items[0].id,1)),/其他页面/);assert.equal(C.total(b.state.sales),8);assert.equal(b.readOnly,false);a.channel?.close();b.channel?.close();});
test('unconfirmed saves freeze editing and preserve the last confirmed state',async()=>{const f=fixture(),a=f.make({fetcher:async(url,options)=>{if(url.endsWith('rpc/tally_save'))throw new Error('network');return f.fetcher(url,options);}});await a.init();await assert.rejects(a.commit(s=>C.change(s.sales,s.sales.items[0].id,1)),/尚未确认/);assert.equal(C.total(a.state.sales),0);assert.equal(a.readOnly,true);assert.equal(a.saving,false);a.channel?.close();});
test('a changed auth session cannot send another accounts snapshot',async()=>{const f=fixture(),a=f.make();await a.init();f.setSession(f.sessions.B);await assert.rejects(a.commit(s=>C.change(s.sales,s.sales.items[0].id,1)),/登录状态已变化/);assert.equal(f.requests.filter(r=>r.url.endsWith('rpc/tally_save')).length,0);assert.equal(a.saving,false);a.channel?.close();});
test('invalid local data never reaches the cloud write API',async()=>{const f=fixture(),a=f.make();await a.init();await assert.rejects(a.commit(s=>s.sales.records.push({id:C.uid(),itemId:'missing',delta:1,at:1,kind:'count'})));assert.equal(f.requests.filter(r=>r.url.endsWith('rpc/tally_save')).length,0);a.channel?.close();});
test('username password login opens the correct account without storing the password',async()=>{const old=globalThis.isSecureContext;globalThis.isSecureContext=true;const f=fixture(),a=f.make();try{await a.init();f.auth.signInWithPassword=async input=>{assert.match(input.email,/^u[a-f0-9]{64}@users\.little-tally\.invalid$/);assert.equal(input.password,'ExampleOnly_95172');f.sessions.B.user.app_metadata={tally_username:'example_01'};f.setSession(f.sessions.B);return {data:{session:f.sessions.B},error:null};};await a.login('Example_01','ExampleOnly_95172');assert.equal(a.user.id,'account-b');assert.equal(a.user.username,'example_01');assert.equal(JSON.stringify(a.state).includes('ExampleOnly_95172'),false);}finally{a.channel?.close();globalThis.isSecureContext=old;}});
test('wrong username password does not create an account or switch the current ledger',async()=>{const old=globalThis.isSecureContext;globalThis.isSecureContext=true;const f=fixture(),a=f.make();try{await a.init();f.auth.signInWithPassword=async()=>({data:{session:null},error:{status:400}});await assert.rejects(a.login('example_01','WrongExample_999'),/用户名或密码不正确/);assert.equal(a.user.id,'account-a');assert.equal(f.requests.some(x=>x.url.includes('/functions/')),false);}finally{a.channel?.close();globalThis.isSecureContext=old;}});
test('browser native fetch keeps its Window receiver for registration and ledger requests',async()=>{const oldFetch=globalThis.fetch,oldSecure=globalThis.isSecureContext,f=fixture(),paths=[];let a;globalThis.isSecureContext=true;globalThis.fetch=function(url,options){assert.ok(this===globalThis,'browser native fetch rejects a CloudLedger receiver');paths.push(url);if(url.endsWith('/functions/v1/tally-accounts'))return Promise.resolve(Response.json({created:true}));return f.fetcher(url,options);};try{a=f.make({fetcher:undefined});await a.init();f.auth.signInWithPassword=async()=>({data:{session:f.sessions.A},error:null});await a.register('receiver_test','ExampleOnly_95172');await a.commit(s=>C.change(s.sales,s.sales.items[0].id,1));assert.equal(C.total(a.state.sales),1);assert.ok(paths.some(x=>x.endsWith('/functions/v1/tally-accounts')));assert.ok(paths.some(x=>x.includes('tally_ledgers?')));assert.ok(paths.some(x=>x.endsWith('rpc/tally_save')));}finally{a?.channel?.close();globalThis.fetch=oldFetch;globalThis.isSecureContext=oldSecure;}});


test('two authenticated staff share the group while personal ledgers and caches remain independent',async()=>{
 const fa=fixture(),fb=fixture();fb.setSession(fb.sessions.B);let group=null,row=null;const members=new Set();
 const shared=original=>async(url,options)=>{
  const token=options.headers.Authorization,body=JSON.parse(options.body||'{}');
  if(url.endsWith('rpc/tally_teams'))return Response.json(members.has(token)?[group]:[]);
  if(url.endsWith('rpc/tally_team_create')){group={id:C.uid(),name:body.p_name};row={payload:body.p_snapshot,revision:1,updated_at:new Date().toISOString()};members.add(token);return Response.json(group);}
  if(url.endsWith('rpc/tally_team_join')){members.add(token);return Response.json(group);}
  if(url.endsWith('rpc/tally_team_read'))return members.has(token)?Response.json(row):Response.json({message:'TALLY_TEAM_DENIED'},{status:403});
  if(url.endsWith('rpc/tally_team_save')){
   if(!members.has(token))return Response.json({message:'TALLY_TEAM_DENIED'},{status:403});
   if(body.p_expected_revision!==row.revision)return Response.json({message:'TALLY_CONFLICT'},{status:400});
   row={payload:body.p_snapshot,revision:row.revision+1,updated_at:new Date().toISOString()};return Response.json({revision:row.revision,updated_at:row.updated_at});
  }
  return original(url,options);
 };
 const a=fa.make({fetcher:shared(fa.fetcher)}),b=fb.make({fetcher:shared(fb.fetcher)});await a.init();await b.init();
 await a.commit(s=>{C.setCount(s.sales,s.sales.items[0].id,5);s.privateNote='personal only';});await b.commit(s=>C.setCount(s.sales,s.sales.items[0].id,7));
 const created=await a.createTeam('共同测试','1234');assert.equal(C.total(row.payload.sales),0);assert.equal(row.payload.privateNote,undefined);
 await a.selectWorkspace(created);await b.joinTeam('1234');await b.selectWorkspace(created);
 const id=a.state.sales.items[0].id;await a.commit(s=>C.change(s.sales,id,1));await assert.rejects(b.commit(s=>C.change(s.sales,id,1)),/更新/);assert.equal(C.total(b.state.sales),1);
 await b.commit(s=>C.change(s.sales,id,1));await a.reload();assert.equal(C.total(a.state.sales),2);
 await a.selectWorkspace(null);await b.selectWorkspace(null);assert.equal(C.total(a.state.sales),5);assert.equal(C.total(b.state.sales),7);
 assert.ok(fa.caches.some(c=>c.scope.startsWith('team-')));assert.ok(fb.caches.some(c=>c.scope.startsWith('team-')));
 a.channel?.close();b.channel?.close();
});
