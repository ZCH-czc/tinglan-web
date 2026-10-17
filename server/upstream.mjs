/** Bounded, coalesced requests. Rights denials and verification challenges never trigger retries. */
export class PlatformError extends Error {
  constructor(code, message, status = 502, retryAfter = 0) { super(message); this.code = code; this.status = status; this.retryAfter = retryAfter; }
}
const SOURCE_NAMES = { qq: 'QQ Music', bili: 'Bilibili', netease: 'NetEase Music', kugou: 'Kugou Music' };
export class RequestGovernor {
  constructor({ fetcher = fetch, now = Date.now, gap = 700, timeout = 12_000, limit = 96 } = {}) {
    this.fetcher = fetcher; this.now = now; this.gap = gap; this.timeout = timeout; this.limit = limit;
    this.states = new Map(); this.pending = new Map(); this.cache = new Map();
  }
  async json(source, url, options = {}, ttl = 60_000, identity = 'anonymous', acceptCodes = []) {
    return this.request(source,url,options,ttl,identity,acceptCodes,'json');
  }
  text(source,url,options={},ttl=60_000,identity='anonymous') {return this.request(source,url,options,ttl,identity,[],'text');}
  defer(source,seconds) {
    const state=this.states.get(source) || {tail:Promise.resolve(),next:0,cooldown:0,failures:0,queued:0};
    state.cooldown=Math.max(state.cooldown,this.now()+Math.min(120000,Math.max(1000,Number(seconds)*1000 || 60000)));this.states.set(source,state);
  }
  reply(source,url,options={},identity='anonymous',format='json',acceptCodes=[]) {
    if(!['json','text','bytes'].includes(format))throw new TypeError('Unknown reply format');
    return this.request(source,url,options,0,identity,acceptCodes,'reply-'+format);
  }
  async request(source,url,options,ttl,identity,acceptCodes,format) {
    const key = `${source}|${identity}|${url}|${options.body || ''}|${acceptCodes.join(',')}|${format}`;
    const cached = this.cache.get(key);
    if (options.cache!=='no-store' && cached && cached.until > this.now()) return cached.value;
    if (this.pending.has(key)) return this.pending.get(key);
    if(options.cache==='no-store')this.cache.delete(key);
    const state = this.states.get(source) || { tail: Promise.resolve(), next: 0, cooldown: 0, failures: 0, queued: 0 };
    this.states.set(source, state);
    if (state.cooldown > this.now()) throw new PlatformError('cooldown', `${SOURCE_NAMES[source]} Requests paused. Retry later`, 429, Math.ceil((state.cooldown - this.now()) / 1000));
    if (state.queued >= 24) throw new PlatformError('busy', 'Too many requests. Retry later', 429, 3);
    ++state.queued;
    const operation = state.tail.catch(() => {}).then(async () => {
      options.signal?.throwIfAborted();
      if (state.cooldown > this.now()) throw new PlatformError('cooldown', 'Platform requests are cooling down. Retry later', 429, Math.ceil((state.cooldown - this.now()) / 1000));
      const delay = Math.max(0, state.next - this.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      options.signal?.throwIfAborted();
      state.next = this.now() + this.gap;
      const timeout = AbortSignal.timeout(this.timeout),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
      const replyFormat=format.startsWith('reply-'),bodyFormat=replyFormat?format.slice(6):format;
      let response;
      try { response = await this.fetcher(url, { ...options, redirect: replyFormat?'manual':'error', signal }); }
      catch (error) {options.signal?.throwIfAborted();if (++state.failures >= 3) state.cooldown = this.now() + 30_000; throw new PlatformError('network', timeout.aborted ? 'Connection timed out. Retry later' : `${SOURCE_NAMES[source]} Connection temporarily unavailable`, 503); }
      if ([412, 429].includes(response.status)) {
        await response.body?.cancel();
        state.cooldown = this.now() + Math.min(300_000, Math.max(30_000, Number(response.headers.get('retry-after')) * 1000 || 60_000));
        throw new PlatformError('verification', `${SOURCE_NAMES[source]} requested a delay or verification`, 429, Math.ceil((state.cooldown - this.now()) / 1000));
      }
      if (!response.ok && !(replyFormat && [301,302,303,307,308].includes(response.status))) {await response.body?.cancel();throw new PlatformError(response.status === 401 || response.status === 403 ? 'sign-in' : 'unavailable', `${SOURCE_NAMES[source]} does not provide this content（HTTP ${response.status}）`, response.status === 401 || response.status === 403 ? 401 : 502);}
      const chunks = []; let size = 0;
      if(response.body)for await (const chunk of response.body) { size += chunk.length; if (size > (replyFormat?512_000:4_000_000)) throw new PlatformError('invalid-response', 'Platform response is too large'); chunks.push(chunk); }
      let value;
      try {const bytes=Buffer.concat(chunks);value=bodyFormat==='bytes'?bytes:bodyFormat==='text'?bytes.toString('utf8'):JSON.parse(bytes.toString('utf8'));} catch { throw new PlatformError('invalid-response', 'Unable to read platform response'); }
      if(bodyFormat==='json' && (!value || typeof value!=='object'))throw new PlatformError('invalid-response','Invalid platform response format');
      if ([-352, -412, 429].includes(value.code)) {
        state.cooldown = this.now() + 60_000;
        throw new PlatformError('verification', `${SOURCE_NAMES[source]} requires verification. Further requests stopped`, 429, 60);
      }
      if ([-101, 301, 302, 1000, 104400, 104401].includes(value.code) && !acceptCodes.includes(value.code)) throw new PlatformError('sign-in', `Connect your ${SOURCE_NAMES[source]} account`, 401);
      state.failures = 0;
      if (ttl && options.cache!=='no-store') { this.cache.set(key, { value, until: this.now() + ttl }); while (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value); }
      return replyFormat?{body:value,headers:response.headers,status:response.status}:value;
    });
    state.tail = operation.then(() => {}, () => {});
    this.pending.set(key, operation);
    try { return await operation; } finally { --state.queued; this.pending.delete(key); }
  }
  clearIdentity(identity) { for (const key of this.cache.keys()) if (key.split('|')[1]?.split(':')[0]===identity) this.cache.delete(key); }
}
export function cleanText(value,maxLength=2000) { return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, Math.max(0,Math.min(10000,maxLength))); }
export function safeHttps(value, allowed) {
  try {
    const url = new URL(String(value).replace(/^\/\//, 'https://').replace(/^http:/, 'https:'));
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowed.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return null;
    return url.href;
  } catch { return null; }
}
