import {Pool,type PoolClient,type QueryResult} from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {REPO_ROOT,env} from './env';
import type {StoreShape,JobRecord} from './store';

let pool:Pool|undefined;
export function database(){
 if(!env.databaseUrl)throw Error('DATABASE_URL is not configured.');
 return pool??=new Pool({connectionString:env.databaseUrl,max:3,connectionTimeoutMillis:8000,idleTimeoutMillis:10000,ssl:{rejectUnauthorized:true,ca:[...rootCertificates,readFileSync(join(REPO_ROOT,'apps/web/certs/supabase-ca.crt'),'utf8')]}});
}
export async function closeDatabase(){await pool?.end();pool=undefined;}
export async function createSchema(){const dir=join(REPO_ROOT,'apps/web/migrations');for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await database().query(readFileSync(join(dir,name),'utf8'));}
export const emptySnapshot=():StoreShape=>({version:1,pairs:{},photos:{},chatPhotos:{},history:{},jobs:{},idempotency:{},memory:{}});
const iso=(value:Date|string)=>new Date(value).toISOString();
const optional=<T>(v:T|null):T|undefined=>v===null?undefined:v;
const changed=(a:unknown,b:unknown)=>JSON.stringify(a)!==JSON.stringify(b);

async function readTables(client:PoolClient):Promise<StoreShape>{
 const result=await client.query(`SELECT * FROM public.accounts; SELECT * FROM public.chats;
 SELECT * FROM public.chat_participants; SELECT * FROM public.identity_photos;
 SELECT * FROM public.history_imports; SELECT * FROM public.imported_messages;
 SELECT * FROM public.memory_sessions; SELECT * FROM public.jobs; SELECT * FROM public.chat_reference_photos;`) as unknown as QueryResult[];
 const [accounts,chats,participants,photos,histories,messages,memories,jobs,chatPhotos]=result.map(r=>r.rows);
 const s=emptySnapshot();
 const people=new Map(accounts.map(r=>[r.id,{id:r.id,username:r.username,name:r.display_name}]));
 for(const r of chats){
  const sender=people.get(r.owner_id),recipientId=participants.find(p=>p.chat_id===r.id&&p.account_id!==r.owner_id)?.account_id,recipient=people.get(recipientId);
  if(!sender||!recipient)throw Error('Chat is missing its participants.');
  s.pairs[r.id]={conversationId:r.id,sender,recipient};
 }
 for(const r of photos)s.photos[r.account_id]={filename:r.filename,contentType:r.content_type,confirmedAt:iso(r.confirmed_at)};
 for(const r of chatPhotos)s.chatPhotos[r.chat_id]={participantId:r.participant_id,confirmedBy:r.confirmed_by,filename:r.filename,contentType:r.content_type,confirmedAt:iso(r.confirmed_at)};
 for(const r of histories)s.history[r.chat_id]={ids:{},count:0,complete:r.complete,updatedAt:iso(r.updated_at)};
 for(const r of messages){const h=s.history[r.chat_id];if(r.pending)(h.pendingIds??=[]).push(r.source_message_id);else{h.ids[r.source_message_id]=true;h.count++;}}
 for(const r of memories)s.memory[r.chat_id]={sessionId:r.honcho_session_id,generation:r.generation,status:r.status,lastError:optional(r.last_error)};
 for(const r of jobs){
  const pair=s.pairs[r.chat_id];if(!pair)throw Error('Job has no chat.');
  s.jobs[r.id]={job:{...pair,id:r.id,instruction:r.instruction,storyId:r.story_id,parentId:optional(r.parent_job_id),sceneSummary:optional(r.scene_summary),status:r.status,phase:optional(r.phase),outputUrl:optional(r.output_url),error:optional(r.error),fallbackUrl:optional(r.fallback_url),isFallback:r.is_fallback,createdAt:iso(r.created_at),deliveryMessageId:optional(r.delivery_message_id),reference:r.reference_kind?{kind:r.reference_kind,mediaId:r.reference_media_id,url:optional(r.reference_url),messageId:optional(r.reference_message_id),parentJobId:optional(r.reference_parent_job_id)}:undefined},internal:{idempotencyKey:optional(r.idempotency_key),stage:r.stage,attempts:r.attempts,spec:optional(r.generation_spec),provider:optional(r.provider),providerTaskId:optional(r.provider_task_id),providerStatus:optional(r.provider_status),submissionUncertain:r.submission_uncertain,deliveryUncertain:r.delivery_uncertain,warnings:r.warnings,deadline:r.deadline_ms===null?undefined:Number(r.deadline_ms),abandoned:r.abandoned,memoryUsed:r.memory_used}};
  if(r.idempotency_key)s.idempotency[r.chat_id+':'+r.idempotency_key]=r.id;
 }
 return s;
}
export async function loadSnapshot():Promise<StoreShape>{
 const client=await database().connect();
 try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const state=await readTables(client);await client.query('COMMIT');return state;}
 catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
