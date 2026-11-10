/**
 * The player's own preferences that are not graphics or sound: kept in this browser only (localStorage), never sent
 * anywhere. Every read and write is guarded: private windows and blocked storage fall back to the defaults.
 */
export interface Prefs {
  /** Letters by the vessels' sidelights (P port, S starboard), for players who cannot tell red from green. */
  lightLabels: boolean;
  /** Hints when you are stuck (in irons, sails flapping, aground …): src/app/hints.ts. */
  hints: boolean;
  /** Draw at most 30 frames a second, to save the battery (the physics is unchanged). */
  batterySaver: boolean;
  /** Daylight view: when the real sun is low or down, light the picture as at midday (src/app/daylightView.ts). */
  daylightView: boolean;
  /** The physics and developer tools in the More menu (also shown at the Expert level). */
  devTools: boolean;
  /** The start countdown spoken by the device's own voice (src/app/countdown.ts, src/render/speech.ts). */
  spokenCountdown: boolean;
}

/** A touch screen with no mouse (a phone or tablet): the battery saver starts on there. */
export function touchOnly(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

export const DEFAULT_PREFS: Prefs = { lightLabels: false, hints: true, batterySaver: false, daylightView: false, devTools: false, spokenCountdown: false };

function defaults(): Prefs {
  return { ...DEFAULT_PREFS, batterySaver: touchOnly() };
}
const KEY = 'squib.prefs.v1';

export function loadPrefs(): Prefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const d = defaults();
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      lightLabels: typeof p.lightLabels === 'boolean' ? p.lightLabels : d.lightLabels,
      hints: typeof p.hints === 'boolean' ? p.hints : d.hints,
      batterySaver: typeof p.batterySaver === 'boolean' ? p.batterySaver : d.batterySaver,
      daylightView: typeof p.daylightView === 'boolean' ? p.daylightView : d.daylightView,
      devTools: typeof p.devTools === 'boolean' ? p.devTools : d.devTools,
      spokenCountdown: typeof p.spokenCountdown === 'boolean' ? p.spokenCountdown : d.spokenCountdown,
    };
  } catch {
    return defaults();
  }
}

export function savePrefs(p: Prefs): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable: the choice lasts for this visit.
  }
}
