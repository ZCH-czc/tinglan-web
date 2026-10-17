import test from 'node:test';import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';import {stat,readdir,readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {LanTransfer,lanAddresses} from '../server/lan-transfer.mjs';
import {privateIpv4,audioFilename,hasAudioHeader,lanTarget,LAN_LIMITS} from '../web/lan-transfer-policy.mjs';
import {createGateway} from '../server/gateway.mjs';import {isolatedLoopback} from './helpers/http.mjs';import {taggedWav} from './media-fixtures.mjs';

const revision='a'.repeat(32),session=()=>({id:'owner',generation:0,accountRevision:revision}),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}) {
  let clock=1700000000000,created=0;const servers=[],owner=session(),network=[{name:'Fixture only',address:'192.168.20.10'}];
  const serverFactory=handler=>{const server=createServer(handler),listen=server.listen.bind(server);server.listen=(options,cb)=>listen({...options,host:'127.0.0.1'},cb);servers.push(server);++created;return server;};
  const receiver=new LanTransfer({now:()=>clock,interfaces:()=>network,serverFactory,...options});let intent=0;
  const input=extra=>({revision:owner.accountRevision,intent:++intent,...extra});
  const start=()=>receiver.start(owner,input({address:network[0].address}));
  const stop=()=>receiver.stop(owner,input());
  const peerUrl=()=>`http://127.0.0.1:${receiver.profile(owner).receiver.server.address().port}`;
  const headers=()=>({'X-Tinglan-Key':receiver.profile(owner).receiver.token});
  const upload=(bytes=taggedWav(),name='海风.wav',extra={})=>isolatedLoopback(peerUrl()+'/upload?name='+encodeURIComponent(name),{method:'POST',headers:{...headers(),...extra},body:bytes});
  return {receiver,owner,start,stop,input,peerUrl,headers,upload,servers,created:()=>created,setClock:value=>{clock=value;}};
}

test('private IPv4, filenames and QR targets reject public destinations and keep the Android raw protocol',()=>{
  for(const ip of ['10.1.2.3','192.168.1.1','172.16.0.1','172.31.255.254'])assert.equal(privateIpv4(ip),true);
  for(const ip of ['127.0.0.1','0.0.0.0','172.15.1.1','172.32.0.1','8.8.8.8','10.0.0.256','010.0.0.1','localhost','::1'])assert.equal(privateIpv4(ip),false);
  assert.equal(audioFilename('../../海风.wav'),'海风.wav');assert.equal(audioFilename('C:\\Music\\海:风.wav'),'海_风.wav');assert.throws(()=>audioFilename('payload.html'));
  const key='b'.repeat(64);assert.deepEqual(lanTarget('http://192.168.1.2:8080/?key='+key),{origin:'http://192.168.1.2:8080',token:key});assert.equal(lanTarget('http://192.168.1.2:8080/#key='+key).token,key);
  for(const url of ['http://8.8.8.8:8080/?key='+key,'https://192.168.1.2:8080/?key='+key,'http://u:p@192.168.1.2:8080/?key='+key,'http://192.168.1.2:8080/api?key='+key,'http://192.168.1.2:8080/?key=bad','http://192.168.1.2:8080/?key='+key+'&redirect=evil'])assert.throws(()=>lanTarget(url));
  assert.equal(hasAudioHeader('music.wav',taggedWav()),true);assert.equal(hasAudioHeader('music.mp3',taggedWav()),false);assert.equal(hasAudioHeader('music.wav',Buffer.from('<script>not audio</script>')),false);
});

test('network enumeration is bounded, deduplicated and excludes internal/public/IPv6 adapters',()=>{
  const source={one:[{address:'10.1.2.3',family:'IPv4',internal:false},{address:'::1',family:'IPv6',internal:false}],two:[{address:'10.1.2.3',family:'IPv4',internal:false},{address:'127.0.0.1',family:'IPv4',internal:true},{address:'8.8.8.8',family:'IPv4',internal:false}]};assert.deepEqual(lanAddresses(source),[{name:'one',address:'10.1.2.3'}]);
  assert.equal(lanAddresses(Object.fromEntries(Array.from({length:40},(_,i)=>['adapter-'+i,[{address:'192.168.1.'+(i+1),family:'IPv4',internal:false}]]))).length,16);
});

