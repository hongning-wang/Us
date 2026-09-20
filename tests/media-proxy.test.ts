import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mediaProxy} from '../scripts/media-proxy.mjs';
test('public proxy serves media ranges and blocks every application write and API',async()=>{
 let hits=0;
 const source=createServer((req,res)=>{hits++;res.writeHead(206,{'Content-Type':'video/mp4','Content-Range':'bytes 0-3/10'});res.end('data')});
 await new Promise<void>(r=>source.listen(0,'127.0.0.1',r));
 const proxy=mediaProxy(`http://127.0.0.1:${(source.address() as any).port}`);
 await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(proxy.address() as any).port}`;
 try {
  const result=await fetch(base+'/api/media/video-test.mp4',{headers:{Range:'bytes=0-3'}});
  assert.equal(result.status,206);assert.equal(await result.text(),'data');
  for(const path of ['/api/setup','/api/jobs','/api/history','/api/media/%2e%2e/jobs','/api/media/a..mp4'])assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+'/api/media/video-test.mp4',{method:'POST'})).status,404);
  assert.equal(hits,1);
 }finally{proxy.closeAllConnections();source.closeAllConnections();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>source.close(r))]);}
});
