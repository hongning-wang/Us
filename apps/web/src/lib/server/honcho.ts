import { createHash } from 'node:crypto';
import type { Message, Pair } from '@us/shared/types';
import { env, hasHoncho } from './env';

/**
 * Honcho v3 REST adapter (https://api.honcho.dev, Bearer auth).
 * One pair-scoped session per conversation; sender and recipient are distinct
 * peers so memory keeps their identities separate.
 */

export class HonchoError extends Error {
	status: number;
	constructor(message: string, status = 0) {
		super(message);
		this.name = 'HonchoError';
		this.status = status;
	}
}

/** Honcho ids must match ^[a-zA-Z0-9_-]+$ */
export function honchoId(raw: string): string {
	const out = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
	if (!out) throw new HonchoError('Participant id cannot be mapped to a Honcho peer id.');
	return out === raw ? out : `${out.slice(0,180)}-${createHash('sha256').update(raw).digest('hex').slice(0,16)}`;
}

export interface HonchoMessage {
	content: string;
	peer_id: string;
	created_at?: string;
	metadata?: Record<string, unknown>;
}

export class Honcho {
	private base: string;
	private workspace: string;
	private key: string;

	constructor(cfg = env.honcho) {
		if (!cfg.apiKey) throw new HonchoError('HONCHO_API_KEY is not configured.');
		this.base = cfg.baseUrl;
		this.workspace = cfg.workspace;
		this.key = cfg.apiKey;
	}

	static available(): boolean {
		return hasHoncho();
	}

	private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
		let res: Response;
		try {
			res = await fetch(`${this.base}${path}`, {
				method,
				headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(30_000)
			});
		} catch (e) {
			throw new HonchoError(`Honcho unreachable: ${(e as Error).message}`);
		}
		const text = await res.text();
		if (!res.ok) {
			let detail = text.slice(0, 300);
			try {
				const parsed = JSON.parse(text);
				detail = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail ?? parsed).slice(0, 300);
			} catch {}
			throw new HonchoError(`Honcho ${res.status}: ${detail}`, res.status);
		}
		return (text ? JSON.parse(text) : {}) as T;
	}

	private api(p: string): string {
		return `/v3/workspaces/${encodeURIComponent(this.workspace)}${p}`;
	}

	/** Get-or-create the pair session with both participants as observed peers. */
	async ensureSession(sessionId: string, pair: Pair, extraPeerIds: string[] = []): Promise<void> {
		const peers: Record<string, { observe_me: boolean; observe_others: boolean }> = {};
		for (const id of [pair.sender.id, pair.recipient.id, ...extraPeerIds]) {
			peers[honchoId(id)] = { observe_me: true, observe_others: true };
		}
		await this.req('POST', this.api('/sessions'), {
			id: sessionId,
			metadata: { app: 'us-demo', conversationId: pair.conversationId }
		});
		await this.req('PUT', this.api(`/sessions/${encodeURIComponent(sessionId)}/peers`), peers);
	}

	/** Batch-ingest messages (max 100 per request per API). */
	async addMessages(sessionId: string, messages: HonchoMessage[]): Promise<number> {
		let sent = 0;
		for (let i = 0; i < messages.length; i += 100) {
			const batch = messages.slice(i, i + 100);
			await this.req('POST', this.api(`/sessions/${encodeURIComponent(sessionId)}/messages`), {
				messages: batch
			});
			sent += batch.length;
		}
		return sent;
	}

 async existingMessageIds(sessionId:string):Promise<Set<string>> {
  const ids=new Set<string>();
  for(let page=1;page<=20;page++) {
   const data=await this.req<{items:Array<{metadata?:{ig_message_id?:string}}>;pages:number}>('POST',this.api(`/sessions/${encodeURIComponent(sessionId)}/messages/list?page=${page}&size=100`),{filters:{}});
   for(const message of data.items)if(message.metadata?.ig_message_id)ids.add(message.metadata.ig_message_id);
   if(page>=data.pages)return ids;
  }
  throw new HonchoError('History reconciliation exceeded the demo limit.');
 }

 async sessionContext(sessionId:string):Promise<string>{
  const data=await this.req<{summary?:{content?:string};messages?:Array<{peer_id:string;content:string;metadata?:{kind?:string}}>}>('GET',this.api(`/sessions/${encodeURIComponent(sessionId)}/context`));
  const summary=data.summary?.content||'';
  const messages=(data.messages||[]).map(m=>`[${m.metadata?.kind==='imagined'?'imagined':'real'}] ${m.peer_id}: ${m.content.slice(0,600)}`).join('\n');
  return [summary,messages.slice(-8000)].filter(Boolean).join('\n').slice(0,10000);
 }

	/** Dialectic query against one peer's representation, scoped to this session. */
	async peerChat(peerId: string, query: string, sessionId: string): Promise<string> {
		const res = await this.req<{ content?: string | null }>(
			'POST',
			this.api(`/peers/${encodeURIComponent(honchoId(peerId))}/chat`),
			{ query, session_id: sessionId, reasoning_level: 'low', stream: false }
		);
		return res.content ?? '';
	}
}

export function toHonchoMessage(m: Message): HonchoMessage {
	const parts = [m.text?.trim() ?? ''];
 if(m.mediaUrl&&!m.text.includes(m.mediaUrl))parts.push(m.mediaUrl);
	const created = m.timestamp && !Number.isNaN(Date.parse(m.timestamp)) ? new Date(m.timestamp).toISOString() : undefined;
	return {
		content: parts.join(' ').slice(0, 25_000) || '[empty message]',
		peer_id: honchoId(m.authorId),
		created_at: created,
		metadata: {
			source: 'instagram-dm',
   cleaning_version: 1,
			kind: m.kind === 'imagined' ? 'imagined' : 'real',
			ig_message_id: m.id,
			order: m.order,
 ...(m.timestamp?{source_timestamp:m.timestamp}:{}),
			...(m.mediaUrl ? { media_url: m.mediaUrl } : {})
		}
	};
}

/** Minimal surface used by services — enables a fake in tests. */
export interface HonchoLike {
 existingMessageIds?(sessionId:string):Promise<Set<string>>;
	ensureSession(sessionId: string, pair: Pair, extraPeerIds?: string[]): Promise<void>;
	addMessages(sessionId: string, messages: HonchoMessage[]): Promise<number>;
	peerChat(peerId: string, query: string, sessionId: string): Promise<string>;
}

/** Import scraped DM messages; returns how many were written to Honcho. */
export async function importMessages(honcho: HonchoLike, sessionId: string, pair: Pair, messages: Message[]): Promise<number> {
	await honcho.ensureSession(sessionId, pair);
	return honcho.addMessages(sessionId, messages.map(toHonchoMessage));
}

/** Record an imagined event (instruction / scene summary) without polluting real facts. */
export async function noteImagined(honcho: HonchoLike, sessionId: string, authorId: string, text: string): Promise<void> {
	await honcho.addMessages(sessionId, [
		{
			content: `[imagined] ${text}`,
			peer_id: honchoId(authorId),
			metadata: { source: 'us-app', kind: 'imagined' }
		}
	]);
}

/** Pull a compact memory brief for both participants to steer generation. */
export async function memoryContext(honcho: Honcho, sessionId: string, pair: Pair): Promise<string> {
 const context=await honcho.sessionContext(sessionId);
 if(!context.trim())throw new HonchoError('Shared memory is empty. Import this chat first.');
 return `Pair: ${pair.sender.username} and ${pair.recipient.username}.\n${context}`;
}
