/**
 * Review #9 (20 Nov 2026): the River Dart data arriving must not reset a run. Before, `loadDart` restarted whatever
 * was running when the data came in (a slow connection: a sail, a lesson or a race under way jumped back to its start).
 * Now: untouched, restart as before; a free sail under way takes the river where the boat is, if that is safe; anything
 * else asks ("The river is ready. Restart here?"). A lesson, an exercise or a race is never restarted silently. The
 * controller runs headless with the loader mocked, so the data arrives exactly when the test says.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeGridPlanes, isGzip } from '../../src/sim/geo/pack';
import { townQuays, loadDartData, type DartData, type DartFeatures, type TownGridSpec } from '../../src/app/geoLoader';
import { SimController } from '../../src/app/controller';
import { parseRecording, REPLAY_SCHEMA, REPLAY_SCHEMA_RIVER_JOINED } from '../../src/app/replay';
import { loadDartGeo } from './helpers';

vi.mock('../../src/app/geoLoader', async (orig) => ({ ...(await orig<typeof import('../../src/app/geoLoader')>()), loadDartData: vi.fn() }));

const dir = new URL('../../public/geo/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
const features = JSON.parse(readFileSync(new URL('features.json', dir), 'utf8')) as DartFeatures;
let data: DartData;

beforeAll(() => {
  let buf: Uint8Array = readFileSync(new URL(manifest.town.file, dir));
  if (isGzip(buf)) buf = gunzipSync(buf);
  const t = manifest.town as TownGridSpec;
  const town = { spec: t, values: Float32Array.from(new Int16Array(decodeGridPlanes(buf, t.nx, t.ny)), (v) => v * t.scale) };
  data = { geo: loadDartGeo(), features, town, quays: townQuays(town, features), issues: [] };
});

/** The river data arrives now (a copy, so a run's issues do not leak into the next test). */
async function arrive(c: SimController): Promise<void> {
  vi.mocked(loadDartData).mockResolvedValueOnce({ ...data, issues: [] });
  await c.loadDart();
}

/** A few seconds' sailing with the keys: an input the sailor gave, so the run is under way. */
function sailABit(c: SimController): void {
  c.press('helmLeft', true);
  c.advance(1);
  c.press('helmLeft', false);
  c.advance(4);
}

