/**
 * The club table's scheduled verifier (juniors round §6.4, layer B; .github/workflows/club-table.yml). No person is
 * involved: it fetches pending submissions from the endpoint, re-sails each with the app's own code
 * (src/app/clubVerify.ts), records the verdict where the submitter's token can read it, deletes the replay, applies
 * removals and expiry, and writes the week's table (club/weekly-<week>.json) and its top-three ghosts to the site.
 *
 *   npm run tools:build && CLUB_TABLE_URL=… CLUB_ADMIN_TOKEN=… node dist-tools/club-verify.mjs --site site [--geo public/geo]
 *       [--builds verifiers] [--season-weeks 26]
 *   node dist-tools/club-verify.mjs --one submission.json [--geo public/geo]     (prints one verdict: for kept older builds)
 *
 * Exit 0 when the run completed (whatever the verdicts), 1 if the endpoint could not be reached (nothing is changed).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { identicalTiming, verifySubmission, type Submission, type Verdict } from '../src/app/clubVerify';
import { CLUB_TABLE_SCHEMA, type ClubTableFile, type TableEntry } from '../src/app/clubTable';
import { BUILD_ID } from '../src/app/controller';
import { parseRecording, type Recording } from '../src/app/replay';
import { weekOf } from '../src/app/weekly';
import { loadDartAppNode } from './lib/dartGeoNode';
import type { DartData } from '../src/app/geoLoader';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const geoDir = pathToFileURL(resolve(flag('geo') ?? 'public/geo') + '/');
let dartCache: DartData | undefined;
const dart = (): DartData => (dartCache ??= { ...loadDartAppNode(geoDir), issues: [] } as unknown as DartData);

function verify(sub: Submission): Verdict {
  if (sub.build === BUILD_ID) return verifySubmission(sub, dart());
  // A kept verifier for the build that recorded it (the last few builds are kept by the workflow).
  const dir = flag('builds');
  const older = dir ? join(resolve(dir), sub.build, 'club-verify.mjs') : undefined;
  if (older && existsSync(older)) {
    const tmp = join(resolve('out'), `sub-${sub.id}.json`);
    mkdirSync(resolve('out'), { recursive: true });
    writeFileSync(tmp, JSON.stringify(sub));
    try {
      return JSON.parse(execFileSync(process.execPath, [older, '--one', tmp, '--geo', resolve(flag('geo') ?? 'public/geo')], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n').pop()!) as Verdict;
    } catch {
      return { status: 'unverifiable', reason: 'built-by-another-version', flags: [] };
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  return { status: 'unverifiable', reason: 'built-by-another-version', flags: [] };
}

if (flag('one')) {
  const sub = JSON.parse(readFileSync(flag('one')!, 'utf8')) as Submission;
  console.log(JSON.stringify(verifySubmission(sub, dart())));
  process.exit(0);
}

const base = process.env.CLUB_TABLE_URL?.replace(/\/+$/, '');
const token = process.env.CLUB_ADMIN_TOKEN;
if (!base || !token) {
  console.error('CLUB_TABLE_URL and CLUB_ADMIN_TOKEN are needed (the club table is off: nothing to do).');
  process.exit(0);
}
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
/**
 * fetch with three tries on a network error (not on an HTTP error): re-sailing a long run takes tens of seconds, and a
 * kept-alive connection the server has closed meanwhile fails once ("fetch failed").
 */
async function fetch(url: string, init?: RequestInit): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      return await globalThis.fetch(url, init);
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}
async function list<T>(prefix: string): Promise<{ key: string; value: T }[]> {
  const r = await fetch(`${base}/admin/list?prefix=${encodeURIComponent(prefix)}`, { headers: auth });
  if (!r.ok) throw new Error(`list ${prefix}: ${r.status}`);
  return (await r.json()) as { key: string; value: T }[];
}
async function put(key: string, value: unknown): Promise<void> {
  const r = await fetch(`${base}/admin/put`, { method: 'PUT', headers: auth, body: JSON.stringify({ key, value }) });
  if (!r.ok) throw new Error(`put ${key}: ${r.status}`);
}
async function del(key: string): Promise<void> {
  const r = await fetch(`${base}/admin/delete`, { method: 'POST', headers: auth, body: JSON.stringify({ key }) });
  if (!r.ok) throw new Error(`delete ${key}: ${r.status}`);
}

interface Accepted extends TableEntry {
  status: 'accepted' | 'other-engine';
  flags: string[];
  /** The replay, compressed (deflate-raw, base64): kept only while the run might be one of the week's top three ghosts. */
  replayZ?: string;
}

const site = resolve(flag('site') ?? 'out/site');
const seasonWeeks = Number(flag('season-weeks') ?? 26);
const now = new Date();

