import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {crops}=JSON.parse(fs.readFileSync(new URL('oak-v2-crops.json',import.meta.url)));
test('64 distinct non-overlapping crops remain inside the licensed source',()=>{
 assert.equal(crops.length,64);
 assert.equal(new Set(crops.map(c=>c.square)).size,64);
 assert.equal(new Set(crops.map(c=>c.region)).size,64);
 for(const [i,c] of crops.entries()){
  assert(c.x>=0 && c.y>=0 && c.x+c.size<=4096 && c.y+c.size<=4096);
  for(const d of crops.slice(i+1)) assert(c.x+c.size<=d.x || d.x+d.size<=c.x || c.y+c.size<=d.y || d.y+d.size<=c.y);
 }
});
test('every file and rank samples multiple source strips in both directions',()=>{
 for(const axis of [0,1]) for(const key of axis===0?'abcdefgh':'12345678'){
  const line=crops.filter(c=>c.square[axis]===key);
  assert(new Set(line.map(c=>c.region%8)).size>=5);
  assert(new Set(line.map(c=>Math.floor(c.region/8))).size>=5);
 }
});
