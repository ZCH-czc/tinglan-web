import {tr} from './i18n.mjs';
import Hls from 'hls.js';

const policy=()=>({default:{maxTimeToFirstByteMs:10000,maxLoadTimeMs:15000,timeoutRetry:null,errorRetry:null}});
export const LIVE_HLS_CONFIG={enableWorker:true,useMediaCapabilities:true,autoStartLoad:false,lowLatencyMode:false,capLevelToPlayerSize:true,capLevelOnFPSDrop:true,fpsDroppedMonitoringPeriod:5000,fpsDroppedMonitoringThreshold:.15,maxBufferLength:12,maxMaxBufferLength:24,backBufferLength:0,maxBufferSize:24*1024*1024,renderTextTracksNatively:false,enableWebVTT:false,enableIMSC1:false,enableCEA708Captions:false,
  manifestLoadPolicy:policy(),playlistLoadPolicy:policy(),fragLoadPolicy:policy(),keyLoadPolicy:policy(),certLoadPolicy:policy(),steeringManifestLoadPolicy:policy(),enableInterstitialPlayback:false};
export function supportsLiveStream(stream) {
  const codec={avc:'avc1.42E01E',hevc:'hvc1.1.6.L93.B0',av1:'av01.0.05M.08'}[stream.codec];
  const M=globalThis.MediaSource || globalThis.ManagedMediaSource;
  if(Hls.isSupported())return !!codec && !!M?.isTypeSupported?.(`video/mp4; codecs="${codec},mp4a.40.2"`);
  const video=document.createElement('video');return stream.codec==='avc' && !!video.canPlayType('application/vnd.apple.mpegurl');
}
export function attachLiveHls(video,url,failed,signal,HlsClass=Hls) {
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(!HlsClass.isSupported()) {
    if(!video.canPlayType('application/vnd.apple.mpegurl'))throw new Error(tr("This browser does not support HLS Live"));video.src=url;video.load();
    return {destroy(){video.pause();video.removeAttribute('src');video.load();},stop(){video.pause();video.removeAttribute('src');video.load();},start(){if(!video.getAttribute('src')){video.src=url;video.load();}}};
  }
  const hls=new HlsClass(LIVE_HLS_CONFIG);let recovery=0,destroyed=false,loading=false,manifestReady=false,badSamples=0,reportedDrop=false;
  if(HlsClass.Events.FPS_DROP)hls.on(HlsClass.Events.FPS_DROP,(_,data)=>{
    if(destroyed || !loading || video.paused || video.seeking || video.readyState<3 || reportedDrop){badSamples=0;return;}
    badSamples=data.currentDecoded>50 && data.currentDropped/data.currentDecoded>.2?badSamples+1:0;
    // A master playlist can reduce its own level. Single-level rooms need a compatible source.
    if(badSamples>=2 && !(hls.levels?.length>1)){reportedDrop=true;failed(tr("Live playback is dropping frames. Try a lower quality"),{recoverable:true,performance:true});}
  });
  hls.on(HlsClass.Events.MANIFEST_PARSED,()=>{manifestReady=true;if(!loading)hls.stopLoad();});
  hls.on(HlsClass.Events.ERROR,(_,data)=>{
    if(destroyed)return;
    const status=Number(data.response?.code || data.networkDetails?.status);
    if([401,403,412,429].includes(status)){hls.stopLoad();failed(tr("Live access denied or verification required. Retry manually"));return;}
    if(!data.fatal)return;
    if(data.type===HlsClass.ErrorTypes.MEDIA_ERROR && recovery++===0){hls.recoverMediaError();return;}
    hls.stopLoad();failed(data.type===HlsClass.ErrorTypes.NETWORK_ERROR?tr("Live connection lost. Check your network"):tr("Live decoding failed. Try another quality"),{recoverable:data.type===HlsClass.ErrorTypes.MEDIA_ERROR,transient:data.type===HlsClass.ErrorTypes.NETWORK_ERROR && (!status || status===408 || status>=500 && status<=599)});
  });
  const destroy=()=>{if(destroyed)return;destroyed=true;signal?.removeEventListener('abort',destroy);hls.destroy();};
  signal?.addEventListener('abort',destroy,{once:true});hls.attachMedia(video);
  return {destroy,stop(){if(!destroyed){loading=false;badSamples=0;hls.stopLoad();}},start(){
    if(destroyed || loading)return;loading=true;
    // stopLoad can cancel the first manifest. startLoad only resumes segments,
    // so an explicit resume must reload an unfinished manifest exactly once.
    if(!manifestReady)hls.loadSource(url);
    hls.startLoad(-1);
  }};
}
