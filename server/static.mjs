import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve,sep,extname } from 'node:path';
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.otf':'font/otf','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
export function createStaticHandler(base) {
  base=resolve(base);
  return async(req,res)=>{
    try {
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const filename=resolve(base,'.'+(path==='/'?'/index.html':path));
      if(!filename.startsWith(base+sep)){res.writeHead(403);res.end();return;}
      const details=await stat(filename);if(!details.isFile())throw new Error('missing');
      const etag=`W/"${details.size.toString(16)}-${Math.floor(details.mtimeMs).toString(16)}"`;
      const headers={'Content-Type':TYPES[extname(filename)] || 'application/octet-stream','Cache-Control':'public, max-age=0, must-revalidate',ETag:etag,Vary:'Accept-Encoding','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
      if(req.headers['if-none-match']?.split(/\s*,\s*/).includes(etag)){res.writeHead(304,headers);res.end();return;}
      const encoding=String(req.headers['accept-encoding'] || '').split(',').map(s=>s.trim().split(';')).map(([name,...params])=>({name,q:Number(params.find(s=>s.trim().startsWith('q='))?.trim().slice(2) ?? 1)})).filter(v=>v.q>0);
      let asset=filename,size=details.size;
      for(const name of ['br','gzip']){
        if(!encoding.some(v=>v.name===name || v.name==='*'))continue;
        try {const candidate=filename+(name==='br'?'.br':'.gz'),info=await stat(candidate);if(info.mtimeMs+1<details.mtimeMs || !info.isFile())continue;asset=candidate;size=info.size;headers['Content-Encoding']=name;break;}catch{/* Uncompressed assets remain valid. */}
      }
      headers['Content-Length']=size;res.writeHead(200,headers);
      if(req.method==='HEAD')res.end();else await pipeline(createReadStream(asset),res);
    }catch(error){if(res.headersSent){res.destroy();return;}res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('File not found. Run ./gradlew webDistribution first.');}
  };
}
