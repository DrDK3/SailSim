/**
 * Damage from collisions and groundings (owner, 6 Nov 2026: "from rig damage to visible hull damage, to water
 * ingress, to sinking"). An impact's energy is the kinetic energy of the closing speed along the contact
 * normal, ½·m·v² (m: the boat for a fixed object, the two boats' reduced mass when two meet), scaled for what
 * was hit (a fendered pontoon gives; a steel ferry does not). What it does depends on the energy and on where
 * it struck, at the point and height of contact:
 *  - the hull: a scuff or gouge in the gelcoat (marks only), then a crack (a slow leak), then a hole (a fast
 *    one), at the contact point. A hole above the waterline lets water in only when she heels onto it or the
 *    waves reach it (src/sim/boat/flooding.ts). In the forward or aft buoyancy tank's part of the hull it floods
 *    that tank, and the boat loses its buoyancy;
 *  - the rig: a big impact at the bow parts the forestay (the mast falls aft); a hard knock at the chainplates
 *    breaks that side's shroud, and the mast falls to leeward once that shroud is to windward and loaded;
 *    a hard grounding whips the mast forward and strains the rig;
 *  - the rudder: bent (it pulls aside and grips less), then broken off (no steering), at the stern or on the
 *    bottom;
 *  - the keel: running aground at speed opens the keel-to-hull joint (a "keel smile"): a leak at its root.
 * All thresholds, sizes and rates are estimates (E): there are no published impact tests for a Squib. The
 * flotation (forward tank, 158 L forward of the mast, aft tank) is the class rules' (C1, C16).
 */

export type ImpactRegion = 'bow' | 'side' | 'stern' | 'keel';

/** The three watertight parts of the hull: the forward and aft buoyancy tanks and the open main hull (cockpit, bilge). */
export type Compartment = 'fore' | 'main' | 'aft';

/** An opening in the hull, in the body frame: x forward of the centre of gravity, y to starboard, z above the design waterline (m). */
export interface Breach {
  x: number;
  y: number;
  /** Top and bottom of the opening (a vertical gash or crack). */
  zTop: number;
  zBot: number;
  /** Effective flow area (m², the orifice law's A). */
  area: number;
  compartment: Compartment;
  kind: 'crack' | 'hole';
  /** Share of it stopped by the crew (a sail bag or cushion stuffed in), 0 … 1. */
  plugged: number;
}

export type ScarKind = 'scuff' | 'gouge' | 'crack' | 'hole';

/** A visible mark on the hull (the renderer draws it where the hull is at x, y, z). */
export interface Scar {
  x: number;
  y: number;
  z: number;
  /** Size across (m). */
  size: number;
  kind: ScarKind;
  /** Pattern seed (each scar looks different). */
  seed: number;
}

export interface RigDamage {
  /** 0 sound … 1 parted. */
  forestay: number;
  shroudPort: number;
  shroudStbd: number;
  /** Where the mast fell ('' standing). */
  down: '' | 'aft' | 'port' | 'stbd';
}

export type FloatState = 'afloat' | 'low' | 'awash' | 'sinking' | 'sunk';

export interface Damage {
  /** Summary: the worst leak, 0 none … 1 a hole of `hullHoleMax` (for the forces and older readers). */
  hull: number;
  /** Rudder: 0 sound … 1 broken off. */
  rudder: number;
  /** Rig: share of the sails' drive lost, 0 sound … 1 down. */
  rig: number;
  /** Water inside the hull, all compartments (kg). */
  bilge: number;
  breaches: Breach[];
  scars: Scar[];
  rigParts: RigDamage;
  /** Water in each compartment (kg). */
  water: Record<Compartment, number>;
  /** Quasi-static sinkage (m, deeper > 0) and trim (rad, bow down > 0) from the water inside. */
  sinkage: number;
  trim: number;
  state: FloatState;
  /** The crew are bailing (one of them stops hiking), and plugging a hole (seconds left). */
  bailing: boolean;
  plugging: number;
  /** Bumps whenever a breach, scar or the rig changes (the renderer rebuilds then). */
  version: number;
}

export interface Impact {
  t: number;
  /** What was hit (a label for the log). */
  what: string;
  region: ImpactRegion;
  /** Closing speed (m/s) and impact energy (J). */
  speed: number;
  energy: number;
  /** What it did, in words (empty: no damage). */
  effects: string[];
}

