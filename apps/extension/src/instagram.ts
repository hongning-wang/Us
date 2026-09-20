import {HISTORY_LIMIT,historyCutoff,historyTime,inHistoryWindow,isHistoryVideo} from '../../../packages/shared/src/history';
import {messageDates} from './history-dates';
import type { Pair, Message } from '../../../packages/shared/src/types';
export { activeReelReference, captureReplyReference, fetchReelVideoUrl, ownVideoMessageId, parseReelVideoUrl, referenceFor, resolveArticleVideo, resolveReference, resolveVisibleReference, videoTracks } from './references';
export type { CapturedReference, ResourceEntryLike, VideoTrack } from './references';
export const conversationId = () => location.pathname.match(/^\/direct\/t\/([^/]+)/)?.[1];
export function detectPair(): Pair | undefined {
 const id=conversationId(); if(!id)return;
 const profile=document.querySelector<HTMLAnchorElement>('a[href] img[alt*="profile picture"]')?.closest('a') || [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find(a=>a.querySelector('svg[aria-label="Profile"]'));
 const senderUsername=profile?.getAttribute('href')?.split('/').filter(Boolean)[0];
 const main=document.querySelector('main,[role=main]') || document;
 const recipientLink=[...main.querySelectorAll<HTMLAnchorElement>('a[href]')].find(a=>!a.closest('[role=article]') && /^\/[\w.]+\/$/.test(a.getAttribute('href')||'') && a.innerText.trim().split('\n').length>=2);
 if(!senderUsername || !recipientLink)return;
 const recipientUsername=recipientLink.getAttribute('href')!.split('/').filter(Boolean)[0];
 if(!recipientUsername || recipientUsername===senderUsername)return;
 return {conversationId:id,sender:{id:senderUsername,username:senderUsername,name:senderUsername},recipient:{id:recipientUsername,username:recipientUsername,name:recipientLink.innerText.split('\n')[0] || recipientUsername}};
}
export const composer = () => document.querySelector<HTMLElement>('[contenteditable=true][role=textbox]');
export function messageArticles(){return [...document.querySelectorAll<HTMLElement>('[role=article][aria-roledescription=message]')];}
export function stableMedia(url:string){try {const u=new URL(url,"https://www.instagram.com");return u.searchParams.get('ig_cache_key')?.split('.')[0] || u.pathname;}catch{return url}}
export function readMessages(pair:Pair,includeVideos=false): Omit<Message,'id'|'order'>[] {
 const articles=messageArticles(),dates=messageDates(articles);
 return articles.flatMap(article=>{
  const group=article.closest('[role=group][tabindex="-1"]') || article.parentElement?.parentElement?.parentElement;
  const authorLabel=group?.querySelector('[aria-label^="Reply to message from"]')?.getAttribute('aria-label') || '';
  const author=authorLabel.replace('Reply to message from ','').trim();
  const authorId=author===pair.recipient.username?pair.recipient.id:/^(you|yourself)$/i.test(author)||author===pair.sender.username?pair.sender.id:undefined;
  if(!authorId)return [];
  const copy=article.cloneNode(true) as HTMLElement; copy.querySelectorAll('[data-us-action],time,svg,[aria-label^="Reply to message from"],[aria-label="Play"],[aria-label="Pause"]').forEach(e=>e.remove());
  const text=copy.innerText?.trim() || copy.textContent?.trim() || '';
  const links=[...article.querySelectorAll<HTMLAnchorElement>('a[href]')].map(a=>a.href).filter(href=>!/^https:\/\/www\.instagram\.com\/[\w.]+\/?$/.test(href));
  const video=article.querySelector<HTMLVideoElement>('video')?.currentSrc;
  const link=article.querySelector<HTMLAnchorElement>('a[href*="/reel/"],a[href*="/reels/"],a[href*="/p/"]')?.href;
  const poster=[...article.querySelectorAll<HTMLImageElement>('img')].find(i=>i.width>=100 && i.src.startsWith('https:'))?.src;
  const timestamp=dates.get(article);
  return [{authorId,text: [text,...links.filter(l=>!text.includes(l))].filter(Boolean).join('\n') || '[Shared media]',timestamp,mediaKind:(link&&/\/reels?\//.test(link))||article.querySelector('[aria-label="Clip"],[aria-label="Reel"]')?'reel' as const:article.querySelector('video,img[src*=playButton]')?'video' as const:undefined,mediaUrl:link || poster || (video&&!video.startsWith('blob:')?video:undefined),kind:'real' as const}].filter(m=>includeVideos||!isHistoryVideo(m));
 });
}
const fingerprint=(m:Omit<Message,'id'|'order'>)=>[m.authorId,m.text,m.timestamp||'',m.mediaUrl?stableMedia(m.mediaUrl):''].join('|');
// Align visible, virtualized windows with the cached ordered sequence. Occurrences remain separate.
export function mergeWindow(cached:Message[], incoming:Omit<Message,'id'|'order'>[],direction:'older'|'newer'='newer'):Message[]{
 if(!incoming.length)return cached;
 const a=cached.map(fingerprint),b=incoming.map(fingerprint);
 let best=0,ai=0,bi=0;
 for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){let n=0;while(i+n<a.length&&j+n<b.length&&a[i+n]===b[j+n])n++;if(n>best){best=n;ai=i;bi=j}}
 const make=(m:Omit<Message,'id'|'order'>):Message=>({...m,id:crypto.randomUUID(),order:0});
 let merged:Message[];
 if(!best) merged=direction==='older'?[...incoming.map(make),...cached]:[...cached,...incoming.map(make)];
 else {const before=bi>ai?incoming.slice(0,bi-ai).map(make):[];const after=bi+cached.length-ai<incoming.length?incoming.slice(bi+cached.length-ai).map(make):[];merged=[...before,...cached,...after];}
 return merged.map((m,order)=>({...m,order}));
}
export function scrollContainer():HTMLElement|undefined {
 let node:HTMLElement|null=messageArticles()[0] || null;
 while(node){if(/auto|scroll/.test(getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight+20)return node;node=node.parentElement;}
}
export async function collectHistory(pair:Pair,cached:Message[],save:(messages:Message[])=>Promise<void>,limit=HISTORY_LIMIT){
 limit=Math.max(1,Math.min(HISTORY_LIMIT,limit));
 const now=Date.now(),cutoff=historyCutoff(new Date(now));
 let messages=cached.filter(m=>!isHistoryVideo(m)&&inHistoryWindow(m,cutoff,now)).slice(-limit);let unchanged=0;let lastWindow='';let scroll=scrollContainer();const original=scroll?.scrollTop;
 let lastTop:number|undefined,lastHeight:number|undefined;
 let beginning=false;let first=true;let reachedCutoff=false;let missingDates=false;
 if(scroll){scroll.scrollTop=getComputedStyle(scroll).flexDirection==='column-reverse'?0:scroll.scrollHeight;await new Promise(r=>setTimeout(r,500));}
 try{while(true){
  if(conversationId()!==pair.conversationId)throw Error('Return to this chat to finish importing.');
  // Instagram suspends virtualized history rendering in background tabs.
  // Waiting there must not consume the loader's stall allowance.
  if(document.hidden){await new Promise(r=>setTimeout(r,800));continue;}
  if(!scroll?.isConnected)scroll=scrollContainer();
  const rawWindow=readMessages(pair,true);const visible=rawWindow.filter(m=>!isHistoryVideo(m)&&inHistoryWindow(m,cutoff,now));
  reachedCutoff=rawWindow.some(m=>historyTime(m)<cutoff);
  missingDates ||= rawWindow.some(m=>!isHistoryVideo(m)&&!Number.isFinite(historyTime(m)));
  const windowKey=rawWindow.map(fingerprint).join('\n');
  messages=mergeWindow(messages,visible,first?'newer':'older').slice(-limit);first=false;await save(messages);
  const moved=scroll&&(lastTop===undefined||Math.abs(scroll.scrollTop-lastTop)>1||scroll.scrollHeight!==lastHeight);
  if(windowKey===lastWindow&&!moved)unchanged++;else unchanged=0;lastWindow=windowKey;
  lastTop=scroll?.scrollTop;lastHeight=scroll?.scrollHeight;
  if(messages.length>=limit||reachedCutoff)break;
  const atOldestBoundary=scroll&&(getComputedStyle(scroll).flexDirection==='column-reverse'?Math.abs(scroll.scrollTop)>=scroll.scrollHeight-scroll.clientHeight-2:scroll.scrollTop<=2);
  if(!scroll||unchanged>=20||(unchanged>=8&&atOldestBoundary)){beginning=Boolean([...document.querySelectorAll('a,button,[role=button]')].find(e=>e.textContent?.trim()==='View profile'&&(!scroll||scroll.contains(e))));break;}
  scroll.scrollBy(0,-Math.max(350,scroll.clientHeight*.8));await new Promise(r=>setTimeout(r,800));
 }
 }finally{if(scroll&&conversationId()===pair.conversationId)scroll.scrollTop=original||0;}
 return {messages:messages.map((m,order)=>({...m,order})),complete:messages.length>=limit||((beginning||reachedCutoff)&&!missingDates)};
}
export function directVideoUrl(name:string):string|undefined {
 try{const u=new URL(name);if(!/\.mp4$/i.test(u.pathname)||!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname))return;u.searchParams.delete('bytestart');u.searchParams.delete('byteend');return u.href;}catch{return;}
}
