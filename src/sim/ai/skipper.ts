import { clamp, DEG, wrapPi } from '../math/angles';
import { createRng } from '../math/rng';
import { bodyToWorld, windFrom, type NE } from '../boat/forces';
import type { ControlInput, Simulation } from '../simulation';
import type { ResolvedCourse } from '../course/course';
import type { CourseJudge } from '../course/judge';
import type { LocalPoint } from '../course/types';
import { cross, pointInPolygon, segmentCrossing } from '../course/geometry';
import type { MooringArea } from '../course/restrictions';
import type { Seabed } from '../geo/dart';
import type { CircleObstacle, Fleet, FleetBoat } from '../race/fleet';
import type { RaceCommittee } from '../race/committee';
import { rightOfWay, type RulesBoat } from '../race/rules';
import type { Polar } from './polar';
import { aiSheetInput, type SheetState } from './sheets';
import { hypot2 } from '../math/hypot';

/**
 * AI skipper for one Squib. It sails with the same physics and controls as the user (helm, sheets via the
 * auto-trim assist, crew assist); it never touches the boat's state.
 *
 * Three layers:
 *  1. Tactics, 5 times a second: where to go (start-line spot, mark, gate, finish), and how. Target-VMG
 *     angles from the AI polar; tacks and gybes on laylines (with the current), on shifts (sail the tack that
 *     points nearer the mark, with a skill-dependent threshold), at the edge of a cone round the rhumb line,
 *     and before shallow water, boundaries or mooring areas. Marks are rounded on a circle on the required
 *     side and left astern before turning for the next one. Starts: hold behind the line, then a timed
 *     close-hauled run at a chosen spot, slowing by easing the main; return if over early.
 *  2. Collision avoidance: candidate headings are scored for deviation, manoeuvres, closest approach to other
 *     boats (keeping clear when the simplified rules say so; holding course when right of way, with a last-
 *     moment avoidance as rule 14 requires), marks, ferries, shallow water, mooring areas and boundaries.
 *  3. Steering, every 10 ms step: PD helm on heading or on true wind angle; sheets as `aiSheetInput`.
 * Skill parameters are seeded per boat (E): they vary thresholds and margins, not the physics.
 */
export type AiLevel = 'club' | 'good' | 'expert';

export interface AiSkill {
  level: AiLevel;
  /** Tack or gybe when the other tack points this much nearer the mark (deg). */
  shiftDeg: number;
  /** Extra angle past the layline before tacking for a mark (deg). */
  overstandDeg: number;
  /** Aim to cross the starting line this long after the signal (s). */
  startLateS: number;
  /** Systematic steering error on target angles (deg). */
  twaBiasDeg: number;
  /** Minimum time between tactical tacks or gybes (s). */
  minTackS: number;
  /** Rounding circle radius about the mark centre (m). */
  roundRadius: number;
  /** Starting spot along the line, 0 (first end) … 1 (second end). */
  lineFraction: number;
  /** Distance of the hold point behind the spot, along the approach (m). */
  setupM: number;
  /** Helm gains. */
  kp: number;
  kd: number;
}

const LEVELS: Record<AiLevel, { shift: [number, number]; over: [number, number]; late: [number, number]; bias: number; minTack: [number, number]; radius: [number, number] }> = {
  club: { shift: [7, 12], over: [3, 6], late: [3, 7], bias: 2, minTack: [16, 26], radius: [10, 12] },
  good: { shift: [5, 9], over: [2, 4], late: [2, 4], bias: 1.2, minTack: [12, 18], radius: [9, 11] },
  expert: { shift: [4, 6], over: [1, 2.5], late: [1, 2.5], bias: 0.6, minTack: [10, 14], radius: [8, 10] },
};

/** Seeded skill for AI boat `index` of `count` (spreads the boats along the line). */
export function aiSkill(level: AiLevel, seed: number, index: number, count: number): AiSkill {
  const rng = createRng((seed * 7919 + index * 104729) >>> 0);
  const L = LEVELS[level];
  const pick = ([a, b]: [number, number]) => a + (b - a) * rng.next();
  const slot = count > 1 ? 0.15 + (0.7 * index) / (count - 1) : 0.5;
  return {
    level,
    shiftDeg: pick(L.shift),
    overstandDeg: pick(L.over),
    startLateS: pick(L.late),
    twaBiasDeg: (rng.next() * 2 - 1) * L.bias,
    minTackS: pick(L.minTack),
    roundRadius: pick(L.radius),
    lineFraction: clamp(slot + (rng.next() - 0.5) * 0.08, 0.1, 0.9),
    setupM: (index % 2 ? 72 : 45) + 12 * rng.next(),
    kp: 2.0 * (0.9 + 0.2 * rng.next()),
    kd: 1.2 * (0.9 + 0.2 * rng.next()),
  };
}

/** What the AI can see and know: the race, the other boats, the chart and its own polar. */
export interface AiWorld {
  readonly fleet: Fleet;
  readonly course: ResolvedCourse;
  readonly committee: RaceCommittee;
  readonly polar: Polar;
  readonly seabed?: Seabed;
  readonly draft: number;
  readonly mooringAreas: MooringArea[];
  readonly obstacles: CircleObstacle[];
  judgeOf(id: string): CourseJudge;
  rulesBoat(id: string): RulesBoat;
  /** Penalty turns still owed by a boat (0 = none). */
  owesPenalty(id: string): number;
  waterLevel(t: number): number;
  /** Boat no longer racing (finished, retired, disqualified): it keeps out of the way. */
  outOfRace(id: string): boolean;
}

type Command =
  | { mode: 'twa'; target: number; depower: number }
  | { mode: 'heading'; target: number; depower: number }
  | { mode: 'helm'; helm: number; depower: number };

interface Goal {
  p: LocalPoint;
  label: string;
  /** Mark being rounded (circle on the required side). */
  round?: { c: LocalPoint; sign: 1 | -1; radius: number };
  /** Before the start signal: do not cross the starting line. */
  lineWall: boolean;
  depower: number;
  /** Hold position (pre-start): luff with sails eased near p. */
  hold?: boolean;
  /** Crossing the start line: aim to arrive at `arriveAt` (sim time). */
  arriveAt?: number;
}

const DECIDE_EVERY = 20; // steps (0.2 s)

/** A Squib hull as two circles along the centreline: [body x (m), radius (m)] (from the 5.79 m × 1.87 m outline). */
const HULL_CIRCLES: [number, number][] = [[1.45, 1.3], [-1.35, 1.25]];

/** Per-decision evaluation of candidate headings (built once per decision, used by tactics and avoidance). */
interface Scorer {
  score(h: number, slow: boolean, devCost: number, mode?: 'full' | 'risk' | 'boats'): number;
  prev?: number;
}
const v = (n: number, e: number): LocalPoint => ({ n, e });
const dirOf = (h: number): NE => ({ n: Math.cos(h), e: Math.sin(h) });
const bearing = (a: LocalPoint, b: LocalPoint) => Math.atan2(b.e - a.e, b.n - a.n);

export class AiSkipper {
  readonly id: string;
  private cmd: Command = { mode: 'heading', target: 0, depower: 0 };
  private readonly sheets: SheetState = { ease: 0 };
  private meanWind?: NE;
  private side: 1 | -1 = 1;
  private lastTack = -Infinity;
  private recent?: { c: LocalPoint; sign: 1 | -1; radius: number; t: number };
  private lastLeg = -1;
  private penaltyDir = 0;
  private holdUntil = -Infinity;
  /** Measured leeway when sailing upwind (rad, EMA), used to predict tracks. */
  private leeway = 5 * DEG;
  /** Last tactical decision, for the debug overlay. */
  intent = '';
  /** Recovering from being stopped head to wind. */
  irons = false;
  private ironsSide: 1 | -1 = 1;
  private reflex?: { helm: number; depower: number };
  private avoidHeading?: number;
  private returning = false;
  private onFinalApproach = false;
  private blockedSince?: number;
  /** Since when the boat has been steered well away from its course by other boats (-1: not). */
  private pinnedSince = -1;
  /** Letting the boats that pin it pass: until when, and the heading held meanwhile. */
  private yieldUntil = -Infinity;
  private yieldHeading = 0;
  /** Obstacle ids of the starting and finishing line ends. */
  private readonly lineEnds: Set<string>;
  /** Side (TWA sign) a tack or gybe in progress is turning to; 0 when none. */
  private turningTo: 0 | 1 | -1 = 0;
  /** Where the boat waits before its run at the line (its starting slot). */
  holdPoint: LocalPoint;

