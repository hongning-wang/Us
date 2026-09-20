import { env, hasSeedance } from './env';

/**
 * Seedance provider adapter for the Seeddance API
 * (POST /v1/videos/generations, GET /v1/tasks/{id}).
 * Endpoint and model are env-configurable; nothing is invented or substituted.
 */

export class ProviderError extends Error {
	code?: string;
	httpStatus?: number;
	constructor(message: string, code?: string, httpStatus?: number) {
		super(message);
		this.name = 'ProviderError';
		this.code = code;
		this.httpStatus = httpStatus;
	}
}

export interface CreateTaskInput {
	prompt: string;
	imageUrls?: string[];
	videoUrls?: string[];
	duration?: number;
	quality?: '480p' | '720p' | '1080p';
	aspectRatio?: string;
	generateAudio?: boolean;
	referenceMode?: boolean;
}

export interface TaskStatus {
	status: 'pending' | 'processing' | 'completed' | 'failed' | string;
	videoUrl?: string;
	error?: string;
}

export class SeedanceProvider {
	private base: string;
	private key: string;
	readonly model: string;

	constructor(cfg = env.seedance) {
		if (!cfg.apiKey) throw new ProviderError('SEEDANCE_API_KEY is not configured.', 'not_configured');
		this.base = cfg.baseUrl;
		this.key = cfg.apiKey;
		this.model = cfg.model;
	}

	static available(): boolean {
		return hasSeedance();
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
			throw new ProviderError(`Provider unreachable: ${(e as Error).message}`, 'network');
		}
		const text = await res.text();
		let parsed: Record<string, unknown> = {};
		try {
			parsed = text ? JSON.parse(text) : {};
		} catch {
			throw new ProviderError(`Provider returned non-JSON (${res.status})`, 'bad_response');
		}
		const err = parsed.error as { code?: string; message?: string } | undefined;
		if (!res.ok || (err && !parsed.status)) {
			throw new ProviderError(err?.message ?? `Provider HTTP ${res.status}`, err?.code ?? `http_${res.status}`, res.status);
		}
		return parsed as T;
	}

	async createTask(input: CreateTaskInput): Promise<string> {
        // The live 2.5 API currently treats one/two images as frames even with
        // reference_mode=true. Three references select its documented reference
        // workflow; repeat the same confirmed identity, never invent another.
        const padReferences = this.model === 'seedance-2.5' && input.referenceMode && input.imageUrls?.length && input.imageUrls.length < 3;
        const imageUrls = padReferences ? [...input.imageUrls!, ...Array(3-input.imageUrls!.length).fill(input.imageUrls![0])] : input.imageUrls;
		const res = await this.req<{ task_id?: string }>('POST', '/v1/videos/generations', {
			model: this.model,
			prompt: input.prompt,
			...(input.duration ? { duration: input.duration } : {}),
			...(input.quality ? { quality: input.quality } : {}),
			...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
			...(input.generateAudio !== undefined ? { generate_audio: input.generateAudio } : {}),
			...(imageUrls?.length ? { image_urls: imageUrls } : {}),
			...(input.videoUrls?.length ? { video_urls: input.videoUrls } : {}),
			...(input.referenceMode && !padReferences ? { reference_mode: true } : {})
		});
		if (!res.task_id) throw new ProviderError('Provider did not return a task id.', 'bad_response');
		return res.task_id;
	}

	async getTask(taskId: string): Promise<TaskStatus> {
		const res = await this.req<{
			status?: string;
			output?: { video_url?: string } | null;
			error?: { message?: string } | string | null;
		}>('GET', `/v1/tasks/${encodeURIComponent(taskId)}`);
		return {
			status: res.status ?? 'unknown',
			videoUrl: res.output?.video_url,
			error: typeof res.error === 'string' ? res.error : res.error?.message
		};
	}
}

/** Download result bytes for durable database storage. */
export async function downloadMedia(url: string): Promise<Buffer> {
	const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
	if (!res.ok || !res.body) throw new ProviderError(`Could not download result video (${res.status})`, 'download');
	return Buffer.from(await res.arrayBuffer());
}
