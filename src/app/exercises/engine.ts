import type { TutorialSample, TutorialTarget } from '../tutorial';

/**
 * The exercise engine (training slice §7–§8): an exercise is a short unscored warm-up, then a few attempts at the
 * same task, each a sequence of phases with goals checked as you sail (as the lessons' steps are,
 * src/app/tutorial.ts). What it adds to the lessons:
 *
 * - Attempts: each starts the boat afresh (the controller restarts it from the attempt's plan: the tack, a seeded
 *   heading and the assistance), so attempts are repeatable and comparable.
 * - Graduated help, in four levels: 1 attention (look here), 2 explain (what is happening), 3 suggest (what to do),
 *   4 after the attempt (what happened and why). Levels 1–3 come by themselves after set times without progress
 *   (help "auto"), or only when asked (help "request"). Every level shown is logged.
 * - An assistance record per attempt: what was on at any time (auto-trim, the overlay, live help), and from it
 *   whether the attempt was independent. Results are reported for assisted and independent attempts separately.
 *
 * Pure logic, no DOM: the controller feeds it a sample every 0.1 s of simulated time and applies its set-ups.
 * Rules-based throughout (no free-form text generation). All thresholds are provisional (E): ./config.ts.
 */

export type HelpLevel = 1 | 2 | 3 | 4;
export const HELP_LEVEL_NAMES: Record<HelpLevel, string> = { 1: 'Look', 2: 'Why', 3: 'Try', 4: 'After the attempt' };

/** What an exercise sees of the boat: the lessons' sample and the sheets in use and whether the overlay shows. */
export interface ExerciseSample extends TutorialSample {
  /** The sheets in use (0 = hard in … 1 = fully eased), auto-trim's setting when it is on. */
  mainSheet: number;
  jibSheet: number;
  /** The teaching overlay is shown in the 3D view. */
  overlay: boolean;
  /** Where the true wind comes from at the boat (°T). */
  twdDeg?: number;
}

/** Help for one problem, at the three live levels. */
export interface HelpLadder {
  /** The problem (logged with every level shown). */
  id: string;
  targets: TutorialTarget[];
  attention: string;
  explain: string;
  suggest: string;
}

export interface HelpEvent {
  attempt: number;
  phase: string;
  level: HelpLevel;
  /** The problem the help was about. */
  id: string;
  /** Simulated time (s) in the attempt. */
  t: number;
  /** The learner asked for it (Help button) rather than it coming by itself. */
  requested: boolean;
  text: string;
}

/** The training slice's assist record: what was on at any time during an attempt. */
export interface Assists {
  autoMain: boolean;
  autoJib: boolean;
  autoCrew: boolean;
  overlay: boolean;
  /** Live help (levels 1–3) shown or asked for. */
  liveHelp: boolean;
}

/**
 * Independent: no auto-trim on either sail, no teaching overlay and no live help at any time in the attempt.
 * Auto-crew (hiking) does not by itself make an attempt assisted (the exercises do not teach hiking).
 */
export function isIndependent(a: Assists): boolean {
  return !a.autoMain && !a.autoJib && !a.overlay && !a.liveHelp;
}

export interface AttemptPlan {
  /** +1: starboard tack (the wind over the starboard side); −1: port tack. */
  tack: 1 | -1;
  /** Where the boat starts pointing (°T). */
  headingDeg: number;
  /** What the attempt starts with; help "auto" escalates by itself, "request" only when asked. */
  start: { autoMain: boolean; autoJib: boolean; autoCrew: boolean; overlay: boolean; help: 'auto' | 'request' };
  /** Plain words for the card ("Full assistance", "Main sheet yours", …). */
  label: string;
}

/** One item of the post-attempt explanation: what was observed, its likely cause, what to do next time. */
export interface ReviewItem {
  id: string;
  observation: string;
  cause?: string;
  action?: string;
}

export interface AttemptRecord {
  /** 1-based. */
  n: number;
  plan: AttemptPlan;
  assists: Assists;
  independent: boolean;
  outcome: 'complete' | 'incomplete' | 'running';
  /** Times the attempt was started again (help and assists seen before a restart still count). */
  restarts: number;
  /** What the phases measured (s, kn, °). */
  values: Record<string, number>;
  /** Findings for the review, from the exercise's rules. */
  issues: string[];
  /** Live help shown, by level, and how many times it was asked for. */
  help: { 1: number; 2: number; 3: number; requested: number };
  skipped: string[];
  review: ReviewItem[];
  /** The learner's prediction before the attempts, if the exercise asks for one. */
  prediction?: string;
}