  get command(): Readonly<{ mode: string; target?: number; depower: number }> {
    return this.cmd as { mode: string; target?: number; depower: number };
  }

  constructor(
    readonly boat: FleetBoat,
    readonly world: AiWorld,
    readonly skill: AiSkill,
    private readonly phase: number,
  ) {
    this.id = boat.id;
    this.cmd = { mode: 'heading', target: boat.sim.state.psi, depower: 0 };
    this.holdPoint = { n: boat.sim.state.n, e: boat.sim.state.e };
    const ends = [...world.course.start, ...world.course.finish];
    this.lineEnds = new Set(world.obstacles.filter((o) => ends.some((p) => hypot2(p.n - o.n, p.e - o.e) < 0.5)).map((o) => o.id));
  }

  /** Per-step control (installed as the Simulation's controller). */
  control(sim: Simulation): Partial<ControlInput> {
    if ((sim.step + this.phase) % DECIDE_EVERY === 0) this.decide(sim);
    const c = this.cmd;
    let helm: number;
    let depower = c.depower;
    const s = sim.state;
    const w = sim.env.wind(sim.time, s.n, s.e);
    const cur = sim.env.current(sim.time, s.n, s.e);
    const twa = wrapPi(windFrom({ n: w.n - cur.n, e: w.e - cur.e }).fromDir - s.psi);
    if (c.mode !== 'helm' && Math.abs(twa) < 25 * DEG && s.u < 0.6 && !(c.mode === 'twa' && Math.abs(c.target) < 25 * DEG)) {
      // In irons: let the main go and steer the bow off towards the wanted side (reversed when going astern).
      if (!this.irons) {
        const wantSide = c.mode === 'twa' ? Math.sign(c.target) : Math.sign(wrapPi(twa + s.psi - c.target));
        this.ironsSide = (wantSide || this.side) as 1 | -1;
      }
      // Bow off to the wanted side (helm reversed when going astern); main eased, jib drawing.
      helm = (s.u < -0.05 ? 1 : -1) * this.ironsSide;
      depower = 0.9;
      this.irons = true;
    } else {
      this.irons = false;
      // PD helm on heading or true wind angle (as autopilotHelm, with the TWA already computed above).
      if (c.mode === 'helm') helm = c.helm;
      else {
        const err = c.mode === 'heading' ? wrapPi(c.target - s.psi) : -wrapPi(c.target - twa);
        helm = clamp(this.skill.kp * err - this.skill.kd * s.r, -1, 1);
      }
    }
    // Collision reflex (20 Hz): overrides the helm when contact is imminent.
    if ((sim.step + this.phase) % 5 === 0) this.reflex = this.collisionReflex(sim);
    if (this.reflex) {
      helm = this.reflex.helm;
      depower = Math.max(depower, this.reflex.depower);
    }
    return { helm, ...aiSheetInput(sim, this.sheets, depower) };
  }

  /**
   * Last-moment collision avoidance (rule 14: avoid contact if reasonably possible, whoever has right of
   * way). Each hull is two circles (bow and stern quarters). Over the next 2.5 s the boat's own motion is
   * predicted for hard-to-port, straight and hard-to-starboard helm (turning at the measured rate, ~5.3°/s
   * per m/s, after the rudder moves), the others' with their present velocity and turn rate. If contact is
   * predicted for the current plan, the action keeping the largest clearance is taken, easing the sheets.
   */
  private collisionReflex(sim: Simulation): { helm: number; depower: number } | undefined {
    const s = sim.state;
    const me = this.boat;
    const near: { n: number; e: number; psi: number; vn: number; ve: number; r: number; circles: [number, number][] }[] = [];
    for (const b of this.world.fleet.boats) {
      if (b === me) continue;
      const bs = b.sim.state;
      if (Math.abs(bs.n - s.n) > 18 || Math.abs(bs.e - s.e) > 18) continue;
      const v = bodyToWorld(bs.u, bs.v, bs.psi);
      near.push({ n: bs.n, e: bs.e, psi: bs.psi, vn: v.n, ve: v.e, r: bs.r, circles: HULL_CIRCLES });
    }
    for (const m of this.world.obstacles) {
      if (Math.abs(m.n - s.n) > 18 || Math.abs(m.e - s.e) > 18) continue;
      near.push({ n: m.n, e: m.e, psi: 0, vn: 0, ve: 0, r: 0, circles: [[0, m.radius]] });
    }
    if (!near.length) return undefined;
    const mv = bodyToWorld(s.u, s.v, s.psi);
    const spd = hypot2(s.u, s.v);
    const rMax = clamp(5.3 * spd, 2, 18) * DEG;
    const clearance = (helmSign: number): number => {
      let best = Infinity;
      let psi = s.psi;
      let rate = s.r;
      let n = s.n;
      let e = s.e;
      const dt = 0.25;
      for (let k = 1; k <= 10; k++) {
        const t = k * dt;
        rate += (helmSign * rMax - rate) * Math.min(1, dt / 0.6);
        psi += rate * dt;
        n += mv.n * dt;
        e += mv.e * dt;
        for (const o of near) {
          const op = o.psi + o.r * Math.min(t, 2);
          const on = o.n + o.vn * t;
          const oe = o.e + o.ve * t;
          for (const [cx, cr] of HULL_CIRCLES) {
            const an = n + cx * Math.cos(psi);
            const ae = e + cx * Math.sin(psi);
            for (const [ox, or] of o.circles) {
              const d = hypot2(an - (on + ox * Math.cos(op)), ae - (oe + ox * Math.sin(op))) - cr - or;
              if (d < best) best = d;
            }
          }
        }
      }
      return best;
    };
    const planned = this.cmd.mode === 'helm' ? this.cmd.helm : 0;
    const cNow = clearance(clamp(planned, -1, 1));
    if (cNow > 0.6) return undefined;
    let bestHelm = planned;
    let bestC = cNow;
    for (const h of [-1, 1]) {
      const c = clearance(h);
      if (c > bestC + 0.05) {
        bestC = c;
        bestHelm = h;
      }
    }
    this.intent += ' · REFLEX';
    return { helm: bestHelm, depower: 0.8 };
  }

  // ------------------------------------------------------------------ wind

  private windWater(sim: Simulation): { dir: number; speed: number; cur: NE } {
    const s = sim.state;
    const w = sim.env.wind(sim.time, s.n, s.e);
    const c = sim.env.current(sim.time, s.n, s.e);
    const ww = windFrom({ n: w.n - c.n, e: w.e - c.e });
    return { dir: ww.fromDir, speed: ww.speed, cur: c };
  }

  // -------------------------------------------------------------- decision

