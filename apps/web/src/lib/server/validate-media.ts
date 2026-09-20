import {setTimeout as delay} from 'node:timers/promises';

/** Retry temporary tunnel/CDN failures before spending generation credits. */
export async function validateMedia(input:{imageUrls?:string[];videoUrls?:string[]}, request:typeof fetch=fetch, wait:()=>Promise<unknown>=()=>delay(500)) {
 for(const [kind,urls] of [['image',input.imageUrls],['video',input.videoUrls]] as const){
  for(const url of urls||[]){
   let failure='';
   for(let attempt=0;attempt<3;attempt++){
    let retry=false;
    try{
     const response=await request(url,{method:'HEAD',signal:AbortSignal.timeout(15000)});
     if(response.ok&&response.headers.get('content-type')?.startsWith(kind+'/')){failure='';break;}
     failure=response.ok?'unexpected content type':`HTTP ${response.status}`;
     retry=response.status===429||response.status>=500;
    }catch(error){
     const cause=(error as Error&{cause?:{code?:string}}).cause?.code;
     failure=cause||'connection failed';retry=true;
    }
    if(!retry||attempt===2)break;
    await wait();
   }
   if(failure)throw Error(`Could not fetch the ${kind} reference from ${new URL(url).hostname} (${failure}). Check the media connection and retry.`);
  }
 }
}
