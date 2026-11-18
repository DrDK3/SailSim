/**
 * The club table's submission endpoint (juniors round §6.4, layer B; behind the app's `clubTable` flag, off until the
 * owner deploys this and sets VITE_CLUB_TABLE_URL). One small file, no framework, no dependencies. Written for
 * Cloudflare Workers with a KV namespace (docs/DEPLOYMENT.md "Club table"); `handle` works against any store with
 * get/put/delete/list, which is how the local mock (mock.mjs) and the tests run it.
 *
 * What it does, and nothing more:
 *  - POST /submit   the replay as the body (its JSON compressed with deflate-raw), and the word-list name, the build,
 *                    the engine family and the deletion token in the headers x-squib-name, x-squib-build,
 *                    x-squib-engine, x-squib-token. Nothing else is read. Checks the size, the headers' shapes, the
 *                    word-list name and (when configured) the Turnstile bot check; rate limits; stores the run as
 *                    pending. Stores the SHA-256 of the deletion token, never the token, and no IP address or other
 *                    identifier. Measured sizes (docs/JUNIORS_REPORT.md §4.3): a 10-minute run sailed with the keys is
 *                    about 75 kB compressed, one steered every step (a stick, or the AI) about 820 kB; a 55-minute RDYC
 *                    course steered every step about 4 MB. The endpoint never opens the replay (the free plan allows
 *                    about 10 ms of CPU a request): the verifier checks it.
 *  - POST /remove   {token}: asks for the entry made with this token to be removed (the next verifier run does it).
 *  - GET  /status?token=…: the verifier's verdict for the run made with this token (accepted, or the reason not).
 *  - Admin (Authorization: Bearer ADMIN_TOKEN, held only in GitHub secrets for the scheduled verifier):
 *      GET /admin/list?prefix=…, GET /admin/blob?id=… (a pending run's replay bytes), PUT /admin/put {key, value},
 *      POST /admin/delete {key}.
 *
 * Keys: pending:<id> (metadata), blob:<id> (the compressed replay), status:<tokenHash>, removal:<tokenHash>, accepted:<week>:<tokenHash>, rate:<window>.
 * What the provider itself logs (request metadata, IP addresses in its own logs) is described in
 * docs/club-table/DATA_PROTECTION.md; this code adds nothing to it.
 */

/** The word lists (the same as src/app/safeNames.ts; a test checks they match). */
export const ADJECTIVES = ['Blue', 'Bold', 'Brave', 'Bright', 'Brisk', 'Calm', 'Clever', 'Cosy', 'Daring', 'Eager', 'Fair', 'Gentle', 'Golden', 'Green', 'Happy', 'Jolly', 'Keen', 'Kind', 'Lively', 'Lucky', 'Merry', 'Mighty', 'Nimble', 'Plucky', 'Proud', 'Quick', 'Quiet', 'Rapid', 'Silver', 'Smart', 'Speedy', 'Steady', 'Sunny', 'Swift', 'Tidy', 'Trusty', 'Wise', 'Zippy'];
export const CREATURES = ['Anchovy', 'Avocet', 'Barnacle', 'Cockle', 'Cormorant', 'Crab', 'Curlew', 'Dolphin', 'Dunlin', 'Egret', 'Gannet', 'Guillemot', 'Gull', 'Heron', 'Kittiwake', 'Limpet', 'Lobster', 'Mackerel', 'Mullet', 'Otter', 'Oystercatcher', 'Pipefish', 'Plover', 'Porpoise', 'Prawn', 'Puffin', 'Razorbill', 'Redshank', 'Seahorse', 'Seal', 'Shearwater', 'Shrimp', 'Starfish', 'Tern', 'Turnstone', 'Whelk', 'Wrasse'];

/** Limits (E: sized for a club's juniors and the measured replay sizes above). */
export const LIMITS = {
  /** Largest replay (compressed bytes). KV takes values up to 25 MiB. */
  maxBytes: 8 * 1024 * 1024,
  /** Submissions accepted for storage in any 10-minute window (all players together). */
  perWindow: 30,
  windowS: 600,
  /** Pending submissions with one name at a time. */
  pendingPerName: 3,
};

export function isSafeName(x) {
  if (typeof x !== 'string' || x.length > 40) return false;
  const m = /^([A-Z][a-z]+) ([A-Z][a-z]+) ([1-9][0-9]?)$/.exec(x);
  return !!m && ADJECTIVES.includes(m[1]) && CREATURES.includes(m[2]);
}

const json = (status, body, cors) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The submission's headers: a word-list name, a build id, an engine family, a deletion token. */
export function checkSubmission(h) {
  if (!isSafeName(h.name)) return 'name-not-on-word-list';
  if (typeof h.build !== 'string' || !/^[\w.-]{1,80}$/.test(h.build)) return 'bad-build';
  if (!['chromium', 'gecko', 'webkit', 'other'].includes(h.engine)) return 'bad-engine';
  if (typeof h.token !== 'string' || !/^[0-9a-f]{64}$/.test(h.token)) return 'bad-token';
  return undefined;
}

