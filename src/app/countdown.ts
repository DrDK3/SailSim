/**
 * A spoken start countdown (review, 10 Nov 2026), as a countdown timer calls it: the minutes, thirty and twenty
 * seconds, then every second from ten. It speaks only what the race panel and the horn already say (the start
 * sequence of RRS 26), for anyone who wants to keep their eyes on the water. Spoken by the device's own voices only
 * (src/render/speech.ts). Off by default; Settings → Sound.
 *
 * Pure logic: which calls fall between two readings of the time to the start signal.
 */

export interface CountdownCall {
  /** Seconds before the start signal. */
  at: number;
  text: string;
}

const MINUTES = ['', 'One minute', 'Two minutes', 'Three minutes', 'Four minutes', 'Five minutes'];
const NUMBERS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** Every call, latest first in time (largest `at` first). */
export const COUNTDOWN_CALLS: readonly CountdownCall[] = [
  ...[5, 4, 3, 2, 1].map((m) => ({ at: m * 60, text: MINUTES[m]! })),
  { at: 30, text: 'Thirty seconds' },
  { at: 20, text: 'Twenty seconds' },
  ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((s) => ({ at: s, text: NUMBERS[s]! })),
];

/**
 * The call due as the time to the start went from `before` to `now` (s, counting down), if any. When the clock
 * jumped past several (a fast-forward, a pause, a recall resetting the sequence), only the latest is due, and only
 * if it was within a second: a call late by more than that would mislead.
 */
export function countdownCall(before: number, now: number): CountdownCall | undefined {
  if (!(before > now)) return undefined;
  let due: CountdownCall | undefined;
  for (const c of COUNTDOWN_CALLS) if (before > c.at && now <= c.at) due = c;
  return due && due.at - now <= 1 ? due : undefined;
}
