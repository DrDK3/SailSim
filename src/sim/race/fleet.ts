import { DT, type ExternalForce, type Simulation } from '../simulation';
import { hashNumbers } from '../hash';
import { bodyToWorld, windFrom, type NE } from '../boat/forces';
import type { FerryRoute } from '../env/ferries';
import { RiverTraffic, type VesselState } from '../env/traffic';
import type { Environment } from '../env/environment';
import { boxOutline, circleContact, placeOutline, polygonContact, squibOutline, type Contact, type Outline, type Vec } from './hull';
import { hypot2 } from '../math/hypot';
import { PIER_CONTACT, PierGrid, pierPieces, type PierInput } from './piers';
import { impactEnergy } from '../boat/damage';

/**
 * Several boats sharing one environment, stepped together at the fixed 10 ms step, with contact between
 * hulls and with marks, moored boats, ferries, piers and pontoons.
 *
 * Contact model (penalty method, ESTIMATED coefficients): where two outlines overlap, a normal force
 * k·depth + c·closing speed (never pulling) and Coulomb friction μ·N act at the contact point, equal and
 * opposite on the two bodies. Forces are computed from the states at the start of the step and held over it
 * (like the actuators), so the order of the boats does not matter and runs stay deterministic. Marks, moored
 * boats, ferries, piers and pontoons do not move in response (fixed or scripted bodies). Contact acts in the
 * horizontal plane; what an impact does to the boat (damage) is in src/sim/boat/damage.ts.
 */
export interface FleetBoat {
  id: string;
  name: string;
  sailNumber: string;
  /** Hull colour for drawing (0xRRGGBB). */
  colour: number;
  kind: 'human' | 'ai';
  sim: Simulation;
  outline: Outline;
}

export interface CircleObstacle {
  id: string;
  label: string;
  kind: 'mark' | 'committee-boat';
  n: number;
  e: number;
  radius: number;
  stiffness: number;
  damping: number;
}

/** A boat on a swinging mooring: buoy position, length (m) and kind, from the provisional mooring layout. */
export interface MooredBoat {
  n: number;
  e: number;
  l: number;
  area: string;
}

export type ContactKind = 'boat' | 'mark' | 'committee-boat' | 'moored' | 'ferry' | 'pier';

/** Start of a contact (a pair that was not touching at the previous step). */
export interface ContactEvent {
  t: number;
  kind: ContactKind;
  /** Fleet boat ids (b is the obstacle id for non-boat contacts). */
  a: string;
  b: string;
  label: string;
  /** Closing speed at first contact (m/s). */
  speed: number;
  point: Vec;
}

/** Height (m above the waterline) at which contact forces act, for the heel they cause: topsides, fenders, piles (E). */
export const CONTACT_HEIGHT = { boat: 0.55, mark: 0.3, pontoon: 0.35, jetty: 0.25 };

export const CONTACT = {
  /** Hull–hull and hull–hard-object stiffness (N/m) and damping (N s/m): E. */
  hardStiffness: 2e5,
  hardDamping: 5e3,
  /** Inflatable marks give: E. */
  softStiffness: 3e4,
  softDamping: 2e3,
  friction: 0.3,
};

/**
 * Physical radius of a course mark by kind (m): E. Turning marks and the pin are robotic marks (an inflatable on
 * twin pontoons 1.5 m long: src/render/robotMark.ts), taken as a circle round the pontoons. Virtual marks (lane
 * posts) are not physical.
 */
export function markRadius(kind: string): number | null {
  switch (kind) {
    case 'inflatable': return 0.9;
    case 'pin': return 0.9;
    case 'nav-buoy': return 0.9;
    case 'fixed': return 0.4;
    case 'committee-boat': return 2.5;
    default: return null;
  }
}

/** Where a moored boat lies: head to the stream (or, in slack water, the wind), downstream of its buoy. */
export function mooredBoatPose(m: { n: number; e: number; l: number }, stream: NE, windFromDir: number, jitterDeg = 0): { n: number; e: number; heading: number } {
  const sp = hypot2(stream.n, stream.e);
  const bowTo = sp > 0.08 ? Math.atan2(-stream.e, -stream.n) : windFromDir + jitterDeg * (Math.PI / 180);
  const back = m.l * 0.5 + 2;
  return { n: m.n - Math.cos(bowTo) * back, e: m.e - Math.sin(bowTo) * back, heading: bowTo };
}

