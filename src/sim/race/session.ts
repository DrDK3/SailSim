import { DEG, wrapPi } from '../math/angles';
import { Simulation, type ControlInput, type InitialConditions } from '../simulation';
import { windFrom } from '../boat/forces';
import { groundContact } from '../boat/contact';
import type { BoatParams } from '../boat/params';
import type { Environment } from '../env/environment';
import type { FerryRoute } from '../env/ferries';
import type { RiverTraffic } from '../env/traffic';
import type { Seabed } from '../geo/dart';
import type { ResolvedCourse } from '../course/course';
import type { Course } from '../course/types';
import { CourseJudge, hullReferencePoints, type RaceEvent } from '../course/judge';
import type { MooringArea } from '../course/restrictions';
import { AiSkipper, aiSkill, type AiLevel, type AiWorld } from '../ai/skipper';
import { Polar } from '../ai/polar';
import { AI_POLAR } from '../ai/polarData';
import { CONTACT, Fleet, markRadius, type CircleObstacle, type ContactEvent, type FleetBoat, type MooredBoat } from './fleet';
import type { PierInput } from './piers';
import { placeOutline } from './hull';
import { DEFAULT_COMMITTEE, RaceCommittee, type BoatRaceStatus, type CommitteeOptions, type ResultRow, type Signal } from './committee';
import { PenaltyTracker, rightOfWay, TackTracker, type Incident, type RulesBoat } from './rules';
import { hypot2 } from '../math/hypot';

/**
 * One race: a fleet (the user's boat and/or AI boats) on a course, with the race committee, a course judge
 * per boat, the simplified rules subset and the AI skippers. Pure and deterministic: the same options and
 * the same user inputs give the same race. Used by the app, the tests and `npm run ai:trials`.
 */
export interface EntrySpec {
  id: string;
  name: string;
  sailNumber: string;
  colour: number;
  kind: 'human' | 'ai';
  initial: InitialConditions;
  level?: AiLevel;
}

export interface RaceSessionOptions {
  env: Environment;
  params: BoatParams;
  /** The user's boat when it is a different Squib type from the AI fleet (default: `params`). */
  humanParams?: BoatParams;
  seabed?: Seabed;
  course: Course;
  resolved: ResolvedCourse;
  committee: Partial<Omit<CommitteeOptions, 'startAt'>> & { startAt: number };
  entries: EntrySpec[];
  /** Controller for the human boat (the app's input sampling). */
  humanController?: (sim: Simulation) => Partial<ControlInput> | void;
  humanInput?: Partial<ControlInput>;
  moored?: MooredBoat[];
  ferries?: FerryRoute[];
  traffic?: RiverTraffic;
  /** Piers, jetties and pontoons (solid). */
  piers?: readonly PierInput[];
  mooringAreas?: MooringArea[];
  seed?: number;
}

export interface LogEntry {
  t: number;
  boat?: string;
  kind: 'signal' | 'race' | 'incident' | 'penalty';
  text: string;
}

