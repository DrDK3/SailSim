import { clampTabDeg, DEFAULT_TAB_DEG, type IndicatorType } from './windIndicator';
import { DEFAULT_SPINNAKER_COLOURS, isSpinnakerColour, type SpinnakerColourId } from './spinnakerColours';

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
  /** The physics and developer tools in the Settings menu (also shown at the Expert level). */
  devTools: boolean;
  /** The start countdown spoken by the device's own voice (src/app/countdown.ts, src/render/speech.ts). */
  spokenCountdown: boolean;
  /** Gust outlines on the water (a teaching aid: src/render/puffOutlines.ts), and whether also in races. */
  gustOutlines: boolean;
  gustOutlinesInRaces: boolean;
  /** Vibration on a game controller (gusts, the boom crossing, contact); never with reduced motion. */
  haptics: boolean;
  /** What flies at the masthead (review #4, pending the sailors' answer): the RDYC burgee or a masthead vane. */
  windIndicator: IndicatorType;
  /** The colours of the player's spinnaker (package B; the simulator's own colour sets). */
  spinnakerColours: SpinnakerColourId;
  /** The vane's tacking tabs either side of dead aft (deg, E). */
  vaneTabDeg: number;
  /** The small picture of the masthead by the compass (review #2). */
  mastheadInset: boolean;
  /** The helm view's field of view (deg; review #15): the widest it zooms out to. */
  helmFovDeg: number;
  /**
   * Instructor view (review #14, package D): the provenance and evidence labels, the exercises' thresholds and the
   * assist record shown where they apply. Off (the player view), they are gathered in About, behind one "How far to
   * trust this" link: moved, not deleted.
   */
  instructorView: boolean;
  /**
   * Look up at the masthead as a toggle (fixes of 21 Nov 2026, §3.3): T and the console's button look up with one press
   * and back with the next, for players who cannot hold a key. Off (the default): held, as before.
   */
  lookUpToggle: boolean;
}

/** The helm view's field of view (deg): its range in Settings and the default (as before, E). */
export const HELM_FOV_RANGE = [50, 90] as const;
export const DEFAULT_HELM_FOV = 68;
export const clampHelmFov = (d: number): number => Math.round(Math.max(HELM_FOV_RANGE[0], Math.min(HELM_FOV_RANGE[1], d)));

/** A touch screen with no mouse (a phone or tablet): the battery saver starts on there. */
export function touchOnly(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

export const DEFAULT_PREFS: Prefs = {
  lightLabels: false,
  hints: true,
  batterySaver: false,
  daylightView: false,
  devTools: false,
  spokenCountdown: false,
  haptics: true,
  gustOutlines: false,
  gustOutlinesInRaces: false,
  windIndicator: 'burgee',
  spinnakerColours: DEFAULT_SPINNAKER_COLOURS,
  vaneTabDeg: DEFAULT_TAB_DEG,
  mastheadInset: true,
  helmFovDeg: DEFAULT_HELM_FOV,
  instructorView: false,
  lookUpToggle: false,
};

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
      haptics: typeof p.haptics === 'boolean' ? p.haptics : d.haptics,
      gustOutlines: typeof p.gustOutlines === 'boolean' ? p.gustOutlines : d.gustOutlines,
      gustOutlinesInRaces: typeof p.gustOutlinesInRaces === 'boolean' ? p.gustOutlinesInRaces : d.gustOutlinesInRaces,
      windIndicator: p.windIndicator === 'vane' || p.windIndicator === 'burgee' ? p.windIndicator : d.windIndicator,
      spinnakerColours: isSpinnakerColour(p.spinnakerColours) ? p.spinnakerColours : d.spinnakerColours,
      vaneTabDeg: typeof p.vaneTabDeg === 'number' ? clampTabDeg(p.vaneTabDeg) : d.vaneTabDeg,
      mastheadInset: typeof p.mastheadInset === 'boolean' ? p.mastheadInset : d.mastheadInset,
      helmFovDeg: typeof p.helmFovDeg === 'number' && Number.isFinite(p.helmFovDeg) ? clampHelmFov(p.helmFovDeg) : d.helmFovDeg,
      instructorView: typeof p.instructorView === 'boolean' ? p.instructorView : d.instructorView,
      lookUpToggle: typeof p.lookUpToggle === 'boolean' ? p.lookUpToggle : d.lookUpToggle,
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
