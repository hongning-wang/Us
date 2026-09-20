import {isHistoryVideo} from '../../../../../packages/shared/src/history';
import type {Message} from '@us/shared/types';

/** Keep actual chat language (including emoji/slang); remove transport noise only. */
export function cleanText(text:string):string {
 return text.normalize('NFC').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b\ufeff]/g,'')
  .split('\n').map(line=>line.replace(/[\t \u00a0]+/g,' ').trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function memoryLink(raw:string):string|undefined {
 try {
  const url=new URL(raw);if(!['https:','http:'].includes(url.protocol))return;
  // Expiring CDN URLs are neither useful memories nor evidence of visual contents.
  if(/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname))return;
  if(/(^|\.)instagram\.com$/.test(url.hostname)){
   const post=url.pathname.match(/^\/(reels?|p)\/([\w-]+)/);
   if(post)return `https://www.instagram.com/${post[1]==='p'?'p':'reel'}/${post[2]}/`;
  }
  for(const key of [...url.searchParams.keys()])if(/^(utm_|igsh|fbclid$|gclid$)/i.test(key))url.searchParams.delete(key);
  url.hash='';return url.href;
 }catch{return;}
}
export function cleanHistoryMessage(message:Message):Message|undefined {
 const isReel=(raw:string)=>/^https?:\/\/(?:www\.)?instagram\.com\/reels?\//i.test(raw);
 if(isHistoryVideo(message))return;
 const text=cleanText(message.text.replace(/https?:\/\/[^\s<>]+/g,raw=>isReel(raw)?'':memoryLink(raw)||''));
 const mediaUrl=message.mediaUrl?memoryLink(message.mediaUrl):undefined;
 // Preserve the sharing event even when its only available asset was a temporary thumbnail.
 if(!text&&!message.mediaUrl)return;
 return {...message,text:text||'[Shared media]',mediaUrl};
}
