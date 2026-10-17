import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../server/gateway.mjs';
import { createStaticHandler } from '../server/static.mjs';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'dist');
const port = Number(process.env.PORT || 4173);
const files = createStaticHandler(base);
const gateway = createGateway({lanFiles:files});
const server = createServer(async (request, response) => {
  try {
    if (await gateway(request, response)) return;
    await files(request,response);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('File not found. Run ./gradlew webDistribution first.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Tinglan Web: http://127.0.0.1:${port}/`));
