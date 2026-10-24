import type { SailForce } from '../sim/boat/forces';

/** How a sail is working, in the terms a sailor uses, with what to do about it. */
export type SailState = 'drawing' | 'luffing' | 'stalled' | 'by-the-lee';

export function sailState(f: SailForce): SailState {
  if (Math.abs(f.incidence) > Math.PI / 2) return 'by-the-lee';
  if (f.luff < 0.5) return 'luffing';
  if (f.stall > 0.5) return 'stalled';
  return 'drawing';
}

/** Plain-language status and advice for the sail's controls (keys for trim and ease). */
export function sailAdvice(state: SailState, keys: { trim: string; ease: string }): { text: string; advice: string; cls: 'good' | 'warn' | 'bad' } {
  switch (state) {
    case 'drawing':
      return { text: 'Drawing', advice: 'well trimmed', cls: 'good' };
    case 'luffing':
      return { text: 'Luffing', advice: `trim in (${keys.trim})`, cls: 'warn' };
    case 'stalled':
      return { text: 'Stalled', advice: `ease out (${keys.ease})`, cls: 'bad' };
    case 'by-the-lee':
      return { text: 'By the lee', advice: 'gybe risk: head up', cls: 'warn' };
  }
}