interface Body {
  pts: Vec[];
  n: number;
  e: number;
  /** Ground velocity of the CG and yaw rate (clockwise from above). */
  vn: number;
  ve: number;
  r: number;
}

const pairKey = (a: string, b: string) => `${a}|${b}`;

export class Fleet {
  readonly boats: FleetBoat[] = [];
  readonly env: Environment;
  marks: CircleObstacle[] = [];
  private moored: MooredBoat[] = [];
  private mooredGrid = new Map<string, number[]>();
  private traffic?: RiverTraffic;
  private readonly startEpochMs: number;
  private touching = new Set<string>();
  private readonly mooredOutline = new Map<number, Outline>();
  private piers?: PierGrid;
  private readonly nearPiers: number[] = [];
  readonly events: ContactEvent[] = [];
  time = 0;
  step = 0;
  /** Accumulated contact force per boat (diagnostics): last step's external force. */
  lastForces = new Map<string, ExternalForce>();

  constructor(env: Environment) {
    this.env = env;
    this.startEpochMs = env.startEpochMs ?? 0;
  }

  add(b: Omit<FleetBoat, 'outline'> & { outline?: Outline }): FleetBoat {
    if (b.sim.ownsEnvironment) throw new Error('fleet boats must not step the shared environment themselves (ownsEnvironment: false)');
    const boat = { ...b, outline: b.outline ?? squibOutline(b.sim.params) };
    this.boats.push(boat);
    return boat;
  }

  /** Bounding box of all ferry, marina and steamer routes, grown by 150 m (no vessel can be outside it). */
  private ferryBox?: { nMin: number; nMax: number; eMin: number; eMax: number };

  /**
   * Fixed and moving obstacles. River traffic: a prebuilt model (the app's, so the physics and the picture are
   * the same traffic), or one built here from the ferry routes with this environment's stream.
   */
  setObstacles(o: { marks?: CircleObstacle[]; moored?: MooredBoat[]; ferries?: FerryRoute[]; traffic?: RiverTraffic; piers?: readonly PierInput[] }): void {
    if (o.marks) this.marks = o.marks;
    if (o.piers) this.piers = new PierGrid(pierPieces(o.piers));
    if (o.traffic || o.ferries) {
      const start = this.startEpochMs;
      this.traffic = o.traffic ?? new RiverTraffic(o.ferries!, { current: (ms, n, e) => this.env.current((ms - start) / 1000, n, e) });
      const pts = [...(o.ferries ?? []).flatMap((f) => f.route), ...this.traffic.fairways.flatMap((f) => f.route), ...this.traffic.steamerTrack()];
      this.ferryBox = pts.length
        ? { nMin: Math.min(...pts.map((p) => p[1])) - 150, nMax: Math.max(...pts.map((p) => p[1])) + 150, eMin: Math.min(...pts.map((p) => p[0])) - 150, eMax: Math.max(...pts.map((p) => p[0])) + 150 }
        : undefined;
    }
    if (o.moored) {
      this.moored = o.moored;
      this.mooredGrid.clear();
      o.moored.forEach((m, i) => {
        const k = `${Math.floor(m.n / 25)},${Math.floor(m.e / 25)}`;
        const list = this.mooredGrid.get(k) ?? [];
        list.push(i);
        this.mooredGrid.set(k, list);
      });
    }
  }

  boat(id: string): FleetBoat | undefined {
    return this.boats.find((b) => b.id === id);
  }

  private ferryCache = new Map<number, VesselState[]>();

  /** Is a pier, pontoon, quay wall or structure in the water within `reach` (m) of this point? */
  nearStructure(n: number, e: number, reach: number): boolean {
    return this.piers?.within(n, e, reach) ?? false;
  }

  /** Could a ferry be within reach of this point (inside the routes' bounding box)? */
  nearFerries(n: number, e: number): boolean {
    const b = this.ferryBox;
    return !!b && n >= b.nMin && n <= b.nMax && e >= b.eMin && e <= b.eMax;
  }

