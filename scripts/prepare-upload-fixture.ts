// Developer-only native delivery check. Stop npm run dev before running this.
import {randomUUID} from 'node:crypto';
import {mutate,read} from '../apps/web/src/lib/server/store';
import {ensureFallbackMedia} from '../apps/web/src/lib/server/media';
let serverRunning=false;
try{await fetch('http://127.0.0.1:5173/api/setup',{signal:AbortSignal.timeout(500)});serverRunning=true}catch{}
if(serverRunning)throw Error('Stop npm run dev first so the durable store has one writer.');
const id=process.argv[2];const pair=read(s=>s.pairs[id]);
if(!pair)throw Error('Pass a configured conversation id.');
ensureFallbackMedia();
const jobId=randomUUID();
await mutate(s=>{s.jobs[jobId]={job:{...pair,id:jobId,storyId:randomUUID(),instruction:'Prerecorded upload check',status:'ready',phase:'deliver',outputUrl:'/api/media/fallback.mp4',isFallback:true,createdAt:new Date().toISOString()},internal:{stage:'deliver',attempts:0,warnings:[]}}});
console.log(JSON.stringify({jobId,conversationId:id,isFallback:true}));
