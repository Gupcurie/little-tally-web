// Connectivity checks send no account credentials or ledger contents.
export async function probeConnection(config,{fetcher=globalThis.fetch.bind(globalThis),pageURL=globalThis.location?.href,timeoutMs=8000}={}){
 const root=new URL('./',pageURL);
 const specs=[
  {name:'网页',url:new URL('health.json',root).href,options:{},accept:(r,d)=>r.ok&&d?.app==='little-tally'},
  {name:'登录服务',url:config.url+'/auth/v1/settings',options:{headers:{apikey:config.publishableKey}},accept:r=>r.ok},
  {name:'数据服务',url:config.url+'/rest/v1/tally_ledgers?select=revision&limit=0',options:{headers:{apikey:config.publishableKey,Authorization:'Bearer '+config.registrationKey}},accept:r=>r.ok||[401,403].includes(r.status)},
  {name:'注册服务',url:config.url+'/functions/v1/tally-accounts',options:{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+config.registrationKey,'Content-Type':'application/json'},body:'{}'},accept:(r,d)=>r.status===400&&d?.error==='INVALID_ACCOUNT'}
 ];
 return Promise.all(specs.map(async s=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetcher(s.url,{...s.options,cache:'no-store',credentials:'omit',signal:controller.signal});const data=await response.json().catch(()=>null);const ok=s.accept(response,data);return {name:s.name,ok,detail:ok?'已连接':'服务响应异常（HTTP '+response.status+'）'};}catch(err){return {name:s.name,ok:false,detail:err?.name==='AbortError'?'连接超时':'当前网络未连接'};}finally{clearTimeout(timer);}}));
}