/** A small map for the review: the learner's track and the model demonstrations' (local metres, [n, e]). */
export interface ReviewChart {
  mark: [number, number];
  start: [number, number];
  windFromDeg: number;
  tracks: { id: string; label: string; points: [number, number][]; timeS?: number }[];
  note: string;
}

/** What an exercise shows besides its card: the heading history, the review's map, the prediction's choices. */
export interface ExerciseExtras {
  headingHistory?: number[];
  chart?: ReviewChart;
  predictions?: { id: string; label: string }[];
}

export interface PhaseMemory {
  start: ExerciseSample;
  v: Record<string, number>;
  flags: Set<string>;
}

export interface PhaseDef {
  id: string;
  title: string;
  body: (plan: AttemptPlan) => string;
  targets?: TutorialTarget[];
  goal?: (s: ExerciseSample, m: PhaseMemory, plan: AttemptPlan, rec?: AttemptRecord) => boolean;
  holdS?: number;
  /** The phase ends by itself after this long (the warm-up). */
  durationS?: number;
  /** Not scored and no help (the warm-up). */
  unscored?: boolean;
  observe?: (s: ExerciseSample, m: PhaseMemory, rec: AttemptRecord) => void;
  /** The learner is stuck (help's clock runs); default: the goal is not met. */
  stuck?: (s: ExerciseSample, m: PhaseMemory, plan: AttemptPlan) => boolean;
  /** Help for the problem at hand (called while stuck). */
  help?: (s: ExerciseSample, m: PhaseMemory, plan: AttemptPlan) => HelpLadder;
  onDone?: (s: ExerciseSample, m: PhaseMemory, rec: AttemptRecord) => void;
  readout?: (s: ExerciseSample, m: PhaseMemory, rec?: AttemptRecord) => string | undefined;
}

export interface GroupSummary {
  attempts: number;
  complete: number;
  lines: string[];
}

export interface ExerciseResult {
  assisted: GroupSummary;
  independent: GroupSummary;
  /** A few observations (at most three), each separate from its likely cause. */
  observations: ReviewItem[];
  /** One thing to work on next. */
  nextAction: string;
  notes: string[];
}

export interface ExerciseDef {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  intro?: PhaseDef;
  phases: PhaseDef[];
  plans: AttemptPlan[];
  /** Seconds stuck before help levels 1, 2 and 3 (help "auto"). */
  helpTimes: [number, number, number];
  /** The post-attempt explanation (help level 4). */
  review: (rec: AttemptRecord) => ReviewItem[];
  result: (attempts: AttemptRecord[]) => ExerciseResult;
  /** Extra things to show for an attempt (1-based) at a stage. */
  extras?: (attempt: number, stage: ExerciseStage) => ExerciseExtras;
  /** An attempt (1-based) is started again: forget what the exercise kept for it. */
  resetAttempt?: (n: number) => void;
}

export type ExerciseStage = 'intro' | 'attempt' | 'review' | 'result';

export interface ExerciseState {
  stage: ExerciseStage;
  /** 1-based attempt number and the number of attempts. */
  attempt: number;
  attempts: number;
  plan: AttemptPlan;
  phase?: { id: string; title: string; body: string; targets: TutorialTarget[]; index: number; count: number; holdS?: number; durationS?: number };
  /** The phase's goal is met. */
  done: boolean;
  /** 0 … 1: through the hold (or the warm-up's time). */
  progress: number;
  readout?: string;
  /** Live help on show now (absent while the goal holds). */
  help?: { level: 1 | 2 | 3; name: string; text: string; id: string; targets: TutorialTarget[]; requested: boolean };
  /** Help can still be asked for (below level 3 in a scored phase). */
  canAskHelp: boolean;
  /** The attempt so far: what has been on, and whether it is still independent. */
  assists: Assists;
  independentSoFar: boolean;
  review?: ReviewItem[];
  result?: ExerciseResult;
  records: AttemptRecord[];
  extras?: ExerciseExtras;
  prediction?: string;
}

const NO_ASSISTS = (): Assists => ({ autoMain: false, autoJib: false, autoCrew: false, overlay: false, liveHelp: false });

