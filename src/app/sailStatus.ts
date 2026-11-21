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
  /**
   * The sheet is slack: the sail is inside the angle its sheet allows, held there by the wind (review #23). Easing a
   * slack sheet moves nothing, so the advice does not ask for it and says why.
   */
  slack?: boolean;
  /** The sail's angle off the centreline (rad, > 0 = set to port): which side its boom (or clew) is on. */
  angle?: number;
  /** Plain words for the Learn level (review #22): no "luffing", "stalled" or "by the lee". */
  plain?: boolean;
}

export interface SailAdvice {
  /** The state as shown: its own name, or (Learn) its plain words; the colour always agrees (review #17). */
  text: string;
  advice: string;
  /** good: nothing to do; neutral: as it should be, nothing can be done (eased right out); warn and bad: act. */
  cls: 'good' | 'neutral' | 'warn' | 'bad';
  action: SailAction;
}

/** A sheet within this of its end stop is at its limit: it cannot be eased (or trimmed) further. */
export const SHEET_END = 0.01;

/** The sail is slack inside its sheet's angle by more than this (rad, E): a slack sheet (review #23). */
export const SLACK_RAD = (3 * Math.PI) / 180;

export const STATE_LABEL: Record<SailState, string> = { drawing: 'Drawing', luffing: 'Luffing', stalled: 'Stalled', 'by-the-lee': 'By the lee' };
/** Eased to its stop and still stalled: right this far off the wind. A state of its own on the screen (review #17). */
export const EASED_LABEL = 'Eased right out';
/** The Learn level's words for each state shown (review #22). */
export const PLAIN_LABEL = { drawing: 'Full', luffing: 'Flapping', stalled: 'Pulled in too far', eased: 'Let right out', 'by-the-lee': 'Wind behind the sail' } as const;

/** Which side a sail is set on, in words ("port", "starboard"), from its angle (> 0: to port). */
const sideOf = (angle: number | undefined): string | undefined => (angle === undefined || Math.abs(angle) < 0.03 ? undefined : angle > 0 ? 'port' : 'starboard');

/**
 * Plain-language status and advice for one sail. With the context (the app always passes it), the advice never
 * asks for a sheet beyond its end stop or a slack sheet, never asks to work a sheet auto-trim is setting, and never
 * contradicts the state shown; the colour agrees with the words (tests/sim/sailAdvice.test.ts). Without it, the sheet
 * is assumed to be in the crew's hands and between its stops (the case the plain advice was written for).
 */
export function sailAdvice(state: SailState, keys: { trim: string; ease: string }, ctx?: SailContext): SailAdvice {
  const plain = !!ctx?.plain;
  const text = plain ? PLAIN_LABEL[state] : STATE_LABEL[state];
  const manual = !ctx || !ctx.auto;
  const hardIn = !!ctx && ctx.sheet <= SHEET_END;
  const eased = !!ctx && ctx.sheet >= 1 - SHEET_END;
  const side = sideOf(ctx?.angle);
  switch (state) {
    case 'drawing':
      return { text, advice: plain ? 'the wind is filling it nicely' : 'well trimmed', cls: 'good', action: 'none' };
    case 'luffing':
      // Hard in and still luffing: too close to the wind; no sheet can help.
      if (hardIn) return { text, advice: plain ? 'pulled right in already: steer away from the wind to fill it' : 'sheet hard in: too close to the wind, bear away to fill it', cls: 'warn', action: 'helm' };
      if (!manual) return { text, advice: plain ? 'the crew is pulling it in for you (auto-trim)' : 'auto-trim is setting this sheet', cls: 'warn', action: 'none' };
      return { text, advice: plain ? `pull it in (${keys.trim})` : `trim in (${keys.trim})`, cls: 'warn', action: 'trim' };
    case 'stalled':
      // Eased right out and still stalled: this far off the wind the sail works by pushing (drag); nothing to ease.
      // Neutral, in words of its own: as it should be, and nothing to do (review #17: never "Stalled" in green).
      if (eased) return { text: plain ? PLAIN_LABEL.eased : EASED_LABEL, advice: plain ? 'right for sailing away from the wind: the wind pushes the sail' : 'right this far off the wind: the sail pushes, it cannot draw; nothing left to ease', cls: 'neutral', action: 'none' };
      // A slack sheet: the wind holds the sail where it is; easing moves nothing (review #23).
      if (ctx?.slack) return { text, advice: plain ? 'the rope is already loose: letting it out more changes nothing; steer a little towards the wind' : 'sheet slack: the wind holds the sail, easing moves nothing; head up a little to fill it', cls: 'warn', action: 'helm' };
      if (!manual) return { text, advice: plain ? 'the crew is letting it out for you (auto-trim)' : 'auto-trim is setting this sheet', cls: 'warn', action: 'none' };
      return { text, advice: plain ? `let it out (${keys.ease})` : `ease out (${keys.ease})`, cls: 'bad', action: 'ease' };
    case 'by-the-lee':
      // The main's boom can come across (a gybe); the jib has no boom: it crosses over. Plain words say which side.
      if (ctx?.sail === 'jib') return { text, advice: plain ? `the wind is behind the jib${side ? ` (out to ${side})` : ''}: it will cross over; steer towards the wind` : 'the jib is about to cross: head up to keep it', cls: 'warn', action: 'helm' };
      return { text, advice: plain ? `the wind is on the boom's side${side ? ` (out to ${side})` : ''}: it may swing across; steer towards the wind` : 'gybe risk: head up', cls: 'warn', action: 'helm' };
  }
}
