// Startup and capability failure states are drawn too; visible HTML controls are never used.
const canvas=document.getElementById('boot-canvas');const context=canvas.getContext('2d');
let failure='',timer;
function draw() {
  if(!canvas.isConnected){clearTimeout(timer);return}
  const ratio=Math.min(devicePixelRatio || 1,2);const width=Math.round(innerWidth*ratio),height=Math.round(innerHeight*ratio);if(canvas.width!==width || canvas.height!==height){canvas.width=width;canvas.height=height;}context.setTransform(ratio,0,0,ratio,0,0);
  const dark=matchMedia('(prefers-color-scheme: dark)').matches;context.fillStyle=dark?'#11191c':'#f5fafd';context.fillRect(0,0,innerWidth,innerHeight);
  context.fillStyle=dark?'#d8e5e8':'#173b44';context.textAlign='center';context.font='600 34px system-ui';context.fillText('Tinglan',innerWidth/2,innerHeight/2-32);
  context.font='14px system-ui';context.fillText(failure?'Unable to start. Tap here to retry':'Preparing your music…',innerWidth/2,innerHeight/2+25);
  if(!failure){context.strokeStyle=dark?'#86d4de':'#126a7a';context.lineWidth=2;context.beginPath();context.arc(innerWidth/2,innerHeight/2+65,12,Date.now()/300,Date.now()/300+4.7);context.stroke();timer=setTimeout(draw,66)}
}
globalThis.tinglanBootError=text=>{failure=String(text);canvas.setAttribute('aria-label',failure);draw();};
canvas.addEventListener('click',()=>{if(failure)location.reload()});draw();
import(document.documentElement.dataset.tinglanMode==='lan-sender'?'./lan-sender.mjs':'./canvas-app.mjs').catch(error=>globalThis.tinglanBootError(error.message));
