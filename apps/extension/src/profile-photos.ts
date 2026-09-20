import {browser} from 'wxt/browser';
import type {PhotoCandidate} from '../../../packages/shared/src/types';
export function instagramImageUrl(raw:string):boolean {
 try{const u=new URL(raw);return u.protocol==='https:'&&/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname)}catch{return false}
}
/** Read photos from the authenticated profile page, never infer who appears in a photo. */
export async function profilePhotos(username:string):Promise<PhotoCandidate[]> {
 if(!/^[\w.]{1,30}$/.test(username))throw Error('Invalid Instagram username.');
 const tab=await browser.tabs.create({url:'https://www.instagram.com/'+encodeURIComponent(username)+'/',active:false});
 if(!tab.id)throw Error('Could not open the profile.');
 try{
  for(let i=0;i<30;i++){const current=await browser.tabs.get(tab.id);if(current.status==='complete')break;await new Promise(r=>setTimeout(r,500));}
  const results=await browser.scripting.executeScript({target:{tabId:tab.id},args:[username],func:async(name:string)=>{
   if(location.pathname.replace(/\//g,'').toLowerCase()!==name.toLowerCase())return [];
   let defaultAvatar=false;
   const candidates:Array<{url:string;source:'profile'|'post';label:string}>=[];
   // Server-rendered profile metadata is matched to the requested username, not the viewer's avatar.
   function walk(value:any,depth=0){
    if(!value||typeof value!=='object'||depth>40)return;
    if(value.username?.toLowerCase()===name.toLowerCase()&&value.has_profile_pic===false)defaultAvatar=true;
    if(value.username?.toLowerCase()===name.toLowerCase()&&value.has_profile_pic!==false&&(value.profile_pic_url_hd||value.profile_pic_url))candidates.push({url:value.profile_pic_url_hd||value.profile_pic_url,source:'profile',label:'Profile photo'});
    for(const child of Object.values(value))walk(child,depth+1);
   }
   for(const script of document.querySelectorAll('script[type="application/json"]')){try{walk(JSON.parse(script.textContent||''))}catch{}}
   for(let attempt=0;attempt<16;attempt++){
    const main=document.querySelector('main,[role=main]')||document;
    if(!defaultAvatar&&!candidates.some(c=>c.source==='profile')){
     const avatar=[...main.querySelectorAll<HTMLImageElement>('img')].find(img=>img.alt.toLowerCase()===`${name.toLowerCase()}'s profile picture`);
     if(avatar)candidates.push({url:avatar.src,source:'profile',label:'Profile photo'});
    }
    for(const anchor of main.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"]')){
     const img=anchor.querySelector<HTMLImageElement>('img');
     // Only still-image posts: skip video thumbnails in the grid.
     if(!img||anchor.querySelector('svg[aria-label="Clip"],svg[aria-label="Reel"],svg[aria-label="Video"]'))continue;
     if(!candidates.some(c=>c.url===img.src))candidates.push({url:img.src,source:'post',label:'Recent post'});
     if(candidates.filter(c=>c.source==='post').length>=6)break;
    }
    if(candidates.some(c=>c.source==='post'))break;
    await new Promise(r=>setTimeout(r,500));
   }
   return candidates.filter(c=>!defaultAvatar||c.source!=='profile');
  }});
  return (results[0]?.result||[]).filter(c=>instagramImageUrl(c.url)).filter((c,i,all)=>all.findIndex(x=>x.url===c.url)===i).slice(0,7);
 }finally{await browser.tabs.remove(tab.id).catch(()=>{});}
}
export async function photoBytes(url:string){
 if(!instagramImageUrl(url))throw Error('Choose an Instagram photo or upload your own.');
 const response=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('This photo expired. Reload the suggestions or upload a photo.');
 const blob=await response.blob();if(!['image/jpeg','image/png','image/webp'].includes(blob.type)||blob.size>10*1024*1024)throw Error('Choose a JPG, PNG or WebP under 10 MB.');
 let binary='';const bytes=new Uint8Array(await blob.arrayBuffer());for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return {data:btoa(binary),mime:blob.type};
}
