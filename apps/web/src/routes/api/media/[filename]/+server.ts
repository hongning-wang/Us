import type {RequestHandler} from './$types';
import {handle} from '$lib/server/http';
import {ApiError} from '$lib/server/jobs';
import {isSafeFilename,mediaInfo,mediaBytes} from '$lib/server/media';

/** Database-backed bytes, including single HTTP ranges for native video playback. */
const serve:RequestHandler=async({params,request})=>{
 try{
  const filename=params.filename!;if(!isSafeFilename(filename))throw new ApiError(400,'Invalid media filename.');
  const asset=await mediaInfo(filename);if(!asset)throw new ApiError(404,'Media not found.');
  const headers=new Headers({'Content-Type':asset.contentType,'Content-Length':String(asset.byteLength),'Accept-Ranges':'bytes','ETag':'"'+asset.sha256+'"'});
  let start=0,end=asset.byteLength-1;const range=request.headers.get('range');
  if(range){
   const match=range.match(/^bytes=(\d*)-(\d*)$/);
   if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${asset.byteLength}`}});
   start=match[1]?Number(match[1]):Math.max(0,asset.byteLength-Number(match[2]));
   end=match[1]&&match[2]?Math.min(Number(match[2]),end):end;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=asset.byteLength)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${asset.byteLength}`}});
   headers.set('Content-Range',`bytes ${start}-${end}/${asset.byteLength}`);headers.set('Content-Length',String(end-start+1));
  }
  const bytes=request.method==='HEAD'?null:await mediaBytes(filename,start,end-start+1);
  if(request.method!=='HEAD'&&!bytes)throw new ApiError(404,'Media not found.');
  return new Response(bytes?new Uint8Array(bytes):null,{status:range?206:200,headers});
 }catch(e){return handle(e)}
};
export const GET=serve;
export const HEAD=serve;