function newRecord(n: number, plan: AttemptPlan): AttemptRecord {
  return { n, plan, assists: NO_ASSISTS(), independent: false, outcome: 'running', restarts: 0, values: {}, issues: [], help: { 1: 0, 2: 0, 3: 0, requested: 0 }, skipped: [], review: [] };
}

/** Findings that make an attempt incomplete even though its last phase ended (the time ran out). */
export const INCOMPLETE_ISSUES = ['timeout'];

/** Seconds help the learner asked for stays on show, stuck or not. */
export const ASKED_HELP_S = 10;

/** Seconds a met goal is shown as done before the next phase. */
export const ADVANCE_AFTER_S = 1.5;

export class Exercise {
  private stage: ExerciseStage;
  private attemptIndex = 0;
  private phaseIndex = 0;
  private mem?: PhaseMemory;
  private heldS = 0;
  private stuckS = 0;
  private doneAt?: number;
  private autoLevel = 0;
  private askedLevel = 0;
  private shownLevel = 0;
  private ladder?: HelpLadder;
  /** The problem the help on show was last logged for (a new problem at the same level is logged too). */
  private loggedId?: string;
  /** Help the learner asked for stays on show until this time (s), stuck or not. */
  private askedUntil?: number;
  private last?: ExerciseSample;
  readonly records: AttemptRecord[] = [];
  readonly log: HelpEvent[] = [];
  private result?: ExerciseResult;
  /** The learner's prediction (optional; asked before the first attempt by some exercises). */
  prediction?: string;
  /** The boat should be set up afresh for this plan (the controller restarts it, then clears this). */
  pendingSetup?: { plan: AttemptPlan; intro: boolean };

  constructor(readonly def: ExerciseDef) {
    this.stage = def.intro ? 'intro' : 'attempt';
    if (!def.intro) this.records.push(newRecord(1, def.plans[0]!));
    this.pendingSetup = { plan: def.plans[0]!, intro: !!def.intro };
  }

  private get phase(): PhaseDef | undefined {
    if (this.stage === 'intro') return this.def.intro;
    if (this.stage === 'attempt') return this.def.phases[this.phaseIndex];
    return undefined;
  }

  private get record(): AttemptRecord | undefined {
    return this.stage === 'intro' ? undefined : this.records[this.attemptIndex];
  }

  get plan(): AttemptPlan {
    return this.def.plans[this.attemptIndex]!;
  }

  get finished(): boolean {
    return this.stage === 'result';
  }

  /** A sample every 0.1 s of simulated time. */
  update(s: ExerciseSample): void {
    const prev = this.last;
    this.last = s;
    const ph = this.phase;
    if (!ph) return;
    const dt = prev ? Math.max(0, Math.min(1, s.t - prev.t)) : 0;
    if (!this.mem) this.mem = { start: s, v: {}, flags: new Set() };
    const m = this.mem;
    const rec = this.record;
    if (rec && this.stage === 'attempt') {
      rec.assists.autoMain ||= s.autoMain;
      rec.assists.autoJib ||= s.autoJib === true;
      rec.assists.autoCrew ||= s.autoCrew;
      rec.assists.overlay ||= s.overlay;
    }
    if (this.doneAt !== undefined) {
      if (s.t - this.doneAt >= ADVANCE_AFTER_S) this.advance();
      return;
    }
    if (rec) ph.observe?.(s, m, rec);
    if (ph.durationS !== undefined && s.t - m.start.t >= ph.durationS) {
      this.doneAt = s.t;
      return;
    }
    if (!ph.goal) return;
    const met = ph.goal(s, m, this.plan, rec);
    if (met) {
      // The goal holds: no help on show (it comes back if the learner is stuck again).
      this.ladder = undefined;
      this.heldS += dt;
      if (this.heldS + 1e-9 >= (ph.holdS ?? 0)) {
        this.doneAt = s.t;
        if (rec) ph.onDone?.(s, m, rec);
      }
      return;
    }
    this.heldS = 0;
    if (ph.unscored || !ph.help) return;
    const stuck = ph.stuck ? ph.stuck(s, m, this.plan) : true;
    if (stuck) this.stuckS += dt;
    if (this.plan.start.help === 'auto') {
      const [a, b, c] = this.def.helpTimes;
      this.autoLevel = this.stuckS >= c ? 3 : this.stuckS >= b ? 2 : this.stuckS >= a ? 1 : 0;
    }
    // Help is about the problem at hand: only while the learner is stuck (it hides otherwise, keeping its level).
    this.ladder = stuck || (this.askedUntil !== undefined && s.t < this.askedUntil) ? ph.help(s, m, this.plan) : undefined;
    this.raiseHelp(false);
  }

