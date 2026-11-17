/**
 * Dynamic resolution with hysteresis (juniors round, Workstream 1). Before the graphics preset is stepped down, the
 * drawing resolution is lowered a step at a time while frames are over budget, and raised again only after a long
 * spell well under it. Visual only: it changes how many pixels are drawn, never what is drawn, so every sailing cue
 * stays (src/render/cueAudit.ts checks the cues at every preset).
 *
 * Hysteresis, so quality never flips back and forth:
 * - different thresholds down (95th percentile over budget) and up (95th percentile under 60% of the budget);
 * - different dwell times: 2 windows over budget to step down, 6 windows under to step up;
 * - after any step down, no step up for a cool-down that doubles each time a step up is followed by a step down
 *   (a step up that did not hold), up to 4 minutes.
 * Only when the scale is at its floor and frames are still over budget for 3 more windows does it ask for the preset
 * to be lowered (the controller does that, tells the player, and resets the scale).
 *
 * Window length, thresholds and dwell are E (tuned to the brief's 30 frames a second target, not to a device).
 */

export interface DynResOptions {
  /** Frame-time budget (ms): 33.4 = 30 frames a second. */
  budgetMs: number;
  /** Window length (ms of wall time). */
  windowMs: number;
  floor: number;
  step: number;
  downWindows: number;
  upWindows: number;
  /** Share of the budget the 95th percentile must be under to step up. */
  upShare: number;
  coolDownMs: number;
  maxCoolDownMs: number;
  /** Windows at the floor, still over budget, before the preset is lowered. */
  presetWindows: number;
}

export const DYNRES_DEFAULTS: DynResOptions = {
  budgetMs: 33.4,
  windowMs: 2000,
  floor: 0.6,
  step: 0.1,
  downWindows: 2,
  upWindows: 6,
  upShare: 0.6,
  coolDownMs: 20_000,
  maxCoolDownMs: 240_000,
  presetWindows: 3,
};

export type DynResAction = { kind: 'scale'; scale: number; direction: 'down' | 'up' } | { kind: 'lower-preset' };

export class DynamicResolution {
  readonly o: DynResOptions;
  /** Multiplier on the preset's own resolution (floor … 1). */
  scale = 1;
  enabled = true;
  /** Steps taken (for the report and the oscillation test). */
  readonly history: { at: number; action: DynResAction }[] = [];
  private buf: number[] = [];
  private windowStart = -1;
  private over = 0;
  private under = 0;
  private atFloor = 0;
  private lastDown = -Infinity;
  private lastUp = -Infinity;
  private coolDown: number;

  constructor(o: Partial<DynResOptions> = {}) {
    this.o = { ...DYNRES_DEFAULTS, ...o };
    this.coolDown = this.o.coolDownMs;
  }

  /** Back to full scale (a new preset, or the player chose graphics): the counts start again. */
  reset(now = -1): void {
    this.scale = 1;
    this.buf = [];
    this.windowStart = now;
    this.over = this.under = this.atFloor = 0;
  }

  /** Leave out the frames of a known one-off pause (shader compile after a change). */
  skipWindow(now: number): void {
    this.buf = [];
    this.windowStart = now;
  }

  /** One drawn frame. Returns an action when the scale (or the preset) should change. */
  frame(now: number, frameMs: number): DynResAction | undefined {
    if (!this.enabled) return undefined;
    if (this.windowStart < 0) this.windowStart = now;
    // A frame after the tab was hidden is not slowness.
    if (frameMs > 0 && frameMs < 1000) this.buf.push(frameMs);
    if (now - this.windowStart < this.o.windowMs) return undefined;
    const s = this.buf.sort((a, b) => a - b);
    const p95 = s.length ? s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]! : 0;
    this.buf = [];
    this.windowStart = now;
    if (!s.length) return undefined;
    const overBudget = p95 > this.o.budgetMs;
    const wellUnder = p95 < this.o.budgetMs * this.o.upShare;
    this.over = overBudget ? this.over + 1 : 0;
    this.under = wellUnder ? this.under + 1 : 0;
    if (overBudget && this.over >= this.o.downWindows) {
      if (this.scale > this.o.floor + 1e-6) {
        // A step up that did not hold: wait longer before the next one.
        if (now - this.lastUp < this.coolDown + this.o.windowMs * this.o.downWindows * 2) this.coolDown = Math.min(this.o.maxCoolDownMs, this.coolDown * 2);
        this.scale = Math.max(this.o.floor, round2(this.scale - this.o.step));
        this.lastDown = now;
        this.over = 0;
        return this.log(now, { kind: 'scale', scale: this.scale, direction: 'down' });
      }
      this.atFloor++;
      if (this.atFloor >= this.o.presetWindows) {
        this.atFloor = 0;
        this.over = 0;
        return this.log(now, { kind: 'lower-preset' });
      }
      return undefined;
    }
    if (!overBudget) this.atFloor = 0;
    if (wellUnder && this.under >= this.o.upWindows && this.scale < 1 && now - this.lastDown >= this.coolDown) {
      this.scale = Math.min(1, round2(this.scale + this.o.step));
      this.lastUp = now;
      this.under = 0;
      return this.log(now, { kind: 'scale', scale: this.scale, direction: 'up' });
    }
    return undefined;
  }

  private log(at: number, action: DynResAction): DynResAction {
    this.history.push({ at, action });
    if (this.history.length > 200) this.history.shift();
    return action;
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** How many times the scale changed direction (down then up, or up then down) in a list of steps. */
export function reversals(h: readonly { action: DynResAction }[]): number {
  let n = 0;
  let last: 'down' | 'up' | undefined;
  for (const { action } of h) {
    if (action.kind !== 'scale') continue;
    if (last && action.direction !== last) n++;
    last = action.direction;
  }
  return n;
}
