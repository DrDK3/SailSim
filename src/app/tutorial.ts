import type { AppScenario } from './controller';
import type { ControlInput } from '../sim/simulation';
import type { SailState } from './sailStatus';

/**
 * The interactive tutorial: a short course in sailing the Squib, in open water with a steady breeze. Each
 * step states a goal that is checked against the simulation (heading, true wind angle, speed, which side the
 * mainsail is on, how the main is drawing), so it moves on when you have done it. You can also step back,
 * skip a step or leave at any time.
 *
 * Pure logic (no DOM): the controller feeds it a sample of the boat every 0.1 s of simulated time.
 */

/** Open water in Start Bay, 10 kn steady south-westerly, no current: predictable for learning (E). */
export const TUTORIAL_SCENARIO: AppScenario = {
  conditions: {
    startTime: '2026-07-15T13:00:00Z',
    weather: { source: 'manual', twsKn: 10, twdDeg: 225 },
    gusts: { preset: 'steady', seed: 1 },
    current: { mode: 'none' },
    sky: { source: 'preset', preset: 'fair' },
  },
  startLocation: 'start-bay-practice',
  startHeadingDeg: 165,
  startSpeedKn: 3,
};

/** The boat starts with the main and jib on auto-trim and the crew on auto; the trimming step hands over the main. */
export const TUTORIAL_INPUT: ControlInput = { helm: 0, mainSheet: 0.35, jibSheet: 0.35, autoMain: true, autoJib: true, crewHike: 0.6, autoCrew: true };

/** What the tutorial sees of the boat. Angles in degrees, speeds in knots. */
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
}

interface StepMemory {
  start: TutorialSample;
  sawLuffing: boolean;
  crewChanged: boolean;
}

/** Highlightable parts of the screen (elements carry data-tutorial="…"). */
export type TutorialTarget = 'compass' | 'speed' | 'twa' | 'helm' | 'main' | 'jib' | 'crew' | 'release' | 'library' | 'help';

export interface TutorialStep {
  id: string;
  title: string;
  /** What to do, in a sentence or two. */
  body: string;
  /** A short extra tip shown under the body. */
  hint?: string;
  targets?: TutorialTarget[];
  /** Set the boat up for the step when it begins (e.g. hand the main over to you). */
  input?: Partial<ControlInput>;
  /** The goal; absent for steps that only explain (press Next). */
  goal?: (s: TutorialSample, m: StepMemory) => boolean;
  /** Seconds the goal must hold without a break. */
  holdS?: number;
}

const angleDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome aboard',
    body: 'You are helming a Squib, a 5.8 m keelboat, in open water off Dartmouth with a steady 10-knot breeze. The compass shows the wind: the blue arrow is the true wind, the purple one the wind you feel as you sail.',
    hint: 'The simulation is running. Press Next when you are ready.',
    targets: ['compass', 'speed'],
  },
  {
    id: 'steer',
    title: 'Steer',
    body: 'Hold D or → (or the Stbd button) to turn to starboard, A or ← (Port) to turn to port. The tiller centres itself when you let go. Turn the boat 30° either way.',
    hint: 'A boat turns slowly: hold the key for a second or two, then wait.',
    targets: ['helm'],
    goal: (s, m) => angleDiff(s.headingDeg, m.start.headingDeg) >= 30,
  },
  {
    id: 'reach',
    title: 'Sail across the wind',
    body: 'Steer until the wind comes across the side of the boat: a true wind angle (TWA) between 80° and 100°. This is a beam reach, the easiest and often fastest point of sail. Hold it for 5 seconds.',
    targets: ['twa', 'helm'],
    goal: (s) => s.twaDeg >= 80 && s.twaDeg <= 100,
    holdS: 5,
  },
  {
    id: 'trim',
    title: 'Trim the mainsail',
    body: 'Auto-trim for the main is now off: the sheet is yours. Ease the main (S or ↓) until its status says Luffing, then pull it in (W or ↑) until it just says Drawing again. That is the sweet spot.',
    hint: 'Luffing: the sail flaps and stops driving. Stalled: pulled in too far, the air breaks away.',
    targets: ['main'],
    input: { autoMain: false },
    goal: (s, m) => m.sawLuffing && s.main === 'drawing',
    holdS: 3,
  },
  {
    id: 'upwind',
    title: 'Sail towards the wind',
    body: 'Turn towards the wind until the TWA is about 45° (between 38° and 55°), pulling the main in as you turn. This is close-hauled: a boat cannot sail straight into the wind. Keep the speed above 2.5 kn for 5 seconds.',
    hint: 'If the sails luff and the boat slows, you are pointing too high: bear away a little.',
    targets: ['twa', 'main', 'helm'],
    goal: (s) => s.twaDeg >= 38 && s.twaDeg <= 55 && s.stwKn >= 2.5,
    holdS: 5,
  },
  {
    id: 'tack',
    title: 'Tack',
    body: 'Turn the bow through the wind so the wind comes from the other side. Keep turning until the sails fill on the new side and the boat picks up speed. That is a tack.',
    hint: 'Turn decisively: if you stop with the bow into the wind, the boat drifts to a halt ("in irons").',
    targets: ['helm', 'compass'],
    goal: (s, m) => s.mainSide !== m.start.mainSide && s.twaDeg < 90 && s.stwKn > 1.0,
  },
  {
    id: 'run',
    title: 'Turn away from the wind',
    body: 'Bear away until the wind is behind you: a TWA of 150° or more. Ease the main right out as you turn. This is a run. Hold it for 3 seconds.',
    targets: ['twa', 'main'],
    goal: (s) => s.twaDeg >= 150,
    holdS: 3,
  },
  {
    id: 'gybe',
    title: 'Gybe',
    body: 'Keep turning gently the same way, so the stern passes through the wind. The boom swings across to the other side: that is a gybe. In a real boat, duck!',
    hint: 'Turn slowly. With the main far out, the boom crosses fast.',
    targets: ['helm', 'main'],
    goal: (s, m) => s.mainSide !== m.start.mainSide && s.twaDeg >= 100,
  },
  {
    id: 'crew',
    title: 'Crew weight',
    body: 'Wind pressure heels the boat; the crew sitting out keeps it upright. Auto crew does this for you. Turn it off (K, or the Auto crew box) and move the Hike slider to see the heel change, then turn Auto crew back on.',
    targets: ['crew'],
    goal: (s, m) => m.crewChanged && s.autoCrew,
  },
  {
    id: 'stop',
    title: 'Stop the boat',
    body: 'A boat has no brakes. To stop, let both sheets go (X, or Release sheets) and turn towards the wind until the sails flap. With no drive the boat slows down. Slow down to below 1 knot.',
    hint: 'Letting the sheets go on a run is not enough: the wind still pushes the sails. Head up into the wind.',
    targets: ['release', 'helm'],
    goal: (s) => s.stwKn < 1.0,
  },
  {
    id: 'done',
    title: 'You can sail!',
    body: 'That is the basics: steer, trim, tack, gybe and stop. Next, try a scenario from the Library (fog, a fresh breeze, a practice race against AI boats), or sail on the River Dart. Help (H) lists every key.',
    targets: ['library', 'help'],
  },
];

export interface TutorialState {
  index: number;
  total: number;
  step: TutorialStep;
  /** The step's goal is met (or it has none and only needs Next). */
  done: boolean;
  /** 0 … 1: how far through the hold time the goal is. */
  progress: number;
}

/** Runs the steps: feed it samples; it reports the current step and whether its goal is met. */
export class Tutorial {
  private index = 0;
  private mem?: StepMemory;
  private heldS = 0;
  private doneAt?: number;
  private last?: TutorialSample;
  /** Inputs the controller should apply when a step begins. */
  pendingInput?: Partial<ControlInput>;

  constructor(readonly steps: TutorialStep[] = TUTORIAL_STEPS) {
    this.pendingInput = steps[0]?.input;
  }

  get state(): TutorialState {
    const step = this.steps[this.index]!;
    const done = this.doneAt !== undefined;
    return { index: this.index, total: this.steps.length, step, done, progress: done ? 1 : step.holdS ? Math.min(1, this.heldS / step.holdS) : 0 };
  }

  get finished(): boolean {
    return this.index >= this.steps.length - 1 && this.doneAt !== undefined;
  }

  /** Check the goal against a new sample (every 0.1 s of simulated time). */
  update(s: TutorialSample): void {
    const prev = this.last;
    this.last = s;
    const step = this.steps[this.index]!;
    if (!this.mem) this.mem = { start: s, sawLuffing: false, crewChanged: false };
    const m = this.mem;
    if (s.main === 'luffing') m.sawLuffing = true;
    if (!s.autoCrew && Math.abs(s.crewHike - m.start.crewHike) > 0.15) m.crewChanged = true;
    if (!step.goal || this.doneAt !== undefined) return;
    const dt = prev ? Math.max(0, s.t - prev.t) : 0;
    if (step.goal(s, m)) {
      this.heldS += dt;
      if (this.heldS + 1e-9 >= (step.holdS ?? 0)) this.doneAt = s.t;
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

  back(): void {
    if (this.index > 0) this.go(this.index - 1);
  }

  private go(i: number): void {
    this.index = i;
    this.mem = undefined;
    this.heldS = 0;
    this.doneAt = undefined;
    this.pendingInput = this.steps[i]!.input;
    // An explanation-only step is complete as soon as it is shown (Next moves on).
    if (!this.steps[i]!.goal && i === this.steps.length - 1) this.doneAt = this.last?.t ?? 0;
  }
}
