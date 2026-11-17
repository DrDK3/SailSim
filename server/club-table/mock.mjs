/**
 * The club table's endpoint, locally (juniors round): the same handler as the Worker (worker.js) over an in-memory
 * store, on http://localhost:PORT. For development and the end-to-end tests; nothing here is deployed.
 *
 *   node server/club-table/mock.mjs [port] [admin-token]
 */
import { createServer } from 'node:http';
import { handle, memoryStore } from './worker.js';

const port = Number(process.argv[2] ?? 8787);
const env = { STORE: memoryStore(), ADMIN_TOKEN: process.argv[3] ?? process.env.CLUB_ADMIN_TOKEN ?? 'local-admin-token', ALLOWED_ORIGIN: '*' };

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')),
    body: req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? undefined : body,
  });
  const r = await handle(request, env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`club-table mock on http://localhost:${port} (admin token: ${env.ADMIN_TOKEN})`));
