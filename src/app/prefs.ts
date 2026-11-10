/**
 * The player's own preferences that are not graphics or sound: kept in this browser only (localStorage), never sent
 * anywhere. Every read and write is guarded: private windows and blocked storage fall back to the defaults.
 */
export interface Prefs {
  /** Letters by the vessels' sidelights (P port, S starboard), for players who cannot tell red from green. */
  lightLabels: boolean;
  /** Hints when you are stuck (in irons, sails flapping, aground …): src/app/hints.ts. */
  hints: boolean;
}

export const DEFAULT_PREFS: Prefs = { lightLabels: false, hints: true };
const KEY = 'squib.prefs.v1';

export function loadPrefs(): Prefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      lightLabels: typeof p.lightLabels === 'boolean' ? p.lightLabels : DEFAULT_PREFS.lightLabels,
      hints: typeof p.hints === 'boolean' ? p.hints : DEFAULT_PREFS.hints,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable: the choice lasts for this visit.
  }
}
