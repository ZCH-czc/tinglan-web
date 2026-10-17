import {once} from 'node:events';

const CHUNK_BYTES=16*1024;

/** Keep local JSON replies bounded by socket backpressure, including large relay previews. */
export async function jsonReply(res,status,value) {
  if(res.destroyed || res.writableEnded)return false;
  const body=Buffer.from(JSON.stringify(value),'utf8');
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  if(body.length<=CHUNK_BYTES){res.end(body);return true;}
  const controller=new AbortController(),closed=()=>controller.abort();res.once('close',closed);
  try {
    for(let offset=0;offset<body.length;offset+=CHUNK_BYTES) {
      controller.signal.throwIfAborted();
      if(!res.write(body.subarray(offset,offset+CHUNK_BYTES)))await once(res,'drain',{signal:controller.signal});
    }
    res.end();return true;
  }catch(error){if(!res.destroyed)res.destroy(error);return false;}
  finally{res.removeListener('close',closed);}
}
