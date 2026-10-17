/** Version-consistent updates are announced, never applied without a user action. */
export class ApplicationUpdates {
  constructor(container,{changed,reload,events=globalThis.window,document=globalThis.document,now=Date.now}) {
    Object.assign(this,{container,changed,reload,events,document,now});this.registration=null;this.waiting=null;this.requested=false;this.available=false;this.prompt=false;this.watched=new WeakSet();this.dismissed=new WeakSet();this.lastCheck=-Infinity;
  }
  refresh(error='') {
    const worker=this.registration?.waiting ?? null,available=!!worker,prompt=available && !this.dismissed.has(worker);
    if(available!==this.available || prompt!==this.prompt || worker!==this.waiting || error){this.available=available;this.prompt=prompt;this.waiting=worker;this.changed(available,{prompt,error,applying:this.requested});}
  }
  dismiss(){if(this.waiting)this.dismissed.add(this.waiting);this.refresh();}
  async check(force=false) {
    if(!this.registration || this.checking || !force && this.now()-this.lastCheck<300000)return;
    this.lastCheck=this.now();this.checking=true;
    try{await this.registration.update?.();}catch{/* Accepted assets stay usable offline. */}
    finally{this.checking=false;this.refresh();this.watch?.();}
  }
  async start() {
    if(!this.container)return;
    this.onController=()=>{if(this.requested){this.requested=false;clearTimeout(this.activationTimer);this.reload();}else this.refresh();};
    this.onMessage=event=>{if(event.data?.type==='tinglan-update-blocked' && event.source===this.waiting){this.requested=false;clearTimeout(this.activationTimer);this.refresh('Finish or cancel background downloads before updating');}};
    this.onWake=()=>{if(!this.document?.hidden)this.check();};
    this.container.addEventListener('controllerchange',this.onController);this.container.addEventListener('message',this.onMessage);
    this.registration=await this.container.register('./service-worker.mjs',{type:'module',updateViaCache:'none'});
    this.watch=()=>{const worker=this.registration.installing;if(!worker || this.watched.has(worker))return;this.watched.add(worker);
      const state=()=>{this.refresh();if(['installed','redundant'].includes(worker.state))worker.removeEventListener('statechange',state);};worker.addEventListener('statechange',state);state();};
    this.registration.addEventListener('updatefound',this.watch);this.refresh();this.watch();
    this.events?.addEventListener('focus',this.onWake);this.events?.addEventListener('online',this.onWake);this.document?.addEventListener('visibilitychange',this.onWake);
    await this.check(true);
  }
  activate() {
    const waiting=this.registration?.waiting;if(!waiting)throw new Error('No installable update available');if(this.requested)return;
    this.requested=true;this.changed(true,{prompt:this.prompt,error:'',applying:true});
    this.activationTimer=setTimeout(()=>{this.requested=false;this.refresh('Update incomplete. Try again later');},15000);this.activationTimer.unref?.();
    waiting.postMessage('activate-update');
  }
  dispose(){clearTimeout(this.activationTimer);this.events?.removeEventListener('focus',this.onWake);this.events?.removeEventListener('online',this.onWake);this.document?.removeEventListener('visibilitychange',this.onWake);this.container?.removeEventListener('controllerchange',this.onController);this.container?.removeEventListener('message',this.onMessage);this.registration?.removeEventListener('updatefound',this.watch);}
}
