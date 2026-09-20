import type { RequestHandler } from './$types';
import { handle, ok, pairSchema, parseBody } from '$lib/server/http';
import { ApiError } from '$lib/server/jobs';
import { configurePair, getSetup } from '$lib/server/service';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const conversationId = url.searchParams.get('conversationId');
		if (!conversationId) throw new ApiError(400, 'conversationId query parameter is required.');
		return ok(getSetup(conversationId));
	} catch (e) {
		return handle(e);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		return ok(await configurePair(await parseBody(request, pairSchema)));
	} catch (e) {
		return handle(e);
	}
};
