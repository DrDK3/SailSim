/**
 * One cue pipeline (juniors round, Workstream 2). Once a frame, a small typed cue state is derived from the simulation
 * snapshots the renderer already interpolates between (and a few read-only queries of the environment). Water, sails,
 * spray, sound, camera and vibration read it; nothing derives its own version of a simulation value, and nothing is
 * invented for effect: every field is a simulation value, or a fixed function of one, and is zero when the simulation
 * value is zero.
 *
 * Presentation only. Nothing here is fed back to the simulation.
 *
 * Every event that vibrates or sounds also has a picture (CUE_CHANNELS below lists the pairs, and the tests check it).
 */
import type { BoatSnapshot } from '../sim/simulation';
import type { Puff } from '../sim/env/wind';
import { smoothstep } from '../sim/math/angles';

export interface CuePuff {
  n: number;
  e: number;
  radius: number;
  /** Extra wind in the puff's core as a share of the mean, times its life envelope: exactly what the wind model adds. */
  strength: number;
}

export interface SailCue {
  /** 0 = flogging … 1 = drawing (the physics' luff factor). */
  luff: number;
  /** 0 attached … 1 fully stalled (the physics' stall factor). */
  stall: number;
  /** 1 − luff: how hard the sail flogs. */
  flog: number;
}

export type Manoeuvre = 'none' | 'tack' | 'gybe';

export interface CueState {
  /** Simulation time of the newer snapshot (s). */
  t: number;
  /** Every live puff, with the wind model's own life envelope (not a renderer's guess). */
  puffs: CuePuff[];
  wind: {
    /** True wind over the water at the boat (m/s, FROM rad) and over the ground. */
    tws: number;
    twd: number;
    twsGround: number;
    twdGround: number;
    /** Apparent wind at the boat (m/s; rad, > 0 from starboard). */
    aws: number;
    awa: number;
    /** Gust at the boat: wind speed relative to the mean here, minus 1 (0 = mean, 0.3 = 30% over). */
    gust: number;
  };
  main: SailCue;
  jib: SailCue;
  /** Heel (rad, > 0 to starboard) and its rate (rad/s). */
  heel: number;
  heelRate: number;
  /** Speed through the water and over the ground (m/s). */
  stw: number;
  sog: number;
  /** Rudder angle (rad) and its load 0…1 (side force over RUDDER_LOAD_REF_N). */
  rudder: number;
  rudderLoad: number;
  /** Wave height at the boat (m, the sea-state model's significant height; 0 without one). */
  waveHeight: number;
  /** The bow's vertical speed onto the water (m/s, < 0 falling): the visual ride over the modelled waves. */
  bowDrop: number;
  /** Spray thrown per second at this speed and bow drop (0 in calm water or at low speed). */
  sprayRate: number;
  events: {
    /** The mainsail changed side in this frame (a tack or a gybe). */
    boom: boolean;
    /** A gust arrived at the boat in this frame: its size 0…1 (0 = none). */
    gustOnset: number;
    /** Contact with another boat or object (bottom contact counts as grounding): 0 none … 1 hard. */
    contact: number;
    grounding: number;
  };
  /** A tack or gybe in progress (the 3 s after the boom crossed), and how far through (0…1). */
  manoeuvre: Manoeuvre;
  manoeuvreProgress: number;
}

/** Rudder side force that counts as full load (N, E: the model gives about 790 N for the helm hard over at 2.4 m/s in 14 kn). */
export const RUDDER_LOAD_REF_N = 800;
/** A gust "arrives" when the speed at the boat rises this far over its recent low (share of the mean, E). */
export const GUST_ONSET_RISE = 0.12;
/** Seconds of history for the recent low, and the shortest time between two gust events (E). */
export const GUST_WINDOW_S = 6;
export const GUST_HOLD_S = 4;
export const MANOEUVRE_S = 3;

/** The wind model's life envelope (src/sim/env/wind.ts WindField.sample), used only if a puff has not cached it. */
export function puffEnvelope(p: Pick<Puff, 'age' | 'life' | 'env'>): number {
  return p.env ?? smoothstep(0, 0.2 * p.life, p.age) * (1 - smoothstep(0.7 * p.life, p.life, p.age));
}