  private decide(sim: Simulation): void {
    const W = this.world;
    const s = sim.state;
    const me = v(s.n, s.e);
    const wind = this.windWater(sim);
    // Mean wind direction (vector EMA, ~90 s) for shift detection.
    const wv = dirOf(wind.dir);
    const k = this.meanWind ? 0.2 / 90 : 1;
    this.meanWind = this.meanWind ? { n: this.meanWind.n + k * (wv.n - this.meanWind.n), e: this.meanWind.e + k * (wv.e - this.meanWind.e) } : wv;
    const twaNow = wrapPi(wind.dir - s.psi);
    if (Math.abs(twaNow) > 2 * DEG) this.side = twaNow > 0 ? 1 : -1;
    this.refreshMoorings(me);
    const stw = hypot2(s.u, s.v);
    if (Math.abs(twaNow) < 70 * DEG && stw > 0.8) this.leeway += 0.02 * (Math.abs(Math.atan2(s.v, s.u)) - this.leeway);

    // Penalty turns: once well clear of other boats and marks, turn until the judge counts them.
    const owed = W.owesPenalty(this.id);
    if (owed > 0 && !W.outOfRace(this.id)) {
      if (this.penaltyDir !== 0 || this.wellClear(me)) {
        if (this.penaltyDir === 0) this.penaltyDir = twaNow >= 0 ? 1 : -1; // turn towards the wind first
        // Keep the wanted heading 60° ahead in the direction of the turn.
        this.cmd = { mode: 'heading', target: s.psi + this.penaltyDir * 60 * DEG, depower: 0 };
        this.intent = `penalty turns (${owed} to go)`;
        return;
      }
    } else this.penaltyDir = 0;

    const goal = this.goal(sim);
    this.intent = goal.label;
    const beat = W.polar.beat(wind.speed);
    const run = W.polar.run(wind.speed);
    const sc = this.makeScorer(sim, me, goal, wind, beat.twa);
    let nav = goal.hold ? this.holdCommand(sim, wind.dir, beat.twa, goal) : this.navigate(sim, me, goal, wind, beat.twa, run.twa, twaNow, sc);
    const yielding = this.letPass(sim, sc, nav, wind.dir, goal);
    if (yielding) nav = yielding;
    else {
      const planned = nav;
      nav = this.avoid(sim, sc, nav, wind, beat.twa);
      this.updatePinned(sim.time, planned, wind.dir, goal);
    }
    // Mid-tack (head to wind): finish the turn already started rather than flip back and forth.
    const navTwa = nav.mode === 'twa' ? nav.target : nav.mode === 'heading' ? wrapPi(wind.dir - nav.target) : 0;
    if (Math.abs(twaNow) < beat.twa - 8 * DEG && this.turningTo !== 0 && nav.mode !== 'helm' && Math.sign(navTwa) !== this.turningTo && !goal.hold) {
      nav = { mode: 'twa', target: this.turningTo * beat.twa, depower: nav.depower };
    }
    if (nav.mode !== 'helm') {
      const sideCmd = Math.sign(nav.mode === 'twa' ? nav.target : wrapPi(wind.dir - nav.target));
      this.turningTo = sideCmd !== 0 && sideCmd !== Math.sign(twaNow) ? (sideCmd as 1 | -1) : Math.abs(twaNow) < beat.twa - 8 * DEG ? this.turningTo : 0;
    }
    let depower = Math.max(goal.depower, nav.depower);
    // Too slow to steer clear with a boat close by: power up.
    if (depower > 0.3 && !yielding && this.crowded(me, 22)) depower = 0.3;
    if (goal.arriveAt !== undefined) depower = Math.max(depower, this.startSpeedControl(sim, me, goal));
    // Light air: keep enough way on to steer (ease less).
    if (!goal.hold && !yielding) depower = Math.min(depower, clamp((wind.speed / 0.5144 - 5) / 6, 0.3, 0.8));
    nav.depower = depower;
    this.cmd = nav;
  }

  /**
   * A boat held well off its course by other boats for a long time (e.g. to windward of a boat it must pass
   * astern of, both sailing on side by side) slows down for up to 25 s with its sails eased, so that they draw
   * ahead, while that is safe; it stops as soon as its own course is clear of boats. Returns the command, or
   * undefined when not yielding.
   */
  private letPass(sim: Simulation, sc: Scorer, nav: Command, windDir: number, goal: Goal): Command | undefined {
    if (sim.time >= this.yieldUntil || goal.hold || nav.mode === 'helm') return undefined;
    const hNav = nav.mode === 'heading' ? nav.target : windDir - nav.target;
    if (sc.score(hNav, false, 0, 'boats') < 0.3 || sc.score(this.yieldHeading, true, 0, 'risk') > 1) {
      this.yieldUntil = -Infinity;
      return undefined;
    }
    this.intent += ' · letting boats pass';
    return { mode: 'heading', target: this.yieldHeading, depower: 1 };
  }

  /**
   * Time how long avoidance has held the boat more than 60° off its planned course (`planned`, before
   * avoidance); after 30 s, start letting boats pass.
   */
  private updatePinned(t: number, planned: Command, windDir: number, goal: Goal): void {
    if (goal.hold || planned.mode === 'helm' || this.avoidHeading === undefined) {
      this.pinnedSince = -1;
      return;
    }
    const hNav = planned.mode === 'heading' ? planned.target : windDir - planned.target;
    if (Math.abs(wrapPi(this.avoidHeading - hNav)) < 60 * DEG) this.pinnedSince = -1;
    else if (this.pinnedSince < 0) this.pinnedSince = t;
    else if (t - this.pinnedSince > 30) {
      this.yieldUntil = t + 25;
      this.yieldHeading = this.boat.sim.state.psi;
      this.pinnedSince = -1;
    }
  }

  /**
   * Does this boat keep clear of `b`? One consistent answer for both boats of a pair: boats out of the race
   * keep clear of everyone; a moving boat keeps clear of a stopped one (it cannot manoeuvre: rule 14); between
   * two stopped boats the later entry keeps clear; otherwise the simplified rules decide.
   */
  private keepsClearOf(b: FleetBoat, mine: RulesBoat): boolean {
    const W = this.world;
    if (W.outOfRace(this.id)) return true;
    if (W.outOfRace(b.id)) return false;
    const slowMe = hypot2(this.boat.sim.state.u, this.boat.sim.state.v) < 0.8;
    const slowIt = hypot2(b.sim.state.u, b.sim.state.v) < 0.8;
    if (slowIt && !slowMe) return true;
    if (slowMe && !slowIt) return false;
    if (slowMe && slowIt) return this.id > b.id;
    return rightOfWay(mine, W.rulesBoat(b.id)).keepClear === this.id;
  }

  /** A boat this one must keep clear of is within r and closing. */
  private crowded(me: LocalPoint, r: number): boolean {
    const mine = this.world.rulesBoat(this.id);
    const ms = this.boat.sim.state;
    const mv = bodyToWorld(ms.u, ms.v, ms.psi);
    for (const b of this.world.fleet.boats) {
      if (b.id === this.id) continue;
      const bs = b.sim.state;
      const p = { n: bs.n - me.n, e: bs.e - me.e };
      if (hypot2(p.n, p.e) > r) continue;
      const bv = bodyToWorld(bs.u, bs.v, bs.psi);
      const closing = p.n * (bv.n - mv.n) + p.e * (bv.e - mv.e) < 0;
      if (closing && this.keepsClearOf(b, mine)) return true;
    }
    return false;
  }

  /** Well clear for penalty turns: no boat within 15 m or closing to within 12 m in the next 15 s; away from marks. */
  private wellClear(me: LocalPoint): boolean {
    const mine = this.boat.sim.state;
    const mv = bodyToWorld(mine.u, mine.v, mine.psi);
    for (const b of this.world.fleet.boats) {
      if (b.id === this.id) continue;
      const bs = b.sim.state;
      const p = { n: bs.n - me.n, e: bs.e - me.e };
      if (hypot2(p.n, p.e) < 15) return false;
      const bv = bodyToWorld(bs.u, bs.v, bs.psi);
      const w = { n: bv.n - mv.n * 0.3, e: bv.e - mv.e * 0.3 }; // we will be nearly stopped while turning
      const w2 = w.n * w.n + w.e * w.e;
      const tc = w2 > 1e-6 ? clamp(-(p.n * w.n + p.e * w.e) / w2, 0, 15) : 0;
      if (hypot2(p.n + w.n * tc, p.e + w.e * tc) < 12) return false;
    }
    for (const m of this.world.obstacles) if (hypot2(m.n - me.n, m.e - me.e) < 20 + m.radius) return false;
    return true;
  }

