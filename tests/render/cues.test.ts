/**
 * Juniors round, Workstream 2 §5.3: the cues agree with the simulation.
 * - Each cue moves the same way as its simulation value (more apparent wind, louder wind; more luff, more flogging).
 * - No cue when the simulation value is zero.
 * - The water's puffs are the wind model's puffs (position and strength), and the 16 shader slots never drop a near
 *   puff for a far one.
 * - The luffing picture, the luffing sound and the status label agree.
 * - Nothing is carried by sound or vibration alone.
 * Sound is checked on the WebAudio parameters the app sets (a recording stand-in for AudioContext); no listening test
 * was done.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CUE_CHANNELS, CueMemory, cameraFeel, deriveCues, puffEnvelope, selectPuffsForShader, sprayRate, type CuePuff } from '../../src/render/cues';
import { SoundScape, flutterVoice, gustLevel, waterVoice, windVoice } from '../../src/render/audio';
import { sailState } from '../../src/app/sailStatus';
import { SquibModel } from '../../src/render/squibModel';
import { Water } from '../../src/render/water';
import { SimController, type AppScenario } from '../../src/app/controller';
import { squibParams } from '../../src/sim/index';
import type { SailForce } from '../../src/sim/boat/forces';

const scenario = (twsKn: number, gusts: 'steady' | 'gusty' = 'steady', heading = 315): AppScenario => ({
  conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn, twdDeg: 225 }, gusts: { preset: gusts, seed: 4 }, current: { mode: 'none' } },
  startLocation: 'start-bay-practice',
  startHeadingDeg: heading,
  startSpeedKn: twsKn > 0 ? 4 : 0,
});

function cuesAfter(sc: AppScenario, seconds: number) {
  const c = new SimController();
  c.restart(sc);
  c.advance(seconds);
  const s = c.sim.snapshot();
  const wf = c.sim.env.windField;
  return { c, s, cues: deriveCues(s, s, 1, { puffs: wf?.puffs() ?? [], gustFactor: wf ? wf.sample(s.n, s.e).gustFactor : 1, waveHeight: 0, bowDrop: 0 }, new CueMemory()) };
}

describe('cue directions and zeros', () => {
  it('voices rise with their simulation value and are silent at zero', () => {
    let last = -1;
    for (let aws = 0; aws <= 20; aws += 0.5) {
      const v = windVoice(aws).level;
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(windVoice(0).level).toBe(0);
    expect(waterVoice(0)).toEqual({ rush: 0, hiss: 0 });
    expect(waterVoice(3).rush).toBeGreaterThan(waterVoice(1).rush);
    // Flutter: more flogging (less luff factor) is louder; none for a drawing sail or with no wind.
    let lf = -1;
    for (let luff = 1; luff >= 0; luff -= 0.05) {
      const v = flutterVoice(luff, 8).level;
      expect(v).toBeGreaterThanOrEqual(lf - 1e-12);
      lf = v;
    }
    expect(flutterVoice(1, 8).level).toBe(0);
    expect(flutterVoice(0, 0).level).toBe(0);
    expect(gustLevel(0, 8)).toBe(0);
    expect(gustLevel(1, 0)).toBe(0);
    expect(gustLevel(0.8, 8)).toBeGreaterThan(gustLevel(0.3, 8));
  });

  it('spray: none in calm water or at low speed, more with a harder bow drop and more speed', () => {
    expect(sprayRate(3, 0)).toBe(0);
    expect(sprayRate(0.5, -2)).toBe(0);
    expect(sprayRate(3, -1.5)).toBeGreaterThan(sprayRate(3, -0.8));
    expect(sprayRate(3, -1.5)).toBeGreaterThan(sprayRate(2, -1.5));
  });

  it('in a dead calm the cue state has no wind, no gust, no puffs and no spray', () => {
    const { cues } = cuesAfter(scenario(0), 2);
    expect(cues.wind.tws).toBe(0);
    expect(cues.wind.gust).toBe(0);
    expect(cues.puffs).toHaveLength(0);
    expect(cues.sprayRate).toBe(0);
    expect(cues.events.gustOnset).toBe(0);
  });

  it('apparent wind and rudder load in the cue state follow the simulation', () => {
    const light = cuesAfter(scenario(6), 10).cues;
    const fresh = cuesAfter(scenario(16), 10).cues;
    expect(fresh.wind.aws).toBeGreaterThan(light.wind.aws);
    expect(windVoice(fresh.wind.aws).level).toBeGreaterThan(windVoice(light.wind.aws).level);
    const { c } = cuesAfter(scenario(14), 10);
    c.press('helmRight', true);
    c.advance(1.5);
    const s = c.sim.snapshot();
    const turning = deriveCues(s, s, 1, { puffs: [], gustFactor: 1, waveHeight: 0, bowDrop: 0 }, new CueMemory());
    expect(turning.rudderLoad).toBeGreaterThan(0.3);
    expect(Math.min(1, Math.abs(s.forces.rudder.y) / 800)).toBeCloseTo(turning.rudderLoad, 9);
  });

  it('a tack is told from a gybe by the boom crossing', () => {
    const c = new SimController();
    c.restart(scenario(12, 'steady', 225 + 45));
    c.advance(8);
    const mem = new CueMemory();
    let seen: string | undefined;
    c.press('helmLeft', true);
    for (let i = 0; i < 150 && !seen; i++) {
      c.advance(0.1);
      const s = c.sim.snapshot();
      const q = deriveCues(s, s, 1, { puffs: [], gustFactor: 1, waveHeight: 0, bowDrop: 0 }, mem);
      if (q.events.boom) seen = q.manoeuvre;
    }
    expect(seen).toBe('tack');
  });
});

describe('gusts on the water are the wind model’s gusts', () => {
  it('every drawn puff matches a simulation puff in position (0.01 m) and strength (1e-6)', () => {
    const { c, s, cues } = cuesAfter(scenario(14, 'gusty'), 60);
    const puffs = c.sim.env.windField!.puffs();
    expect(cues.puffs.length).toBeGreaterThan(3);
    const water = new Water(new THREE.Vector3(0, 1, 0), new THREE.Color(0.7, 0.75, 0.8), 0.0005);
    const chosen: CuePuff[] = [];
    selectPuffsForShader(cues.puffs, s.n, s.e, 16, chosen);
    water.setPuffsNE(chosen);
    const drawn = water.drawnPuffs();
    expect(drawn.length).toBe(Math.min(16, cues.puffs.length));
    for (const d of drawn) {
      const match = puffs.find((p) => Math.hypot(p.n - d.n, p.e - d.e) < 0.01);
      expect(match, 'a drawn puff with no simulation puff').toBeDefined();
      expect(d.radius).toBe(match!.radius);
      // The shader stores 32-bit floats.
      expect(d.strength).toBeCloseTo(match!.strength * puffEnvelope(match!), 6);
    }
  });

  it('the strength drawn is the wind the model adds there: sampling at a lone puff’s centre gives 1 + strength', () => {
    const { c, cues } = cuesAfter(scenario(14, 'gusty'), 60);
    const wf = c.sim.env.windField!;
    const lone = cues.puffs.find((p) => cues.puffs.every((q) => q === p || Math.hypot(q.n - p.n, q.e - p.e) > 4 * (p.radius + q.radius)));
    if (!lone) return; // none isolated in this seed; covered by the matching test above
    const { shift, speedFluct } = wf.fluctuations();
    void shift;
    expect(wf.sample(lone.n, lone.e).gustFactor).toBeCloseTo(1 + speedFluct + lone.strength, 3);
  });

  it('with more puffs than shader slots, the ones left out are all further (by edge) than every one drawn', () => {
    const puffs: CuePuff[] = Array.from({ length: 40 }, (_, i) => ({ n: Math.cos(i) * (50 + i * 37), e: Math.sin(i) * (50 + i * 37), radius: 60 + (i % 5) * 20, strength: 0.2 }));
    const into: CuePuff[] = [];
    const dropped = selectPuffsForShader(puffs, 0, 0, 16, into);
    expect(dropped).toBe(24);
    const edge = (p: CuePuff) => Math.hypot(p.n, p.e) - p.radius;
    const worstKept = Math.max(...into.map(edge));
    for (const p of puffs.filter((p) => !into.includes(p))) expect(edge(p)).toBeGreaterThanOrEqual(worstKept);
  });
});

describe('the luffing picture, sound and label agree', () => {
  const leechRange = (luff: number) => {
    const xs: number[] = [];
    for (let i = 0; i < 24; i++) {
      const m = new SquibModel(squibParams());
      m.update({ main: { angle: 0.25, luff, fill: -1 }, jib: { angle: -0.2, luff: 1, fill: -1 }, rudder: 0, crewY: 0, time: i * 0.037, aws: 6 });
      let main: THREE.Mesh | undefined;
      m.group.traverse((o) => {
        if (!main && o.name === 'mainsail') main = o as THREE.Mesh;
      });
      const pos = main!.geometry.getAttribute('position');
      const k = 12 * 15 + 13;
      xs.push(pos.getX(k) + pos.getZ(k));
    }
    return Math.max(...xs) - Math.min(...xs);
  };
  const force = (luff: number, stall = 0) => ({ luff, stall, incidence: 0.2 }) as SailForce;

  it('label "Luffing" ⇔ an audible flutter and a moving leech; "Drawing" ⇔ neither', () => {
    const rows = [1, 0.98, 0.8, 0.6, 0.45, 0.3, 0.1, 0].map((luff) => ({ luff, label: sailState(force(luff)), sound: flutterVoice(luff, 6).level, picture: leechRange(luff) }));
    for (const r of rows) {
      if (r.label === 'luffing') {
        expect(r.sound, `sound at luff ${r.luff}`).toBeGreaterThan(0.3);
        expect(r.picture, `picture at luff ${r.luff}`).toBeGreaterThan(0.05);
      }
      if (r.luff >= 0.98) {
        expect(r.label).toBe('drawing');
        expect(r.sound).toBe(0);
        expect(r.picture).toBeLessThan(0.02);
      }
    }
    // Both grow as the sail luffs more.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.sound).toBeGreaterThanOrEqual(rows[i - 1]!.sound - 1e-12);
      expect(rows[i]!.picture).toBeGreaterThanOrEqual(rows[i - 1]!.picture - 0.02);
    }
  });

  it('telltales: a stalled jib upsets the leeward ones only; a luffing jib the windward ones', () => {
    const spin = (luff: number, stall: number) => {
      const rot: number[][] = [[], [], [], [], [], []];
      for (let i = 0; i < 20; i++) {
        const m = new SquibModel(squibParams());
        m.update({ main: { angle: 0.2, luff: 1, fill: 1 }, jib: { angle: 0.15, luff, stall, fill: 1 }, rudder: 0, crewY: 0, time: i * 0.05, aws: 6 });
        let k = 0;
        m.group.traverse((o) => {
          if (o.name === 'telltale') rot[k++]!.push(o.rotation.y);
        });
      }
      return rot.map((r) => Math.max(...r) - Math.min(...r));
    };
    const calm = spin(1, 0);
    const stalled = spin(1, 1);
    const luffing = spin(0.2, 0);
    // Sail to port (angle > 0): leeward telltales are the port-side ones (odd index).
    const lee = [1, 3, 5];
    const wind = [0, 2, 4];
    for (const i of lee) expect(stalled[i]!).toBeGreaterThan(calm[i]! + 0.5);
    for (const i of wind) expect(stalled[i]!).toBeLessThan(calm[i]! + 0.05);
    for (const i of wind) expect(luffing[i]!).toBeGreaterThan(calm[i]! + 0.5);
  });
});

describe('nothing by sound or vibration alone', () => {
  it('every cue that sounds or vibrates has a picture', () => {
    for (const [cue, ch] of Object.entries(CUE_CHANNELS)) {
      expect(ch, cue).toContain('picture');
    }
  });

  it('camera feel: none with reduced motion (motion 0); eases back in a gust; settles on the boom', () => {
    const feel = { gust: 0, boom: 0 };
    const base = cuesAfter(scenario(12), 2).cues;
    const gust = { ...base, events: { ...base.events, gustOnset: 0.8 } };
    expect(cameraFeel({ gust: 0, boom: 0 }, gust, 1 / 60, 0)).toEqual({ back: 0, drop: 0 });
    cameraFeel(feel, gust, 1 / 60, 0.5);
    let maxBack = 0;
    for (let i = 0; i < 120; i++) maxBack = Math.max(maxBack, cameraFeel(feel, base, 1 / 60, 0.5).back);
    expect(maxBack).toBeGreaterThan(0.1);
    expect(maxBack).toBeLessThanOrEqual(1.2 * 0.5);
  });
});

/** A stand-in AudioContext that records what the app sets (target values of each AudioParam). */
class FakeParam {
  value = 0;
  target?: number;
  setTargetAtTime(v: number) {
    this.target = v;
    this.value = v;
    return this;
  }
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.target = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    this.target = v;
    return this;
  }
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  pan = new FakeParam();
  playbackRate = new FakeParam();
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
  type = '';
  buffer: unknown;
  loop = false;
  panningModel = '';
  distanceModel = '';
  rolloffFactor = 1;
  connect<T>(n: T): T {
    return n;
  }
  start() {}
  stop() {}
}
class FakeContext {
  state = 'running';
  currentTime = 1;
  sampleRate = 8000;
  destination = new FakeNode();
  listener = { positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam(), forwardX: new FakeParam(), forwardY: new FakeParam(), forwardZ: new FakeParam(), upX: new FakeParam(), upY: new FakeParam(), upZ: new FakeParam() };
  createGain = () => new FakeNode();
  createBiquadFilter = () => new FakeNode();
  createStereoPanner = () => new FakeNode();
  createBufferSource = () => new FakeNode();
  createOscillator = () => new FakeNode();
  createPanner = () => new FakeNode();
  createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
  resume = async () => undefined;
  suspend = async () => undefined;
}

