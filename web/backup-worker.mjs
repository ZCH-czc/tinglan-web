import { createBackup, readBackup } from './backup.mjs';
self.addEventListener('message', async ({ data }) => {
  const progress = value => self.postMessage({ id: data.id, progress: value });
  try {
    const result = data.operation === 'export' ? await createBackup(data.input, progress) : await readBackup(data.input, progress);
    self.postMessage({ id: data.id, result });
  } catch (error) { self.postMessage({ id: data.id, error: error.message || 'Backup operation incomplete' }); }
});
