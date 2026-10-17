import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {jsonReply} from '../server/http-replies.mjs';

class SlowResponse extends EventEmitter {
  constructor(){super();this.destroyed=false;this.writableEnded=false;this.chunks=[];this.slow=true;}
  writeHead(status,headers){this.status=status;this.headers=headers;}
  write(bytes){this.chunks.push(Buffer.from(bytes));return !this.slow;}
  end(bytes){if(bytes)this.chunks.push(Buffer.from(bytes));this.writableEnded=true;}
  destroy(){this.destroyed=true;this.emit('close');}
}

test('large UTF-8 JSON replies stop writing while the socket is full and resume without truncation',async()=>{
  const res=new SlowResponse(),value={tracks:Array.from({length:40},(_,i)=>({id:String(i),title:'海🎵'.repeat(512),artist:'岚'.repeat(512)}))},work=jsonReply(res,200,value);
  assert.equal(res.chunks.length,1);assert.equal(res.writableEnded,false);assert.equal(res.chunks[0].length,16384);
  res.slow=false;res.emit('drain');assert.equal(await work,true);const body=Buffer.concat(res.chunks);assert.equal(body.length,res.headers['Content-Length']);assert.deepEqual(JSON.parse(body),value);assert.ok(res.chunks.every(chunk=>chunk.length<=16384));assert.equal(res.listenerCount('close'),0);assert.equal(res.listenerCount('drain'),0);
});

test('closing a client during backpressure disposes the wait and never completes a partial JSON reply',async()=>{
  const res=new SlowResponse(),work=jsonReply(res,200,{text:'海'.repeat(100000)});res.destroy();assert.equal(await work,false);assert.equal(res.writableEnded,false);assert.equal(res.chunks.length,1);assert.equal(res.listenerCount('close'),0);assert.equal(res.listenerCount('drain'),0);
  const closed=new SlowResponse();closed.destroy();assert.equal(await jsonReply(closed,200,{ok:true}),false);assert.equal(closed.chunks.length,0);
});
