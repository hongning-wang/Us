import type { Reference, Job } from '../../../packages/shared/src/types';
import { conversationId, detectPair, directVideoUrl, messageArticles, stableMedia } from './instagram';

/**
 * Reference capture and resolution for the native reply flow. None of these open,
 * click, or navigate media. Wiring (content script owns all events):
 * 1. When the user starts a native reply, call captureReplyReference(clickTarget, pair.sender).
 *    undefined means text/photo — never a scene reference. Drop the capture on Cancel reply,
 *    conversation change, or any ordinary send; a fresh /us without a capture passes no reference.
 * 2. When /us is submitted inside an active reply, call resolveReference(captured)
 *    (or the legacy resolveVisibleReference(article, pair.sender)). It throws a
 *    user-facing Error for unplayed or ambiguous sources — show it inline, create no job.
 * 3. Own sent Us videos resolve to a url-less Reference that preserves messageId using the
 *    same identity scheme as bridge attachmentKeys (stableMedia(poster), '#occurrence=N'
 *    for repeats among the sender's video articles), so the bridge maps it to the persisted
 *    output and storyId. Pass pair.sender wherever possible; otherwise detectPair() is used.
 * 4. For the Reel share sheet, call activeReelReference() while the dialog is open; it
 *    identifies the selected Reel from the location shortcode. Reels play through blob:
 *    MediaSource URLs, so the mp4 comes from the reel page itself (same-origin read) only. Unassociated resource entries cannot identify the selected video.
 */
export type ResourceEntryLike = { name: string; startTime: number };
export type VideoTrack = { url: string; assetId: string; duration?: number; start: number; firstSeen: number };
export type CapturedReference = { reference: Reference; article: HTMLElement; sender?: { username: string }; conversationId?: string; capturedAt: number };

const nowMs = () => (typeof performance === 'undefined' ? 0 : performance.now());
const perfEntries = (): ResourceEntryLike[] => (typeof performance === 'undefined' || !performance.getEntriesByType ? [] : (performance.getEntriesByType('resource') as ResourceEntryLike[]));

function trackMeta(name: string): { audio: boolean; assetId?: string; duration?: number } {
 try {
  const efg = new URL(name).searchParams.get('efg'); if (!efg) return { audio: false };
  const meta = JSON.parse(atob(efg.replace(/-/g, '+').replace(/_/g, '/')));
  return { audio: /audio|heaac|opus/i.test(String(meta.vencode_tag || '')), assetId: meta.xpv_asset_id == null ? undefined : String(meta.xpv_asset_id), duration: typeof meta.duration_s === 'number' ? meta.duration_s : undefined };
 } catch { return { audio: false }; }
}

/** Distinct video (non-audio) assets whose first request came after `since`, newest first. Ambient loops that predate the window are excluded so they cannot be stolen as references. */
export function videoTracks(entries: ResourceEntryLike[], since = 0): VideoTrack[] {
 const assets = new Map<string, VideoTrack>();
 for (const e of entries) {
  const url = directVideoUrl(e.name); if (!url) continue;
  const meta = trackMeta(e.name); if (meta.audio) continue;
  const key = meta.assetId || url;
  const prior = assets.get(key);
  if (!prior) assets.set(key, { url, assetId: key, duration: meta.duration, start: e.startTime, firstSeen: e.startTime });
  else { prior.firstSeen = Math.min(prior.firstSeen, e.startTime); if (e.startTime >= prior.start) { prior.start = e.startTime; prior.url = url; prior.duration = meta.duration ?? prior.duration; } }
 }
 return [...assets.values()].filter(t => t.firstSeen >= since).sort((a, b) => b.start - a.start);
}

const articleAuthor = (article: Element) => article.closest('[role=group][tabindex="-1"]')?.querySelector('[aria-label^="Reply to message from"]')?.getAttribute('aria-label')?.replace('Reply to message from ', '');
const isVideoArticle = (article: Element) => Boolean(article.querySelector('video,img[src*=playButton]'));
const bigImage = (article: Element) => [...article.querySelectorAll<HTMLImageElement>('img')].find(i => i.src.startsWith('https:') && i.width >= 100);

