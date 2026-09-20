import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
export default { preprocess: vitePreprocess(), kit: { adapter: adapter(), alias: { '@us/ui': '../../packages/ui/src', '@us/shared': '../../packages/shared/src' } } };
