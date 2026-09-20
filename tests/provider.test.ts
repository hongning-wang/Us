import test from 'node:test';
import assert from 'node:assert/strict';
process.env.HONCHO_API_KEY='';process.env.SEEDANCE_API_KEY='';
const {SeedanceProvider}=await import('../apps/web/src/lib/server/seedance');
test('Seeddance adapter sends documented fields and preserves failed task status',async()=>{
 const original=globalThis.fetch;const calls:Array<{url:string;body:any}>=[];
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:init?.body&&JSON.parse(String(init.body))});return Response.json(init?.method==='POST'?{task_id:'task-one'}:{task_id:'task-one',status:'failed',error:{code:'generation_failed',message:'Could not generate'}})};
 try {
  const provider=new SeedanceProvider({baseUrl:'https://provider.test',apiKey:'fake',model:'seedance-2.5',pollIntervalMs:5});
  assert.equal(await provider.createTask({prompt:'test',duration:5,quality:'480p',imageUrls:['https://media.test/photo.jpg'],videoUrls:['https://media.test/selected-reel.mp4'],referenceMode:true}),'task-one');
  assert.deepEqual(calls[0].body,{model:'seedance-2.5',prompt:'test',duration:5,quality:'480p',image_urls:Array(3).fill('https://media.test/photo.jpg'),video_urls:['https://media.test/selected-reel.mp4']});
  assert.deepEqual(await provider.getTask('task-one'),{status:'failed',videoUrl:undefined,error:'Could not generate'});
 }finally{globalThis.fetch=original}
});

test('provider preserves HTTP rejection status even with a custom concurrency error code',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({error:{code:'concurrent_limit',message:'Your concurrent video generation limit has been reached.'}},{status:429});
 try{
  const provider=new SeedanceProvider({baseUrl:'https://provider.test',apiKey:'fake',model:'seedance-2.5',pollIntervalMs:5});
  await assert.rejects(provider.createTask({prompt:'test'}),(e:any)=>e.httpStatus===429&&e.code==='concurrent_limit');
 }finally{globalThis.fetch=original}
});
