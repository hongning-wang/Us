import test from 'node:test';
import assert from 'node:assert/strict';
import {historyCutoff,inHistoryWindow} from '../packages/shared/src/history';
import {parseInstagramDate} from '../apps/extension/src/history-dates';

test('history uses three calendar months, including month-end and leap-year boundaries',()=>{
 assert.equal(new Date(historyCutoff(new Date('2026-09-20T12:00:00Z'))).toISOString(),'2026-06-20T00:00:00.000Z');
 assert.equal(new Date(historyCutoff(new Date('2026-05-31T12:00:00Z'))).toISOString(),'2026-02-28T00:00:00.000Z');
 assert.equal(new Date(historyCutoff(new Date('2024-05-31T12:00:00Z'))).toISOString(),'2024-02-29T00:00:00.000Z');
 const now=Date.parse('2026-09-20T12:00:00Z'),cutoff=historyCutoff(new Date(now));
 assert.equal(inHistoryWindow({timestamp:new Date(cutoff).toISOString()},cutoff,now),true);
 for(const timestamp of [undefined,'not a date',new Date(cutoff-1).toISOString(),new Date(now+1).toISOString()])assert.equal(inHistoryWindow({timestamp},cutoff,now),false);
});

test('Instagram date separators support explicit years, relative dates and year rollover',()=>{
 const now=new Date(2026,0,4,15,0);
 assert.equal(parseInstagramDate('May 7, 2026, 12:28\u202fAM',now),new Date(2026,4,7,0,28).toISOString());
 assert.equal(parseInstagramDate('Dec 31, 11:59 PM',now),new Date(2025,11,31,23,59).toISOString());
 assert.equal(parseInstagramDate('Yesterday, 2:30 PM',now),new Date(2026,0,3,14,30).toISOString());
 assert.equal(parseInstagramDate('Today 9:00 AM',now),new Date(2026,0,4,9).toISOString());
 assert.equal(parseInstagramDate('I met you in May',now),undefined);
});
