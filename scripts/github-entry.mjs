import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
const out='dist-github';
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});await cp('dist',out,{recursive:true});
let html=await readFile(out+'/index.html','utf8');
html=html.replace('<meta charset="utf-8">',`<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://pinztkcvnaswsiorhaun.supabase.co; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">`);
await writeFile(out+'/index.html',html);
console.log('Built the complete GitHub app with local assets and restricted network destinations.');
