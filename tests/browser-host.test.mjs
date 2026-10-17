import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountSession} from '../web/account-session.mjs';
import {LivePlayback} from '../web/live-playback.mjs';
import {RadioPlayback} from '../web/radio-playback.mjs';
import {LanTransferClient} from '../web/lan-transfer-client.mjs';
import {NoteChanges} from '../web/note-pages.mjs';

test('default controller timers keep the browser host receiver through navigation and cleanup',()=>{
  const previous={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout},scheduled=[],cancelled=[];
  globalThis.setTimeout=function(fn,ms){assert.equal(this,globalThis);const handle={fn,ms};scheduled.push(handle);return handle;};
  globalThis.clearTimeout=function(handle){assert.equal(this,globalThis);cancelled.push(handle);};
  class Media extends EventTarget {pause(){}removeAttribute(){}load(){}}
  try {
    const account=new AccountSession({platform:{},deliverImage(){}});
    account.active=true;account.state={status:'waiting'};account.schedule();const loginTimer=account.timer;account.close();
    assert.ok(cancelled.includes(loginTimer));

    const live=new LivePlayback({video:new Media()});
    live.patch({status:'loading'});const liveTimer=live.watchdog;live.patch({status:'paused'});
    assert.ok(cancelled.includes(liveTimer));

    const radio=new RadioPlayback({audio:new Media()});
    radio.active=true;radio.patch({status:'buffering'});const radioTimer=radio.watchdog;radio.pause();
    assert.ok(cancelled.includes(radioTimer));

    const lan=new LanTransferClient({platform:{}});
    lan.visible=true;lan.state.active=true;lan.pollLater();const lanTimer=lan.timer;lan.resetLife();
    assert.ok(cancelled.includes(lanTimer));

    const channel={close(){}},notes=new NoteChanges(()=>{},{factory:()=>channel});
    notes.open();channel.onmessage({data:{kind:'notes-changed'}});const noteTimer=notes.timer;notes.close();
    assert.ok(cancelled.includes(noteTimer));
    assert.deepEqual(scheduled.map(row=>row.ms),[2500,45000,30000,1000,120]);
  } finally {Object.assign(globalThis,previous);}
});
