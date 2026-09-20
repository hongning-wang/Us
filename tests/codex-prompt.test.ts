import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrompt} from '../apps/web/src/lib/server/codex';
const input={instruction:'Make this us',senderName:'Sender',recipientName:'Friend',memory:'PRIVATE_MEMORY_CALLBACK: Bellevue and Miami',hasReferenceVideo:true,hasConfirmedPhoto:true};
test('reference edits preserve the source and exclude relationship-memory steering',()=>{
 const prompt=buildPrompt(input);
 assert.ok(!prompt.includes('PRIVATE_MEMORY_CALLBACK'));
 assert.ok(prompt.includes('identity substitution only'));
 assert.ok(prompt.includes('@video1'));
 assert.ok(prompt.includes('never use @image1 for both people'));
 assert.ok(buildPrompt({...input,instruction:'What happens next?'}).includes('What happens next?'));
});
test('fresh text requests retain relationship memory',()=>{
 assert.ok(buildPrompt({...input,hasReferenceVideo:false}).includes('PRIVATE_MEMORY_CALLBACK'));
});
test('a selected recipient photo is mapped to image2 in both text and reference prompts',()=>{
 for(const hasReferenceVideo of [true,false]){
  const prompt=buildPrompt({...input,hasReferenceVideo,hasRecipientPhoto:true});
  assert.match(prompt,/@image2/);assert.ok(!prompt.includes('has no confirmed photo'));assert.ok(!prompt.includes('Friend photo: never available'));
 }
});
