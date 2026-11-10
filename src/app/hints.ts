import type { SailState } from './sailStatus';

/**
 * Hints when you are stuck (owner, 10 Nov 2026: onboarding for people "who just want to jump in and get going").
 * Rather than a tour of the screen before sailing, a hint appears only when the boat shows she needs one, once per
 * kind in this browser, and can be dismissed; most offer "Show me", which sails the boat out of it for a few seconds
 * (src/app/controller.ts). The lessons stay for anyone who chooses Learn. Pure logic: the controller feeds it a
 * sample of the boat every 0.1 s.
 */

export type HintId = 'in-irons' | 'flapping' | 'overpowered' | 'aground' | 'backwards' | 'harbour-speed' | 'ferry-close';

/** What "Show me" does: steer to a true wind angle (deg) for a while, turn the sheets to auto, or ease the main. */
export type ShowMe = { kind: 'bear-away'; twaDeg: number; seconds: number } | { kind: 'auto-sheets' } | { kind: 'ease-main'; seconds: number };

export interface Hint {
  id: HintId;
  title: string;
  text: string;
  showMe?: { label: string; action: ShowMe };
}

export interface HintSample {
  t: number;
  twaDeg: number;
  stwKn: number;
  sogKn: number;
  heelDeg: number;
  grounded: boolean;
  main: SailState;
  jib: SailState;
  autoMain: boolean;
  autoJib: boolean;
  /** Inside the harbour's 6 kn limit (docs/CLUB_DOCUMENTS.md). */
  inHarbour?: boolean;
  /** Distance to the nearest ferry under way (m), when one is near. */
  ferryM?: number;
}

export const HINTS: Record<HintId, Omit<Hint, 'id'>> = {
  'in-irons': {
    title: 'In irons',
    text: 'She is pointing into the wind and has stopped. Steer away from the wind (A or D, or drag the helm) until the sails fill, then sail on.',
    showMe: { label: 'Show me', action: { kind: 'bear-away', twaDeg: 70, seconds: 12 } },
  },
  flapping: {
    title: 'The sails are flapping',
    text: 'A flapping sail drives nothing. Pull its sheet in (W for the main, E for the jib) until it just stops flapping, or let the crew trim for you (M and J).',
    showMe: { label: 'Trim for me', action: { kind: 'auto-sheets' } },
  },
  overpowered: {
    title: 'Heeling hard',
    text: 'She is on her ear and slipping sideways. Ease the mainsheet a little (S) or turn a touch towards the wind; the crew hiking out helps too.',
    showMe: { label: 'Ease for me', action: { kind: 'ease-main', seconds: 4 } },
  },
  aground: {
    title: 'Aground',
    text: 'The keel is on the bottom. Steer back the way you came, towards darker water on the minimap; if she has stopped, only a rising tide floats her off, or press R to start again.',
  },
  backwards: {
    title: 'Going backwards',
    text: 'The wind is pushing her astern. Hold the helm still for a moment, then steer away from the wind so the sails fill.',
    showMe: { label: 'Show me', action: { kind: 'bear-away', twaDeg: 80, seconds: 6 } },
  },
  'harbour-speed': {
    title: 'Harbour speed limit',
    text: 'The Dart has a 6-knot limit from Castle Ledge buoy up to Totnes (harbour guide). Ease a sheet to slow down.',
  },
  'ferry-close': {
    title: 'Keep clear of the ferries',
    text: 'The harbour guide asks every boat to keep clear of the ferries at all times: they are restricted in their ability to manoeuvre and cannot get out of your way.',
  },
};

/** How long each condition must last before its hint shows (s), and what it is. */
const RULES: { id: HintId; hold: number; when: (s: HintSample) => boolean }[] = [
  { id: 'aground', hold: 2, when: (s) => s.grounded },
  { id: 'in-irons', hold: 5, when: (s) => !s.grounded && s.twaDeg < 35 && s.stwKn < 0.6 },
  { id: 'backwards', hold: 3, when: (s) => !s.grounded && s.stwKn < -0.3 },
  { id: 'flapping', hold: 6, when: (s) => !s.grounded && s.twaDeg > 50 && (s.main === 'luffing' || s.jib === 'luffing') && !(s.autoMain && s.autoJib) },
  { id: 'overpowered', hold: 5, when: (s) => s.heelDeg > 32 },
  { id: 'ferry-close', hold: 0.5, when: (s) => (s.ferryM ?? Infinity) < 40 },
  { id: 'harbour-speed', hold: 3, when: (s) => !!s.inHarbour && s.sogKn > 6 },
];

export class HintEngine {
  private since = new Map<HintId, number>();
  /** The hint showing, if any, and when it appeared. */
  current?: Hint & { at: number };

  /** `seen`: the kinds already shown in this browser (each shows once). */
  constructor(private readonly seen: Set<HintId>) {}

  /** Feed a sample; returns a hint the first time its condition has lasted long enough. */
  update(s: HintSample): Hint | undefined {
    for (const r of RULES) {
      if (!r.when(s)) {
        this.since.delete(r.id);
        continue;
      }
      if (!this.since.has(r.id)) this.since.set(r.id, s.t);
      if (this.seen.has(r.id) || this.current) continue;
      if (s.t - this.since.get(r.id)! >= r.hold) {
        const h: Hint = { id: r.id, ...HINTS[r.id] };
        this.current = { ...h, at: s.t };
        this.seen.add(r.id);
        return h;
      }
    }
    // A hint clears itself once the boat is out of it (and after a while in any case).
    if (this.current) {
      const r = RULES.find((x) => x.id === this.current!.id)!;
      if (!r.when(s) && s.t - this.current.at > 4) this.current = undefined;
      else if (s.t - this.current.at > 25) this.current = undefined;
    }
    return undefined;
  }

  dismiss(): void {
    this.current = undefined;
  }

  get seenIds(): HintId[] {
    return [...this.seen];
  }
}

const SEEN_KEY = 'squib.hints.seen.v1';
export function loadSeenHints(): Set<HintId> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SEEN_KEY) : null;
    const a = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(a) ? (a.filter((x) => typeof x === 'string' && x in HINTS) as HintId[]) : []);
  } catch {
    return new Set();
  }
}
export function saveSeenHints(ids: HintId[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    // This visit only.
  }
}

// ------------------------------------------------------------------ your progress (this browser only)

/**
 * A few numbers about your first sails, counted in this browser only and never sent anywhere: when you first sailed,
 * how long it took to get going, your first tack. Measuring onboarding across players would need an analytics
 * service (an external service, with a privacy notice); this keeps the useful part on the device.
 */
export interface Milestones {
  firstVisit?: string;
  /** Seconds of sailing before the boat first reached 2 kn. */
  firstSailS?: number;
  /** Seconds of sailing before the first tack. */
  firstTackS?: number;
  sessions: number;
  hintsShown: number;
  showMeUsed: number;
}

const MS_KEY = 'squib.milestones.v1';
export function loadMilestones(): Milestones {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(MS_KEY) : null;
    const m = raw ? (JSON.parse(raw) as Partial<Milestones>) : {};
    return { sessions: 0, hintsShown: 0, showMeUsed: 0, ...m };
  } catch {
    return { sessions: 0, hintsShown: 0, showMeUsed: 0 };
  }
}
export function saveMilestones(m: Milestones): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(MS_KEY, JSON.stringify(m));
  } catch {
    // This visit only.
  }
}