  /**
   * Assistance switched on outside the samples (while paused, from a panel): it counts for the attempt at once.
   * Only "on" is recorded; switching off never makes an attempt independent again.
   */
  noteAssists(a: Partial<Pick<Assists, 'autoMain' | 'autoJib' | 'autoCrew' | 'overlay'>>): void {
    const rec = this.record;
    if (!rec || this.stage !== 'attempt') return;
    rec.assists.autoMain ||= !!a.autoMain;
    rec.assists.autoJib ||= !!a.autoJib;
    rec.assists.autoCrew ||= !!a.autoCrew;
    rec.assists.overlay ||= !!a.overlay;
  }

  /** The learner asks for (more) help: one level up, to level 3. */
  askHelp(): void {
    const ph = this.phase;
    if (!ph || ph.unscored || !ph.help || this.stage !== 'attempt' || this.doneAt !== undefined) return;
    if (this.shownLevel >= 3) return;
    this.askedLevel = this.shownLevel + 1;
    const s = this.last;
    this.askedUntil = (s?.t ?? 0) + ASKED_HELP_S;
    if (s && this.mem) this.ladder = ph.help(s, this.mem, this.plan);
    this.raiseHelp(true);
  }

  private raiseHelp(requested: boolean): void {
    const want = Math.max(this.autoLevel, this.askedLevel);
    const rec = this.record;
    if (!rec || !this.ladder) return;
    const textOf = (level: 1 | 2 | 3) => (level === 1 ? this.ladder!.attention : level === 2 ? this.ladder!.explain : this.ladder!.suggest);
    if (want <= this.shownLevel) {
      // The same level, about a different problem: that is new help on show, so it is logged (and counted) too.
      if (this.shownLevel > 0 && this.ladder.id !== this.loggedId) {
        const level = this.shownLevel as 1 | 2 | 3;
        this.log.push({ attempt: rec.n, phase: this.phase!.id, level, id: this.ladder.id, t: this.last?.t ?? 0, requested: false, text: textOf(level) });
        rec.help[level]++;
        this.loggedId = this.ladder.id;
      }
      return;
    }
    for (let l = this.shownLevel + 1; l <= want; l++) {
      const level = l as 1 | 2 | 3;
      this.log.push({ attempt: rec.n, phase: this.phase!.id, level, id: this.ladder.id, t: this.last?.t ?? 0, requested: requested && l === want, text: textOf(level) });
      rec.help[level]++;
    }
    if (requested) rec.help.requested++;
    rec.assists.liveHelp = true;
    this.shownLevel = want;
    this.loggedId = this.ladder.id;
  }

  /** Next: end the warm-up early, skip a phase (the attempt then counts as incomplete), or go on after a review. */
  next(): void {
    if (this.stage === 'result') return;
    if (this.stage === 'review') {
      this.nextAttempt();
      return;
    }
    const rec = this.record;
    if (this.stage === 'attempt' && this.doneAt === undefined && rec) rec.skipped.push(this.phase!.id);
    this.advance();
  }

  /** Record the learner's prediction and go on to the first attempt. */
  predict(choice: string): void {
    if (this.stage !== 'intro') return;
    this.prediction = choice;
    this.advance();
  }

  /** Start the current attempt again (Reset, or after getting stuck). Help and assists seen so far still count. */
  restartAttempt(): void {
    if (this.stage === 'result') return;
    if (this.stage === 'intro') {
      this.resetPhase();
      this.pendingSetup = { plan: this.plan, intro: true };
      return;
    }
    const old = this.records[this.attemptIndex]!;
    this.def.resetAttempt?.(old.n);
    const rec = newRecord(old.n, old.plan);
    rec.restarts = old.restarts + 1;
    rec.assists = { ...old.assists };
    rec.help = { ...old.help };
    this.records[this.attemptIndex] = rec;
    this.stage = 'attempt';
    this.phaseIndex = 0;
    this.resetPhase();
    this.pendingSetup = { plan: this.plan, intro: false };
  }

