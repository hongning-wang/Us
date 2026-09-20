import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {activeReelReference,captureReplyReference,ownVideoMessageId,parseReelVideoUrl,referenceFor,resolveReference,resolveVisibleReference,videoTracks} from '../apps/extension/src/references';

const PLAY='<img src="https://static.cdninstagram.com/rsrc.php/yb/r/playButton.png" width="24">';
const POSTER='https://scontent-bos5-1.cdninstagram.com/v/t15.3394-10/739762567_270902703506743.jpg?ig_cache_key=abc.def';
const msg=(author:string,inner:string)=>`<div role="group" tabindex="-1"><div aria-label="Reply to message from ${author}" role="button">reply</div><div role="article" aria-roledescription="message" tabindex="0">${inner}</div></div>`;
const videoMsg=(poster=POSTER)=>PLAY+`<img src="${poster}" width="236">`;
function dm(html:string,path='/direct/t/123/'){
 const {document}=parseHTML(`<html><body>${html}</body></html>`);
 (globalThis as any).document=document;(globalThis as any).location={pathname:path};
 for(const img of document.querySelectorAll('img'))Object.defineProperty(img,'width',{value:Number(img.getAttribute('width')||0),configurable:true});
 return document;
}
const articles=()=>[...(globalThis as any).document.querySelectorAll('[role=article]')] as HTMLElement[];
const setVideo=(v:any,props:Record<string,unknown>)=>{for(const [k,val] of Object.entries(props))Object.defineProperty(v,k,{value:val,configurable:true});};
const efgOf=(o:object)=>encodeURIComponent(Buffer.from(JSON.stringify(o)).toString('base64'));
const seg=(asset:number,{audio=false,dur=5,t=1000}={})=>({
 name:`https://scontent-bos5-1.cdninstagram.com/o1/v/t2/f2/${audio?'m78':'m367'}/A${asset}${audio?'a':'v'}.mp4?efg=${efgOf({vencode_tag:audio?'ig-xpvds.c2.dash_ln_heaac_vbr3_audio':'ig-xpvds.c2.dash_r2evevp9_q90',xpv_asset_id:asset,duration_s:dur})}&oh=00_x&bytestart=0&byteend=999`,
 startTime:t
});
const me={username:'me'};
const noReel=async()=>undefined;

test('own video messageId uses the attachmentKeys identity scheme with occurrence suffixes for repeated thumbnails',()=>{
 dm(msg('me',videoMsg())+msg('them',videoMsg())+msg('me','<span>hello</span>')+msg('me',videoMsg()));
 const [first,theirs,,second]=articles();
 const firstId=ownVideoMessageId(first,me);
 assert.ok(firstId&&!firstId.includes('#occurrence='));
 assert.equal(ownVideoMessageId(second,me),`${firstId}#occurrence=2`);
 assert.equal(ownVideoMessageId(theirs,me),undefined); // recipient videos never claim the sender's identity space
 assert.equal(referenceFor(second,me)?.messageId,`${firstId}#occurrence=2`);
});

test('captureReplyReference finds the replied article from the native reply control and ignores text/photo replies',()=>{
 const document=dm(msg('me',videoMsg())+msg('them','<span>plain text</span>')+msg('them',`<img src="${POSTER}" width="300">`));
 const buttons=[...document.querySelectorAll('[aria-label^="Reply to message from"]')] as HTMLElement[];
 const captured=captureReplyReference(buttons[0],me);
 assert.equal(captured?.reference.kind,'video');
 assert.equal(captured?.reference.messageId,ownVideoMessageId(articles()[0],me));
 assert.equal(captured?.conversationId,'123');
 assert.equal(captureReplyReference(buttons[1],me),undefined); // text reply: never a scene reference
 assert.equal(captureReplyReference(buttons[2],me),undefined); // photo reply: never a scene reference
 assert.equal(captureReplyReference(document.body as unknown as HTMLElement,me),undefined);
});

