import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {database} from './postgres';
import {env} from './env';

type Asset={contentType:string;byteLength:number;sha256:string;content:Buffer};
const fixtures=new Map<string,Asset>();
const testing=()=>process.env.NODE_ENV==='test'&&process.env.US_TEST_STORE==='memory';
export function safeSegment(s:string){return s.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)||'x'}
export function isSafeFilename(name:string){return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(name)&&!name.includes('..')}
function requireName(name:string){if(!isSafeFilename(name))throw Error('Invalid media filename.');}
export function photoFilename(_conversationId:string,_participantId:string,ext:string){return `photo-${randomUUID()}.${ext.replace(/[^a-z0-9]/gi,'').toLowerCase()||'jpg'}`}
export function videoFilename(jobId:string){return `video-${safeSegment(jobId)}.mp4`}
export const FALLBACK_FILENAME='fallback.mp4';
const TYPES:Record<string,string>={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'};
export function contentTypeFor(filename:string){return TYPES[filename.split('.').pop()?.toLowerCase()||'']||'application/octet-stream'}

/** Immutable named assets: bytes are stored separately from frequently-read app records. */
export async function putMedia(filename:string,content:Buffer,contentType=contentTypeFor(filename)):Promise<void>{
 requireName(filename);
 if(!content.length||content.length>50*1024*1024)throw Error('Media must be between 1 byte and 50 MB.');
 const sha256=createHash('sha256').update(content).digest('hex');
 if(testing()){
  const old=fixtures.get(filename);if(old&&old.sha256!==sha256)throw Error('Media filename already contains different bytes.');
  fixtures.set(filename,{content:Buffer.from(content),contentType,byteLength:content.length,sha256});return;
 }
 await database().query('INSERT INTO public.media_assets(filename,content_type,byte_length,sha256,content) VALUES($1,$2,$3,$4,$5) ON CONFLICT(filename) DO NOTHING',[filename,contentType,content.length,sha256,content]);
 const saved=await mediaInfo(filename);if(saved?.sha256!==sha256)throw Error('Media verification failed: filename already contains different bytes.');
}
export async function mediaInfo(filename:string):Promise<Omit<Asset,'content'>|undefined>{
 requireName(filename);
 if(testing()){const a=fixtures.get(filename);return a?{contentType:a.contentType,byteLength:a.byteLength,sha256:a.sha256}:undefined;}
 const row=(await database().query('SELECT content_type,byte_length,sha256 FROM public.media_assets WHERE filename=$1',[filename])).rows[0];
 return row?{contentType:row.content_type,byteLength:row.byte_length,sha256:row.sha256}:undefined;
}
export async function mediaBytes(filename:string,start=0,length?:number):Promise<Buffer|undefined>{
 requireName(filename);
 if(!Number.isSafeInteger(start)||start<0||length!==undefined&&(!Number.isSafeInteger(length)||length<0))throw Error('Invalid media range.');
 if(testing())return fixtures.get(filename)?.content.subarray(start,length===undefined?undefined:start+length);
 const row=(await database().query('SELECT substring(content FROM $2::integer FOR COALESCE($3::integer,byte_length)) AS content FROM public.media_assets WHERE filename=$1',[filename,start+1,length??null])).rows[0];
 return row?.content;
}
/** The bundled prerecorded fixture is seeded once; user assets never use the filesystem. */
export async function ensureFallbackMedia(){
 if(!(await mediaInfo(FALLBACK_FILENAME))&&existsSync(env.fallbackVideo))await putMedia(FALLBACK_FILENAME,readFileSync(env.fallbackVideo));
}
export function publicMediaUrl(filename:string):string|null{
 const base=(process.env.PUBLIC_MEDIA_BASE??env.publicMediaBase).replace(/\/+$/,'');
 return base?`${base}/api/media/${filename}`:null;
}
