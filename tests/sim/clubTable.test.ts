/**
 * Juniors round, layer B: the club table's endpoint (server/club-table/worker.js) and verifier (src/app/clubVerify.ts).
 * - The endpoint checks size, shape and the word-list name, rate-limits, stores no IP address, keeps only a hash of the
 *   deletion token, and needs the admin token for the verifier's routes.
 * - The verifier accepts a genuine weekly run and rejects altered ones (time, assists, conditions, boat, name); runs
 *   from another browser engine follow the documented tolerance; nothing is silently dropped.
 */
import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { ADJECTIVES as A2, CREATURES as C2, LIMITS, handle, memoryStore } from '../../server/club-table/worker.js';
import { ADJECTIVES, CREATURES } from '../../src/app/safeNames';
import { SimController } from '../../src/app/controller';
import { OTHER_ENGINE_TOLERANCE_S, identicalTiming, plausibility, verifySubmission, type Submission } from '../../src/app/clubVerify';
import { weeklyCourse, rotation } from '../../src/app/weekly';
import { AiSkipper, aiSkill } from '../../src/sim/ai/skipper';
import { submissionBody } from '../../src/app/clubTable';
import type { Recording } from '../../src/app/replay';

const TOKEN = 'a'.repeat(64);

describe('the endpoint', () => {
  const env = () => ({ STORE: memoryStore(), ADMIN_TOKEN: 'secret-admin', ALLOWED_ORIGIN: '*' });
  // The replay as the app sends it: compressed and base64-encoded (not opened by the endpoint).
  const replay = Buffer.from('a compressed replay would be here').toString('base64');
  const body = (o: Record<string, unknown> = {}) => ({ replay, name: 'Blue Heron 42', build: 'production-abc', engine: 'chromium', token: TOKEN, ...o });
  const post = (e: ReturnType<typeof env>, path: string, b: unknown, headers: Record<string, string> = {}, now = Date.parse('2026-11-17T10:00:00Z')) =>
    handle(new Request(`http://x${path}`, { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b), headers: { 'content-type': 'application/json', ...headers } }), e, now);

  it('uses the same word lists as the app', () => {
    expect(A2).toEqual([...ADJECTIVES]);
    expect(C2).toEqual([...CREATURES]);
  });

  it('accepts a well-formed run as pending, storing the token’s hash and no address', async () => {
    const e = env();
    const r = await post(e, '/submit', body(), { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' });
    expect(r.status).toBe(202);
    const stored = [...e.STORE.map.entries()];
    const pending = stored.find(([k]) => k.startsWith('pending:'))!;
    const v = JSON.parse(pending[1]);
    expect(Object.keys(v).sort()).toEqual(['build', 'engine', 'id', 'name', 'receivedAt', 'replay', 'tokenHash']);
    expect(JSON.stringify(stored)).not.toContain('203.0.113.9');
    expect(JSON.stringify(stored)).not.toContain(TOKEN);
    expect(v.receivedAt).toBe('2026-11-17T10:00Z');
  });

  it('refuses anything else: extra fields, free-text names, bad tokens, non-replays, too large', async () => {
    const e = env();
    expect((await post(e, '/submit', body({ email: 'a@b.c' }))).status).toBe(400);
    expect(await (await post(e, '/submit', body({ name: 'Sam Smith 1' }))).json()).toEqual({ error: 'name-not-on-word-list' });
    expect((await post(e, '/submit', body({ token: 'short' }))).status).toBe(400);
    expect(await (await post(e, '/submit', body({ replay: { schema: 'squib-replay/1' } }))).json()).toEqual({ error: 'not-an-encoded-replay' });
    expect((await post(e, '/submit', 'not json')).status).toBe(400);
    const big = 'A'.repeat(LIMITS.maxBytes + 4);
    expect((await post(e, '/submit', body({ replay: big }))).status).toBe(413);
    expect([...e.STORE.map.keys()].some((k) => k.startsWith('pending:'))).toBe(false);
  });

  it('rate limits: pending runs per name, and everyone together per window', async () => {
    const e = env();
    for (let i = 0; i < LIMITS.pendingPerName; i++) expect((await post(e, '/submit', body({ token: String(i).padStart(64, '0') }))).status).toBe(202);
    expect(await (await post(e, '/submit', body({ token: 'f'.repeat(64) }))).json()).toEqual({ error: 'too-many-pending-for-this-name' });
    const e2 = env();
    const names = ADJECTIVES.slice(0, LIMITS.perWindow + 1);
    let last = 0;
    for (const [i, a] of names.entries()) last = (await post(e2, '/submit', body({ name: `${a} Seal ${i + 1}`, token: i.toString(16).padStart(64, '0') }))).status;
    expect(last).toBe(429);
  });

  it('removal and verdicts by token; admin routes need the admin token', async () => {
    const e = env();
    await post(e, '/submit', body());
    const status = await handle(new Request(`http://x/status?token=${TOKEN}`), e);
    expect(await status.json()).toEqual({ status: 'pending' });
    expect((await post(e, '/remove', { token: TOKEN })).status).toBe(202);
    expect([...e.STORE.map.keys()].some((k) => k.startsWith('removal:'))).toBe(true);
    expect((await handle(new Request('http://x/admin/list?prefix=pending:'), e)).status).toBe(401);
    expect((await handle(new Request('http://x/admin/list?prefix=pending:', { headers: { authorization: 'Bearer wrong' } }), e)).status).toBe(401);
    const ok = await handle(new Request('http://x/admin/list?prefix=pending:', { headers: { authorization: 'Bearer secret-admin' } }), e);
    expect((await ok.json()).length).toBe(1);
  });
});

/** A practice week of the rotation (a short course: the RDYC courses take the AI about 50 minutes). */
function practiceDate(): Date {
  for (let i = 0; i < rotation().length; i++) {
    const d = new Date(Date.UTC(2026, 10, 18 + 7 * i, 12));
    if (weeklyCourse(d).slot.kind === 'practice') return d;
  }
  throw new Error('no practice week');
}

/** Sail the week's course with the AI on the helm of the player's own boat: its inputs are logged as a player's. */
function genuineRun(at: Date): { rec: Recording; timeS: number } {
  const w = weeklyCourse(at);
  const c = new SimController();
  expect(c.restart(structuredClone(w.scenario))).toBe(true);
  const s = c.race!.session;
  const you = s.fleet.boat('you')!;
  const sk = new AiSkipper(you, s, aiSkill('good', 1, 0, 1), 0);
  you.sim.controller = (sim) => sk.control(sim);
  for (let t = 0; t < 1800 && s.judgeOf('you').phase !== 'finished'; t += 5) c.advance(5);
  c.advance(2);
  const j = s.judgeOf('you');
  expect(j.phase).toBe('finished');
  const timeS = Math.round((j.finishTime! - s.committee.startTime) * 10) / 10;
  return { rec: { ...c.saveRecording('Blue Heron 42: weekly'), claimed: { finishS: timeS, independent: false } }, timeS };
}

describe('the verifier', () => {
  const at = practiceDate();
  const { rec, timeS } = genuineRun(at);
  const BUILD = rec.build;
  const sub = (o: Partial<Submission> = {}, r: Recording = rec): Submission => ({ id: 'x', receivedAt: at.toISOString(), name: 'Blue Heron 42', build: BUILD, engine: 'chromium', tokenHash: 'h', replay: JSON.parse(JSON.stringify(r)), ...o });

  it('the submission body is exactly the replay (compressed), the name, the build, the engine family and the token', async () => {
    const b = await submissionBody(rec, 'Blue Heron 42', BUILD, TOKEN, 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0');
    expect(Object.keys(b).sort()).toEqual(['build', 'engine', 'name', 'replay', 'token']);
    expect(b.engine).toBe('chromium');
    const back = JSON.parse(inflateRawSync(Buffer.from(b.replay, 'base64')).toString('utf8'));
    expect(back.endStep).toBe(rec.endStep);
    // The endpoint takes it as it is.
    const e = { STORE: memoryStore(), ADMIN_TOKEN: 'a', ALLOWED_ORIGIN: '*' };
    const r = await handle(new Request('http://x/submit', { method: 'POST', body: JSON.stringify(b) }), e, at.getTime());
    expect(r.status).toBe(202);
    console.log(`submission: ${(JSON.stringify(b).length / 1024).toFixed(0)} kB for ${(rec.endStep / 100).toFixed(0)} s sailed with the AI on the helm`);
  });

  it('accepts a genuine run, with the re-sailed time, as assisted (auto-trim was on)', () => {
    const v = verifySubmission(sub(), undefined, BUILD);
    expect(v).toMatchObject({ status: 'accepted', exact: true, timeS, category: 'assisted' });
    expect(v.flags).toEqual([]);
  }, 120_000);

  it('rejects altered runs: time, assists, conditions, boat, name', () => {
    const alt = (f: (r: Recording) => void) => {
      const r = structuredClone(rec);
      f(r);
      return verifySubmission(sub({}, r), undefined, BUILD).reason;
    };
    expect(alt((r) => (r.claimed!.finishS -= 10))).toBe('time-not-as-claimed');
    expect(alt((r) => (r.claimed!.independent = true))).toBe('assists-not-as-claimed');
    expect(alt((r) => ((r.scenario.conditions.weather as { twsKn: number }).twsKn += 2))).toBe('conditions-changed');
    expect(alt((r) => (r.scenario.boat = 'classic'))).toBe('boat-changed');
    expect(alt((r) => (r.inputs[Math.floor(r.inputs.length / 2)]![1] += 0.2))).toMatch(/did-not-replay-exactly|time-not-as-claimed/);
    expect(verifySubmission(sub({ name: 'Sam Smith 3' }), undefined, BUILD).reason).toBe('name-not-on-word-list');
    expect(verifySubmission(sub({ build: 'production-older' }), undefined, BUILD)).toMatchObject({ status: 'unverifiable', reason: 'built-by-another-version' });
    expect(verifySubmission(sub({ receivedAt: new Date(at.getTime() + 8 * 86400e3).toISOString() }), undefined, BUILD).reason).toBe('not-this-weeks-course');
  }, 300_000);

  it('another browser engine: bit-exact is accepted; a small difference within the tolerance is accepted with the re-sailed time; more is listed apart', () => {
    expect(verifySubmission(sub({ engine: 'gecko' }), undefined, BUILD)).toMatchObject({ status: 'accepted', exact: true });
    // A run whose last input differs slightly (as a different engine's arithmetic might): it diverges, finishes close.
    const near = structuredClone(rec);
    const k = near.inputs.findIndex((r) => r[0] > near.endStep - 1500);
    near.inputs[k]![1] += 0.01;
    const v = verifySubmission(sub({ engine: 'webkit' }, near), undefined, BUILD);
    expect(v.exact).toBe(false);
    expect(Math.abs(v.timeS! - timeS)).toBeLessThanOrEqual(OTHER_ENGINE_TOLERANCE_S);
    expect(v).toMatchObject({ status: 'accepted', reason: 'other-engine-within-tolerance' });
    // The same change from Chromium (the verifier's own engine) is rejected: it should have matched exactly.
    expect(verifySubmission(sub({ engine: 'chromium' }, near), undefined, BUILD).status).toBe('rejected');
    // Claimed time far from the re-sailed one: listed apart, never dropped silently.
    const far = structuredClone(near);
    far.claimed!.finishS += 30;
    expect(verifySubmission(sub({ engine: 'webkit' }, far), undefined, BUILD)).toMatchObject({ status: 'other-engine', reason: 'other-engine-time-differs' });
  }, 300_000);

  it('plausibility: perfectly periodic input and identical timing across runs are flagged', () => {
    expect(plausibility(rec)).toEqual([]);
    const bot = structuredClone(rec);
    bot.inputs = Array.from({ length: 300 }, (_, i) => [i * 50, i % 2 ? 0.2 : -0.2, 0.3, 0.3, 0.6, 0] as Recording['inputs'][number]);
    expect(plausibility(bot)).toContain('perfectly-periodic-input');
    const fast = structuredClone(rec);
    fast.inputs = Array.from({ length: 400 }, (_, i) => [i * 7 + (i % 3), 0, 0.3, 0.3, 0.6, 0] as Recording['inputs'][number]);
    expect(plausibility(fast)).toContain('input-rate-beyond-human');
    expect([...identicalTiming([{ id: 'a', rec }, { id: 'b', rec: structuredClone(rec) }])].sort()).toEqual(['a', 'b']);
  });
});