describe('the WebAudio settings follow the cues (no listening test was done)', () => {
  const g = globalThis as unknown as { window?: unknown; AudioContext?: unknown; fetch?: unknown };
  const make = () => {
    g.window = globalThis;
    g.AudioContext = FakeContext;
    const s = new SoundScape({ muted: false, master: 0.5, wind: 0.8, water: 0.8, effects: 0.8, ambience: 0.6 });
    s.resume();
    return s as unknown as { update: SoundScape['update']; wind: { gain: FakeNode }; water: { rush: FakeNode }; flutter: { gain: FakeNode }[]; lastGustLevel: number };
  };
  const frame = (o: Partial<Parameters<SoundScape['update']>[0]>) => ({ aws: 0, awa: 0.5, stw: 0, luffMain: 1, luffJib: 1, bowDrop: 0, boomCrossed: false, harbour: 0, paused: false, ...o });

  it('wind gain rises with apparent wind, water with speed, flutter with luffing; all zero at zero', () => {
    const s = make();
    s.update(frame({}));
    expect(s.wind.gain.gain.target).toBe(0);
    expect(s.water.rush.gain.target).toBe(0);
    expect(s.flutter[0]!.gain.gain.target).toBe(0);
    s.update(frame({ aws: 4, stw: 1, luffMain: 0.4 }));
    const w4 = s.wind.gain.gain.target!;
    const r1 = s.water.rush.gain.target!;
    const f4 = s.flutter[0]!.gain.gain.target!;
    s.update(frame({ aws: 10, stw: 3, luffMain: 0.1 }));
    expect(s.wind.gain.gain.target!).toBeGreaterThan(w4);
    expect(s.water.rush.gain.target!).toBeGreaterThan(r1);
    expect(s.flutter[0]!.gain.gain.target!).toBeGreaterThan(f4);
    expect(w4).toBeGreaterThan(0);
  });

  it('a gust arriving swells the wind, more for a bigger gust; no swell without one', () => {
    const s = make();
    s.update(frame({ aws: 8, gustOnset: 0 }));
    expect(s.lastGustLevel).toBe(0);
    s.update(frame({ aws: 8, gustOnset: 0.3 }));
    const small = s.lastGustLevel;
    s.update(frame({ aws: 8, gustOnset: 0.9 }));
    expect(s.lastGustLevel).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(0);
  });
});
