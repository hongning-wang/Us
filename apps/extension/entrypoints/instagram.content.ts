import {defineContentScript} from 'wxt/utils/define-content-script';
import {createShadowRootUi} from 'wxt/utils/content-script-ui/shadow-root';
import {browser} from 'wxt/browser';
import {mount,unmount} from 'svelte';
import SetupPanel from '../../../packages/ui/src/PhotoSetup.svelte';
import {resolveSharePair,selectedShareTiles,shareSendButton} from '../src/chat-context';
import {actionContent,buttonStyles} from '../src/buttons';
import {originalReelUrl,ownVideoMessageId} from '../src/references';
import {createBridge,observeMessages} from '../src/bridge';
import {detectPair,composer,conversationId,scrollContainer,messageArticles,referenceFor,captureReplyReference,resolveReference,activeReelReference,fetchReelVideoUrl,type CapturedReference} from '../src/instagram';
import type {Pair,Reference,Job,CreateJob} from '../../../packages/shared/src/types';

export default defineContentScript({matches:['https://www.instagram.com/*'],cssInjectionMode:'ui',async main(ctx){
 let currentPair:Pair|undefined=detectPair();
 let panel:ReturnType<typeof mount>|undefined;
 let pendingReply:Reference|undefined,pendingArticle:HTMLElement|undefined,capturedReply:CapturedReference|undefined;
 type PendingRequest=CreateJob&{autoShare?:boolean};
 let request:PendingRequest|undefined,active:Job|undefined;let knownJobs:Job[]=[];
 let capturing=false,submitting=false,polling=false,nativeSending=false;
 let deliveryBlockedId='',lastConversation=conversationId(),restoredContext='';
 const historyChecked=new Set<string>();
 const dismissed=new Set<string>(((await browser.storage.local.get('us:dismissed'))['us:dismissed']||[]) as string[]);
 const status=document.createElement('div');status.dataset.usStatus='';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
 const generation=document.createElement('div');generation.dataset.usGeneration='';generation.setAttribute('role','status');generation.setAttribute('aria-live','polite');
 const frame=document.createElement('div');frame.className='us-generation-frame';const spinner=document.createElement('span');spinner.className='us-generation-spinner';spinner.setAttribute('aria-hidden','true');const generationLabel=document.createElement('span');frame.append(spinner,generationLabel);generation.append(frame);
 const style=document.createElement('style');style.textContent=buttonStyles+`
 [data-us-generation]{display:flex;justify-content:flex-end;align-self:stretch;flex-shrink:0;width:100%;padding:8px 16px 12px;box-sizing:border-box}
 [data-us-generation] .us-generation-frame{width:200px;max-width:70%;aspect-ratio:9/16;box-sizing:border-box;border-radius:16px;background:#262626;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
 [data-us-generation] .us-generation-spinner{width:25px;height:25px;border:2px solid #ffffff40;border-top-color:#fff;border-radius:50%;animation:us-generating 1s linear infinite}
 @keyframes us-generating{to{transform:rotate(360deg)}}
 @media(prefers-reduced-motion:reduce){[data-us-generation] .us-generation-spinner{animation:none}}
 [data-us-status]{position:fixed;z-index:2147483646;display:flex;align-items:center;gap:8px;padding:0;pointer-events:none;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:rgb(var(--ig-secondary-text,115,115,115));}
 [data-us-status][hidden]{display:none}[data-us-status] span{flex:1;min-width:0;overflow-wrap:anywhere}
 [data-us-status] button{pointer-events:auto;font:inherit;font-weight:600;color:#4a5df9;background:none;border:0;padding:4px 0;cursor:pointer;white-space:nowrap}
 [data-us-status] button:focus-visible{outline:2px solid #4a5df9;outline-offset:3px}
 [data-us-status] .us-dismiss{color:inherit;font-size:17px;font-weight:400;padding:0 2px}
 `;document.head.append(style);
 const ui=await createShadowRootUi(ctx,{name:'us-setup',position:'inline',anchor:'body',onMount(container){return container}});ui.mount();
 function closePanel(){if(panel)void unmount(panel);panel=undefined;}
 function show(text:string,actions:Array<[string,()=>void]>=[],dismissible=false){
  status.replaceChildren();const label=document.createElement('span');label.textContent=text;status.append(label);
  for(const [title,fn] of actions){const button=document.createElement('button');button.type='button';button.textContent=title;button.onclick=fn;status.append(button);}
  if(dismissible){const button=document.createElement('button');button.type='button';button.textContent='×';button.className='us-dismiss';button.setAttribute('aria-label','Dismiss Us status');button.onclick=()=>{if(active){dismissed.add(active.id);document.querySelector<HTMLElement>('[aria-label="Remove attachment: us-'+active.id+'.mp4"]')?.click();void browser.storage.local.set({'us:dismissed':[...dismissed]});}active=undefined;status.hidden=true};status.append(button)}
  status.hidden=false;attachStatus();
 }
 function attachStatus(){const row=composer()?.parentElement?.parentElement;if(!row)return;const rect=row.getBoundingClientRect();if(!status.isConnected)document.body.append(status);status.style.left=(rect.left+16)+'px';status.style.top=Math.max(0,rect.top-23)+'px';status.style.maxWidth=Math.max(120,rect.width-32)+'px';}
 function showGeneration(label:string){
  const articles=messageArticles(),last=articles.at(-1),first=articles[0];if(!last)return;
  let anchor=last.closest<HTMLElement>('[role=group][tabindex="-1"]')||last;
  let parent=anchor.parentElement;
  while(parent&&first&&!parent.contains(first)){anchor=parent;parent=parent.parentElement;}
  if(!parent||parent===document.body||parent.contains(composer()))return;
  const scroll=scrollContainer();const nearBottom=scroll&&(Math.abs(scroll.scrollTop)<100||!generation.isConnected);
  const thread=scroll?.firstElementChild;
  if(thread&&thread.contains(last)){
   if(generation.parentElement!==thread||thread.lastElementChild!==generation){thread.append(generation);if(nearBottom)scroll!.scrollTop=getComputedStyle(scroll!).flexDirection==='column-reverse'?0:scroll!.scrollHeight;}
  }else if(generation.parentElement!==parent||anchor.nextElementSibling!==generation)anchor.after(generation);
  generationLabel.textContent=label;status.hidden=true;
 }
 function clearComposer(){
  const editor=composer();if(!editor)return;editor.focus();
  const selection=getSelection(),range=document.createRange();range.selectNodeContents(editor);selection?.removeAllRanges();selection?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  // Let Instagram's controlled editor update its state before touching the DOM.
  const input=new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'deleteContentBackward',data:null});
  if(editor.dispatchEvent(input))document.execCommand('delete',false);
 }
 function prime(defaultIdea=''){const editor=composer();if(!editor)return;editor.focus();const text=editor.innerText.trim();if(!/^\/us(?:\s|$)/i.test(text)){document.execCommand('selectAll',false);document.execCommand('insertText',false,'/us '+(text||defaultIdea));}}
 async function pairForChat(){
  const pair=detectPair();if(!pair)throw Error('Open a one-to-one chat to use Us.');
  currentPair=pair;
  await browser.storage.local.set({['us:pair:'+pair.sender.id+':'+pair.conversationId]:pair});
  return pair;
 }
 async function settings(){try{const pair=await pairForChat();openSetup(pair,true)}catch(e){show((e as Error).message,[],true)}}
 function openSetup(pair:Pair,settings=false,initialParticipantId=pair.sender.id){closePanel();panel=mount(SetupPanel,{target:ui.uiContainer,props:{pair,bridge:createBridge(pair),settings,initialParticipantId,onclose:closePanel,onconfirmed:()=>{closePanel();void browser.storage.local.set({['us:friend-photo-reviewed:'+pair.sender.id+':'+pair.conversationId]:true}).then(()=>{if(request&&!settings)void submitRequest();else show('Photos saved. Type /us with your idea.',[],true)})}}});}
 async function submitRequest(){
  if(!request||submitting)return;submitting=true;
  const captured=request;const bridge=createBridge(captured);
  try{
   if(conversationId()!==captured.conversationId)throw Error('Return to the original chat to create this video.');
   let setup=await bridge.getSetup();if(!setup.pair)setup=await bridge.configure(captured);
   if(!setup.photoConfirmed){openSetup(captured);show('Confirm your photo once to get started.',[['Add photo',()=>openSetup(captured)]],true);return;}
   const friendChoiceKey='us:friend-photo-reviewed:'+captured.sender.id+':'+captured.conversationId;
   if(!captured.autoShare&&!setup.recipientPhotoConfirmed&&!(await browser.storage.local.get(friendChoiceKey))[friendChoiceKey]){openSetup(captured,false,captured.recipient.id);return;}
   const historyKey=captured.sender.id+':'+captured.conversationId;
   // A partial import is still saved memory. Do not rescan it for each video.
   if(!captured.reference&&!historyChecked.has(historyKey)&&!setup.importComplete&&setup.importedCount===0){showGeneration('Reading chat history…');setup=await bridge.importHistory();historyChecked.add(historyKey);}
   if(captured.reference&&(!captured.reference.url||captured.reference.url.startsWith('blob:')||/instagram\.com\/(reels?|p)\//.test(captured.reference.url))){
    const messageId=captured.reference.messageId;
    const parent=messageId?(await bridge.listJobs()).find(j=>j.deliveryMessageId===messageId&&j.outputUrl):undefined;
    if(parent)captured.reference={...captured.reference,parentJobId:parent.id,url:parent.outputUrl};
    else if(captured.reference.kind==='reel'&&captured.reference.url?.match(/instagram\.com\/reels?\/([^/?]+)/)) {
     const code=captured.reference.url.match(/instagram\.com\/reels?\/([^/?]+)/)![1]!;showGeneration('Generating…');const url=await fetchReelVideoUrl(code);if(!url)throw Error('This Reel’s video could not be read. Try another Reel.');captured.reference={...captured.reference,mediaId:code,url};
    }
    else {if(!pendingArticle?.isConnected)throw Error('Reply to that video again so Us can read it.');showGeneration('Generating…');captured.reference=await resolveReference(capturedReply||captureReplyReference(pendingArticle,captured.sender)!);}
   }
   if(captured.reference&&!captured.reference.url)throw Error('The selected video wasn’t attached. Select the video again.');
   showGeneration('Generating…');
   const {autoShare,...payload}=captured;
   const created=await bridge.createJob(payload);
   if(request===captured)request=undefined;
   await browser.storage.local.remove('us:request:'+captured.sender.id+':'+captured.conversationId);
   if(conversationId()!==captured.conversationId)return;
   active=created;pendingReply=undefined;pendingArticle=undefined;capturedReply=undefined;
   await browser.storage.local.remove('us:request:'+captured.sender.id+':'+captured.conversationId);
   deliveryBlockedId='';renderJob();
  }catch(e){generation.remove();show((e as Error).message,[['Retry',()=>void submitRequest()]],true)}finally{submitting=false}
 }
 async function retry(){if(!active||!currentPair)return;try{if(active.status!=='ready')active=await createBridge(currentPair).retryJob(active.id);deliveryBlockedId='';renderJob()}catch(e){show((e as Error).message,[['Check again',()=>void retry()]],true)}}
 async function autoSend(){
  if(!active||nativeSending||active.id===deliveryBlockedId||!composer())return;
  if(composer()?.innerText.trim()||[...document.querySelectorAll('[aria-label^="Remove attachment:"]')].some(e=>e.getAttribute('aria-label')!=='Remove attachment: us-'+active!.id+'.mp4')){generation.remove();show('Video ready. Finish your current message first.');return;}
  const job=active;nativeSending=true;showGeneration(job.isFallback?'Sending prerecorded demo…':'Sending…');
  try{const delivered=await createBridge(job).sendJob(job);knownJobs=[delivered,...knownJobs.filter(j=>j.id!==delivered.id)];if(active?.id===job.id){active=delivered;renderJob()}scan()}
  catch(e){generation.remove();deliveryBlockedId=job.id;show((e as Error).message,[['Retry',()=>void retry()]],true)}
  finally{nativeSending=false}
 }
 function renderJob(){
  if(!active||dismissed.has(active.id)||conversationId()!==active.conversationId)return;
  if(active.status==='sent'){generation.remove();dismissed.add(active.id);active=undefined;deliveryBlockedId='';status.hidden=true;return;}
  if(active.status==='generating'){showGeneration('Generating…');return;}
  if(active.status==='sending'){showGeneration('Sending…');return;}
  if(active.status==='failed'){generation.remove();const actions:Array<[string,()=>void]>=[['Retry',()=>void retry()]];if(active.fallbackUrl)actions.push(['Use prerecorded demo',()=>{if(active&&currentPair)void createBridge(currentPair).useFallback(active.id).then(j=>{active=j;deliveryBlockedId='';renderJob()}).catch(e=>show(e.message,[],true))}]);show(active.error||'Video couldn’t be created.',actions,true);return;}
  if(active.status==='ready'){showGeneration('Sending…');void autoSend();}

 }
 function isSend(event:Event){
  if(event.type==='keydown'){const e=event as KeyboardEvent;return e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&composer()?.contains(e.target as Node)}
  const button=(event.target as HTMLElement).closest('[role=button],button');return /^Send$/i.test(button?.getAttribute('aria-label')||button?.textContent?.trim()||'');
 }
 function intercept(event:Event){
  if(!isSend(event))return;
  if(nativeSending){if(event.isTrusted){event.preventDefault();event.stopImmediatePropagation();}return;}
  const editor=composer();if(!editor)return;
  const text=editor.innerText.trim();
  if(/^\/us(?:\s|$)/i.test(text)){
   event.preventDefault();event.stopImmediatePropagation();
   if(capturing||submitting||active?.status==='generating'){show('Your video is still being created.');return;}
   const instruction=text.slice(3).trim();
   if(instruction==='settings'){clearComposer();void settings();return;}
   if(!instruction&&!pendingReply){show('Add your idea after /us.',[['Settings',()=>void settings()]],true);return;}
   capturing=true;void (async()=>{try{const pair=await pairForChat();request={...pair,instruction:instruction||'Personalize this scene for us.',reference:pendingReply,idempotencyKey:crypto.randomUUID()};await browser.storage.local.set({['us:request:'+pair.sender.id+':'+pair.conversationId]:request});clearComposer();await submitRequest()}catch(e){show((e as Error).message,[],true)}finally{capturing=false}})();return;
  }

  // Ordinary sends end the native reply, so a later fresh /us cannot inherit it.
  pendingReply=undefined;pendingArticle=undefined;capturedReply=undefined;
 }
 function captureReply(event:Event){
  requestAnimationFrame(scan);
  const target=(event.target as HTMLElement).closest<HTMLElement>('[aria-label^="Reply to message from"]');
  if(target){pendingArticle=target.closest('[role=group][tabindex="-1"]')?.querySelector<HTMLElement>('[role=article]')||undefined;capturedReply=captureReplyReference(target,currentPair?.sender);pendingReply=capturedReply?.reference;}
  if((event.target as HTMLElement).closest('[aria-label="Cancel reply"]')){pendingArticle=undefined;capturedReply=undefined;pendingReply=undefined;}
 }
 document.addEventListener('click',captureReply,true);window.addEventListener('keydown',intercept,true);window.addEventListener('click',intercept,true);
 function actionsFor(article:HTMLElement){let row=article.querySelector<HTMLElement>('[data-us-actions]');if(!row){row=document.createElement('div');row.dataset.usActions='';article.append(row)}return row}
 function scan(){
  const id=conversationId();const detected=detectPair();if(lastConversation!==id||(detected&&currentPair&&detected.sender.id!==currentPair.sender.id)){lastConversation=id;restoredContext='';currentPair=detectPair();request=undefined;pendingReply=undefined;pendingArticle=undefined;capturedReply=undefined;active=undefined;knownJobs=[];deliveryBlockedId='';status.hidden=true;generation.remove();closePanel();}
  if(!currentPair&&id)currentPair=detectPair();
  for(const article of id?messageArticles():[]){
   if(!article.querySelector('[data-us-action="original"]')){
    const edited=knownJobs.find(j=>j.deliveryMessageId&&j.deliveryMessageId===ownVideoMessageId(article,j.sender));
    const source=edited&&originalReelUrl(edited,knownJobs);
    if(source){const link=document.createElement('a');link.dataset.usAction='original';link.href=source;link.textContent='Original';link.title='Open the original Reel';actionsFor(article).append(link)}
   }
   if(article.querySelector('[data-us-action="reference"]'))continue;
   const ref=referenceFor(article,currentPair?.sender);if(!ref)continue;
   const button=document.createElement('button');button.dataset.usAction='reference';actionContent(button,ref.kind==='reel'?'reel':'reply');
   button.onclick=event=>{event.stopPropagation();const nativeReply=article.closest('[role=group][tabindex="-1"]')?.querySelector<HTMLElement>('[aria-label^="Reply to message from"]');nativeReply?.click();pendingArticle=article;capturedReply=captureReplyReference(article,currentPair?.sender);pendingReply=capturedReply?.reference||ref;setTimeout(()=>prime(ref.kind==='reel'?'Make this us':'What happens next?'),50);};
   actionsFor(article).append(button);
  }
  attachStatus();
  if(currentPair){const key=currentPair.sender.id+':'+currentPair.conversationId;if(restoredContext!==key){restoredContext=key;void restoreChat().catch(e=>show((e as Error).message,[],true));}}
  for(const dialog of document.querySelectorAll<HTMLElement>('[role=dialog]')){
   if(!/^\/(?:reels?|p)\/[^/]+/.test(location.pathname))continue;
   const send=shareSendButton(dialog);if(!send)continue;
   let button=dialog.querySelector<HTMLButtonElement>('[data-us-action="share"]');
   if(!button){
    button=document.createElement('button');button.dataset.usAction='share';actionContent(button,'share');
    const action=button;
    action.onclick=async(event)=>{
     event.preventDefault();event.stopPropagation();
     if(action.dataset.busy)return;action.dataset.busy='true';action.disabled=true;
     const selectedName=selectedShareTiles(dialog)[0]?.innerText;const reelPath=location.pathname;
     try{
      const pair=await resolveSharePair(dialog);
      const reference=await activeReelReference();
      if(location.pathname!==reelPath||selectedShareTiles(dialog).length!==1||selectedShareTiles(dialog)[0]?.innerText!==selectedName)throw Error('Selection changed. Tap Make this us again.');
      const instruction=dialog.querySelector<HTMLInputElement>('input[name="shareCommentText"]')?.value.trim()||'Make this us';
      const selected:PendingRequest={...pair,reference,instruction,idempotencyKey:crypto.randomUUID(),autoShare:true};
      await browser.storage.local.set({['us:request:'+pair.sender.id+':'+pair.conversationId]:selected});
      location.href='/direct/t/'+encodeURIComponent(pair.conversationId)+'/';
     }catch(e){action.textContent=(e as Error).message;delete action.dataset.busy;action.disabled=false;}
    };
    // Insert inside the native footer, not after the modal's visual surface.
    send.parentElement!.dataset.usShareFooter='';send.parentElement!.append(action);
   }
   if(!button.dataset.busy){button.disabled=selectedShareTiles(dialog).length!==1;button.title=button.disabled?'Choose one person':'';}
  }
 }
 async function poll(){
  if(polling||submitting||!currentPair||conversationId()!==currentPair.conversationId)return;polling=true;
  const pair=currentPair;
  try{const jobs=await createBridge(pair).listJobs();if(conversationId()!==pair.conversationId)return;knownJobs=jobs;const next=active?jobs.find(j=>j.id===active?.id):jobs.find(j=>j.status!=='sent'&&!dismissed.has(j.id));if(next){active=next;renderJob()}}catch{}finally{polling=false}
 }
 const interval=setInterval(()=>{scan();void poll()},2000);let syncing=false;
 const syncInterval=setInterval(async()=>{if(!currentPair||syncing)return;syncing=true;try{await observeMessages(currentPair)}catch{}finally{syncing=false}},8000);
 scan();void poll();
 async function restoreChat(){
  const pair=currentPair;if(!pair||conversationId()!==pair.conversationId)return;
  const saved=(await browser.storage.local.get('us:request:'+pair.sender.id+':'+pair.conversationId))['us:request:'+pair.sender.id+':'+pair.conversationId] as PendingRequest|undefined;
  if(saved&&conversationId()===pair.conversationId){request=saved;if(saved.autoShare){await submitRequest();return;}show('Continue your video idea?',[['Continue',()=>void submitRequest()]],true);return;}
  const bridge=createBridge(pair);let setup=await bridge.getSetup();
  const stillHere=()=>currentPair?.sender.id===pair.sender.id&&conversationId()===pair.conversationId;
  if(!stillHere())return;
  if(!setup.pair)setup=await bridge.configure(pair);
  if(!stillHere()||request||active||submitting||panel)return;
  if(!setup.photoConfirmed){openSetup(pair);return;}
  const memoryLabel=setup.importedCount?`${setup.importedCount} messages indexed${setup.importComplete?'':' · incomplete'}`:'Chat not indexed yet';
  show('Your photo is saved · '+memoryLabel,[['Settings',()=>openSetup(pair,true)]],true);
 }

 ctx.onInvalidated(()=>{clearInterval(interval);clearInterval(syncInterval);document.removeEventListener('click',captureReply,true);window.removeEventListener('keydown',intercept,true);window.removeEventListener('click',intercept,true);document.querySelectorAll('[data-us-action],[data-us-actions]').forEach(e=>e.remove());document.querySelectorAll('[data-us-share-footer]').forEach(e=>e.removeAttribute('data-us-share-footer'));status.remove();generation.remove();style.remove();closePanel();ui.remove();});
}});
