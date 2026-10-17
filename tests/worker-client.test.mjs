import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerClient } from '../web/worker-client.mjs';

class WorkerHost {
  static instances = [];
  constructor() { this.listeners = new Map(); WorkerHost.instances.push(this); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  postMessage(message) { this.last = message; }
  terminate() { this.terminated = true; }
  emit(type, data) { this.listeners.get(type)?.({ data }); }
}
globalThis.Worker = WorkerHost;
test('cancelled worker replies and errors cannot stop a newer task', async () => {
  const client = new WorkerClient('test'); const old = client.run('parse', {}); const oldHost = WorkerHost.instances.at(-1);
  const rejection = assert.rejects(old, /cancelled/i); client.close(); await rejection;
  const fresh = client.run('parse', {}); const freshHost = WorkerHost.instances.at(-1);
  oldHost.emit('message', { id: oldHost.last.id, result: 'old' }); oldHost.emit('error');
  assert.equal(freshHost.terminated, undefined);
  freshHost.emit('message', { id: freshHost.last.id, result: 'fresh' }); assert.equal(await fresh, 'fresh'); client.close();
});
test('progress does not finish a job, and worker errors release all pending tasks', async () => {
  const client = new WorkerClient('test'); let progress = 0;
  const task = client.run('parse', {}, () => progress++); const host = WorkerHost.instances.at(-1);
  host.emit('message', { id: host.last.id, progress: { percent: 50 } }); assert.equal(progress, 1); assert.equal(client.pending.size, 1);
  const rejection = assert.rejects(task, /Background task/i); host.emit('error'); await rejection;
  assert.equal(client.pending.size, 0); assert.equal(host.terminated, true);
});
