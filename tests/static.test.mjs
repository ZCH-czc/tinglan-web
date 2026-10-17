import test from 'node:test';import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';import { tmpdir } from 'node:os';import { join } from 'node:path';import { createServer } from 'node:http';import { gzipSync,brotliCompressSync } from 'node:zlib';
import { createStaticHandler } from '../server/static.mjs';
test('static assets support Brotli, gzip, revalidation and HEAD without changing their decoded bytes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'tinglan-static-'));const bytes=Buffer.from('听岚自绘资源'.repeat(300));await writeFile(join(dir,'engine.wasm'),bytes);await writeFile(join(dir,'engine.wasm.br'),brotliCompressSync(bytes));await writeFile(join(dir,'engine.wasm.gz'),gzipSync(bytes));
  const server=createServer(createStaticHandler(dir));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/engine.wasm`;
  try{const response=await fetch(url,{headers:{'Accept-Encoding':'br,gzip'}});assert.equal(response.headers.get('content-encoding'),'br');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    const gzip=await fetch(url,{headers:{'Accept-Encoding':'br;q=0,gzip'}});assert.equal(gzip.headers.get('content-encoding'),'gzip');assert.deepEqual(Buffer.from(await gzip.arrayBuffer()),bytes);
    const etag=response.headers.get('etag');assert.equal((await fetch(url,{headers:{'If-None-Match':etag}})).status,304);
    const head=await fetch(url,{method:'HEAD'});assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(head.headers.get('content-type'),'application/wasm');
    assert.equal((await fetch(url.replace('engine.wasm','%2e%2e%2foutside.txt'))).status,403);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