/** Same identity scheme as bridge attachmentKeys: stableMedia(poster), with '#occurrence=N' distinguishing repeated identical thumbnails among the sender's video articles. */
export function ownVideoMessageId(article: HTMLElement, sender: { username: string }): string | undefined {
 const counts = new Map<string, number>();
 for (const candidate of messageArticles()) {
  const author = articleAuthor(candidate);
  if (author !== sender.username && !/^(you|yourself)$/i.test(author || '')) continue;
  if (!isVideoArticle(candidate)) continue;
  const image = bigImage(candidate); const video = candidate.querySelector<HTMLVideoElement>('video');
  const key = image ? stableMedia(image.src) : video?.currentSrc && !video.currentSrc.startsWith('blob:') ? stableMedia(video.currentSrc) : undefined;
  if (!key) { if (candidate === article) return; continue; }
  const n = (counts.get(key) || 0) + 1; counts.set(key, n);
  if (candidate === article) return n > 1 ? `${key}#occurrence=${n}` : key;
 }
}

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function mediaIdFromShortcode(code: string): string | undefined {
 if (!/^[A-Za-z0-9_-]{5,16}$/.test(code)) return;
 let id = 0n;
 for (const char of code) id = id * 64n + BigInt(SHORTCODE_ALPHABET.indexOf(char));
 return id.toString();
}
export function shortcodeFromPoster(url: string): string | undefined {
 try {
  const key = new URL(url).searchParams.get('ig_cache_key')?.split('.')[0];
  if (!key) return;
  const id = atob(key); if (!/^\d{6,30}$/.test(id)) return;
  let n = BigInt(id), code = '';
  while (n) { code = SHORTCODE_ALPHABET[Number(n % 64n)] + code; n /= 64n; }
  return code || undefined;
 } catch { return; }
}
/** An exact media-id match is required, even if Instagram includes other items. */
export function videoUrlFromMediaInfo(data: unknown, id: string): string | undefined {
 const items = (data as {items?: Array<{id?:string;pk?:string;video_duration?:number;video_versions?:Array<{url?:string;width?:number;height?:number}>}>})?.items;
 if (!Array.isArray(items)) return;
 const item = items.find(i => String(i.pk ?? i.id?.split('_')[0]) === id);
 if (!item) return;
 if (typeof item.video_duration !== 'number' || item.video_duration < 2 || item.video_duration > 30) throw Error('Choose a video between 2 and 30 seconds for Make this us.');
 const version = item.video_versions?.find(v => v.url && directVideoUrl(v.url) && v.width && v.height && Math.min(v.width,v.height)>=300 && Math.max(v.width,v.height)<=6000 && v.width*v.height>=409600 && v.width*v.height<=8295044);
 if (!version?.url) throw Error('This video’s size is not supported. Try another Reel.');
 return directVideoUrl(version.url);
}

export function referenceFor(article: HTMLElement, sender?: { username: string }): Reference | undefined {
 const video = article.querySelector<HTMLVideoElement>('video');
 const uploaded = article.querySelector('img[src*=playButton]');
 if (video || uploaded) {
  const poster = bigImage(article)?.src;
  const url = video?.currentSrc && !video.currentSrc.startsWith('blob:') ? video.currentSrc : undefined;
  const owner = sender || detectPair()?.sender;
  const messageId = owner ? ownVideoMessageId(article, owner) : poster ? stableMedia(poster) : undefined;
  return { kind: 'video', mediaId: messageId || (poster ? stableMedia(poster) : url ? stableMedia(url) : 'video'), url, messageId };
 }
 const link = article.querySelector<HTMLAnchorElement>('a[href*="/reel/"]');
 if (link) return { kind: 'reel', mediaId: link.href.match(/\/reel\/([^/]+)/)?.[1] || link.href, url: link.href };
 if (article.querySelector('svg[aria-label="Clip"]')) {
  const poster = article.querySelector<HTMLImageElement>('img[width="200"]')?.src || bigImage(article)?.src;
  const code = poster && shortcodeFromPoster(poster);
  return {kind:'reel',mediaId:code || stableMedia(poster || article.textContent?.trim() || 'reel'),url:code ? `https://www.instagram.com/reel/${code}/` : undefined};
 }
}

/** Capture at native Reply time. Never clicks or opens media; text/photo replies yield undefined. */
export function captureReplyReference(target: HTMLElement, sender?: { username: string }): CapturedReference | undefined {
 const article = target.closest<HTMLElement>('[role=article]') || target.closest('[role=group][tabindex="-1"]')?.querySelector<HTMLElement>('[role=article]') || undefined;
 if (!article) return;
 const owner = sender || detectPair()?.sender;
 const reference = referenceFor(article, owner);
 if (!reference) return;
 return { reference, article, sender: owner, conversationId: conversationId(), capturedAt: nowMs() };
}

export function resolveArticleVideo(article: HTMLElement, entries?: ResourceEntryLike[]): { url?: string; state: 'direct' | 'tracked' | 'unplayed' | 'gone' | 'ambiguous' } {
 const video = article.querySelector<HTMLVideoElement>('video');
 if (!video) return { state: 'unplayed' };
 if (video.currentSrc && !video.currentSrc.startsWith('blob:')) return { url: directVideoUrl(video.currentSrc) || video.currentSrc, state: 'direct' };
 // Resource timing entries belong to the whole page, not this article. Even a
 // single duration-matched asset can be an unrelated video, so never guess.
 return { state: 'gone' };
}

/** Extract a downloadable mp4 from a reel page's server-rendered payload. */
export function parseReelVideoUrl(html: string): string | undefined {
 const json = html.match(/"video_versions"\s*:\s*\[\s*\{[^{}]*?"url"\s*:\s*"([^"]+)"/)?.[1];
 const meta = json ? undefined : html.match(/property="og:video(?::secure_url)?" content="([^"]+)"/)?.[1];
 if (!json && !meta) return;
 try {
  const url = json ? (JSON.parse(`"${json}"`) as string) : meta!.replace(/&amp;/g, '&');
  return directVideoUrl(url) || (url.startsWith('https://') ? url : undefined);
 } catch { return; }
}

