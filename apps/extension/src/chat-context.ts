import type {Pair,Participant} from '../../../packages/shared/src/types';
import {stableMedia} from './instagram';

type InboxUser={username:string;full_name?:string;profile_pic_url?:string};
type InboxThread={thread_v2_id:string;thread_title?:string;users:InboxUser[]};
type InboxPage={viewer:InboxUser;inbox:{threads:InboxThread[];oldest_cursor?:string;has_older?:boolean}};
export function selectedShareTiles(dialog:HTMLElement):HTMLElement[]{
 const tiles=[...dialog.querySelectorAll<HTMLElement>('[role=button],button,[role=checkbox],[role=option]')].filter(e=>!e.dataset.usAction&&e.querySelector('img')&&(e.getAttribute('aria-checked')==='true'||e.getAttribute('aria-selected')==='true'||e.querySelector('svg[aria-label="Checkmark filled icon"]')));
 for(const checkbox of dialog.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')){
  let row=checkbox.parentElement;
  while(row&&row!==dialog&&!row.querySelector('img'))row=row.parentElement;
  if(row&&row!==dialog&&row.querySelectorAll('input[type=checkbox]').length===1&&!tiles.some(tile=>tile.contains(row)||row.contains(tile)))tiles.push(row);
 }
 return tiles;
}
export function shareSendButton(dialog:HTMLElement):HTMLElement|undefined {
 return [...dialog.querySelectorAll<HTMLElement>('[role=button],button')].find(e=>!e.dataset.usAction&&e.innerText.trim()==='Send');
}
const person=(u:InboxUser):Participant=>({id:u.username,username:u.username,name:u.full_name||u.username});
export function matchShareThread(page:InboxPage,tile:HTMLElement):Pair|undefined{
 const labels=tile.innerText.split('\n').map(s=>s.trim()).filter(Boolean);
 const avatars=[...tile.querySelectorAll<HTMLImageElement>('img')].map(i=>stableMedia(i.src));
 const matches=page.inbox.threads.filter(t=>t.users.length===1&&t.users[0]!.profile_pic_url&&avatars.includes(stableMedia(t.users[0]!.profile_pic_url))&&[t.thread_title,t.users[0]!.full_name,t.users[0]!.username].some(label=>label&&labels.includes(label)));
 if(matches.length!==1)return;
 const thread=matches[0]!;if(!/^\d+$/.test(String(thread.thread_v2_id)))return;
 return {conversationId:String(thread.thread_v2_id),sender:person(page.viewer),recipient:person(thread.users[0]!)};
}
export async function resolveSharePair(dialog:HTMLElement):Promise<Pair>{
 const tiles=selectedShareTiles(dialog);
 if(tiles.length!==1)throw Error('Choose one person to make this us.');
 const tile=tiles[0]!;
 if(tile.querySelectorAll('img').length!==1)throw Error('Choose a one-to-one chat.');
 const appId=[...document.scripts].map(s=>s.textContent?.match(/"APP_ID"\s*:\s*"(\d+)"/)?.[1]).find(Boolean);
 if(!appId)throw Error('Reload Instagram to read your selected chat.');
 let cursor:string|undefined;
 for(let n=0;n<4;n++){
  const query=new URLSearchParams({limit:'50',...(cursor?{cursor}: {})});
  const response=await fetch('/api/v1/direct_v2/inbox/?'+query,{credentials:'include',headers:{'X-IG-App-ID':appId},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Instagram could not open this chat. Try again.');
  const data=await response.json() as InboxPage;
  if(!data.viewer?.username||!data.inbox?.threads)throw Error('Instagram could not identify your account.');
  const pair=matchShareThread(data,tile);if(pair)return pair;
  if(!data.inbox.has_older||!data.inbox.oldest_cursor)break;cursor=data.inbox.oldest_cursor;
 }
 throw Error('Could not match the selected chat. Choose the person again and retry.');
}
