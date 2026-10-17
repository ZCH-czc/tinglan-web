import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveHost} from '../web/live-host.mjs';

test('live Canvas mounts with visible dimensions and resizes only when its viewport changes',()=>{
  const saved=Object.fromEntries(['document','window','requestAnimationFrame','innerWidth','innerHeight'].map(key=>[key,globalThis[key]]));
  class Element extends EventTarget {constructor(){super();this.style={};this.children=[];this.hidden=false;}setAttribute(){}append(...nodes){this.children.push(...nodes);}}
  const frames=[],body=new Element(),document=new EventTarget(),window=new EventTarget();let mounts=0,resizes=0;
  Object.assign(document,{createElement:()=>new Element(),body,getElementById:()=>null});window.addEventListener('resize',()=>resizes++);
  Object.assign(globalThis,{document,window,requestAnimationFrame:fn=>frames.push(fn),innerWidth:844,innerHeight:390});
  const flush=()=>{for(let i=0;frames.length && i<10;i++)frames.shift()();assert.equal(frames.length,0,'resize must converge');};
  try {
    const host=createLiveHost(()=>{mounts++;assert.equal(host.frame.hidden,false);assert.equal(host.frame.style.height,'200px');});
    host.open();flush();assert.equal(mounts,0);
    host.bounds({x:10,y:70,width:360,height:200});flush();assert.equal(mounts,1);
    host.bounds({x:10,y:90,width:360,height:200});flush();assert.equal(resizes,0,'scroll position does not reallocate Canvas');
    host.bounds({x:10,y:90,width:400,height:225});flush();assert.equal(resizes,1);
    host.overlay(true);flush();assert.equal(host.frame.hidden,true);host.overlay(false);flush();assert.equal(resizes,2);
    host.close();host.open();host.bounds({x:10,y:70,width:360,height:200});flush();assert.equal(mounts,1);assert.equal(resizes,3);
    document.fullscreenElement=host.frame;document.dispatchEvent(new Event('fullscreenchange'));flush();assert.equal(host.frame.style.width,'844px');assert.equal(host.frame.style.height,'390px');assert.equal(resizes,4);
  } finally {for(const [key,value] of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
