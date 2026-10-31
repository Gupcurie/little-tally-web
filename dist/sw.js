const VERSION='little-tally-shell-v9';
const ROOT=new URL('./',self.location).href;
const ASSETS=['./','./index.html','./style.css','./app.js','./core.js','./account.js','./connection.js','./storage.js','./cloud.js','./cloud-config.js','./vendor/supabase.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil((async()=>{const cache=await caches.open(VERSION);await cache.addAll(ASSETS);})());});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('little-tally-shell-')&&name!==VERSION)await caches.delete(name);await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(ROOT))return;
 // Never cache authentication callbacks or URLs carrying a one-time auth code.
 if(url.searchParams.has('code')||url.searchParams.has('token_hash'))return;
 if(event.request.mode==='navigate'){
  event.respondWith((async()=>{const cache=await caches.open(VERSION);try{const response=await fetch(event.request,{cache:'no-cache'});if(response.ok&&response.headers.get('content-type')?.includes('text/html')){const html=await response.clone().text();if(html.includes('name="little-tally-app"'))await cache.put(new URL('./index.html',ROOT),response.clone());}return response;}catch{const saved=await cache.match(new URL('./index.html',ROOT));return saved||Response.error();}})());return;
 }
 if(ASSETS.some(path=>new URL(path,ROOT).href===url.href))event.respondWith((async()=>{try{const response=await fetch(event.request,{cache:'no-cache'});if(response.ok&&(url.pathname.endsWith('.js')?!response.headers.get('content-type')?.includes('text/html'):true)){const cache=await caches.open(VERSION);await cache.put(event.request,response.clone());}return response;}catch{return (await caches.match(event.request))||Response.error();}})());
});