  private resetPhase(): void {
    this.mem = undefined;
    this.heldS = 0;
    this.stuckS = 0;
    this.doneAt = undefined;
    this.autoLevel = 0;
    this.askedLevel = 0;
    this.shownLevel = 0;
    this.ladder = undefined;
    this.loggedId = undefined;
    this.askedUntil = undefined;
  }

  private advance(): void {
    if (this.stage === 'intro') {
      // The warm-up is over: the first attempt starts afresh.
      this.stage = 'attempt';
      this.phaseIndex = 0;
      this.records.push(newRecord(1, this.def.plans[0]!));
      this.resetPhase();
      this.pendingSetup = { plan: this.plan, intro: false };
      return;
    }
    if (this.stage !== 'attempt') return;
    if (this.phaseIndex < this.def.phases.length - 1) {
      this.phaseIndex++;
      this.resetPhase();
      return;
    }
    this.finishAttempt();
  }

  private finishAttempt(): void {
    const rec = this.record!;
    rec.outcome = rec.skipped.length || rec.issues.some((i) => INCOMPLETE_ISSUES.includes(i)) ? 'incomplete' : 'complete';
    rec.independent = isIndependent(rec.assists);
    if (this.prediction !== undefined) rec.prediction = this.prediction;
    rec.review = this.def.review(rec);
    for (const item of rec.review) {
      const text = [item.observation, item.cause, item.action].filter(Boolean).join(' ');
      this.log.push({ attempt: rec.n, phase: 'review', level: 4, id: item.id, t: this.last?.t ?? 0, requested: false, text });
    }
    this.stage = 'review';
    this.resetPhase();
  }

  private nextAttempt(): void {
    if (this.attemptIndex >= this.def.plans.length - 1) {
      this.stage = 'result';
      this.result = this.def.result(this.records);
      return;
    }
    this.attemptIndex++;
    this.records.push(newRecord(this.attemptIndex + 1, this.plan));
    this.stage = 'attempt';
    this.phaseIndex = 0;
    this.resetPhase();
    this.pendingSetup = { plan: this.plan, intro: false };
  }

  get state(): ExerciseState {
    const ph = this.phase;
    const rec = this.record;
    const s = this.last;
    const done = this.doneAt !== undefined;
    const elapsed = s && this.mem ? s.t - this.mem.start.t : 0;
    const progress = done ? 1 : ph?.durationS ? Math.min(1, elapsed / ph.durationS) : ph?.holdS ? Math.min(1, this.heldS / ph.holdS) : 0;
    const showHelp = !done && this.shownLevel > 0 && this.ladder && this.stage === 'attempt';
    const lvl = this.shownLevel as 1 | 2 | 3;
    const assists = rec ? { ...rec.assists } : NO_ASSISTS();
    return {
      stage: this.stage,
      attempt: this.attemptIndex + 1,
      attempts: this.def.plans.length,
      plan: this.plan,
      phase: ph && {
        id: ph.id,
        title: ph.title,
        body: ph.body(this.plan),
        targets: [...(ph.targets ?? []), ...(showHelp ? this.ladder!.targets : [])],
        index: this.phaseIndex,
        count: this.stage === 'intro' ? 1 : this.def.phases.length,
        holdS: ph.holdS,
        durationS: ph.durationS,
      },
      done,
      progress,
      readout: ph?.readout && s && this.mem ? ph.readout(s, this.mem, rec) : undefined,
      help: showHelp
        ? { level: lvl, name: HELP_LEVEL_NAMES[lvl], text: lvl === 1 ? this.ladder!.attention : lvl === 2 ? this.ladder!.explain : this.ladder!.suggest, id: this.ladder!.id, targets: this.ladder!.targets, requested: this.askedLevel >= lvl }
        : undefined,
      canAskHelp: this.stage === 'attempt' && !!ph?.help && !ph.unscored && !done && this.shownLevel < 3,
      assists,
      independentSoFar: isIndependent(assists),
      review: this.stage === 'review' ? rec?.review : undefined,
      result: this.result,
      records: this.records,
      extras: this.def.extras?.(this.attemptIndex + 1, this.stage),
      prediction: this.prediction,
    };
  }
}

/** The median of the finite values (undefined when there are none). */
export function median(xs: number[]): number | undefined {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1]! + v[mid]!) / 2;
}

/** Seeded generator (mulberry32): the exercises vary their start headings by seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
