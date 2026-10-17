import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('production AFP engine and eval-free bindings reproduce the independently recorded Android synthetic golden',async()=>{
  const root=new URL('../build/dist/recognition/',import.meta.url),wasm=await readFile(new URL('afp.wasm',root)),source=await readFile(new URL('afp-bindings.mjs',root),'utf8');
  assert.equal(sha(wasm),'8064415bb66e45410e88877f07cd007a3ae62ebf463aac13c159a8f13e4c8fe8');assert.equal(WebAssembly.validate(wasm),true);assert(!source.includes('new Function'));assert(!source.includes('eval('));
  const filter=Float64Array.from({length:63},(_,k)=>{const x=k-31,c=3600/16000;return (x===0?2*c:Math.sin(2*Math.PI*c*x)/(Math.PI*x))*(.54-.46*Math.cos(2*Math.PI*k/62));});const total=filter.reduce((a,b)=>a+b,0);for(let i=0;i<63;i++)filter[i]/=total;
  const sample=i=>((Math.floor(i*i/200)+i*23)%32768)-16384+((i*83)%9000)-4500;
  const pcm=new Float32Array(48000);for(let i=0;i<48000;i++){let value=0;for(let k=0;k<63;k++)value+=sample(Math.min(95999,Math.max(0,i*2+k-31)))*filter[k];pcm[i]=Math.max(-1,Math.min(1,value/32768));}
  assert.equal(sha(new Uint8Array(pcm.buffer)),'83779dc8872609470815b8d78d1a88c4e16f26256784d0efe88304d54d5fdb91');
  const {createNeteaseAfp}=await import(new URL('afp-bindings.mjs',root));const afp=await new Promise((resolve,reject)=>{createNeteaseAfp({wasmBinary:wasm,print(){},printErr(){},onAbort:()=>reject(new Error('AFP aborted')),onRuntimeInitialized:function(){resolve(this);}});});
  const vector=afp.ExtractQueryFP(pcm.buffer);try{const bytes=Uint8Array.from({length:vector.size()},(_,i)=>vector.get(i)&255);assert.equal(bytes.length,1520);assert.equal(sha(bytes),'c4d53788c250b286533c3ebe80033e51998404674d6416c5b0a80a792e4d685b');}finally{vector.delete();}
});
