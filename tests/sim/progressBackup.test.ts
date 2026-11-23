/**
 * Design handover (23 Nov 2026), item 25: a versioned local progress backup. Export, restore in a fresh browser, say
 * what was retained; a duplicate import changes nothing; the merge never loses what is here; files that are not
 * backups, from a newer version or damaged are refused whole; a save that fails part-way leaves the browser as it was.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, exportProgress, parseBackup, restoreProgress } from '../../src/app/progressBackup';
import { loadLessonProgress, saveLessonResult } from '../../src/app/lessons';
import { loadBests, loadLikeForLike, recordAttempt, recordRaceTime, recordStart } from '../../src/app/bests';
import { loadRuns, saveRun } from '../../src/app/exercises/records';
import { loadStarted, noteStarted } from '../../src/app/learnMap';
import { resetStorageStatus } from '../../src/app/storage';

let memory = new Map<string, string>();
let failKey: string | undefined;
const fresh = () => {
  memory = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (k === failKey) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError', code: 22 });
      memory.set(k, v);
    },
    removeItem: (k: string) => void memory.delete(k),
  };
};
beforeEach(() => {
  failKey = undefined;
  resetStorageStatus();
  fresh();
});

const run = (at: string) => ({ exercise: 'tack-recover', at, build: 'b', thresholdsChanged: false, status: 'draft' as never, attempts: [], help: [] });

function someProgress() {
  saveLessonResult('steer', [], new Date('2026-11-20T10:00:00Z'));
  saveLessonResult('wind', ['Beat'], new Date('2026-11-21T10:00:00Z'));
  recordRaceTime('race:Short|1|x', 'Short course', 300, new Date('2026-11-20T10:00:00Z'));
  recordStart(2.5, new Date('2026-11-20T10:00:00Z'), 4.1);
  recordAttempt('weekly:2026-W48:r2', 'Week 48', 400, true, new Date('2026-11-22T10:00:00Z'));
  saveRun(run('2026-11-22T11:00:00Z'));
  noteStarted('lesson:wind');
}

describe('back up and restore', () => {
  it('a backup restored in a fresh browser brings everything back, and says what', () => {
    someProgress();
    const text = exportProgress('test-build', new Date('2026-11-23T12:00:00Z'));
    expect(JSON.parse(text)).toMatchObject({ format: BACKUP_FORMAT, version: 1, build: 'test-build' });
    fresh();
    const r = restoreProgress(text);
    expect(r.ok).toBe(true);
    expect(r.changes.join('; ')).toMatch(/1 more lesson done/);
    expect(loadLessonProgress().steer).toMatchObject({ done: true });
    expect(loadLessonProgress().wind).toMatchObject({ done: false, skipped: ['Beat'] });
    expect(loadBests().races['race:Short|1|x']!.timeS).toBe(300);
    expect(loadBests().start).toMatchObject({ delayS: 2.5, kn: 4.1 });
    expect(loadLikeForLike('weekly:2026-W48:r2')!.independent!.timeS).toBe(400);
    expect(loadRuns()).toHaveLength(1);
    expect(loadStarted()).toEqual(['lesson:wind']);
  });

  it('restoring the same backup twice changes nothing the second time', () => {
    someProgress();
    const text = exportProgress('b');
    const before = new Map(memory);
    const r = restoreProgress(text);
    expect(r).toEqual({ ok: true, changes: [] });
    expect(memory).toEqual(before);
  });

  it('merging keeps the better of each: a faster time here stays, a slower one is improved, lessons stay done', () => {
    recordRaceTime('race:A', 'A', 250);
    recordRaceTime('race:B', 'B', 500);
    saveLessonResult('steer', []);
    const here = exportProgress('b');
    fresh();
    recordRaceTime('race:A', 'A', 300);
    recordRaceTime('race:B', 'B', 450);
    saveLessonResult('steer', ['Steer']); // reached the end with a skip here
    const theirs = JSON.parse(exportProgress('b')) as { stores: unknown };
    fresh();
    restoreProgress(JSON.stringify({ ...JSON.parse(here), stores: (theirs as { stores: unknown }).stores }));
    restoreProgress(here);
    expect(loadBests().races['race:A']!.timeS).toBe(250);
    expect(loadBests().races['race:B']!.timeS).toBe(450);
    expect(loadLessonProgress().steer!.done).toBe(true);
  });

  it('challenge histories are joined without duplicates', () => {
    recordAttempt('weekly:2026-W48:r2', 'W48', 400, true, new Date('2026-11-22T10:00:00Z'));
    const a = exportProgress('b');
    recordAttempt('weekly:2026-W48:r2', 'W48', 390, false, new Date('2026-11-22T11:00:00Z'));
    restoreProgress(a);
    expect(loadLikeForLike('weekly:2026-W48:r2')!.history).toHaveLength(2);
  });
});

describe('files that are refused, changing nothing', () => {
  it('not a backup (a replay, say), not JSON, newer, or damaged in one store', () => {
    someProgress();
    const before = new Map(memory);
    expect(restoreProgress('{"schema":"squib-replay/4"}').error).toMatch(/not a SailSim progress backup\. It looks like a replay/);
    expect(restoreProgress('not json').error).toMatch(/not readable JSON/);
    expect(restoreProgress(JSON.stringify({ format: BACKUP_FORMAT, version: 2, stores: {} })).error).toMatch(/newer version/);
    const good = JSON.parse(exportProgress('b')) as { stores: { bests: { races: Record<string, unknown> } } };
    good.stores.bests.races['race:X'] = { timeS: 'fast', at: '', label: '' };
    expect(restoreProgress(JSON.stringify(good)).error).toMatch(/damaged \(its best times could not be read\)/);
    expect(memory).toEqual(before);
  });

  it('an older backup with a store missing reads the rest (missing is not damaged)', () => {
    const b = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, stores: { lessons: { steer: { done: true, at: '2026-11-01T00:00:00Z' } } } }));
    expect(b.stores.lessons.steer!.done).toBe(true);
    expect(b.stores.exerciseRuns).toEqual([]);
  });

  it('a save that fails part-way puts back what it wrote: the browser holds exactly what it held', () => {
    saveLessonResult('steer', []);
    const lessonsBefore = memory.get('squib.lessons.v1');
    fresh();
    someProgress();
    const text = exportProgress('b');
    fresh();
    saveLessonResult('turns', []);
    const before = new Map(memory);
    failKey = 'squib.bests.v1'; // lessons are written first, then this fails
    const r = restoreProgress(text);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not save your best times, so nothing was restored/);
    expect(memory).toEqual(before);
    expect(lessonsBefore).toBeDefined();
  });
});
