import {build} from 'esbuild';
import {compile} from 'svelte/compiler';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {hostname} from 'node:os';
import {loadEnv} from 'vite';

export async function buildIOSScript(base,write=true){
 const platform=resolve('apps/mobile/src/instagram-platform.ts');
 const result=await build({entryPoints:['apps/mobile/src/instagram.ts'],bundle:true,write:false,format:'iife',target:'safari16',conditions:['browser'],define:{'import.meta.env':JSON.stringify({VITE_US_API_BASE:base}),'process.env.NODE_ENV':'"production"'},plugins:[{name:'ios-extension',setup(b){
  b.onResolve({filter:/^wxt\//},()=>({path:platform}));
  b.onLoad({filter:/\.svelte$/},args=>({contents:compile(readFileSync(args.path,'utf8'),{filename:args.path,generate:'client',css:'injected'}).js.code,loader:'js',resolveDir:dirname(args.path)}));
 }}]});
 const script=result.outputFiles[0].text;
 if(write){mkdirSync('apps/mobile/dist',{recursive:true});writeFileSync('apps/mobile/dist/us-instagram.js',script);writeFileSync('apps/mobile/dist/us-config.json',JSON.stringify({backend:base}));}
 return script;
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
 const env=loadEnv('development',resolve('apps/mobile'),'VITE_');
 const base=new URL(process.env.VITE_US_API_BASE||env.VITE_US_API_BASE||`http://${hostname()}:5173`).origin;
 await buildIOSScript(base);console.log('Bundled the existing Instagram extension for iOS.');
}
