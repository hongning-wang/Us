import {HISTORY_LIMIT,inHistoryWindow,isHistoryVideo} from '../../../packages/shared/src/history';
import {API_BASE} from './config';
import { browser } from 'wxt/browser';
import type { Pair, Message, Job, UsBridge, Reference } from '../../../packages/shared/src/types';
import {collectHistory,conversationId,mergeWindow,readMessages,messageArticles,stableMedia} from './instagram';
export async function api<T=any>(path:string,method='GET',body?:unknown):Promise<T>{const response=await browser.runtime.sendMessage({type:'us-api',path,method,body});if(!response)throw Error('Reload Instagram to reconnect Us.');if(response.error)throw Error(response.error);return response.data;}
function mediaUrl(url?:string){if(!url)return url;return url.startsWith('/')?API_BASE+url:url;}
const scope=(pair:Pair)=>pair.sender.id+':'+pair.conversationId;
function localPair<T extends Pair>(pair:T):T{return {...pair,conversationId:pair.conversationId.startsWith(pair.sender.id+':')?pair.conversationId.slice(pair.sender.id.length+1):pair.conversationId}}
function present(job:Job):Job{return {...localPair(job),outputUrl:mediaUrl(job.outputUrl),fallbackUrl:mediaUrl(job.fallbackUrl)}}
function presentSetup(setup:any){return {...setup,pair:setup.pair?localPair(setup.pair):undefined,photoUrl:mediaUrl(setup.photoUrl),recipientPhotoUrl:mediaUrl(setup.recipientPhotoUrl)}}
async function cachedHistory(pair:Pair):Promise<Message[]>{
 const key='us:history:'+scope(pair);return ((await browser.storage.local.get(key))[key]||[]) as Message[];
}
const savedPhotoFiles=new Map<string,Promise<Blob>>();
let importing=false;
export function createBridge(pair:Pair):UsBridge{
 const query='?conversationId='+encodeURIComponent(scope(pair));
 const cacheKey='us:history:'+scope(pair);
 const cached=()=>cachedHistory(pair);
 const save=async(messages:Message[])=>{await browser.storage.local.set({[cacheKey]:messages})};
 return {
  async getSetup(){return presentSetup(await api('/api/setup'+query))},
  async configure(){await browser.storage.local.set({['us:pair:'+scope(pair)]:pair});return presentSetup(await api('/api/setup','POST',{...pair,conversationId:scope(pair)}))},
  async confirmPhoto(file,participantId=pair.sender.id){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return presentSetup(await api('/api/photo','POST',{fields:{conversationId:scope(pair),participantId,confirmed:'true',scope:participantId===pair.sender.id?'account':'chat'},upload:{name:file.name,type:file.type,data:btoa(binary)}}))},
  async savedPhotoFile(url){
   const target=new URL(url,API_BASE);if(target.origin!==new URL(API_BASE).origin||!/^\/api\/media\/[a-zA-Z0-9._-]+$/.test(target.pathname)||target.pathname.includes('..'))throw Error('Invalid saved photo.');
   let file=savedPhotoFiles.get(target.href);
   if(!file){file=(async()=>{const response=await browser.runtime.sendMessage({type:'us-api',path:target.pathname,binary:true});if(response.error)throw Error(response.error);return new Blob([Uint8Array.from(atob(response.data),c=>c.charCodeAt(0))],{type:response.mime||'image/jpeg'})})();
    if(savedPhotoFiles.size>=16)savedPhotoFiles.delete(savedPhotoFiles.keys().next().value!);
    savedPhotoFiles.set(target.href,file);void file.catch(()=>savedPhotoFiles.delete(target.href));
   }return file;
  },
  async photoCandidates(participantId){const person=[pair.sender,pair.recipient].find(p=>p.id===participantId);if(!person)throw Error('Choose a person in this chat.');const response=await browser.runtime.sendMessage({type:'us-profile-photos',username:person.username});if(response.error)throw Error(response.error);return response.data;},
  async candidateFile(candidate){const response=await browser.runtime.sendMessage({type:'us-photo-file',url:candidate.url});if(response.error)throw Error(response.error);const {data,mime}=response.data;return new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'instagram-photo.'+(mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg'),{type:mime});},
  async importHistory(){if(importing)throw Error('History import is already running.');importing=true;try{const result=await collectHistory(pair,await cached(),save);return presentSetup(await api('/api/history','POST',{conversationId:scope(pair),...result}))}finally{importing=false}},
  async resetHistory(){return presentSetup(await api('/api/history'+query,'DELETE'))},
  async listJobs(){const jobs=await api<Job[]>('/api/jobs'+query);return Promise.all(jobs.map(async job=>{if(!activeDeliveries.has(job.id)&&job.phase==='deliver'&&(job.status==='sending'||job.status==='failed')){try{return present(await reconcileDelivery(present(job)))}catch{}}return present(job)}))},
  async createJob(input){if(input.reference?.messageId){const parent=(await api<Job[]>('/api/jobs'+query)).find(j=>j.deliveryMessageId===input.reference?.messageId&&j.outputUrl);if(parent)input={...input,reference:{...input.reference,parentJobId:parent.id,url:parent.outputUrl}};}if(input.reference?.url?.startsWith('blob:'))input={...input,reference:await saveReference(input.reference,scope(pair))};return present(await api('/api/jobs','POST',{...input,conversationId:scope(pair)}))},
  async retryJob(id){const job=await api<Job>('/api/jobs/'+id);if(job.phase==='deliver'&&(await browser.storage.local.get('us:delivery:'+id))['us:delivery:'+id]){const recovered=await reconcileDelivery(present(job));if(recovered.status==='sent'||recovered.status==='ready')return present(recovered);}return present(await api('/api/jobs/'+id+'/retry','POST'))},
  async useFallback(id){return present(await api('/api/jobs/'+id+'/fallback','POST'))},
  async sendJob(job){return deliver(job)},
 };
}
const observedVersions=new Map<string,string>();
export async function observeMessages(pair:Pair){
 if(importing||conversationId()!==pair.conversationId)return;
 const key='us:history:'+scope(pair);
 const cached=await cachedHistory(pair);
 const messages=mergeWindow(cached.filter(m=>!isHistoryVideo(m)&&inHistoryWindow(m)),readMessages(pair).filter(m=>inHistoryWindow(m))).slice(-HISTORY_LIMIT);
 const recent=messages.slice(-100);
 if(!recent.length)return;
 const version=recent.map(m=>m.id).join('|');
 if(observedVersions.get(key)===version)return;
 // Persist IDs before a write: a lost response must retry the same IDs.
 await browser.storage.local.set({[key]:messages});
 await api('/api/history','POST',{conversationId:scope(pair),messages:recent,complete:false});
 observedVersions.set(key,version);
}

type DeliveryLedger={conversationId:string;before:string[];startedAt:string;staged?:boolean;sendRequested?:boolean;messageId?:string};
const activeDeliveries=new Set<string>();
function attachmentKeys(sender:Job['sender']){
 const occurrences=new Map<string,number>();
 return messageArticles().flatMap(article=>{
  const author=article.closest('[role=group][tabindex="-1"]')?.querySelector('[aria-label^="Reply to message from"]')?.getAttribute('aria-label')?.replace('Reply to message from ','');
  if(author!==sender.username&&!/^(you|yourself)$/i.test(author||''))return [];
  if(!article.querySelector('video,img[src*=playButton]'))return [];
  const image=[...article.querySelectorAll<HTMLImageElement>('img')].find(i=>i.src.startsWith('https:')&&i.width>=100);
  const video=article.querySelector<HTMLVideoElement>('video');
  const key=image?stableMedia(image.src):video?.currentSrc&&!video.currentSrc.startsWith('blob:')?stableMedia(video.currentSrc):undefined;
  if(!key)return [];const occurrence=(occurrences.get(key)||0)+1;occurrences.set(key,occurrence);
  return [occurrence===1?key:`${key}#occurrence=${occurrence}`];
 });
}
async function reconcileDelivery(job:Job):Promise<Job>{
 if(job.status==='sent')return job;
 if(conversationId()!==job.conversationId)throw Error('Open the chat with '+job.recipient.name+' to check this upload.');
 const key='us:delivery:'+job.id;
 const ledger=(await browser.storage.local.get(key))[key] as DeliveryLedger|undefined;
 if(!ledger)throw Error('This upload needs to be checked in Instagram before sending again.');
 if(ledger.messageId)return present(await api('/api/jobs/'+job.id+'/delivery','POST',{status:'sent',messageId:ledger.messageId}));
 if(!ledger.sendRequested){
  await api('/api/jobs/'+job.id+'/delivery','POST',{status:'failed',error:'Upload stopped before Send.',safeToRetry:true});
  await browser.storage.local.remove(key);
  return present(await api('/api/jobs/'+job.id+'/retry','POST'));
 }
 const after=attachmentKeys(job.sender),added=after.filter(k=>!ledger.before.includes(k));
 if(added.length===1&&after.some(k=>ledger.before.includes(k))&&Date.now()-Date.parse(ledger.startedAt)<5*60_000){
  await browser.storage.local.set({[key]:{...ledger,messageId:added[0]}});
  return present(await api('/api/jobs/'+job.id+'/delivery','POST',{status:'sent',messageId:added[0]}));
 }
 throw Error('The upload is still unconfirmed. Keep this chat open and check again; Us will not send a duplicate.');
}
async function deliver(job:Job):Promise<Job>{
 if(conversationId()!==job.conversationId)throw Error('Open the chat with '+job.recipient.name+' to send this video.');
 if(job.status==='sent')return job;
 if(activeDeliveries.has(job.id))throw Error('This video is already being uploaded.');
 activeDeliveries.add(job.id);
 const key='us:delivery:'+job.id;
 let started=false,sendRequested=false;
 try {
  const prior=(await browser.storage.local.get(key))[key] as DeliveryLedger|undefined;
  if(prior?.sendRequested||prior?.messageId)return await reconcileDelivery(job);
  if(job.status!=='ready'||!job.outputUrl)throw Error('Your video is not ready yet.');
  const url=new URL(job.outputUrl);if(url.origin!==new URL(API_BASE).origin||!url.pathname.startsWith('/api/media/'))throw Error('The video must be saved by Us before sending.');
  const response=await browser.runtime.sendMessage({type:'us-api',path:url.pathname,binary:true});if(response.error)throw Error(response.error);
  const input=document.querySelector<HTMLInputElement>('input[type=file][accept*=mp4]');
  if(!input)throw Error('Instagram’s upload control is unavailable. Reload this chat.');
  if(conversationId()!==job.conversationId)throw Error('Return to the original chat to send.');
  const filename=`us-${job.id}.mp4`;
  const attached=()=>document.querySelector('[aria-label="Remove attachment: '+filename+'"]');
  if(document.querySelector('[aria-label^="Remove attachment:"]')&&!attached())throw Error('Send or remove your existing attachment first.');
  if(!prior?.staged&&document.querySelector<HTMLElement>('[contenteditable=true][role=textbox]')?.innerText.trim())throw Error('Finish your current message before sending this video.');
  const ledger:DeliveryLedger={startedAt:new Date().toISOString(),conversationId:job.conversationId,before:attachmentKeys(job.sender)};
  // The ledger precedes both the backend transition and all native upload actions.
  await browser.storage.local.set({[key]:ledger});
  await api('/api/jobs/'+job.id+'/delivery','POST',{status:'sending'});started=true;
  if(conversationId()!==job.conversationId)throw Error('The chat changed before upload.');
  if(!attached()){
   const bytes=Uint8Array.from(atob(response.data),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],filename,{type:'video/mp4'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  for(let n=0;n<60;n++){
   await new Promise(r=>setTimeout(r,1000));if(conversationId()!==job.conversationId)throw Error('Return to the original chat to check your upload.');
   if(!sendRequested){
    const send=document.querySelector<HTMLElement>('[role=button][aria-label=Send]');
    if(attached()&&send&&send.getAttribute('aria-disabled')!=='true'){
     ledger.sendRequested=true;await browser.storage.local.set({[key]:ledger});sendRequested=true;
     if(conversationId()!==job.conversationId)throw Error('The chat changed before Send.');
     send.click();
    }
   }
   const added=attachmentKeys(job.sender).filter(k=>!ledger.before.includes(k));
   if(sendRequested&&added.length===1){
    ledger.messageId=added[0];await browser.storage.local.set({[key]:ledger});
    return present(await api('/api/jobs/'+job.id+'/delivery','POST',{status:'sent',messageId:added[0]}));
   }
  }
  throw Error(sendRequested?'Upload could not be confirmed. Check Instagram before trying again.':'Instagram did not attach the video. Try again.');
 }catch(e){
  if(started){
   await api('/api/jobs/'+job.id+'/delivery','POST',{status:'failed',error:(e as Error).message,safeToRetry:!sendRequested}).catch(()=>{});
   if(!sendRequested)await browser.storage.local.remove(key);
  }
  throw e;
 }finally{activeDeliveries.delete(job.id)}
}

export async function saveReference(reference:Reference,conversationId:string):Promise<Reference>{
 if(!reference.url)throw Error('Open this video before using it as a reference.');
 const response=await fetch(reference.url);const blob=await response.blob();
 if(blob.size>30*1024*1024)throw Error('Choose a video under 30 MB.');
 const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 const saved=await api('/api/references','POST',{fields:{conversationId},upload:{name:'reference.mp4',type:blob.type||'video/mp4',data:btoa(binary)}});
 return {...reference,url:saved.url};
}
