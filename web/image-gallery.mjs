import {tr} from './i18n.mjs';
const imageKey=/^image-(qq|bili|netease)-[a-f0-9]{40}$/;

/** One current request, at most three decoded gallery images, no background prefetch. */
export class ImageGallery {
  constructor({known,load,deliver,changed=()=>{}}) {Object.assign(this,{known,load,deliver,changed});this.revision=0;this.cache=new Map();this.state={open:false,keys:[],index:0,status:'idle',error:''};}
  patch(value){this.state={...this.state,...value};this.changed(this.state);}
  step(delta){return this.select(this.state.index+Math.sign(Number(delta)||0));}
  open(values,index=0) {
    const keys=[...new Set((Array.isArray(values)?values:[]).filter(key=>typeof key==='string' && imageKey.test(key) && this.known(key)))].slice(0,9);
    if(!keys.length)return false;
    this.patch({open:true,keys,index:Math.max(0,Math.min(keys.length-1,Math.trunc(Number(index)||0))),error:''});void this.select(this.state.index);return true;
  }
  async select(index,{retry=false}={}) {
    if(!this.state.open || !Number.isInteger(index) || index<0 || index>=this.state.keys.length)return false;
    this.abort?.abort();const controller=this.abort=new AbortController(),revision=++this.revision,key=this.state.keys[index];
    this.patch({index,status:'loading',error:''});
    try {
      let data=retry?null:this.cache.get(key);
      if(!data)data=await this.load(key,controller.signal);
      if(controller.signal.aborted || revision!==this.revision)return false;
      if(typeof data!=='string' || !data.length || data.length>8*1024*1024)throw new Error(tr("Unable to display image right now"));
      this.cache.delete(key);this.cache.set(key,data);
      while(this.cache.size>3){const oldest=this.cache.keys().next().value;this.cache.delete(oldest);this.deliver(oldest+':gallery','');}
      this.deliver(key+':gallery',data);this.patch({status:'ready'});return true;
    }catch(error){if(revision===this.revision && !controller.signal.aborted)this.patch({status:'error',error:error.message || tr("Unable to load image. Retry")});return false;}
  }
  close(){++this.revision;this.abort?.abort();for(const key of this.cache.keys())this.deliver(key+':gallery','');this.cache.clear();this.patch({open:false,keys:[],index:0,status:'idle',error:''});}
}

export async function galleryImage(path,signal) {
  const response=await fetch(path,{credentials:'same-origin',signal});
  if(!response.ok)throw new Error(tr("Unable to load image. Try again later"));
  const file=await response.blob();signal.throwIfAborted();
  if(!file.type.startsWith('image/') || file.size>20*1024*1024)throw new Error(tr("Image format or size is unsupported"));
  const bitmap=await createImageBitmap(file);
  try {
    signal.throwIfAborted();
    // Preserve tall pictures and avoid full-resolution texture allocations on small devices.
    const ratio=Math.min(1,4096/Math.max(bitmap.width,bitmap.height),Math.sqrt(4_000_000/(bitmap.width*bitmap.height)));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const image=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error(tr("Unable to process image"))),'image/webp',.92));
    signal.throwIfAborted();const bytes=new Uint8Array(await image.arrayBuffer());let binary='';for(let at=0;at<bytes.length;at+=4096)binary+=String.fromCharCode(...bytes.subarray(at,at+4096));return btoa(binary);
  }finally{bitmap.close();}
}
