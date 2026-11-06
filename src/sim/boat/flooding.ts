import { G } from '../units';
import { compartmentAt, halfBreadthAt, summarise, type Breach, type Compartment, type Damage } from './damage';

/**
 * Water getting into a damaged hull, and what it does to her (owner, 6 Nov 2026). Each breach lets water in by
 * the orifice law, Q = Cd·A·√(2gh), on the difference between the head of the sea outside and of the water
 * already inside its compartment (so it stops when they are level, and runs out again if she rises), over the
 * part of the breach that is under water: with her heel, trim and sinkage, and averaged over the waves (a
 * breach just above the waterline takes the crests). The water's weight sinks and trims her (quasi-static:
 * waterplane and longitudinal stability), its free surface runs to the low side and makes her tender, and it
 * moves with the hull (more to drive and turn).
 *
 * Once her deck goes under she floods: the class's buoyancy (a forward tank, 158 L more forward of the mast and
 * an aft tank; C1, C16) then keeps her afloat awash, unless a tank has flooded too and what is left cannot
 * carry her and her crew, when she sinks. The crew bail the main hull (a bucket, as the class requires, or a
 * pump) and can stuff a hole they can reach with a sail bag. Volumes, areas and rates are estimates (E) except
 * the 158 L (V) and the keel's mass (S); the discharge coefficient is the naval-engineering value for openings
 * in a hull (0.61–0.64, S).
 */
export const FLOOD = {
  /** Discharge coefficient of an opening in the hull (contraction × velocity coefficient). */
  cd: 0.62,
  rho: 1025,
  /** Longitudinal metacentric height (m): trim from a moment. */
  gmL: 13,
  /** Each compartment: centre (x), floor height (z above the design waterline), plan area at the floor, capacity (kg). */
  compartments: {
    fore: { x: 2.25, floorZ: -0.2, area: 0.45, capacity: 300 },
    main: { x: -0.3, floorZ: -0.35, area: 4.0, capacity: 2200 },
    aft: { x: -2.5, floorZ: -0.15, area: 0.5, capacity: 200 },
  } as Record<Compartment, { x: number; floorZ: number; area: number; capacity: number }>,
  /** Buoyancy that never floods (L): the class's extra flotation forward of the mast (V), the structure (E), the keel (S: 375 kg of cast iron at 7.2 t/m³). */
  flotationL: 158,
  structureL: 160,
  keelL: 52,
  /** The sealed tanks lie under the deck: they float her once the deck is within this of the water (m). */
  tankDepth: 0.3,
  /** Deck edge above the design waterline (m) at the bow, forward of the mast, aft and at the transom (the renderer's sheer). */
  sheer: [
    [2.85, 0.74],
    [0.5, 0.6],
    [-1.8, 0.54],
    [-2.9, 0.59],
  ] as [number, number][],
  /** The cockpit's edge, its length each side, and the weir coefficient for water over a drowned deck. */
  cockpitEdgeZ: 0.58,
  deckWeirLength: 4.5,
  weirC: 1.8,
  /** The self-draining cockpit's transom outlets: their height above the waterline (m), x, and area (m², as the cockpit's). */
  drainZ: 0.28,
  drainX: -2.8,
  /** Crew bailing the main hull: a bucket once there is enough to scoop, else a pump (kg/s). */
  bucketKgS: 1.2,
  pumpKgS: 0.4,
  bailStartKg: 5,
  bucketFromKg: 40,
  /** Stuffing a hole the crew can reach: how long it takes, and the share of the flow it stops. */
  plugTime: 20,
  plugShare: 0.8,
  /** Relative wave amplitude at a breach, as a share of the significant wave height (the hull rides the waves too). */
  waveShare: 0.35,
  /** Sinking: how fast she goes down (m/s) once nothing can carry her, and trim towards the end that lost its buoyancy. */
  sinkRate: 0.35,
  sinkTrim: 0.45,
  /** Awash: the drag of a drowned hull and deck (Cd·A, m²). */
  awashCdA: 1.4,
  /** A fallen rig in the water: drag (Cd·A, m²), how far out it lies (m), and its weight's list (N m). */
  wreckCdA: 1.3,
  wreckArmY: 1.6,
  wreckAftX: -2.7,
  wreckListNm: 450,
  /** Main hull water as a slab for its free surface: width and length (m), the floor below the centre of gravity (m). */
  slabWidth: 1.3,
  slabLength: 3.2,
  floorBelowCG: 0.15,
};

