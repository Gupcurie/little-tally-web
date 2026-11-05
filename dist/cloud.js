import {canonicalUsername,checkPassword,accountAddress} from './account.js';
import {initialState,validateState,clone,uid} from './core.js';
import {BrowserLedger} from './storage.js';
import {newSegment} from './operations.js';

export class CloudLedger {
 constructor(config,{createClient,fetcher=globalThis.fetch.bind(globalThis),cacheFactory=scope=>new BrowserLedger({scope})}={}){
  this.config=config;this.createClient=createClient;this.fetcher=fetcher;this.cacheFactory=cacheFactory;
  this.workspace=null;this.teams=[];this.state=initialState();this.user=null;this.signedIn=false;this.requiresAuth=true;this.configured=Boolean(config.authEnabled!==false&&config.url&&config.publishableKey);
  this.readOnly=true;this.error=null;this.loading=false;this.saving=false;this.savedAt=null;this.cloudRevision=null;this.cache=null;this.cacheWarning=null;this.epoch=0;this.recoverable=null;this.protection=false;this.onchange=()=>{};this.channel=null;this._accountTask=Promise.resolve();
 }
 get db(){return this.signedIn&&this.client;}
 async init(){
  if(!this.configured)return this;
  if(!this.createClient){const mod=await import('./vendor/supabase.js');this.createClient=mod.createClient;}
  this.client=this.createClient(this.config.url,this.config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce',storageKey:'little-tally-auth-v1'}});
  const {data,error}=await this.client.auth.getSession();if(error){this.error='登录状态读取失败，请重新登录。';return this;}
  await this.setSession(data.session);
  this.subscription=this.client.auth.onAuthStateChange((event,session)=>{
   if(event==='INITIAL_SESSION')return;
   if(session?.user?.id===this.user?.id&&event!=='SIGNED_OUT')return;
   // Supabase warns against awaiting auth APIs inside the auth callback.
   setTimeout(()=>{this._accountTask=this._accountTask.then(()=>session?.user?.id===this.user?.id&&this.signedIn?undefined:this.setSession(session)).catch(()=>{});},0);
  }).data.subscription;
  if(typeof BroadcastChannel!=='undefined'){this.channel=new BroadcastChannel('little-tally-cloud-updates-v1');this.channel.onmessage=event=>{const x=event.data;if(x?.user===this.user?.id&&x.revision>this.cloudRevision&&!this.saving)this.reload().catch(()=>{});};}
  return this;
 }
 async setSession(session){
  const epoch=++this.epoch,oldCache=this.cache;
  // Clear the rendered account before any asynchronous validation or fetch.
  this.workspace=null;this.teams=[];this.state=initialState();this.user=null;this.signedIn=false;this.readOnly=true;this.cloudRevision=null;this.savedAt=null;this.cache=null;this.error=null;this.loading=Boolean(session);this.onchange();
  if(oldCache){try{await oldCache.clear();}catch{this.cacheWarning='上一账户的本机缓存未能完全清除；云端账户隔离仍有效。';}}
  if(!session){this.loading=false;this.onchange();return;}
  try{
   const {data,error}=await this.client.auth.getUser();if(error||!data.user||data.user.id!==session.user.id)throw new Error('登录已失效，请重新登录。');
   if(epoch!==this.epoch)return;
   this.user={id:data.user.id,username:data.user.app_metadata?.tally_username||'',email:data.user.email};this.signedIn=true;
   this.cache=this.cacheFactory('account-'+data.user.id);await this.cache.init();
   if(epoch!==this.epoch)return;
   this.teams=await this.listTeams();
   let preferred;try{preferred=localStorage.getItem('tally-workspace-'+this.user.id);}catch{}
   const selected=preferred==='personal'?null:this.teams.find(t=>t.id===preferred)||this.teams[0];
   if(selected){this.workspace=selected;try{await this.cache.clear();}catch{}this.cache=this.cacheFactory('team-'+selected.id+'-'+this.user.id);await this.cache.init();}
   await this.reload();
  }catch(err){if(epoch===this.epoch){this.error=err.message||'登录后读取记录失败，请重试。';this.readOnly=true;}}
  finally{if(epoch===this.epoch){this.loading=false;this.onchange();}}
 }
 async token(){
  if(!this.user)throw new Error('请先登录。');const expected=this.user.id;
  const {data,error}=await this.client.auth.getSession();const s=data?.session;
  if(error||!s?.access_token||s.user?.id!==expected)throw new Error('登录状态已变化，请重新登录。');
  return {token:s.access_token,user:expected,epoch:this.epoch};
 }
 async request(path,{method='GET',body,context}={}){
  const who=context||await this.token();let teamRead=false;
  if(this.workspace&&path.startsWith('tally_ledgers?')){path='rpc/tally_team_read';method='POST';body={p_team_id:this.workspace.id};teamRead=true;}
  else if(this.workspace&&path==='rpc/tally_save'){path='rpc/tally_team_save';body={...body,p_team_id:this.workspace.id};}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await this.fetcher(this.config.url+'/rest/v1/'+path,{method,headers:{apikey:this.config.publishableKey,Authorization:'Bearer '+who.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
   const data=await response.json().catch(()=>null);
   if(who.epoch!==this.epoch||who.user!==this.user?.id)throw new Error('账户已经切换，这次结果不会显示到另一账户。');
   if(!response.ok){const message=String(data?.message||'云端请求失败。');throw new Error(message.includes('TALLY_TEAM_')?({TALLY_TEAM_CODE_TAKEN:'这个号码今天已被使用，请更换。',TALLY_TEAM_CODE_INVALID:'入群码不存在或已过期。',TALLY_TEAM_RATE:'入群尝试过多，请稍后再试。',TALLY_TEAM_DENIED:'你没有这个群的权限。'}[message.match(/TALLY_TEAM_[A-Z_]+/)?.[0]]||'组队操作未完成。'):message.includes('TALLY_CONFLICT')?'TALLY_CONFLICT':message.includes('TALLY_INVALID')?'云端校验未通过，这次操作没有生效。':response.status===401?'登录已失效，请重新登录。':'云端暂时无法保存，请检查网络后重试。');}
   return teamRead?(data?[data]:[]):data;
  }finally{clearTimeout(timer);}
 }
 async reload(){
  if(!this.user)return;const who=await this.token();
  try{
   const rows=await this.request('tally_ledgers?select=payload,revision,updated_at&limit=1',{context:who});
   if(!Array.isArray(rows))throw new Error('云端返回的记录格式不正确。');
   if(rows.length){const row=rows[0];this.cloudRevision=Number(row.revision);this.state=validateState(row.payload);this.savedAt=Date.parse(row.updated_at);await this.saveCache();}
   else{
    let known=0;try{known=Number(localStorage.getItem('tally-cloud-known-'+who.user+(this.workspace?':team-'+this.workspace.id:''))||0);}catch{}
    if(known>0){this.cloudRevision=0;throw new Error('云端没有找到原有记录，已进入保护状态。请从导出的备份恢复，不会自动覆盖为空账本。');}
    this.state=initialState();this.cloudRevision=0;this.savedAt=null;
   }
   this.readOnly=false;this.error=null;
  }catch(err){if(who.epoch===this.epoch){this.readOnly=true;this.error=err.message||'云端记录没有加载成功，原记录不会被空数据覆盖。';}throw err;}
  finally{this.onchange();}
 }
 async saveCache(){
  try{localStorage.setItem('tally-cloud-known-'+this.user.id+(this.workspace?':team-'+this.workspace.id:''),String(this.cloudRevision));}catch{}
  try{if(this.cache?.db){await this.cache.restoreState(clone(this.state),{silent:true});this.protection=this.cache.protection;this.cacheWarning=null;}}
  catch{this.cacheWarning='云端已保存，本机备用副本未能写入。';}
 }
 async commit(mutator,{recovering=false}={}){
  if(!this.signedIn||(!recovering&&this.readOnly)||this.cloudRevision===null)throw new Error(this.error||'请先登录并加载云端记录。');
  if(this.saving)throw new Error('上一笔还在保存，请稍候。');
  this.saving=true;
  try{
   const who=await this.token(),next=clone(this.state),mutation=uid();
   mutator(next);next.revision=Number(this.cloudRevision)+1;validateState(next);
   const body={p_expected_revision:this.cloudRevision,p_snapshot:next,p_mutation:mutation};let ack;
   try{ack=await this.request('rpc/tally_save',{method:'POST',body,context:who});}
   catch(first){
    if(first.message==='TALLY_CONFLICT'){await this.reload();throw new Error('其他页面刚更新了记录，已读取最新版本。请核对后重试，避免覆盖。');}
    // Retry the exact mutation once: the database treats it as idempotent.
    try{ack=await this.request('rpc/tally_save',{method:'POST',body,context:who});}
    catch(second){
     if(who.epoch===this.epoch){this.readOnly=true;this.error='本次云端保存状态尚未确认，请点“重新同步”核对最新数量。先不要重复加减。';}
     throw new Error(this.error||second.message);
    }
   }
   if(who.epoch!==this.epoch||who.user!==this.user?.id)throw new Error('账户已切换，请查看当前账户。');
   if(!Number.isSafeInteger(Number(ack?.revision))||Number(ack.revision)!==next.revision)throw new Error('云端版本未能确认，请重新同步。');
   this.cloudRevision=Number(ack.revision);this.state=next;this.savedAt=Date.parse(ack.updated_at);this.readOnly=false;this.error=null;await this.saveCache();
   this.channel?.postMessage({user:who.user,revision:this.cloudRevision});this.onchange();return this.state;
  }finally{this.saving=false;}
 }
 async listTeams(){const rows=await this.request('rpc/tally_teams',{method:'POST',body:{}});return Array.isArray(rows)?rows:[];}
 async selectWorkspace(team){
  if(this.saving||this.loading)throw Error('请等当前保存或切换完成。');const known=await this.listTeams();if(team&&!known.some(t=>t.id===team.id))throw Error('你不在这个群中。');
  ++this.epoch;this.loading=true;this.readOnly=true;this.state=initialState();this.workspace=team;this.cloudRevision=null;this.savedAt=null;this.onchange();
  try{if(this.cache)await this.cache.clear();this.cache=this.cacheFactory(team?'team-'+team.id+'-'+this.user.id:'account-'+this.user.id);await this.cache.init();await this.reload();try{localStorage.setItem('tally-workspace-'+this.user.id,team?.id||'personal');}catch{}}
  finally{this.loading=false;this.onchange();}
 }
 async createTeam(name,code){const empty=newSegment(this.state),payload={format:empty.format,version:1,revision:1,sales:empty.sales,stock:empty.stock,egg:empty.egg,periodStartedAt:empty.periodStartedAt};return this.request('rpc/tally_team_create',{method:'POST',body:{p_name:name,p_code:code,p_snapshot:payload}});}
 async joinTeam(code){const data=await this.request('rpc/tally_team_join',{method:'POST',body:{p_code:code}});if(data?.error)throw Error(data.error==='TALLY_TEAM_RATE'?'入群尝试过多，请10分钟后再试。':'入群码不存在或已过期。');return data;}
 async listPeriods(){const rows=await this.request('rpc/tally_periods',{method:'POST',body:{p_team_id:this.workspace?.id||null}});return Array.isArray(rows)?rows:[];}
 async closePeriod(next){
  if(this.saving||this.readOnly)throw Error('请等当前账本可保存后再结算。');this.saving=true;
  try{next.revision=this.cloudRevision+1;validateState(next);const options={method:'POST',body:{p_team_id:this.workspace?.id||null,p_expected_revision:this.cloudRevision,p_snapshot:next,p_mutation:uid()}};
   try{await this.request('rpc/tally_period_close',options);}catch(first){if(first.message==='TALLY_CONFLICT'){await this.reload();throw Error('账本刚更新，已同步最新数据，请重新核对结算。');}try{await this.request('rpc/tally_period_close',options);}catch{await this.reload();throw Error('已重新读取云端，请先核对当前数量和历史分段，避免重复结算。');}}await this.reload();}
  finally{this.saving=false;}
 }
 async restoreState(state){validateState(state);return this.commit(s=>Object.assign(s,clone(state)),{recovering:true});}
 async previous(){if(this.workspace){const row=await this.request('rpc/tally_team_previous',{method:'POST',body:{p_team_id:this.workspace.id}});return row?{state:validateState(row.payload),savedAt:Date.parse(row.saved_at)}:null;}const rows=await this.request('rpc/tally_backup_list',{method:'POST',body:{}});if(!rows?.length)return null;const row=rows[0],snapshot=await this.request('rpc/tally_backup_get',{method:'POST',body:{p_revision:row.revision}});return snapshot?{state:validateState(snapshot),savedAt:Date.parse(row.saved_at)}:null;}
 async requestProtection(){if(!this.cache)return false;this.protection=await this.cache.requestProtection();return this.protection;}
 raw(){return JSON.stringify(this.state,null,2);}
 async login(username,password){
  if(!this.client)throw new Error('账户服务尚未开通。');
  if(!globalThis.isSecureContext)throw new Error('请通过正式 HTTPS 网站登录。');
  username=canonicalUsername(username);
  if(typeof password!=='string'||!password)throw new Error('请输入密码。');
  const {data,error}=await this.client.auth.signInWithPassword({email:await accountAddress(username),password});
  if(error||!data?.session){throw new Error(error?.status===429?'登录尝试过于频繁，请稍后再试。':'用户名或密码不正确。');}
  await this.setSession(data.session);
 }
 async register(username,password){
  if(!this.client)throw new Error('账户服务尚未开通。');
  if(!globalThis.isSecureContext)throw new Error('请通过正式 HTTPS 网站注册。');
  username=canonicalUsername(username);checkPassword(password);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await this.fetcher(this.config.url+'/functions/v1/tally-accounts',{method:'POST',headers:{apikey:this.config.publishableKey,Authorization:'Bearer '+this.config.registrationKey,'Content-Type':'application/json'},body:JSON.stringify({username,password}),signal:controller.signal});
   const data=await response.json().catch(()=>({}));
   if(!response.ok){throw new Error(data.error==='USERNAME_TAKEN'?'这个用户名已被使用，请换一个。':response.status===429?'注册尝试过于频繁，请稍后再试。':'注册暂时未完成，请稍后重试。');}
   if(!data.created)throw new Error('注册结果未能确认，请先尝试登录。');
   try{await this.login(username,password);}catch{throw new Error('账户已创建。请切换到“登录”，使用刚才的用户名和密码。');}
  }finally{clearTimeout(timer);}
 }
 async logout(){if(this.saving)throw new Error('请等当前这笔保存完成后再退出。');const {error}=await this.client.auth.signOut({scope:'local'});if(error)throw new Error('退出未完成，请检查网络后重试。');await this.setSession(null);}
 async changePassword(oldPassword,newPassword){
  if(!this.client)throw new Error('账户服务尚未开通。');
  if(!this.signedIn||!this.user?.email)throw new Error('请先登录。');
  if(typeof oldPassword!=='string'||!oldPassword)throw new Error('请输入原密码。');
  if(typeof newPassword!=='string')throw new Error('请输入新密码。');
  checkPassword(newPassword);
  if(oldPassword===newPassword)throw new Error('新密码不能和原密码相同。');
  const {error}=await this.client.auth.signInWithPassword({email:this.user.email,password:oldPassword});
  if(error){throw new Error(error?.status===429?'尝试过于频繁，请稍后再试。':'原密码不正确。');}
  const {error:updateError}=await this.client.auth.updateUser({password:newPassword});
  if(updateError){throw new Error('密码没有改成，请稍后重试。');}
 }
}
