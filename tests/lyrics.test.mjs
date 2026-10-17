import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricMatch,normalizeLrc,kugouLyrics } from '../server/lyrics.mjs';
import {PlatformError} from '../server/upstream.mjs';
test('lyric matching rejects different singers, recording versions and durations',()=>{
  const track={title:'海风',artist:'听岚',durationMs:120000};
  assert.notEqual(lyricMatch(track,{song:'海风',singer:'听岚',duration:121000}),null);
  for(const row of [{song:'海风',singer:'别人',duration:120000},{song:'海风 (Live)',singer:'听岚',duration:120000},{song:'海风',singer:'听岚',duration:140000}])assert.equal(lyricMatch(track,row),null);
  assert.equal(lyricMatch({...track,artist:'未知艺术家'},{song:'海风',singer:'听岚',duration:120000}),null);
});
test('normalization keeps lyric punctuation and valid timing while dropping metadata',()=>{
  assert.equal(normalizeLrc('\uFEFF[ar:听岚]\n[00:01.25]冒号: 不应丢失 &amp; 声音\n[00:04][00:05]副歌\n广告'), '[00:01.25]冒号: 不应丢失 & 声音\n[00:04][00:05]副歌');
});
test('only a verified public lyric candidate is downloaded and no audio URL is resolved',async()=>{
  const urls=[];const net={json:async(_,url)=>{urls.push(url);if(url.includes('/search/song'))return {data:{info:[{songname:'海风',singername:'听岚',duration:120,hash:'a'.repeat(32)}]}};if(url.includes('/search?'))return {candidates:[{id:12,accesskey:'public-lyric-key',song:'海风',singer:'听岚',duration:120000}]};return {content:Buffer.from('[00:01]海风来信').toString('base64')};}};
  assert.deepEqual(await kugouLyrics(net,{title:'海风',artist:'听岚',durationMs:120000},{}),{text:'[00:01]海风来信',source:'kugou'});
  assert.equal(urls.length,3);assert.ok(urls.every(url=>/^https:\/\/(mobileservice|lyrics)\.kugou\.com\//.test(url)));
  assert.match(urls[2],/fmt=lrc/);
});
test('mismatched candidates keep the previous lyrics usable without downloading',async()=>{
  let downloaded=false;const net={json:async(_,url)=>{if(url.includes('/download'))downloaded=true;return url.includes('/search/song')?{data:{info:[]}}:{candidates:[{id:1,accesskey:'key',song:'其他歌曲',singer:'听岚',duration:120000}]};}};
  assert.equal((await kugouLyrics(net,{title:'海风',artist:'听岚',durationMs:120000},{})).text,'');assert.equal(downloaded,false);
});

test('song lookup failure falls back to the verified lyric keyword endpoint',async()=>{
  const calls=[],net={json:async(_,url)=>{calls.push(url);if(url.includes('/search/song'))throw new Error('recording search unavailable');if(url.includes('/search?'))return {candidates:[{id:1,accesskey:'key',song:'海风',singer:'听岚',duration:120000}]};return {content:Buffer.from('[00:01]synthetic text').toString('base64')}}};
  assert.ok((await kugouLyrics(net,{title:'海风',artist:'听岚',durationMs:120000},{})).text);assert.equal(calls.length,3);assert.match(calls[1],/keyword=/);
});
test('another verified recording and another verified lyric recover empty results',async()=>{
  let hashes=0,downloads=0;const net={json:async(_,url)=>{
    if(url.includes('/search/song'))return {data:{info:['a','b'].map(c=>({songname:'海风',singername:'听岚',duration:120,hash:c.repeat(32)}))}};
    if(url.includes('/search?'))return ++hashes===1?{candidates:[]}:{candidates:[1,2].map(id=>({id,accesskey:'key',song:'海风',singer:'听岚',duration:120000}))};
    return {content:Buffer.from(++downloads===1?'[ar:metadata only]':'[00:01]synthetic text').toString('base64')};
  }};
  assert.ok((await kugouLyrics(net,{title:'海风',artist:'听岚',durationMs:120000},{})).text);assert.equal(hashes,2);assert.equal(downloads,2);
});
test('verification or rate-limit replies stop all fallbacks immediately',async()=>{
  let requests=0;const net={json:async()=>{++requests;throw new PlatformError('verification','verification',429)}};
  await assert.rejects(kugouLyrics(net,{title:'海风',artist:'听岚',durationMs:120000},{}),e=>e.code==='verification');assert.equal(requests,1);
});
