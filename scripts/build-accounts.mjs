import {build} from 'esbuild';
await build({stdin:{contents:"import {makeRegistrationHandler} from './src/registration.js'; Deno.serve(makeRegistrationHandler({env:name=>Deno.env.get(name)}));",resolveDir:process.cwd(),sourcefile:'accounts-entry.js'},bundle:true,platform:'neutral',format:'esm',outfile:'supabase/functions/tally-accounts/index.ts'});
console.log('Built the username registration endpoint.');
