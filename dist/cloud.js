import {initialState,validateState,clone,uid} from './core.js';
import {BrowserLedger} from './storage.js';

export class CloudLedger {
 constructor(config,{createClient,fetcher=globalThis.fetch,cacheFactory=scope=>new BrowserLedger({scope})}={}){
  this.config=config;this.createClient=createClient;this.fetcher=fetcher;this.cacheFactory=cacheFactory;
  this.state=initialState();this.user=null;this.signedIn=false;this.requiresAuth=true;this.configured=Boolean(config.url&&config.publishableKey);
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
   setTimeout(()=>{this._accountTask=this._accountTask.then(()=>this.setSession(session)).catch(()=>{});},0);
  }).data.subscription;
  if(typeof BroadcastChannel!=='undefined'){this.channel=new BroadcastChannel('little-tally-cloud-updates-v1');this.channel.onmessage=event=>{const x=event.data;if(x?.user===this.user?.id&&x.revision>this.cloudRevision&&!this.saving)this.reload().catch(()=>{});};}
  return this;
 }
 async setSession(session){
  const epoch=++this.epoch,oldCache=this.cache;
  // Clear the rendered account before any asynchronous validation or fetch.
  this.state=initialState();this.user=null;this.signedIn=false;this.readOnly=true;this.cloudRevision=null;this.savedAt=null;this.cache=null;this.error=null;this.loading=Boolean(session);this.onchange();
  if(oldCache){try{await oldCache.clear();}catch{this.cacheWarning='上一账户的本机缓存未能完全清除；云端账户隔离仍有效。';}}
  if(!session){this.loading=false;this.onchange();return;}
  try{
   const {data,error}=await this.client.auth.getUser();if(error||!data.user||data.user.id!==session.user.id)throw new Error('登录已失效，请重新登录。');
   if(epoch!==this.epoch)return;
   this.user={id:data.user.id,email:data.user.email};this.signedIn=true;
   this.cache=this.cacheFactory('account-'+data.user.id);await this.cache.init();
   if(epoch!==this.epoch)return;
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
  const who=context||await this.token(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await this.fetcher(this.config.url+'/rest/v1/'+path,{method,headers:{apikey:this.config.publishableKey,Authorization:'Bearer '+who.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
   const data=await response.json().catch(()=>null);
   if(who.epoch!==this.epoch||who.user!==this.user?.id)throw new Error('账户已经切换，这次结果不会显示到另一账户。');
   if(!response.ok){const message=String(data?.message||'云端请求失败。');throw new Error(message.includes('TALLY_CONFLICT')?'TALLY_CONFLICT':message.includes('TALLY_INVALID')?'云端校验未通过，这次操作没有生效。':response.status===401?'登录已失效，请重新登录。':'云端暂时无法保存，请检查网络后重试。');}
   return data;
  }finally{clearTimeout(timer);}
 }
 async reload(){
  if(!this.user)return;const who=await this.token();
  try{
   const rows=await this.request('tally_ledgers?select=payload,revision,updated_at&limit=1',{context:who});
   if(!Array.isArray(rows))throw new Error('云端返回的记录格式不正确。');
   if(rows.length){const row=rows[0];this.cloudRevision=Number(row.revision);this.state=validateState(row.payload);this.savedAt=Date.parse(row.updated_at);await this.saveCache();}
   else{
    let known=0;try{known=Number(localStorage.getItem('tally-cloud-known-'+who.user)||0);}catch{}
    if(known>0){this.cloudRevision=0;throw new Error('云端没有找到原有记录，已进入保护状态。请从导出的备份恢复，不会自动覆盖为空账本。');}
    this.state=initialState();this.cloudRevision=0;this.savedAt=null;
   }
   this.readOnly=false;this.error=null;
  }catch(err){this.readOnly=true;this.error=err.message||'云端记录没有加载成功，原记录不会被空数据覆盖。';throw err;}
  finally{this.onchange();}
 }
 async saveCache(){
  try{localStorage.setItem('tally-cloud-known-'+this.user.id,String(this.cloudRevision));}catch{}
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
 async restoreState(state){validateState(state);return this.commit(s=>Object.assign(s,clone(state)),{recovering:true});}
 async previous(){const rows=await this.request('rpc/tally_backup_list',{method:'POST',body:{}});if(!rows?.length)return null;const row=rows[0],snapshot=await this.request('rpc/tally_backup_get',{method:'POST',body:{p_revision:row.revision}});return snapshot?{state:validateState(snapshot),savedAt:Date.parse(row.saved_at)}:null;}
 async requestProtection(){if(!this.cache)return false;this.protection=await this.cache.requestProtection();return this.protection;}
 raw(){return JSON.stringify(this.state,null,2);}
 async login(email){
  if(!this.client)throw new Error('账户服务尚未开通。');
  if(!globalThis.isSecureContext)throw new Error('请通过正式 HTTPS 网站登录，当前预览连接仅用于界面检查。');
  const redirect=this.config.redirectUrl||new URL('./',location.href).href;
  const {error}=await this.client.auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:redirect,shouldCreateUser:true}});
  if(error){const m=String(error.message||'');throw new Error(m.includes('rate')?'登录邮件发送过于频繁，请稍后再试。':m.includes('authorized')?'登录邮件服务尚未配置完成，请联系网站创建者。':'登录邮件未能发送，请检查邮箱地址后重试。');}
 }
 async logout(){if(this.saving)throw new Error('请等当前这笔保存完成后再退出。');const {error}=await this.client.auth.signOut({scope:'local'});if(error)throw new Error('退出未完成，请检查网络后重试。');await this.setSession(null);}
}
