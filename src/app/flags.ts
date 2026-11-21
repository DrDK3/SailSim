import type { InterfaceLevel } from './level';

/**
 * Feature switches the owner can turn off without changing code (fixes of 21 Nov 2026, §3.1): Settings → Advanced,
 * kept in this browser. With a switch off, the simulator behaves as `main` did before the package that added the
 * feature. Storage can be unavailable (a private window): then every switch has its default.
 */
export type FeatureFlag = 'spinnaker' | 'riverHotSwap' | 'plainLanguage' | 'learnMap' | 'markRoomPenalties';

export interface FlagSpec {
  label: string;
  /** What switching it off does. */
  off: string;
  /** On by default, off by default, or on only at the Learn level. */
  defaultOn: boolean | 'learn';
}

export const FEATURE_FLAGS: Record<FeatureFlag, FlagSpec> = {
  spinnaker: {
    label: 'Spinnaker',
    off: 'No spinnaker anywhere: races, the weekly course, free sailing and the AI fleets sail without one, as before package B.',
    defaultOn: true,
  },
  riverHotSwap: {
    label: 'River data joins a run in progress',
    off: 'When the River Dart data arrives, the run restarts with it, as before package A.',
    defaultOn: true,
  },
  plainLanguage: {
    label: 'Plain words at Learn',
    off: 'The Learn level uses the same words as Club, as before package A.',
    defaultOn: 'learn',
  },
  learnMap: {
    label: 'Learn map',
    off: 'No Learn map in Settings or the welcome, as before package D.',
    defaultOn: true,
  },
  markRoomPenalties: {
    label: 'Mark-room penalties (rule 18, simplified)',
    off: 'Rule 18 is advisory: the judge notes who should have given mark-room but rules and penalises as before package F. On: the boat owing mark-room takes the penalty. Off until the club has reviewed the rule.',
    defaultOn: false,
  },
};

export const FLAG_ORDER: FeatureFlag[] = ['spinnaker', 'riverHotSwap', 'plainLanguage', 'learnMap', 'markRoomPenalties'];

const KEY = (f: FeatureFlag) => `squib.flag.${f}`;

/** The switch as set in this browser, or undefined when it was never set (then the default holds). */
export function storedFlag(f: FeatureFlag): boolean | undefined {
  try {
    const v = localStorage.getItem(KEY(f));
    return v === '1' ? true : v === '0' ? false : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a feature is on, for the given interface level (only `plainLanguage` depends on it). */
export function featureOn(f: FeatureFlag, level?: InterfaceLevel): boolean {
  const s = storedFlag(f);
  if (s !== undefined) return f === 'plainLanguage' ? s && level === 'learn' : s;
  const d = FEATURE_FLAGS[f].defaultOn;
  return d === 'learn' ? level === 'learn' : d;
}

/** Set a switch (true or false), or clear it back to its default (undefined). */
export function setFeatureFlag(f: FeatureFlag, on: boolean | undefined): void {
  try {
    if (on === undefined) localStorage.removeItem(KEY(f));
    else localStorage.setItem(KEY(f), on ? '1' : '0');
  } catch {
    // Not remembered: storage is unavailable.
  }
}
