/** Lazy workers: payloads stay as Blob references, and completed idle work releases its worker. */
export class WorkerClient {
  constructor(url, { timeout = 0, idleMs = 0 } = {}) {
    this.url = url; this.timeout = timeout; this.idleMs = idleMs; this.sequence = 0; this.pending = new Map();
  }
  run(operation, input, onProgress = () => {},{transfer=[]}={}) {
    clearTimeout(this.idleTimer);
    if (!this.worker) {
      this.worker = new Worker(this.url, { type: 'module' });
      const worker = this.worker;
      this.worker.addEventListener('message', event => {
        if (this.worker !== worker) return;
        const task = this.pending.get(event.data.id); if (!task) return;
        if (event.data.progress) { task.onProgress(event.data.progress); return; }
        clearTimeout(task.timer); this.pending.delete(event.data.id);
        if (event.data.error) task.reject(new Error(event.data.error)); else task.resolve(event.data.result);
        if (!this.pending.size && this.idleMs) this.idleTimer = setTimeout(() => this.close(), this.idleMs);
      });
      this.worker.addEventListener('error', () => { if (this.worker === worker) this.close('Background task unavailable. Retry'); });
      this.worker.addEventListener('messageerror', () => { if (this.worker === worker) this.close('Unable to read background task data'); });
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = this.timeout ? setTimeout(() => this.close('File parsing timed out. Original audio is kept'), this.timeout) : undefined;
      this.pending.set(id, { resolve, reject, timer, onProgress });
      try { this.worker.postMessage({ id, operation, input },transfer); }
      catch { this.close('Unable to start background task'); }
    });
  }
  close(reason = 'Action cancelled') {
    clearTimeout(this.idleTimer); this.worker?.terminate(); this.worker = null;
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error(reason)); }
    this.pending.clear();
  }
}
