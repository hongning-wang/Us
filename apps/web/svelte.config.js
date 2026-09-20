import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
export default { preprocess: vitePreprocess(), kit: { csrf: { trustedOrigins: ['capacitor://localhost', 'http://localhost:5176', 'http://127.0.0.1:5176'] }, adapter: adapter(), alias: { '@us/ui': '../../packages/ui/src', '@us/shared': '../../packages/shared/src' } } };