  /** Where to go now. */
  private goal(sim: Simulation): Goal {
    const W = this.world;
    const t = sim.time;
    const me = v(sim.state.n, sim.state.e);
    const course = W.course;
    const [A, B] = course.start;
    const judge = W.judgeOf(this.id);
    const firstMark = course.legs[0]!.target;
    const lineDir = { n: B.n - A.n, e: B.e - A.e };
    const L = hypot2(lineDir.n, lineDir.e);
    const u = { n: lineDir.n / L, e: lineDir.e / L };
    // Normal towards the course side.
    let nc = { n: -u.e, e: u.n };
    if ((firstMark.n - A.n) * nc.n + (firstMark.e - A.e) * nc.e < 0) nc = { n: -nc.n, e: -nc.e };
    const along = (p: LocalPoint) => ((p.n - A.n) * u.n + (p.e - A.e) * u.e) / L;
    const onLine = (f: number) => v(A.n + lineDir.n * f, A.e + lineDir.e * f);
    const behind = (p: LocalPoint, d: number) => v(p.n - nc.n * d, p.e - nc.e * d);

    if (W.outOfRace(this.id)) {
      // Keep out of the way: beyond the finishing line, away from the course, spread by boat.
      const [fa, fb] = course.finish;
      const fm = v((fa.n + fb.n) / 2, (fa.e + fb.e) / 2);
      const last = course.legs[course.legs.length - 1]!.target;
      let fn = { n: -(fb.e - fa.e), e: fb.n - fa.n };
      const fl = hypot2(fn.n, fn.e) || 1;
      fn = { n: fn.n / fl, e: fn.e / fl };
      if ((last.n - fm.n) * fn.n + (last.e - fm.e) * fn.e > 0) fn = { n: -fn.n, e: -fn.e };
      const k = this.phase / 3;
      const off = ((k % 7) - 3) * 30;
      const park = v(fm.n + fn.n * (150 + 40 * Math.floor(k / 7)) + (fb.n - fa.n) / fl * off, fm.e + fn.e * (150 + 40 * Math.floor(k / 7)) + (fb.e - fa.e) / fl * off);
      if (hypot2(park.n - me.n, park.e - me.e) < 25) return { p: park, label: 'clear of the course', lineWall: false, depower: 1, hold: true };
      return { p: park, label: 'clear of the course', lineWall: false, depower: 0.3 };
    }

    const cm = W.committee;
    const startAt = cm.startTime;
    const beforeSignal = cm.recalling || t < startAt - 1e-9;
    if (beforeSignal) {
      const tau = cm.recalling ? Infinity : startAt - t;
      const wind0 = this.windWater(sim);
      const beat0 = W.polar.beat(wind0.speed);
      let h0 = wind0.dir - beat0.twa;
      if (dirOf(h0).n * nc.n + dirOf(h0).e * nc.e < 0.35) h0 = Math.atan2(nc.e, nc.n);
      // Keep both the spot and the approach point 25 m below it well inside the line (no barging round the ends).
      const offA = (-25 * (Math.cos(h0) * u.n + Math.sin(h0) * u.e)) / L;
      const lo = Math.max(0.2, 0.2 - offA);
      const hi = Math.min(0.8, 0.8 - offA);
      const spot = onLine(lo <= hi ? clamp(this.skill.lineFraction, lo, hi) : 0.5);
      // Hold near the boat's own starting slot (the slots are spread in rows behind the line), then make a
      // timed run to its own spot on the line; spots follow the slots' order along the line.
      const hold = this.holdPoint;
      const wind = this.windWater(sim);
      const beat = W.polar.beat(wind.speed);
      // Final approach close-hauled on starboard from an approach point 25 m below the spot (if starboard
      // close-hauled heads for the course side; otherwise straight at the line).
      let hApp = wind.dir - beat.twa;
      const dApp = dirOf(hApp);
      if (dApp.n * nc.n + dApp.e * nc.e < 0.35) hApp = Math.atan2(nc.e, nc.n);
      const da = dirOf(hApp);
      const appr = v(spot.n - da.n * 25, spot.e - da.e * 25);
      const beforeAppr = (me.n - appr.n) * da.n + (me.e - appr.e) * da.e < -3 && !this.onFinalApproach;
      const leg1 = beforeAppr ? hypot2(appr.n - me.n, appr.e - me.e) : 0;
      const from = beforeAppr ? appr : me;
      const twa1 = beforeAppr ? Math.abs(wrapPi(wind.dir - bearing(me, appr))) : beat.twa;
      const v1 = W.polar.speed(wind.speed, Math.max(twa1, beat.twa)) * Math.cos(Math.max(0, beat.twa - twa1)) * 0.85;
      const leg2 = hypot2(spot.n - from.n, spot.e - from.e);
      const slow = hypot2(sim.state.u, sim.state.v) < 0.5 * beat.speed;
      const need = leg1 / Math.max(0.5, v1) + leg2 / Math.max(0.5, beat.speed * 0.85) + (slow ? 8 : 2) + this.skill.startLateS;
      if (tau > need + 15) {
        const dh = hypot2(hold.n - me.n, hold.e - me.e);
        if (dh < 15 || (t < this.holdUntil && dh < 30)) {
          this.holdUntil = t + 6;
          return { p: hold, label: 'holding behind the line', lineWall: true, depower: 0.9, hold: true };
        }
        return { p: hold, label: 'to the starting position', lineWall: true, depower: tau > need + 60 ? 0.4 : 0 };
      }
      if (beforeAppr) return { p: appr, label: 'timed run: to the approach', lineWall: true, depower: 0, arriveAt: startAt + this.skill.startLateS };
      this.onFinalApproach = true;
      return { p: spot, label: 'timed run at the line', lineWall: true, depower: 0, arriveAt: startAt + this.skill.startLateS };
    }
    this.onFinalApproach = false;

    if (judge.phase === 'pre-start') {
      if (judge.ocs) {
        const f = clamp(along(me), 0.2, 0.8);
        return { p: behind(onLine(f), 18), label: 'over early: returning', lineWall: false, depower: 0 };
      }
      // Not started yet: if on the course side (e.g. round the end of the line), go back behind the line first.
      const ahead = (me.n - A.n) * nc.n + (me.e - A.e) * nc.e;
      const f = clamp(along(me), 0.25, 0.75);
      if (ahead > -4 && (this.returning || ahead > -1)) {
        this.returning = true;
        return { p: behind(onLine(f), 15), label: 'not started: back behind the line', lineWall: false, depower: 0 };
      }
      this.returning = false;
      const target = onLine(f);
      return { p: v(target.n + nc.n * 10, target.e + nc.e * 10), label: 'starting', lineWall: false, depower: 0 };
    }

    if (judge.phase === 'racing') {
      const leg = course.legs[judge.legIndex];
      if (judge.legIndex !== this.lastLeg) {
        // Just completed a leg: remember the mark to leave astern.
        const prev = course.legs[this.lastLeg];
        if (prev && prev.leg.type === 'mark') this.recent = { c: prev.target, sign: prev.rounding === 'port' ? 1 : -1, radius: this.skill.roundRadius, t };
        this.lastLeg = judge.legIndex;
      }
      if (leg) {
        if (leg.leg.type === 'gate') {
          const [g1, g2] = leg.points as [LocalPoint, LocalPoint];
          return { p: v((g1.n + g2.n) / 2, (g1.e + g2.e) / 2), label: `gate ${leg.label}`, lineWall: false, depower: 0 };
        }
        const c = leg.target;
        const sign: 1 | -1 = leg.rounding === 'port' ? 1 : -1;
        const R = this.skill.roundRadius;
        // Apex: the point the boat passes, on the outside of the turn.
        const din = { n: c.n - leg.prev.n, e: c.e - leg.prev.e };
        const dout = { n: leg.next.n - c.n, e: leg.next.e - c.e };
        const li = hypot2(din.n, din.e) || 1;
        const lo = hypot2(dout.n, dout.e) || 1;
        let a = { n: din.n / li - dout.n / lo, e: din.e / li - dout.e / lo };
        let la = hypot2(a.n, a.e);
        if (la < 0.3) {
          // Passing straight on: leave it on the required side (port mark: pass to the right of it).
          a = sign > 0 ? { n: -din.e / li, e: din.n / li } : { n: din.e / li, e: -din.n / li };
          la = 1;
        }
        const apex = v(c.n + (a.n / la) * R, c.e + (a.e / la) * R);
        return { p: apex, label: `${leg.label} (${leg.rounding})`, round: { c, sign, radius: R }, lineWall: false, depower: 0 };
      }
      // Finish: the nearest point of the line, away from its ends.
      const [fa, fb] = course.finish;
      const fd = { n: fb.n - fa.n, e: fb.e - fa.e };
      const fl2 = fd.n * fd.n + fd.e * fd.e || 1;
      const f = clamp(((me.n - fa.n) * fd.n + (me.e - fa.e) * fd.e) / fl2, 0.2, 0.8);
      const fp = v(fa.n + fd.n * f, fa.e + fd.e * f);
      // Aim a little beyond the line so the boat crosses it.
      const side = Math.sign(cross(fa, fb, me)) || 1;
      const nrm = { n: -fd.e / Math.sqrt(fl2), e: fd.n / Math.sqrt(fl2) };
      const s2 = Math.sign(cross(fa, fb, v(fp.n + nrm.n, fp.e + nrm.e)));
      const k = s2 === side ? -8 : 8;
      return { p: v(fp.n + nrm.n * k, fp.e + nrm.e * k), label: 'finish', lineWall: false, depower: 0 };
    }
    return { p: me, label: 'finished', lineWall: false, depower: 1, hold: true };
  }

