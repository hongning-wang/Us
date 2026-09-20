/**
 * Backend tests for the Us SvelteKit API layer.
 * Run: npm test  (node --import tsx --test tests/*.test.ts)
 *
 * Env vars are set BEFORE importing server modules so tests use an isolated
 * in-memory store and never touch real Honcho/Seedance credentials.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.HONCHO_API_KEY = '';
process.env.SEEDANCE_API_KEY = '';
process.env.PUBLIC_MEDIA_BASE = 'https://media.test';

const store = await import('../apps/web/src/lib/server/store.ts');
const service = await import('../apps/web/src/lib/server/service.ts');
const jobs = await import('../apps/web/src/lib/server/jobs.ts');
const media = await import('../apps/web/src/lib/server/media.ts');
const http = await import('../apps/web/src/lib/server/http.ts');
const { HonchoError } = await import('../apps/web/src/lib/server/honcho.ts');

const pair = (conv: string) => ({
	conversationId: conv,
	sender: { id: 'ig-self', username: 'me', name: 'Me' },
	recipient: { id: 'ig-friend', username: 'friend', name: 'Friend' }
});



async function waitFor(fn: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error('waitFor timed out');
}

// ---- store ---------------------------------------------------------------

test('store: serialized mutations never lose writes', async () => {
	await Promise.all(
		Array.from({ length: 25 }, (_, i) =>
			store.mutate((s) => {
				const rec = (s.history['serial'] ??= { ids: {}, count: 0, complete: false, updatedAt: '' });
				rec.ids[`m${i}`] = true;
				rec.count = Object.keys(rec.ids).length;
			})
		)
	);
	assert.equal(store.read((s) => s.history['serial'].count), 25);
});

// ---- setup / photo ---------------------------------------------------------

test('setup: configure pair, distinct identities required', async () => {
	await assert.rejects(
		service.configurePair({ ...pair('bad'), recipient: { id: 'ig-self', username: 'x', name: 'X' } }),
		/different people/
	);
	const setup = await service.configurePair(pair('conv-a'));
	assert.equal(setup.pair?.sender.id, 'ig-self');
	assert.equal(setup.photoConfirmed, false);
});

test('photo: only the sender can confirm; confirmed=true required', async () => {
	await service.configurePair(pair('conv-b'));
	const img = new File([Buffer.from('fake-jpeg')], 'me.jpg', { type: 'image/jpeg' });
	await assert.rejects(service.savePhoto('conv-b', 'ig-friend', 'true', img), /logged-in participant/);
	await assert.rejects(service.savePhoto('conv-b', 'ig-self', 'false', img), /confirmation/);
	await assert.rejects(
		service.savePhoto('conv-b', 'ig-self', 'true', new File([Buffer.from('x')], 'a.txt', { type: 'text/plain' })),
		/415|image/
	);
	const setup = await service.savePhoto('conv-b', 'ig-self', 'true', img);
	assert.equal(setup.photoConfirmed, true);
	assert.match(setup.photoUrl!, /^\/api\/media\/photo-/);
});

// ---- history ---------------------------------------------------------------

class FakeHoncho {
	calls: { messages: { content: string; peer_id: string; metadata?: Record<string, unknown> }[] } = { messages: [] };
	fail = false;
	async ensureSession() {}
 async existingMessageIds(){return new Set(this.calls.messages.map(m=>String(m.metadata?.ig_message_id)))}
	async addMessages(_s: string, msgs: { content: string; peer_id: string; metadata?: Record<string, unknown> }[]) {
		if (this.fail) throw new HonchoError('nope', 500);
		this.calls.messages.push(...msgs);
		return msgs.length;
	}
	async peerChat() {
		return 'likes surfing';
	}
}

const msg = (id: string, author: string, order: number) => ({ id, authorId: author, text: `hi ${id}`, order, timestamp:new Date().toISOString() });

test('history: dedupes across retries and keeps authors distinct', async () => {
	const fake = new FakeHoncho();
	service.setHonchoFactory(() => fake);
	await service.configurePair(pair('conv-c'));

	const s1 = await service.importHistory('conv-c', [msg('a', 'ig-self', 0), msg('b', 'ig-friend', 1), msg('a', 'ig-self', 0)], false);
	assert.equal(s1.importedCount, 2); // duplicate id 'a' inside the batch dropped
	assert.equal(s1.importComplete, false);

	const s2 = await service.importHistory('conv-c', [msg('a', 'ig-self', 0), msg('c', 'ig-friend', 2)], true);
	assert.equal(s2.importedCount, 3); // 'a' skipped on retry, 'c' added
	assert.equal(s2.importComplete, true);
	assert.deepEqual(
		new Set(fake.calls.messages.map((m) => m.peer_id)),
		new Set(['ig-self', 'ig-friend'])
	);
	assert.equal(fake.calls.messages[0].metadata?.kind, 'real');
	service.setHonchoFactory(null);
});

test('history: rejects old and undated messages and caps a backfill at 500 before Honcho',async()=>{
 const fake=new FakeHoncho();service.setHonchoFactory(()=>fake);
 await service.configurePair(pair('bounded-history'));
 const messages=Array.from({length:510},(_,i)=>msg('recent-'+i,'ig-self',i));
 messages.push({...msg('old','ig-self',510),timestamp:'2020-01-01T00:00:00Z'});
 messages.push({...msg('unknown','ig-self',511),timestamp:''});
 const setup=await service.importHistory('bounded-history',messages,true);
 assert.equal(setup.importedCount,500);
 assert.equal(fake.calls.messages[0].metadata?.ig_message_id,'recent-10');
 assert.equal(fake.calls.messages.at(-1)?.metadata?.ig_message_id,'recent-509');
 service.setHonchoFactory(null);
});

test('history: failed import does not mark ids (retry re-sends)', async () => {
	const fake = new FakeHoncho();
	service.setHonchoFactory(() => fake);
	await service.configurePair(pair('conv-d'));
	fake.fail = true;
	await assert.rejects(service.importHistory('conv-d', [msg('x', 'ig-self', 0)], false), /502|nope/);
	fake.fail = false;
	const s = await service.importHistory('conv-d', [msg('x', 'ig-self', 0)], true);
	assert.equal(s.importedCount, 1);
	service.setHonchoFactory(null);
});

test('history: reset rotates the Honcho session (clean memory)', async () => {
	service.setHonchoFactory(() => new FakeHoncho());
	await service.configurePair(pair('conv-e'));
	await service.importHistory('conv-e', [msg('a', 'ig-self', 0)], true);
	const before = store.getMemory('conv-e').sessionId;
	const setup = await service.resetHistory('conv-e');
	assert.equal(setup.importedCount, 0);
	assert.equal(setup.importComplete, false);
	assert.notEqual(store.getMemory('conv-e').sessionId, before);
	service.setHonchoFactory(null);
});

// ---- job pipeline (fake provider deps) -------------------------------------

const SPEC = {
	scenePrompt: 'two friends on a rooftop at golden hour',
	sceneSummary: 'Rooftop at golden hour.',
	duration: 5,
	quality: '720p' as const,
	aspectRatio: '16:9' as const,
	generateAudio: true,
	useIdentityPhotos: true,
	useReferenceVideo: false
};

function fakeDeps() {
	const tasks = new Map<string, { status: string; videoUrl?: string; error?: string }>();
	const created: { input: Record<string, unknown>; id: string }[] = [];
	const imagined:string[]=[];
	let seq = 0;
	const deps = {
		getMemory: async () => 'they love surfing',
  validateMedia: async()=>{},
		genSpec: async () => ({ ...SPEC }),
		createTask: async (input: Record<string, unknown>) => {
			const id = `task-${++seq}`;
			tasks.set(id, { status: 'processing' });
			created.push({ input, id });
			return id;
		},
		getTask: async (id: string) => tasks.get(id) ?? { status: 'failed', error: 'unknown task' },
		download: async () => Buffer.from('mp4-bytes'),
		noteImagined: async (_conversationId:string,_authorId:string,text:string) => {imagined.push(text)},
		pollIntervalMs: 5,
		timeoutMs: 1500
	};
	jobs.setJobDeps(deps as never);
	return { tasks, created, imagined };
}

const createJob = (conv: string, over: Record<string, unknown> = {}) =>
	jobs.createJob({ ...pair(conv), instruction: 'imagine us surfing', idempotencyKey: `k-${Math.random()}`, ...over } as never);

test('jobs: full lifecycle generating -> ready with photo + memory attached', async () => {
	const { tasks, created, imagined } = fakeDeps();
	await service.configurePair(pair('conv-j1'));
	await service.savePhoto('conv-j1', 'ig-self', 'true', new File([Buffer.from('img')], 'me.png', { type: 'image/png' }));

	const job = await createJob('conv-j1');
	assert.equal(job.status, 'generating');
	await waitFor(() => created.length > 0);
	const task = tasks.get(created[0].id)!;
	task.status = 'completed';
	task.videoUrl = 'https://videos.test/v.mp4';

	await waitFor(async () => (await jobs.getJob(job.id)).status === 'ready');
	const done = await jobs.getJob(job.id);
	assert.match(done.outputUrl!, /^\/api\/media\/video-/);
	assert.equal(done.sceneSummary, SPEC.sceneSummary);
	assert.ok(imagined.some(text=>text.includes('imagine us surfing')&&text.includes(SPEC.sceneSummary)));
	// confirmed photo resolved to public URL for the provider
	assert.deepEqual(created[0].input.imageUrls, [
		'https://media.test'+service.getSetup('conv-j1').photoUrl
	]);
});

test('jobs: idempotency key dedupes creates', async () => {
	const { created } = fakeDeps();
	await service.configurePair(pair('conv-j2'));
	const input = { ...pair('conv-j2'), instruction: 'x', idempotencyKey: 'same-key' };
	const a = await jobs.createJob(input as never);
	const b = await jobs.createJob(input as never);
	assert.equal(a.id, b.id);
	await waitFor(() => created.length > 0);
	assert.equal(created.length, 1);
});

test('jobs: story continues when replying to a delivered Us video', async () => {
	const { tasks, created } = fakeDeps();
	await service.configurePair(pair('conv-j3'));
	const parent = await createJob('conv-j3');
	await waitFor(() => tasks.size > 0);
	const t1 = [...tasks.values()][0];
	t1.status = 'completed';
	t1.videoUrl = 'https://v.test/a.mp4';
	await waitFor(async () => (await jobs.getJob(parent.id)).status === 'ready');
	await jobs.setDelivery(parent.id, { status: 'sending' });
	await jobs.setDelivery(parent.id, { status: 'sent', messageId: 'ig-msg-1' });

	const child = await createJob('conv-j3', {
		reference: { kind: 'video', mediaId: 'm1', url: 'https://cdn.test/v.mp4', messageId: 'ig-msg-1' }
	});
	assert.equal(child.storyId, parent.storyId);
	assert.equal(child.parentId, parent.id);
	await waitFor(() => created.length === 2);
	assert.deepEqual(created[1].input.videoUrls, ['https://cdn.test/v.mp4']);
	assert.equal(created[1].input.referenceMode, true);

	const fresh = await createJob('conv-j3');
	assert.notEqual(fresh.storyId, parent.storyId); // unreferenced => new story
});

test('jobs: selected Reel sends the actual video and saved photo without fetching relationship steering', async () => {
 const {created}=fakeDeps();
 await service.configurePair(pair('conv-reel-reference'));
 jobs.setJobDeps({getMemory:async()=>{throw Error('Reference edits must not fetch relationship steering')}});
 await createJob('conv-reel-reference',{instruction:'Make this us',reference:{kind:'reel',mediaId:'DbkE5eixFju',url:'https://cdn.test/selected-reel.mp4'}});
 await waitFor(()=>created.length===1);
 assert.deepEqual(created[0].input.videoUrls,['https://cdn.test/selected-reel.mp4']);
 assert.deepEqual(created[0].input.imageUrls,['https://media.test'+service.getSetup('conv-reel-reference').photoUrl]);
 assert.equal(created[0].input.referenceMode,true);
});

test('jobs: provider failure -> failed with fallbackUrl; retry resubmits', async () => {
	const { tasks, created } = fakeDeps();
	await service.configurePair(pair('conv-j4'));
	const job = await createJob('conv-j4');
	await waitFor(() => tasks.size > 0);
	const t1 = [...tasks.values()][0];
	t1.status = 'failed';
	t1.error = 'provider exploded';
	await waitFor(async () => (await jobs.getJob(job.id)).status === 'failed');
	const failed = await jobs.getJob(job.id);
	assert.match(failed.error!, /provider exploded/);
	assert.equal(failed.fallbackUrl, '/api/media/fallback.mp4');

	await jobs.retryJob(job.id);
	await waitFor(() => created.length === 2);
 assert.equal(created.length, 2); // provider task failed => a new task, spec reused
});

test('jobs: timeout fails honestly; retry resumes the same provider task', async () => {
	const { created } = fakeDeps();
	jobs.setJobDeps({ timeoutMs: 60, pollIntervalMs: 5 } as never);
	await service.configurePair(pair('conv-j5'));
	const job = await createJob('conv-j5');
	await waitFor(async () => (await jobs.getJob(job.id)).status === 'failed');
	assert.match((await jobs.getJob(job.id)).error!, /timed out/);

	await jobs.retryJob(job.id); // task still 'processing' => resume, no new task
	await new Promise((r) => setTimeout(r, 30));
	assert.equal(created.length, 1);
});

test('jobs: fallback is labeled and only allowed after failure/timeout', async () => {
	const { tasks } = fakeDeps();
	await service.configurePair(pair('conv-j6'));
	const job = await createJob('conv-j6');
	await assert.rejects(jobs.useFallback(job.id), /only available after/); // still generating, not timed out
	await waitFor(() => tasks.size > 0);
	[...tasks.values()][0].status = 'failed';
	await waitFor(async () => (await jobs.getJob(job.id)).status === 'failed');
	const fb = await jobs.useFallback(job.id);
	assert.equal(fb.status, 'ready');
	assert.equal(fb.isFallback, true);
	assert.equal(fb.outputUrl, '/api/media/fallback.mp4');
});

test('jobs: delivery guards + failed delivery is retryable as ready', async () => {
	const { tasks } = fakeDeps();
	await service.configurePair(pair('conv-j7'));
	const job = await createJob('conv-j7');
	await assert.rejects(jobs.setDelivery(job.id, { status: 'sending' }), /Cannot send/);
	await waitFor(() => tasks.size > 0);
	const t1 = [...tasks.values()][0];
	t1.status = 'completed';
	t1.videoUrl = 'https://v.test/x.mp4';
	await waitFor(async () => (await jobs.getJob(job.id)).status === 'ready');

	await jobs.setDelivery(job.id, { status: 'sending' });
	await jobs.setDelivery(job.id, { status: 'failed', error: 'upload rejected', safeToRetry: true });
	assert.equal((await jobs.getJob(job.id)).status, 'failed');
	const back = await jobs.retryJob(job.id); // delivery-stage failure -> ready again, no regen
	assert.equal(back.status, 'ready');
	assert.ok(back.outputUrl);
	await jobs.setDelivery(job.id, { status: 'sending' });
	const sent = await jobs.setDelivery(job.id, { status: 'sent', messageId: 'ig-msg-9' });
	assert.equal(sent.status, 'sent');
	assert.equal(sent.deliveryMessageId, 'ig-msg-9');
});

// ---- media + validation + cors ----------------------------------------------

test('media: filename sanitization rejects traversal', () => {
	assert.equal(media.isSafeFilename('../secret'), false);
	assert.equal(media.isSafeFilename('a/b'), false);
	assert.equal(media.isSafeFilename('..'), false);
	assert.ok(media.isSafeFilename('photo-conv-user.png'));
});

test('validation: schemas reject malformed input', async () => {
	assert.equal(http.createJobSchema.safeParse({}).success, false);
	assert.equal(
		http.createJobSchema.safeParse({ ...pair('c'), instruction: 'x', idempotencyKey: 'k' }).success,
		true
	);
	assert.equal(
		http.deliverySchema.safeParse({ status: 'exploded' }).success,
		false
	);
	const req = new Request('http://x', { method: 'POST', body: '{' });
	await assert.rejects(http.parseBody(req, http.pairSchema), /valid JSON/);
});

test('cors: instagram, chrome-extension and localhost allowed; others blocked', () => {
	assert.equal(http.allowedOrigin('https://www.instagram.com'), 'https://www.instagram.com');
	assert.equal(http.allowedOrigin('chrome-extension://abcdef'), 'chrome-extension://abcdef');
	assert.equal(http.allowedOrigin('http://localhost:5173'), 'http://localhost:5173');
	assert.equal(http.allowedOrigin('https://evil.example'), null);
});

test('history: concurrent imports write once and subsequent sync preserves completeness',async()=>{
 const fake=new FakeHoncho();service.setHonchoFactory(()=>fake);
 await service.configurePair(pair('concurrent'));
 const messages=[msg('one','ig-self',0),msg('two','ig-friend',1)];
 await Promise.all([service.importHistory('concurrent',messages,true),service.importHistory('concurrent',messages,false)]);
 await service.importHistory('concurrent',[msg('three','ig-self',2)],false);
 assert.equal(fake.calls.messages.length,3);
 assert.equal(service.getSetup('concurrent').importComplete,true);
 await assert.rejects(service.importHistory('concurrent',[msg('intruder','other-person',3)],false),/only the two/);
 service.setHonchoFactory(null);
});

test('history: reconcile an accepted write whose response was lost',async()=>{
 const fake=new FakeHoncho();service.setHonchoFactory(()=>fake);
 await service.configurePair(pair('lost-history-response'));
 const add=fake.addMessages.bind(fake);let loseResponse=true;
 fake.addMessages=async(session,messages)=>{const count=await add(session,messages);if(loseResponse){loseResponse=false;throw new HonchoError('response lost')}return count};
 const messages=[msg('accepted','ig-self',0)];
 await assert.rejects(service.importHistory('lost-history-response',messages,true),/response lost/);
 const setup=await service.importHistory('lost-history-response',messages,true);
 assert.equal(setup.importedCount,1);assert.equal(fake.calls.messages.length,1);
 service.setHonchoFactory(null);
});

test('jobs: missing public photo configuration fails before LLM or provider calls',async()=>{
 fakeDeps();let llm=0,provider=0;
 jobs.setJobDeps({genSpec:async()=>{llm++;return SPEC},createTask:async()=>{provider++;return 'unexpected'}});
 await service.configurePair(pair('missing-media'));process.env.PUBLIC_MEDIA_BASE='';
 const job=await createJob('missing-media');
 await waitFor(()=>jobs.getJob(job.id).status==='failed');
 assert.equal(llm,0);assert.equal(provider,0);assert.match(jobs.getJob(job.id).error!,/media setup/);
 process.env.PUBLIC_MEDIA_BASE='https://media.test';
});

test('jobs: missing reference fails before paid work with an attachment error',async()=>{
 fakeDeps();let llm=0,provider=0;
 jobs.setJobDeps({genSpec:async()=>{llm++;return SPEC},createTask:async()=>{provider++;return 'unexpected'}});
 await service.configurePair(pair('missing-reference'));
 const job=await createJob('missing-reference',{reference:{kind:'reel',mediaId:'example'}});
 await waitFor(()=>jobs.getJob(job.id).status==='failed');
 assert.equal(llm,0);assert.equal(provider,0);
 assert.match(jobs.getJob(job.id).error!,/selected video wasn’t attached/);
 assert.doesNotMatch(jobs.getJob(job.id).error!,/Spec generation failed/);
});

test('jobs: uncertain provider submission never automatically creates a second task',async()=>{
 fakeDeps();let submits=0;
 jobs.setJobDeps({createTask:async()=>{submits++;throw Error('response lost')}});
 await service.configurePair(pair('uncertain-provider'));
 const job=await createJob('uncertain-provider');await waitFor(()=>jobs.getJob(job.id).status==='failed');
 await assert.rejects(jobs.retryJob(job.id),/duplicate/);
 assert.equal(submits,1);
});

test('jobs: throttled status reads recover without creating another video',async()=>{
 const {created}=fakeDeps();let polls=0;
 const {ProviderError}=await import('../apps/web/src/lib/server/seedance');
 jobs.setJobDeps({getTask:async()=>{
  if(++polls<=2)throw new ProviderError('API rate limit exceeded.','rate_limit_exceeded',429);
  return {status:'completed',videoUrl:'https://video.test/recovered.mp4'};
 }});
 await service.configurePair(pair('throttled-poll'));
 const job=await createJob('throttled-poll');await waitFor(()=>jobs.getJob(job.id).status==='ready');
 assert.equal(created.length,1);assert.equal(polls,3);
});

test('jobs: explicit concurrency rejection permits manual retry without automatic resubmission',async()=>{
 fakeDeps();let submits=0;
 const {ProviderError}=await import('../apps/web/src/lib/server/seedance');
 jobs.setJobDeps({createTask:async()=>{submits++;throw new ProviderError('Concurrency limit reached.','concurrent_limit',429)}});
 await service.configurePair(pair('concurrency-rejection'));
 const job=await createJob('concurrency-rejection');await waitFor(()=>jobs.getJob(job.id).status==='failed');
 assert.equal(submits,1);
 await jobs.retryJob(job.id);await waitFor(()=>jobs.getJob(job.id).status==='failed');
 assert.equal(submits,2);
});

test('jobs: interrupted delivery requires reconciliation, then repeated confirmation is idempotent',async()=>{
 const {tasks}=fakeDeps();await service.configurePair(pair('uncertain-upload'));
 const job=await createJob('uncertain-upload');await waitFor(()=>tasks.size>0);
 Object.assign([...tasks.values()][0],{status:'completed',videoUrl:'https://video.test/a.mp4'});
 await waitFor(()=>jobs.getJob(job.id).status==='ready');
 await jobs.setDelivery(job.id,{status:'sending'});
 await jobs.setDelivery(job.id,{status:'failed',error:'response lost'});
 await assert.rejects(jobs.retryJob(job.id),/existing Instagram upload/);
 await assert.rejects(jobs.useFallback(job.id),/existing upload/);
 await jobs.setDelivery(job.id,{status:'sent',messageId:'persisted-attachment'});
 assert.equal((await jobs.setDelivery(job.id,{status:'sent',messageId:'persisted-attachment'})).status,'sent');
});

test('jobs: inaccessible media stops before memory, LLM, and provider calls',async()=>{
 fakeDeps();let calls=0;
 jobs.setJobDeps({validateMedia:async()=>{throw Error('Image reference unavailable')},getMemory:async()=>{calls++;return 'memory'},genSpec:async()=>{calls++;return SPEC},createTask:async()=>{calls++;return 'unexpected'}});
 await service.configurePair(pair('inaccessible-media'));
 const job=await createJob('inaccessible-media');await waitFor(()=>jobs.getJob(job.id).status==='failed');
 assert.equal(calls,0);assert.match(jobs.getJob(job.id).error!,/reference unavailable/);
});

test('history: skips Reel entries and removes inline Reel links before Honcho', async()=>{
 const fake=new FakeHoncho();service.setHonchoFactory(()=>fake);
 try {
  await service.configurePair(pair('history-500'));
  const messages=Array.from({length:500},(_,i)=>({...msg('page-'+i,i%2?'ig-friend':'ig-self',i),text:i===4?' caption that must not become a personal fact ':i===5?'look at this https://www.instagram.com/reels/ABC/?igsh=secret':` hi  ${i} 👩‍💻\r\n lol\u0000 `,...(i===4?{mediaUrl:'https://www.instagram.com/reels/ABC/?igsh=secret'}:{})}));
  const result=await service.importHistory('history-500',messages,true);
  assert.equal(result.importedCount,499);
  assert.equal(fake.calls.messages[4].content,'look at this');
  assert.equal(fake.calls.messages[4].metadata?.media_url,undefined);
  assert.ok(!fake.calls.messages.some(m=>m.content.includes('[reel]')));
  assert.equal(fake.calls.messages[0].content,'hi 0 👩‍💻\nlol');
  assert.deepEqual(fake.calls.messages.map(m=>m.metadata?.order),messages.filter(m=>m.order!==4).map(m=>m.order));
  await service.importHistory('history-500',messages,true);
  assert.equal(fake.calls.messages.length,499);
 }finally{service.setHonchoFactory(null)}
});

test('jobs: confirmed sender and chat-selected friend use distinct ordered image references', async()=>{
 const {created,tasks}=fakeDeps();
 const conversation='two-photo-demo';await service.configurePair(pair(conversation));
 await service.savePhoto(conversation,'ig-self','true',new File(['self'],'self.png',{type:'image/png'}));
 const setup=await service.savePhoto(conversation,'ig-friend','true',new File(['friend'],'friend.png',{type:'image/png'}),'chat');
 const job=await createJob(conversation);
 await waitFor(()=>created.length===1);
 assert.deepEqual(created[0].input.imageUrls,['https://media.test'+setup.photoUrl,'https://media.test'+setup.recipientPhotoUrl]);
 Object.assign(tasks.get(created[0].id)!,{status:'completed',videoUrl:'https://videos.test/two.mp4'});
 await waitFor(()=>jobs.getJob(job.id).status==='ready');
});