test('own unplayed Us video resolves url-less but preserves messageId so the bridge reuses persisted output',async()=>{
 dm(msg('me',videoMsg())+msg('me',videoMsg()));
 const second=articles()[1];
 const captured=captureReplyReference(second,me)!;
 const resolved=await resolveReference(captured,{entries:[]});
 assert.equal(resolved.url,undefined);
 assert.match(resolved.messageId!,/#occurrence=2$/);
});

test('unplayed recipient video fails clearly instead of guessing',async()=>{
 dm(msg('them',videoMsg()));
 const captured=captureReplyReference(articles()[0],me)!;
 await assert.rejects(resolveReference(captured,{entries:[seg(111),seg(222)]}),/Play this video/);
});

test('blob playback never borrows an unrelated page-wide video, even with the same duration',async()=>{
 const document=dm(msg('them',videoMsg()+'<video></video>'));
 setVideo(document.querySelector('video'),{currentSrc:'blob:https://www.instagram.com/x',duration:5.02});
 const captured=captureReplyReference(articles()[0],me)!;
 await assert.rejects(resolveReference(captured,{entries:[seg(111,{dur:5,t:5000})]}),/Replay this video/);
});

test('reel replies resolve the exact permalink and never borrow unrelated recently played media',async()=>{
 dm(msg('them','<a href="https://www.instagram.com/reel/ABC123xyz/">reel</a>'));
 const captured=captureReplyReference(articles()[0],me)!;
 const viaPage=await resolveReference(captured,{entries:[],fetchReel:async c=>c==='ABC123xyz'?'https://scontent.cdninstagram.com/v/reel.mp4?oh=1':undefined});
 assert.deepEqual([viaPage.mediaId,viaPage.url],['ABC123xyz','https://scontent.cdninstagram.com/v/reel.mp4?oh=1']);
 captured.capturedAt=100_000;
 await assert.rejects(resolveReference(captured,{entries:[seg(555,{t:95_000})],fetchReel:noReel}),/could not be read/);
});

test('captures never resolve against a different conversation',async()=>{
 dm(msg('them',videoMsg()));
 const captured=captureReplyReference(articles()[0],me)!;
 (globalThis as any).location={pathname:'/direct/t/999/'};
 await assert.rejects(resolveReference(captured,{entries:[]}),/different chat/);
});

test('activeReelReference targets the location shortcode and stays honest about ambiguity',async()=>{
 dm('',' /reels/XYZ789abc/'.trim());
 const viaPage=await activeReelReference({entries:[],fetchReel:async c=>c==='XYZ789abc'?'https://scontent.cdninstagram.com/v/r.mp4?oh=2':undefined});
 assert.deepEqual([viaPage.kind,viaPage.mediaId,viaPage.url],['reel','XYZ789abc','https://scontent.cdninstagram.com/v/r.mp4?oh=2']);
 await assert.rejects(activeReelReference({entries:[seg(777,{t:150_000})],now:200_000,fetchReel:noReel}),/could not be read/);
 await assert.rejects(activeReelReference({entries:[],now:200_000,fetchReel:noReel}),/could not be read/);
});

test('videoTracks dedupes renditions by asset id and keeps the newest url',()=>{
 const tracks=videoTracks([seg(888,{t:1000}),{...seg(888,{t:2000}),name:seg(888,{t:2000}).name.replace('m367','m368')},seg(888,{audio:true,t:3000})]);
 assert.equal(tracks.length,1);
 assert.ok(tracks[0].url.includes('m368'));
});

test('parseReelVideoUrl reads server-rendered payloads and og fallbacks',()=>{
 const json='{"video_versions":[{"type":101,"width":720,"url":"https:\\/\\/scontent.cdninstagram.com\\/o1\\/v\\/file.mp4?efg=x\\u0026oh=1"}]}';
 assert.equal(parseReelVideoUrl(json),'https://scontent.cdninstagram.com/o1/v/file.mp4?efg=x&oh=1');
 assert.equal(parseReelVideoUrl('<meta property="og:video" content="https://scontent.cdninstagram.com/v/og.mp4?a=1&amp;b=2">'),'https://scontent.cdninstagram.com/v/og.mp4?a=1&b=2');
 assert.equal(parseReelVideoUrl('<html>nothing here</html>'),undefined);
});

test('resolveVisibleReference keeps the legacy contract: clear error for non-media messages',async()=>{
 dm(msg('them','<span>hello</span>'));
 await assert.rejects(resolveVisibleReference(articles()[0],me),/not a video or Reel/);
});

test('shared Reel thumbnails resolve the exact media id without lossy numeric conversion',async()=>{
 const {shortcodeFromPoster,mediaIdFromShortcode}=await import('../apps/extension/src/references');
 const poster='https://scontent.cdninstagram.com/v/poster.jpg?ig_cache_key='+encodeURIComponent(btoa('3955307914729904366')+'.2-ccb7-5');
 assert.equal(shortcodeFromPoster(poster),'DbkE5eixFju');
 assert.equal(mediaIdFromShortcode('DbkE5eixFju'),'3955307914729904366');
 assert.equal(shortcodeFromPoster('https://example.com/unknown.jpg'),undefined);
 dm(msg('them',`<img width="200" src="${poster}"><svg aria-label="Clip"></svg>`));
 assert.equal(captureReplyReference(articles()[0],me)?.reference.url,'https://www.instagram.com/reel/DbkE5eixFju/');
});

test('media info requires the selected id and rejects unsupported videos before generation',async()=>{
 const {videoUrlFromMediaInfo}=await import('../apps/extension/src/references');
 const item={id:'3955307914729904366_545222141',video_duration:14.675,video_versions:[{url:'https://scontent.cdninstagram.com/v/selected.mp4',width:720,height:1280}]};
 assert.equal(videoUrlFromMediaInfo({items:[item]},'3955307914729904366'),item.video_versions[0].url);
 assert.equal(videoUrlFromMediaInfo({items:[item]},'1111111111111111111'),undefined);
 assert.throws(()=>videoUrlFromMediaInfo({items:[{...item,video_duration:31}]},'3955307914729904366'),/2 and 30 seconds/);
 assert.throws(()=>videoUrlFromMediaInfo({items:[{...item,video_versions:[{...item.video_versions[0],width:200}]}]},'3955307914729904366'),/size is not supported/);
});