  /** Hold position: luff on a close reach on the current side with the sails eased (drifting slowly). */
  private holdCommand(sim: Simulation, windDir: number, beatTwa: number, goal: Goal): Command {
    const s = sim.state;
    const twaNow = wrapPi(windDir - s.psi);
    const side: 1 | -1 = Math.abs(twaNow) > 3 * DEG ? (twaNow > 0 ? 1 : -1) : this.side;
    return { mode: 'twa', target: side * Math.max(beatTwa + 25 * DEG, 70 * DEG), depower: goal.depower };
  }

  /** Heading to make good a ground track along `track`, allowing for the current and leeway (iterated). */
  private crab(track: number, wind: { dir: number; speed: number; cur: NE }): number {
    const right = { n: -Math.sin(track), e: Math.cos(track) };
    const cPerp = wind.cur.n * right.n + wind.cur.e * right.e;
    let h = track;
    for (let i = 0; i < 3; i++) {
      const twa = wrapPi(wind.dir - h);
      const spd = Math.max(0.5, this.world.polar.speed(wind.speed, twa));
      // Point higher by the leeway (the boat slides to leeward) and into the cross-current.
      h = track - Math.asin(clamp(cPerp / spd, -0.9, 0.9)) + Math.sign(twa) * this.leewayAt(twa);
    }
    return h;
  }

  /** Leeway (rad, positive) expected at a true wind angle: measured upwind, fading out by a broad reach. */
  private leewayAt(twa: number): number {
    const a = Math.abs(twa);
    return a < 80 * DEG ? this.leeway : a > 125 * DEG ? 0 : this.leeway * (125 * DEG - a) / (45 * DEG);
  }

  /** Ground velocity sailing at TWA `twa` (signed) in this wind and current, with leeway. */
  private groundVel(wind: { dir: number; speed: number; cur: NE }, twa: number): NE {
    const course = wind.dir - twa - Math.sign(twa) * this.leewayAt(twa);
    const spd = this.world.polar.speed(wind.speed, twa);
    return { n: spd * Math.cos(course) + wind.cur.n, e: spd * Math.sin(course) + wind.cur.e };
  }

  private navigate(sim: Simulation, me: LocalPoint, goal: Goal, wind: { dir: number; speed: number; cur: NE }, beatTwa: number, runTwa: number, twaNow: number, sc: Scorer): Command {
    const t = sim.time;
    const sk = this.skill;
    let track = bearing(me, goal.p);
    // Rounding: steer for the tangent of the circle on the required side, then follow it round.
    const r = goal.round;
    if (r) track = this.circleTrack(me, r);
    // Leave the mark just rounded astern before turning for the next point.
    if (this.recent) {
      const rc = this.recent;
      const d = hypot2(rc.c.n - me.n, rc.c.e - me.e);
      if (d > 6 * rc.radius || t - rc.t > 90) this.recent = undefined;
      else if (segmentCircle(me, goal.p, rc.c, rc.radius * 0.9)) track = this.circleTrack(me, rc);
    }
    const hReq = this.crab(track, wind);
    const twaReq = wrapPi(wind.dir - hReq);
    const sideReq: 1 | -1 = twaReq >= 0 ? 1 : -1;
    const switching = sideReq !== this.side;
    const upLimit = beatTwa + (switching ? sk.overstandDeg * DEG : -1 * DEG);
    const downLimit = runTwa + (switching ? -5 * DEG : 4 * DEG);
    const bias = sk.twaBiasDeg * DEG;
    // No tacking right next to the mark being rounded, or within 15 m of any mark or the committee boat (the
    // boat would stall beside it): carry on and tack when clear.
    const nearMark = (!!r && hypot2(r.c.n - me.n, r.c.e - me.e) < 2 * r.radius) || this.world.obstacles.some((o) => hypot2(o.n - me.n, o.e - me.e) < 15 + o.radius);
    const tackNearMark = nearMark && passesHeadToWind(sim.state.psi, hReq, wind.dir);
    if (Math.abs(twaReq) >= upLimit && Math.abs(twaReq) <= downLimit) {
      if (!switching || (!tackNearMark && !this.blockedByTraffic(sc, t, hReq, sim.state.psi))) return { mode: 'heading', target: hReq, depower: 0 };
    }

    // Upwind (beat) or downwind (run); a direct heading refused for traffic keeps to the nearer of the two.
    const upwind = Math.abs(twaReq) < upLimit || (Math.abs(twaReq) <= downLimit && Math.abs(twaReq) < Math.PI / 2);
    const angle = upwind ? beatTwa : runTwa;
    // Which tack (or gybe)? Sail the one whose track points nearer the goal; change with hysteresis.
    let target = goal.p;
    let brg = track;
    // A mark that cannot be laid: approach it on the tack (or gybe) that leaves it on the required side
    // (starboard for a port rounding, port for a starboard one), aiming beside it, and tack (gybe) for that
    // approach on its layline with the skill's overstand.
    let locked = false;
    let side = this.side;
    const canChange = t - this.lastTack > sk.minTackS;
    if (r) {
      const sFinal = r.sign;
      const hF = wind.dir - sFinal * angle;
      const pn = dirOf(hF + (sFinal * Math.PI) / 2);
      target = v(r.c.n + pn.n * r.radius, r.c.e + pn.e * r.radius);
      brg = bearing(me, target);
      const gF = this.groundVel(wind, sFinal * angle);
      const fetch = (upwind ? -sFinal : sFinal) * wrapPi(brg - Math.atan2(gF.e, gF.n));
      const near = hypot2(target.n - me.n, target.e - me.e) < Math.max(60, 6 * r.radius);
      if (side !== sFinal && fetch >= sk.overstandDeg * DEG && t - this.lastTack > 4) {
        side = sFinal;
        locked = true;
      } else if (side === sFinal && fetch >= -1 * DEG) locked = true;
      else if (side === sFinal && near && fetch < -3 * DEG && t - this.lastTack > 6) {
        // Below the layline close to the mark: tack (gybe) away and come back on the layline.
        side = sFinal === 1 ? -1 : 1;
        locked = true;
      } else if (side !== sFinal && near) locked = true; // keep going until the layline

    }
    const off = (sideX: 1 | -1) => {
      const g = this.groundVel(wind, sideX * angle);
      return Math.abs(wrapPi(Math.atan2(g.e, g.n) - brg));
    };
    if (!locked) {
      const dOff = off(side) - off(side === 1 ? -1 : 1);
      if (canChange && dOff > 2 * sk.shiftDeg * DEG) side = side === 1 ? -1 : 1;
      // Cone: do not stray too far either side of the line to the goal.
      const dist = hypot2(target.n - me.n, target.e - me.e);
      const axis = upwind ? wind.dir + Math.PI : wind.dir; // direction from the goal back along the wind axis
      const lateral = (me.n - target.n) * -Math.sin(axis) + (me.e - target.e) * Math.cos(axis);
      const g = this.groundVel(wind, side * angle);
      const goingOut = lateral * (g.n * -Math.sin(axis) + g.e * Math.cos(axis)) > 0;
      if (canChange && goingOut && Math.abs(lateral) > Math.max(45, 0.45 * dist)) side = side === 1 ? -1 : 1;
    }
    // Hazard ahead on this tack (shallow water, boundary, moorings, the line before the start): change.
    if (t - this.lastTack > 4 && this.hazardAhead(sim, me, wind, side * angle, goal)) side = side === 1 ? -1 : 1;
    if (nearMark && upwind) side = this.side; // no tacks near marks (see above)
    // Too slow to tack cleanly (it would stall head to wind): build speed first, unless a hazard forces it.
    if (side !== this.side && upwind && hypot2(sim.state.u, sim.state.v) < 0.6 * this.world.polar.beat(wind.speed).speed && !(t - this.lastTack > 4 && this.hazardAhead(sim, me, wind, this.side * angle, goal))) side = this.side;
    // Traffic: do not tack (gybe) into another boat's way; wait until it is clear.
    if (side !== this.side && this.blockedByTraffic(sc, t, wind.dir - side * angle, wind.dir - this.side * angle)) side = this.side;
    if (side !== this.side) {
      this.lastTack = t;
      this.side = side;
    }
    return { mode: 'twa', target: side * (angle + (upwind ? bias : -bias)), depower: 0 };
  }

