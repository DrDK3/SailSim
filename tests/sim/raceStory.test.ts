/**
 * The race's story for the results (owner, 18 Nov 2026): your place with the gaps to the boats either side, and your
 * place at the start, at each mark and at the finish. From the race's own records.
 */
import { describe, expect, it } from 'vitest';
import { finishStory, gapText, markPlaces, ordinal } from '../../src/app/raceStory';

const row = (name: string, place: number | null, elapsed?: number, you = false, code = 'FIN') => ({ you, place, code, elapsed, name, sailNumber: you ? 'GBR' : 'AI' });

describe('the finish', () => {
  it('your place, and the gaps to the boat ahead, the boat behind and the winner', () => {
    const s = finishStory([row('A', 1, 300), row('You', 2, 312.4, true), row('B', 3, 320.5), row('C', null, undefined, false, 'DNF')])!;
    expect(s).toMatchObject({ place: 2, of: 4, elapsedS: 312.4 });
    expect(s.ahead).toEqual({ boat: 'AI A', gapS: expect.closeTo(12.4, 9) });
    expect(s.behind).toEqual({ boat: 'AI B', gapS: expect.closeTo(8.1, 9) });
    expect(s.toWinnerS).toBeCloseTo(12.4, 9);
  });

  it('a winner has nobody ahead; the last finisher nobody behind; a boat that did not finish has no story', () => {
    const won = finishStory([row('You', 1, 300, true), row('A', 2, 301)])!;
    expect(won.ahead).toBeUndefined();
    expect(won.toWinnerS).toBe(0);
    expect(won.behind?.gapS).toBeCloseTo(1, 9);
    expect(finishStory([row('A', 1, 300), row('You', 2, 340, true)])!.behind).toBeUndefined();
    expect(finishStory([row('A', 1, 300), row('You', null, undefined, true, 'RET')])).toBeUndefined();
    expect(finishStory([row('A', null, undefined, false, undefined as never), row('You', null, undefined, true, undefined as never)])).toBeUndefined();
  });

  it('words', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
    expect(gapText(4.23)).toBe('4.2 s');
    expect(gapText(72.4)).toBe('1 min 12 s');
  });
});

describe('places at each mark', () => {
  const boats = [
    { id: 'you', start: 3.0, marks: [{ leg: 0, label: 'Windward mark', time: 200 }, { leg: 1, label: 'Leeward gate', time: 390 }], finish: 400 },
    { id: 'a', start: 1.0, marks: [{ leg: 0, label: 'Windward mark', time: 190 }, { leg: 1, label: 'Leeward gate', time: 395 }], finish: 405 },
    { id: 'b', start: 5.0, marks: [{ leg: 0, label: 'Windward mark', time: 195 }], finish: undefined },
    { id: 'c', start: undefined, marks: [], finish: undefined },
  ];
  it('one more than the boats that got there first; a boat that never arrived is behind', () => {
    expect(markPlaces(boats)).toEqual([
      { label: 'Start', place: 2, of: 4 },
      { label: 'Windward mark', place: 3, of: 4 },
      { label: 'Leeward gate', place: 1, of: 4 },
      { label: 'Finish', place: 1, of: 4 },
    ]);
  });
  it('only what you reached: not started, nothing; alone, first everywhere', () => {
    expect(markPlaces([{ id: 'you', marks: [] }, boats[1]!])).toEqual([]);
    expect(markPlaces([boats[0]!]).every((p) => p.place === 1 && p.of === 1)).toBe(true);
    expect(markPlaces(boats, 'nobody')).toEqual([]);
  });
});

describe('short names for marks and gates', () => {
  it('names a gate by what its two marks share, and falls back to both names', async () => {
    const { gateName, legMarkName } = await import('../../src/app/raceStory');
    expect(gateName('Leeward gate (left)', 'Leeward gate (right)')).toBe('Leeward gate');
    expect(gateName('A', 'B')).toBe('Gate A–B');
    expect(gateName('Pin', 'Pip')).toBe('Gate Pin–Pip');
    const names: Record<string, string> = { w: 'Windward', l: 'Leeward gate (left)', r: 'Leeward gate (right)' };
    expect(legMarkName({ type: 'mark', mark: 'w' }, (id) => names[id]!)).toBe('Windward');
    expect(legMarkName({ type: 'gate', marks: ['l', 'r'] }, (id) => names[id]!)).toBe('Leeward gate');
  });
});
