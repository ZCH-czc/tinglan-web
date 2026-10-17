import test from 'node:test';
import assert from 'node:assert/strict';
import {ClipboardWriter} from '../web/clipboard.mjs';

test('unsupported async API fallback cleans up its hidden adapter and restores the shadow editor selection',async()=>{
  const calls=[],editor={selectionStart:2,selectionEnd:4,selectionDirection:'forward',focus:o=>calls.push(['focus',o]),setSelectionRange:(...args)=>calls.push(['selection',...args])};
  const input={style:{},setAttribute(){},focus(){},select(){calls.push('select');},remove(){calls.push('remove');}};
  let copyHandler;const document={addEventListener:(_,fn)=>{copyHandler=fn;},removeEventListener:(_,fn)=>{assert.equal(fn,copyHandler);copyHandler=null;},activeElement:{shadowRoot:{activeElement:editor}},body:{append:el=>{assert.equal(el,input);assert.equal(el.value,'测试');}},createElement:tag=>{assert.equal(tag,'textarea');return input;},execCommand(action){assert.equal(this,document);assert.equal(action,'copy');copyHandler({clipboardData:{setData:(type,value)=>{assert.equal(type,'text/plain');assert.equal(value,'测试');}},preventDefault(){},stopImmediatePropagation(){}});return true;}};
  await new ClipboardWriter({host:{document,navigator:{}}}).write('测试');
  assert.deepEqual(calls,['select','remove',['focus',{preventScroll:true}],['selection',2,4,'forward']]);
});
test('async fallback retains the Clipboard receiver and clears its timer after a confirmed write',async()=>{
  const timers=[],cancelled=[],clipboard={async writeText(text){assert.equal(this,clipboard);assert.equal(text,'歌词');}};
  await new ClipboardWriter({host:{document:{body:{},execCommand:()=>assert.fail('standard API must be preferred')},navigator:{clipboard}},setTimer:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimer:t=>cancelled.push(t)}).write('歌词');
  assert.equal(timers[0].ms,2000);assert.equal(cancelled[0],timers[0]);
});
test('an unresolved browser API reports a deadline and cannot queue more writes',async()=>{
  let expire,resolve,calls=0;const raw=new Promise(r=>resolve=r),writer=new ClipboardWriter({host:{navigator:{clipboard:{writeText(){++calls;return raw;}}}},setTimer:fn=>{expire=fn;return 1;},clearTimer(){}});
  const job=writer.write('one');expire();await assert.rejects(job,/did not confirm copying/i);await assert.rejects(writer.write('two'),/incomplete|not started|pending/i);assert.equal(calls,1);resolve();await raw;assert.equal(writer.pending,null);
});
test('empty, unsupported and denied copy operations provide explicit feedback',async()=>{
  await assert.rejects(new ClipboardWriter({host:{}}).write(''),/Nothing to copy/i);
  await assert.rejects(new ClipboardWriter({host:{}}).write('text'),/unsupported|does not support|cannot/i);
  const writer=new ClipboardWriter({host:{navigator:{clipboard:{writeText:async()=>{throw new DOMException('denied','NotAllowedError');}}}}});
  await assert.rejects(writer.write('text'),/denied|not allowed/i);assert.equal(writer.pending,null);
});
