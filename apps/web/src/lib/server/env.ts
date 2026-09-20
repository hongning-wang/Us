import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenv } from 'dotenv';

/**
 * Loads the repo-root .env (HONCHO_API_KEY, SEEDANCE_API_KEY, ...) no matter
 * whether the process is started from the repo root or from apps/web.
 * Real environment variables always win; .env only fills gaps.
 * Never log or return secret values from this module.
 */
function findEnvFile(): { path: string; root: string } {
	const moduleDir = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// module-relative: apps/web/src/lib/server -> repo root
		resolve(moduleDir, '../../../../../.env'),
		// walk up from cwd (apps/web in dev, repo root in tests/build)
		...[process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), '../..'), resolve(process.cwd(), '../../..')].map(
			(d) => join(d, '.env')
		)
	];
	for (const path of candidates) {
		if (existsSync(path)) return { path, root: dirname(path) };
	}
	return { path: join(process.cwd(), '.env'), root: process.cwd() };
}

const found = findEnvFile();
dotenv({ path: found.path, override: false, quiet: true });

export const REPO_ROOT = found.root;

function str(name: string, fallback = ''): string {
	const v = process.env[name];
	return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
	const v = Number(process.env[name]);
	return Number.isFinite(v) && v > 0 ? v : fallback;
}

function abs(path: string, base: string): string {
	return isAbsolute(path) ? path : resolve(base, path);
}

export const env = {
 databaseUrl: str('DATABASE_URL'),
	/** Directory for the durable store + media. Defaults to <repo>/data. */
	/** Optional public base URL that tunnels to this server (e.g. cloudflared/ngrok -> http://127.0.0.1:5173). Required to attach local media to provider requests. */
	publicMediaBase: str('PUBLIC_MEDIA_BASE').replace(/\/+$/, ''),
	/** Extra comma-separated allowed CORS origins. */
	extraOrigins: str('US_ALLOWED_ORIGINS')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean),

	honcho: {
		apiKey: str('HONCHO_API_KEY'),
		baseUrl: str('HONCHO_BASE_URL', 'https://api.honcho.dev').replace(/\/+$/, ''),
		workspace: str('HONCHO_WORKSPACE', 'us-demo')
	},

	seedance: {
		apiKey: str('SEEDANCE_API_KEY'),
		baseUrl: str('SEEDANCE_API_BASE', 'https://www.seeddance.io').replace(/\/+$/, ''),
		model: str('SEEDANCE_MODEL', 'seedance-2.5'),
		pollIntervalMs: int('SEEDANCE_POLL_INTERVAL_MS', 5_000)
	},

	/** Max wall-clock time a job may stay in generation before it fails. */
	generationTimeoutMs: int('GENERATION_TIMEOUT_MS', 10 * 60_000),
	codexTimeoutMs: int('CODEX_TIMEOUT_MS', 180_000),
	codexModel: str('CODEX_MODEL'),
	/** Prerecorded fallback clip. Defaults to the checked-in fixture. */
	fallbackVideo: abs(str('FALLBACK_VIDEO', join(REPO_ROOT, 'apps/web/static/fixture.mp4')), REPO_ROOT)
};

export function hasHoncho(): boolean {
	return Boolean(env.honcho.apiKey);
}

export function hasSeedance(): boolean {
	return Boolean(env.seedance.apiKey);
}
