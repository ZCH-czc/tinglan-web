import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {recognitionForm,MusicRecognitionGateway} from '../server/music-recognition.mjs';
import {RequestGovernor} from '../server/upstream.mjs';
import {createGateway} from '../server/gateway.mjs';
const input={fingerprint:'AQIDBA==',duration:6};
const match={code:200,data:{result:[{song:{id:123,name:'海风',artists:[{id:7,name:'听岚'}],album:{name:'山海',picUrl:'https://p1.music.126.net/a.jpg'},duration:180000}}]}};
test('recognition protocol accepts only canonical bounded six second fingerprints',()=>{
  const form=new URLSearchParams(recognitionForm(input));assert.equal(form.get('algorithmCode'),'shazam_v2');assert.equal(form.get('duration'),'6');assert.equal(form.get('rawdata'),'AQIDBA==');assert.equal(form.get('times'),'2');assert.equal(form.get('decrypt'),'1');assert.match(form.get('sessionId'),/^[a-f0-9-]{36}$/);assert.equal([...form].length,6);
  for(const bad of [{...input,duration:7},{...input,audio:'PRIVATE'},{...input,fingerprint:'AAAA='},{...input,fingerprint:'***='},{...input,fingerprint:'A'.repeat(87388)},null])assert.throws(()=>recognitionForm(bad),error=>error.code==='invalid-request');
});
test('anonymous request sends no account headers or audio and maps a usable platform song',async()=>{
  let called=0;const gateway=new MusicRecognitionGateway(new RequestGovernor({gap:0,fetcher:async(url,options)=>{++called;assert.equal(url,'https://interface.music.163.com/api/music/audio/match');assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.cookie,undefined);assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(new URLSearchParams(options.body).get('rawdata'),input.fingerprint);return Response.json(match);}}));const result=await gateway.match('local-session',input);assert.equal(called,1);assert.equal(result.song.id,'netease-123');assert.equal(result.song.creatorId,'7');assert.equal(result.song.artist,'听岚');
});
test('empty match is distinct from malformed service responses',async()=>{for(const [data,wanted] of [[{code:200,data:{result:[]}},false],[{code:200,data:{}},'invalid-response'],[{code:500,data:{result:[]}},'invalid-response'],[{code:200,data:{result:[{}]}},'invalid-response']]){const g=new MusicRecognitionGateway({json:async()=>data});if(wanted===false)assert.deepEqual(await g.match('s',input),{matched:false,song:null});else await assert.rejects(g.match('s',input),error=>error.code===wanted);}});
test('recognition skips unsafe IDs and accepts integer strings from the upstream parser',async()=>{
  const g=new MusicRecognitionGateway({json:async()=>({code:200,data:{result:[{song:{...match.data.result[0].song,id:'9007199254740993'}},{song:{...match.data.result[0].song,id:'456'}}]}})});assert.equal((await g.match('s',input)).song.id,'netease-456');
});
test('one in-flight request per session and cooldown prevent click floods',async()=>{
  let resolve,calls=0,now=1000;const g=new MusicRecognitionGateway({json:()=>{++calls;return new Promise(r=>resolve=r);}},{now:()=>now});const p=g.match('a',input);await assert.rejects(g.match('a',input),error=>error.code==='busy');resolve(match);await p;await assert.rejects(g.match('a',input),error=>error.code==='cooldown' && error.retryAfter===10);assert.equal(calls,1);now+=10000;const next=g.match('a',input);resolve(match);await next;assert.equal(calls,2);
});
test('upstream verification challenge is not retried and cools down the platform',async()=>{
  let calls=0;const net=new RequestGovernor({gap:0,fetcher:async()=>{++calls;return new Response('',{status:429,headers:{'Retry-After':'60'}});}}),g=new MusicRecognitionGateway(net);await assert.rejects(g.match('a',input),error=>error.code==='verification');await assert.rejects(g.match('b',input),error=>error.code==='cooldown');assert.equal(calls,1);
});
test('aborting a match cannot publish the late upstream result',async()=>{const c=new AbortController();let finish;const g=new MusicRecognitionGateway({json:()=>new Promise(r=>finish=r)});const p=g.match('s',input,c.signal);c.abort();finish(match);await assert.rejects(p,{name:'AbortError'});});
test('same-origin HTTP recognition validates method, body and source and returns a stream-ready song',async()=>{
  const calls=[],providers={net:{json:async(...args)=>{calls.push(args);return match;}},headers:()=>({})};const handler=createGateway({providers}),server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const send=async(path,options={})=>{const response=await fetch(base+path,{...options,headers:{Connection:'close',...options.headers},signal:AbortSignal.timeout(5000)});return {status:response.status,value:await response.json()};};
  try {
    assert.equal((await send('/api/recognition')).status,405);
    assert.equal((await send('/api/recognition',{method:'POST',body:'{}'})).status,400);
    assert.equal((await send('/api/recognition',{method:'POST',headers:{Origin:'https://other.test'},body:JSON.stringify(input)})).status,403);
    const result=await send('/api/recognition',{method:'POST',body:JSON.stringify(input)});assert.equal(result.status,200);assert.equal(result.value.song.id,'netease-123');assert.equal(calls.length,1);
    assert.equal((await send('/api/recognition',{method:'POST',body:JSON.stringify({...input,fingerprint:'A'.repeat(100000)})})).status,413);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