/** Read only the selected media, using the web app id already supplied by Instagram. */
export async function fetchReelVideoUrl(shortcode: string): Promise<string | undefined> {
 const id = mediaIdFromShortcode(shortcode); if (!id) return;
 const appPattern = /"APP_ID"\s*:\s*"(\d+)"/;
 let appId = [...document.scripts].map(s => s.textContent?.match(appPattern)?.[1]).find(Boolean);
 if (!appId) {
  const page = await fetch(`https://www.instagram.com/reel/${encodeURIComponent(shortcode)}/`, {credentials:'include',signal:AbortSignal.timeout(15000)});
  if (!page.ok) return;
  appId = (await page.text()).match(appPattern)?.[1];
 }
 if (!appId) return;
 const response = await fetch(`https://www.instagram.com/api/v1/media/${id}/info/`, {credentials:'include',headers:{'X-IG-App-ID':appId},signal:AbortSignal.timeout(15000)});
 if (!response.ok) return;
 return videoUrlFromMediaInfo(await response.json(),id);
}

const reelShortcode = (reference: Reference) => reference.url?.match(/\/reel\/([^/?]+)/)?.[1] || (/^[A-Za-z0-9_-]{5,}$/.test(reference.mediaId) && !reference.mediaId.includes('/') ? reference.mediaId : undefined);

/** Resolve at /us submission. Throws user-facing errors instead of guessing at ambiguous media. */
export async function resolveReference(captured: CapturedReference, options: { entries?: ResourceEntryLike[]; fetchReel?: (shortcode: string) => Promise<string | undefined> } = {}): Promise<Reference> {
 const { article, sender } = captured;
 if (captured.conversationId && conversationId() !== captured.conversationId) throw Error('This reply is from a different chat. Reply to the video again.');
 const reference = { ...captured.reference };
 if (reference.kind === 'video') {
  if (article.isConnected && sender) { const fresh = ownVideoMessageId(article, sender); if (fresh) reference.messageId = fresh; }
  if (reference.url && directVideoUrl(reference.url)) return reference;
  if (!article.isConnected) {
   if (reference.messageId) return reference;
   throw Error('That video scrolled away. Reply to it again.');
  }
  const { url, state } = resolveArticleVideo(article, options.entries);
  if (url) return { ...reference, url };
  if (reference.messageId) return reference; // own sent Us video: the bridge reuses persisted output via deliveryMessageId
  throw Error(state === 'unplayed' ? 'Play this video in the chat once, then send /us again.' : state === 'gone' ? 'Replay this video, then send /us again.' : 'More than one video is active. Replay just this video, then send /us again.');
 }
 if (reference.url && directVideoUrl(reference.url)) return reference;
 const shortcode = reelShortcode(reference);
 if (shortcode) {
  const url = await (options.fetchReel || fetchReelVideoUrl)(shortcode);
  if (url) return { ...reference, mediaId: shortcode, url };
 }
 throw Error('This Reel’s video could not be read. Open its original Reel and try Make this us there.');
}

/** Legacy single-call form used by the content script: capture the article, then resolve. */
export async function resolveVisibleReference(article: HTMLElement, sender?: { username: string }): Promise<Reference> {
 const captured = captureReplyReference(article, sender);
 if (!captured) throw Error('This message is not a video or Reel.');
 return resolveReference(captured);
}

/** Resolve only the Reel identified by its permalink. Page-wide playback is not proof of selection. */
export async function activeReelReference(options: { entries?: ResourceEntryLike[]; now?: number; windowMs?: number; fetchReel?: (shortcode: string) => Promise<string | undefined> } = {}): Promise<Reference> {
 const code = location.pathname.match(/\/(?:reels?|p)\/([^/?]+)/)?.[1];
 if (!code) throw Error('Open this Reel on its own, then try Make this us.');
 const url = await (options.fetchReel || fetchReelVideoUrl)(code);
 if (url) return { kind: 'reel', mediaId: code, url };
 throw Error('This Reel’s video could not be read. Try another Reel.');
}

/** Follow continuations back to the original Reel, never to the expiring CDN URL. */
export function originalReelUrl(job:Job,jobs:Job[]):string|undefined {
 const seen=new Set<string>();let current:Job|undefined=job;
 while(current&&!seen.has(current.id)){
  seen.add(current.id);
  const reference:Reference|undefined=current.reference;
  if(reference?.kind==='reel'&&/^[A-Za-z0-9_-]{5,16}$/.test(reference.mediaId))return 'https://www.instagram.com/reel/'+reference.mediaId+'/';
  const parent:string|undefined=current.parentId||reference?.parentJobId;
  current=parent?jobs.find(j=>j.id===parent):undefined;
 }
}
