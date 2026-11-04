import { describe, expect, it } from 'vitest';
import { signalCaption } from '../../src/app/signalCaption';
import { DEFAULT_COMMITTEE, RaceCommittee } from '../../src/sim/race/committee';

/** Review GR-6: every start-sequence sound has a caption; signals without a sound have none. */
describe('sound signal captions', () => {
  it('name the sounds of RRS 26 and 29', () => {
    expect(signalCaption({ name: 'warning', sounds: 1 })).toBe('One sound: warning signal');
    expect(signalCaption({ name: 'one-minute', sounds: 1, long: true })).toBe('One long sound: one-minute signal');
    expect(signalCaption({ name: 'general-recall', sounds: 2 })).toBe('Two sounds: general recall (First Substitute)');
    expect(signalCaption({ name: 'x-down', sounds: 0 })).toBeUndefined();
  });
  it('a five-minute sequence makes four sound signals: warning, preparatory, one minute (long), start', () => {
    const cm = new RaceCommittee({ ...DEFAULT_COMMITTEE, startAt: 300, sequence: 'five-minute' }, ['you'], [{ n: 0, e: -50 }, { n: 0, e: 50 }], { n: 500, e: 0 });
    const caps: string[] = [];
    for (let t = 0; t <= 301; t += 1) for (const s of cm.update(t, [{ id: 'you', started: false, ocs: false, wasOcs: false, finished: false, retired: false }], () => [{ n: -100, e: 0 }])) { const c = signalCaption(s); if (c) caps.push(c); }
    expect(caps).toEqual(['One sound: warning signal', 'One sound: preparatory signal', 'One long sound: one-minute signal', 'One sound: starting signal']);
  });
});