const TANK_L = { fore: FLOOD.compartments.fore.capacity, aft: FLOOD.compartments.aft.capacity };

/** Deck edge height above the design waterline (m) at x, from the sheer points. */
export function sheerZ(x: number): number {
  const pts = FLOOD.sheer;
  if (x >= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, z1] = pts[i]!;
    const [x0, z0] = pts[i - 1]!;
    if (x >= x1) return z1 + ((z0 - z1) * (x - x1)) / (x0 - x1);
  }
  return pts[pts.length - 1]![1];
}

/** Height of a hull point above the mean sea surface (m) with her heel, trim and sinkage (heel > 0: starboard down). */
export function pointAboveSea(x: number, y: number, z: number, phi: number, d: Pick<Damage, 'sinkage' | 'trim'>): number {
  return z * Math.cos(phi) - y * Math.sin(phi) - x * Math.sin(d.trim) - d.sinkage;
}

/** Height of a compartment's inside water surface above the mean sea surface (m). */
function insideLevel(c: Compartment, kg: number, d: Pick<Damage, 'sinkage' | 'trim'>): number {
  const k = FLOOD.compartments[c];
  if (kg <= 0) return -Infinity;
  const top = sheerZ(k.x);
  return Math.min(top, k.floorZ + kg / (FLOOD.rho * k.area)) - k.x * Math.sin(d.trim) - d.sinkage;
}

/** Share of a vertical opening from `bot` to `top` that is below a level, and that part's centroid height. */
function below(bot: number, top: number, level: number): { frac: number; zc: number } {
  if (level <= bot) return { frac: 0, zc: bot };
  const up = Math.min(top, level);
  return { frac: top > bot ? (up - bot) / (top - bot) : 1, zc: (bot + up) / 2 };
}

const WAVE_PHASES = Array.from({ length: 8 }, (_, k) => Math.sin((2 * Math.PI * (k + 0.5)) / 8));

/**
 * Flow through a breach (kg/s, > 0 in): the sea's head over the submerged part against the inside water's, by
 * the orifice law, averaged over the waves (relative amplitude `wave`, m).
 */
export function breachFlow(b: Breach, d: Pick<Damage, 'sinkage' | 'trim' | 'water'>, phi: number, wave: number): number {
  const top = pointAboveSea(b.x, b.y, b.zTop, phi, d);
  const bot = pointAboveSea(b.x, b.y, b.zBot, phi, d);
  const lo = Math.min(top, bot);
  const hi = Math.max(top, bot);
  const zin = insideLevel(b.compartment, d.water[b.compartment], d);
  const k = FLOOD.cd * b.area * (1 - b.plugged) * FLOOD.rho * Math.sqrt(2 * G);
  const inside = below(lo, hi, zin);
  const inHead = inside.frac > 0 ? Math.max(0, zin - inside.zc) : 0;
  const out = inside.frac * Math.sqrt(inHead);
  const phases = wave > 0.02 ? WAVE_PHASES : [0];
  let q = 0;
  for (const s of phases) {
    const eta = wave * s;
    const o = below(lo, hi, eta);
    q += o.frac > 0 ? o.frac * Math.sqrt(Math.max(0, eta - o.zc)) : 0;
  }
  return k * (q / phases.length - out);
}

