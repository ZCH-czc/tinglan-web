import { boundedOrigin } from './video-source.mjs';
import {focusSceneCanvas} from './modal-semantics.mjs';

/** Native video supplies decoded pixels; every visible control is a separate transparent Skia canvas. */
export function createVideoHost(mount,changed=()=>{}) {
  const frame=document.createElement('div');frame.id='tinglan-video-layer';frame.hidden=true;frame.setAttribute('aria-hidden','true');
  const video=document.createElement('video');video.id='tinglan-video';video.controls=false;video.muted=true;video.defaultMuted=true;video.playsInline=true;video.preload='metadata';video.tabIndex=-1;video.setAttribute('aria-hidden','true');
  const controls=document.createElement('div');controls.id='tinglan-video-controls';frame.append(video,controls);document.body.append(frame);
  let revision=0,mounted=false;
  document.addEventListener('fullscreenchange',()=>changed(document.fullscreenElement===frame));
  const size=()=>({width:innerWidth,height:innerHeight});
  function transform(origin){const {width,height}=size();const rect=boundedOrigin(origin,width,height);if(!rect)return null;return {clip:`inset(${rect.y}px ${Math.max(0,width-rect.x-rect.width)}px ${Math.max(0,height-rect.y-rect.height)}px ${rect.x}px round 28px)`,pixels:`translate(${rect.x+rect.width/2-width/2}px,${rect.y+rect.height/2-height/2}px) scale(${rect.width/width},${rect.height/height})`};}
  return {video,frame,
    open(origin,reduced){const current=++revision;const wasHidden=frame.hidden;frame.hidden=false;frame.setAttribute('aria-hidden','false');if(!mounted){mount();mounted=true;}
      frame.style.transition=reduced?'none':'clip-path 280ms cubic-bezier(.2,0,0,1),opacity 180ms ease';video.style.transition=frame.style.transition.replace('clip-path','transform');controls.style.transition=reduced?'none':'opacity 150ms ease';
      const start=wasHidden&&!reduced?transform(origin):null;frame.style.clipPath=start?.clip || 'inset(0 round 0px)';video.style.transform=start?.pixels || 'none';frame.style.opacity=start?'0':'1';controls.style.opacity=start?'0':'1';
      requestAnimationFrame(()=>{if(current!==revision)return;focusSceneCanvas(controls);frame.style.clipPath='inset(0 round 0px)';video.style.transform='none';frame.style.opacity='1';setTimeout(()=>{if(current===revision)controls.style.opacity='1';},reduced?0:170);});
    },
    async close(origin,reduced,done){const current=++revision;controls.style.opacity='0';if(document.fullscreenElement===frame)await document.exitFullscreen().catch(()=>{});if(current!==revision)return;
      const end=reduced?null:transform(origin);frame.style.transition=reduced?'none':'clip-path 240ms cubic-bezier(.2,0,0,1),opacity 180ms ease';video.style.transition=frame.style.transition.replace('clip-path','transform');frame.style.clipPath=end?.clip || 'inset(0 round 0px)';video.style.transform=end?.pixels || 'none';frame.style.opacity='0';
      setTimeout(()=>{if(current!==revision)return;frame.hidden=true;frame.setAttribute('aria-hidden','true');done();focusSceneCanvas(document.getElementById('tinglan-root'));},reduced?0:240);
    },
    async fullscreen(){if(document.fullscreenElement===frame)await document.exitFullscreen();else {if(!frame.requestFullscreen)throw new Error('Fullscreen is unsupported. Rotate your device to landscape');await frame.requestFullscreen();}},
  };
}
