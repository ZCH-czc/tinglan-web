import test from 'node:test';
import assert from 'node:assert/strict';
import {DialogFeedback} from '../web/dialog-feedback.mjs';

test('failed modal actions expose an inline error and retry clears it',()=>{
  const state=new DialogFeedback();state.sync('metadata','song');const ticket=state.begin();
  assert.equal(state.report(ticket,'存储空间不足'),'dialog');assert.equal(state.error,'存储空间不足');
  state.begin();assert.equal(state.error,'');
  assert.equal(state.report(ticket,'x'.repeat(1000)+'\n'),'dialog');assert.equal(state.error.length,400);
});
test('late failures cannot enter another dialog or a reopened instance',()=>{
  const state=new DialogFeedback();state.sync('metadata','first');const old=state.begin();
  state.sync('metadata','second');assert.equal(state.report(old,'old'),'obsolete');assert.equal(state.error,'');
  const previous=state.begin();state.sync('');state.sync('metadata','second');
  assert.equal(state.report(previous,'old'),'obsolete');assert.equal(state.error,'');
});
test('page actions use toast feedback and modal state does not survive closing',()=>{
  const state=new DialogFeedback();assert.equal(state.report(state.begin(),'网络中断'),'toast');
  state.sync('theme');state.report(state.begin(),'错误');state.sync('');assert.equal(state.error,'');
});
test('background artwork keeps visible errors and a finished progress dialog still reports failure',()=>{
  const state=new DialogFeedback();state.sync('metadata','song');state.report(state.begin(),'保存失败');
  state.begin(false);assert.equal(state.error,'保存失败');
  state.sync('');const pageAction=state.begin();state.sync('backup-progress');state.sync('');
  assert.equal(state.report(pageAction,'备份失败'),'toast');
});
