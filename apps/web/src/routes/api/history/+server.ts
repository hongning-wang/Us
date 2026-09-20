import type { RequestHandler } from './$types';
import { handle, historySchema, ok, parseBody } from '$lib/server/http';
import { ApiError } from '$lib/server/jobs';
import { importHistory, resetHistory } from '$lib/server/service';

/** {conversationId, messages: Message[], complete: boolean} — deduped import into Honcho. */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await parseBody(request, historySchema);
		return ok(await importHistory(body.conversationId, body.messages, body.complete));
	} catch (e) {
		return handle(e);
	}
};

/** Reset pair memory + local dedup state for a conversation. */
export const DELETE: RequestHandler = async ({ url }) => {
	try {
		const conversationId = url.searchParams.get('conversationId');
		if (!conversationId) throw new ApiError(400, 'conversationId query parameter is required.');
		return ok(await resetHistory(conversationId));
	} catch (e) {
		return handle(e);
	}
};
