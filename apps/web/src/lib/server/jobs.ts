import { randomUUID } from 'node:crypto';
import type { CreateJob, Job } from '@us/shared/types';
import { CodexError, generateSpec, type SpecInput } from './codex';
import { env } from './env';
import { validateMedia } from './validate-media';
import { Honcho, memoryContext, noteImagined } from './honcho';
import { ensureFallbackMedia, FALLBACK_FILENAME, mediaInfo, putMedia, publicMediaUrl, videoFilename } from './media';
import { downloadMedia, ProviderError, SeedanceProvider, type CreateTaskInput, type TaskStatus } from './seedance';
import {
	recipientPhoto,
	confirmedPhoto,
	getMemory,
	getPair,
	jobByDeliveryMessage,
	mutate,
	publicJob,
	read,
	type GenerationSpec,
	type JobRecord,
	type JobStage
} from './store';

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** Injectable seams so tests can drive the pipeline without network/codex. */
export interface JobDeps {
	getMemory: (conversationId: string) => Promise<string>;
 validateMedia: (input:Pick<CreateTaskInput,'imageUrls'|'videoUrls'>)=>Promise<void>;
	genSpec: (input: SpecInput) => Promise<GenerationSpec>;
	createTask: (input: CreateTaskInput) => Promise<string>;
	getTask: (taskId: string) => Promise<TaskStatus>;
	download: (url: string) => Promise<Buffer>;
	noteImagined: (conversationId: string, authorId: string, text: string) => Promise<void>;
	pollIntervalMs: number;
	timeoutMs: number;
}

function realDeps(): JobDeps {
	return {
  validateMedia,
		async getMemory(conversationId) {
			if (!Honcho.available()) throw new Error('Shared memory is not connected.');
			const pair = getPair(conversationId);
			if (!pair) throw new Error('Set up this chat first.');
			const mem = getMemory(conversationId);
            if (!read(s=>s.history[conversationId]?.count)) return '';
			return memoryContext(new Honcho(), mem.sessionId, pair);
		},
		genSpec: (input) => generateSpec(input),
		createTask: (input) => new SeedanceProvider().createTask(input),
		getTask: (taskId) => new SeedanceProvider().getTask(taskId),
		download: downloadMedia,
		async noteImagined(conversationId, authorId, text) {
			if (!Honcho.available()) return;
			const mem = getMemory(conversationId);
			await noteImagined(new Honcho(), mem.sessionId, authorId, text);
		},
		pollIntervalMs: env.seedance.pollIntervalMs,
		timeoutMs: env.generationTimeoutMs
	};
}

let deps: JobDeps = realDeps();

/** Tests swap in fakes; production routes never call this. */
export function setJobDeps(overrides: Partial<JobDeps>): void {
	deps = { ...deps, ...overrides };
}

const running = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- creation -----------------------------------------------------------

function resolveStory(conversationId: string, ref: CreateJob['reference']): { storyId: string; parentId?: string } {
	if (ref?.parentJobId) {
		const parent = read((s) => s.jobs[ref.parentJobId!]);
		if (parent && parent.job.conversationId === conversationId) {
			return { storyId: parent.job.storyId, parentId: parent.job.id };
		}
	}
	if (ref?.messageId) {
		const parent = jobByDeliveryMessage(conversationId, ref.messageId);
		if (parent) return { storyId: parent.job.storyId, parentId: parent.job.id };
	}
	return { storyId: randomUUID() };
}

export async function createJob(input: CreateJob): Promise<Job> {
	const pair = getPair(input.conversationId);
    if(!pair || pair.sender.id!==input.sender.id || pair.recipient.id!==input.recipient.id) throw new ApiError(409,'The conversation participants do not match this request.');
    if(!confirmedPhoto(pair.sender.id)) throw new ApiError(409,'Confirm your photo once before creating a video.');
    const key = `${input.conversationId}:${input.idempotencyKey}`;
	const existing = read((s) => s.idempotency[key]);
	if (existing) {
		const rec = read((s) => s.jobs[existing]);
		if (rec) return publicJob(rec);
	}

	const {record,created} = await mutate((s) => {
		// Re-check inside the serialized mutation: concurrent creates with the
		// same key must not double-generate.
		const dup = s.idempotency[key];
		if (dup && s.jobs[dup]) return {record:s.jobs[dup],created:false};

		const { storyId, parentId } = resolveStory(input.conversationId, input.reference);
		const job: Job = {
			id: randomUUID(),
			conversationId: input.conversationId,
			sender: input.sender,
			recipient: input.recipient,
			instruction: input.instruction,
			reference: input.reference,
			storyId,
			parentId,
			status: 'generating',
			phase: 'spec',
			createdAt: new Date().toISOString()
		};
		const rec: JobRecord = {
			job,
			internal: { idempotencyKey: input.idempotencyKey, stage: 'spec', attempts: 1, warnings: [] }
		};
		s.jobs[job.id] = rec;
		s.idempotency[key] = job.id;
		return {record:rec,created:true};
	});

 if(!created)return publicJob(record);
	void runJob(record.job.id);
	deps
		.noteImagined(input.conversationId, input.sender.id, `${input.sender.name} asked Us to imagine: "${input.instruction}"`)
		.catch(() => {});
	return publicJob(record);
}

