/**
 * The interface level (review U5): how much the simulator shows by default, chosen on the first visit ("Have
 * you sailed before?") and changeable in Settings. It only changes defaults; every part can still be switched
 * on or off by hand, and the physics is the same at every level.
 *
 *  - Learn: the teaching overlay on, the race coach on, the dock without its advanced controls (flatten, the
 *    crew's hiking by hand).
 *  - Club: as the simulator has been: the coach on, the overlay off, the main instruments.
 *  - Expert: every instrument shown, the coach and the overlay off.
 */
export type InterfaceLevel = 'learn' | 'club' | 'expert';

export const LEVELS: { id: InterfaceLevel; label: string; text: string }[] = [
  { id: 'learn', label: 'Learn', text: 'The teaching overlay and the coach, and a simpler dock.' },
  { id: 'club', label: 'Club', text: 'The main instruments and the coach.' },
  { id: 'expert', label: 'Expert', text: 'Every instrument; no coach or overlay.' },
];

const KEY = 'squib.level.v1';

/** The level kept in this browser; Club (the simulator as it was) when none has been chosen. */
export function loadLevel(): InterfaceLevel {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'learn' || v === 'expert' || v === 'club' ? v : 'club';
  } catch {
    return 'club';
  }
}

/** Whether a level has been chosen in this browser. */
export function hasStoredLevel(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function saveLevel(l: InterfaceLevel): void {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // storage unavailable: the choice lasts for this visit
  }
}

/** What each level turns on by default. */
export function levelDefaults(l: InterfaceLevel): { teaching: boolean; coach: boolean; allInstruments: boolean; advancedDock: boolean } {
  return {
    teaching: l === 'learn',
    coach: l !== 'expert',
    allInstruments: l === 'expert',
    advancedDock: l !== 'learn',
  };
}
