// Read-only: report counts and identities, never message bodies or credentials.
import {env} from '../apps/web/src/lib/server/env';
import {getMemory,getPair,refreshStore} from '../apps/web/src/lib/server/store';
await refreshStore();
const conversationId=process.argv[2];const pair=getPair(conversationId);
if(!pair)throw Error('Pass a configured conversation id.');
const session=getMemory(conversationId).sessionId;
const records:Array<{peer_id:string;metadata?:{ig_message_id?:string}}>=[];
for(let page=1;page<=20;page++){
 const response=await fetch(`${env.honcho.baseUrl}/v3/workspaces/${encodeURIComponent(env.honcho.workspace)}/sessions/${encodeURIComponent(session)}/messages/list?page=${page}&size=100`,{method:'POST',headers:{Authorization:`Bearer ${env.honcho.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({filters:{}}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(`Memory audit returned HTTP ${response.status}`);
 const data=await response.json();records.push(...data.items);if(page>=data.pages)break;
}
const imported=records.filter(m=>m.metadata?.ig_message_id);const ids=imported.map(m=>m.metadata!.ig_message_id);
console.log(JSON.stringify({session,imported:imported.length,uniqueImportedIds:new Set(ids).size,duplicateImports:ids.length-new Set(ids).size,authors:[...new Set(imported.map(m=>m.peer_id))]}));
