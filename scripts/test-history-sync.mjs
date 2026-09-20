import {build} from 'esbuild';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:"export {observeMessages} from './apps/extension/src/bridge';export {readMessages,collectHistory} from './apps/extension/src/instagram';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,define:{'import.meta.env':'{}'},format:'iife',globalName:'HistoryTest',plugins:[{name:'mock-browser',setup(b){b.onResolve({filter:/^wxt\/browser$/},()=>({path:'browser',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const browser=window.fixtureBrowser'}));}}]});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage();
 await page.route('**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<main id="messages"></main>'}):r.abort());
 await page.goto('https://www.instagram.com/direct/t/history/');
 await page.evaluate(()=>{
  window.pair={conversationId:'history',sender:{id:'me',username:'me',name:'Me'},recipient:{id:'friend',username:'friend',name:'Friend'}};
  window.state={cache:{},writes:[],fail:false};window.messageTime=Date.now()-1000;
  window.fixtureBrowser={storage:{local:{async get(key){return {[key]:state.cache[key]}},async set(data){Object.assign(state.cache,data)}}},runtime:{async sendMessage({path,body}){
   if(path!=='/api/history')throw Error('Unexpected request '+path);
   state.writes.push(body);
   if(state.fail){state.fail=false;return {error:'Lost response'}};
   return {data:{importComplete:false}};
  }}};
  window.addMessage=(text,video=false)=>{const group=document.createElement('div');group.setAttribute('role','group');group.tabIndex=-1;group.innerHTML='<button aria-label="Reply to message from friend"></button><article role="article" aria-roledescription="message"><time></time></article>';group.querySelector('time').setAttribute('datetime',new Date(window.messageTime).toISOString());group.querySelector('article').append(document.createTextNode(text));if(video)group.querySelector('article').insertAdjacentHTML('beforeend','<img width="236" src="https://cdninstagram.com/poster.jpg?token=one">');document.querySelector('#messages').append(group)};
  addMessage('First message',true);
 });
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>HistoryTest.observeMessages(pair));
 assert.equal(await page.evaluate(()=>state.writes.length),1);
 assert.equal(await page.evaluate(()=>state.writes[0].complete),false);
 assert.ok(Date.now()-Date.parse(await page.evaluate(()=>state.writes[0].messages[0].timestamp))<10000);
 await page.evaluate(()=>{const video=document.createElement('video');Object.defineProperty(video,'currentSrc',{value:'blob:temporary-playback'});document.querySelector('article').append(video);document.querySelector('img').src='https://cdninstagram.com/poster.jpg?token=two'});
 await page.evaluate(()=>HistoryTest.observeMessages(pair));
 assert.equal(await page.evaluate(()=>state.writes.length),1,'Playing a video must not create a duplicate history entry');
 await page.evaluate(()=>{addMessage('New message');state.fail=true});
 assert.equal(await page.evaluate(async()=>{try{await HistoryTest.observeMessages(pair)}catch(e){return e.message}}),'Lost response');
 await page.evaluate(()=>HistoryTest.observeMessages(pair));
 const writes=await page.evaluate(()=>state.writes);
 assert.equal(writes.length,3);
 assert.deepEqual(writes[1].messages.map(m=>m.id),writes[2].messages.map(m=>m.id),'Retry keeps source IDs even when a write response was lost');
 assert.equal(writes[2].messages.length,2);
 await page.evaluate(()=>HistoryTest.observeMessages(pair));
 assert.equal(await page.evaluate(()=>state.writes.length),3);
 // A virtualized chat exposes only 17 rows at once and advances logical time per load.
 await page.evaluate(()=>{
  const originalTimeout=window.setTimeout.bind(window);let elapsed=0;const originalNow=Date.now;
  Date.now=()=>originalNow()+elapsed;
  window.setTimeout=(fn,ms,...args)=>{elapsed+=Number(ms)||0;return originalTimeout(fn,1,...args)};
  window.fixtureElapsed=()=>elapsed;
  const root=document.querySelector('#messages');root.style.overflowY='auto';
  window.totalMessages=600;let top=(totalMessages-17)*40;
  const render=()=>{
   root.replaceChildren();const start=Math.floor(top/40);
   for(let i=start;i<Math.min(totalMessages,start+17);i++){addMessage('Message '+i);if(window.datedHistory)root.lastElementChild.querySelector('time').setAttribute('datetime',new Date(window.messageTime-(totalMessages-i)*86400000).toISOString());if(window.includeReels&&i%2===0){const a=document.createElement('a');a.href='https://www.instagram.com/reel/R'+i+'/';a.textContent='Shared reel';root.lastElementChild.querySelector('article').append(a)}}
   if(start===0&&window.showBeginning){const button=document.createElement('button');button.textContent='View profile';root.append(button)}
  };
  Object.defineProperties(root,{scrollHeight:{get:()=>totalMessages*40},clientHeight:{get:()=>680},scrollTop:{get:()=>top,set:value=>{top=Math.max(0,Math.min((totalMessages-17)*40,value));render()}}});
  root.scrollBy=(_x,dy)=>{root.scrollTop+=dy};render();
 });
 const collected=await page.evaluate(async()=>{
  const result=await HistoryTest.collectHistory(pair,[],async messages=>{window.savedHistory=messages});
  return {...result,elapsed:fixtureElapsed()};
 });
 assert.equal(collected.messages.length,500);
 assert.equal(collected.complete,true);
 assert.ok(collected.elapsed>22000,'Collection must continue after 22 seconds');
 assert.deepEqual(collected.messages.map(m=>m.text),Array.from({length:500},(_,i)=>'Message '+(100+i)));
 assert.equal(new Set(collected.messages.map(m=>m.id)).size,500);
 const repeated=await page.evaluate(()=>HistoryTest.collectHistory(pair,savedHistory,async()=>{}));
 assert.deepEqual(repeated.messages.map(m=>m.id),collected.messages.map(m=>m.id),'Retry retains source IDs');
 await page.evaluate(()=>{totalMessages=1200;window.includeReels=true});
 const textOnly=await page.evaluate(()=>HistoryTest.collectHistory(pair,[],async()=>{}));
 assert.equal(textOnly.messages.length,500);
 assert.deepEqual(textOnly.messages.map(m=>m.text),Array.from({length:500},(_,i)=>'Message '+(201+i*2)),'Reels do not count toward the 500-message target');
 await page.evaluate(()=>{window.includeReels=false;totalMessages=25;window.showBeginning=true});
 const short=await page.evaluate(()=>HistoryTest.collectHistory(pair,[],async()=>{}));
 assert.equal(short.messages.length,25);assert.equal(short.complete,true);
 await page.evaluate(()=>{window.showBeginning=false});
 const stalled=await page.evaluate(()=>HistoryTest.collectHistory(pair,[],async()=>{}));
 assert.equal(stalled.messages.length,25);assert.equal(stalled.complete,false,'A stalled loader is not a complete history');
 await page.evaluate(()=>{totalMessages=600;window.datedHistory=true});
 const dated=await page.evaluate(()=>HistoryTest.collectHistory(pair,[],async()=>{}));
 assert.equal(dated.complete,true,'The age cutoff completes an import with fewer than 500 messages');
 assert.ok(dated.messages.length>=89&&dated.messages.length<=92);
 const cutoff=new Date();cutoff.setUTCMonth(cutoff.getUTCMonth()-3);cutoff.setUTCHours(0,0,0,0);
 assert.ok(dated.messages.every(m=>Date.parse(m.timestamp)>=cutoff.getTime()));
 await page.evaluate(()=>{window.datedHistory=false});
 // Instagram can leave the same virtualized rows in place across a large gap.
 // Actual scrolling is progress even when no new readable messages appear yet.
 await page.evaluate(()=>{
  totalMessages=2000;window.showBeginning=true;
  const root=document.querySelector('#messages');root.scrollTop=root.scrollHeight;
  const frozen=[...root.children].map(e=>e.cloneNode(true));
  root.scrollBy=(_x,dy)=>{root.scrollTop+=dy;if(root.scrollTop>0)root.replaceChildren(...frozen.map(e=>e.cloneNode(true)));else window.reachedBeginning=true};
 });
 const gap=await page.evaluate(()=>HistoryTest.collectHistory(pair,[],async()=>{}));
 assert.equal(await page.evaluate(()=>window.reachedBeginning),true,'Unchanged rows during scrolling must not trigger a premature stop');
 assert.equal(gap.complete,true);
 await page.evaluate(()=>{
  const root=document.querySelector('#messages');root.replaceChildren();addMessage('Shared creator caption');
  root.querySelector('article').insertAdjacentHTML('beforeend','<svg aria-label="Clip"></svg>');
 });
 assert.equal(await page.evaluate(()=>HistoryTest.readMessages(pair).length),0,'Native Reel cards without permalink anchors are excluded');
 await page.evaluate(()=>{
  const root=document.querySelector('#messages');root.replaceChildren();root.style.overflowY='visible';
  const old=document.createElement('span');old.textContent='May 7, 2020, 12:28 AM';root.append(old);
  addMessage('Old dated message');root.querySelector('time').remove();
 });
 const old=await page.evaluate(()=>HistoryTest.collectHistory(pair,[],async()=>{}));
 assert.equal(old.messages.length,0);assert.equal(old.complete,true,'Native date separators stop collection at old history');
 await page.evaluate(()=>document.querySelector('#messages > span').remove());
 const undated=await page.evaluate(()=>HistoryTest.collectHistory(pair,[],async()=>{}));
 assert.equal(undated.messages.length,0);assert.equal(undated.complete,false,'Unknown dates are never guessed to be recent');
 console.log('History collection passed: 500 messages from 17-row windows, beyond 22 seconds, chronological order, stable retry IDs, short chat and incomplete loader.');
 console.log('History sync passed: incomplete imports accept new messages, timestamps survive, playback does not duplicate media, lost responses reuse IDs.');
} finally {await browser.close()}
