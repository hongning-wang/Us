import {createHash,randomUUID} from 'node:crypto';
import {json} from '@sveltejs/kit';
import type {RequestHandler} from './$types';
import {putMedia} from '$lib/server/media';
import {getPair} from '$lib/server/store';
// Only an explicitly selected, already loaded video is copied from Instagram.
export const POST:RequestHandler=async({request})=>{
 const form=await request.formData();const conversationId=String(form.get('conversationId')||'');
 if(!getPair(conversationId))return json({error:'Set up this chat first.'},{status:400});
 const file=form.get('file');if(!(file instanceof File)||!['video/mp4','video/quicktime','video/webm'].includes(file.type))return json({error:'This reference is not a supported video.'},{status:415});
 if(file.size===0||file.size>30*1024*1024)return json({error:'Choose a video under 30 MB.'},{status:413});
 const bytes=Buffer.from(await file.arrayBuffer());
 const hash=createHash('sha256').update(bytes).digest('hex');const ext=file.type==='video/quicktime'?'mov':file.type==='video/webm'?'webm':'mp4';
 const filename=`ref-${randomUUID()}-${hash.slice(0,10)}.${ext}`;await putMedia(filename,bytes,file.type);
 return json({url:`/api/media/${filename}`});
};
