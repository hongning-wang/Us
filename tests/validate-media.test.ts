import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMedia} from '../apps/web/src/lib/server/validate-media';

test('media validation recovers transient connection and tunnel errors',async()=>{
 let calls=0;
 const request=(async()=>{calls++;if(calls===1)throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});return new Response(null,{status:calls===2?503:200,headers:{'content-type':'video/mp4'}})}) as typeof fetch;
 await validateMedia({videoUrls:['https://cdn.example/reel.mp4']},request,async()=>{});
 assert.equal(calls,3);
});

test('media validation identifies failed asset without exposing its signed URL',async()=>{
 let calls=0;
 const request=(async()=>{calls++;return new Response(null,{status:403})}) as typeof fetch;
 await assert.rejects(validateMedia({imageUrls:['https://media.example/photo.jpg?token=secret']},request,async()=>{}),error=>{
  assert.match((error as Error).message,/image reference from media.example \(HTTP 403\)/);
  assert.doesNotMatch((error as Error).message,/secret/);return true;
 });
 assert.equal(calls,1);
});
