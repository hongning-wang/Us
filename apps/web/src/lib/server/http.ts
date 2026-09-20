import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from './env';
import { ApiError } from './jobs';

// ---- validation ----------------------------------------------------------

const id = z.string().min(1).max(200);

export const participantSchema = z.object({
	id,
	username: z.string().min(1).max(200),
	name: z.string().min(1).max(200),
	photoUrl: z.string().max(2000).optional(),
	photoConfirmed: z.boolean().optional()
});

export const pairSchema = z.object({
	conversationId: id,
	sender: participantSchema,
	recipient: participantSchema
});

export const messageSchema = z.object({
	id: z.string().min(1).max(300),
	authorId: z.string().min(1).max(300),
	text: z.string().max(25_000).default(''),
	timestamp: z.string().max(100).optional(),
	mediaUrl: z.string().max(4000).optional(),
 mediaKind: z.enum(['reel','video','image']).optional(),
	kind: z.enum(['real', 'imagined']).optional(),
	order: z.number().int().nonnegative().default(0)
});

export const referenceSchema = z.object({
	kind: z.enum(['reel', 'video']),
	mediaId: z.string().min(1).max(500),
	url: z.string().max(4000).optional(),
	messageId: z.string().max(300).optional(),
	parentJobId: z.string().max(300).optional()
});

export const createJobSchema = pairSchema.extend({
	instruction: z.string().min(1).max(4000),
	reference: referenceSchema.optional(),
	idempotencyKey: z.string().min(1).max(300)
});

export const historySchema = z.object({
	conversationId: id,
	messages: z.array(messageSchema).max(500).default([]),
	complete: z.boolean().default(false)
});

export const deliverySchema = z.object({
	status: z.enum(['sending', 'sent', 'failed']),
 safeToRetry: z.boolean().optional(),
	messageId: z.string().max(300).optional(),
	error: z.string().max(2000).optional()
});

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw new ApiError(400, 'Request body must be valid JSON.');
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new ApiError(400, `Invalid request: ${issue.path.join('.') || 'body'} — ${issue.message}`);
	}
	return parsed.data;
}

// ---- responses -----------------------------------------------------------

export function ok(data: unknown, init?: ResponseInit): Response {
	return json(data, init);
}

export function handle(e: unknown): Response {
	if (e instanceof ApiError) return json({ error: e.message }, { status: e.status });
	return json({ error: (e as Error)?.message ?? 'Internal error' }, { status: 500 });
}

// ---- CORS ----------------------------------------------------------------

const STATIC_ORIGINS = new Set(['https://www.instagram.com', 'https://instagram.com']);

export function allowedOrigin(origin: string | null): string | null {
	if (!origin) return null;
	if (STATIC_ORIGINS.has(origin)) return origin;
	if (env.extraOrigins.includes(origin)) return origin;
	try {
		const u = new URL(origin);
		if (u.protocol === 'chrome-extension:') return origin;
		if ((u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return origin;
	} catch {}
	return null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
	const allowed = allowedOrigin(origin);
	if (!allowed) return {};
	return {
		'Access-Control-Allow-Origin': allowed,
		'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin'
	};
}

export function withCors(response: Response, origin: string | null): Response {
	const headers = corsHeaders(origin);
	for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
	return response;
}
