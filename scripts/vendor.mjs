import {build} from 'esbuild';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
await mkdir('dist/vendor',{recursive:true});
await build({stdin:{contents:"export {createClient} from '@supabase/supabase-js';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:['safari16','chrome100'],minify:true,outfile:'dist/vendor/supabase.js',legalComments:'eof'});
await copyFile('node_modules/@supabase/supabase-js/LICENSE','dist/vendor/SUPABASE-LICENSE.txt');
await writeFile('dist/.nojekyll','');
console.log('Bundled the official Supabase client for same-origin delivery.');
