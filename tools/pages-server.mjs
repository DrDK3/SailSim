/**
 * A static server that behaves like GitHub Pages for a project site, for the deployment browser tests:
 * the built site (dist/) is served under /<prefix>/ only, /<prefix> redirects to /<prefix>/, there is no
 * fallback routing (a missing file is a 404), and responses carry Pages-like cache headers.
 *   node tools/pages-server.mjs [port=4174] [prefix=squib-dart-sim] [dir=dist]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.argv[2] ?? 4174);
const prefix = `/${process.argv[3] ?? 'squib-dart-sim'}`;
const root = resolve(process.argv[4] ?? 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path === prefix) {
    res.writeHead(301, { Location: `${prefix}/` });
    res.end();
    return;
  }
  if (!path.startsWith(`${prefix}/`)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404: outside the site');
    return;
  }
  path = path.slice(prefix.length);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'max-age=600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404</h1>');
  }
}).listen(port, () => console.log(`Pages-like server: http://localhost:${port}${prefix}/ -> ${root}`));
