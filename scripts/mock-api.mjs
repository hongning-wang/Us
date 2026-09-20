import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Standalone, loopback-only test bridge. Never loads .env, credentials, or providers.
export async function startMockApi({port=5175,delayMs=600}={}) {
 const pair={conversationId:'test',sender:{id:'me',username:'me',name:'Me'},recipient:{id:'friend',username:'friend',name:'Friend'}};
 const setup={pair,photoConfirmed:true,recipientPhotoConfirmed:true,importComplete:false,importedCount:56,memoryStatus:'mock'};
 const photos=new Set(['me']);
 const histories=new Map();
 const setups=new Map([['me:test',setup]]);
 const photoPosts=[];const photoMedia=new Map();
 const jobs=[],creates=[],deliveryPosts=[],keys=new Map();
 const video=readFileSync(new URL('../apps/web/static/fixture.mp4',import.meta.url));
 const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  const url=new URL(req.url,'http://localhost');
  const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  try {
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const bytes=Buffer.concat(chunks);let body={};
   if(req.headers['content-type']?.startsWith('multipart/form-data')){
    const form=await new Request(url,{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:bytes}).formData();
    const file=form.get('file');body={fields:Object.fromEntries([...form].filter(([key])=>key!=='file')),upload:{data:Buffer.from(await file.arrayBuffer()).toString('base64'),type:file.type}};
   }else if(bytes.length)body=JSON.parse(bytes.toString());
   if(url.pathname==='/__mock')return json({mock:true,creates,jobs,deliveryPosts});
   if(url.pathname==='/api/setup'){
    if(req.method==='POST'){const next={...setup,pair:body,photoConfirmed:photos.has(body.sender.id),recipientPhotoConfirmed:false,importedCount:0};setups.set(body.conversationId,next);return json(next);}
    return json(setups.get(url.searchParams.get('conversationId'))||{...setup,pair:undefined,photoConfirmed:false,importedCount:0});
   }
   if(url.pathname==='/api/photo'){
    const {conversationId,participantId,scope,confirmed}=body.fields||{};const current=setups.get(conversationId);
    if(!current||confirmed!=='true')return json({error:'Confirmation required'},400);
    if(participantId===current.pair.sender.id){photos.add(participantId);current.photoConfirmed=true;}
    else if(scope==='chat'&&participantId===current.pair.recipient.id)current.recipientPhotoConfirmed=true;
    else return json({error:'Wrong participant'},403);
    const photoPath='/api/media/mock-photo-'+photoPosts.length+'.png';photoMedia.set(photoPath,{bytes:Buffer.from(body.upload.data,'base64'),type:body.upload.type});
    if(participantId===current.pair.sender.id)current.photoUrl=photoPath;else current.recipientPhotoUrl=photoPath;
    photoPosts.push({conversationId,participantId,scope});return json(current);
   }
   if(url.pathname==='/api/history'){
    const current=setups.get(body.conversationId);if(!current)return json({error:'Configure chat first'},404);
    const ids=histories.get(body.conversationId)||new Set();for(const m of body.messages||[])ids.add(m.id);histories.set(body.conversationId,ids);
    current.importedCount=ids.size;current.importComplete=current.importComplete||body.complete;return json(current);
   }
   if(photoMedia.has(url.pathname)){const media=photoMedia.get(url.pathname);res.writeHead(200,{'Content-Type':media.type});return res.end(media.bytes);}
   if(url.pathname==='/api/media/fixture.mp4'){res.writeHead(200,{'Content-Type':'video/mp4'});return res.end(video);}
   if(url.pathname==='/api/jobs'&&req.method==='GET')return json(jobs.filter(j=>j.conversationId===url.searchParams.get('conversationId')));
   if(url.pathname==='/api/jobs'&&req.method==='POST'){
    const key=body.conversationId+':'+body.idempotencyKey;
    if(keys.has(key))return json(keys.get(key));
    const parent=jobs.find(j=>j.id===body.reference?.parentJobId);
    const job={...body,id:'fixture-job-'+(creates.length+1),storyId:parent?.storyId||'story-'+(creates.length+1),parentId:parent?.id,status:'generating',phase:'generate',isFallback:true,sceneSummary:'Prerecorded mock · not AI generated',createdAt:new Date().toISOString()};
    creates.push(body);jobs.unshift(job);keys.set(key,job);
    setTimeout(()=>Object.assign(job,{status:'ready',phase:'deliver',outputUrl:'/api/media/fixture.mp4'}),delayMs).unref();
    return json(job);
   }
   const action=url.pathname.match(/^\/api\/jobs\/([^/]+)\/(retry|fallback)$/);
   if(action&&req.method==='POST'){
    const job=jobs.find(j=>j.id===action[1]);if(!job)return json({error:'Unknown mock job'},404);
    Object.assign(job,{status:'ready',error:undefined,outputUrl:'/api/media/fixture.mp4',isFallback:action[2]==='fallback'});return json(job);
   }
   const delivery=url.pathname.match(/^\/api\/jobs\/([^/]+)\/delivery$/);
   if(delivery&&req.method==='POST'){
    const job=jobs.find(j=>j.id===delivery[1]);if(!job)return json({error:'Unknown mock job'},404);
    deliveryPosts.push({jobId:job.id,...body});
    Object.assign(job,{status:body.status,phase:body.status==='sent'?'done':'deliver',deliveryMessageId:body.messageId});return json(job);
   }
   return json({error:'Unknown mock endpoint'},404);
  }catch(error){json({error:error.message},400);}
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {baseUrl:`http://127.0.0.1:${server.address().port}`,state:{creates,jobs,deliveryPosts,photoPosts},close:()=>new Promise(resolve=>server.close(resolve))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const api=await startMockApi();console.log(`Mock API: ${api.baseUrl} — prerecorded fixture only; no external API calls.`);
}
