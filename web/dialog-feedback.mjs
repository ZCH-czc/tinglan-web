/** Errors belong to the dialog that started an action, never a later modal or account. */
export class DialogFeedback {
  constructor(){this.key='';this.revision=0;this.error='';}
  sync(kind,target='') {
    const key=kind?`${kind}\0${target}`:'';
    if(key!==this.key){this.key=key;++this.revision;this.error='';}
  }
  begin(clear=true){if(clear)this.error='';return {key:this.key,revision:this.revision};}
  report(ticket,message){
    if(ticket.revision!==this.revision || ticket.key!==this.key)return this.key?'obsolete':'toast';
    if(!this.key)return 'toast';
    this.error=String(message || 'Action incomplete. Retry').replace(/[\u0000-\u001f]/g,' ').slice(0,400);
    return 'dialog';
  }
}