describe('the River Dart data arriving during a run (review #9)', () => {
  it('untouched: restarts the free sail with the river, as before', async () => {
    const c = new SimController();
    const before = c.sim;
    expect(before.seabed).toBeUndefined();
    await arrive(c);
    expect(c.sim).not.toBe(before);
    expect(c.sim.seabed).toBeDefined();
    expect(c.sim.time).toBe(0);
    expect(c.getState().dart).toMatchObject({ status: 'loaded', ask: false });
  });

  it('a free sail under way in clear water: the river joins in place, the run goes on, and its replay repeats it exactly', async () => {
    const c = new SimController();
    sailABit(c);
    const sim = c.sim;
    const t = sim.time;
    const at = { n: sim.state.n, e: sim.state.e, psi: sim.state.psi, u: sim.state.u };
    const wind = c.built.wind;
    await arrive(c);
    // The same run: same boat, same moment, same place and speed; the river is under her now; the gusts carry on.
    expect(c.sim).toBe(sim);
    expect(c.sim.time).toBe(t);
    expect({ n: sim.state.n, e: sim.state.e, psi: sim.state.psi, u: sim.state.u }).toEqual(at);
    expect(c.sim.seabed).toBe(data.geo);
    expect(c.built.wind).toBe(wind);
    expect(c.getState().dart).toMatchObject({ status: 'loaded', ask: false });
    c.advance(12);
    // The recording says where the river joined (schema /2) and plays back bit for bit.
    const rec = parseRecording(JSON.parse(JSON.stringify(c.saveRecording('joined'))));
    expect(rec.schema).toBe(REPLAY_SCHEMA_RIVER_JOINED);
    expect(rec.dartFromStep).toBe(Math.round(t * 100));
    expect(rec.dart).toBe('loaded');
    const p = new SimController();
    p.dartData = { ...data, issues: [] };
    expect(p.startReplay(rec)).toBe(true);
    expect(p.sim.seabed).toBeUndefined();
    p.advance(rec.endStep * 0.01 + 1);
    const st = p.getState().replay!;
    expect(p.sim.seabed).toBe(data.geo);
    expect(st.state).toBe('ended');
    expect(st.checkpointsMatched).toBe(st.checkpointsTotal);
    // Any other run's recording is unchanged (schema /1, no step).
    const fresh = new SimController();
    fresh.dartData = { ...data, issues: [] };
    fresh.restart();
    fresh.advance(3);
    const r1 = fresh.saveRecording('plain');
    expect(r1.schema).toBe(REPLAY_SCHEMA);
    expect('dartFromStep' in r1).toBe(false);
  }, 120_000);

  it('a free sail under way where joining is not safe (on the land here): asks; Keep sailing goes on in open water until the next start', async () => {
    const c = new SimController();
    sailABit(c);
    // Put the boat where the river data has land (a few hundred metres east of the club, on the Kingswear side's hill).
    const geo = data.geo!;
    let land: { n: number; e: number } | undefined;
    for (let e = 0; e < 1500 && !land; e += 10) if (geo.inDomain(0, e) && geo.depth(0, e, 0) < -5) land = { n: 0, e };
    expect(land).toBeDefined();
    c.sim.state.n = land!.n;
    c.sim.state.e = land!.e;
    const sim = c.sim;
    await arrive(c);
    expect(c.sim).toBe(sim);
    expect(c.sim.seabed).toBeUndefined();
    expect(c.getState().dart).toMatchObject({ status: 'ready', ask: true });
    c.riverKeep();
    expect(c.getState().dart).toMatchObject({ status: 'ready', ask: false });
    c.advance(2);
    expect(c.sim).toBe(sim);
    expect(c.sim.seabed).toBeUndefined();
    // Its recording is of an open-water run.
    expect(c.saveRecording('x').dart).toBe('none');
    // The next start takes the river.
    c.restart();
    expect(c.sim.seabed).toBe(data.geo);
    expect(c.getState().dart).toMatchObject({ status: 'loaded', ask: false });
  });

  it('a lesson in progress is never reset silently: it asks, and Restart starts the lesson again with the river', async () => {
    const c = new SimController();
    c.startLesson();
    const lesson = c.getState().tutorial?.lesson.id;
    expect(lesson).toBeDefined();
    sailABit(c);
    const sim = c.sim;
    await arrive(c);
    expect(c.sim).toBe(sim);
    expect(c.getState().tutorial?.lesson.id).toBe(lesson);
    expect(c.getState().dart.ask).toBe(true);
    c.riverRestart();
    expect(c.sim).not.toBe(sim);
    expect(c.sim.seabed).toBe(data.geo);
    expect(c.getState().tutorial?.lesson.id).toBe(lesson);
    expect(c.getState().dart.ask).toBe(false);
  });

  it('an exercise or a race under way asks too, even with no key pressed after its first seconds', async () => {
    const c = new SimController();
    c.startExercise('tack-recover');
    c.advance(6);
    const sim = c.sim;
    await arrive(c);
    expect(c.sim).toBe(sim);
    expect(c.getState().dart.ask).toBe(true);
    const r = new SimController();
    expect(r.startSession({ ...structuredClone(r.scenario), course: { source: 'practice', kind: 'windward-leeward', legM: 250, laps: 1 } })).toBe(true);
    r.advance(6);
    const rs = r.sim;
    await arrive(r);
    expect(r.sim).toBe(rs);
    expect(r.getState().dart.ask).toBe(true);
  });
});

describe('replay schema /2 (river joined part-way)', () => {
  const base = { created: '2026-11-21T00:00:00Z', title: 't', build: 'b', scenario: { conditions: {} }, initialInput: null, inputs: [[0, 0, 0.3, 0.3, 0.6, 0]], checkpoints: [], endStep: 10 };
  it('reads /1 as before and /2 with its step; refuses a step on /1 or a /2 without one', () => {
    expect(parseRecording({ ...base, schema: REPLAY_SCHEMA, dart: 'none' }).dartFromStep).toBeUndefined();
    expect(parseRecording({ ...base, schema: REPLAY_SCHEMA_RIVER_JOINED, dart: 'loaded', dartFromStep: 500 }).dartFromStep).toBe(500);
    expect(() => parseRecording({ ...base, schema: REPLAY_SCHEMA, dart: 'loaded', dartFromStep: 500 })).toThrow(/river-joined/);
    expect(() => parseRecording({ ...base, schema: REPLAY_SCHEMA_RIVER_JOINED, dart: 'loaded' })).toThrow(/river-joined/);
    expect(() => parseRecording({ ...base, schema: REPLAY_SCHEMA_RIVER_JOINED, dart: 'none', dartFromStep: 5 })).toThrow(/river-joined/);
  });
});