export interface FloodContext {
  /** Heel (rad, > 0 starboard down). */
  phi: number;
  /** Significant wave height at the boat (m). */
  hs: number;
  /** The boat with her crew (kg), and the water in the cockpit (kg, the cockpit model's). */
  mass: number;
  cockpitWater: number;
  /** Depth of water under the boat (m, surface to bed); Infinity when unknown. */
  depth: number;
  /** Draft (m). */
  draft: number;
  /** The crew bail (they do unless the boat is awash or sunk). */
  bail: boolean;
  /** A self-draining cockpit (its outlets are in the transom). */
  selfDraining: boolean;
}

/** What the step did besides the hull's water: extra water into the cockpit (kg/s, the drains backflowing, a drowned deck). */
export interface FloodResult {
  cockpitInflow: number;
}

/** Buoyancy (kg) that can still carry her once the hull has flooded: what never floods, and the tanks not flooded. */
export function reserveBuoyancy(d: Pick<Damage, 'water' | 'breaches'>): number {
  const tank = (c: 'fore' | 'aft') => (d.breaches.some((b) => b.compartment === c && b.plugged < 1) ? Math.max(0, TANK_L[c] - d.water[c]) : TANK_L[c]);
  return FLOOD.flotationL + FLOOD.structureL + FLOOD.keelL + tank('fore') + tank('aft');
}

/**
 * One step of the water in the hull (in place): the breaches, a drowned deck, the crew bailing and plugging;
 * then her sinkage, trim and state. Returns the extra inflow to the cockpit.
 */
export function stepFlooding(d: Damage, k: FloodContext, dt: number): FloodResult {
  const res: FloodResult = { cockpitInflow: 0 };
  if (d.state === 'sunk') return res;
  const wave = FLOOD.waveShare * Math.max(0, k.hs);
  const comp = FLOOD.compartments;

  // The breaches.
  const dw: Record<Compartment, number> = { fore: 0, main: 0, aft: 0 };
  for (const b of d.breaches) dw[b.compartment] += breachFlow(b, d, k.phi, wave);

  // A drowned deck: water pours over the cockpit's edge into the cockpit (and, the cockpit full, below).
  const edge = Math.min(pointAboveSea(-0.5, 0.53, FLOOD.cockpitEdgeZ, k.phi, d), pointAboveSea(-0.5, -0.53, FLOOD.cockpitEdgeZ, k.phi, d));
  if (edge < 0) {
    const q = FLOOD.rho * FLOOD.weirC * FLOOD.deckWeirLength * Math.pow(-edge, 1.5);
    res.cockpitInflow += q;
    if (k.cockpitWater >= 590) dw.main += q;
  }
  // The self-draining cockpit's outlets under water run backwards.
  if (k.selfDraining) {
    const drain = pointAboveSea(FLOOD.drainX, 0, FLOOD.drainZ, k.phi, d);
    if (drain < 0) res.cockpitInflow += FLOOD.rho * 0.61 * 0.03 * Math.sqrt(2 * G * -drain);
  }

  // The crew bail the main hull while they can.
  d.bailing = k.bail && d.state !== 'awash' && d.state !== 'sinking' && d.water.main > FLOOD.bailStartKg;
  if (d.bailing) dw.main -= d.water.main > FLOOD.bucketFromKg ? FLOOD.bucketKgS : FLOOD.pumpKgS;

  for (const c of ['fore', 'main', 'aft'] as const) d.water[c] = Math.min(comp[c].capacity, Math.max(0, d.water[c] + dw[c] * dt));

  // Plugging: the worst breach they can reach (in the main hull) is stopped over `plugTime`.
  if (d.plugging > 0) {
    d.plugging = Math.max(0, d.plugging - dt);
    if (d.plugging === 0) {
      const b = worstReachable(d);
      if (b) {
        b.plugged = Math.max(b.plugged, FLOOD.plugShare);
        d.version += 1;
      }
    }
  }

  equilibrium(d, k, dt);
  summarise(d);
  return res;
}