async function upsert(client:PoolClient,table:string,key:string[],row:Record<string,unknown>){
 // Table/column names below are code constants; all values are parameterized.
 const columns=Object.keys(row),updates=columns.filter(c=>!key.includes(c));
 await client.query(`INSERT INTO public.${table} (${columns.join(',')}) VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT (${key.join(',')}) DO UPDATE SET ${updates.map(c=>c+'=EXCLUDED.'+c).join(',')}`,Object.values(row).map(v=>v===undefined?null:v));
}
function jobRow({job:j,internal:i}:JobRecord){return {
 id:j.id,chat_id:j.conversationId,sender_id:j.sender.id,recipient_id:j.recipient.id,instruction:j.instruction,story_id:j.storyId,parent_job_id:j.parentId,idempotency_key:i.idempotencyKey,status:j.status,phase:j.phase,scene_summary:j.sceneSummary,
 reference_kind:j.reference?.kind,reference_media_id:j.reference?.mediaId,reference_url:j.reference?.url,reference_message_id:j.reference?.messageId,reference_parent_job_id:j.reference?.parentJobId,
 output_url:j.outputUrl,fallback_url:j.fallbackUrl,is_fallback:Boolean(j.isFallback),error:j.error,delivery_message_id:j.deliveryMessageId,created_at:j.createdAt,
 stage:i.stage,attempts:i.attempts,generation_spec:i.spec?JSON.stringify(i.spec):null,provider:i.provider,provider_task_id:i.providerTaskId,provider_status:i.providerStatus,submission_uncertain:Boolean(i.submissionUncertain),delivery_uncertain:Boolean(i.deliveryUncertain),warnings:i.warnings,deadline_ms:i.deadline,abandoned:Boolean(i.abandoned),memory_used:Boolean(i.memoryUsed)
};}
async function persistChanges(client:PoolClient,before:StoreShape,state:StoreShape){
 for(const [id,pair] of Object.entries(state.pairs))if(changed(before.pairs[id],pair)){
  for(const person of [pair.sender,pair.recipient])await upsert(client,'accounts',['id'],{id:person.id,username:person.username,display_name:person.name});
  await upsert(client,'chats',['id'],{id,instagram_thread_id:id.startsWith(pair.sender.id+':')?id.slice(pair.sender.id.length+1):id,owner_id:pair.sender.id});
  for(const person of [pair.sender,pair.recipient])await client.query('INSERT INTO public.chat_participants(chat_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,person.id]);
 }
 for(const [account,photo] of Object.entries(state.photos))if(changed(before.photos[account],photo))await upsert(client,'identity_photos',['account_id'],{account_id:account,filename:photo.filename,content_type:photo.contentType,confirmed_at:photo.confirmedAt});
 for(const [id,photo] of Object.entries(state.chatPhotos))if(changed(before.chatPhotos[id],photo))await upsert(client,'chat_reference_photos',['chat_id'],{chat_id:id,participant_id:photo.participantId,confirmed_by:photo.confirmedBy,filename:photo.filename,content_type:photo.contentType,confirmed_at:photo.confirmedAt});
 for(const [id,memory] of Object.entries(state.memory))if(changed(before.memory[id],memory))await upsert(client,'memory_sessions',['chat_id'],{chat_id:id,honcho_session_id:memory.sessionId,generation:memory.generation,status:memory.status,last_error:memory.lastError});
 for(const id of Object.keys(before.history))if(!state.history[id])await client.query('DELETE FROM public.history_imports WHERE chat_id=$1',[id]);
 for(const [id,history] of Object.entries(state.history))if(changed(before.history[id],history)){
  await upsert(client,'history_imports',['chat_id'],{chat_id:id,complete:history.complete,updated_at:history.updatedAt||new Date().toISOString()});
  const rows=[...Object.keys(history.ids).map(id=>({id,pending:false})),...(history.pendingIds||[]).filter(key=>!history.ids[key]).map(id=>({id,pending:true}))];
  await client.query('DELETE FROM public.imported_messages WHERE chat_id=$1 AND NOT(source_message_id=ANY($2::text[]))',[id,rows.map(r=>r.id)]);
  if(rows.length)await client.query(`INSERT INTO public.imported_messages(chat_id,source_message_id,pending) SELECT $1,x.id,x.pending FROM jsonb_to_recordset($2::jsonb) AS x(id text,pending boolean) ON CONFLICT(chat_id,source_message_id) DO UPDATE SET pending=EXCLUDED.pending`,[id,JSON.stringify(rows)]);
 }
 for(const [id,rec] of Object.entries(state.jobs))if(changed(before.jobs[id],rec)){
  await client.query('INSERT INTO public.stories(id,chat_id,created_at) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[rec.job.storyId,rec.job.conversationId,rec.job.createdAt]);
  await upsert(client,'jobs',['id'],jobRow(rec));
 }
}
export async function changeSnapshot<T>(fn:(state:StoreShape)=>T):Promise<{state:StoreShape;result:T}>{
 const client=await database().connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(197049,1)');
  const state=await readTables(client),before=structuredClone(state);const result=fn(state);
  await persistChanges(client,before,state);await client.query('COMMIT');return {state,result};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