  /**
   * Should a tack or gybe onto heading `h` wait for traffic? Only if it is clearly riskier than carrying on
   * (`hStay`), and for at most 20 s (then the avoidance layer deals with it), so two boats cannot wait for
   * each other for ever.
   */
  private blockedByTraffic(sc: Scorer, t: number, h: number, hStay: number): boolean {
    const risky = sc.score(h, false, 0, 'boats') > Math.max(0.3, sc.score(hStay, false, 0, 'boats') + 0.3);
    if (!risky) {
      this.blockedSince = undefined;
      return false;
    }
    this.blockedSince ??= t;
    return t - this.blockedSince < 20;
  }

  /** Track direction to follow a circle round a mark (port rounding = anticlockwise, mark on the left). */
  private circleTrack(me: LocalPoint, r: { c: LocalPoint; sign: 1 | -1; radius: number }): number {
    const d = hypot2(r.c.n - me.n, r.c.e - me.e);
    const b = bearing(me, r.c);
    if (d > r.radius) return b + r.sign * Math.asin(r.radius / d);
    return b + r.sign * (Math.PI / 2 + ((r.radius - d) / r.radius) * 40 * DEG);
  }

  private depthOk(t: number, p: LocalPoint, margin = 0.5): boolean {
    const sb = this.world.seabed;
    if (!sb) return true;
    return this.world.waterLevel(t) - sb.bedElevation(p.n, p.e) > this.world.draft + margin;
  }

  private nearMoorings: MooringArea[] = [];
  private nearMooringsAt?: LocalPoint;

  private inMoorings(p: LocalPoint): boolean {
    for (const a of this.nearMoorings) if (pointInPolygon(p, a.ring)) return true;
    return false;
  }

  /** Mooring areas within 400 m (refreshed when the boat has moved 100 m). */
  private refreshMoorings(me: LocalPoint): void {
    if (this.nearMoorings.length === 0 && this.world.mooringAreas.length === 0) return;
    if (this.nearMooringsAt && hypot2(me.n - this.nearMooringsAt.n, me.e - this.nearMooringsAt.e) < 100) return;
    this.nearMooringsAt = me;
    this.nearMoorings = this.world.mooringAreas.filter((a) => a.ring.some((q) => hypot2(q.n - me.n, q.e - me.e) < 400));
  }

  /** Does the path a→b cross a course boundary? */
  private crossesBoundary(a: LocalPoint, b: LocalPoint): boolean {
    for (const bd of this.world.course.boundaries) if (segmentCrossing(a, b, bd.a, bd.b) !== null) return true;
    return false;
  }

  /** Before the start signal: would the bow cross the starting line (or its extensions) on this path? */
  private crossesLine(bow: LocalPoint, vel: NE, seconds: number): boolean {
    if (seconds <= 0) return false;
    const [A, B] = this.world.course.start;
    const ext = 150;
    const L = hypot2(B.n - A.n, B.e - A.e) || 1;
    const ux = (B.n - A.n) / L;
    const uy = (B.e - A.e) / L;
    const end = v(bow.n + vel.n * seconds, bow.e + vel.e * seconds);
    return segmentCrossing(bow, end, v(A.n - ux * ext, A.e - uy * ext), v(B.n + ux * ext, B.e + uy * ext)) !== null;
  }

  /** Seconds left before the start signal during which the line is a wall (0 = no wall). */
  private wallTime(t: number, goal: Goal): number {
    if (!goal.lineWall) return 0;
    const cm = this.world.committee;
    return cm.recalling ? 8 : Math.max(0, cm.startTime - t);
  }

  /** Distance (m) along the ground track at TWA `twa` to the first hazard (shallow water, boundary, moorings, the line before the start), up to 60 m. */
  private hazardDistance(sim: Simulation, me: LocalPoint, wind: { dir: number; speed: number; cur: NE }, twa: number, goal: Goal): number {
    const g = this.groundVel(wind, twa);
    const sp = Math.max(0.5, hypot2(g.n, g.e));
    const ux = g.n / sp;
    const uy = g.e / sp;
    const meIn = this.inMoorings(me);
    const wall = Math.min(this.wallTime(sim.time, goal), 20);
    let prev = me;
    for (let d = 5; d <= 60; d += 5) {
      const p = v(me.n + ux * d, me.e + uy * d);
      if (!this.depthOk(sim.time, p)) return d;
      if (!meIn && this.inMoorings(p)) return d;
      if (this.crossesBoundary(prev, p)) return d;
      if (wall > 0 && d / sp < wall && this.crossesLine(prev, { n: p.n - prev.n, e: p.e - prev.e }, 1)) return d;
      prev = p;
    }
    return Infinity;
  }

  /** Is there a hazard close ahead on this tack, with more room on the other one? */
  private hazardAhead(sim: Simulation, me: LocalPoint, wind: { dir: number; speed: number; cur: NE }, twa: number, goal: Goal): boolean {
    const here = this.hazardDistance(sim, me, wind, twa, goal);
    const speed = hypot2(sim.state.u, sim.state.v);
    if (here > Math.max(15, 7 * speed)) return false;
    return this.hazardDistance(sim, me, wind, -twa, goal) > here;
  }

