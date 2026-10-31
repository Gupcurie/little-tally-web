import {initialState,validateState,clone,day} from './core.js';

const DB_NAME='little-tally-pocket-v1';
const MIRROR='little-tally-pocket-recovery-v1';
const message='本机记录没有成功保存，这次操作没有生效。请检查浏览器储存空间，并先导出备份。';
// This checksum detects accidental cache corruption, not adversarial changes.
// Account security is enforced by Supabase Auth and database RLS separately.
const digest=async payload=>{let a=2166136261,b=2246822507;for(let i=0;i<payload.length;i++){const c=payload.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,3266489909);}return 'cache-v1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');};
async function pack(state){const payload=JSON.stringify(validateState(state));return {payload,hash:await digest(payload),savedAt:Date.now()};}
async function unpack(envelope){if(!envelope||typeof envelope.payload!=='string'||typeof envelope.hash!=='string'||await digest(envelope.payload)!==envelope.hash)throw new Error('副本完整性校验失败。');return validateState(JSON.parse(envelope.payload));}
function openDB(name){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('ledgers'))r.result.createObjectStore('ledgers');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('请关闭这个网页的其他旧窗口后重试。'));});}
function readAll(db){return new Promise((resolve,reject)=>{const tx=db.transaction('ledgers','readonly'),store=tx.objectStore('ledgers'),result={};for(const k of ['current','previous','day-start']){const r=store.get(k);r.onsuccess=()=>{result[k]=r.result;};}tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('读取被中断。'));});}
export class BrowserLedger {
 constructor({scope='local'}={}){this.scope=scope;this.dbName=DB_NAME+':'+scope;this.mirrorKey=MIRROR+':'+scope;this.state=initialState();this.envelope=null;this.readOnly=true;this.error=null;this.recoverable=null;this.savedAt=null;this.saving=false;this.protection=false;this.db=null;this.channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(this.dbName):null;}
 async init(){try{this.db=await openDB(this.dbName);this.db.onversionchange=()=>{this.db.close();this.readOnly=true;this.error='记录数据库已更新，请刷新页面再继续。';};await this.reload();if(!this.envelope&&!this.readOnly){await this.commit(()=>{});}if(navigator.storage?.persisted)this.protection=await navigator.storage.persisted();}catch(e){this.readOnly=true;this.error='无法打开本机存储，尚未覆盖任何记录。请使用正常浏览模式或先导出可用副本。';}return this;}
 async reload(){
  const entries=await readAll(this.db);this.recoverable=null;
  if(entries.current){try{this.state=await unpack(entries.current);this.envelope=entries.current;this.savedAt=entries.current.savedAt;this.readOnly=false;this.error=null;return;}catch(e){this.error='当前记录未通过校验，原数据已保留。可以先导出原文件，再尝试恢复本机副本。';}}
  else if(!entries.previous&&!entries['day-start']){
   let mirror=null,mirrorExists=false;try{const raw=localStorage.getItem(this.mirrorKey);mirrorExists=raw!==null;mirror=JSON.parse(raw||'null');}catch{}
   if(mirrorExists&&!mirror){this.readOnly=true;this.error='备用副本也未能读取，尚未用空数据覆盖。请从导出的完整备份恢复。';return;}
   if(!mirror){this.state=initialState();this.envelope=null;this.readOnly=false;this.error=null;return;}
   entries.previous=mirror;this.error='主记录不存在，但找到了本机备用副本，请确认恢复。';
  }
  for(const e of [entries.previous,entries['day-start']]){if(e){try{const state=await unpack(e);this.recoverable={state,envelope:e};break;}catch{}}}
  this.readOnly=true;this.envelope=entries.current??null;
 }
 async commit(mutator){
  if(this.readOnly)throw new Error(this.error||'当前记录需要恢复。');
  if(this.saving)throw new Error('上一笔还在保存，请稍候。');this.saving=true;
  try{
   const next=clone(this.state);mutator(next);next.revision++;const envelope=await pack(next),expected=this.envelope?.payload??null,previous=this.envelope;
   await new Promise((resolve,reject)=>{
    const tx=this.db.transaction('ledgers','readwrite'),store=tx.objectStore('ledgers');let conflict=false;
    const request=store.get('current');request.onsuccess=()=>{
     if((request.result?.payload??null)!==expected){conflict=true;tx.abort();return;}
     if(previous){store.put(previous,'previous');if(day(previous.savedAt)!==day(envelope.savedAt))store.put(previous,'day-start');}
     store.put(envelope,'current');
    };
    tx.oncomplete=resolve;tx.onerror=()=>reject(new Error(message));tx.onabort=()=>reject(new Error(conflict?'另一页面刚更新了记录，请刷新同步后再试。':message));
   });
   this.state=next;this.envelope=envelope;this.savedAt=envelope.savedAt;
   try{localStorage.setItem(this.mirrorKey,JSON.stringify(envelope));}catch{/* IndexedDB commit is already durable. */}
   this.channel?.postMessage({revision:next.revision});return next;
  }finally{this.saving=false;}
 }
 async restoreState(state,{silent=false}={}){
  validateState(state);const envelope=await pack(state);
  await new Promise((resolve,reject)=>{const tx=this.db.transaction('ledgers','readwrite'),s=tx.objectStore('ledgers');if(this.envelope)s.put(this.envelope,'previous');s.put(envelope,'current');tx.oncomplete=resolve;tx.onerror=()=>reject(new Error(message));tx.onabort=()=>reject(new Error(message));});
  this.state=state;this.envelope=envelope;this.savedAt=envelope.savedAt;this.readOnly=false;this.error=null;this.recoverable=null;try{localStorage.setItem(this.mirrorKey,JSON.stringify(envelope));}catch{}if(!silent)this.channel?.postMessage({revision:state.revision});
 }
 async requestProtection(){if(!navigator.storage?.persist)return false;this.protection=await navigator.storage.persist();return this.protection;}
 raw(){return this.envelope?JSON.stringify(this.envelope,null,2):'';}
 async previous(){if(!this.db)return null;const e=await readAll(this.db);for(const k of ['previous','day-start']){if(e[k]){try{return {state:await unpack(e[k]),savedAt:e[k].savedAt};}catch{}}}return null;}
 async clear(){if(this.db){await new Promise((resolve,reject)=>{const tx=this.db.transaction('ledgers','readwrite');tx.objectStore('ledgers').clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});this.db.close();this.db=null;}try{localStorage.removeItem(this.mirrorKey);}catch{}this.channel?.close();this.state=initialState();this.envelope=null;this.savedAt=null;}
}