  /** Ferry positions at a sim time (deterministic timetable; the last few times are cached). */
  ferriesAt(t: number): VesselState[] {
    if (!this.traffic) return [];
    let f = this.ferryCache.get(t);
    if (!f) {
      if (this.ferryCache.size > 8) this.ferryCache.clear();
      f = this.traffic.states(this.startEpochMs + t * 1000);
      this.ferryCache.set(t, f);
    }
    return f;
  }

  private readonly pts = new Map<FleetBoat, Vec[]>();

  private body(b: FleetBoat): Body {
    const s = b.sim.state;
    const through = bodyToWorld(s.u, s.v, s.psi);
    const cur = this.env.current(this.time, s.n, s.e);
    let pts = this.pts.get(b);
    if (!pts) this.pts.set(b, (pts = []));
    return { pts: placeOutline(b.outline, s.n, s.e, s.psi, pts), n: s.n, e: s.e, vn: through.n + cur.n, ve: through.e + cur.e, r: s.r };
  }

  /** Advance every boat one fixed step. Returns contacts that began during this step. */
  stepOnce(): ContactEvent[] {
    // Tell the wind field where the fleet is (it then samples only puffs that can reach it: same results).
    const wf = this.env.windField;
    if (wf && this.boats.length) {
      let nMin = Infinity;
      let nMax = -Infinity;
      let eMin = Infinity;
      let eMax = -Infinity;
      for (const b of this.boats) {
        const s = b.sim.state;
        nMin = Math.min(nMin, s.n);
        nMax = Math.max(nMax, s.n);
        eMin = Math.min(eMin, s.e);
        eMax = Math.max(eMax, s.e);
      }
      const m = 40;
      wf.setFocus({ nMin: nMin - m, nMax: nMax + m, eMin: eMin - m, eMax: eMax + m });
    }
    this.env.step?.(this.time, DT);
    const bodies = this.boats.map((b) => this.body(b));
    const ext = bodies.map(() => ({ n: 0, e: 0, yaw: 0, roll: 0 }));
    const now = new Set<string>();
    const started: ContactEvent[] = [];
    const touch = (key: string, ev: Omit<ContactEvent, 't'>) => {
      now.add(key);
      if (!this.touching.has(key)) {
        const e = { t: this.time + DT, ...ev };
        started.push(e);
        this.events.push(e);
      }
    };
    /** Force f at point p on boat i, applied `h` m above the waterline (it heels her too). */
    const apply = (i: number, f: NE, p: Vec, h: number) => {
      const B = bodies[i]!;
      ext[i]!.n += f.n;
      ext[i]!.e += f.e;
      ext[i]!.yaw += (p.n - B.n) * f.e - (p.e - B.e) * f.n;
      const psi = this.boats[i]!.sim.state.psi;
      ext[i]!.roll += (-f.n * Math.sin(psi) + f.e * Math.cos(psi)) * h;
    };
    const pointVel = (B: Body, p: Vec): NE => ({ n: B.vn - B.r * (p.e - B.e), e: B.ve + B.r * (p.n - B.n) });
    /** Force on body "b" side (along +normal) for a contact; `vRel` = velocity of B's point minus A's. */
    const force = (c: Contact, vRel: NE, k: number, damp: number): NE => {
      const nn = c.normal.n;
      const ne = c.normal.e;
      const vn = vRel.n * nn + vRel.e * ne;
      const fN = Math.max(0, k * c.depth - damp * vn);
      const tn = vRel.n - vn * nn;
      const te = vRel.e - vn * ne;
      const vt = hypot2(tn, te);
      const fT = vt > 1e-9 ? (CONTACT.friction * fN * Math.tanh(vt / 0.1)) / vt : 0;
      return { n: fN * nn - fT * tn, e: fN * ne - fT * te };
    };

    // Boat–boat.
    for (let i = 0; i < this.boats.length; i++) {
      const A = bodies[i]!;
      const oa = this.boats[i]!;
      for (let j = i + 1; j < this.boats.length; j++) {
        const B = bodies[j]!;
        const ob = this.boats[j]!;
        const rr = oa.outline.radius + ob.outline.radius;
        if ((A.n - B.n) ** 2 + (A.e - B.e) ** 2 > rr * rr) continue;
        const c = polygonContact(A.pts, B.pts);
        if (!c) continue;
        const va = pointVel(A, c.point);
        const vb = pointVel(B, c.point);
        const vRel = { n: vb.n - va.n, e: vb.e - va.e };
        const f = force(c, vRel, CONTACT.hardStiffness, CONTACT.hardDamping);
        apply(j, f, c.point, CONTACT_HEIGHT.boat);
        apply(i, { n: -f.n, e: -f.e }, c.point, CONTACT_HEIGHT.boat);
        touch(pairKey(oa.id, ob.id), { kind: 'boat', a: oa.id, b: ob.id, label: `${oa.name} and ${ob.name}`, speed: Math.max(0, -(vRel.n * c.normal.n + vRel.e * c.normal.e)), point: c.point });
      }
    }

    for (let i = 0; i < this.boats.length; i++) {
      const A = bodies[i]!;
      const oa = this.boats[i]!;
      // Course marks and the committee boat (fixed circles).
      for (const m of this.marks) {
        const rr = oa.outline.radius + m.radius;
        if ((A.n - m.n) ** 2 + (A.e - m.e) ** 2 > rr * rr) continue;
        const c = circleContact(A.pts, m, m.radius);
        if (!c) continue;
        const va = pointVel(A, c.point);
        const f = force(c, { n: -va.n, e: -va.e }, m.stiffness, m.damping);
        apply(i, { n: -f.n, e: -f.e }, c.point, CONTACT_HEIGHT.mark);
        touch(pairKey(oa.id, m.id), { kind: m.kind, a: oa.id, b: m.id, label: m.label, speed: Math.max(0, va.n * c.normal.n + va.e * c.normal.e), point: c.point });
      }
      // Moored boats near this boat (spatial hash on the buoys, 25 m cells).
      if (this.moored.length) {
        const ci = Math.floor(A.n / 25);
        const cj = Math.floor(A.e / 25);
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const list = this.mooredGrid.get(`${ci + di},${cj + dj}`);
            if (!list) continue;
            for (const k of list) {
              const mb = this.moored[k]!;
              const reach = oa.outline.radius + mb.l + 2;
              if ((A.n - mb.n) ** 2 + (A.e - mb.e) ** 2 > reach * reach) continue;
              const pose = mooredBoatPose(mb, this.env.current(this.time, mb.n, mb.e), windFrom(this.env.wind(this.time, mb.n, mb.e)).fromDir);
              let ol = this.mooredOutline.get(k);
              if (!ol) this.mooredOutline.set(k, (ol = boxOutline(mb.l, mb.l * 0.33)));
              const c = polygonContact(A.pts, placeOutline(ol, pose.n, pose.e, pose.heading));
              if (!c) continue;
              const va = pointVel(A, c.point);
              const f = force(c, { n: -va.n, e: -va.e }, CONTACT.hardStiffness, CONTACT.hardDamping);
              apply(i, { n: -f.n, e: -f.e }, c.point, CONTACT_HEIGHT.boat);
              touch(pairKey(oa.id, `moored-${k}`), { kind: 'moored', a: oa.id, b: `moored-${k}`, label: `a moored boat (${mb.area})`, speed: Math.max(0, va.n * c.normal.n + va.e * c.normal.e), point: c.point });
            }
          }
        }
      }
      // Piers, jetties and pontoons (convex pieces in a 25 m grid): fixed, or floating on fenders.
      if (this.piers) {
        for (const k of this.piers.near(A.n, A.e, oa.outline.radius, this.nearPiers)) {
          const pc = this.piers.pieces[k]!;
          const rr = oa.outline.radius + pc.radius;
          if ((A.n - pc.n) ** 2 + (A.e - pc.e) ** 2 > rr * rr) continue;
          const c = polygonContact(A.pts, pc.pts);
          if (!c) continue;
          const va = pointVel(A, c.point);
          const kc = pc.floating ? PIER_CONTACT.floating : PIER_CONTACT.fixed;
          const f = force(c, { n: -va.n, e: -va.e }, kc.stiffness, kc.damping);
          apply(i, { n: -f.n, e: -f.e }, c.point, pc.floating ? CONTACT_HEIGHT.pontoon : CONTACT_HEIGHT.jetty);
          touch(pairKey(oa.id, `pier-${pc.pier}`), { kind: 'pier', a: oa.id, b: `pier-${pc.pier}`, label: pc.label, speed: Math.max(0, va.n * c.normal.n + va.e * c.normal.e), point: c.point });
        }
      }
    }

    // River traffic (scripted bodies on their schedules): each vessel's parts (a float and its tug) are solid.
    if (this.traffic && bodies.some((B) => this.nearFerries(B.n, B.e))) {
      const fs = this.ferriesAt(this.time);
      const later = new Map(this.ferriesAt(this.time + 1).map((x) => [x.id, x]));
      for (const fy of fs) {
        const next = later.get(fy.id);
        fy.parts.forEach((part, pi) => {
          const ol = boxOutline(part.length, part.beam);
          const pts = placeOutline(ol, part.n, part.e, part.heading);
          const np = next?.parts[pi];
          const v = np ? { n: np.n - part.n, e: np.e - part.e } : { n: 0, e: 0 };
          for (let i = 0; i < this.boats.length; i++) {
            const A = bodies[i]!;
            const oa = this.boats[i]!;
            const rr = oa.outline.radius + ol.radius;
            if ((A.n - part.n) ** 2 + (A.e - part.e) ** 2 > rr * rr) continue;
            const c = polygonContact(A.pts, pts);
            if (!c) continue;
            const va = pointVel(A, c.point);
            const f = force(c, { n: v.n - va.n, e: v.e - va.e }, CONTACT.hardStiffness, CONTACT.hardDamping);
            apply(i, { n: -f.n, e: -f.e }, c.point, CONTACT_HEIGHT.boat);
            const key = `ferry-${fy.id}`;
            touch(pairKey(oa.id, key), { kind: 'ferry', a: oa.id, b: key, label: pi > 0 ? `${fy.label} (tug)` : fy.label, speed: Math.max(0, -((v.n - va.n) * c.normal.n + (v.e - va.e) * c.normal.e)), point: c.point });
          }
        });
      }
    }

    // Damage from the impacts that began this step (by their closing speed and where they struck).
    for (const ev of started) this.damageFrom(ev);
    this.touching = now;
    this.lastForces.clear();
    this.boats.forEach((b, i) => {
      const f = ext[i]!;
      const any = f.n !== 0 || f.e !== 0 || f.yaw !== 0 || f.roll !== 0;
      b.sim.external = any ? f : null;
      if (any) this.lastForces.set(b.id, f);
    });
    for (const b of this.boats) b.sim.stepOnce();
    this.step += 1;
    this.time = this.step * DT;
    return started;
  }

  /**
   * Damage to the boats in a contact that has just begun: the impact energy of its closing speed, against the
   * boat's mass for a fixed or scripted object, or the two boats' reduced mass when two meet; inflatable marks
   * give way and do no harm (src/sim/boat/damage.ts).
   */
  private damageFrom(ev: ContactEvent): void {
    const A = this.boat(ev.a);
    if (!A) return;
    const soft = ev.kind === 'mark' && this.marks.find((m) => m.id === ev.b)?.stiffness === CONTACT.softStiffness;
    if (soft) return;
    const B = ev.kind === 'boat' ? this.boat(ev.b) : undefined;
    const mass = B ? (A.sim.params.mass * B.sim.params.mass) / (A.sim.params.mass + B.sim.params.mass) : A.sim.params.mass;
    const energy = impactEnergy(ev.speed, mass);
    for (const [boat, what] of B ? ([[A, B.name], [B, A.name]] as const) : ([[A, ev.label]] as const)) {
      const s = boat.sim.state;
      const along = (ev.point.n - s.n) * Math.cos(s.psi) + (ev.point.e - s.e) * Math.sin(s.psi);
      const L = boat.sim.params.loa;
      boat.sim.impact(what, along > 0.25 * L ? 'bow' : along < -0.25 * L ? 'stern' : 'side', ev.speed, energy);
    }
  }

  /** Pairs (or boat–obstacle pairs) in contact after the last step, as "a|b" keys. */
  inContact(): ReadonlySet<string> {
    return this.touching;
  }

  stateHash(): string {
    return hashNumbers(this.boats.flatMap((b) => {
      const s = b.sim.state;
      return [s.n, s.e, s.psi, s.u, s.v, s.r, s.phi, s.p, b.sim.act.rudder, b.sim.act.boomMain];
    }).concat([this.time]));
  }
}
