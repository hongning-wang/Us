import type { UsBridge, Setup, Pair, Job, CreateJob } from '../../shared/src/types';
export const reviewPair: Pair = { conversationId:'preview-friend', sender:{id:'preview-you',username:'you',name:'You'}, recipient:{id:'preview-friend',username:'friend',name:'Friend'} };
export function reviewBridge(photoConfirmed = true): UsBridge {
 let setup: Setup = { pair: reviewPair, photoConfirmed, importedCount:100,importComplete:true,memoryStatus:'Preview data' };
 let jobs: Job[] = [];
 const update = (id:string, data:Partial<Job>) => { const job=jobs.find(j=>j.id===id);if(!job)throw Error('Video not found.');Object.assign(job,data);return {...job}; };
 const finish = (id:string) => setTimeout(()=>update(id,{status:'ready',outputUrl:'/fixture.mp4',isFallback:true}),3200);
 return {
  async getSetup(){return {...setup}}, async configure(pair){setup.pair=pair;return {...setup}},
  async confirmPhoto(file,participantId=reviewPair.sender.id){if(participantId===reviewPair.sender.id){if(setup.photoUrl)URL.revokeObjectURL(setup.photoUrl);setup.photoUrl=URL.createObjectURL(file);setup.photoConfirmed=true}else{if(setup.recipientPhotoUrl)URL.revokeObjectURL(setup.recipientPhotoUrl);setup.recipientPhotoUrl=URL.createObjectURL(file);setup.recipientPhotoConfirmed=true}return {...setup}},
  async importHistory(){setup.importedCount=100;setup.importComplete=true;return {...setup}},
  async resetHistory(){setup.importedCount=0;setup.importComplete=false;return {...setup}},
  async listJobs(){return jobs.map(j=>({...j}))},
  async createJob(input:CreateJob){const parent=jobs.find(j=>j.id===input.reference?.parentJobId);const job:Job={...input,id:crypto.randomUUID(),storyId:parent?.storyId||crypto.randomUUID(),parentId:parent?.id,status:'generating',createdAt:new Date().toISOString()};jobs=[job,...jobs];finish(job.id);return {...job}},
  async retryJob(id){finish(id);return update(id,{status:'generating',error:undefined})},
  async sendJob(){throw Error('This is a preview. Open Instagram to send a real video.')},
  async useFallback(id){return update(id,{status:'ready',outputUrl:'/fixture.mp4',isFallback:true})}
 };
}
