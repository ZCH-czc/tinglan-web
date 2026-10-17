import {createServer} from 'node:http';
import {resolve,dirname,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';

const directory=resolve(dirname(fileURLToPath(import.meta.url)),'../build/pages');
const base=process.env.BASE_PATH || '/tinglan-web/';
if(!/^\/(?:[a-z0-9_-]+\/)*$/i.test(base))throw new Error('BASE_PATH must be an absolute directory path');
const port=Number(process.env.PORT || 4175);
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.json':'application/json','.webmanifest':'application/manifest+json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.otf':'font/otf','.txt':'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname===base.slice(0,-1)){res.writeHead(308,{Location:base});res.end();return;}
    if(!url.pathname.startsWith(base))throw new Error('Not found');
    const path=resolve(directory,decodeURIComponent(url.pathname.slice(base.length)) || 'index.html');
    if(!path.startsWith(directory+sep))throw new Error('Not found');
    const info=await stat(path);if(!info.isFile())throw new Error('Not found');
    res.writeHead(200,{'Content-Type':types[extname(path)] || 'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')res.end();else createReadStream(path).on('error',()=>res.destroy()).pipe(res);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Pages preview: http://127.0.0.1:${port}${base}`));
