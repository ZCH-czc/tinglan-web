export const PLAYBACK_LIMITS=Object.freeze({sourceMs:20000,bufferMs:30000,diagnosticMs:5000,backoffMs:750,refreshes:1,skips:3,stableMs:20000,networkResumes:1,cooldownMs:120000});

export function retryAfterSeconds(value,now=Date.now()) {
  if(value==null || value==='')return 0;
  const seconds=/^\d+(?:\.\d+)?$/.test(String(value).trim())?Number(value):(Date.parse(value)-now)/1000;
  return Number.isFinite(seconds)?Math.ceil(Math.min(PLAYBACK_LIMITS.cooldownMs/1000,Math.max(0,seconds))):0;
}

/** MediaError alone cannot distinguish an expired same-origin grant from an unsupported file.
 * Prefer the companion's actual last failure; never re-resolve rights or verification denials. */
export function playbackFailure(error={}, {mediaCode=0,offline=false,local=false}={}) {
  const code=error.code || '',status=Number(error.status) || 0;
  const message=typeof error.message==='string'?error.message.slice(0,500):'';
  if(['verification','cooldown','busy','rate-limit'].includes(code) || status===429)
    return {kind:'restricted',message:message || 'Platform requests temporarily limited. Retry later',retryAfter:retryAfterSeconds(error.retryAfter) || (code==='busy'?3:60)};
  if(['rights','sign-in','forbidden','session-changed'].includes(code) || [401,403,409].includes(status))
    return {kind:'restricted',message:message || 'Connect an account with access to this track',retryAfter:0};
  if(code==='expired' || code==='source-expired' || status===410)
    return {kind:'recoverable',message:'Playback URL expired. Restoring the previous position',retryAfter:0};
  if(code==='missing-local')return {kind:'terminal',message:message || 'Audio file missing. Import it again',retryAfter:0};
  if(error.name==='NotAllowedError')return {kind:'gesture',message:'Tap Play to allow the browser to start playback',retryAfter:0};
  if(mediaCode===1)return {kind:'terminal',message:'Playback interrupted. Tap Play to continue',retryAfter:0};
  if(local)return {kind:'terminal',message:mediaCode===3 || mediaCode===4 || error.name==='NotSupportedError'?'Unable to decode this local or cached audio. Check the file or download it again':'Unable to read local audio. Select the track again',retryAfter:0};
  const network=['network','buffer-timeout','source-timeout'].includes(code) || error.name==='TypeError' || error.name==='TimeoutError' || mediaCode===2;
  if(network && offline)return {kind:'offline',message:'Offline. Playback resumes when the connection returns, or tap Retry',retryAfter:0};
  if(network || [502,503,504].includes(status))return {kind:'recoverable',message:message || 'Connection interrupted. Restoring playback',retryAfter:0};
  if(mediaCode===3 || mediaCode===4 || error.name==='NotSupportedError')return {kind:'terminal',message:'The browser cannot decode this music. Try another format or source',retryAfter:0};
  return {kind:'terminal',message:message || 'Unable to load music. Retry',retryAfter:0};
}

/** One address refresh per song and at most three forward queue steps in an unsuccessful chain.
 * Only sustained advancing playback, or an explicit new user intent, replenishes the budget. */
export class PlaybackRecovery {
  constructor(){this.reset();}
  reset(){this.refreshed=new Set();this.skipped=0;this.networkResumes=0;}
  decide(id,failure,{hasNext=false,playing=false}={}) {
    if(!playing || failure.kind!=='recoverable')return failure.kind==='offline' && playing?'wait':'stop';
    if(this.skipped>=PLAYBACK_LIMITS.skips)return 'stop';
    if(!this.refreshed.has(id)){this.refreshed.add(id);return 'refresh';}
    if(hasNext && this.skipped<PLAYBACK_LIMITS.skips){++this.skipped;return 'skip';}
    return 'stop';
  }
  resumeNetwork(){if(this.networkResumes>=PLAYBACK_LIMITS.networkResumes)return false;++this.networkResumes;return true;}
}