/** Where an impact struck, in the body frame (x forward, y to starboard, z above the waterline, m), and what it was. */
export interface ImpactPoint {
  x: number;
  y: number;
  z: number;
  /** How hard the thing struck is: energy multiplier (a fendered pontoon 0.6, a steel ferry 1.2). */
  hardness?: number;
}

/** Thresholds (J), sizes and rates (E). */
export const DAMAGE = {
  /** Below this an impact leaves no mark; up to `scrapeJ` a scuff, then a gouge. */
  markJ: 120,
  scrapeJ: 300,
  /** The hull cracks beyond this (a leak of 1–7 cm²), and is holed beyond `holeJ` (30 cm² and more). */
  hullJ: 800,
  holeJ: 2500,
  crackAreaMin: 1e-4,
  crackAreaMax: 7e-4,
  holeAreaMin: 30e-4,
  holeAreaPerJ: 0.04e-4,
  /** The largest hole (m²): 400 cm² (a stove-in panel). */
  hullHoleMax: 0.04,
  /** Breaches closer than this (m) are one breach, enlarged. */
  mergeDistance: 0.45,
  rudderJ: 400,
  rudderPerJ: 1 / 3000,
  /** Grip a badly damaged rudder keeps, and the bias of its bent blade at full damage (rad). */
  rudderKeepsGrip: 0.25,
  rudderBentRad: (6 * Math.PI) / 180,
  /** The forestay (bow impacts): damage per joule beyond the threshold. */
  rigJ: 2500,
  rigPerJ: 1 / 8000,
  /** A shroud (side impacts within `chainplateReach` of the mast): damage per joule beyond the threshold. */
  shroudJ: 2000,
  shroudPerJ: 1 / 6000,
  chainplateReach: 0.8,
  /** A grounding above this energy whips the mast forward and strains the rig. */
  whipJ: 6000,
  whipPerJ: 1 / 20000,
  /** The keel joint opens beyond this grounding energy: a leak of 2–25 cm² at its root. */
  keelJ: 1500,
  keelAreaMin: 2e-4,
  keelAreaPerJ: 0.004e-4,
  keelAreaMax: 25e-4,
  /** A grounding below this speed over the ground (m/s) is gentle. */
  groundingSpeed: 0.8,
  /** A rudder torn off leaves the transom's fittings open (m², just above the waterline). */
  rudderTornArea: 5e-4,
  /** The drive a damaged (not yet failed) rig keeps loses this share per unit of stay damage. */
  rigDriveLoss: 0.5,
};

/** Hull layout for damage (E): the mast's position, the buoyancy tanks' extent, the keel root, the hull's ends. */
export const HULL = {
  /** Mast, x forward of the centre of gravity (the renderer's mast is 0.55 m forward of it). */
  mastX: 0.55,
  /** The forward tank (and the class's 158 L) lies forward of this, the aft tank aft of `aftTankX`. */
  foreTankX: 1.6,
  aftTankX: -2.15,
  /** Keel root (x) and the canoe body's bottom there (z). */
  keelRootX: 0.1,
  bottomZ: -0.35,
  bowX: 2.85,
  sternX: -2.9,
  /** Half-breadth at the deck amidships (m): half the class beam. */
  halfBeam: 0.93,
};

export const NO_DAMAGE: Readonly<Damage> = newDamage();

export function newDamage(): Damage {
  return {
    hull: 0,
    rudder: 0,
    rig: 0,
    bilge: 0,
    breaches: [],
    scars: [],
    rigParts: { forestay: 0, shroudPort: 0, shroudStbd: 0, down: '' },
    water: { fore: 0, main: 0, aft: 0 },
    sinkage: 0,
    trim: 0,
    state: 'afloat',
    bailing: false,
    plugging: 0,
    version: 0,
  };
}

/** A deep copy (snapshots and replays must not share the live arrays). */
export function cloneDamage(d: Damage): Damage {
  return {
    ...d,
    breaches: d.breaches.map((b) => ({ ...b })),
    scars: d.scars.map((s) => ({ ...s })),
    rigParts: { ...d.rigParts },
    water: { ...d.water },
  };
}

/** Impact energy (J) for a closing speed and the effective mass (kg). */
export function impactEnergy(speed: number, mass: number): number {
  return 0.5 * mass * speed * speed;
}

/** Which compartment the hull is at x (m forward of the centre of gravity). */
export function compartmentAt(x: number): Compartment {
  return x > HULL.foreTankX ? 'fore' : x < HULL.aftTankX ? 'aft' : 'main';
}

