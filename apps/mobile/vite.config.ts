import {defineConfig} from 'vite';
import {svelte, vitePreprocess} from '@sveltejs/vite-plugin-svelte';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 plugins:[svelte({configFile:false,preprocess:vitePreprocess()})],
 resolve:{alias:{'@us/ui':fileURLToPath(new URL('../../packages/ui/src',import.meta.url)), '@us/shared':fileURLToPath(new URL('../../packages/shared/src',import.meta.url))}},
 publicDir:'../web/static',server:{fs:{allow:['../..']}}
});
