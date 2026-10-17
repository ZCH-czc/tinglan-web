import {backgroundDownloads as downloadService} from './background-downloads.mjs';
// Only application assets are cached. Account APIs and media streams never enter this cache.
const build='__TINGLAN_BUILD_ID__';
const assets=__TINGLAN_ASSET_MANIFEST__;
const base=new URL('./',self.location.href);
const cachePrefix=base.pathname==='/'?'tinglan-web-':`tinglan-pages:${encodeURIComponent(base.pathname)}:`;
const cacheName=`${cachePrefix}${build}`;
const paths=new Set(assets.map(path=>new URL(path,base).pathname));
const essential=assets.filter(path=>!/(?:noto_serif_sc|lxgw_wenkai_lite|nunito_variable)\.(?:otf|ttf)$/.test(path));
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(cacheName);
  for(let index=0;index<essential.length;index+=3)await Promise.all(essential.slice(index,index+3).map(async path=>{
    const url=new URL(path,base);const response=await fetch(url,{cache:'reload'});if(!response.ok)throw new Error('Application cache incomplete');await cache.put(url,response);
  }));
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(cachePrefix) && key!==cacheName)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET' || url.origin!==base.origin || url.pathname.startsWith(new URL('api/',base).pathname))return;
  // Keep the document and its Wasm/modules on the same build until an update is accepted.
  if(event.request.mode==='navigate')event.respondWith((async()=>{
    const cache=await caches.open(cacheName);return await cache.match(new URL('index.html',base)) || fetch(event.request);
  })());
  else if(paths.has(url.pathname))event.respondWith((async()=>{const cache=await caches.open(cacheName);const key=new URL(url.pathname,base);const cached=await cache.match(key);if(cached)return cached;const response=await fetch(event.request);if(response.ok)await cache.put(key,response.clone());return response;})());
});
self.addEventListener('message',event=>{if(event.data!=='activate-update')return;
  event.waitUntil((async()=>{
    const service=await downloadService();
    if((await service.rows()).some(row=>['queued','preparing','downloading','saving'].includes(row.status))){event.source?.postMessage({type:'tinglan-update-blocked'});return;}
    await self.skipWaiting();
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type!=='tinglan-download-command' || !event.ports?.[0])return;
  const port=event.ports[0];
  event.waitUntil((async()=>{
    try {
      const client=await self.clients.get(event.source?.id);
      if(!client || new URL(client.url).origin!==self.location.origin)throw new Error('Invalid download request origin');
      const service=await downloadService(),data=event.data;
      let job;
      if(data.action==='enqueue')job=await service.enqueue(data);
      else if(data.action==='cancel')await service.cancel(typeof data.id==='string'?data.id:'',typeof data.token==='string'?data.token:'');
      else if(data.action==='started')service.started(data.token,data.ok);
      else if(data.action==='fallback')await service.fallback(data.token);
      else if(data.action!=='status')throw new Error('Unknown download action');
      port.postMessage({protocol:1,job,rows:await service.publish()});
      await service.run();
    }catch(error){port.postMessage({error:error.message || 'Background downloads unavailable'});}
  })());
});
for(const name of ['backgroundfetchsuccess','backgroundfetchfailure','backgroundfetchabort'])self.addEventListener(name,event=>event.waitUntil(downloadService().then(service=>service.complete(event))));
async function openRoute(route){const url=new URL(route,base).href;for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){if(new URL(client.url).origin===base.origin && new URL(client.url).pathname.startsWith(base.pathname)){client.postMessage({type:'tinglan-notification-route',route});await client.focus();return;}}await self.clients.openWindow(url);}
self.addEventListener('backgroundfetchclick',event=>event.waitUntil(openRoute('#cache')));
self.addEventListener('notificationclick',event=>{if(event.notification?.data?.route!=='#cache')return;event.notification.close();event.waitUntil(openRoute('#cache'));});
