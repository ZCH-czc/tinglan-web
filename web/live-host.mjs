/** Only decoded pixels use DOM. The entire visible live player, menus and buttons use transparent Skia. */
import {focusSceneCanvas} from './modal-semantics.mjs';
export function createLiveHost(mount,changed=()=>{}) {
  const frame=document.createElement('div');frame.id='tinglan-live-layer';frame.hidden=true;
  const video=document.createElement('video');video.controls=false;video.playsInline=true;video.preload='metadata';video.tabIndex=-1;video.setAttribute('aria-hidden','true');
  const controls=document.createElement('div');controls.id='tinglan-live-controls';frame.append(video,controls);document.body.append(frame);
  let mounted=false,active=false,overlay=false,rect=null,queued=false,canvasSize='';
  function layout(){queued=false;const full=document.fullscreenElement===frame;frame.hidden=!active || !full && (overlay || !rect || rect.width<=0 || rect.height<=0);if(frame.hidden){canvasSize='';return;}
    const r=full?{x:0,y:0,width:innerWidth,height:innerHeight}:rect;Object.assign(frame.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px',borderRadius:full?'0':'16px',clipPath:full?'none':`inset(${Math.max(0,rect.clipTop || 0)}px 0 ${Math.max(0,rect.clipBottom || 0)}px 0)`});
    const nextSize=`${r.width}:${r.height}`;
    // Compose 1.12 reads the host at mount and on window resize, not on parent resize.
    // Never mount inside display:none: it would retain a 0-pixel input/render surface.
    if(!mounted){mounted=true;canvasSize=nextSize;mount();requestAnimationFrame(()=>{if(active && !frame.hidden)focusSceneCanvas(controls);});}
    else if(canvasSize!==nextSize){canvasSize=nextSize;window.dispatchEvent(new Event('resize'));}
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(layout);}}
  document.addEventListener('fullscreenchange',()=>{layout();changed(document.fullscreenElement===frame);});
  window.addEventListener('resize',schedule);
  return {video,frame,
    open(){active=true;rect=null;canvasSize='';frame.hidden=true;},
    bounds(value){if(!active)return;const r=Object.fromEntries(['x','y','width','height','clipTop','clipBottom'].map(k=>[k,Number(value?.[k]) || 0]));if(Object.values(r).some(n=>!Number.isFinite(n) || Math.abs(n)>100000))return;if(JSON.stringify(rect)!==JSON.stringify(r)){rect=r;schedule();}},
    overlay(value){overlay=value;schedule();},
    close(){active=false;frame.hidden=true;rect=null;canvasSize='';if(document.fullscreenElement===frame)document.exitFullscreen().catch(()=>{});focusSceneCanvas(document.getElementById('tinglan-root'));},
    async fullscreen(){if(document.fullscreenElement===frame)await document.exitFullscreen();else {if(!frame.requestFullscreen)throw new Error('Fullscreen is unsupported in this browser');await frame.requestFullscreen();}},
  };
}
