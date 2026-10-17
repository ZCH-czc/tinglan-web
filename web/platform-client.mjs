import {tr} from './i18n.mjs';
import {requireCompanion, STATIC_HOSTING} from './deployment.mjs';
import {searchTerm} from './search-history.mjs';
import {hostFetch} from './host-api.mjs';
import {requestPlatformJson} from './platform-request.mjs';
const SOURCES = ['qq','bili','netease'];
export class PlatformClient {
  constructor(store, { fetcher=hostFetch, timeout=18_000, staticHosting=STATIC_HOSTING }={}) { this.staticHosting=staticHosting; this.store=store; this.fetcher=fetcher; this.timeout=timeout; this.controllers=new Map(); this.generation=0;this.accountRevision='';this.accountRead=0; }
  request(path,{timeoutMs=this.timeout,...options}={}) {
    try { requireCompanion(this.staticHosting); } catch(error) { return Promise.reject(error); }
    return requestPlatformJson(path,{...options,timeoutMs,fetcher:this.fetcher});
  }
  cancel(scope) {this.controllers.get(scope)?.abort();this.controllers.delete(scope);}
  async catalog(source,query='',page=1,{force=false,scope='search',kind='songs'}={}) {
    if(!SOURCES.includes(source))throw new TypeError('Unknown music source');
    if(!['songs','creators'].includes(kind))throw new TypeError('Unknown search kind');
    const key=`${scope}:${source}`;this.cancel(key);query=searchTerm(query);
    // Search never falls through to recommendations, including retry, pagination and IME blanks.
    if(scope==='search' && !query)return {songs:[],creators:[],more:false};
    const controller=new AbortController();this.controllers.set(key,controller);
    const generation=this.generation;
    const cacheKey=`${scope}|${this.accountRevision || generation}|${source}|${query}|${page}${kind==='creators'?'|creators':''}`;
    let cached;
    try {
      cached=await this.store.read('catalog',cacheKey).catch(()=>null);
      controller.signal.throwIfAborted();
      if(!force && cached)return {...cached,fromCache:true};
      const data=await this.request(`/api/catalog?${new URLSearchParams({source,q:query,page,kind})}`,{signal:controller.signal});
      controller.signal.throwIfAborted();
      if(generation!==this.generation)throw new DOMException('Account changed','AbortError');
      await this.store.cacheCatalog(cacheKey,data).catch(()=>{});
      controller.signal.throwIfAborted();if(generation!==this.generation)throw new DOMException('Account changed','AbortError');return data;
    } catch(error) {controller.signal.throwIfAborted();if(generation!==this.generation)throw new DOMException('Account changed','AbortError');if(error.name==='AbortError')throw error;if(cached)return {...cached,fromCache:true,warning:tr("Connection lost. Showing previous results")};throw error;}
    finally {if(this.controllers.get(key)===controller)this.controllers.delete(key);}
  }
  source(id,signal) {return this.request(`/api/stream?id=${encodeURIComponent(id)}`,{signal});}
  mediaState(url,signal) {
    const path=new URL(url,globalThis.location?.href || 'http://localhost/').pathname;
    if(!/^\/api\/media\/[a-f0-9]{48}$/.test(path))return Promise.resolve({failure:null});
    return this.request('/api/media-state?'+new URLSearchParams({path}),{signal,timeoutMs:5000});
  }
  cacheSource(id,signal) {return this.request(`/api/cache-stream?id=${encodeURIComponent(id)}`,{signal});}
  video(id,quality,signal) {return this.request(`/api/video?${new URLSearchParams({id,quality})}`,{signal});}
  danmaku(id,signal) {return this.request(`/api/danmaku?id=${encodeURIComponent(id)}`,{signal});}
  async creator(source,id,page=1,{force=false,signal,profileOnly=false}={}) {
    const generation=this.generation,key=`creator|${this.accountRevision || generation}|${source}|${id}|${page}${profileOnly?'|profile':''}`;
    const cached=await this.store.read('catalog',key).catch(()=>null);signal?.throwIfAborted();
    if(generation!==this.generation)throw new DOMException('Account changed','AbortError');
    if(cached && !force)return cached;
    try {const value=await this.request(`/api/creator?${new URLSearchParams({source,id,page,...(profileOnly?{mode:'profile'}:{})})}`,{signal});signal?.throwIfAborted();if(generation!==this.generation)throw new DOMException('Account changed','AbortError');await this.store.cacheCatalog(key,value).catch(()=>{});signal?.throwIfAborted();if(generation!==this.generation)throw new DOMException('Account changed','AbortError');return value;}
    catch(error){signal?.throwIfAborted();if(generation!==this.generation)throw new DOMException('Account changed','AbortError');if(error.name==='AbortError')throw error;if(cached)return {...cached,warning:tr("Connection lost. Showing previous results")};throw error;}
  }
  async content(name,params,{force=false,signal}={}) {
    const generation=this.generation,query=new URLSearchParams(params),key=`${name}|${this.accountRevision || generation}|${query}`;
    const cached=await this.store.read('catalog',key).catch(()=>null);signal?.throwIfAborted();
    if(generation!==this.generation)throw new DOMException('Account changed','AbortError');
    if(cached && !force)return cached;
    try {
      const value=await this.request(`/api/${name}?${query}`,{signal});signal?.throwIfAborted();
      if(generation!==this.generation)throw new DOMException('Account changed','AbortError');
      await this.store.cacheCatalog(key,value).catch(()=>{});signal?.throwIfAborted();
      if(generation!==this.generation)throw new DOMException('Account changed','AbortError');return value;
    }catch(error){signal?.throwIfAborted();if(generation!==this.generation)throw new DOMException('Account changed','AbortError');if(error.name==='AbortError')throw error;if(cached)return {...cached,warning:tr("Connection lost. Showing previous results")};throw error;}
  }
  comments(request,options={}) {return this.content('comments',{id:request.id,order:request.order || 'hot',root:request.root || '',cursor:request.cursor || ''},options);}
  collection(request,options={}) {return this.content('collection',{source:request.source,id:request.id,page:request.page || 1},options);}
  biliContext(id,options={}) {return this.content('bili-context',{id},options);}
  async videoActions(id,{force=false,signal}={}) {
    const generation=this.generation,revision=this.accountRevision;
    const value=await this.request(`/api/bili-actions?${new URLSearchParams({id,revision,...(force?{force:'1'}:{})})}`,{signal});
    signal?.throwIfAborted();if(generation!==this.generation || revision!==this.accountRevision)throw new DOMException('Account changed','AbortError');return value;
  }
  async videoAction(id,input) {
    const generation=this.generation,revision=this.accountRevision;
    const value=await this.request('/api/bili-action',{method:'POST',body:{...input,id,revision}});
    if(generation!==this.generation || revision!==this.accountRevision)throw new DOMException('Account changed','AbortError');return value;
  }
  activityFeed(request,options={}) {return this.content('bili-feed',{scope:request.scope,id:request.id || '',cursor:request.cursor || ''},options);}
  activityDetail(request,options={}) {return this.content('bili-dynamic',{id:request.id},options);}
  followings(request,options={}) {return this.content('bili-followings',{page:request.cursor || '1'},options);}
  async presence(request,{force=false,signal}={}) {
    const generation=this.generation,revision=this.accountRevision;
    const value=await this.request('/api/bili-presence?'+new URLSearchParams({...request,...(force?{refresh:'1'}:{})}),{signal});
    signal?.throwIfAborted();if(generation!==this.generation || revision!==this.accountRevision)throw new DOMException('Account changed','AbortError');return value;
  }
  lyrics(id,signal,provider='platform',track={}) {
    const params=provider==='kugou'?new URLSearchParams({id,provider,title:(track.title || '').slice(0,200),artist:(track.artist || '').slice(0,200),duration:track.durationMs || 0}):new URLSearchParams({id});
    return this.request(`/api/lyrics?${params}`,{signal});
  }
  async accountChanged() {++this.generation;for(const controller of this.controllers.values())controller.abort();this.controllers.clear();await Promise.resolve(this.store.clearCatalog?.()).catch(()=>{});}
  async invalidateAccount() {++this.accountRead;this.accountRevision='';await this.accountChanged();}
  async refreshAccounts(signal) {
    const revision=++this.accountRead,generation=this.generation;
    const value=await this.request('/api/accounts',{signal});
    signal?.throwIfAborted();if(revision!==this.accountRead || generation!==this.generation)throw new DOMException('Account changed','AbortError');
    if(!/^[a-f0-9]{32}$/.test(value.revision || '') || !Array.isArray(value.accounts))throw new Error(tr("Invalid account response. Update the Tinglan companion"));
    const changed=!!this.accountRevision && this.accountRevision!==value.revision;
    this.accountRevision=value.revision;if(changed)await this.accountChanged();return {...value,changed};
  }
  async account(source,cookie) {await this.request('/api/account',{method:'POST',body:{source,cookie}});await this.invalidateAccount();return this.refreshAccounts();}
}
