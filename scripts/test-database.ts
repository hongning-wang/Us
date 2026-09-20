// Exercises the real Postgres constraints inside one transaction, then rolls everything back.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,closeDatabase} from '../apps/web/src/lib/server/postgres';
const client=await database().connect();
try{
 await client.query('BEGIN');
 const asset='test-'+randomUUID()+'.jpg';
 await client.query('INSERT INTO public.media_assets(filename,content_type,byte_length,sha256,content) VALUES($1,$2,3,$3,$4)',[asset,'image/jpeg','0'.repeat(64),Buffer.from('abc')]);
 const a='test-'+randomUUID(),b='test-'+randomUUID(),outsider='test-'+randomUUID(),chat='test-'+randomUUID(),story=randomUUID();
 for(const id of [a,b,outsider])await client.query('INSERT INTO public.accounts(id,username,display_name) VALUES($1,$1,$1)',[id]);
 await client.query('INSERT INTO public.chats(id,instagram_thread_id,owner_id) VALUES($1,$1,$2)',[chat,a]);
 for(const id of [a,b])await client.query('INSERT INTO public.chat_participants(chat_id,account_id) VALUES($1,$2)',[chat,id]);
 await client.query('INSERT INTO public.stories(id,chat_id) VALUES($1,$2)',[story,chat]);
 const sql="INSERT INTO public.jobs(id,chat_id,sender_id,recipient_id,instruction,story_id,idempotency_key,status,created_at,stage,attempts) VALUES($1,$2,$3,$4,'mock',$5,$6,'generating',now(),'spec',1)";
 await client.query(sql,[randomUUID(),chat,a,b,story,'one-request']);
 const rejects=async(work:()=>Promise<unknown>,code:string)=>{await client.query('SAVEPOINT expected_failure');try{await assert.rejects(work,(e:unknown)=>(e as {code:string}).code===code)}finally{await client.query('ROLLBACK TO SAVEPOINT expected_failure')}};
 await rejects(()=>client.query(sql,[randomUUID(),chat,a,b,story,'one-request']),'23505');
 await rejects(()=>client.query(sql,[randomUUID(),chat,a,outsider,story,'wrong-person']),'23503');
 await rejects(()=>client.query("INSERT INTO public.identity_photos(account_id,filename,content_type,confirmed_at) VALUES($1,$2,'image/jpeg',now())",['unknown-'+randomUUID(),asset]),'23503');
 await client.query('INSERT INTO public.history_imports(chat_id) VALUES($1)',[chat]);
 await client.query("INSERT INTO public.imported_messages(chat_id,source_message_id) VALUES($1,'message-one')",[chat]);
 await rejects(()=>client.query("INSERT INTO public.imported_messages(chat_id,source_message_id) VALUES($1,'message-one')",[chat]),'23505');
 await client.query("INSERT INTO public.chat_reference_photos(chat_id,participant_id,confirmed_by,filename,content_type,confirmed_at) VALUES($1,$2,$3,$4,'image/jpeg',now())",[chat,b,a,asset]);
 await rejects(()=>client.query('UPDATE public.chat_reference_photos SET participant_id=$1 WHERE chat_id=$2',[outsider,chat]),'23503');
 await rejects(()=>client.query('UPDATE public.chat_reference_photos SET confirmed_by=$1 WHERE chat_id=$2',[outsider,chat]),'23503');
 const rls=(await client.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relrowsecurity",[['accounts','chats','chat_participants','identity_photos','media_assets','chat_reference_photos','history_imports','imported_messages','memory_sessions','stories','jobs']])).rows[0].n;
 assert.equal(rls,11);
 console.log('Database checks passed: foreign keys, participant ownership, job idempotency, message deduplication, and RLS. Test rows rolled back.');
}finally{await client.query('ROLLBACK');client.release();await closeDatabase();}
