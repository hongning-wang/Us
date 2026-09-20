import test from 'node:test';
import assert from 'node:assert/strict';
import {putMedia,mediaInfo,mediaBytes} from '../apps/web/src/lib/server/media';
test('media bytes survive retrieval and ranges; named assets cannot be silently replaced',async()=>{
 const original=Buffer.from('0123456789');await putMedia('roundtrip.mp4',original,'video/mp4');
 assert.deepEqual(await mediaBytes('roundtrip.mp4'),original);
 assert.equal((await mediaBytes('roundtrip.mp4',3,4))?.toString(),'3456');
 assert.equal((await mediaInfo('roundtrip.mp4'))?.byteLength,10);
 await putMedia('roundtrip.mp4',original,'video/mp4');
 await assert.rejects(()=>putMedia('roundtrip.mp4',Buffer.from('different')),/different bytes/);
 assert.deepEqual(await mediaBytes('roundtrip.mp4'),original);
 await assert.rejects(()=>putMedia('../outside.png',original),/Invalid/);
 await assert.rejects(()=>putMedia('empty.png',Buffer.alloc(0)),/between 1 byte/);
});
