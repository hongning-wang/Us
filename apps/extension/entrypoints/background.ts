import {profilePhotos,photoBytes} from '../src/profile-photos';
import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import {API_BASE as BASE} from '../src/config';
export default defineBackground(()=>{
 browser.runtime.onMessage.addListener(async (message,sender)=>{
  if(!sender.tab?.url?.startsWith('https://www.instagram.com/'))return;
  if(message.type==='us-profile-photos'||message.type==='us-photo-file'){try{return {data:message.type==='us-profile-photos'?await profilePhotos(message.username):await photoBytes(message.url)}}catch(e){return {error:(e as Error).message}}}
  if(message.type!=='us-api')return;
  try{
   const {path,method='GET',body}=message;
   if(typeof path!=='string'||!/^\/api\/(setup|photo|history|jobs|media|references)([/?]|$)/.test(path)||path.includes('..'))throw Error('Unsupported request.');
   const headers:Record<string,string>={};let payload:BodyInit|undefined;
   if(body?.upload){const form=new FormData();for(const [key,value]of Object.entries(body.fields||{}))form.set(key,String(value));const bytes=Uint8Array.from(atob(body.upload.data),c=>c.charCodeAt(0));form.set('file',new Blob([bytes],{type:body.upload.type}),body.upload.name);payload=form;}
   else if(body!==undefined){headers['content-type']='application/json';payload=JSON.stringify(body);}
   const response=await fetch(BASE+path,{method,headers,body:payload,signal:AbortSignal.timeout(30000)});
   if(message.binary){if(!response.ok)throw Error('Video download failed.');const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>30*1024*1024)throw Error('Video is too large to attach in this demo.');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {data:btoa(binary),mime:response.headers.get('content-type')};}
   const data=await response.json();if(!response.ok)throw Error(typeof data.error==='string'?data.error:data.message||'Request failed.');return {data};
  }catch(e){return {error:(e as Error).message};}
 });
});
