import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeWindow,stableMedia} from '../apps/extension/src/instagram';
import type {Message} from '../packages/shared/src/types';
const m=(text:string,authorId='a')=>({text,authorId,kind:'real' as const});
test('overlapping history pages retain order, participants and ids without duplicating retries',()=>{
 const first=mergeWindow([], [m('hello'),m('yes','b'),m('hello')]);
 const older=mergeWindow(first,[m('yesterday','b'),m('hello'),m('yes','b')]);
 assert.deepEqual(older.map(m=>m.text),['yesterday','hello','yes','hello']);
 assert.equal(older[1].id,first[0].id);assert.notEqual(older[1].id,older[3].id);
 const retry=mergeWindow(older,[m('hello'),m('yes','b'),m('hello')]);assert.deepEqual(retry,older);
 const newer=mergeWindow(retry,[m('yes','b'),m('hello'),m('next','b')]);
 assert.equal(newer.length,5);assert.equal(newer[4].text,'next');assert.equal(newer[4].authorId,'b');
});
test('signed Instagram URLs keep stable identifiers as query tokens rotate',()=>{
 assert.equal(stableMedia('https://cdninstagram.com/v/video.mp4?token=one'),stableMedia('https://cdninstagram.com/v/video.mp4?token=two'));
});

test('nonoverlapping older pages prepend instead of reversing history',()=>{
 const pairMessages=mergeWindow([],[{authorId:'a',text:'newest',kind:'real'}]);
 const merged=mergeWindow(pairMessages,[{authorId:'b',text:'older',kind:'real'}],'older');
 assert.deepEqual(merged.map(m=>m.text),['older','newest']);
 assert.equal(merged[1].id,pairMessages[0].id);
});