const PAIR = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class RaceSession implements AiWorld {
  readonly fleet: Fleet;
  readonly committee: RaceCommittee;
  readonly course: ResolvedCourse;
  readonly courseDef: Course;
  readonly polar = new Polar(AI_POLAR);
  readonly seabed?: Seabed;
  readonly draft: number;
  readonly mooringAreas: MooringArea[];
  readonly obstacles: CircleObstacle[];
  readonly skippers = new Map<string, AiSkipper>();
  readonly incidents: Incident[] = [];
  readonly log: LogEntry[] = [];
  private judges = new Map<string, CourseJudge>();
  private trackers = new Map<string, TackTracker>();
  private penalties = new Map<string, { tracker: PenaltyTracker; incident: Incident }[]>();
  private retiredSet = new Set<string>();
  private rows = new Map<string, RulesBoat>();
  private rowsStep = -1;
  private lastIncident = new Map<string, number>();
  private headingHist = new Map<string, number[]>();
  private rowHistory = new Map<string, { holder: string; since: number }>();
  private readonly hull: ReturnType<typeof hullReferencePoints>;
  private readonly seed: number;

  constructor(readonly opts: RaceSessionOptions) {
    this.course = opts.resolved;
    this.courseDef = opts.course;
    this.seabed = opts.seabed;
    this.draft = opts.params.draft;
    this.mooringAreas = opts.mooringAreas ?? [];
    this.seed = opts.seed ?? 1;
    this.hull = hullReferencePoints(opts.params.loa, opts.params.beam);
    this.fleet = new Fleet(opts.env);
    // Physical marks (virtual lane posts are not).
    this.obstacles = [];
    for (const m of opts.course.marks) {
      const r = markRadius(m.kind);
      const p = opts.resolved.pos.get(m.id);
      if (r === null || !p) continue;
      const hard = m.kind === 'committee-boat' || m.kind === 'nav-buoy' || m.kind === 'fixed';
      this.obstacles.push({
        id: `mark-${m.id}`, label: m.name, kind: m.kind === 'committee-boat' ? 'committee-boat' : 'mark', n: p.n, e: p.e, radius: r,
        stiffness: hard ? CONTACT.hardStiffness : CONTACT.softStiffness, damping: hard ? CONTACT.hardDamping : CONTACT.softDamping,
      });
    }
    this.fleet.setObstacles({ marks: this.obstacles, moored: opts.moored, ferries: opts.ferries, traffic: opts.traffic, piers: opts.piers });
    const aiCount = opts.entries.filter((e) => e.kind === 'ai').length;
    let aiIndex = 0;
    for (const e of opts.entries) {
      const sim = new Simulation({
        params: e.kind === 'human' ? (opts.humanParams ?? opts.params) : opts.params,
        env: opts.env,
        seabed: opts.seabed,
        ownsEnvironment: false,
        initial: e.initial,
        input: e.kind === 'ai' ? { autoMain: true, autoJib: true, autoCrew: true } : opts.humanInput,
        // An AI boat's helm changes every step; its race is reproduced from the seed, not an input log.
        logInputs: e.kind !== 'ai',
      });
      const boat = this.fleet.add({ id: e.id, name: e.name, sailNumber: e.sailNumber, colour: e.colour, kind: e.kind, sim });
      if (e.kind === 'ai') {
        const sk = new AiSkipper(boat, this, aiSkill(e.level ?? 'good', this.seed, aiIndex, aiCount), aiIndex * 3);
        aiIndex++;
        this.skippers.set(e.id, sk);
        sim.controller = (s) => sk.control(s);
      } else if (opts.humanController) sim.controller = opts.humanController;
      const twa = this.twaOf(boat);
      this.trackers.set(e.id, new TackTracker(twa, sim.act.mainSide));
      this.headingHist.set(e.id, []);
    }
    // Each AI boat's spot on the starting line follows the order of the starting slots along the line.
    const [la, lb] = opts.resolved.start;
    const lineLen = hypot2(lb.n - la.n, lb.e - la.e) || 1;
    const alongOf = (b: FleetBoat) => ((b.sim.state.n - la.n) * (lb.n - la.n) + (b.sim.state.e - la.e) * (lb.e - la.e)) / lineLen;
    const ranked = [...this.fleet.boats].sort((x, y) => alongOf(x) - alongOf(y));
    ranked.forEach((b, i) => {
      const sk = this.skippers.get(b.id);
      if (sk) sk.skill.lineFraction = ranked.length > 1 ? 0.12 + (0.76 * i) / (ranked.length - 1) : 0.5;
    });
    const first = opts.resolved.legs[0]!.target;
    this.committee = new RaceCommittee({ ...DEFAULT_COMMITTEE, ...opts.committee }, opts.entries.map((e) => e.id), opts.resolved.start, first);
    this.resetJudges();
    for (const b of this.fleet.boats) this.judgeOf(b.id).update(0, this.pose(b));
    // Signals due now (a sequence that begins at once) are made before the first step, so the flags show.
    this.updateCommittee(this.time);
  }

  // ---------------------------------------------------------------- world

  get time(): number {
    return this.fleet.time;
  }

  judgeOf(id: string): CourseJudge {
    return this.judges.get(id)!;
  }

  waterLevel(t: number): number {
    return this.opts.env.waterLevel?.(t) ?? 0.1;
  }

  outOfRace(id: string): boolean {
    const j = this.judges.get(id);
    return this.retiredSet.has(id) || this.committee.bfd.has(id) || this.committee.ufd.has(id) || j?.phase === 'finished';
  }

  owesPenalty(id: string): number {
    const list = this.penalties.get(id);
    const p = list?.find((x) => !x.tracker.complete);
    return p ? p.tracker.required - p.tracker.done : 0;
  }

  rulesBoat(id: string): RulesBoat {
    if (this.rowsStep !== this.fleet.step) {
      this.rows.clear();
      this.rowsStep = this.fleet.step;
    }
    let r = this.rows.get(id);
    if (!r) {
      const b = this.fleet.boat(id)!;
      const s = b.sim.state;
      const tr = this.trackers.get(id)!;
      r = { id, n: s.n, e: s.e, heading: s.psi, twa: this.twaOf(b), mainSide: b.sim.act.mainSide, tack: tr.tack, tacking: tr.tacking, outline: placeOutline(b.outline, s.n, s.e, s.psi) };
      this.rows.set(id, r);
    }
    return r;
  }

  private twaOf(b: FleetBoat): number {
    const s = b.sim.state;
    const t = this.fleet.time;
    const w = this.opts.env.wind(t, s.n, s.e);
    const c = this.opts.env.current(t, s.n, s.e);
    return wrapPi(windFrom({ n: w.n - c.n, e: w.e - c.e }).fromDir - s.psi);
  }

  private pose(b: FleetBoat) {
    return { n: b.sim.state.n, e: b.sim.state.e, heading: b.sim.state.psi };
  }

  private resetJudges(): void {
    for (const b of this.fleet.boats) this.judges.set(b.id, new CourseJudge(this.course, this.hull, this.committee.signals));
  }

  // ----------------------------------------------------------------- step

  /** Advance the whole race one 10 ms step. */
  step(): void {
    const contacts = this.fleet.stepOnce();
    const t = this.fleet.time;
    // Tack state (rule 13) and penalty turns at 20 Hz (the boat turns at most ~1° in 0.05 s).
    const rulesTick = this.fleet.step % 5 === 0;
    for (const b of this.fleet.boats) {
      if (rulesTick) {
        const tr = this.trackers.get(b.id)!;
        const s = b.sim.state;
        const w = this.opts.env.wind(t, s.n, s.e);
        const c = this.opts.env.current(t, s.n, s.e);
        const ww = windFrom({ n: w.n - c.n, e: w.e - c.e });
        const twa = wrapPi(ww.fromDir - s.psi);
        tr.update(twa, b.sim.act.mainSide, this.polar.beat(ww.speed).twa);
        for (const p of this.penalties.get(b.id) ?? []) {
          if (p.tracker.complete) continue;
          p.tracker.update(s.psi, twa);
          if (p.tracker.complete) {
            p.incident.penaltyTaken = true;
            p.incident.penaltyTakenAt = t;
            this.log.push({ t, boat: b.id, kind: 'penalty', text: `${b.name} completed a ${p.tracker.required === 1 ? 'One-Turn' : 'Two-Turns'} Penalty` });
          }
          break; // one penalty at a time
        }
      }
      const evs = this.judgeOf(b.id).update(t, this.pose(b));
      for (const e of evs) this.logRace(b, e);
      if (this.fleet.step % 10 === 0) {
        const h = this.headingHist.get(b.id)!;
        h.push(b.sim.state.psi);
        if (h.length > 31) h.shift();
      }
    }
    if (this.fleet.step % 10 === 0) this.trackRightOfWay(t);
    for (const c of contacts) this.onContact(c);
    this.updateCommittee(t);
  }

  private updateCommittee(t: number): void {
    const sigs = this.committee.update(t, this.status(), (id) => {
      const b = this.fleet.boat(id)!;
      return placeOutline(b.outline, b.sim.state.n, b.sim.state.e, b.sim.state.psi);
    });
    for (const s of sigs) this.onSignal(s);
  }

  /** Run whole steps for `seconds`. */
  advance(seconds: number): void {
    const n = Math.round(seconds / 0.01);
    for (let i = 0; i < n; i++) this.step();
  }

  private onSignal(s: Signal): void {
    const t = s.t;
    const text: Record<Signal['name'], string> = {
      warning: 'Warning signal: class flag up (5 minutes)',
      preparatory: `Preparatory signal: flag ${this.committee.prepFlag === 'black' ? 'black' : this.committee.prepFlag} up`,
      'one-minute': `One minute: ${this.committee.opts.sequence === 'one-minute' ? 'class flag up' : 'preparatory flag down'} (long sound)`,
      start: 'Start: class flag down',
      'individual-recall': `Individual recall: flag X (${this.status().filter((x) => x.ocs).map((x) => this.fleet.boat(x.id)!.name).join(', ')})`,
      'x-down': 'Flag X down',
      'general-recall': 'General recall: First Substitute up',
      'first-substitute-down': 'First Substitute down: new warning signal in one minute',
    };
    this.log.push({ t, kind: 'signal', text: text[s.name] });
    if (s.name === 'first-substitute-down') {
      this.resetJudges();
      for (const b of this.fleet.boats) this.judgeOf(b.id).update(t, this.pose(b));
    }
    if (s.name === 'start') {
      for (const id of [...this.committee.ufd, ...this.committee.bfd]) {
        this.log.push({ t, boat: id, kind: 'race', text: `${this.fleet.boat(id)!.name}: in the triangle in the last minute (rule ${this.committee.ufd.has(id) ? '30.3, UFD' : '30.4, BFD'})` });
      }
    }
  }

  private logRace(b: FleetBoat, e: RaceEvent): void {
    const name = b.name;
    switch (e.type) {
      case 'ocs': this.log.push({ t: e.t, boat: b.id, kind: 'race', text: `${name} over the line at the start (OCS)` }); break;
      case 'ocs-cleared': this.log.push({ t: e.t, boat: b.id, kind: 'race', text: `${name} returned to the pre-start side` }); break;
      case 'start': this.log.push({ t: e.t, boat: b.id, kind: 'race', text: `${name} started` }); break;
      case 'rounded': this.log.push({ t: e.t, boat: b.id, kind: 'race', text: `${name} rounded ${e.label}` }); break;
      case 'gate': this.log.push({ t: e.t, boat: b.id, kind: 'race', text: `${name} through ${e.label}` }); break;
      case 'wrong-side': this.log.push({ t: e.t, boat: b.id, kind: 'race', text: `${name}: wrong way round ${e.label}` }); break;
      case 'boundary': this.log.push({ t: e.t, boat: b.id, kind: 'race', text: `${name} crossed ${e.label}` }); break;
      case 'finish': this.log.push({ t: e.t, boat: b.id, kind: 'race', text: `${name} finished` }); break;
      default: break;
    }
  }

  /** Who has right of way in each close pair, and since when (for the rule 15 note). */
  private trackRightOfWay(t: number): void {
    const boats = this.fleet.boats;
    for (let i = 0; i < boats.length; i++) {
      for (let j = i + 1; j < boats.length; j++) {
        const a = boats[i]!;
        const b = boats[j]!;
        const key = PAIR(a.id, b.id);
        if (hypot2(a.sim.state.n - b.sim.state.n, a.sim.state.e - b.sim.state.e) > 40) {
          this.rowHistory.delete(key);
          continue;
        }
        const row = rightOfWay(this.rulesBoat(a.id), this.rulesBoat(b.id));
        const h = this.rowHistory.get(key);
        if (!h || h.holder !== row.rightOfWay) this.rowHistory.set(key, { holder: row.rightOfWay, since: t });
      }
    }
  }

  private headingChange(id: string, seconds: number): number {
    const h = this.headingHist.get(id)!;
    const k = Math.min(h.length - 1, Math.round(seconds * 10));
    if (k <= 0) return 0;
    return Math.abs(wrapPi(h[h.length - 1]! - h[h.length - 1 - k]!));
  }

  private onContact(c: ContactEvent): void {
    const t = c.t;
    const key = c.kind === 'boat' ? PAIR(c.a, c.b) : `${c.a}|${c.b}`;
    const last = this.lastIncident.get(key);
    this.lastIncident.set(key, t);
    if (last !== undefined && t - last < 10) return; // the same incident (bouncing)
    const A = this.fleet.boat(c.a)!;
    const inc: Incident = { t, kind: c.kind === 'committee-boat' ? 'mark' : c.kind, boats: [c.a], summary: '', notes: [] };
    const racing = t >= (this.committee.signals.find((s) => s.name === 'preparatory')?.t ?? this.committee.signals[0]!.t);
    if (c.kind === 'boat') {
      const B = this.fleet.boat(c.b)!;
      inc.boats = [c.a, c.b];
      const row = rightOfWay(this.rulesBoat(c.a), this.rulesBoat(c.b));
      const kc = this.fleet.boat(row.keepClear)!;
      const rw = this.fleet.boat(row.rightOfWay)!;
      inc.summary = `Contact between ${A.name} and ${B.name} at ${c.speed.toFixed(1)} m/s`;
      if (racing && !this.outOfRace(c.a) && !this.outOfRace(c.b)) {
        inc.atFault = kc.id;
        inc.rule = row.rule;
        inc.penaltyTurns = 2;
        inc.penaltyTaken = false;
        inc.summary += `: ${kc.name} did not keep clear (rule ${row.rule}: ${row.reason}).`;
        inc.notes.push(`Rule 14 also applied to ${rw.name} (avoid contact if reasonably possible); not judged here.`);
        const h = this.rowHistory.get(PAIR(c.a, c.b));
        if (h && t - h.since < 5) inc.notes.push(`Right of way changed ${(t - h.since).toFixed(1)} s before contact: rule 15 (room to keep clear) may apply; not judged here.`);
        if (this.headingChange(rw.id, 3) > 15 * DEG) inc.notes.push(`${rw.name} changed course in the 3 s before contact: rule 16 may apply; not judged here.`);
        this.owePenalty(kc.id, 2, inc);
      } else inc.summary += racing ? ' (a boat no longer racing).' : ' (before the preparatory signal: Part 2 of the racing rules did not yet apply).';
    } else if (c.kind === 'mark' || c.kind === 'committee-boat') {
      inc.summary = `${A.name} touched ${c.label}`;
      const j = this.judgeOf(c.a);
      if (racing && j.phase !== 'finished' && this.markOfLeg(c.b, j)) {
        inc.atFault = c.a;
        inc.rule = '31';
        inc.penaltyTurns = 1;
        inc.penaltyTaken = false;
        inc.summary += ' (rule 31: One-Turn Penalty).';
        this.owePenalty(c.a, 1, inc);
      } else inc.summary += ' (not a mark of her current leg, or not racing: no rule 31 penalty).';
    } else {
      inc.summary = `${A.name} hit ${c.label} at ${c.speed.toFixed(1)} m/s`;
      inc.notes.push(c.kind === 'pier' ? 'A collision with a pier or pontoon: outside the racing-rules subset; counted as a collision.' : 'A collision with a non-racing vessel: outside the racing-rules subset; counted as a collision.');
    }
    this.incidents.push(inc);
    this.log.push({ t, boat: c.a, kind: 'incident', text: inc.summary });
  }

  /** Is the touched obstacle a mark that begins, bounds or ends the boat's current leg (or a start/finish mark)? */
  private markOfLeg(obstacleId: string, j: CourseJudge): boolean {
    const id = obstacleId.replace(/^mark-/, '');
    const c = this.courseDef;
    if (j.phase === 'pre-start') return c.start.ends.includes(id);
    const legs = this.course.legs;
    const ids = (k: number): string[] => {
      const l = legs[k];
      if (!l) return [];
      return l.leg.type === 'mark' ? [l.leg.mark] : [...l.leg.marks];
    };
    const near = [...ids(j.legIndex), ...ids(j.legIndex - 1)];
    if (j.legIndex === 0) near.push(...c.start.ends);
    if (j.legIndex >= legs.length) near.push(...c.finish.ends);
    return near.includes(id);
  }

  private owePenalty(id: string, turns: number, inc: Incident): void {
    const b = this.fleet.boat(id)!;
    const list = this.penalties.get(id) ?? [];
    list.push({ tracker: new PenaltyTracker(turns, b.sim.state.psi, this.twaOf(b)), incident: inc });
    this.penalties.set(id, list);
  }

  /** The user retires (RET). */
  retire(id: string): void {
    this.retiredSet.add(id);
    this.log.push({ t: this.time, boat: id, kind: 'race', text: `${this.fleet.boat(id)!.name} retired` });
  }

  // -------------------------------------------------------------- results

  status(): BoatRaceStatus[] {
    return this.fleet.boats.map((b) => {
      const j = this.judgeOf(b.id);
      return {
        id: b.id,
        started: j.startTime !== undefined,
        ocs: j.ocs,
        wasOcs: j.events.some((e) => e.type === 'ocs'),
        finished: j.phase === 'finished',
        finishTime: j.finishTime,
        startTime: j.startTime,
        retired: this.retiredSet.has(b.id),
      };
    });
  }

  results(): (ResultRow & { name: string; sailNumber: string; kind: 'human' | 'ai'; penalties: string })[] {
    return this.committee.results(this.status()).map((r) => {
      const b = this.fleet.boat(r.id)!;
      const owed = this.incidents.filter((i) => i.atFault === r.id);
      const pen = owed.length ? owed.map((i) => `rule ${i.rule}: ${i.penaltyTaken ? 'penalty taken' : 'no penalty taken'}`).join('; ') : '';
      return { ...r, name: b.name, sailNumber: b.sailNumber, kind: b.kind, penalties: pen };
    });
  }

  get finished(): boolean {
    return this.committee.finished;
  }

  /** Grounding: is any of the boat's bottom contact points (keel, forefoot, rudder heel) touching now? */
  grounded(id: string): boolean {
    const b = this.fleet.boat(id)!;
    if (!this.seabed) return false;
    const s = b.sim.state;
    const c = groundContact(b.sim.params, s, this.opts.env.current(this.time, s.n, s.e), { waterLevel: this.waterLevel(this.time), seabed: this.seabed });
    return c.grounded;
  }

  stateHash(): string {
    return this.fleet.stateHash();
  }
}
