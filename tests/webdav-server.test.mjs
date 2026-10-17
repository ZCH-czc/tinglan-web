import test from 'node:test';import assert from 'node:assert/strict';import {createServer,request} from 'node:http';
import {WebDavHandoff,webdavConfiguration} from '../server/webdav-handoff.mjs';
import {createGateway} from '../server/gateway.mjs';import {isolatedLoopback} from './helpers/http.mjs';
const now=1700000000000;
const config={endpoint:'https://storage.test/dav/',username:'fixture-user',password:'fixture-only',deviceId:'web-device',deviceName:'浏览器'};
const snapshot=(device='web-device',name='浏览器',updatedAt=now)=>({sessionId:'native-compatible-session',deviceId:device,deviceName:name,updatedAt,tracks:[{id:'qq:track:001AbCdefghij',title:'海风',artist:'听岚',duration:100}],index:0,positionMs:12345});
const nonce=i=>i.toString(16).padStart(48,'0');const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture({override,timeout=30000}={}) {
  const calls=[],session={id:'fixture-session',generation:0,accountRevision:'a'.repeat(32)},nas={value:null,tag:'"1"',next:1};let clock=now;
  const fetcher=async(address,options)=>{const url=new URL(address);calls.push({url,options});const answer=await override?.(url,options,nas);if(answer)return answer;
    if(options.method==='MKCOL'){assert.equal(url.pathname,'/dav/Tinglan/');return new Response(null,{status:201});}
    assert.equal(url.pathname,'/dav/Tinglan/playback.json');
    if(options.method==='GET')return nas.value?Response.json(nas.value,{headers:{ETag:nas.tag}}):new Response(null,{status:404});
    assert.equal(options.method,'PUT');if((nas.value?options.headers['If-Match']!==nas.tag:options.headers['If-None-Match']!=='*'))return new Response(null,{status:412});
    nas.value=JSON.parse(options.body);nas.tag='"'+(++nas.next)+'"';return new Response(null,{status:204,headers:{ETag:nas.tag}});
  };
  const dav=new WebDavHandoff({fetcher,now:()=>clock,timeout}),input=extra=>({revision:session.accountRevision,configRevision:dav.state(session).configRevision,...extra});
  const connect=()=>dav.connect(session,input({...config,intent:dav.state(session).intent+1}));const posts=()=>calls.filter(row=>row.options.method==='PUT');
  return {dav,session,nas,calls,fetcher,input,connect,posts,setNow:value=>{clock=value;}};
}
test('configuration permits explicit HTTPS NAS directories and rejects credentials in URLs, query, fragments and unsafe names',()=>{
  assert.equal(webdavConfiguration({...config,endpoint:'https://storage.test:8443/音乐'}).endpoint,'https://storage.test:8443/%E9%9F%B3%E4%B9%90/');
  for(const endpoint of ['http://storage.test/','file:///tmp','https://user:pass@storage.test/','https://storage.test/?token=private','https://storage.test/#secret'])assert.throws(()=>webdavConfiguration({...config,endpoint}));
  for(const patch of [{username:'user:bad'},{username:'x\r\n'},{password:'x\n'},{deviceName:'  '},{deviceId:''}])assert.throws(()=>webdavConfiguration({...config,...patch}));
});
test('connect creates the Android folder, verifies a readable file, and never returns the password or Authorization',async()=>{
  const f=fixture(),value=await f.connect();assert.equal(value.connected,true);assert.equal(value.remote,null);assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.redirect,'manual');assert.equal(f.calls[0].options.headers.Cookie,undefined);assert.match(f.calls[0].options.headers.Authorization,/^Basic /);assert.doesNotMatch(JSON.stringify(value),/fixture-only|Authorization|password/);
});
test('publication creates with If-None-Match, updates with a strong If-Match, and preserves the canonical Android JSON',async()=>{
  const f=fixture();await f.connect();const first=await f.dav.mutate(f.session,'publish',f.input({snapshot:snapshot(),operation:nonce(1)}));assert.equal(first.written,true);assert.equal(f.posts()[0].options.headers['If-None-Match'],'*');assert.equal(f.nas.value.version,1);assert.equal(f.nas.value.tracks[0].id,'qq:track:001AbCdefghij');
  const tag=f.nas.tag;await f.dav.mutate(f.session,'publish',f.input({snapshot:{...snapshot(),positionMs:15000},operation:nonce(2)}));assert.equal(f.posts()[1].options.headers['If-Match'],tag);assert.equal(f.nas.value.positionMs,15000);assert.doesNotMatch(f.posts()[1].options.body,/fixture-only|Authorization|password/);
});
test('Android default-version records are read and claimed only with the exact displayed ETag',async()=>{
  const f=fixture();f.nas.value=snapshot('android-device','车机');const connected=await f.connect();assert.equal(connected.remote.snapshot.version,1);
  const claimed=await f.dav.mutate(f.session,'claim',f.input({remoteToken:connected.remote.token,operation:nonce(1)}));assert.equal(claimed.snapshot.deviceId,'web-device');assert.equal(claimed.snapshot.deviceName,'浏览器');assert.equal(claimed.snapshot.positionMs,12345);assert.equal(claimed.snapshot.sessionId,'native-compatible-session');assert.equal(f.posts()[0].options.headers['If-Match'],'"1"');
});
test('another device update, deleted files and a first-write race cannot be silently overwritten or retried',async()=>{
  const f=fixture();f.nas.value=snapshot('android-device','车机');const connected=await f.connect();f.nas.tag='"other-device"';
  await assert.rejects(f.dav.mutate(f.session,'claim',f.input({remoteToken:connected.remote.token,operation:nonce(1)})),error=>error.code==='conflict');assert.equal(f.posts().length,1);assert.equal(f.nas.value.deviceId,'android-device');
  await assert.rejects(f.dav.mutate(f.session,'claim',f.input({remoteToken:connected.remote.token,operation:nonce(2)})),error=>error.code==='needs-refresh');assert.equal(f.posts().length,1);
  const raced=fixture({override:async(_url,options,nas)=>{if(options.method==='PUT'&&!nas.value){nas.value=snapshot('android-device','车机');nas.tag='"winner"';}}});await raced.connect();await assert.rejects(raced.dav.mutate(raced.session,'publish',raced.input({snapshot:snapshot(),operation:nonce(1)})),error=>error.code==='conflict');assert.equal(raced.posts().length,1);
});
test('100 identical requests share one conditional PUT and reusing an operation for different content is rejected',async()=>{
  const f=fixture();await f.connect();const input=f.input({snapshot:snapshot(),operation:nonce(1)}),values=await Promise.all(Array.from({length:100},()=>f.dav.mutate(f.session,'publish',input)));assert.equal(f.posts().length,1);assert.ok(values.every(value=>value.written));
  await f.dav.mutate(f.session,'publish',input);assert.equal(f.posts().length,1);await assert.rejects(f.dav.mutate(f.session,'publish',{...input,snapshot:{...snapshot(),positionMs:15000}}),error=>error.code==='invalid-request');
});
test('weak/missing ETags, malformed and oversized files never allow unsafe publication',async()=>{
  for(const etag of [undefined,'W/"1"','unquoted','"one", "two"']) {
    const f=fixture({override:async(_url,options)=>options.method==='GET'?Response.json(snapshot(),{headers:etag?{ETag:etag}:{}}):null});await assert.rejects(f.connect(),error=>error.code==='invalid-response');assert.equal(f.posts().length,0);
  }
  const huge=fixture({override:async(_url,options)=>options.method==='GET'?new Response('x'.repeat(131073),{headers:{ETag:'"1"'}}):null});await assert.rejects(huge.connect(),error=>error.code==='invalid-response');
  const corrupt=fixture({override:async(_url,options)=>options.method==='GET'?new Response('not json',{headers:{ETag:'"1"'}}):null});await assert.rejects(corrupt.connect(),error=>error.code==='invalid-response');
});
test('expired remote sessions retain a strong ETag for replacement but cannot be claimed',async()=>{
  const f=fixture();f.nas.value=snapshot('android-device','旧设备',now-8*86400000);const value=await f.connect();assert.equal(value.remote.expired,true);await assert.rejects(f.dav.mutate(f.session,'claim',f.input({remoteToken:value.remote.token,operation:nonce(1)})),error=>error.code==='expired');assert.equal(f.posts().length,0);
  await f.dav.refresh(f.session,f.input());await f.dav.mutate(f.session,'publish',f.input({snapshot:snapshot(),operation:nonce(2)}));assert.equal(f.posts()[0].options.headers['If-Match'],'"1"');
});
test('redirects, authorization, locks, full storage and asynchronous 202 writes remain explicit and do not retry',async()=>{
  for(const [status,code] of [[302,'redirect'],[401,'sign-in'],[403,'sign-in'],[423,'locked'],[507,'storage-full'],[202,'write-unconfirmed']]) {
    const f=fixture({override:async(_url,options)=>options.method==='PUT'?new Response(null,{status,headers:{Location:'https://other.test/'}}):null});await f.connect();await assert.rejects(f.dav.mutate(f.session,'publish',f.input({snapshot:snapshot(),operation:nonce(1)})),error=>error.code===code);assert.equal(f.posts().length,1);assert.equal(f.dav.state(f.session).needsRefresh,true);
  }
});
test('disconnect during connect and changed accounts reject delayed credential installation or PUT acknowledgment',async()=>{
  const wait=deferred(),entered=deferred(),f=fixture({override:async(_url,options)=>{if(options.method==='MKCOL'){entered.resolve();return wait.promise;}}}),connection=f.connect().catch(error=>error);await entered.promise;
  f.dav.forget(f.session,f.input({intent:2}));wait.resolve(new Response(null,{status:201}));await connection;assert.equal(f.dav.state(f.session).connected,false);assert.equal(f.calls.length,1);
  const post=deferred(),start=deferred(),g=fixture({override:async(_url,options)=>{if(options.method==='PUT'){start.resolve();return post.promise;}}});await g.connect();const old=g.dav.mutate(g.session,'publish',g.input({snapshot:snapshot(),operation:nonce(1)})).catch(error=>error);await start.promise;++g.session.generation;g.session.accountRevision='c'.repeat(32);g.dav.invalidate(g.session.id);post.resolve(new Response(null,{status:204}));assert.equal((await old).code,'session-changed');assert.equal(g.dav.state(g.session).remote,null);
});
test('100 out-of-order connections install only the latest owner and session state remains bounded',async()=>{
  const waits=[],f=fixture({override:async(_url,options)=>{if(options.method==='MKCOL'){const d=deferred();waits.push(d);return d.promise;}}});const revision=f.dav.state(f.session).configRevision;
  const jobs=Array.from({length:100},(_,i)=>f.dav.connect(f.session,{...config,deviceName:'设备 '+i,revision:f.session.accountRevision,configRevision:revision,intent:i+1}).catch(error=>error));await tick();
  for(const d of waits)d.resolve(new Response(null,{status:201}));await Promise.all(jobs);assert.equal(f.dav.state(f.session).configuration.deviceName,'设备 99');
  for(let i=0;i<150;i++)f.dav.state({id:'session-'+i,generation:0,accountRevision:'a'.repeat(32)});assert.equal(f.dav.profiles.size,100);
});
test('actual gateway HTTP splits UTF-8 safely and isolates endpoint credentials and connection revisions',async()=>{
  const f=fixture(),handler=createGateway({providers:{headers:()=>({}),net:{clearIdentity:()=>{}}},fetcher:f.fetcher,now:()=>now}),server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try {
    const response=await isolatedLoopback(base+'/api/accounts'),cookie=response.headers.get('set-cookie').split(';')[0],account=await response.json();
    const send=(path,value,headers={})=>isolatedLoopback(base+path,{method:value?'POST':'GET',headers:{Cookie:cookie,...(value?{'Content-Type':'application/json'}:{}),...headers},body:value?JSON.stringify(value):undefined});
    const state=await (await send('/api/webdav')).json(),input={...config,revision:account.revision,configRevision:state.configRevision,intent:1};assert.equal((await send('/api/webdav/connect',input,{Origin:'https://evil.test'})).status,403);
    const connectedResponse=await send('/api/webdav/connect',input),connected=await connectedResponse.json();assert.equal(connectedResponse.status,200);assert.equal(connectedResponse.headers.get('cache-control'),'no-store');assert.doesNotMatch(JSON.stringify(connected),/fixture-only|password|Authorization/);
    const payload=Buffer.from(JSON.stringify({revision:account.revision,configRevision:connected.configRevision,operation:nonce(1),snapshot:{...snapshot(),tracks:[{...snapshot().tracks[0],title:'海风🎵'}]}})),split=payload.indexOf(Buffer.from('🎵'))+1;
    const written=await new Promise((resolve,reject)=>{const req=request(base+'/api/webdav/publish',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},agent:false},res=>{const parts=[];res.on('data',p=>parts.push(p));res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(Buffer.concat(parts))}));});req.on('error',reject);req.write(payload.subarray(0,split));setImmediate(()=>req.end(payload.subarray(split)));});assert.equal(written.status,200);assert.equal(f.nas.value.tracks[0].title,'海风🎵');
    const stranger=await (await isolatedLoopback(base+'/api/webdav')).json();assert.equal(stranger.connected,false);assert.equal(stranger.configuration,null);assert.equal((await send('/api/webdav/publish')).status,405);
    const large=await send('/api/webdav/publish',{revision:account.revision,configRevision:connected.configRevision,operation:nonce(2),snapshot:{...snapshot(),tracks:Array.from({length:40},(_,i)=>({...snapshot().tracks[0],id:'qq:track:001Song'+String(i).padStart(4,'0'),title:'海'.repeat(512),artist:'岚'.repeat(512)}))}});assert.equal(large.status,200);const complete=await large.json();assert.equal(complete.written,true);assert.equal(complete.snapshot.tracks.length,40);assert.equal(complete.snapshot.tracks[39].title,'海'.repeat(512));assert.deepEqual(complete.remote.snapshot,complete.snapshot);assert.doesNotMatch(JSON.stringify(complete),/fixture-only|password|Authorization/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