  /**
   * Choose the final heading: the tactical one unless something is in the way. Candidate headings every 5°
   * (plus "slow down" on the present and tactical headings) are each simulated for 12 s with a simple
   * kinematic model (a brisk turn rate, speed easing towards the polar speed, nearly stopping through
   * head to wind, leeway, current). Other boats are extrapolated with their present speed and turn rate.
   * Each candidate is scored for deviation, manoeuvres, closeness to other boats (keeping clear when the
   * simplified rules say so, or while tacking or gybing; otherwise only a last-moment avoidance), marks,
   * ferries, shallow water, mooring areas and boundaries, plus a small preference for the escape chosen last
   * time so the boat commits to it.
   */
  private makeScorer(sim: Simulation, me: LocalPoint, goal: Goal, wind: { dir: number; speed: number; cur: NE }, beatTwa: number): Scorer {
    const W = this.world;
    const t = sim.time;
    const s = sim.state;
    const mine = W.rulesBoat(this.id);
    const DT = 0.5;
    const K = 24;
    // Other boats: extrapolated tracks (turning at their present rate for up to 3 s).
    const others: { x: Float64Array; giveWay: boolean; d: number }[] = [];
    for (const b of W.fleet.boats) {
      if (b.id === this.id) continue;
      const bs = b.sim.state;
      const d = hypot2(bs.n - me.n, bs.e - me.e);
      if (d > 70) continue;
      const giveWay = this.keepsClearOf(b, mine);
      const cur = sim.env.current(t, bs.n, bs.e);
      const spd = hypot2(bs.u, bs.v);
      const drift = Math.atan2(bs.v, bs.u);
      // Two hypotheses: she holds her present heading, or she keeps turning at her present rate for 3 s.
      const extrapolate = (rate: number): Float64Array => {
        const x = new Float64Array(2 * (K + 1));
        let n = bs.n;
        let e = bs.e;
        let h = bs.psi;
        x[0] = n;
        x[1] = e;
        for (let k = 1; k <= K; k++) {
          if (k * DT <= 3) h += rate * DT;
          n += (spd * Math.cos(h + drift) + cur.n) * DT;
          e += (spd * Math.sin(h + drift) + cur.e) * DT;
          x[2 * k] = n;
          x[2 * k + 1] = e;
        }
        return x;
      };
      others.push({ x: extrapolate(0), giveWay, d });
      if (Math.abs(bs.r) > 1 * DEG) others.push({ x: extrapolate(bs.r), giveWay, d });
    }
    const ferryNear = W.fleet.nearFerries(me.n, me.e);
    const ferries = ferryNear ? W.fleet.ferriesAt(t) : [];
    const fsoon = ferryNear ? W.fleet.ferriesAt(t + 1) : [];
    const meIn = this.inMoorings(me);
    const r = goal.round;
    const wall = this.wallTime(t, goal);
    const stw0 = hypot2(s.u, s.v);
    const tr = new Float64Array(2 * (K + 1));
    // Polar speeds at this wind speed, per degree of TWA (one lookup table per decision).
    const spTab = new Float64Array(182);
    for (let a = 0; a <= 181; a++) spTab[a] = W.polar.speed(wind.speed, Math.min(180, a) * DEG);
    const polarAt = (twa: number) => {
      const x = Math.abs(twa) / DEG;
      const i = Math.min(180, Math.floor(x));
      return spTab[i]! + (spTab[i + 1]! - spTab[i]!) * (x - i);
    };
    /** Simulate a candidate; returns whether it tacks or gybes, and fills `tr`. */
    const track = (h: number, slow: boolean): { tack: boolean; gybe: boolean; speed: number } => {
      let hh = s.psi;
      let sp = stw0;
      let n = me.n;
      let e = me.e;
      let tack = false;
      let gybe = false;
      tr[0] = n;
      tr[1] = e;
      const turn = wrapPi(h - hh);
      const dir = Math.sign(turn);
      let left = Math.abs(turn);
      for (let k = 1; k <= K; k++) {
        // Turn rate: deliberately optimistic (the physics gives ~5.3°/s per m/s): a prediction that assumes a
        // brisk turn makes the boat start avoiding earlier and further, which tested far better (fewer contacts).
        const rate = clamp(6 + 7 * sp, 6, 22) * DEG * DT;
        const step = Math.min(left, rate);
        const before = wrapPi(wind.dir - hh);
        hh += dir * step;
        left -= step;
        const twa = wrapPi(wind.dir - hh);
        if (Math.sign(twa) !== Math.sign(before)) {
          if (Math.abs(twa) < Math.PI / 2) tack = true;
          else gybe = true;
        }
        const target = Math.abs(twa) < beatTwa - 6 * DEG ? 0 : polarAt(twa) * (slow ? 0.35 : 1);
        sp += (target - sp) * (DT / (target > sp ? 6 : Math.abs(twa) < beatTwa - 6 * DEG ? 3 : 8));
        const course = hh - Math.sign(twa) * this.leewayAt(twa);
        n += (sp * Math.cos(course) + wind.cur.n) * DT;
        e += (sp * Math.sin(course) + wind.cur.e) * DT;
        tr[2 * k] = n;
        tr[2 * k + 1] = e;
      }
      return { tack, gybe, speed: sp };
    };
    const prev = this.avoidHeading;
    /**
     * mode 'full': deviation, commitment, manoeuvre and risk; 'risk': only the risks (boats, marks, ferries,
     * depth, moorings, walls); 'boats': only the other boats.
     */
    const score = (h: number, slow: boolean, devCost: number, mode: 'full' | 'risk' | 'boats' = 'full'): number => {
      const m = track(h, slow);
      const full = mode === 'full';
      const boatsOnly = mode === 'boats';
      let cost = full ? devCost + (slow ? 0.3 : 0) : 0;
      if (prev !== undefined && full) cost += (0.25 * Math.abs(wrapPi(h - prev))) / Math.PI;
      const manoeuvre = m.tack || m.gybe;
      if (full && m.tack) cost += 0.25;
      if (full && m.gybe) cost += 0.15;
      // Other boats: closest approach along the tracks.
      for (const o of others) {
        const giveWay = o.giveWay || manoeuvre;
        const need = manoeuvre ? 18 : giveWay ? 16 : 10;
        const T = giveWay ? K : 14; // stand-on boats react only to what is about to happen (rule 14)
        let worst = 0;
        for (let k = 1; k <= T; k++) {
          const d = hypot2(tr[2 * k]! - o.x[2 * k]!, tr[2 * k + 1]! - o.x[2 * k + 1]!);
          if (d < need) worst = Math.max(worst, ((need - d) / need) * (1 - (k * DT) / (T * DT + 2)));
        }
        cost += (giveWay ? 5 : 8) * worst;
      }
      if (boatsOnly) return cost;
      // Marks and the committee boat.
      for (const mk of W.obstacles) {
        if (Math.abs(mk.n - me.n) > 80 || Math.abs(mk.e - me.e) > 80) continue;
        const rounding = r && hypot2(mk.n - r.c.n, mk.e - r.c.e) < 0.5;
        // The ends of the starting line (committee boat, pin) are where boats bunch up: keep well clear.
        const lineEnd = this.lineEnds.has(mk.id);
        const need = mk.radius + (rounding ? 4 : lineEnd ? 9 : 7);
        let worst = 0;
        for (let k = 1; k <= 16; k++) {
          const d = hypot2(tr[2 * k]! - mk.n, tr[2 * k + 1]! - mk.e);
          if (d < need) worst = Math.max(worst, ((need - d) / need) * (1 - k / 20));
        }
        cost += (lineEnd ? 9 : 5) * worst;
      }
      // Ferries (restricted in ability to manoeuvre): keep well clear.
      ferries.forEach((f, i) => {
        if (Math.abs(f.n - me.n) > 300 || Math.abs(f.e - me.e) > 300) return;
        const fv = { n: fsoon[i]!.n - f.n, e: fsoon[i]!.e - f.e };
        const need = f.length / 2 + 25;
        let worst = 0;
        for (let k = 2; k <= K; k += 2) {
          const d = hypot2(tr[2 * k]! - (f.n + fv.n * k * DT), tr[2 * k + 1]! - (f.e + fv.e * k * DT));
          if (d < need) worst = Math.max(worst, (need - d) / need);
        }
        cost += 5 * worst;
      });
      // Water depth and moorings along the track, and a look further ahead on the final heading.
      const end = { n: tr[2 * K]!, e: tr[2 * K + 1]! };
      const ahead = Math.max(10, m.speed * 4);
      const probes: [LocalPoint, number][] = [
        [{ n: tr[2 * 6]!, e: tr[2 * 6 + 1]! }, 1],
        [{ n: tr[2 * 12]!, e: tr[2 * 12 + 1]! }, 0.8],
        [end, 0.5],
        [v(end.n + Math.cos(h) * ahead, end.e + Math.sin(h) * ahead), 0.3],
      ];
      for (const [p, wgt] of probes) {
        if (!this.depthOk(t, p)) cost += 6 * wgt;
        if (!meIn && this.inMoorings(p)) cost += 3 * wgt;
      }
      if (this.crossesBoundary(me, { n: tr[2 * 16]!, e: tr[2 * 16 + 1]! })) cost += 4;
      if (wall > 0) {
        const kw = Math.min(K, Math.floor(Math.min(wall, 10) / DT));
        if (kw > 0) {
          const bowEnd = v(tr[2 * kw]! + 3 * Math.cos(h), tr[2 * kw + 1]! + 3 * Math.sin(h));
          if (this.crossesLine(v(me.n + 3 * Math.cos(s.psi), me.e + 3 * Math.sin(s.psi)), { n: bowEnd.n - me.n, e: bowEnd.e - me.e }, 1)) cost += 6;
        }
      }
      return cost;
    };
    return { score, prev };
  }

