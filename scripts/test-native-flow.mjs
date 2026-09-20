import {build} from 'esbuild';
import {compile} from 'svelte/compiler';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startMockApi} from './mock-api.mjs';
const mock=await startMockApi({port:0});
const bundle=await build({entryPoints:['apps/extension/entrypoints/instagram.content.ts'],bundle:true,write:false,define:{'import.meta.env':'{}'},format:'iife',globalName:'UsNative',conditions:['browser'],plugins:[{name:'fixture-platform',setup(b){
 b.onResolve({filter:/^wxt\//},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='wxt/browser'?'export const browser=window.fixtureBrowser':args.path.includes('define-content-script')?'export const defineContentScript=x=>x':'export async function createShadowRootUi(ctx,options){const host=document.createElement(options.name);document.body.append(host);const root=host.attachShadow({mode:"open"});const container=document.createElement("div");root.append(container);return {uiContainer:container,mount(){},remove(){host.remove()}}}',loader:'js'}));
 b.onLoad({filter:/\.svelte$/},args=>({contents:compile(readFileSync(args.path,'utf8'),{filename:args.path,generate:'client',css:'injected'}).js.code,loader:'js',resolveDir:dirname(args.path)}));
}}]});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
let account='me';const photoLookups=[];
await page.exposeBinding('photoLookup',(_,username)=>photoLookups.push(username));
await page.route('**/*',route=>{
 const url=new URL(route.request().url());
 if(url.pathname==='/api/v1/direct_v2/inbox/')return route.fulfill({json:{viewer:{username:account,full_name:account},inbox:{threads:[{thread_v2_id:'2',thread_title:'Other Friend',users:[{username:'otherfriend',full_name:'Other Friend',profile_pic_url:'https://cdninstagram.com/other.jpg'}]},{thread_v2_id:'1',thread_title:'Friend',users:[{username:'friend',full_name:'Friend',profile_pic_url:'https://cdninstagram.com/friend.jpg'}]}]}}});
 if(url.pathname==='/api/v1/media/3955307914729904366/info/')return route.fulfill({json:{items:[{id:'3955307914729904366_123',video_duration:14,video_versions:[{url:'https://scontent.cdninstagram.com/v/selected.mp4',width:720,height:1280}]}]}});
 if(route.request().resourceType()!=='document')return route.abort();
 const recipient=url.pathname.includes('/t/2/')?'otherfriend':'friend';const recipientName=recipient==='friend'?'Friend':'Other Friend';
 return route.fulfill({contentType:'text/html',body:`<html><body><script type="application/json">{"APP_ID":"123456789"}</script><nav><a href="/${account}/"><img alt="${account}\'s profile picture"></a></nav><main><header><a href="/${recipient}/">${recipientName}<br>${recipient}</a></header><div id="messages"><div role="group" tabindex="-1"><button aria-label="Reply to message from friend">Reply</button><article role="article" aria-roledescription="message"><a href="https://www.instagram.com/reel/DbkE5eixFju/">Shared Reel</a></article></div></div><button aria-label="Cancel reply">Cancel reply</button><div id="composer-region"><div id="row"><div><div contenteditable="true" role="textbox"></div></div><input type="file" accept=".mp4"><button role="button" aria-label="Send">Send</button></div></div></main></body></html>`});
});
await page.exposeBinding('mockRequest',async(_, {path,method,body,binary})=>{
 const response=await fetch(mock.baseUrl+path,{method:method||'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(!response.ok)throw Error('Mock API '+response.status);
 return binary?Buffer.from(await response.arrayBuffer()).toString('base64'):response.json();
});
const storage={'us:pair':{conversationId:'test',sender:{id:'me',username:'me',name:'Me'},recipient:{id:'friend',username:'friend',name:'Friend'}}};
await page.exposeBinding('mockStorage',(_,action,value)=>{if(action==='get')return {[value]:storage[value]};if(action==='set')Object.assign(storage,value);if(action==='remove')delete storage[value];});
const initialize=()=>{
 const pair={conversationId:'test',sender:{id:'me',username:'me',name:'Me'},recipient:{id:'friend',username:'friend',name:'Friend'}};
 const state=window.fixtureState={jobs:[],creates:[],nativeSends:0,uploads:[],deliveryPosts:[],setup:{pair,photoConfirmed:true,importComplete:true,importedCount:100,memoryStatus:'fixture'}};
 window.fixtureBrowser={storage:{local:{get:key=>window.mockStorage('get',key),set:values=>window.mockStorage('set',values),remove:key=>window.mockStorage('remove',key)}},runtime:{async sendMessage({type,username,url,path,method,body,binary}){
  if(type==='us-profile-photos')await window.photoLookup(username);
  if(type==='us-profile-photos'&&username==='no_photo_user')return {data:[]};
  if(type==='us-profile-photos')return {data:[{url:'https://cdninstagram.com/'+username+'.jpg',source:'profile',label:'Profile photo'}]};
  if(type==='us-photo-file'){const canvas=document.createElement('canvas');canvas.width=canvas.height=url.includes('tiny_photo_user')?100:320;canvas.getContext('2d').fillRect(0,0,320,320);return {data:{data:canvas.toDataURL('image/png').split(',')[1],mime:'image/png'}};}

  const data=await window.mockRequest({path,method,body,binary});
  if(path==='/api/jobs'&&method==='POST'){state.creates.push(body);state.jobs.unshift(data);}
  if(path.startsWith('/api/jobs?'))state.jobs=data;
  if(path.endsWith('/delivery')){state.deliveryPosts.push(body);state.jobs=state.jobs.map(j=>j.id===data.id?data:j);}
  return {data};
 }}};
 // Instagram may consume Enter at document capture; Us must intercept earlier.
 document.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();}},true);
 const input=document.querySelector('input[type=file]');input.addEventListener('change',()=>{state.uploads.push(input.files[0]);const remove=document.createElement('button');remove.setAttribute('aria-label','Remove attachment: '+input.files[0].name);remove.onclick=()=>remove.remove();document.querySelector('#row').append(remove);});
 document.querySelector('[aria-label=Send]').addEventListener('click',()=>{const viewer=document.querySelector('nav a').getAttribute('href').split('/')[1];state.nativeSends++;document.querySelector('[aria-label^="Remove attachment:"]')?.remove();document.querySelector('#messages').insertAdjacentHTML('beforeend','<div role="group" tabindex="-1"><button aria-label="Reply to message from '+viewer+'">Reply</button><article role="article" aria-roledescription="message"><img src="https://www.instagram.com/images/playButton.png" width="45"><img src="https://cdninstagram.com/sent-video.jpg" width="236"></article></div>');document.querySelector('[contenteditable]').textContent='';});
};
const mount=async()=>{await page.evaluate(initialize);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>UsNative.default.main({onInvalidated(){}}));};
await page.goto('https://www.instagram.com/direct/t/test/');
await mount();
assert.equal(await page.locator('[data-us-action=composer]').count(),0);
await page.getByRole('button',{name:'Make this us',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('[contenteditable]').innerText.startsWith('/us Make this us'));
await page.getByRole('button',{name:'Cancel reply',exact:true}).click();
assert.equal(await page.locator('.us-card').count(),0);
await page.getByRole('textbox').fill('/us Imagine us in Tokyo');await page.getByRole('textbox').press('Enter');
await page.waitForFunction(()=>fixtureState.creates.length===1);
assert.equal(await page.evaluate(()=>fixtureState.nativeSends),0);
assert.equal(await page.locator('#messages [data-us-generation]').isVisible(),true);
assert.equal(await page.locator('[data-us-generation]').textContent(),'Generating…');
const frame=await page.locator('.us-generation-frame').boundingBox();
assert.ok(frame&&Math.abs(frame.width/frame.height-9/16)<0.01);
await page.waitForFunction(()=>fixtureState.jobs[0]?.status==='sent',{timeout:10000});
assert.equal(await page.evaluate(()=>fixtureState.creates.length),1);
assert.equal(await page.locator('#row').evaluate(e=>e.children.length),3);
assert.equal(await page.locator('[data-us-status]').evaluate(e=>e.parentElement===document.body),true);
assert.equal(await page.evaluate(()=>fixtureState.nativeSends),1);
assert.equal(await page.locator('[data-us-status]').isVisible(),false);
assert.equal(await page.locator('[data-us-generation]').count(),0);
assert.equal(await page.locator('.us-card').count(),0);
await page.getByRole('button',{name:'Imagine what happens next',exact:true}).waitFor();
await page.getByRole('button',{name:'Imagine what happens next',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('[contenteditable]').innerText.startsWith('/us What happens next?'));
assert.equal(await page.evaluate(()=>fixtureState.creates[0].reference),undefined);
// Continue submits the delivered video's exact parent, then auto-sends once.
await page.getByRole('textbox').press('Enter');
await page.waitForFunction(()=>fixtureState.nativeSends===2&&fixtureState.jobs[0]?.status==='sent');
assert.equal(await page.evaluate(()=>fixtureState.creates[1].reference.parentJobId),'fixture-job-1');
assert.equal(await page.evaluate(()=>fixtureState.creates[1].reference.url),'/api/media/fixture.mp4');
// A selected Reel resolves via its own id, independently of previous playback.
// A failed job has neither a delivery ID nor output. Neither missing value can
// match the Reel's absent message ID or replace its URL with undefined.
mock.state.jobs.unshift({id:'earlier-failed-job',conversationId:'me:test',sender:{id:'me',username:'me',name:'Me'},recipient:{id:'friend',username:'friend',name:'Friend'},status:'failed',phase:'generate',error:'Fixture concurrency rejection',createdAt:new Date().toISOString()});
await page.getByRole('button',{name:'Make this us',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('[contenteditable]').innerText.startsWith('/us Make this us'));
assert.equal(await page.getByRole('textbox').evaluate(e=>document.activeElement===e),true);
await page.getByRole('textbox').press('Enter');
await page.waitForFunction(()=>fixtureState.nativeSends===3&&fixtureState.jobs[0]?.status==='sent');
assert.equal(await page.evaluate(()=>fixtureState.creates[2].reference.mediaId),'DbkE5eixFju');
assert.equal(await page.evaluate(()=>fixtureState.creates[2].reference.url),'https://scontent.cdninstagram.com/v/selected.mp4');
assert.equal(await page.evaluate(()=>fixtureState.creates[2].reference.parentJobId),undefined,'An unrelated failed job must never become the Reel parent');
assert.equal(await page.evaluate(()=>fixtureState.creates.length),3);
assert.equal(mock.state.creates.length,3);
assert.equal(mock.state.deliveryPosts.filter(p=>p.status==='sent').length,3);
assert.equal(mock.state.creates[2].reference.url,'https://scontent.cdninstagram.com/v/selected.mp4');
// The actual Share shortcut carries the selection across navigation.
await page.goto('https://www.instagram.com/reels/DbkE5eixFju/');
await mount();
await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div role="dialog"><div id="share-surface"><h2>Share</h2><button role="checkbox" aria-checked="false" id="old-recipient"><img src="https://cdninstagram.com/friend.jpg">Friend</button><button role="checkbox" aria-checked="true"><img src="https://cdninstagram.com/other.jpg">Other Friend</button><input name="shareCommentText" value="Keep this dance"><div id="share-footer"><button>Send</button></div></div></div>'));
await page.locator('[data-us-action=share]').waitFor();
assert.equal(await page.locator('[data-us-action=share]').innerText(),'Make this us');
assert.equal(await page.locator('#share-footer [data-us-action=share]').count(),1);
await page.locator('[data-us-action=share]').click();
await page.waitForURL('**/direct/t/2/');
await mount();
await page.waitForFunction(()=>document.querySelector('[contenteditable]').innerText==='/us Keep this dance');
assert.equal(await page.getByRole('textbox').evaluate(e=>document.activeElement===e),true);
await page.getByRole('textbox').press('Enter');
await page.getByRole('button',{name:'Skip for now',exact:true}).click();
await page.waitForFunction(()=>fixtureState.creates.length===1);
assert.equal(mock.state.creates.length,4);
assert.equal(mock.state.creates[3].conversationId,'me:2');
assert.equal(mock.state.creates[3].recipient.username,'otherfriend');
assert.equal(mock.state.creates[3].instruction,'Keep this dance');
assert.equal(mock.state.creates[3].reference.url,'https://scontent.cdninstagram.com/v/selected.mp4');
// Refresh while the request is running: recover the same job and send it once.
await page.reload();await mount();
await page.waitForFunction(()=>fixtureState.jobs.some(j=>j.id==='fixture-job-4'&&j.status==='sent'));
assert.equal(mock.state.creates.length,4);
assert.equal(mock.state.deliveryPosts.filter(p=>p.jobId==='fixture-job-4'&&p.status==='sent').length,1);
assert.equal(await page.locator('[data-us-generation]').count(),0);
assert.equal(await page.getByRole('textbox').innerText(),'');
const uploadedHash=await page.evaluate(async()=>{const hash=await crypto.subtle.digest('SHA-256',await fixtureState.uploads[0].arrayBuffer());return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');});
assert.equal(uploadedHash,createHash('sha256').update(readFileSync('apps/web/static/fixture.mp4')).digest('hex'));
assert.equal(await page.evaluate(()=>fixtureState.uploads[0].type),'video/mp4');
// A different logged-in account must not recover the previous account's jobs.
account='anotheruser';await page.reload();await mount();
await page.waitForTimeout(2200);
assert.equal(await page.evaluate(()=>fixtureState.jobs.length),0);
await page.getByRole('dialog',{name:'Your photo',exact:true}).waitFor();
assert.match(await page.getByRole('dialog',{name:'Your photo',exact:true}).innerText(),/@anotheruser/);
assert.equal(mock.state.creates.length,4,'A new account must confirm its own photo before generation');
await page.getByRole('button',{name:'Close Us settings'}).click();
await page.getByRole('textbox').fill('/us Imagine us at the beach');await page.getByRole('textbox').press('Enter');
await page.getByRole('dialog',{name:'Your photo',exact:true}).waitFor();
assert.equal(mock.state.creates.length,4);
assert.equal(await page.locator('[data-us-generation]').count(),0);
await page.getByRole('button',{name:'Yes, that’s me',exact:true}).click();
await page.getByRole('dialog',{name:'Friend photo',exact:true}).waitFor();
await page.getByRole('button',{name:'Use for this chat',exact:true}).click();
await page.waitForFunction(()=>fixtureState.creates.length===1);
assert.deepEqual(mock.state.photoPosts.map(p=>[p.participantId,p.scope]),[['anotheruser','account'],['otherfriend','chat']]);
assert.equal(mock.state.creates.at(-1).conversationId,'anotheruser:2');
await page.waitForFunction(()=>fixtureState.jobs[0]?.status==='sent');
const lookupsAfterConfirmation=photoLookups.length;
await page.getByRole('textbox').fill('/us settings');await page.getByRole('textbox').press('Enter');
await page.getByRole('dialog',{name:'Us settings'}).waitFor();
await page.getByRole('button',{name:'Other Friend photo',exact:true}).click();
await page.getByRole('button',{name:'Your photo',exact:true}).click();
assert.equal(photoLookups.length,lookupsAfterConfirmation,'Switching saved people must not search Instagram');
await page.waitForFunction(()=>[...document.querySelector('us-setup').shadowRoot.querySelectorAll('.avatar img')].filter(i=>i.complete&&i.naturalWidth>0).length===2);
await page.screenshot({path:'artifacts/photo-settings-clean.png'});
await page.reload();await mount();
await page.getByRole('textbox').fill('/us settings');await page.getByRole('textbox').press('Enter');
await page.getByRole('dialog',{name:'Us settings'}).waitFor();
await page.getByRole('button',{name:'Other Friend photo',exact:true}).click();
assert.equal(photoLookups.length,lookupsAfterConfirmation,'Reopening settings must reuse saved photos without a lookup');
account='no_photo_user';await page.reload();await mount();
await page.getByRole('dialog',{name:'Your photo',exact:true}).waitFor();
await page.getByText('Upload a clear photo to get started.',{exact:true}).waitFor();
assert.equal(await page.locator('us-setup .primary.upload').count(),1,'Missing Instagram photos lead directly to upload');
assert.equal(mock.state.creates.length,5,'Upload fallback cannot create a generation without a photo');
account='tiny_photo_user';await page.reload();await mount();
await page.getByText('Upload a clear photo to get started.',{exact:true}).waitFor();
assert.equal(await page.getByRole('alert').count(),0,'Unavailable Instagram photos are a normal fallback, not an error');
assert.equal(await page.locator('us-setup .photos').count(),0,'Unusable suggestions are hidden');
assert.equal(await page.locator('us-setup .primary.upload').count(),1,'Low-resolution profile photos prompt for upload');
assert.equal(await page.locator('us-setup .preview').count(),0);
assert.deepEqual(errors,[]);
console.log('Native flow passed: unchanged composer, /us intercept, fresh scene, exact Reel, own-video continuation, automatic native upload/send once each, Share → DM, refresh without duplicate generation/delivery, no result card.');
}finally{await browser.close();await mock.close();}