/** Spray rate (particles a second) from speed and bow drop: the renderer's own rule (src/render/boatWater.ts BowSpray). */
export function sprayRate(stw: number, bowDrop: number): number {
  return 900 * Math.max(0, -bowDrop - 0.45) * smoothstep(1.6, 3.2, stw);
}

/** What the cue state remembers between frames (gust history, the last boom crossing, events already shown). */
export class CueMemory {
  gustLow: { t: number; g: number }[] = [];
  lastGustEvent = -Infinity;
  lastBoomT = -1;
  lastMainSide = 0;
  manoeuvre: Manoeuvre = 'none';
  manoeuvreAt = -Infinity;
  lastContactT = -1;
  lastGroundT = -1;
  /** |TWA| a little before the crossing (to tell a tack from a gybe): kept over the last second. */
  twaHistory: { t: number; twa: number }[] = [];
  reset(): void {
    this.gustLow = [];
    this.lastGustEvent = -Infinity;
    this.lastBoomT = -1;
    this.lastMainSide = 0;
    this.manoeuvre = 'none';
    this.manoeuvreAt = -Infinity;
    this.lastContactT = this.lastGroundT = -1;
    this.twaHistory = [];
  }
}

export interface CueInputs {
  puffs: readonly Puff[];
  /** The wind model's gust factor at the boat (speed / mean), or 1 without gusts. */
  gustFactor: number;
  waveHeight: number;
  bowDrop: number;
  /** Contact and grounding events since the last frame, with their sizes 0…1 (the controller reads them from the fleet and the boat). */
  contact?: number;
  grounding?: number;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const sail = (luff: number, stall: number): SailCue => ({ luff, stall, flog: 1 - luff });

/** The cue state for this frame. `alpha` interpolates as the renderer does (0 = prev, 1 = curr). */
export function deriveCues(prev: BoatSnapshot, curr: BoatSnapshot, alpha: number, inp: CueInputs, mem: CueMemory, out?: CueState): CueState {
  const t = curr.t;
  if (t < (mem.twaHistory.at(-1)?.t ?? -Infinity)) mem.reset(); // a restart
  // Puffs: every live one, with the model's own envelope.
  const puffs = out?.puffs ?? [];
  puffs.length = 0;
  for (const p of inp.puffs) {
    const s = p.strength * puffEnvelope(p);
    if (s > 0) puffs.push({ n: p.n, e: p.e, radius: p.radius, strength: s });
  }
  // Gust onset: the speed at the boat rising GUST_ONSET_RISE over its low of the last few seconds.
  const g = inp.gustFactor;
  mem.gustLow.push({ t, g });
  while (mem.gustLow.length && mem.gustLow[0]!.t < t - GUST_WINDOW_S) mem.gustLow.shift();
  let low = g;
  for (const x of mem.gustLow) low = Math.min(low, x.g);
  const rise = g - low;
  let gustOnset = 0;
  if (rise > GUST_ONSET_RISE && t - mem.lastGustEvent > GUST_HOLD_S) {
    gustOnset = Math.min(1, rise / 0.4);
    mem.lastGustEvent = t;
  }
  // Tack or gybe: the boom crossing, told apart by the true wind angle a second before.
  mem.twaHistory.push({ t, twa: Math.abs(curr.twa) });
  while (mem.twaHistory.length > 1 && mem.twaHistory[0]!.t < t - 1.5) mem.twaHistory.shift();
  // The boom crossing: the mainsail changing side (as the physics reports it), or the boom's impact at the end of a
  // fast swing, whichever is first.
  const boomT = curr.lastBoomEvent?.t ?? -1;
  const sideFlip = mem.lastMainSide !== 0 && curr.mainSide !== mem.lastMainSide;
  mem.lastMainSide = curr.mainSide;
  const boom = sideFlip || (boomT > mem.lastBoomT && t - mem.manoeuvreAt > 1);
  if (boom) {
    const before = mem.twaHistory[0]?.twa ?? Math.abs(curr.twa);
    mem.manoeuvre = before < Math.PI / 2 ? 'tack' : 'gybe';
    mem.manoeuvreAt = t;
  }
  mem.lastBoomT = Math.max(mem.lastBoomT, boomT);
  if (t - mem.manoeuvreAt > MANOEUVRE_S) mem.manoeuvre = 'none';
  const f = curr.forces;
  const bowDrop = inp.bowDrop;
  const stw = lerp(prev.stw, curr.stw, alpha);
  const o: CueState = out ?? ({} as CueState);
  o.t = t;
  o.puffs = puffs;
  o.wind = {
    tws: curr.tws, twd: curr.twd, twsGround: curr.twsGround, twdGround: curr.twdGround,
    aws: lerp(prev.aws, curr.aws, alpha), awa: curr.awa, gust: Math.max(0, g - 1),
  };
  o.main = sail(f.main.luff, f.main.stall);
  o.jib = sail(f.jib.luff, f.jib.stall);
  o.heel = lerp(prev.heel, curr.heel, alpha);
  o.heelRate = curr.rollRate;
  o.stw = stw;
  o.sog = lerp(prev.sog, curr.sog, alpha);
  o.rudder = curr.rudder;
  o.rudderLoad = Math.min(1, Math.abs(f.rudder.y) / RUDDER_LOAD_REF_N);
  o.waveHeight = inp.waveHeight;
  o.bowDrop = bowDrop;
  o.sprayRate = sprayRate(stw, bowDrop);
  o.events = { boom, gustOnset, contact: inp.contact ?? 0, grounding: inp.grounding ?? 0 };
  o.manoeuvre = mem.manoeuvre;
  o.manoeuvreProgress = mem.manoeuvre === 'none' ? 0 : Math.min(1, (t - mem.manoeuvreAt) / MANOEUVRE_S);
  return o;
}

/**
 * The puffs the water shader draws (it has room for `slots`): the nearest by the distance from the boat to each
 * puff's edge, so a puff the boat is in or about to enter is never the one left out. Returns how many were left out,
 * all of them further away than every one kept. Reuses `into`.
 */
export function selectPuffsForShader(puffs: readonly CuePuff[], n: number, e: number, slots: number, into: CuePuff[]): number {
  into.length = 0;
  if (puffs.length <= slots) {
    for (const p of puffs) into.push(p);
    return 0;
  }
  const ranked = puffs.map((p) => ({ p, d: Math.hypot(p.n - n, p.e - e) - p.radius })).sort((a, b) => a.d - b.d);
  for (let i = 0; i < slots; i++) into.push(ranked[i]!.p);
  return puffs.length - slots;
}

/**
 * Every cue and the channels it reaches the player by (picture, sound, vibration, text). The rule (tested): nothing
 * is carried by sound or vibration alone, and every sound has a picture.
 */
export const CUE_CHANNELS: Record<string, ('picture' | 'sound' | 'vibration' | 'text')[]> = {
  'gust on the water': ['picture'],
  'gust arriving at the boat': ['picture', 'sound', 'vibration'],
  'apparent wind': ['picture', 'sound', 'text'],
  'sail luffing / flogging': ['picture', 'sound', 'text'],
  'sail stalled': ['picture', 'text'],
  'heel': ['picture', 'text'],
  'speed through the water': ['picture', 'sound', 'text'],
  'tack or gybe (boom across)': ['picture', 'sound', 'vibration'],
  'contact': ['picture', 'sound', 'vibration', 'text'],
  'grounding': ['picture', 'sound', 'vibration', 'text'],
  'bow slamming / spray': ['picture', 'sound'],
  'rudder load': ['picture', 'vibration'],
};

/**
 * The camera's feel from the cue state: a target that jumps on an event (by its size) and eases back to nothing.
 * `motion` is the camera-motion setting (0 with reduced motion). Returns the extra distance back and the dip (m).
 */
export function cameraFeel(feel: { gust: number; boom: number }, cues: CueState | undefined, dt: number, motion: number): { back: number; drop: number } {
  if (cues && motion > 0) {
    if (cues.events.gustOnset > 0) feel.gust = Math.max(feel.gust, cues.events.gustOnset);
    if (cues.events.boom) feel.boom = 1;
  }
  feel.gust *= Math.exp(-dt / 1.5);
  feel.boom *= Math.exp(-dt / 0.35);
  if (motion <= 0) feel.gust = feel.boom = 0;
  // A smooth rise rather than a jump: sin of the remaining share.
  return { back: 1.2 * motion * Math.sin(Math.PI * Math.min(1, feel.gust)) * feel.gust, drop: 0.25 * motion * feel.boom };
}