// ---- pipeline -----------------------------------------------------------

async function failJob(id: string, stage: JobStage, message: string): Promise<void> {
	await mutate((s) => {
		const rec = s.jobs[id];
		if (!rec) return;
		rec.job.status = 'failed';
		rec.job.error = message;
		rec.job.fallbackUrl = `/api/media/${FALLBACK_FILENAME}`;
		rec.internal.stage = stage;
		rec.internal.deadline = undefined;
	});
}

async function mediaInputs(rec: JobRecord): Promise<Pick<CreateTaskInput, 'imageUrls' | 'videoUrls' | 'referenceMode'>> {
 const {job}=rec;
 const photo=confirmedPhoto(job.sender.id);
 if(!photo)throw new Error('Confirm your photo before creating a video.');
 if(!(await mediaInfo(photo.filename)))throw new Error('Your saved photo is missing. Replace it in Us settings.');
 const photoUrl=publicMediaUrl(photo.filename);
 if(!photoUrl||!photoUrl.startsWith('https://'))throw new Error('Photo sharing is not connected. Finish the demo media setup.');
 const videoUrls:string[]=[];
 if(job.reference){
  let url=job.reference.url;
  if(url?.startsWith('/api/media/'))url=publicMediaUrl(url.slice('/api/media/'.length))||undefined;
  if(!url || !/^https:\/\//.test(url) || /instagram\.com\/(reels?|p)\//.test(url))throw new Error('The selected video wasn’t attached. Select the video again.');
  videoUrls.push(url);
 }
 const friend=recipientPhoto(job);
 if(friend&&!(await mediaInfo(friend.filename)))throw new Error('The saved friend photo is missing. Replace it in Us settings.');
 const friendUrl=friend?publicMediaUrl(friend.filename):undefined;
 if(friend&&(!friendUrl||!friendUrl.startsWith('https://')))throw new Error('Friend photo sharing is not connected.');
 return {imageUrls:[photoUrl,...(friendUrl?[friendUrl]:[])],videoUrls,referenceMode:true};
}

export async function runJob(id: string): Promise<void> {
	if (running.has(id)) return;
	running.add(id);
 const jobDeps = deps;
	try {
		while (true) {
			const rec = read((s) => s.jobs[id]);
			if (!rec || rec.internal.abandoned || rec.job.status !== 'generating') return;

			// --- stage: spec ---------------------------------------------------
			if (!rec.internal.spec) {
				try {
					await jobDeps.validateMedia(await mediaInputs(rec)); // Check references before spending any LLM or generation tokens.
				} catch (e) {
					await failJob(id, 'spec', (e as Error).message);
					return;
				}
				try {
                    const memory = rec.job.reference ? '' : await jobDeps.getMemory(rec.job.conversationId);
					const photo = confirmedPhoto(rec.job.sender.id);
					const spec = await jobDeps.genSpec({
						instruction: rec.job.instruction,
						senderName: rec.job.sender.name,
						recipientName: rec.job.recipient.name,
						memory,
						hasReferenceVideo: Boolean(rec.job.reference),
						hasConfirmedPhoto: Boolean(photo),
      hasRecipientPhoto: Boolean(recipientPhoto(rec.job)),
						referenceKind: rec.job.reference?.kind
					});
					await mutate((s) => {
						const r = s.jobs[id];
						if (!r) return;
						r.internal.spec = {...spec,duration:5,quality:'480p',useIdentityPhotos:true,useReferenceVideo:Boolean(r.job.reference)};
						r.internal.memoryUsed = Boolean(memory);
						r.job.sceneSummary = spec.sceneSummary;
						r.job.phase = 'generate';
					});
				} catch (e) {
					const hint = e instanceof CodexError ? e.message : `Spec generation failed: ${(e as Error).message}`;
					await failJob(id, 'spec', hint);
					return;
				}
				continue;
			}

			// --- stage: generate -------------------------------------------------
			try {
				await mutate((s) => {
					const r = s.jobs[id];
					if (r) r.internal.stage = 'generate';
				});
				if (!rec.internal.providerTaskId) {
					if(rec.internal.submissionUncertain)throw new Error('The previous generation request has an unknown outcome. Check the provider task before retrying.');
                    const media = await mediaInputs(rec);
                    await jobDeps.validateMedia(media);
                    await mutate(s=>{s.jobs[id].internal.submissionUncertain=true;});
					const taskId = await jobDeps.createTask({
						prompt: rec.internal.spec.scenePrompt,
						duration: rec.internal.spec.duration,
						quality: rec.internal.spec.quality,
						aspectRatio: rec.internal.spec.aspectRatio,
						generateAudio: rec.internal.spec.generateAudio,
						...media
					});
					await mutate((s) => {
						const r = s.jobs[id];
						if (!r) return;
						r.internal.provider = 'seedance';
						r.internal.providerTaskId = taskId;
                        r.internal.submissionUncertain=false;
						r.internal.deadline = Date.now() + jobDeps.timeoutMs;
						r.internal.warnings = [...new Set(r.internal.warnings)];
					});
				}

				// Poll until terminal / timeout / abandoned.
				let pollFailures = 0;
				while (true) {
					const cur = read((s) => s.jobs[id]);
					if (!cur || cur.internal.abandoned || cur.job.status !== 'generating') return;
					if (cur.internal.deadline && Date.now() > cur.internal.deadline) {
						await failJob(id, 'generate', `Generation timed out after ${Math.round(jobDeps.timeoutMs / 1000)}s. Retry or use the prerecorded demo.`);
						return;
					}
					let st: TaskStatus;
					try {
						st = await jobDeps.getTask(cur.internal.providerTaskId!);
						pollFailures = 0;
					} catch (e) {
						// A throttled status read does not mean the video failed.
						// Back off and keep checking the same task; never resubmit it.
						if (!(e instanceof ProviderError) || !(e.httpStatus === 429 || (e.httpStatus ?? 0) >= 500 || /^(network|rate_limit_exceeded|http_429)$/.test(e.code || ''))) throw e;
						const delay = Math.min(60_000, jobDeps.pollIntervalMs * 2 ** Math.min(++pollFailures, 6));
						await sleep(Math.min(delay, Math.max(1, (cur.internal.deadline ?? Date.now() + delay) - Date.now())));
						continue;
					}
					await mutate((s) => {
						const r = s.jobs[id];
						if (r) r.internal.providerStatus = st.status;
					});
					if (st.status === 'completed' && st.videoUrl) {
						const filename = videoFilename(id);
						await putMedia(filename,await jobDeps.download(st.videoUrl),'video/mp4');
						const summary = rec.internal.spec?.sceneSummary;
						await mutate((s) => {
							const r = s.jobs[id];
							if (!r) return;
							r.job.status = 'ready';
							r.job.outputUrl = `/api/media/${filename}`;
							r.job.phase = 'deliver';
							r.internal.stage = 'deliver';
							r.internal.deadline = undefined;
						});
						if (summary) {
							jobDeps.noteImagined(rec.job.conversationId, rec.job.sender.id, `Us request: ${rec.job.instruction}\nUs imagined: ${summary}`).catch(() => {});
						}
						return;
					}
					if (st.status === 'failed') {
						await failJob(id, 'generate', `Generation failed: ${st.error ?? 'provider reported failure'}`);
						return;
					}
					await sleep(jobDeps.pollIntervalMs);
				}
			} catch (e) {
				if(e instanceof ProviderError && ((e.httpStatus !== undefined && e.httpStatus >= 400 && e.httpStatus < 500 && e.httpStatus !== 408) || /^(invalid_|insufficient_credits|plan_upgrade_required|rate_limit_exceeded)$/.test(e.code||'')))await mutate(s=>{s.jobs[id].internal.submissionUncertain=false;});
                await failJob(id, 'generate', (e as Error).message);
				return;
			}
		}
	} finally {
		running.delete(id);
	}
}

// ---- lifecycle ----------------------------------------------------------

export function getJob(id: string): Job {
	const rec = read((s) => s.jobs[id]);
	if (!rec) throw new ApiError(404, 'Job not found.');
	return publicJob(rec);
}

export async function retryJob(id: string): Promise<Job> {
	const rec = await mutate((s) => {
		const r = s.jobs[id];
		if (!r) throw new ApiError(404, 'Job not found.');
		if (r.job.status !== 'failed') throw new ApiError(409, `Cannot retry a job that is ${r.job.status}.`);

		if(r.internal.submissionUncertain&&!r.internal.providerTaskId)throw new ApiError(409,'Check the provider task first; retrying could generate a duplicate.');
        if(r.internal.deliveryUncertain)throw new ApiError(409,'Check the existing Instagram upload before retrying.');
		if (r.internal.stage === 'deliver') {
			// Delivery failed — the video itself is fine; let the user press Send again.
			r.job.status = 'ready';
			r.job.error = undefined;
			r.job.phase = 'deliver';
			return r;
		}

		r.internal.attempts += 1;
		r.job.status = 'generating';
		r.job.error = undefined;
		r.job.phase = r.internal.spec ? 'generate' : 'spec';
		// Resume the same provider task unless it already failed — no duplicate generation.
		if (r.internal.providerStatus === 'failed') r.internal.providerTaskId = undefined;
		r.internal.deadline = Date.now() + deps.timeoutMs;
		return r;
	});
	void runJob(id);
	return publicJob(rec);
}

export async function useFallback(id: string): Promise<Job> {
	await ensureFallbackMedia();
	const rec = await mutate((s) => {
		const r = s.jobs[id];
		if (!r) throw new ApiError(404, 'Job not found.');
		const timedOut = r.job.status === 'generating' && r.internal.deadline !== undefined && Date.now() > r.internal.deadline;
		if(r.internal.deliveryUncertain)throw new ApiError(409,'Check the existing upload before replacing this video.');
		if (r.job.status !== 'failed' && !timedOut) {
			throw new ApiError(409, 'Fallback is only available after a failure or timeout.');
		}
		r.internal.abandoned = true; // any in-flight poll loop bails out
		r.job.status = 'ready';
		r.job.phase = 'deliver';
		r.job.error = undefined;
		r.job.isFallback = true;
		r.job.outputUrl = `/api/media/${FALLBACK_FILENAME}`;
		r.job.fallbackUrl = `/api/media/${FALLBACK_FILENAME}`;
		return r;
	});
	return publicJob(rec);
}

export async function setDelivery(id: string, body: { status: 'sending' | 'sent' | 'failed'; messageId?: string; error?: string; safeToRetry?: boolean }): Promise<Job> {
	const rec = await mutate((s) => {
		const r = s.jobs[id];
		if (!r) throw new ApiError(404, 'Job not found.');
		if(r.job.status==='sent'&&body.status==='sent'&&r.job.deliveryMessageId===body.messageId)return r;
		if (body.status === 'sending') {
			if (r.job.status !== 'ready') throw new ApiError(409, `Cannot send a job that is ${r.job.status}.`);
			r.job.status = 'sending';
            r.internal.deliveryUncertain=true;
			r.job.phase = 'deliver';
		} else if (body.status === 'sent') {
			if (r.job.status !== 'sending' && !(r.job.status==='failed'&&r.internal.deliveryUncertain)) {
				throw new ApiError(409, `Cannot mark a ${r.job.status} job as sent.`);
			}
			if(!body.messageId)throw new ApiError(400,'A persisted Instagram attachment is required.');
            r.job.status = 'sent';
            r.internal.deliveryUncertain=false;
			r.job.phase = 'done';
			r.internal.stage = 'done';
			if (body.messageId) r.job.deliveryMessageId = body.messageId;
		} else {
			if(r.job.status==='sent')throw new ApiError(409,'This video is already sent.');
            r.internal.deliveryUncertain = body.safeToRetry!==true;
            r.job.status = 'failed';
			r.job.error = `Delivery failed: ${body.error ?? 'unknown error'}`;
			r.internal.stage = 'deliver';
			r.internal.deadline = undefined;
		}
		return r;
	});
	return publicJob(rec);
}

/** Call once at server start: resume unfinished generation, unstick deliveries. */
export async function resumeJobs(): Promise<void> {
	const stale = read((s) => Object.values(s.jobs).filter((r) => r.job.status === 'generating' || r.job.status === 'sending'));
	for (const rec of stale) {
		if (rec.job.status === 'sending') {
			await mutate((s) => {
				const r = s.jobs[rec.job.id];
				if (!r) return;
				r.job.status = 'failed';
                r.internal.deliveryUncertain=true;
                r.job.error='Upload interrupted. Check the existing attachment in Instagram.';
				r.job.phase = 'deliver';
				if (!r.internal.warnings.includes('Delivery interrupted by a server restart — verify the existing attachment before retrying.')) {
					r.internal.warnings.push('Delivery interrupted by a server restart — verify the existing attachment before retrying.');
				}
			});
		} else {
			void runJob(rec.job.id);
		}
	}
}
