import type { RequestHandler } from './$types';
import { handle, ok } from '$lib/server/http';
import { ApiError } from '$lib/server/jobs';
import { savePhoto } from '$lib/server/service';

/** multipart: conversationId, participantId, confirmed=true, file=<image> */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const form = await request.formData();
		const conversationId = form.get('conversationId');
		const participantId = form.get('participantId');
		const confirmed = form.get('confirmed');
		const file = form.get('file');
		if (typeof conversationId !== 'string' || !conversationId) throw new ApiError(400, 'conversationId is required.');
		if (typeof participantId !== 'string' || !participantId) throw new ApiError(400, 'participantId is required.');
		if (!(file instanceof File)) throw new ApiError(400, 'file is required.');
		return ok(await savePhoto(conversationId, participantId, typeof confirmed === 'string' ? confirmed : null, file, form.get('scope')==='chat'?'chat':'account'));
	} catch (e) {
		return handle(e);
	}
};
