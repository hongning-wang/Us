import {cleanHistoryMessage} from './history-cleaning';
import {HISTORY_LIMIT,inHistoryWindow} from '../../../../../packages/shared/src/history';
import type { Message, Pair, Setup } from '@us/shared/types';
import { hasHoncho } from './env';
import { Honcho, HonchoError, importMessages, type HonchoLike } from './honcho';
import { ApiError } from './jobs';
import { putMedia, photoFilename } from './media';
import { recipientPhoto, confirmedPhoto, getMemory, mutate, newMessages, read, sessionIdFor } from './store';

/** Injectable for tests; null = real Honcho (gated on HONCHO_API_KEY). */
let honchoFactory: (() => HonchoLike) | null = null;
export function setHonchoFactory(factory: (() => HonchoLike) | null): void {
	honchoFactory = factory;
}
function honcho(): HonchoLike | null {
	if (honchoFactory) return honchoFactory();
	return Honcho.available() ? new Honcho() : null;
}

export function getSetup(conversationId: string): Setup {
	const pair = read((s) => s.pairs[conversationId]);
	const history = read((s) => s.history[conversationId]);
	const memory = read((s) => s.memory[conversationId]);
	const photo = pair ? confirmedPhoto(pair.sender.id) : undefined;
	return {
		pair,
		importedCount: history?.count ?? 0,
		importComplete: history?.complete ?? false,
		memoryStatus: memory?.status ?? (hasHoncho() ? 'memory ready' : 'HONCHO_API_KEY not configured — memory disabled'),
		photoUrl: photo ? `/api/media/${photo.filename}` : undefined,
		photoConfirmed: Boolean(photo),
  recipientPhotoUrl: pair&&recipientPhoto(pair)?`/api/media/${recipientPhoto(pair)!.filename}`:undefined,
  recipientPhotoConfirmed:Boolean(pair&&recipientPhoto(pair))
	};
}

export async function configurePair(pair: Pair): Promise<Setup> {
	if (pair.sender.id === pair.recipient.id) throw new ApiError(400, 'Sender and recipient must be different people.');
	await mutate((s) => {
		s.pairs[pair.conversationId] = pair;
		if (!s.memory[pair.conversationId]) {
			s.memory[pair.conversationId] = {
				sessionId: sessionIdFor(pair.conversationId, 0),
				generation: 0,
				status: 'pending'
			};
		}
	});
	await ensureHonchoSession(pair.conversationId, pair);
	return getSetup(pair.conversationId);
}

async function ensureHonchoSession(conversationId: string, pair: Pair): Promise<void> {
	const client = honcho();
	if (!client) {
		await mutate((s) => {
			s.memory[conversationId].status = 'HONCHO_API_KEY not configured — memory disabled';
		});
		return;
	}
	const mem = getMemory(conversationId);
	try {
		await client.ensureSession(mem.sessionId, pair);
		await mutate((s) => {
			s.memory[conversationId].status = `Honcho session ${mem.sessionId}`;
			s.memory[conversationId].lastError = undefined;
		});
	} catch (e) {
		await mutate((s) => {
			s.memory[conversationId].status = 'memory unavailable';
			s.memory[conversationId].lastError = (e as Error).message;
		});
	}
}

const IMAGE_TYPES: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
};

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Only the logged-in participant (pair.sender) may confirm a photo, and only confirmed=true is stored. */
export async function savePhoto(conversationId: string, participantId: string, confirmed: string | null, file: File, scope='account'): Promise<Setup> {
	const pair = read((s) => s.pairs[conversationId]);
	if (!pair) throw new ApiError(404, 'Pair not configured for this conversation.');
	if (confirmed !== 'true') throw new ApiError(400, 'Photos are only stored after explicit confirmation (confirmed=true).');
	if (participantId !== pair.sender.id && !(scope==='chat' && participantId===pair.recipient.id)) {
		throw new ApiError(403, 'Only the logged-in participant can confirm their own photo.');
	}
	const ext = IMAGE_TYPES[file.type];
	if (!ext) throw new ApiError(415, 'Photo must be a JPEG, PNG, or WebP image.');
	const buf = Buffer.from(await file.arrayBuffer());
	if (buf.byteLength === 0) throw new ApiError(400, 'Empty photo.');
	if (buf.byteLength > MAX_PHOTO_BYTES) throw new ApiError(413, 'Photo must be under 10 MB.');

	const filename = photoFilename(conversationId, participantId, ext);
	await putMedia(filename,buf,file.type);
	await mutate((s) => {
		const record = {
			filename,
			confirmedAt: new Date().toISOString(),
			contentType: file.type
		};
  if(participantId===pair.sender.id)s.photos[participantId]=record;
  else s.chatPhotos[conversationId]={...record,participantId,confirmedBy:pair.sender.id};
	});
	return getSetup(conversationId);
}

