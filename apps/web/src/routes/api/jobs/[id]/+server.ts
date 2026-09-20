import type { RequestHandler } from './$types';
import { handle, ok } from '$lib/server/http';
import { getJob } from '$lib/server/jobs';

export const GET: RequestHandler = async ({ params }) => {
	try {
		return ok(getJob(params.id!));
	} catch (e) {
		return handle(e);
	}
};
