import type { ControlInput } from '../sim/simulation';
import type { SailState } from './sailStatus';

/**
 * The step engine behind the lessons (src/app/lessons.ts, review U9 and §8.1): each step states a goal that is
 * checked against the simulation (heading, true wind angle, speed, which side the mainsail is on, how the sails
 * are drawing, the stream, the start), so it moves on when you have done it. You can also step back, skip a step
 * or leave at any time. Steps may time what you do (a tack, the start) into the lesson's record, which the
 * lesson's result card reports.
 *
 * Pure logic (no DOM): the controller feeds it a sample of the boat every 0.1 s of simulated time.
 */

/** What a lesson sees of the boat. Angles in degrees, speeds in knots, positions in local metres. */
export interface TutorialSample {
  t: number;
  headingDeg: number;
  /** True wind angle, 0 … 180 (either side). */
  twaDeg: number;
  stwKn: number;
  /** +1 when the main is on the port side (starboard tack), −1 on the other. */
  mainSide: number;
  main: SailState;
  autoMain: boolean;
  autoCrew: boolean;
  crewHike: number;
  /** Optional detail (the lessons use them; older samples may leave them out). */
  n?: number;
  e?: number;
  sogKn?: number;
  vmgKn?: number;
  awsKn?: number;
  jib?: SailState;
  autoJib?: boolean;
  /** Distance to the lesson's target buoy, when it has one. */
  targetDistM?: number;
  /** Where the target buoy lies from the bow (deg, −180 … 180, + to starboard), and its compass bearing (deg). */
  targetBearingRelDeg?: number;
  targetBearingDeg?: number;
  /** In a race: seconds to the start signal (negative after it), over the line early, and when this boat started. */
  race?: { toStart: number; ocs: boolean; startedAt?: number; signalAt: number };
}

export interface StepMemory {
  start: TutorialSample;
  sawLuffing: boolean;
  sawJibLuffing: boolean;
  crewChanged: boolean;
  /** Scratch values a step keeps while it runs (e.g. when a tack began). */
  v: Record<string, number>;
}

/** Highlightable parts of the screen (elements carry data-tutorial="…"). */
export type TutorialTarget = 'compass' | 'speed' | 'twa' | 'helm' | 'main' | 'jib' | 'crew' | 'release' | 'library' | 'help' | 'race';

/** What a lesson records as you sail (timings, speeds), for its result card. */
export type LessonRecord = Record<string, number>;

export interface TutorialStep {
  id: string;
  title: string;
  /** What to do, in a sentence or two. */
  body: string;
  /** The body for tiller steering (src/app/steering.ts), where it differs. */
  bodyTiller?: string;
  /** A short extra tip shown under the body. */
  hint?: string;
  targets?: TutorialTarget[];
  /** Set the boat up for the step when it begins (e.g. hand the main over to you). */
  input?: Partial<ControlInput>;
  /** The goal; absent for steps that only explain (press Next). */
  goal?: (s: TutorialSample, m: StepMemory) => boolean;
  /** Seconds the goal must hold without a break. */
  holdS?: number;
  /** Called with every sample before the goal is checked: to time a manoeuvre. */
  observe?: (s: TutorialSample, m: StepMemory) => void;
  /** Called once when the goal is met: to note a result in the lesson's record. */
  onDone?: (s: TutorialSample, m: StepMemory, rec: LessonRecord) => void;
  /** A live value shown on the card while the step runs (e.g. "SOG 3.2 kn · STW 4.1 kn"). */
  readout?: (s: TutorialSample) => string | undefined;
}

export interface TutorialState {
  index: number;
  total: number;
  step: TutorialStep;
  /** The step's goal is met (or it has none and only needs Next). */
  done: boolean;
  /** 0 … 1: how far through the hold time the goal is. */
  progress: number;
  /** The step's live value, if it has one. */
  readout?: string;
}

export const angleDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** Runs the steps: feed it samples; it reports the current step and whether its goal is met. */
export class Tutorial {
  private index = 0;
  private mem?: StepMemory;
  private heldS = 0;
  private doneAt?: number;
  private last?: TutorialSample;
  /** What the steps have recorded (timings, speeds), for the lesson's result card. */
  readonly record: LessonRecord = {};
  /** Inputs the controller should apply when a step begins. */
  pendingInput?: Partial<ControlInput>;

  constructor(readonly steps: TutorialStep[]) {
    this.pendingInput = steps[0]?.input;
  }

  get state(): TutorialState {
    const step = this.steps[this.index]!;
    const done = this.doneAt !== undefined;
    return {
      index: this.index,
      total: this.steps.length,
      step,
      done,
      progress: done ? 1 : step.holdS ? Math.min(1, this.heldS / step.holdS) : 0,
      readout: this.last && step.readout ? step.readout(this.last) : undefined,
    };
  }

  get finished(): boolean {
    return this.index >= this.steps.length - 1 && this.doneAt !== undefined;
  }

  /** The latest sample (the controller's clock for the lesson's time). */
  get latest(): TutorialSample | undefined {
    return this.last;
  }

  /** Check the goal against a new sample (every 0.1 s of simulated time). */
  update(s: TutorialSample): void {
    const prev = this.last;
    this.last = s;
    const step = this.steps[this.index]!;
    if (!this.mem) this.mem = { start: s, sawLuffing: false, sawJibLuffing: false, crewChanged: false, v: {} };
    const m = this.mem;
    if (s.main === 'luffing') m.sawLuffing = true;
    if (s.jib === 'luffing') m.sawJibLuffing = true;
    if (!s.autoCrew && Math.abs(s.crewHike - m.start.crewHike) > 0.15) m.crewChanged = true;
    if (!step.goal || this.doneAt !== undefined) return;
    step.observe?.(s, m);
    const dt = prev ? Math.max(0, s.t - prev.t) : 0;
    if (step.goal(s, m)) {
      this.heldS += dt;
      if (this.heldS + 1e-9 >= (step.holdS ?? 0)) {
        this.doneAt = s.t;
        step.onDone?.(s, m, this.record);
      }
    } else this.heldS = 0;
  }

  /** Seconds since the goal was met (to move on automatically after a moment), or undefined. */
  sinceDone(t: number): number | undefined {
    return this.doneAt === undefined ? undefined : t - this.doneAt;
  }

  next(): void {
    if (this.index < this.steps.length - 1) this.go(this.index + 1);
    else this.doneAt ??= this.last?.t ?? 0;
  }

  /** Start the current step's measuring again (after a Reset: "turn 30° from where you began" means from the new start). */
  restartStep(): void {
    this.mem = undefined;
    this.heldS = 0;
    this.doneAt = undefined;
    this.pendingInput = this.steps[this.index]!.input;
  }

  back(): void {
    if (this.index > 0) this.go(this.index - 1);
  }

  private go(i: number): void {
    this.index = i;
    this.mem = undefined;
    this.heldS = 0;
    this.doneAt = undefined;
    this.pendingInput = this.steps[i]!.input;
    // An explanation-only last step (the result) is complete as soon as it is shown.
    if (!this.steps[i]!.goal && i === this.steps.length - 1) this.doneAt = this.last?.t ?? 0;
  }
}
