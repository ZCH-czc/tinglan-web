/** Installation is suggested in-app; browser permission prompts require an explicit click. */
export class WebIntegration {
  constructor({host=globalThis,changed=()=>{},storage,now=Date.now}={}) {
    if(!storage)try{storage=host.localStorage;}catch{}
    Object.assign(this,{host,changed,storage,now});this.prompt=null;this.notice=false;this.busy=false;
    this.display=host.matchMedia?.('(display-mode: standalone)');
    host.addEventListener?.('beforeinstallprompt',event=>{event.preventDefault();this.prompt=event;this.suggest();});
    host.addEventListener?.('appinstalled',()=>{this.prompt=null;this.notice=false;this.installed=true;this.changed();});
    this.display?.addEventListener('change',()=>this.changed());
  }
  read(key){try{return this.storage?.getItem(key)}catch{return null}}
  write(key,value){try{this.storage?.setItem(key,String(value))}catch{}}
  view(){return {installed:!!(this.installed || this.display?.matches || this.host.navigator?.standalone),canInstall:!!this.prompt,notice:this.notice,notifications:this.host.Notification?.permission || 'unsupported',notifyEnabled:this.read('tinglan-notifications')==='on',backgroundFetch:!!this.host.BackgroundFetchManager,mediaSession:!!this.host.navigator?.mediaSession};}
  suggest(){if(!this.view().installed && this.now()-Number(this.read('tinglan-install-later') || 0)>7*86400000){this.notice=true;this.changed();}}
  dismiss(){this.write('tinglan-install-later',this.now());this.notice=false;this.changed();}
  async install(){
    if(this.busy)return;const prompt=this.prompt;if(!prompt)return false;
    this.busy=true;this.prompt=null;
    try{await prompt.prompt();const choice=await prompt.userChoice;this.notice=false;if(choice?.outcome!=='accepted')this.dismiss();return choice?.outcome==='accepted';}
    finally{this.busy=false;this.changed();}
  }
  async notifications(){
    const N=this.host.Notification;if(!N)throw new Error('System notifications are unavailable in this browser');
    if(N.permission==='denied')throw new Error('Notifications are blocked. Allow them in site permissions');
    const permission=N.permission==='granted'?'granted':await N.requestPermission();
    this.write('tinglan-notifications',permission==='granted'?'on':'off');this.changed();return permission;
  }
  disableNotifications(){this.write('tinglan-notifications','off');this.changed();}
}

export async function showDownloadNotification(registration,{title,success=true},enabled){
  if(!enabled || globalThis.Notification?.permission!=='granted' || !registration?.showNotification)return false;
  await registration.showNotification(success?'Music cached':'Music caching incomplete',{body:String(title).slice(0,120),icon:'./icon-192.png',badge:'./icon-192.png',tag:'tinglan-download',silent:true,data:{route:'#cache'},actions:[{action:'open-cache',title:'View downloads'}]});return true;
}
