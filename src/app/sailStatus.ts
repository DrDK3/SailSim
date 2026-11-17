import type { SailForce } from '../sim/boat/forces';
import { byTheLeeAngle } from '../sim/boat/dynamics';

/** How a sail is working, in the terms a sailor uses, with what to do about it. */
export type SailState = 'drawing' | 'luffing' | 'stalled' | 'by-the-lee';

/**
 * How a sail is working. `angle` is the sail's angle off the centreline (rad, the snapshot's boomMain or boomJib;
 * > 0 = set to port).
 *
 * The airflow more than 90° onto the chord means one of two different things (issue 200, O3):
 * - the wind comes from the sail's own side, from abaft the beam: the wind is behind the sail, BY THE LEE;
 * - the wind is on the other side: the sail is sheeted in past square to the wind, STALLED (ease it).
 * The side test is the one the boom dynamics use (`byTheLeeAngle`, src/sim/boat/dynamics.ts).
 */
export function sailState(f: SailForce, angle: number): SailState {
  if (Math.abs(f.incidence) > Math.PI / 2) return byTheLeeAngle(angle, f.awa) > 0 ? 'by-the-lee' : 'stalled';
  if (f.luff < 0.5) return 'luffing';
  if (f.stall > 0.5) return 'stalled';
  return 'drawing';
}

/** What the advice asks the sailor to do: a sheet key, the helm, or nothing. */
export type SailAction = 'trim' | 'ease' | 'helm' | 'none';

/** What the advice needs to know to ask only for what can be done (issue 199, O2). */
export interface SailContext {
  sail: 'main' | 'jib';
  /** The sheet in use: 0 = hard in … 1 = fully eased (auto-trim's setting when it is on). */
  sheet: number;
  /** Auto-trim sets this sheet. */
  auto: boolean;
}

export interface SailAdvice {
  /** The state as shown (always the state's own name). */
  text: string;
  advice: string;
  cls: 'good' | 'warn' | 'bad';
  action: SailAction;
}

/** A sheet within this of its end stop is at its limit: it cannot be eased (or trimmed) further. */
export const SHEET_END = 0.01;

const LABEL: Record<SailState, string> = { drawing: 'Drawing', luffing: 'Luffing', stalled: 'Stalled', 'by-the-lee': 'By the lee' };

/**
 * Plain-language status and advice for one sail. With the context (the app always passes it), the advice never
 * asks for a sheet beyond its end stop, never asks to work a sheet auto-trim is setting, and never contradicts the
 * state shown (tests/sim/sailAdvice.test.ts). Without it, the sheet is assumed to be in the crew's hands and
 * between its stops (the case the plain advice was written for).
 */
export function sailAdvice(state: SailState, keys: { trim: string; ease: string }, ctx?: SailContext): SailAdvice {
  const text = LABEL[state];
  const manual = !ctx || !ctx.auto;
  const hardIn = !!ctx && ctx.sheet <= SHEET_END;
  const eased = !!ctx && ctx.sheet >= 1 - SHEET_END;
  switch (state) {
    case 'drawing':
      return { text, advice: 'well trimmed', cls: 'good', action: 'none' };
    case 'luffing':
      // Hard in and still luffing: too close to the wind; no sheet can help.
      if (hardIn) return { text, advice: 'sheet hard in: too close to the wind, bear away to fill it', cls: 'warn', action: 'helm' };
      if (!manual) return { text, advice: 'auto-trim is setting this sheet', cls: 'warn', action: 'none' };
      return { text, advice: `trim in (${keys.trim})`, cls: 'warn', action: 'trim' };
    case 'stalled':
      // Eased right out and still stalled: this far off the wind the sail works by pushing (drag); nothing to ease.
      if (eased) return { text, advice: 'fully eased: right this far off the wind (the sail pushes, it cannot draw)', cls: 'good', action: 'none' };
      if (!manual) return { text, advice: 'auto-trim is setting this sheet', cls: 'warn', action: 'none' };
      return { text, advice: `ease out (${keys.ease})`, cls: 'bad', action: 'ease' };
    case 'by-the-lee':
      // The main's boom can come across (a gybe); the jib has no boom: it crosses over.
      if (ctx?.sail === 'jib') return { text, advice: 'the jib is about to cross: head up to keep it', cls: 'warn', action: 'helm' };
      return { text, advice: 'gybe risk: head up', cls: 'warn', action: 'helm' };
  }
}