test('receiver stays off before explicit start, binds once under 100 intents, and stops with no directory or port left',async()=>{
  const f=fixture();assert.equal(f.receiver.state(f.owner).active,false);assert.equal(f.created(),0);
  assert.throws(()=>f.receiver.start(f.owner,{revision,intent:1,address:'0.0.0.0'}));assert.equal(f.created(),0);
  const jobs=Array.from({length:100},(_,i)=>f.receiver.start(f.owner,{revision,intent:i+1,address:'192.168.20.10'}));await Promise.all(jobs);assert.equal(f.created(),1);const r=f.receiver.profile(f.owner).receiver;assert.match(r.url,/^http:\/\/192\.168\.20\.10:\d+\/#key=[a-f0-9]{64}$/);
  assert.equal(f.receiver.state(f.owner).active,true);await f.receiver.stop(f.owner,{revision,intent:101});assert.equal(f.receiver.state(f.owner).active,false);assert.equal(r.server.listening,false);await assert.rejects(stat(r.root),error=>error.code==='ENOENT');
});

test('listener lease requires visible-page heartbeats and the ten-minute hard expiry cannot be extended',async()=>{
  const f=fixture();await f.start();const first=f.receiver.profile(f.owner).receiver;f.setClock(1700000000000+LAN_LIMITS.leaseMs-1);assert.equal(f.receiver.state(f.owner,{heartbeat:true}).active,true);
  f.setClock(1700000000000+2*LAN_LIMITS.leaseMs);assert.equal(f.receiver.state(f.owner,{heartbeat:true}).active,false);await first.closing;assert.equal(first.server.listening,false);
  await f.start();const second=f.receiver.profile(f.owner).receiver;f.setClock(second.expiresAt);assert.equal(f.receiver.state(f.owner,{heartbeat:true}).active,false);await second.closing;await f.stop();
});

test('unknown key, cross-site origin, forged host and unrelated companion paths never receive data',async()=>{
  const f=fixture();await f.start();try {
    for(const headers of [{'X-Tinglan-Key':'f'.repeat(64)},{...f.headers(),Origin:'https://evil.test'},{...f.headers(),Host:'evil.test:80'},{...f.headers(),'Sec-Fetch-Site':'cross-site'}])assert.equal((await isolatedLoopback(f.peerUrl()+'/upload?name=a.wav',{method:'POST',headers,body:taggedWav()})).status,403);
    assert.equal((await isolatedLoopback(f.peerUrl()+'/api/accounts',{headers:f.headers()})).status,403);assert.equal((await isolatedLoopback(f.peerUrl()+'/status?id=unknown',{headers:f.headers()})).status,404);assert.equal(f.receiver.state(f.owner).receipts.length,0);
  }finally{await f.stop();}
});

test('original bytes and full SHA-256 are retained once; acknowledgment releases bytes and is idempotent',async()=>{
  const f=fixture();await f.start();try {
    const bytes=taggedWav(),response=await f.upload(bytes),answer=await response.json();assert.equal(response.status,200);assert.equal(answer.status,'pending');let state=f.receiver.state(f.owner);assert.equal(state.receipts.length,1);const row=state.receipts[0],r=f.receiver.profile(f.owner).receiver;
    assert.equal(row.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(row.size,bytes.length);assert.deepEqual(await readFile(r.receipts.get(row.id).path),bytes);assert.doesNotMatch(JSON.stringify(state),/\.part|tinglan-lan-/);
    assert.equal((await f.upload(bytes,'别名.wav')).status,200);state=f.receiver.state(f.owner);assert.equal(state.receipts.length,1);assert.equal((await readdir(r.root)).length,1);
    await f.receiver.acknowledge(f.owner,{revision,id:row.id,ok:true});assert.equal(r.stored,0);assert.deepEqual(await readdir(r.root),[]);assert.equal((await f.receiver.acknowledge(f.owner,{revision,id:row.id,ok:true})).receipts[0].status,'imported');
    const status=await isolatedLoopback(f.peerUrl()+'/status?id='+row.id,{headers:f.headers()});assert.equal((await status.json()).status,'imported');assert.equal((await (await f.upload(bytes)).json()).status,'imported');assert.deepEqual(await readdir(r.root),[]);
  }finally{await f.stop();}
});

test('bad headers, empty uploads, capacity and malformed audio leave no partial files or successful receipts',async()=>{
  const f=fixture({limits:{...LAN_LIMITS,fileBytes:taggedWav().length-1}});await f.start();try {assert.equal((await f.upload()).status,400);assert.equal(f.receiver.state(f.owner).receipts.length,0);assert.deepEqual(await readdir(f.receiver.profile(f.owner).receiver.root),[]);}finally{await f.stop();}
  const g=fixture();await g.start();try {for(const [bytes,name] of [[Buffer.from('<html>bad</html>'),'music.wav'],[Buffer.alloc(0),'empty.wav'],[taggedWav(),'payload.exe']])assert.equal((await g.upload(bytes,name)).status,400);assert.deepEqual(await readdir(g.receiver.profile(g.owner).receiver.root),[]);}finally{await g.stop();}
});

test('closing or changing accounts during a partial upload clears the file and cannot install a late receipt',async()=>{
  const f=fixture();await f.start();const r=f.receiver.profile(f.owner).receiver;const upload=new Promise(resolve=>{const req=request(f.peerUrl()+'/upload?name=partial.wav',{method:'POST',headers:{...f.headers(),'Content-Length':taggedWav().length},agent:false});req.on('error',()=>resolve());req.on('response',res=>{res.resume();res.on('end',resolve);});req.write(taggedWav().subarray(0,64));});await tick();await f.receiver.clear(f.owner.id);await upload;assert.equal(r.closed,true);assert.equal(r.server.listening,false);await assert.rejects(stat(r.root),error=>error.code==='ENOENT');assert.equal(f.receiver.state(f.owner).receipts.length,0);
});

test('one machine has one active receiver owner and old/reordered start or stop commands cannot replace it',async()=>{
  const f=fixture();await f.start();try {const other={id:'other',generation:0,accountRevision:revision};assert.throws(()=>f.receiver.start(other,{revision,intent:1,address:'192.168.20.10'}),error=>error.code==='busy');assert.throws(()=>f.receiver.start(f.owner,{revision:'b'.repeat(32),intent:2,address:'192.168.20.10'}));await assert.rejects(f.receiver.stop(f.owner,{revision,intent:1}));assert.equal(f.receiver.state(f.owner).active,true);}finally{await f.stop();}
});

test('stop arriving while the listener callback is delayed invalidates the pending start and releases its directory',async()=>{
  let callback,ready;const entered=new Promise(resolve=>ready=resolve),f=fixture({serverFactory:handler=>{const server=createServer(handler),listen=server.listen.bind(server);server.listen=(options,cb)=>listen({...options,host:'127.0.0.1'},()=>{callback=cb;ready();});return server;}}),pending=f.start();await entered;const r=f.receiver.profile(f.owner).receiver;await f.stop();callback();assert.equal((await pending).active,false);assert.equal(r.server.listening,false);await assert.rejects(stat(r.root),error=>error.code==='ENOENT');
});

test('cancel before the actual bind cannot leave a port listening when the delayed bind is later attempted',async()=>{
  let bind,notify;const entered=new Promise(resolve=>notify=resolve),f=fixture({serverFactory:handler=>{const server=createServer(handler),listen=server.listen.bind(server);server.listen=(options,cb)=>{bind=()=>listen({...options,host:'127.0.0.1'},cb);notify();return server;};return server;}}),pending=f.start();await entered;const r=f.receiver.profile(f.owner).receiver;await f.stop();assert.equal((await pending).active,false);bind();await tick();await tick();assert.equal(r.server.listening,false);await assert.rejects(stat(r.root),error=>error.code==='ENOENT');
});

test('local gateway owns receive controls and file bytes; the LAN listener serves only the isolated sender entry',async()=>{
  const f=fixture(),gateway=createGateway({providers:{headers:()=>({})},lanOptions:{interfaces:()=>[{name:'Fixture',address:'192.168.20.10'}],serverFactory:handler=>{const s=createServer(handler),listen=s.listen.bind(s);s.listen=(options,cb)=>listen({...options,host:'127.0.0.1'},cb);f.servers.push(s);return s;}},lanFiles:async(req,res)=>{assert.equal(req.url,'/lan-sender.html');res.writeHead(200,{'Content-Type':'text/html'});res.end('<canvas></canvas>');}}),server=createServer((req,res)=>gateway(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;let cookie,account,intent=0;
  const send=(path,value,extra={})=>isolatedLoopback(base+path,{method:value?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...extra,...(value?{'Content-Type':'application/json'}:{})},body:value?JSON.stringify(value):undefined});
  try {
    const accounts=await send('/api/accounts');cookie=accounts.headers.get('set-cookie').split(';')[0];account=await accounts.json();const start=await send('/api/lan/start',{revision:account.revision,intent:++intent,address:'192.168.20.10'}),state=await start.json();assert.equal(state.active,true);const key=lanTarget(state.url).token,peerBase='http://127.0.0.1:'+new URL(state.url).port;
    assert.equal((await isolatedLoopback(peerBase+'/')).status,200);assert.equal((await isolatedLoopback(peerBase+'/api/health')).status,403);
    const received=await isolatedLoopback(peerBase+'/upload?name=音乐.wav',{method:'POST',headers:{'X-Tinglan-Key':key},body:taggedWav()}),receipt=(await received.json()).receipt;
    const file=await send('/api/lan/file?'+new URLSearchParams({id:receipt,revision:account.revision}));assert.equal(file.status,200);assert.equal(file.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await file.arrayBuffer()),taggedWav());
    assert.equal((await isolatedLoopback(base+'/api/lan/file?'+new URLSearchParams({id:receipt,revision:account.revision}))).status,409);
    assert.equal((await send('/api/lan/ack',{revision:account.revision,id:receipt,ok:true})).status,200);assert.equal((await send('/api/lan/start',{revision:account.revision,intent:99,address:'8.8.8.8'},{Origin:'https://evil.test'})).status,403);
    await send('/api/account',{source:'bili',cookie:''});assert.equal((await (await send('/api/lan')).json()).active,false);await tick();assert.ok(f.servers.every(s=>!s.listening));
  }finally{if(account)await send('/api/lan/stop',{revision:account.revision,intent:++intent}).catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const s of f.servers)if(s.listening){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}}
});