  private avoid(sim: Simulation, sc: Scorer, nav: Command, wind: { dir: number; speed: number; cur: NE }, beatTwa: number): Command {
    if (nav.mode === 'helm') return nav;
    const s = sim.state;
    const { score } = sc;
    const hNav = nav.mode === 'heading' ? nav.target : wind.dir - nav.target;
    // The tactical heading stands whenever it carries no real risk.
    const risk = score(hNav, false, 0, 'risk');
    if (risk < 0.05) {
      this.avoidHeading = undefined;
      return nav;
    }
    // Otherwise compare: the tactical heading pays only its risk; alternatives pay deviation, manoeuvres
    // and (to commit to an escape) any change from the last one, as well as their risk.
    let best = hNav;
    let bestSlow = false;
    let bestCost = risk;
    const consider = (h: number, slow: boolean, dev: number) => {
      const c = score(h, slow, dev);
      if (c < bestCost - 1e-9) {
        bestCost = c;
        best = h;
        bestSlow = slow;
      }
    };
    // Coarse pass every 10°, then 5° either side of the two best.
    const coarse: [number, number][] = [];
    for (let k = -17; k <= 18; k++) {
      if (k === 0) continue;
      const h = hNav + k * 10 * DEG;
      if (Math.abs(wrapPi(wind.dir - h)) < beatTwa - 4 * DEG) continue;
      const c = score(h, false, (Math.abs(k) * 10) / 180);
      coarse.push([c, k * 2]);
      if (c < bestCost - 1e-9) {
        bestCost = c;
        best = h;
        bestSlow = false;
      }
    }
    coarse.sort((a, b) => a[0] - b[0]);
    for (const [, k2] of coarse.slice(0, 2)) {
      for (const dk of [-1, 1]) {
        const k = k2 + dk;
        if (k === 0) continue;
        const h = hNav + k * 5 * DEG;
        if (Math.abs(wrapPi(wind.dir - h)) < beatTwa - 4 * DEG) continue;
        consider(h, false, (Math.abs(k) * 5) / 180);
      }
    }
    // Slowing down is an escape only with way on (a slow boat cannot steer).
    if (hypot2(s.u, s.v) > 1.2) {
      consider(hNav, true, 0);
      consider(s.psi, true, Math.abs(wrapPi(s.psi - hNav)) / Math.PI);
    }
    this.avoidHeading = best === hNav && !bestSlow ? undefined : best;
    if (this.avoidHeading !== undefined) this.intent += ' · avoiding';
    const depower = bestSlow ? Math.max(nav.depower, 0.7) : nav.depower;
    const twaBest = wrapPi(wind.dir - best);
    if (best === hNav) return { ...nav, depower };
    if (Math.abs(twaBest) < beatTwa + 2 * DEG) return { mode: 'twa', target: (Math.sign(twaBest) || this.side) * beatTwa, depower };
    return { mode: 'heading', target: best, depower };
  }

  /**
   * Pre-start speed control: ease the main while the boat would reach the line before `arriveAt` at full
   * power. Arrival at full power is predicted with a first-order speed-up (time constant ~6 s, E) from the
   * present speed to the close-hauled speed towards the line.
   */
  private startSpeedControl(sim: Simulation, me: LocalPoint, goal: Goal): Command['depower'] {
    const W = this.world;
    const [A, B] = W.course.start;
    const t = sim.time;
    const s = sim.state;
    if (t >= W.committee.startTime) return 0;
    const L = hypot2(B.n - A.n, B.e - A.e) || 1;
    let nc = { n: -(B.e - A.e) / L, e: (B.n - A.n) / L };
    const first = W.course.legs[0]!.target;
    if ((first.n - A.n) * nc.n + (first.e - A.e) * nc.e < 0) nc = { n: -nc.n, e: -nc.e };
    const bow = { n: me.n + 2.95 * Math.cos(s.psi), e: me.e + 2.95 * Math.sin(s.psi) };
    const dLine = -((bow.n - A.n) * nc.n + (bow.e - A.e) * nc.e);
    const tau = goal.arriveAt! - t;
    if (dLine < 2.5 && W.committee.startTime - t > 1) return 1;
    if (dLine <= 0) return 0;
    const wind = this.windWater(sim);
    const beat = W.polar.beat(wind.speed);
    const hApp = wind.dir - this.side * beat.twa;
    const vt = Math.max(0.3, beat.speed * Math.max(0.25, Math.cos(hApp) * nc.n + Math.sin(hApp) * nc.e));
    const thr = bodyToWorld(s.u, s.v, s.psi);
    const v0 = Math.max(0, thr.n * nc.n + thr.e * nc.e);
    const ta = 6;
    // Time to cover dLine: x(T) = vt·T − (vt − v0)·ta·(1 − e^(−T/ta)); bisection.
    let lo = 0;
    let hi = 300;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const x = vt * mid - (vt - v0) * ta * (1 - Math.exp(-mid / ta));
      if (x < dLine) lo = mid;
      else hi = mid;
    }
    return clamp((tau - hi) / 4, 0, 0.8);
  }
}

/** Does turning the short way from heading `from` to `to` pass through the wind direction (a tack)? */
function passesHeadToWind(from: number, to: number, windDir: number): boolean {
  const turn = wrapPi(to - from);
  const toWind = wrapPi(windDir - from);
  return turn > 0 ? toWind > 0 && toWind < turn : toWind < 0 && toWind > turn;
}

/** Does the segment a→b pass within r of c? */
function segmentCircle(a: LocalPoint, b: LocalPoint, c: LocalPoint, r: number): boolean {
  const dn = b.n - a.n;
  const de = b.e - a.e;
  const l2 = dn * dn + de * de;
  const s = l2 > 0 ? clamp(((c.n - a.n) * dn + (c.e - a.e) * de) / l2, 0, 1) : 0;
  return hypot2(a.n + s * dn - c.n, a.e + s * de - c.e) < r;
}
