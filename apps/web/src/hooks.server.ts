import type { Handle } from '@sveltejs/kit';
import { allowedOrigin, corsHeaders } from '$lib/server/http';
import { resumeJobs } from '$lib/server/jobs';
import {refreshStore} from '$lib/server/store';
import { ensureFallbackMedia } from '$lib/server/media';

let booted = false;

export const handle: Handle = async ({ event, resolve }) => {
 await refreshStore();
	if (!booted) {
		booted = true;
		await ensureFallbackMedia();
		void resumeJobs();
	}

	if (!event.url.pathname.startsWith('/api/')) return resolve(event);

	const origin = event.request.headers.get('origin');
	// Requests carrying a browser Origin must be from the extension context
	// (the instagram.com page or extension pages) or localhost tooling. This
	// blocks drive-by "simple" requests from arbitrary sites, which the CORS
	// response headers alone cannot prevent from reaching the server.
	if (origin && !allowedOrigin(origin)) {
		return new Response(JSON.stringify({ error: 'Origin not allowed.' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (event.request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: corsHeaders(origin) });
	}

	const res = await resolve(event);
	for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
	return res;
};