const historyLocks=new Map<string,Promise<unknown>>();
function withHistoryLock<T>(id:string,action:()=>Promise<T>):Promise<T> {
 const run=(historyLocks.get(id)||Promise.resolve()).catch(()=>{}).then(action);
 historyLocks.set(id,run);
 void run.finally(()=>{if(historyLocks.get(id)===run)historyLocks.delete(id)}).catch(()=>{});
 return run;
}
export function importHistory(conversationId:string,messages:Message[],complete:boolean):Promise<Setup> {
 return withHistoryLock(conversationId,()=>importHistoryLocked(conversationId,messages,complete));
}
async function importHistoryLocked(conversationId:string,messages:Message[],complete:boolean):Promise<Setup> {
 const pair=read(s=>s.pairs[conversationId]);
 if(!pair)throw new ApiError(404,'Configure the pair before importing history.');
 if(messages.some(m=>m.authorId!==pair.sender.id&&m.authorId!==pair.recipient.id))throw new ApiError(400,'History must contain only the two people in this chat.');
 const client=honcho();
 const mem=getMemory(conversationId);
 const pending=read(s=>s.history[conversationId]?.pendingIds);
 if(pending?.length) {
  if(!client?.existingMessageIds)throw new ApiError(503,'Check the previous history import before retrying.');
  const existing=await client.existingMessageIds(mem.sessionId);
  await mutate(s=>{const rec=s.history[conversationId];for(const id of pending)if(existing.has(id))rec.ids[id]=true;rec.count=Object.keys(rec.ids).length;rec.pendingIds=undefined;});
 }
 const cleaned=messages.filter(message=>inHistoryWindow(message)).flatMap(message=>{const clean=cleanHistoryMessage(message);return clean?[clean]:[]}).sort((a,b)=>a.order-b.order).slice(-HISTORY_LIMIT);
 const fresh=newMessages(conversationId,cleaned).sort((a,b)=>a.order-b.order);
 if(fresh.length) {
  if(!client)throw new ApiError(503,'HONCHO_API_KEY is not configured — cannot seed memory.');
  await mutate(s=>{const rec=s.history[conversationId]??={ids:{},count:0,complete:false,updatedAt:''};rec.pendingIds=fresh.map(m=>m.id);});
  try {await importMessages(client,mem.sessionId,pair,fresh);}
  catch(e) {
   const message=e instanceof HonchoError?e.message:'Memory import failed.';
   await mutate(s=>{s.memory[conversationId].status='memory unavailable';s.memory[conversationId].lastError=message;});
   throw new ApiError(502,message);
  }
 }
 await mutate(s=>{
  const rec=s.history[conversationId]??={ids:{},count:0,complete:false,updatedAt:''};
  for(const m of fresh)rec.ids[m.id]=true;
  rec.pendingIds=undefined;rec.count=Object.keys(rec.ids).length;
  rec.complete=rec.complete||complete;rec.updatedAt=new Date().toISOString();
  if(fresh.length){s.memory[conversationId].status=`Honcho session ${mem.sessionId}`;s.memory[conversationId].lastError=undefined;}
 });
 return getSetup(conversationId);
}

/** Reset local dedup state and rotate to a fresh Honcho session = clean memory. */
export function resetHistory(conversationId: string): Promise<Setup> {
 return withHistoryLock(conversationId,()=>resetHistoryLocked(conversationId));
}
async function resetHistoryLocked(conversationId: string): Promise<Setup> {
	await mutate((s) => {
		delete s.history[conversationId];
		const mem = (s.memory[conversationId] ??= { sessionId: '', generation: 0, status: 'pending' });
		mem.generation += 1;
		mem.sessionId = sessionIdFor(conversationId, mem.generation);
		mem.status = 'memory reset — reimport to seed';
		mem.lastError = undefined;
	});
	const pair = read((s) => s.pairs[conversationId]);
	if (pair) await ensureHonchoSession(conversationId, pair);
	return getSetup(conversationId);
}
