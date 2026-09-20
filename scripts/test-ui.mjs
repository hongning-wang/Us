import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const engine=process.env.UI_BROWSER==='webkit'?webkit:chromium;
const browser=await engine.launch(engine===chromium?{channel:'chrome',headless:true}:{headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const composer=page.getByRole('textbox',{name:'Instagram message'});
const button=name=>page.getByRole('button',{name,exact:true});
const submit=async text=>{await composer.fill(text);await composer.press('Enter')};
const videos=page.locator('.sent-video');
async function waitVideos(count){await page.waitForFunction(n=>document.querySelectorAll('.sent-video').length===n,count)}
async function fits(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const box=await page.locator('.composer').boundingBox();assert(box&&box.y>=0&&box.y+box.height<=page.viewportSize().height,'composer fits viewport')}
try{
 const url=new URL(process.env.UI_BASE_URL||'http://127.0.0.1:5173');url.searchParams.set('preview','1');await page.goto(url.href,{waitUntil:'networkidle'});
 if(await button('Try the offline preview').count())await button('Try the offline preview').click();
 await submit('hello');await page.getByText('Try /us followed by an idea.',{exact:true}).waitFor();
 await submit('/us');await page.getByText('Add an idea after /us.',{exact:true}).waitFor();
 // Cancelling first-time setup must cancel the pending generation.
 await submit('/us a cancelled idea');await page.getByRole('dialog').waitFor();
 await button('Close Us settings').click();assert.equal(await composer.inputValue(),'/us a cancelled idea');
 await button('Photo setup').click();
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=300;c.getContext('2d').fillRect(0,0,300,300);return c.toDataURL('image/png').split(',')[1]});
 const upload={name:'test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
 await page.locator('input[type=file]').setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')});
 await page.getByRole('alert').filter({hasText:'Choose a JPG, PNG or WebP photo.'}).waitFor();
 await page.locator('input[type=file]').setInputFiles(upload);await button('Yes, that’s me').click();
 await button('Skip for now').click();assert.equal(await page.getByRole('dialog').count(),0);
 await page.waitForTimeout(3600);assert.equal(await videos.count(),0,'cancelled idea stays cancelled');
 // A text request, rapid second submission, and settings during generation.
 await submit('/us Imagine us in Tokyo');await page.getByRole('status').filter({hasText:'Generating…'}).waitFor();
 await composer.press('Enter');await button('Photo setup').click();await button('Close Us settings').click();
 await waitVideos(1);await page.waitForTimeout(700);assert.equal(await videos.count(),1,'one result per submission');
 const video=videos.first().locator('video');await video.evaluate(v=>v.play());await page.waitForTimeout(300);assert(await video.evaluate(v=>v.currentTime>0));await video.evaluate(v=>v.pause());
 // Reel personalization, continuation, and switching to a fresh text idea.
 await button('Reel').click();assert.equal(await composer.inputValue(),'/us Make this us');
 await composer.press('Enter');await waitVideos(2);
 await videos.last().getByRole('button',{name:'Continue',exact:true}).click();
 assert.equal(await composer.inputValue(),'/us What happens next?');await composer.press('Enter');await waitVideos(3);
 await button('Reply').click();await button('Text').click();assert.equal(await button('Cancel reply').count(),0);
 // Saved photos, replacement cancellation, friend photo, memory reset and reimport.
 await button('Settings').click();await page.getByText('Photo ready to use.',{exact:true}).waitFor();
 await button('Change photo').click();await button('Keep saved photo').click();await page.getByText('Photo ready to use.',{exact:true}).waitFor();
 await button('Friend photo').click();await page.locator('input[type=file]').setInputFiles(upload);await button('Use for this chat').click();
 await button('Your photo').click();await page.getByText('Photo ready to use.',{exact:true}).waitFor();
 await page.getByText('Chat memory',{exact:true}).click();await button('Reset memory').click();await page.getByText('0 messages · partial',{exact:false}).waitFor();
 await page.getByText('Photo ready to use.',{exact:true}).waitFor();await button('Index chat').click();await page.getByText('100 messages',{exact:false}).waitFor();
 await button('Close Us settings').click();
 await mkdir('artifacts',{recursive:true});
 for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375},{width:1440,height:950}]){
  await page.setViewportSize(viewport);await fits();await button('Settings').click();
  const close=await button('Close Us settings').boundingBox();assert(close&&close.x>=0&&close.x+close.width<=viewport.width,'dialog close button is onscreen');
  await button('Close Us settings').click();
 }
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:`artifacts/frontend-${process.env.UI_BROWSER||'chromium'}-mobile.png`});
 assert.deepEqual(errors,[]);console.log('UI passed: validation, setup/cancel, photo upload/replacement, text/Reel/continuation, single submission, settings during generation, playback, memory controls, mobile/landscape/desktop.');
}finally{await browser.close()}
