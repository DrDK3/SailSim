import type { BoatSnapshot } from '../sim/simulation';
import type { InterfaceLevel } from './level';
import { SPIN_PARAMS } from '../sim/boat/spinnaker';

/**
 * The spinnaker's state in words (package B): the text alternative for the picture, read out when it changes, and the
 * console's status. Colour and words agree (review #17): good only when it is up and drawing. At Learn the words are
 * plain (it is "the big sail at the front").
 */
export interface SpinnakerWords {
  words: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  /** What to do about it, when anything (with the key). */
  advice?: string;
}

const DEG = 180 / Math.PI;

export function spinnakerWords(s: BoatSnapshot['spin'], level: InterfaceLevel, manual = false): SpinnakerWords | undefined {
  if (!s) return undefined;
  const plain = level === 'learn';
  const name = plain ? 'Big front sail' : 'Spinnaker';
  switch (s.phase) {
    case 'down':
      return { words: `${name} down`, tone: 'neutral', advice: Math.abs(s.awa) * DEG > SPIN_PARAMS.collapseAwaDeg + 50 ? `Wind behind you: hoist it (O)` : undefined };
    case 'hoisting':
      return { words: plain ? `${name} going up` : 'Hoisting the spinnaker', tone: 'neutral' };
    case 'dropping':
      return { words: plain ? `${name} coming down` : 'Dropping the spinnaker', tone: 'neutral' };
    case 'gybing':
      return { words: plain ? 'Moving the pole across' : 'Gybing the pole', tone: 'neutral' };
    case 'up': {
      if (s.fill > 0.9) return { words: plain ? `${name} full` : 'Spinnaker drawing', tone: 'good' };
      const deg = Math.abs(s.awa) * DEG;
      const forward = deg < SPIN_PARAMS.collapseAwaDeg;
      // Wind on the other side from the pole: by the lee on the wrong gybe.
      const wrongSide = Math.sign(s.awa || 1) !== s.poleSide && 180 - deg > SPIN_PARAMS.byLeeCollapseDeg * 0.5;
      const reason = forward
        ? plain
          ? 'the wind is too far ahead: bear away or take it down (O)'
          : 'wind too far forward: bear away or drop it (O)'
        : wrongSide
          ? plain
            ? 'the pole is on the wrong side: move it across (I)'
            : 'pole on the wrong side: gybe the pole (I)'
          : manual
            ? plain
              ? 'let out too far: pull the sheet in'
              : 'eased too far: trim the sheet'
            : plain
              ? 'filling again'
              : 'filling';
      return s.fill < 0.3
        ? { words: plain ? `${name} fallen in` : 'Spinnaker collapsed', tone: 'bad', advice: reason }
        : { words: plain ? `${name} falling in` : 'Spinnaker collapsing', tone: 'warn', advice: reason };
    }
  }
}
