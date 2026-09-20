import type { RequestHandler } from './$types';
import { deliverySchema, handle, ok, parseBody } from '$lib/server/http';
import { setDelivery } from '$lib/server/jobs';

/** {status: 'sending'|'sent'|'failed', messageId?, error?} — called by the extension around the Instagram upload. */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await parseBody(request, deliverySchema);
		return ok(await setDelivery(params.id!, body));
	} catch (e) {
		return handle(e);
	}
};
