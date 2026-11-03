import type { Signal } from '../sim/race/committee';

const WHAT: Record<Signal['name'], string> = {
  warning: 'warning signal',
  preparatory: 'preparatory signal',
  'one-minute': 'one-minute signal',
  start: 'starting signal',
  'individual-recall': 'individual recall (flag X)',
  'x-down': 'flag X down',
  'general-recall': 'general recall (First Substitute)',
  'first-substitute-down': 'First Substitute down',
};

/**
 * What a race committee signal sounds like, in words: the caption shown with the horn (review GR-6 and §8.4: a
 * visual equivalent for every sound). The sounds are those of RRS 26 and 29 as the simulator makes them; times are
 * taken from the flags, not the sounds (RRS 26). None for a signal made without a sound.
 */
export function signalCaption(s: Pick<Signal, 'name' | 'sounds' | 'long'>): string | undefined {
  if (s.sounds < 1) return undefined;
  const sound = s.long ? 'One long sound' : s.sounds === 1 ? 'One sound' : s.sounds === 2 ? 'Two sounds' : `${s.sounds} sounds`;
  return `${sound}: ${WHAT[s.name]}`;
}
