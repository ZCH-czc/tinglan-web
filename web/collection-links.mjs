const numeric=value=>/^[1-9]\d{0,18}$/.test(value || '');
export function validCollection(source,id) {return ['qq','netease'].includes(source)?numeric(id):source==='bili' && numeric(String(id).replace(/^season_/,''));}
/** Resolve only complete platform links or an explicitly selected platform ID; never fetch the input URL. */
export function parseCollectionLink(input,source='qq') {
  if(typeof input!=='string' || input.length>2048)return null;const text=input.trim();
  const prefixed=/^(qq|bili|netease):([A-Za-z0-9_]+)$/.exec(text);
  if(prefixed)return validCollection(prefixed[1],prefixed[2])?{source:prefixed[1],id:prefixed[2]}:null;
  if(validCollection(source,text))return {source,id:text};
  let url;try{url=new URL(text);}catch{return null;}
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password || (url.port && url.port!=='443'))return null;
  let id='';
  if(['y.qq.com','c.y.qq.com'].includes(url.hostname)) {source='qq';id=url.searchParams.get('disstid') || url.searchParams.get('id') || /\/playlist\/(\d+)/.exec(url.pathname)?.[1] || '';}
  else if(url.hostname==='music.163.com') {source='netease';const hash=url.hash.replace(/^#/,'');id=url.searchParams.get('id') || (hash.includes('?')?new URLSearchParams(hash.slice(hash.indexOf('?')+1)).get('id'):'') || '';if(!/playlist/.test(url.pathname+hash))return null;}
  else if(['www.bilibili.com','bilibili.com','space.bilibili.com'].includes(url.hostname)) {
    source='bili';const season=url.searchParams.get('season_id') || (url.searchParams.get('type')==='season'?/\/lists\/(\d+)/.exec(url.pathname)?.[1]:'');
    id=season?'season_'+season:url.searchParams.get('fid') || /\/(?:medialist\/detail|list)\/ml(\d+)/.exec(url.pathname)?.[1] || '';
  }else return null;
  return validCollection(source,id)?{source,id}:null;
}
