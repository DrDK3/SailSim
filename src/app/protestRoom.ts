import type { Incident } from '../sim/race/rules';

/**
 * The protest room (review, 10 Nov 2026): after an incident involving you, watch it again from above (the boats from
 * 15 s before the contact to 3 s after) with the rule the simplified judge applied, in plain words, and what the
 * boat that had to keep clear could have done. A teaching aid for the rules the simulator judges (10–13 and 31,
 * with notes on 14, 15 and 16); it is not a protest hearing, and its calls are not authoritative.
 *
 * The rule notes paraphrase the Racing Rules of Sailing 2025–2028 (docs/SOURCES.md, racing rules); the advice is
 * general practice, not part of the rules.
 */

export interface BoatPose {
  id: string;
  label: string;
  n: number;
  e: number;
  /** Heading (rad, compass). */
  heading: number;
  /** +1 main to port (starboard tack), −1 to starboard. */
  mainSide: number;
}

export interface Frame {
  t: number;
  boats: BoatPose[];
}

export interface ProtestCase {
  id: number;
  incident: Incident;
  /** The true wind's direction (from, rad) at the incident. */
  windFrom: number;
  frames: Frame[];
  /** Still recording the seconds after the contact. */
  open: boolean;
}

/** Seconds kept before an incident, and recorded after it; frames 5 a second. */
export const BEFORE_S = 15;
export const AFTER_S = 3;
export const FRAME_EVERY_S = 0.2;

/** Keeps the last few seconds of the fleet's poses and cuts a clip round each incident involving `you`. */
export class IncidentRecorder {
  private history: Frame[] = [];
  readonly cases: ProtestCase[] = [];
  private seen = 0;
  private nextId = 1;

  constructor(private readonly you = 'you') {}

  reset(): void {
    this.history = [];
    this.cases.length = 0;
    this.seen = 0;
  }

  /** A frame of the fleet; then any new incidents of `incidents` (the session's list) involving you. */
  record(frame: Frame, incidents: readonly Incident[], windFrom: number): ProtestCase[] {
    this.history.push(frame);
    while (this.history.length && frame.t - this.history[0]!.t > BEFORE_S + AFTER_S + 1) this.history.shift();
    for (const c of this.cases) {
      if (!c.open) continue;
      c.frames.push(frame);
      if (frame.t >= c.incident.t + AFTER_S) c.open = false;
    }
    const fresh: ProtestCase[] = [];
    for (; this.seen < incidents.length; this.seen++) {
      const inc = incidents[this.seen]!;
      // Your own incidents with another boat or a mark: the ones the judge rules on.
      if (!inc.boats.includes(this.you) || (inc.kind !== 'boat' && inc.kind !== 'mark')) continue;
      const c: ProtestCase = { id: this.nextId++, incident: inc, windFrom, frames: this.history.filter((f) => f.t >= inc.t - BEFORE_S), open: true };
      this.cases.push(c);
      fresh.push(c);
    }
    return fresh;
  }
}

/** What each rule says, in plain words (a paraphrase, not the rule's text). */
export const RULE_NOTES: Record<string, { title: string; says: string; couldHave: string }> = {
  '10': {
    title: 'Rule 10, on opposite tacks',
    says: 'When boats are on opposite tacks, a port-tack boat keeps clear of a starboard-tack boat.',
    couldHave: 'The port-tack boat could have borne away to pass astern of the other, or tacked early enough that the starboard-tack boat never had to change course.',
  },
  '11': {
    title: 'Rule 11, on the same tack, overlapped',
    says: 'When boats on the same tack are overlapped, the windward boat keeps clear of the leeward boat.',
    couldHave: 'The windward boat could have sailed higher or slowed to open the gap, or not have come so close to leeward in the first place.',
  },
  '12': {
    title: 'Rule 12, on the same tack, not overlapped',
    says: 'When boats on the same tack are not overlapped, a boat clear astern keeps clear of a boat clear ahead.',
    couldHave: 'The boat astern could have steered to one side early, or eased her sheets to slow down.',
  },
  '13': {
    title: 'Rule 13, while tacking',
    says: 'After a boat passes head to wind, she keeps clear of other boats until she is on a close-hauled course.',
    couldHave: 'She could have tacked where there was room, finishing the tack before the other boat had to change course.',
  },
  '31': {
    title: 'Rule 31, touching a mark',
    says: 'While racing, a boat must not touch a starting mark before starting, a mark of the leg she is sailing, or a finishing mark after finishing.',
    couldHave: 'Approach the mark a little wider and keep a boat-width off as you round it; the stream sets you towards a mark you pass up-tide of.',
  },
};

/** The penalty, in words (rule 44). */
export function penaltyText(inc: Incident): string | undefined {
  if (!inc.penaltyTurns) return undefined;
  const which = inc.penaltyTurns === 1 ? 'a One-Turn Penalty (one tack and one gybe)' : 'a Two-Turns Penalty (two tacks and two gybes)';
  const done = inc.penaltyTaken ? 'It was taken.' : 'It was not taken.';
  return `The boat that broke the rule could take ${which} promptly, well clear of other boats (rule 44). ${done}`;
}

/** A frame at time t (the nearest kept). */
export function frameAt(frames: readonly Frame[], t: number): Frame | undefined {
  let best: Frame | undefined;
  for (const f of frames) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
  return best;
}
