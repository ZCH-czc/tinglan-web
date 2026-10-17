import {createServer} from 'node:http';
import {networkInterfaces,tmpdir} from 'node:os';
import {mkdtemp,open,unlink,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {once} from 'node:events';
import {PlatformError} from './upstream.mjs';
import {jsonReply} from './http-replies.mjs';
import {LAN_LIMITS,privateIpv4,audioFilename,hasAudioHeader} from '../web/lan-transfer-policy.mjs';

const bad=(message,code='invalid-request',status=400)=>new PlatformError(code,message,status);
const id=()=>randomBytes(24).toString('hex');
const peer=value=>privateIpv4(value) || value==='127.0.0.1';
export function lanAddresses(source=networkInterfaces()) {
  return Object.entries(source).flatMap(([name,rows])=>(rows || []).filter(row=>!row.internal && row.family==='IPv4' && privateIpv4(row.address)).map(row=>({name:name.slice(0,100),address:row.address}))).filter((row,i,rows)=>rows.findIndex(other=>other.address===row.address)===i).slice(0,16);
}

/** A user-started receiver is isolated from all companion accounts and media APIs. */
export class LanTransfer {
  constructor({now=Date.now,interfaces=()=>lanAddresses(),serverFactory=createServer,files,ownsSession=()=>true,limits=LAN_LIMITS}={}) {Object.assign(this,{now,interfaces,serverFactory,files,ownsSession,limits});this.profiles=new Map();this.owner=null;}
  profile(session) {
    let p=this.profiles.get(session.id);if(!p){p={session,intent:0,receiver:null,chain:Promise.resolve()};this.profiles.set(session.id,p);while(this.profiles.size>32){const old=[...this.profiles].find(([,value])=>value!==this.owner && value!==p);if(!old)break;void this.clear(old[0]).catch(()=>{});}}
    return p;
  }
  check(session,input) {if(!this.ownsSession(session) || input?.revision!==session.accountRevision)throw bad('Account or service changed. Reopen LAN transfer','session-changed',409);return this.profile(session);}
  live(p,r=p.receiver) {return !!r && p.receiver===r && !r.closed && this.ownsSession(p.session) && r.generation===p.session.generation && this.now()<r.expiresAt && this.now()<r.leaseUntil;}
  state(session,{heartbeat=false}={}) {
    const p=this.profile(session),r=p.receiver;if(r&&!this.live(p,r)){void this.close(p,r);}
    if(heartbeat && this.live(p,r))r.leaseUntil=Math.min(r.expiresAt,this.now()+this.limits.leaseMs);
    const active=this.live(p,r);
    return {intent:p.intent,active,addresses:this.interfaces(),url:active?r.url:'',expiresAt:active?r.expiresAt:0,filename:active?r.filename:'',receivedBytes:active?r.receivedBytes:0,totalBytes:active?r.totalBytes:0,receiving:active&&r.uploading,receipts:active?[...r.receipts.values()].map(({id,name,size,sha256,status,error})=>({id,name,size,sha256,status,error})):[]};
  }
  intent(p,input) {if(!Number.isSafeInteger(input.intent) || input.intent<=p.intent)throw bad('This action expired. Refresh the receiver page','session-changed',409);p.intent=input.intent;return input.intent;}
  start(session,input) {
    const p=this.check(session,input),generation=session.generation;
    if(!this.interfaces().some(row=>row.address===input.address))throw bad('Choose a currently available Wi-Fi or wired LAN address');
    if(this.owner && this.owner!==p)throw bad('Another page is receiving music. Stop it first','busy',409);
    const intent=this.intent(p,input);
    this.owner=p;
    const work=p.chain.catch(()=>{}).then(async()=>{
      if(p.intent!==intent || !this.ownsSession(session) || session.generation!==generation)return this.state(session);
      if(p.receiver)await this.close(p,p.receiver);
      if(p.intent!==intent || this.profiles.get(session.id)!==p || session.generation!==generation)return this.state(session);
      if(this.owner && this.owner!==p)throw bad('Another page is using LAN transfer','busy',409);this.owner=p;
      const root=await mkdtemp(join(tmpdir(),'tinglan-lan-')),r={id:id(),root,token:randomBytes(32).toString('hex'),generation:session.generation,closed:false,expiresAt:this.now()+this.limits.lifetimeMs,leaseUntil:this.now()+this.limits.leaseMs,receipts:new Map(),uploading:false,filename:'',receivedBytes:0,totalBytes:0,stored:0,controller:new AbortController(),work:new Set()};
      if(p.intent!==intent || this.profiles.get(session.id)!==p || !this.ownsSession(session) || session.generation!==generation){await this.close(p,r);return this.state(session);}
      p.receiver=r;this.owner=p;
      try {
        r.server=this.serverFactory((req,res)=>{const task=this.handle(p,r,req,res);r.work.add(task);task.finally(()=>r.work.delete(task)).catch(()=>{});});
        await new Promise((resolve,reject)=>{
          const cleanup=()=>{r.server.removeListener('error',failed);r.controller.signal.removeEventListener('abort',aborted);},failed=error=>{cleanup();reject(error);},aborted=()=>failed(r.controller.signal.reason || new DOMException('Cancelled','AbortError'));
          r.server.once('error',failed);r.controller.signal.addEventListener('abort',aborted,{once:true});
          if(r.controller.signal.aborted){aborted();return;}
          r.server.listen({port:0,host:input.address,signal:r.controller.signal},()=>{cleanup();resolve();});
        });
        if(p.intent!==intent || !this.ownsSession(session) || session.generation!==generation){await this.close(p,r);return this.state(session);}
        r.url=`http://${input.address}:${r.server.address().port}/#key=${r.token}`;
        r.server.on('error',()=>{void this.close(p,r).catch(()=>{});});
        r.timer=setInterval(()=>{if(!this.live(p,r))void this.close(p,r);},1000);r.timer.unref?.();
        return this.state(session,{heartbeat:true});
      }catch(error){await this.close(p,r);if(p.intent!==intent || this.profiles.get(session.id)!==p || session.generation!==generation)return this.state(session);if(error instanceof PlatformError)throw error;throw bad('Unable to start receiver. Check your network or firewall','network',503);}
    }).catch(error=>{if(this.owner===p && !p.receiver)this.owner=null;throw error;});p.chain=work;return work;
  }
  async stop(session,input) {const p=this.check(session,input);this.intent(p,input);if(p.receiver)await this.close(p,p.receiver);if(this.owner===p)this.owner=null;return this.state(session);}
  async clear(sessionId) {const p=this.profiles.get(sessionId);if(!p)return;++p.intent;this.profiles.delete(sessionId);if(this.owner===p)this.owner=null;if(p.receiver)await this.close(p,p.receiver);}
  async close(p,r) {
    if(r.closing)return r.closing;r.closed=true;r.token='';r.controller.abort();clearInterval(r.timer);if(p.receiver===r)p.receiver=null;if(this.owner===p)this.owner=null;
    r.closing=(async()=>{if(r.server){r.server.closeAllConnections();await new Promise(resolve=>r.server.close(()=>resolve()));}await Promise.allSettled([...r.work]);
      const root=resolve(r.root),parent=resolve(tmpdir());if(!root.startsWith(parent+sep) || !root.slice(parent.length+1).startsWith('tinglan-lan-'))throw new Error('Temporary transfer path escaped its owner');
      await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50});r.receipts.clear();
    })();return r.closing;
  }
  authorized(p,r,req) {
    const key=req.headers['x-tinglan-key'];return this.live(p,r) && typeof key==='string' && /^[a-f0-9]{64}$/.test(key) && r.token.length===key.length && timingSafeEqual(Buffer.from(key),Buffer.from(r.token));
  }
  async handle(p,r,req,res) {
    try {
      const address=req.socket.localAddress,host=`${address}:${req.socket.localPort}`,origin=req.headers.origin;
      if(req.headers.host!==host || !peer(req.socket.remoteAddress) || origin && origin!==`http://${host}` || req.headers['sec-fetch-site']==='cross-site')throw bad('Invalid transfer origin','forbidden',403);
      const url=new URL(req.url,`http://${host}`);
      if(!this.live(p,r))throw bad('Receiving ended. Scan the QR code again','expired',410);
      if(url.pathname==='/upload') {
        if(req.method!=='POST')throw bad('Use an audio upload request','invalid-request',405);
        if(!this.authorized(p,r,req))throw bad('Receiver code invalid or expired','forbidden',403);
        if(origin===undefined && req.headers['sec-fetch-mode'])throw bad('Invalid upload origin','forbidden',403);
        return await this.upload(p,r,req,res,url);
      }
      if(url.pathname==='/status') {
        if(req.method!=='GET' || !this.authorized(p,r,req))throw bad('Receiver code invalid or expired','forbidden',403);
        const receipt=r.receipts.get(url.searchParams.get('id'));if(!receipt)throw bad('Transfer record expired','not-found',404);
        return await jsonReply(res,200,{status:receipt.status,error:receipt.error});
      }
      if(!['GET','HEAD'].includes(req.method) || url.pathname.startsWith('/api/') || !this.files)throw bad('This endpoint only accepts local audio','forbidden',403);
      if(url.pathname==='/' || url.pathname==='/index.html')req.url='/lan-sender.html';
      const allowed=url.pathname==='/' || url.pathname==='/index.html' || /^(?:\/ui\/|\/composeResources\/|\/(?:lan-sender\.html|lan-sender\.mjs|lan-transfer-policy\.mjs|boot\.mjs|canvas-host\.css|icon\.svg)$)/.test(url.pathname);
      if(!allowed)throw bad('Resource unavailable','not-found',404);
      await this.files(req,res);
    }catch(error){await this.reject(req,res,error);}
  }
  async reject(req,res,error) {
    if(res.destroyed || res.writableEnded)return;if(res.headersSent){res.destroy();return;}
    const body=Buffer.from(JSON.stringify({error:{message:error instanceof PlatformError?error.message:'Transfer incomplete. Retry',code:error.code || 'unavailable'}}));
    res.writeHead(error instanceof PlatformError?error.status:400,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});res.flushHeaders();
    if(!req.readableEnded && !req.destroyed) {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2000);timer.unref?.();let discarded=0;
      const limit=chunk=>{discarded+=chunk.length;if(discarded>1024*1024)controller.abort();};req.on('data',limit);
      try{const ended=once(req,'end',{signal:controller.signal});req.resume();await ended;}
      catch{res.destroy();req.destroy();return;}
      finally{clearTimeout(timer);req.removeListener('data',limit);}
    }
    res.end(body);
  }
  async upload(p,r,req,res,url) {
    if(r.uploading)throw bad('Another track is being received. Retry later','busy',409);
    let name;try{name=audioFilename(url.searchParams.get('name'));}catch(error){throw bad(error.message);}
    const raw=req.headers['content-length'],total=raw===undefined?0:Number(raw);
    if(raw!==undefined && (!/^\d+$/.test(raw) || !Number.isSafeInteger(total) || total<1 || total>this.limits.fileBytes))throw bad('A track must not exceed 512 MB');
    if(r.stored+total>this.limits.pendingBytes)throw bad('Wait for the receiving device to import before sending again','storage-full',507);
    for(const [key,row] of r.receipts)if(r.receipts.size>=this.limits.rows && row.status==='imported')r.receipts.delete(key);
    if(r.receipts.size>=this.limits.rows)throw bad('Too many pending files. Wait for the receiver to import','storage-full',507);
    r.uploading=true;r.filename=name;r.receivedBytes=0;r.totalBytes=total;
    const partial=join(r.root,id()+'.part'),digest=createHash('sha256');let file,count=0,head=Buffer.alloc(0),kept=false;
    const disconnected=()=>req.destroy(),deadline=setTimeout(disconnected,this.limits.uploadMs);deadline.unref?.();r.controller.signal.addEventListener('abort',disconnected,{once:true});req.setTimeout(this.limits.uploadMs,disconnected);
    try {
      file=await open(partial,'wx',0o600);
      for await(const chunk of req){if(!this.live(p,r))throw bad('Receiving ended','expired',410);count+=chunk.length;if(count>this.limits.fileBytes || r.stored+count>this.limits.pendingBytes)throw bad('Track is too large or import staging space is full','storage-full',507);if(head.length<64)head=Buffer.concat([head,chunk.subarray(0,64-head.length)]);await file.writeFile(chunk);digest.update(chunk);r.receivedBytes=count;}
      await file.close();file=null;
      if(!count || total&&total!==count)throw bad('Transfer interrupted. Send again');
      if(!hasAudioHeader(name,head))throw bad('File is not recognizable audio. Check the original');
      if(!this.live(p,r))throw bad('Receiving ended','expired',410);
      const sha256=digest.digest('hex'),old=[...r.receipts.values()].find(row=>row.sha256===sha256),receipt=old || {id:id(),name,size:count,sha256,status:'pending',error:'',path:partial};
      if(!old){r.receipts.set(receipt.id,receipt);r.stored+=count;kept=true;}
      await jsonReply(res,200,{receipt:receipt.id,status:receipt.status,message:receipt.status==='imported'?'Added to the receiving device’s local music':'Sent. The receiving device is importing'});
    }finally{clearTimeout(deadline);await file?.close().catch(()=>{});if(!kept)await unlink(partial).catch(()=>{});r.controller.signal.removeEventListener('abort',disconnected);r.uploading=false;}
  }
  receipt(session,input,requireFile=true) {const p=this.check(session,input),r=p.receiver;if(!this.live(p,r))throw bad('Receiving ended','expired',410);const row=r.receipts.get(input.id);if(!row || requireFile&&!row.path)throw bad('Pending import file expired','not-found',404);return {p,r,row};}
  async download(session,input,req,res) {
    const {r,row}=this.receipt(session,input);if(req.method!=='GET')throw bad('Unsupported request method','invalid-request',405);
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':row.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    const work=pipeline(createReadStream(row.path),res,{signal:r.controller.signal});r.work.add(work);try{await work;}finally{r.work.delete(work);}
  }
  async acknowledge(session,input) {
    const {r,row}=this.receipt(session,input,false);if(typeof input.ok!=='boolean')throw bad('Invalid import confirmation');if(row.status==='imported')return this.state(session,{heartbeat:true});
    if(input.ok){await unlink(row.path);row.status='imported';row.path='';r.stored-=row.size;row.error='';}
    else {row.status='failed';row.error=String(input.error || 'Import incomplete. Retry on the receiving device').slice(0,180);}
    return this.state(session,{heartbeat:true});
  }
}
