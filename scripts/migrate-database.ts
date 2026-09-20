import {closeDatabase,createSchema,database} from '../apps/web/src/lib/server/postgres';
try{
 await createSchema();
 const tables=['accounts','chats','chat_participants','identity_photos','chat_reference_photos','history_imports','imported_messages','memory_sessions','stories','jobs','media_assets'];
 const counts=[];for(const table of tables)counts.push({table,rows:(await database().query('SELECT count(*)::int AS n FROM public.'+table)).rows[0].n});
 console.log(JSON.stringify({migrated:true,schema:'public',tables:counts}));
}catch(e){console.error('Migration failed:',(e as Error).message);process.exitCode=1}finally{await closeDatabase()}
