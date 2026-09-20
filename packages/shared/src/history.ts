import type {Message} from './types';
export const HISTORY_LIMIT=500;
/** Three calendar months, clamping month-end dates (May 31 -> February 28). */
export function historyCutoff(now=new Date()):number {
 const cutoff=new Date(now);const day=cutoff.getUTCDate();
 cutoff.setUTCDate(1);cutoff.setUTCMonth(cutoff.getUTCMonth()-3);
 const lastDay=new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()+1,0)).getUTCDate();
 cutoff.setUTCDate(Math.min(day,lastDay));cutoff.setUTCHours(0,0,0,0);return cutoff.getTime();
}
export function historyTime(m:Pick<Message,'timestamp'>):number {
 return m.timestamp?Date.parse(m.timestamp):NaN;
}
export function inHistoryWindow(m:Pick<Message,'timestamp'>,cutoff=historyCutoff(),now=Date.now()):boolean {
 const time=historyTime(m);return Number.isFinite(time)&&time>=cutoff&&time<=now;
}
export function isHistoryVideo(m:Pick<Message,'text'|'mediaUrl'|'mediaKind'>):boolean {
 return m.mediaKind==='reel'||m.mediaKind==='video'||Boolean(m.mediaUrl&&(/instagram\.com\/reels?\//i.test(m.mediaUrl)||/\.mp4(?:[?#]|$)/i.test(m.mediaUrl)))||/^\s*(?:\[reel\]|https?:\/\/(?:www\.)?instagram\.com\/reels?\/\S+)\s*$/i.test(m.text);
}