async function turnstileOk(env, token) {
  if (!env.TURNSTILE_SECRET) return true; // not configured (the mock, the tests)
  if (typeof token !== 'string' || !token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  return j.success === true;
}

/** The request handler: `env.STORE` is the store ({get, put, delete, list}); `env.ADMIN_TOKEN`, `env.ALLOWED_ORIGIN`. */
export async function handle(request, env, now = Date.now()) {
  const url = new URL(request.url);
  const cors = { 'access-control-allow-origin': env.ALLOWED_ORIGIN ?? '*', 'access-control-allow-headers': 'content-type, cf-turnstile-response, x-squib-name, x-squib-build, x-squib-engine, x-squib-token', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const store = env.STORE;
  const path = url.pathname.replace(/\/+$/, '');

  if (path.startsWith('/admin/')) {
    if (!env.ADMIN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return json(401, { error: 'unauthorised' }, {});
    if (request.method === 'GET' && path === '/admin/list') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const keys = await store.list(prefix);
      const out = [];
      for (const k of keys) out.push({ key: k, value: JSON.parse((await store.get(k)) ?? 'null') });
      return json(200, out, {});
    }
    if (request.method === 'GET' && path === '/admin/blob') {
      const blob = await store.get(`blob:${url.searchParams.get('id') ?? ''}`, 'arrayBuffer');
      return blob ? new Response(blob, { status: 200, headers: { 'content-type': 'application/octet-stream' } }) : json(404, { error: 'no-such-blob' }, {});
    }
    const body = await request.json().catch(() => undefined);
    if (request.method === 'PUT' && path === '/admin/put' && body && typeof body.key === 'string') {
      await store.put(body.key, JSON.stringify(body.value));
      return json(200, { ok: true }, {});
    }
    if (request.method === 'POST' && path === '/admin/delete' && body && typeof body.key === 'string') {
      await store.delete(body.key);
      return json(200, { ok: true }, {});
    }
    return json(404, { error: 'unknown-admin-route' }, {});
  }

  if (request.method === 'POST' && path === '/submit') {
    const len = Number(request.headers.get('content-length') ?? 0);
    if (len > LIMITS.maxBytes) return json(413, { error: 'too-large' }, cors);
    const h = { name: request.headers.get('x-squib-name'), build: request.headers.get('x-squib-build'), engine: request.headers.get('x-squib-engine'), token: request.headers.get('x-squib-token') };
    const bad = checkSubmission(h);
    if (bad) return json(400, { error: bad }, cors);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > LIMITS.maxBytes) return json(413, { error: 'too-large' }, cors);
    if (bytes.byteLength < 16) return json(400, { error: 'no-replay' }, cors);
    const body = h;
    if (!(await turnstileOk(env, request.headers.get('cf-turnstile-response')))) return json(403, { error: 'bot-check-failed' }, cors);
    // Rate limits: everyone together per window, and pending runs per name.
    const win = `rate:${Math.floor(now / 1000 / LIMITS.windowS)}`;
    const used = Number((await store.get(win)) ?? 0);
    if (used >= LIMITS.perWindow) return json(429, { error: 'busy-try-later' }, cors);
    const pending = await store.list('pending:');
    let mine = 0;
    for (const k of pending) if (JSON.parse((await store.get(k)) ?? '{}').name === body.name) mine++;
    if (mine >= LIMITS.pendingPerName) return json(429, { error: 'too-many-pending-for-this-name' }, cors);
    const tokenHash = await sha256Hex(body.token);
    const id = `${Math.floor(now / 1000).toString(36)}-${tokenHash.slice(0, 12)}`;
    await store.put(`blob:${id}`, bytes, { expirationTtl: 14 * 86400 });
    await store.put(`pending:${id}`, JSON.stringify({ id, receivedAt: new Date(now).toISOString().slice(0, 16) + 'Z', name: body.name, build: body.build, engine: body.engine, tokenHash }), { expirationTtl: 14 * 86400 });
    await store.put(`status:${tokenHash}`, JSON.stringify({ status: 'pending' }), { expirationTtl: 120 * 86400 });
    await store.put(win, String(used + 1), { expirationTtl: LIMITS.windowS * 2 });
    return json(202, { ok: true, status: 'pending' }, cors);
  }

  if (request.method === 'POST' && path === '/remove') {
    const body = await request.json().catch(() => undefined);
    if (!body || typeof body.token !== 'string' || !/^[0-9a-f]{64}$/.test(body.token)) return json(400, { error: 'bad-token' }, cors);
    const tokenHash = await sha256Hex(body.token);
    await store.put(`removal:${tokenHash}`, JSON.stringify({ at: new Date(now).toISOString().slice(0, 16) + 'Z' }), { expirationTtl: 30 * 86400 });
    return json(202, { ok: true, status: 'removal-requested' }, cors);
  }

  if (request.method === 'GET' && path === '/status') {
    const token = url.searchParams.get('token') ?? '';
    if (!/^[0-9a-f]{64}$/.test(token)) return json(400, { error: 'bad-token' }, cors);
    const s = await store.get(`status:${await sha256Hex(token)}`);
    return json(200, s ? JSON.parse(s) : { status: 'unknown' }, cors);
  }

  return json(404, { error: 'not-found' }, cors);
}

/** A Cloudflare KV namespace as the store. */
export function kvStore(kv) {
  return {
    get: (k, type) => (type ? kv.get(k, type) : kv.get(k)),
    put: (k, v, o) => kv.put(k, v, o),
    delete: (k) => kv.delete(k),
    list: async (prefix) => {
      const keys = [];
      let cursor;
      do {
        const r = await kv.list({ prefix, cursor });
        keys.push(...r.keys.map((x) => x.name));
        cursor = r.list_complete ? undefined : r.cursor;
      } while (cursor);
      return keys;
    },
  };
}

/** A store in memory (the mock and the tests). */
export function memoryStore(map = new Map()) {
  return {
    map,
    get: async (k) => map.get(k) ?? null,
    put: async (k, v) => void map.set(k, v),
    delete: async (k) => void map.delete(k),
    list: async (prefix) => [...map.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

export default {
  /** Cloudflare Workers entry: bindings CLUB (KV), secrets ADMIN_TOKEN and TURNSTILE_SECRET, var ALLOWED_ORIGIN. */
  fetch(request, env) {
    return handle(request, { ...env, STORE: kvStore(env.CLUB) });
  },
};
