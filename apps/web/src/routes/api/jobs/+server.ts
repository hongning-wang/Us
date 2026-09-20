import type { RequestHandler } from './$types';
import { createJobSchema, handle, ok, parseBody } from '$lib/server/http';
import { createJob } from '$lib/server/jobs';
import { listJobs } from '$lib/server/store';

export const GET: RequestHandler = async ({ url }) => {
	try {
		return ok(listJobs(url.searchParams.get('conversationId') ?? undefined));
	} catch (e) {
		return handle(e);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const job = await createJob(await parseBody(request, createJobSchema));
		return ok(job, { status: 201 });
	} catch (e) {
		return handle(e);
	}
};