try {
  // 1. Pending submissions: verify, record the verdict, delete the replay.
  const pending = await list<Omit<Submission, 'replay'>>('pending:');
  const verdicts: { sub: Submission; v: Verdict }[] = [];
  for (const { key, value: meta } of pending) {
    // The replay is stored apart, compressed (the endpoint never opens it): opened here, at most 64 MB.
    let sub: Submission;
    let zipped: string | undefined;
    try {
      const r = await fetch(`${base}/admin/blob?id=${encodeURIComponent(meta.id)}`, { headers: auth });
      const bytes = Buffer.from(await r.arrayBuffer());
      zipped = bytes.toString('base64');
      sub = { ...meta, replay: r.ok ? JSON.parse(inflateRawSync(bytes, { maxOutputLength: 64 << 20 }).toString('utf8')) : null };
    } catch {
      sub = { ...meta, replay: null };
    }
    const v = verify(sub);
    verdicts.push({ sub, v });
    await put(`status:${sub.tokenHash}`, { status: v.status, reason: v.reason, week: v.week, timeS: v.timeS, at: now.toISOString().slice(0, 16) + 'Z' });
    if ((v.status === 'accepted' || v.status === 'other-engine') && v.week && v.timeS !== undefined) {
      const rec: Accepted = { name: sub.name, timeS: v.timeS, category: v.category!, date: sub.receivedAt.slice(0, 10), status: v.status, flags: v.flags, replayZ: v.status === 'accepted' ? zipped : undefined };
      await put(`accepted:${v.week}:${sub.tokenHash}`, rec);
    }
    await del(key);
    await del(`blob:${meta.id}`);
    console.log(`${sub.id} ${sub.name} (${sub.engine}): ${v.status}${v.reason ? ` (${v.reason})` : ''}${v.timeS !== undefined ? ` ${v.timeS} s` : ''}${v.flags.length ? ` flags ${v.flags.join(',')}` : ''}`);
  }
  // 2. Removals: the entry made with that token goes, and the verdict says so.
  for (const { key } of await list('removal:')) {
    const hash = key.slice('removal:'.length);
    for (const a of await list(`accepted:`)) if (a.key.endsWith(`:${hash}`)) await del(a.key);
    await put(`status:${hash}`, { status: 'removed', at: now.toISOString().slice(0, 16) + 'Z' });
    await del(key);
    console.log(`removed the entry for one token`);
  }
  // 3. Expiry: entries older than the season go (the published tables too).
  const current = weekOf(now);
  const oldest = weekOf(new Date(now.getTime() - seasonWeeks * 7 * 86400e3)).key;
  const accepted = await list<Accepted>('accepted:');
  for (const a of accepted) if (a.key.split(':')[1]! < oldest) await del(a.key);
  // 4. Publish each week still in season (and this week, even if empty).
  const byWeek = new Map<string, { key: string; value: Accepted }[]>();
  byWeek.set(current.key, []);
  for (const a of accepted) {
    const wk = a.key.split(':')[1]!;
    if (wk < oldest) continue;
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk)!.push(a);
  }
  const out = join(site, 'club');
  mkdirSync(join(out, 'ghosts'), { recursive: true });
  const write = (path: string, data: unknown) => {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, path);
  };
  for (const [wk, rows] of byWeek) {
    const unzip = (z: string): Recording => parseRecording(JSON.parse(inflateRawSync(Buffer.from(z, 'base64'), { maxOutputLength: 64 << 20 }).toString('utf8')));
    const same = identicalTiming(rows.filter((r) => r.value.replayZ).map((r) => ({ id: r.key, rec: unzip(r.value.replayZ!) })));
    const isFlagged = (r: { key: string; value: Accepted }) => r.value.flags.length > 0 || same.has(r.key);
    const entry = (r: { value: Accepted }): TableEntry => ({ name: r.value.name, timeS: r.value.timeS, category: r.value.category, date: r.value.date });
    const ranked = rows.filter((r) => r.value.status === 'accepted' && !isFlagged(r)).sort((a, b) => a.value.timeS - b.value.timeS);
    const ghosts: ClubTableFile['ghosts'] = [];
    ranked.slice(0, 3).forEach((r, i) => {
      if (!r.value.replayZ) return;
      const file = `ghosts/${wk}-${i + 1}.json`;
      write(join(out, file), { ...unzip(r.value.replayZ), title: `${r.value.name}: club table, ${wk}`, claimed: undefined });
      ghosts.push({ rank: i + 1, name: r.value.name, file });
    });
    for (let i = ghosts.length + 1; i <= 3; i++) rmSync(join(out, `ghosts/${wk}-${i}.json`), { force: true });
    // Only the top three keep their replays; the rest are deleted now.
    for (const r of rows.slice()) {
      if (r.value.replayZ && !ranked.slice(0, 3).includes(r)) await put(r.key, { ...r.value, replayZ: undefined });
    }
    const table: ClubTableFile = {
      schema: CLUB_TABLE_SCHEMA, week: wk, generated: now.toISOString(),
      entries: ranked.map(entry),
      otherEngine: rows.filter((r) => r.value.status === 'other-engine').map(entry),
      flagged: rows.filter((r) => r.value.status === 'accepted' && isFlagged(r)).map(entry),
      ghosts,
      note: 'Each run was sailed again by the simulator to check it. A low-stakes club table: it shows a run was possible, not who sailed it.',
    };
    write(join(out, `weekly-${wk}.json`), table);
  }
  // Tables and ghosts from before the season are removed from the site.
  for (const f of readdirSync(out)) {
    const m = /^weekly-(\d{4}-W\d{2})\.json$/.exec(f);
    if (m && m[1]! < oldest) rmSync(join(out, f));
  }
  for (const f of readdirSync(join(out, 'ghosts'))) if (f.slice(0, 8) < oldest) rmSync(join(out, 'ghosts', f));
  write(join(out, 'index.json'), { latest: current.key, generated: now.toISOString() });
  console.log(`club table: ${verdicts.length} verified; weeks published ${[...byWeek.keys()].join(', ')}`);
} catch (e) {
  console.error(`club table: ${(e as Error).message} (nothing published this run)`);
  process.exit(1);
}
