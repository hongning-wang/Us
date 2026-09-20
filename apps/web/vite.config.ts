import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { hostname } from 'node:os';
export default defineConfig({ plugins: [sveltekit()], server: { allowedHosts: [hostname().toLowerCase()], fs: { allow: ['../..'] } } });