/** The open breach the crew can reach (inside the main hull) that lets in the most. */
export function worstReachable(d: Damage): Breach | undefined {
  let best: Breach | undefined;
  for (const b of d.breaches) if (b.compartment === 'main' && b.plugged < FLOOD.plugShare && (!best || b.area * (1 - b.plugged) > best.area * (1 - best.plugged))) best = b;
  return best;
}

/** Start stuffing a hole (the crew's action): true if there is one they can reach. */
export function startPlugging(d: Damage): boolean {
  if (d.plugging > 0 || d.state === 'sunk' || !worstReachable(d)) return false;
  d.plugging = FLOOD.plugTime;
  return true;
}

/** Sinkage, trim and state from the water inside (in place). */
function equilibrium(d: Damage, k: FloodContext, dt: number): void {
  const comp = FLOOD.compartments;
  const inside = d.water.fore + d.water.main + d.water.aft;
  const extra = inside + k.cockpitWater;
  const displacement = k.mass + extra;
  const moment = d.water.fore * comp.fore.x + d.water.main * comp.main.x + d.water.aft * comp.aft.x + k.cockpitWater * -1.0;
  // While the deck is clear: sinkage over the waterplane (her own, about 4.8 m²) and trim over GM_L.
  const linS = extra / (FLOOD.rho * 4.8);
  const linTrim = moment / (displacement * FLOOD.gmL);
  const swamped = d.water.main >= comp.main.capacity * 0.97;
  if (d.state === 'sinking' || d.state === 'sunk') {
    d.sinkage += FLOOD.sinkRate * dt;
    const towards = d.water.fore > d.water.aft ? 1 : -1;
    d.trim += (towards * FLOOD.sinkTrim - d.trim) * Math.min(1, 0.3 * dt);
    const bottom = Number.isFinite(k.depth) ? Math.max(0.5, k.depth - k.draft) : 6;
    if (d.sinkage >= bottom) {
      d.sinkage = bottom;
      d.state = 'sunk';
    }
    return;
  }
  if (swamped || d.state === 'awash') {
    const reserve = reserveBuoyancy(d);
    if (reserve < k.mass) {
      d.state = 'sinking';
      return;
    }
    d.state = 'awash';
    d.water.main = comp.main.capacity;
    // The tanks under the deck take her weight: the deck sits a little under the water, lower the less is left.
    const tanks = Math.max(1, reserve - FLOOD.structureL - FLOOD.keelL);
    const share = Math.min(1, Math.max(0, (k.mass - FLOOD.structureL - FLOOD.keelL) / tanks));
    const target = sheerZ(0) - FLOOD.tankDepth + FLOOD.tankDepth * share + 0.05;
    d.sinkage += (target - d.sinkage) * Math.min(1, 0.5 * dt);
    const foreLost = d.water.fore > 0.5 * comp.fore.capacity;
    const aftLost = d.water.aft > 0.5 * comp.aft.capacity;
    const trimTarget = foreLost && !aftLost ? 0.18 : aftLost && !foreLost ? -0.12 : 0;
    d.trim += (trimTarget - d.trim) * Math.min(1, 0.5 * dt);
    return;
  }
  d.sinkage = linS;
  d.trim = linTrim;
  d.state = extra > 20 || inside > 5 ? 'low' : 'afloat';
}

/** Water depth over the floor of the main hull's slab (m). */
function slabDepth(kg: number): number {
  return kg / (FLOOD.rho * FLOOD.slabWidth * FLOOD.slabLength);
}

/**
 * Heeling moment (N m, same sign as the heel) of the water in the main hull about the dry boat's centre of
 * gravity: it lies low (stiffening her a little) but runs to the low side (its free surface: the larger loss).
 */
