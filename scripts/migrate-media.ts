import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createSchema,closeDatabase,database} from '../apps/web/src/lib/server/postgres';
import {isSafeFilename,putMedia,mediaBytes,mediaInfo} from '../apps/web/src/lib/server/media';
// Explicit one-time import, never a runtime fallback. Originals are retained for verification.
if(!process.argv[2])throw Error('Pass the source media directory explicitly.');
const directory=resolve(process.argv[2]);
try{
 await database().query(readFileSync(new URL('../apps/web/migrations/003_media_assets.sql',import.meta.url),'utf8'));let total=0,count=0;
 if(!existsSync(directory))throw Error('Migration source directory does not exist.');
 for(const filename of readdirSync(directory)){
  if(!isSafeFilename(filename))throw Error('Invalid source filename.');
  const bytes=readFileSync(join(directory,filename));await putMedia(filename,bytes);
  const saved=await mediaBytes(filename);const info=await mediaInfo(filename);
  if(!saved?.equals(bytes)||info?.sha256!==createHash('sha256').update(bytes).digest('hex'))throw Error('Byte verification failed for '+filename);
  count++;total+=bytes.length;
 }
 await createSchema();
 console.log(JSON.stringify({verifiedAssets:count,bytes:total,storage:'Supabase Postgres public.media_assets'}));
}finally{await closeDatabase()}
