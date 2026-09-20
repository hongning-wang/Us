import type { RequestHandler } from './$types';
import { handle, ok } from '$lib/server/http';
import { retryJob } from '$lib/server/jobs';

export const POST: RequestHandler = async ({ params }) => {
	try {
		return ok(await retryJob(params.id!));
	} catch (e) {
		return handle(e);
	}
};