/** Half-breadth of the hull (m) at x and height z (E: a fine bow, a full stern, narrower towards the bottom). */
export function halfBreadthAt(x: number, z: number): number {
  const along = x >= 0 ? x / HULL.bowX : x / HULL.sternX;
  const plan = x >= 0 ? Math.sqrt(Math.max(0, 1 - along * along)) : 1 - 0.35 * along * along;
  const deep = Math.min(1, Math.max(0, (z - HULL.bottomZ) / (0.55 - HULL.bottomZ)));
  return HULL.halfBeam * plan * (0.35 + 0.65 * Math.sqrt(deep));
}

/** A deterministic 0…1 hash of numbers (scar patterns). */
function seedOf(...v: number[]): number {
  let h = 2166136261;
  for (const x of v) {
    h ^= Math.round(x * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function addScar(d: Damage, s: Scar): void {
  // A new mark on top of an old one at the same place replaces it if it is worse.
  const rank: Record<ScarKind, number> = { scuff: 0, gouge: 1, crack: 2, hole: 3 };
  const near = d.scars.find((o) => Math.hypot(o.x - s.x, o.y - s.y, o.z - s.z) < 0.2);
  if (near) {
    if (rank[s.kind] >= rank[near.kind]) Object.assign(near, s, { size: Math.max(near.size, s.size) });
  } else d.scars.push(s);
  d.version += 1;
}

/** Open (or enlarge) a breach at a point (in place). Returns the breach. */
function addBreach(d: Damage, at: { x: number; y: number; zTop: number; zBot: number }, area: number, kind: 'crack' | 'hole'): Breach {
  const compartment = compartmentAt(at.x);
  const near = d.breaches.find((b) => b.compartment === compartment && Math.hypot(b.x - at.x, b.y - at.y, (b.zTop + b.zBot) / 2 - (at.zTop + at.zBot) / 2) < DAMAGE.mergeDistance);
  if (near) {
    near.area = Math.min(DAMAGE.hullHoleMax, near.area + area);
    near.zTop = Math.max(near.zTop, at.zTop);
    near.zBot = Math.min(near.zBot, at.zBot);
    if (kind === 'hole') near.kind = 'hole';
    // A bigger hole pushes the plug out.
    near.plugged *= 0.5;
    d.version += 1;
    return near;
  }
  const b: Breach = { ...at, area: Math.min(DAMAGE.hullHoleMax, area), compartment, kind, plugged: 0 };
  d.breaches.push(b);
  d.version += 1;
  return b;
}

/** Where on the hull, in words: "port bow", "starboard quarter", "the keel root". */
export function placeName(x: number, y: number): string {
  const side = Math.abs(y) < 0.08 ? '' : y > 0 ? 'starboard ' : 'port ';
  const part = x > 1.6 ? 'bow' : x < -1.9 ? 'quarter' : 'side';
  return `${side}${part}`.trim() || 'stem';
}

/** Recompute the summaries (hull, rig) from the parts. */
export function summarise(d: Damage): void {
  let worst = 0;
  for (const b of d.breaches) worst = Math.max(worst, (b.area * (1 - b.plugged)) / DAMAGE.hullHoleMax);
  d.hull = Math.min(1, worst);
  const r = d.rigParts;
  d.rig = r.down ? 1 : Math.min(0.9, DAMAGE.rigDriveLoss * Math.max(r.forestay, r.shroudPort, r.shroudStbd));
  d.bilge = d.water.fore + d.water.main + d.water.aft;
}

/**
 * Apply an impact to the damage (in place), at a point of the hull when known (else at the region's usual
 * place: the stem, the side at the topsides, the transom, the keel). Returns what it did, in words.
 */
export function applyImpact(d: Damage, region: ImpactRegion, energyIn: number, at?: ImpactPoint): string[] {
  const out: string[] = [];
  const energy = energyIn * (at?.hardness ?? 1);
  if (energy <= DAMAGE.markJ) return out;
  const p = at ?? defaultPoint(region);
  const x = Math.max(HULL.sternX, Math.min(HULL.bowX, p.x));
  const keel = region === 'keel';
  const z = keel ? HULL.bottomZ : Math.max(HULL.bottomZ, Math.min(0.6, p.z));
  const side = Math.abs(p.y) < 0.05 ? 0 : Math.sign(p.y);
  const y = keel ? 0 : side * halfBreadthAt(x, z);
  const where = placeName(x, y);
  const seed = seedOf(x, y, z, energy);

  // The rudder's blade reaching the bottom (a transom-hung rudder hangs below the hull): the rudder takes it.
  const rudderOnly = region === 'stern' && (at?.z ?? 0) < HULL.bottomZ;
  if (rudderOnly) out.push('rudder struck the bottom');
  else if (keel) {
    // The keel takes it; the joint at its root opens beyond the threshold.
    if (energy > DAMAGE.keelJ) {
      const area = Math.min(DAMAGE.keelAreaMax, DAMAGE.keelAreaMin + (energy - DAMAGE.keelJ) * DAMAGE.keelAreaPerJ);
      addBreach(d, { x: HULL.keelRootX, y: 0, zTop: HULL.bottomZ + 0.02, zBot: HULL.bottomZ - 0.02 }, area, 'crack');
      addScar(d, { x: HULL.keelRootX, y: 0, z: HULL.bottomZ, size: 0.5, kind: 'crack', seed });
      out.push(area > 10e-4 ? 'keel joint opened: leaking fast at the keel root' : 'keel joint cracked: leaking at the keel root');
    } else out.push('keel struck the bottom');
  } else if (energy <= DAMAGE.scrapeJ) {
    addScar(d, { x, y, z, size: 0.12 + 0.25 * (energy / DAMAGE.scrapeJ), kind: 'scuff', seed });
    out.push(`scuffed (${where})`);
  } else if (energy <= DAMAGE.hullJ) {
    addScar(d, { x, y, z, size: 0.25 + 0.25 * ((energy - DAMAGE.scrapeJ) / (DAMAGE.hullJ - DAMAGE.scrapeJ)), kind: 'gouge', seed });
    out.push(`gelcoat gouged (${where})`);
  } else {
    const holed = energy > DAMAGE.holeJ;
    const area = holed
      ? Math.min(DAMAGE.hullHoleMax, DAMAGE.holeAreaMin + (energy - DAMAGE.holeJ) * DAMAGE.holeAreaPerJ)
      : DAMAGE.crackAreaMin + ((DAMAGE.crackAreaMax - DAMAGE.crackAreaMin) * (energy - DAMAGE.hullJ)) / (DAMAGE.holeJ - DAMAGE.hullJ);
    // A gash runs down from the point struck (a stem or a pile end), longer the bigger it is; a raked stem
    // driven into something crushes down its length, past the waterline.
    const span = (holed ? 0.08 + 1.6 * Math.sqrt(area) : 0.12) + (region === 'bow' ? 0.08 + 1.0 * Math.sqrt(area) : 0);
    const b = addBreach(d, { x, y, zTop: z + 0.04, zBot: z - span }, area, holed ? 'hole' : 'crack');
    addScar(d, { x, y, z: z - span / 2, size: holed ? 0.12 + 2.2 * Math.sqrt(area) : 0.3, kind: holed ? 'hole' : 'crack', seed });
    const below = b.zBot < 0;
    const tank = b.compartment === 'fore' ? ' into the forward buoyancy tank' : b.compartment === 'aft' ? ' into the aft buoyancy tank' : '';
    out.push(`${holed ? 'holed' : 'cracked'} ${below ? 'below' : 'above'} the waterline (${where})${tank}`);
  }

  if (region === 'stern' || (keel && at && at.x < HULL.aftTankX)) {
    if (energy > DAMAGE.rudderJ) {
      const was = d.rudder;
      d.rudder = Math.min(1, d.rudder + (energy - DAMAGE.rudderJ) * DAMAGE.rudderPerJ);
      if (d.rudder >= 1 && was < 1) {
        out.push('rudder torn off: no steering');
        addBreach(d, { x: HULL.sternX + 0.05, y: 0, zTop: 0.12, zBot: 0.02 }, DAMAGE.rudderTornArea, 'crack');
        addScar(d, { x: HULL.sternX + 0.02, y: 0, z: 0.1, size: 0.3, kind: 'gouge', seed: seedOf(seed, 1) });
      } else out.push(d.rudder >= 0.6 ? 'rudder badly bent' : 'rudder bent');
      d.version += 1;
    }
  }
  const r = d.rigParts;
  if (!r.down) {
    if (region === 'bow' && energy > DAMAGE.rigJ) {
      r.forestay = Math.min(1, r.forestay + (energy - DAMAGE.rigJ) * DAMAGE.rigPerJ);
      if (r.forestay >= 1) {
        r.down = 'aft';
        out.push('forestay parted: the mast fell aft');
      } else out.push('forestay fitting strained');
      d.version += 1;
    }
    if (!keel && region !== 'bow' && side !== 0 && Math.abs(x - HULL.mastX) < DAMAGE.chainplateReach && energy > DAMAGE.shroudJ) {
      const key = side > 0 ? 'shroudStbd' : 'shroudPort';
      r[key] = Math.min(1, r[key] + (energy - DAMAGE.shroudJ) * DAMAGE.shroudPerJ);
      out.push(r[key] >= 1 ? `${side > 0 ? 'starboard' : 'port'} shroud broken: the mast will fall if it takes the load` : `${side > 0 ? 'starboard' : 'port'} chainplate strained`);
      d.version += 1;
    }
    if (keel && energy > DAMAGE.whipJ) {
      r.forestay = Math.min(0.9, r.forestay + (energy - DAMAGE.whipJ) * DAMAGE.whipPerJ);
      out.push('the mast whipped forward: rig strained');
      d.version += 1;
    }
  }
  summarise(d);
  return out;
}

/** The usual point of an impact by region, when the contact point is not known. */
function defaultPoint(region: ImpactRegion): ImpactPoint {
  switch (region) {
    case 'bow':
      return { x: HULL.bowX - 0.1, y: 0, z: 0.35 };
    case 'stern':
      return { x: HULL.sternX + 0.1, y: 0, z: 0.1 };
    case 'keel':
      return { x: HULL.keelRootX, y: 0, z: HULL.bottomZ };
    default:
      return { x: 0, y: 1, z: 0.4 };
  }
}

/**
 * A shroud that has broken brings the mast down once it is the windward one and the sails are drawing (the
 * windward shroud carries the rig's load, heeled or not). `windward` is the side the wind is on (+1 starboard,
 * −1 port: opposite the boom). Returns the side it fell to (to leeward), or '' (it stands).
 */
export function checkRigFall(d: Damage, windward: number, drawing: boolean): '' | 'port' | 'stbd' {
  const r = d.rigParts;
  if (r.down || !drawing) return '';
  const windwardBroken = windward > 0 ? r.shroudStbd >= 1 : windward < 0 ? r.shroudPort >= 1 : false;
  if (!windwardBroken) return '';
  r.down = windward > 0 ? 'port' : 'stbd';
  d.version += 1;
  summarise(d);
  return r.down;
}

/** Share of the sails' force the rig still gives (1 sound … 0 down). */
export function rigFactor(d: Damage | undefined): number {
  return d ? 1 - d.rig : 1;
}

/** Share of its grip the rudder keeps, and the bias (rad) its bent blade adds; none when it is gone. */
export function rudderDamage(d: Damage | undefined): { grip: number; bias: number } {
  if (!d || d.rudder <= 0) return { grip: 1, bias: 0 };
  if (d.rudder >= 1) return { grip: 0, bias: 0 };
  return { grip: 1 - (1 - DAMAGE.rudderKeepsGrip) * d.rudder, bias: DAMAGE.rudderBentRad * d.rudder };
}

const STATE_WORDS: Record<FloatState, string> = { afloat: '', low: 'low in the water', awash: 'awash', sinking: 'sinking', sunk: 'sunk' };

/** One line for the instruments ('' when sound). */
export function damageSummary(d: Damage | undefined): string {
  if (!d) return '';
  const parts: string[] = [];
  if (d.state !== 'afloat') parts.push(STATE_WORDS[d.state]);
  const open = d.breaches.filter((b) => b.plugged < 1);
  if (open.length) parts.push(`${open.length} ${open.length === 1 ? 'breach' : 'breaches'} in the hull`);
  else if (d.scars.length) parts.push('hull marked');
  if (d.bilge >= 1) parts.push(`${Math.round(d.bilge)} L of water inside`);
  if (d.rudder >= 1) parts.push('rudder lost');
  else if (d.rudder > 0) parts.push(`rudder ${Math.round(d.rudder * 100)}% damaged`);
  if (d.rigParts.down) parts.push('dismasted');
  else if (d.rig > 0) parts.push(`rig ${Math.round((d.rig / DAMAGE.rigDriveLoss) * 100)}% damaged`);
  return parts.join(' · ');
}