export function floodHeelMoment(d: Damage, phi: number): number {
  const w = d.water.main;
  if (w <= 0) return 0;
  const b = FLOOD.slabWidth;
  const h = slabDepth(w);
  const t = Math.abs(Math.tan(Math.max(-1.4, Math.min(1.4, phi))));
  let off = 0;
  if (t > 1e-9) off = Math.sign(phi) * Math.min(b / 2, t * b < 2 * h ? (b * b * t) / (12 * h) : b / 2 - Math.sqrt((2 * h * b) / t) / 3);
  const zRel = -FLOOD.floorBelowCG + h / 2;
  return w * G * (off * Math.cos(phi) + zRel * Math.sin(phi));
}

/** Forces on her from a fallen rig in the water and a drowned hull (body frame: x forward, y to starboard; N, N m). */
export function wreckForces(d: Damage, u: number, v: number, r: number, rho: number): { x: number; y: number; n: number; roll: number } {
  const out = { x: 0, y: 0, n: 0, roll: 0 };
  const drag = (px: number, py: number, cdA: number) => {
    const vx = u - r * py;
    const vy = v + r * px;
    const sp = Math.hypot(vx, vy);
    const fx = -0.5 * rho * cdA * sp * vx;
    const fy = -0.5 * rho * cdA * sp * vy;
    out.x += fx;
    out.y += fy;
    out.n += px * fy - py * fx;
  };
  const down = d.rigParts.down;
  if (down === 'port' || down === 'stbd') {
    const side = down === 'stbd' ? 1 : -1;
    drag(0.2, side * FLOOD.wreckArmY, FLOOD.wreckCdA);
    out.roll += side * FLOOD.wreckListNm;
  } else if (down === 'aft') drag(FLOOD.wreckAftX, 0, FLOOD.wreckCdA * 0.6);
  if (d.state === 'awash' || d.state === 'sinking') drag(0, 0, FLOOD.awashCdA);
  return out;
}

/** Litres a minute coming in now through the breaches (for the crew's report; > 0 in). */
export function leakRate(d: Damage, phi: number, hs: number): number {
  let q = 0;
  for (const b of d.breaches) q += Math.max(0, breachFlow(b, d, phi, FLOOD.waveShare * hs));
  return (q / FLOOD.rho) * 1000 * 60;
}

/** Freeboard left at her lowest deck edge (m; < 0 the deck is under). */
export function freeboard(d: Pick<Damage, 'sinkage' | 'trim'>, phi: number): number {
  let lo = Infinity;
  for (const [x] of FLOOD.sheer) {
    const y = halfBreadthAt(x, sheerZ(x));
    lo = Math.min(lo, pointAboveSea(x, y, sheerZ(x), phi, d), pointAboveSea(x, -y, sheerZ(x), phi, d));
  }
  return lo;
}

/** What the crew can tell about the water: coming in, going out, freeboard, and each breach's flow (L/min). */
export interface DamageReport {
  inflowLpm: number;
  bailLpm: number;
  freeboard: number;
  breaches: { flowLpm: number; below: boolean }[];
}

export function damageReport(d: Damage, phi: number, hs: number): DamageReport {
  const wave = FLOOD.waveShare * hs;
  // Awash or worse, the hull is full: nothing more comes in.
  const full = d.state === 'awash' || d.state === 'sinking' || d.state === 'sunk';
  const breaches = d.breaches.map((b) => ({
    flowLpm: full ? 0 : (Math.max(0, breachFlow(b, d, phi, wave)) / FLOOD.rho) * 60000,
    below: pointAboveSea(b.x, b.y, b.zBot, phi, d) < 0,
  }));
  const bail = d.bailing ? (d.water.main > FLOOD.bucketFromKg ? FLOOD.bucketKgS : FLOOD.pumpKgS) : 0;
  return { inflowLpm: breaches.reduce((a, b) => a + b.flowLpm, 0), bailLpm: (bail / FLOOD.rho) * 60000, freeboard: freeboard(d, phi), breaches };
}

export { compartmentAt };
