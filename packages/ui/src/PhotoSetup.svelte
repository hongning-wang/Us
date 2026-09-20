<script lang="ts">
 import {onMount} from 'svelte';
 import type {Pair,Participant,Setup,UsBridge,PhotoCandidate} from '../../shared/src/types';
 export let pair:Pair;export let bridge:UsBridge;
 export let onclose=()=>{};export let onconfirmed=()=>{};export let settings=false;
 export let initialParticipantId=pair.sender.id;
 type Suggestion=PhotoCandidate&{thumbnail:string;file:File};
 type Draft={file:File;url:string};
 let target=initialParticipantId;let setup:Setup|undefined;let photo:File|undefined;let preview='';
 let busy=false;let indexing=false;let error='';let loading=false;let editing=false;let live=true;let requestVersion=0;
 let candidates:Suggestion[]=[];let savedImages:Record<string,string>={};let dialog:HTMLDivElement;
 const drafts=new Map<string,Draft>();const suggestionsCache=new Map<string,Suggestion[]>();const loadedUrls=new Map<string,string>();
 $: person=target===pair.sender.id?pair.sender:pair.recipient;
 $: saved=target===pair.sender.id?setup?.photoConfirmed:setup?.recipientPhotoConfirmed;
 const initials=(p:Participant)=>p.name.trim().split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();
 function hasPhoto(id:string){return id===pair.sender.id?setup?.photoConfirmed:setup?.recipientPhotoConfirmed}
 async function loadSavedImages(){
  if(!setup)return;
  await Promise.all([pair.sender,pair.recipient].map(async p=>{
   const url=p.id===pair.sender.id?setup?.photoUrl:setup?.recipientPhotoUrl;
   if(!url||loadedUrls.get(p.id)===url)return;
   loadedUrls.set(p.id,url);
   try{
    const blob=bridge.savedPhotoFile?await bridge.savedPhotoFile(url):await fetch(url).then(r=>{if(!r.ok)throw Error();return r.blob()});
    if(!live||loadedUrls.get(p.id)!==url)return;
    const previous=savedImages[p.id];if(previous)URL.revokeObjectURL(previous);
    savedImages={...savedImages,[p.id]:URL.createObjectURL(blob)};
   }catch{loadedUrls.delete(p.id)}
  }));
 }
 onMount(()=>{
  const previous=document.activeElement as HTMLElement|null;dialog?.focus();
  (async()=>{try{const next=await bridge.getSetup();const configured=next.pair?next:await bridge.configure(pair);if(!live)return;setup=configured;void loadSavedImages();if(!hasPhoto(target)){editing=true;void suggestions()}}catch(e){if(live)error=(e as Error).message}})();
  return()=>{live=false;requestVersion++;for(const list of suggestionsCache.values())for(const c of list)URL.revokeObjectURL(c.thumbnail);for(const d of drafts.values())URL.revokeObjectURL(d.url);for(const url of Object.values(savedImages))URL.revokeObjectURL(url);if(previous?.isConnected)previous.focus()};
 });
 async function validate(file:File){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose a JPG, PNG or WebP photo.');
  if(file.size>10*1024*1024)throw Error('Choose a photo under 10 MB.');
  const bitmap=await createImageBitmap(file);const {width,height}=bitmap;bitmap.close();
  if(Math.min(width,height)<300)throw Error('Choose a clearer photo, at least 300 pixels wide and tall.');
  if(Math.max(width,height)>6000||width/height<0.4||width/height>2.5)throw Error('Choose a smaller photo with a less narrow crop.');
 }
 function setDraft(file:File){
  const old=drafts.get(target);if(old)URL.revokeObjectURL(old.url);
  const draft={file,url:URL.createObjectURL(file)};drafts.set(target,draft);photo=file;preview=draft.url;error='';editing=true;
 }
 function clearDraft(){const draft=drafts.get(target);if(draft)URL.revokeObjectURL(draft.url);drafts.delete(target);photo=undefined;preview=''}
 async function suggestions(){
  const version=++requestVersion;const id=target;loading=true;candidates=[];error='';
  try{
   let available=suggestionsCache.get(id);
   if(!available){
    const result=await bridge.photoCandidates?.(id)||[];
    if(!live||version!==requestVersion)return;
    const loaded=await Promise.allSettled(result.map(async c=>{if(!bridge.candidateFile)throw Error();const file=await bridge.candidateFile(c);await validate(file);return {...c,file,thumbnail:URL.createObjectURL(file)}}));
    available=loaded.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
    if(!live){available.forEach(c=>URL.revokeObjectURL(c.thumbnail));return;}
    suggestionsCache.set(id,available);
   }
   if(version!==requestVersion)return;
   candidates=available;
   const existing=drafts.get(id);if(existing){photo=existing.file;preview=existing.url}
   else{const profile=available.find(c=>c.source==='profile');if(profile)setDraft(profile.file)}
  }catch{/* Unavailable suggestions are an ordinary upload fallback. */}
  finally{if(live&&version===requestVersion)loading=false}
 }
 function selectPerson(id:string){
  if(busy||indexing)return;requestVersion++;loading=false;target=id;error='';
  const draft=drafts.get(id);photo=draft?.file;preview=draft?.url||'';candidates=suggestionsCache.get(id)||[];
  editing=Boolean(draft)||!hasPhoto(id);
  if(editing&&!draft)void suggestions();
 }
 function changePhoto(){editing=true;void suggestions()}
 async function choose(event:Event){
  const file=(event.target as HTMLInputElement).files?.[0];if(!file||busy)return;requestVersion++;loading=false;busy=true;
  try{await validate(file);setDraft(file)}catch(e){error=(e as Error).message}finally{busy=false}
 }
 async function confirm(){
  if(!photo||busy)return;busy=true;error='';
  try{setup=await bridge.confirmPhoto(photo,target);clearDraft();editing=false;void loadSavedImages();
   if(!settings&&target===pair.sender.id&&!setup.recipientPhotoConfirmed){target=pair.recipient.id;editing=true;void suggestions()}
   else if(!settings)onconfirmed();
  }catch(e){error=(e as Error).message}finally{busy=false}
 }
 async function memory(reset=false){indexing=true;error='';try{setup=reset?await bridge.resetHistory():await bridge.importHistory()}catch(e){error=(e as Error).message}finally{indexing=false}}
 function keydown(event:KeyboardEvent){
  if(event.key==='Escape'){event.stopPropagation();onclose()}
  if(event.key==='Tab'){const buttons=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary')];const first=buttons[0],last=buttons.at(-1);const focused=dialog.getRootNode() instanceof ShadowRoot?(dialog.getRootNode() as ShadowRoot).activeElement:document.activeElement;if(event.shiftKey&&(focused===first||focused===dialog)){event.preventDefault();last?.focus()}else if(!event.shiftKey&&focused===last){event.preventDefault();first?.focus()}}
 }
</script>
<div class="backdrop" role="presentation" onclick={(e)=>{if(e.target===e.currentTarget)onclose()}}>
 <div bind:this={dialog} class="panel" role="dialog" aria-modal="true" aria-label={settings?'Us settings':target===pair.sender.id?'Your photo':'Friend photo'} tabindex="-1" onkeydown={keydown}>
  <header><div><h1>{settings?'Us settings':'Your photos'}</h1><p>{settings?'Photos for this chat':'@'+person.username}</p></div><button class="close" aria-label="Close Us settings" onclick={onclose}>×</button></header>
  {#if !setup}<div class="loading" role="status">Loading…</div>{:else}
   {#if settings}<div class="people" aria-label="People in this chat">
    {#each [pair.sender,pair.recipient] as participant}
     <button class="person" class:selected={target===participant.id} aria-label={participant.id===pair.sender.id?'Your photo':participant.name+' photo'} aria-pressed={target===participant.id} disabled={busy||indexing} onclick={()=>selectPerson(participant.id)}>
      <span class="avatar">{#if savedImages[participant.id]}<img src={savedImages[participant.id]} alt="" onerror={()=>savedImages={...savedImages,[participant.id]:''}}/>{:else}{initials(participant)}{/if}</span>
      <span class="person-info"><b>{participant.id===pair.sender.id?'You':participant.name}</b><small>{hasPhoto(participant.id)?'Photo saved':'Add photo'}</small></span>
      {#if hasPhoto(participant.id)}<span class="check" aria-label="Photo saved">✓</span>{/if}
     </button>
    {/each}
   </div>{/if}
   {#if !editing&&saved}
    <div class="saved-state"><span>Photo ready to use.</span><button class="link" onclick={changePhoto}>Change photo</button></div>
   {:else}
    <section class="editor" aria-label={'Photo for '+person.name}>
     {#if preview}
      <img class="preview" src={preview} alt="Selected reference for {person.name}"/>
      <h2>{target===pair.sender.id?'Use this photo?':'Use this for '+person.name+'?'}</h2>
      <p class="account">@{person.username}</p>
      <button class="primary" disabled={busy} onclick={confirm}>{busy?'Saving…':target===pair.sender.id?'Yes, that’s me':'Use for this chat'}</button>
      <button class="link secondary" disabled={busy} onclick={clearDraft}>Choose another</button>
     {:else if loading}<div class="loading" role="status"><span class="spinner"></span>Finding an Instagram photo…</div>
     {:else}
      <h2>{saved?'Choose a new photo':target===pair.sender.id?'Add your photo':'Add a photo of '+person.name}</h2>
      <p class="hint">{candidates.length?'Choose a photo, or upload your own.':'Upload a clear photo to get started.'}</p>
      {#if candidates.length}<div class="photos">{#each candidates as candidate}<button disabled={busy} onclick={()=>setDraft(candidate.file)} aria-label={'Select '+candidate.label+' for '+person.name}><img src={candidate.thumbnail} alt={candidate.label}/><small>{candidate.source==='profile'?'Profile':'Post'}</small></button>{/each}</div>{/if}
      <label class={candidates.length?'outline upload':'primary upload'}>Upload a photo<input type="file" disabled={busy} accept="image/jpeg,image/png,image/webp" onchange={choose}/></label>
     {/if}
     {#if saved}<button class="link secondary" disabled={busy} onclick={()=>{requestVersion++;loading=false;clearDraft();editing=false;error=''}}>Keep saved photo</button>{/if}
     {#if !settings&&target===pair.recipient.id}<button class="link secondary" disabled={busy} onclick={onconfirmed}>Skip for now</button>{/if}
    </section>
   {/if}
   {#if settings}<details class="memory">
    <summary><span>Chat memory</span><span class="count">{setup.importedCount} messages{setup.importComplete?'':' · partial'} <span aria-hidden="true">⌄</span></span></summary>
    <div class="memory-body"><p>Up to 500 messages from the past 3 months with {pair.recipient.name}. Reels and messages without readable dates are skipped.</p><div class="memory-actions"><button class="outline" disabled={busy||indexing} onclick={()=>memory()}>{indexing?'Importing…':setup.importedCount?'Import more':'Index chat'}</button><button class="link muted" disabled={busy||indexing} onclick={()=>memory(true)}>Reset memory</button></div></div>
   </details>{/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
 </div>
</div>
<style>
 :global(*){box-sizing:border-box}.backdrop{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:#0006;color:#262626;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.panel{width:420px;max-width:100%;max-height:calc(100dvh - 40px);overflow:auto;border-radius:16px;background:#fff;box-shadow:0 16px 60px #0002;padding:24px;outline:none}header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px}h1{font-size:19px;line-height:1.3;margin:0;font-weight:650}header p{margin:5px 0 0;color:#737373;font-size:13px}button,label{font:inherit;cursor:pointer}button{border:0}button:disabled{opacity:.5;cursor:default}.close{width:28px;height:28px;display:grid;place-items:center;background:none;color:#737373;font-size:26px;line-height:1;margin:-4px -6px 0 12px;border-radius:50%}.close:hover{background:#f5f5f5}button:focus-visible,summary:focus-visible,label:focus-within{outline:2px solid #4a5df9;outline-offset:3px}.people{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.person{display:flex;align-items:center;gap:9px;text-align:left;min-width:0;padding:12px 10px;border:1px solid #e8e8e8;border-radius:10px;background:#fff;color:inherit}.person:hover{background:#fafafa}.person.selected{border-color:#999;background:#fafafa}.avatar{display:grid;place-items:center;flex-shrink:0;width:36px;height:36px;background:#ededed;color:#737373;border-radius:50%;overflow:hidden;font-size:12px;font-weight:600}.avatar img{width:100%;height:100%;object-fit:cover}.person-info{min-width:0;flex:1}.person-info b{display:block;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.person-info small{display:block;color:#737373;font-size:11px;margin-top:2px}.check{color:#4a5df9;font-size:13px}.saved-state{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 0 4px;font-size:12px;color:#737373}.link{background:none;border:0;padding:0;color:#4a5df9;font-size:13px;font-weight:600;white-space:nowrap}.editor{margin-top:22px;text-align:center}.editor h2{font-size:17px;font-weight:600;line-height:1.35;margin:0}.hint,.account{color:#737373;font-size:13px;margin:8px 0 18px}.account{margin:5px 0 18px}.preview{display:block;width:112px;height:112px;object-fit:cover;border-radius:14px;margin:0 auto 16px}.primary,.outline{display:block;text-align:center;width:100%;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;line-height:20px}.primary{background:#4a5df9;color:#fff;border:1px solid #4a5df9}.primary:hover{background:#414fdd}.outline{border:1px solid #dbdbdb;background:white;color:#262626}.secondary{display:block;margin:14px auto 0}.photos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:16px 0}.photos button{padding:0;background:#f5f5f5;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden}.photos img{display:block;width:100%;aspect-ratio:1;object-fit:cover}.photos small{display:block;font-size:11px;color:#737373;padding:5px}.upload{position:relative}input{position:absolute;opacity:0;width:1px;height:1px;overflow:hidden}.loading{display:flex;justify-content:center;align-items:center;gap:10px;min-height:100px;color:#737373;font-size:13px}.spinner{width:17px;height:17px;border:2px solid #ddd;border-top-color:#737373;border-radius:50%;animation:spin 1s linear infinite}.memory{margin-top:24px;border-top:1px solid #efefef}.memory summary{display:flex;align-items:center;justify-content:space-between;gap:10px;list-style:none;padding-top:18px;cursor:pointer;font-size:13px;font-weight:600}.memory summary::-webkit-details-marker{display:none}.count{font-weight:400;font-size:12px;color:#737373;white-space:nowrap}.count span{margin-left:5px}.memory-body p{color:#737373;font-size:12px;margin:12px 0}.memory-actions{display:flex;align-items:center;gap:18px}.memory-actions .outline{width:auto;font-size:12px;padding:7px 12px}.muted{color:#737373;font-weight:400;font-size:12px}.error{font-size:12px;color:#c12a3a;margin:16px 0 0}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}@media(max-width:380px){.panel{padding:20px 16px}.person{padding:10px 8px;gap:7px}.avatar{width:30px;height:30px}.check{display:none}}
</style>
