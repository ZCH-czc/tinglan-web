/** Drain even status-only replies before the next loopback request; never retry failed requests. */
export async function statusResponse(url,options) {
  const response=await fetch(url,options);
  await response.arrayBuffer();
  return response;
}
import {request} from 'node:http';

/** Each stress request owns a fresh socket. No global fetch pool survives closed fixture servers. No retries. */
export function isolatedLoopback(url,options={}) {
  const address=new URL(url);if(address.protocol!=='http:' || !['127.0.0.1','localhost'].includes(address.hostname))throw new Error('Fixture transport only accepts loopback HTTP');
  const payload=options.body===undefined?undefined:Buffer.isBuffer(options.body)?options.body:Buffer.from(String(options.body),'utf8');
  return new Promise((resolve,reject)=>{
    const started=Date.now();let phase='creating',localPort=0,receivedBytes=0,expectedBytes=0;
    const req=request(address,{method:options.method || 'GET',headers:{...options.headers,...(payload?{'Content-Length':payload.length}:{})},agent:false},res=>{
      phase='receiving';expectedBytes=Number(res.headers['content-length']) || 0;
      const chunks=[];let size=0;res.on('error',reject);res.on('aborted',()=>reject(new Error('Loopback response aborted: '+address.pathname)));
      res.on('data',chunk=>{size+=chunk.length;receivedBytes=size;if(size>8*1024*1024)req.destroy(new Error('Loopback fixture response too large'));else chunks.push(chunk);});
      res.on('end',()=>{const bytes=Buffer.concat(chunks),headers=new Headers();for(const [key,value] of Object.entries(res.headers))for(const item of Array.isArray(value)?value:[value])if(item!==undefined)headers.append(key,item);
        resolve({status:res.statusCode,headers,json:async()=>JSON.parse(bytes.toString('utf8')),text:async()=>bytes.toString('utf8'),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
      });
    });
    req.on('socket',socket=>{phase='connecting';socket.once('connect',()=>{phase='connected';localPort=socket.localPort;});});
    req.setTimeout(5000,()=>req.destroy(new Error('Loopback request timeout: '+address.pathname)));req.on('error',error=>{error.message=`${address.pathname}: ${error.message} (phase=${phase}, elapsedMs=${Date.now()-started}, remotePort=${address.port}, localPort=${localPort}, payloadBytes=${payload?.length || 0}, responseBytes=${receivedBytes}/${expectedBytes})`;reject(error);});req.end(payload);
  });
}
