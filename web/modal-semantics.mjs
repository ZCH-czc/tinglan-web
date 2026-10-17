import {tr} from './i18n.mjs';
const ROOTS=new Set(['tinglan-root','tinglan-video-controls','tinglan-live-controls']);
const MODAL_ID=/^tinglan-modal-\d+$/;

function sceneRoot(host) {
  // ComposeViewport nests its shadow host below the public mount point. Bound this walk;
  // never inspect other applications, decoder surfaces or the complete document.
  let level=host?[host]:[];
  for(let depth=0;depth<4 && level.length;depth++) {
    for(const node of level)if(node.shadowRoot)return node.shadowRoot;
    level=level.flatMap(node=>Array.from(node.children || []));
  }
  return null;
}

export function focusSceneCanvas(host) {
  const canvas=sceneRoot(host)?.querySelector?.('canvas');
  if(!canvas?.focus)return false;
  canvas.focus({preventScroll:true});return true;
}

export function markModalSemantics(root) {
  for(const node of root.querySelectorAll('[id^="tinglan-modal-"]')) {
    if(!MODAL_ID.test(node.id))continue;
    const title=root.getElementById(node.id+'-title');
    const attributes={role:'dialog','aria-modal':'true',...(title?{'aria-labelledby':title.id}:{'aria-label':tr("Dialog")})};
    for(const [name,value] of Object.entries(attributes))if(node.getAttribute(name)!==value)node.setAttribute(name,value);
    node.removeAttribute(title?'aria-label':'aria-labelledby');
  }
}

/** Enhance Compose's existing invisible accessibility nodes, without introducing visible HTML UI.
 * The observer exists only while a modal is open; music playback never polls the DOM. */
export class ModalSemantics {
  constructor({document=globalThis.document,Observer=globalThis.MutationObserver}={}) {
    this.document=document;this.Observer=Observer;this.active=new Map();
  }
  set(id,open) {
    if(!ROOTS.has(id) || typeof open!=='boolean')return false;
    if(!open){this.active.get(id)?.observer?.disconnect();this.active.delete(id);return true;}
    if(this.active.has(id))return true;
    const host=this.document.getElementById(id);if(!host)return false;
    const entry={observer:null,root:null,focused:false};this.active.set(id,entry);
    const sync=()=>{
      if(this.active.get(id)!==entry)return;
      const root=sceneRoot(host);
      if(root && root!==entry.root) {
        entry.observer?.disconnect();entry.root=root;
        entry.observer?.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['id','role']});
      }
      if(root) {
        markModalSemantics(root);
        // Accessibility activation may leave DOM focus outside the Canvas. Move it
        // once, then let Compose own focus among this scene's sheet controls.
        if(!entry.focused)entry.focused=focusSceneCanvas(host);
      }
    };
    if(this.Observer)entry.observer=new this.Observer(sync);
    entry.observer?.observe(host,{subtree:true,childList:true});sync();return true;
  }
  close() {for(const entry of this.active.values())entry.observer?.disconnect();this.active.clear();}
}
