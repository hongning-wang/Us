import type { Job, Message, Pair } from '@us/shared/types';
import {changeSnapshot,loadSnapshot} from './postgres';

export interface PhotoRecord {
	filename: string;
	confirmedAt: string;
	contentType: string;
}

export interface HistoryRecord {
	/** IG message ids already ingested into Honcho — dedup source of truth. */
	ids: Record<string, true>;
	count: number;
 pendingIds?: string[];
	complete: boolean;
	updatedAt: string;
}

export interface MemoryRecord {
	sessionId: string;
	/** Bumped on reset: each generation is a fresh Honcho session. */
	generation: number;
	status: string;
	lastError?: string;
}

export type JobStage = 'spec' | 'generate' | 'deliver' | 'done';

export interface GenerationSpec {
	scenePrompt: string;
	sceneSummary: string;
	duration: number;
	quality: '480p' | '720p' | '1080p';
	aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | 'adaptive';
	generateAudio: boolean;
	useIdentityPhotos: boolean;
	useReferenceVideo: boolean;
}

export interface JobInternal {
	idempotencyKey?: string;
	stage: JobStage;
	attempts: number;
	spec?: GenerationSpec;
	provider?: string;
	providerTaskId?: string;
	providerStatus?: string;
 submissionUncertain?: boolean;
 deliveryUncertain?: boolean;
	warnings: string[];
	deadline?: number;
	abandoned?: boolean;
	memoryUsed?: boolean;
}

export interface JobRecord {
	job: Job;
	internal: JobInternal;
}

export interface StoreShape {
	version: 1;
	pairs: Record<string, Pair>;
	photos: Record<string, PhotoRecord>;
 chatPhotos: Record<string, PhotoRecord & {participantId:string;confirmedBy:string}>;
	history: Record<string, HistoryRecord>;
	jobs: Record<string, JobRecord>;
	/** `${conversationId}:${idempotencyKey}` -> jobId */
	idempotency: Record<string, string>;
	memory: Record<string, MemoryRecord>;
}

const EMPTY: StoreShape = {
	version: 1,
	pairs: {},
	photos: {},
 chatPhotos: {},
	history: {},
	jobs: {},
	idempotency: {},
	memory: {}
};

let state: StoreShape | null = null;
let queue: Promise<unknown> = Promise.resolve();

function load():StoreShape {
 if(state)return state;
 if(process.env.US_TEST_STORE==='memory'&&process.env.NODE_ENV==='test')return state=structuredClone(EMPTY);
 throw Error('Database state has not been initialized.');
}

/**
 * Serialized read-modify-write. All mutations queue behind each other so
 * concurrent requests can never interleave a read and a write.
 */
export function mutate<T>(fn: (s: StoreShape) => T): Promise<T> {
	const run = queue.then(async () => {
  if(process.env.US_TEST_STORE==='memory'&&process.env.NODE_ENV==='test'){
   const next=structuredClone(load());const out=fn(next);state=next;return out;
  }
  const next=await changeSnapshot(fn);state=next.state;return next.result;
	});
	queue = run.catch(() => {});
	return run;
}

/** Refresh request snapshots from the database, serialized with mutations. */
export function refreshStore():Promise<void>{
 const run=queue.then(async()=>{if(process.env.US_TEST_STORE==='memory'&&process.env.NODE_ENV==='test')load();else state=await loadSnapshot();});
 queue=run.catch(()=>{});return run;
}

/** Consistent snapshot for reads. */
export function read<T>(fn: (s: StoreShape) => T): T {
	return fn(load());
}

// ---- domain helpers ----------------------------------------------------

export function sessionIdFor(conversationId: string, generation: number): string {
	const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
	return `us-${safe}-g${generation}`;
}

export function getPair(conversationId: string): Pair | undefined {
	return read((s) => s.pairs[conversationId]);
}

export function getMemory(conversationId: string): MemoryRecord {
	return read((s) => s.memory[conversationId]) ?? {
		sessionId: sessionIdFor(conversationId, 0),
		generation: 0,
		status: 'not configured'
	};
}

export function jobByDeliveryMessage(conversationId: string, messageId: string): JobRecord | undefined {
	return read((s) =>
		Object.values(s.jobs).find(
			(r) => r.job.conversationId === conversationId && r.job.deliveryMessageId === messageId
		)
	);
}

export function listJobs(conversationId?: string): Job[] {
	return read((s) =>
		Object.values(s.jobs)
			.filter((r) => !conversationId || r.job.conversationId === conversationId)
			.sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt))
			.map((r) => publicJob(r))
	);
}

/** Public job shape + non-secret warnings for the UI. */
export function publicJob(r: JobRecord): Job & { warnings?: string[] } {
	const job = { ...r.job };
	const warnings = r.internal.warnings;
	return warnings.length ? { ...job, warnings: [...warnings] } : job;
}

/** Merge new messages into history record; returns the not-yet-imported ones. */
export function newMessages(conversationId: string, messages: Message[]): Message[] {
	const seen = new Set<string>();
	return read((s) => {
		const rec = s.history[conversationId];
		return messages.filter((m) => {
			if (!m.id || seen.has(m.id) || rec?.ids[m.id]) return false;
			seen.add(m.id);
			return true;
		});
	});
}

/** Confirmation belongs to the Instagram identity and survives opening another pair. */
export function confirmedPhoto(participantId: string): PhotoRecord | undefined {
 return read(s => s.photos[participantId]);
}

export function recipientPhoto(pair:Pair):PhotoRecord|undefined {
 const local=read(s=>s.chatPhotos[pair.conversationId]);
 return local?.participantId===pair.recipient.id?local:confirmedPhoto(pair.recipient.id);
}
