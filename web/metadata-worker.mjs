import {tr} from './i18n.mjs';
import { extractMetadata } from './metadata-parse.mjs';

self.addEventListener('message', async ({ data }) => {
  try { self.postMessage({ id: data.id, result: await extractMetadata(data.input) }); }
  catch { self.postMessage({ id: data.id, error: tr("Unable to parse metadata. Using the filename") }); }
});
