import test from 'node:test';
import assert from 'node:assert/strict';
import {ModalSemantics,markModalSemantics,focusSceneCanvas} from '../web/modal-semantics.mjs';

function node(id){return {id,attributes:{},writes:0,getAttribute(name){return this.attributes[name] ?? null;},setAttribute(name,value){this.attributes[name]=value;++this.writes;},removeAttribute(name){delete this.attributes[name];}};}
function root(nodes){return {querySelectorAll:()=>nodes,getElementById:id=>nodes.find(n=>n.id===id)};}
class Observer {
  static all=[];
  constructor(callback){this.callback=callback;this.observations=[];this.disconnected=0;Observer.all.push(this);}
  observe(target,options){this.observations.push({target,options});}
  disconnect(){++this.disconnected;}
}

test('names only real modal containers and preserves native button semantics',()=>{
  const card=node('tinglan-modal-12'),title=node('tinglan-modal-12-title'),button=node('other-button');button.attributes.role='button';
  const tree=root([card,title,button]);markModalSemantics(tree);
  assert.deepEqual(card.attributes,{role:'dialog','aria-modal':'true','aria-labelledby':title.id});
  assert.deepEqual(title.attributes,{});assert.equal(button.attributes.role,'button');
  const writes=card.writes;markModalSemantics(tree);assert.equal(card.writes,writes,'observer callback must converge');
  card.attributes.role='presentation';markModalSemantics(tree);assert.equal(card.attributes.role,'dialog');
});
test('updates an initially unnamed modal after its title is composed',()=>{
  const card=node('tinglan-modal-3'),nodes=[card],tree=root(nodes);markModalSemantics(tree);
  assert.equal(card.attributes['aria-label'],'Dialog');nodes.push(node('tinglan-modal-3-title'));markModalSemantics(tree);
  assert.equal(card.attributes['aria-label'],undefined);assert.equal(card.attributes['aria-labelledby'],'tinglan-modal-3-title');
});
test('observes only the requested scene while open, disconnects at close and rejects foreign roots',()=>{
  Observer.all=[];const card=node('tinglan-modal-5'),tree=root([card]),host={children:[{children:[{shadowRoot:tree}]}]};
  const adapter=new ModalSemantics({document:{getElementById:id=>id==='tinglan-root'?host:null},Observer});
  assert.equal(adapter.set('unrelated-page',true),false);assert.equal(Observer.all.length,0);
  assert.equal(adapter.set('tinglan-root',true),true);assert.equal(card.attributes.role,'dialog');
  assert.equal(Observer.all.length,1);assert.equal(Observer.all[0].observations.at(-1).target,tree);
  assert.equal(adapter.set('tinglan-root',true),true);assert.equal(Observer.all.length,1);
  const observer=Observer.all[0];adapter.set('tinglan-root',false);const writes=card.writes;
  card.attributes.role='presentation';observer.callback();assert.equal(card.writes,writes);assert.equal(adapter.active.size,0);
  assert.ok(observer.disconnected>=2);assert.equal(adapter.set('tinglan-root','true'),false);
});
test('attaches once a Compose shadow host appears and bounds its search',()=>{
  Observer.all=[];const host={children:[]},adapter=new ModalSemantics({document:{getElementById:()=>host},Observer});
  adapter.set('tinglan-video-controls',true);const observer=Observer.all[0];assert.equal(observer.observations.length,1);
  const card=node('tinglan-modal-6'),tree=root([card]);host.children=[{shadowRoot:tree}];observer.callback();
  assert.equal(card.attributes.role,'dialog');assert.equal(observer.observations.length,2);
  adapter.close();assert.equal(adapter.active.size,0);observer.callback();assert.equal(observer.observations.length,2);
});

test('secondary scene dialogs acquire keyboard focus once without stealing subsequent input',()=>{
  Observer.all=[];let focus=0;const tree={...root([node('tinglan-modal-10')]),querySelector:()=>({focus(options){assert.equal(options.preventScroll,true);focus++;}})},host={children:[{shadowRoot:tree}]};
  assert.equal(focusSceneCanvas(null),false);
  const adapter=new ModalSemantics({document:{getElementById:()=>host},Observer});adapter.set('tinglan-video-controls',true);
  assert.equal(focus,1);Observer.all[0].callback();assert.equal(focus,1);adapter.close();
  adapter.set('tinglan-root',true);assert.equal(focus,2);Observer.all.at(-1).callback();assert.equal(focus,2);adapter.close();
});
