import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {createGateway} from '../server/gateway.mjs';
test('download resource churn cannot evict audible streams; revoke is owned, method checked and download-only',async()=>{
  const song={id:'qq-001CacheOne',source:'qq',remoteId:'001CacheOne',title:'样本',artist:'听岚'};
  const providers={headers:()=>({}),stream:async()=>({urls:['https://isure.stream.qqmusic.qq.com/audio.wav'],type:'audio/wav'})};
  const handle=createGateway({providers,fetcher:async()=>new Response('test',{headers:{'Content-Type':'audio/wav','Content-Length':'4'}})});
  const server=createServer((req,res)=>handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{
    const health=await fetch(base+'/api/health'),cookie=health.headers.get('set-cookie').split(';')[0],headers={Cookie:cookie};
    const audible=await (await fetch(base+'/api/stream?id='+song.id,{headers})).json();let first,last;
    for(let i=0;i<70;i++){last=await (await fetch(base+'/api/cache-stream?id='+song.id,{headers})).json();first ||=last;}
    assert.equal((await fetch(base+audible.url,{headers,method:'HEAD'})).status,200);assert.equal((await fetch(base+first.url,{headers,method:'HEAD'})).status,410);assert.equal((await fetch(base+last.url,{headers,method:'HEAD'})).status,200);
    const revoke=(path,extra={})=>fetch(base+'/api/cache-revoke',{method:'POST',headers:{...headers,'Content-Type':'application/json',...extra},body:JSON.stringify({path})});
    assert.equal((await revoke(last.url,{Origin:'https://foreign.test'})).status,403);assert.equal((await fetch(base+'/api/cache-revoke',{headers})).status,405);assert.equal((await revoke('https://foreign.test/file')).status,400);
    assert.equal((await fetch(base+'/api/cache-revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:last.url})})).status,200);assert.equal((await fetch(base+last.url,{headers,method:'HEAD'})).status,200);
    await revoke(audible.url);assert.equal((await fetch(base+audible.url,{headers,method:'HEAD'})).status,200);await revoke(last.url);assert.equal((await fetch(base+last.url,{headers,method:'HEAD'})).status,410);
    assert.equal((await fetch(base+'/api/cache-stream?id='+song.id,{headers,method:'POST'})).status,405);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
