import {hostSetTimeout,hostClearTimeout} from './host-api.mjs';

/** WebViews can leave async clipboard promises unresolved. Preserve the click gesture and input focus. */
export class ClipboardWriter {
  constructor({host=globalThis,timeoutMs=2000,setTimer=hostSetTimeout,clearTimer=hostClearTimeout}={}) {Object.assign(this,{host,timeoutMs,setTimer,clearTimer});this.pending=null;}
  immediate(text) {
    const document=this.host.document;if(!document?.body || !document.execCommand)return false;
    let active=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;
    const selection=active && 'selectionStart' in active?{start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection}:null;
    const input=document.createElement('textarea');input.value=text;input.readOnly=true;
    input.setAttribute('aria-hidden','true');input.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    let handled=false;const onCopy=event=>{if(!event.clipboardData)return;event.clipboardData.setData('text/plain',text);event.preventDefault();event.stopImmediatePropagation();handled=true;};
    try{document.addEventListener('copy',onCopy,true);document.body.append(input);input.focus({preventScroll:true});input.select();return document.execCommand('copy')===true && handled;}
    catch{return false;}
    finally{document.removeEventListener('copy',onCopy,true);input.remove();try{active?.focus({preventScroll:true});if(selection && selection.start!==null)active.setSelectionRange(selection.start,selection.end,selection.direction);}catch{/* A removed editor cannot receive focus. */}}
  }
  async write(text) {
    if(typeof text!=='string' || !text.length)throw new Error('Nothing to copy');
    const clipboard=this.host.navigator?.clipboard;
    if(!clipboard?.writeText){if(this.immediate(text))return;throw new Error('Copying is unsupported. Select the text and copy manually');}
    if(this.pending)throw new Error('The previous copy is still pending. Select the text and copy manually');
    const pending=Promise.resolve(clipboard.writeText(text));this.pending=pending;
    pending.then(()=>{if(this.pending===pending)this.pending=null;},()=>{if(this.pending===pending)this.pending=null;});
    let timer;
    try{await Promise.race([pending,new Promise((_,reject)=>{timer=this.setTimer(()=>reject(new Error('The browser did not confirm copying. Select the text and copy manually')),this.timeoutMs);})]);}
    catch(error){if(error.name==='NotAllowedError')throw new Error('Copying was denied. Select the text and copy manually');throw error;}
    finally{this.clearTimer(timer);}
  }
}
