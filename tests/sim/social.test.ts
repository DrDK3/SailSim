import { describe, expect, it, beforeEach } from 'vitest';
import { ADJECTIVES, CREATURES, isSafeName, nameFrom, randomName } from '../../src/app/safeNames';
import { challengeResult, decodeChallenge, encodeChallenge, challengePayload, challengeUrl, splitsFrom, type Challenge } from '../../src/app/challenge';
import { isLikeForLikeKey, loadLikeForLike, recordAttempt, HISTORY_MAX } from '../../src/app/bests';
import { assistsFromInputs, noAssists, noteAssists } from '../../src/app/assists';
import { SimController, type AppScenario } from '../../src/app/controller';
import { encodeJson } from '../../src/app/shareLink';

/** A Map-backed localStorage for Node. */
function memoryStorage() {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(), key: () => null, length: 0,
  } as Storage;
}

describe('word-list names', () => {
  it('only exact list combinations with 1–99 are names', () => {
    expect(isSafeName('Blue Heron 42')).toBe(true);
    expect(isSafeName('blue heron 42')).toBe(false);
    expect(isSafeName('Blue Heron 0')).toBe(false);
    expect(isSafeName('Blue Heron 100')).toBe(false);
    expect(isSafeName('Blue  Heron 42')).toBe(false);
    expect(isSafeName('Blue Heron 42 ')).toBe(false);
    expect(isSafeName('Sam Smith 12')).toBe(false);
    expect(isSafeName('Blue Heron 42; drop')).toBe(false);
    expect(isSafeName(42)).toBe(false);
    for (let i = 0; i < 500; i++) expect(isSafeName(randomName())).toBe(true);
    expect(isSafeName(nameFrom(-1, -1, 0))).toBe(true);
  });

  it('the lists have no duplicates and only plain capitalised words', () => {
    for (const l of [ADJECTIVES, CREATURES]) {
      expect(new Set(l).size).toBe(l.length);
      for (const w of l) expect(w).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});

const FREE: AppScenario = {
  conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 11, twdDeg: 225 }, gusts: { preset: 'steady', seed: 9 }, current: { mode: 'none' } },
  startLocation: 'start-bay-practice', startHeadingDeg: 0, startSpeedKn: 3,
};

describe('challenge links', () => {
  const rec = () => {
    const c = new SimController();
    c.restart(FREE);
    c.advance(3);
    return c.saveRecording('t');
  };
  const ch = (): Challenge => ({ v: 1, name: 'Blue Heron 42', course: 'Short course', key: 'challenge:2026-11-17', finishS: 300, splits: [{ label: 'Windward mark', t: 140 }, { label: 'Leeward mark', t: 230 }], independent: true, rec: rec() });

  it('round-trips through a link, nothing but the fragment', async () => {
    const c = ch();
    const url = challengeUrl('https://example.org/SailSim/?x=1#old', await encodeChallenge(c));
    expect(url.startsWith('https://example.org/SailSim/?x=1#challenge=c1.')).toBe(true);
    const back = await decodeChallenge(challengePayload(new URL(url).hash)!);
    expect(back.name).toBe(c.name);
    expect(back.splits).toEqual(c.splits);
    expect(back.rec.endStep).toBe(c.rec.endStep);
  });

  it('refuses a link whose name is not a word-list name (no free text gets through)', async () => {
    await expect(encodeChallenge({ ...ch(), name: 'Sam Smith' })).rejects.toThrow(/word-list/);
    const forged = await encodeJson('c1.', { ...ch(), name: 'Sam from Year 8' });
    await expect(decodeChallenge(forged)).rejects.toThrow(/name/);
  });

  it('says who won by how much, and where time went', () => {
    const theirs = { name: 'Blue Heron 42', finishS: 300, splits: [{ label: 'Windward mark', t: 140 }, { label: 'Leeward mark', t: 230 }] };
    const won = challengeResult({ finishS: 288, splits: [{ label: 'Windward mark', t: 130 }, { label: 'Leeward mark', t: 222 }] }, theirs);
    expect(won.headline).toBe('You beat Blue Heron 42 by 12 s');
    expect(won.detail).toMatch(/the windward mark/);
    const lost = challengeResult({ finishS: 308, splits: [{ label: 'Windward mark', t: 149 }, { label: 'Leeward mark', t: 238 }] }, theirs);
    expect(lost.headline).toBe('Blue Heron 42 was 8 s faster');
    expect(lost.detail).toMatch(/^Watch how their ghost sails the leg to the windward mark: they gained 9 s there\.$/);
    expect(lost.legs.map((l) => l.gained)).toEqual([-9, 1, 0]);
  });

  it('splits come from the course judge, in seconds after the start signal', () => {
    expect(splitsFrom([{ t: 1, type: 'start', time: 60.2 }, { t: 2, type: 'rounded', leg: 0, label: 'Windward mark', time: 201.37 }, { t: 3, type: 'finish', time: 400 }], 60)).toEqual([{ label: 'Windward mark', t: 141.4 }]);
  });
});

describe('like-for-like bests', () => {
  beforeEach(memoryStorage);
  it('only the weekly course and the daily challenge, independent and assisted kept apart, with a history', () => {
    expect(isLikeForLikeKey('weekly:2026-W47')).toBe(true);
    expect(isLikeForLikeKey('challenge:2026-11-17')).toBe(true);
    expect(isLikeForLikeKey('Short course · 1 lap')).toBe(false);
    expect(recordAttempt('Short course · 1 lap', 'x', 100, true).best).toBe(false);
    expect(recordAttempt('weekly:2026-W47', 'Week 47', 320, false).best).toBe(true);
    expect(recordAttempt('weekly:2026-W47', 'Week 47', 330, true).best).toBe(true); // first independent
    expect(recordAttempt('weekly:2026-W47', 'Week 47', 325, true)).toEqual({ best: true, previousS: 330 });
    expect(recordAttempt('weekly:2026-W47', 'Week 47', 340, false)).toEqual({ best: false, previousS: 320 });
    const e = loadLikeForLike('weekly:2026-W47')!;
    expect(e.independent!.timeS).toBe(325);
    expect(e.assisted!.timeS).toBe(320);
    expect(e.history.map((h) => h.timeS)).toEqual([320, 330, 325, 340]);
    for (let i = 0; i < 30; i++) recordAttempt('weekly:2026-W47', 'Week 47', 400 + i, true);
    expect(loadLikeForLike('weekly:2026-W47')!.history).toHaveLength(HISTORY_MAX);
  });
});

describe('the assist record (the training slice’s shape and rule)', () => {
  it('auto-crew alone keeps a run independent; auto-trim, the overlay or live help make it assisted', () => {
    const r = noAssists();
    noteAssists(r, { autoCrew: true });
    expect(r.independent).toBe(true);
    for (const k of ['autoMain', 'autoJib', 'overlay', 'liveHelp'] as const) {
      const q = noAssists();
      noteAssists(q, { [k]: true });
      expect(q.independent, k).toBe(false);
    }
    expect(Object.keys(r.assists).sort()).toEqual(['autoCrew', 'autoJib', 'autoMain', 'liveHelp', 'overlay']);
  });

  it('auto-trim is read back from a replay’s input log', () => {
    expect(assistsFromInputs([[0, 0, 0.3, 0.3, 0.6, 4], [10, 0, 0.3, 0.3, 0.6, 5]])).toEqual({ autoMain: true, autoJib: false, autoCrew: true });
    expect(assistsFromInputs([[0, 0, 0.3, 0.3, 0.6, 4], [10, 0, 0.3, 0.3, 0.6, 5]], 5)).toEqual({ autoMain: false, autoJib: false, autoCrew: true });
  });
});
