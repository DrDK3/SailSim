import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECKPOINT_STEPS, REPLAY_SCHEMA, decodeInputs, encodeInputs, parseRecording } from '../../src/app/replay';
import { SimController, type AppScenario } from '../../src/app/controller';
import { builtInScenarios, parseScenarioFile, scenarioFile, SCENARIO_SCHEMA } from '../../src/app/scenarioLibrary';
import { buildConditions } from '../../src/sim/env/conditions';
import type { InputLogEntry } from '../../src/sim/simulation';

/**
 * Replays (criterion 11 in the app): a recorded session played back reproduces every checkpoint hash, and
 * a changed input is detected. Runs the app's controller headless (no scene is attached).
 */

const FREE: AppScenario = {
  conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 11, twdDeg: 225 }, gusts: { preset: 'shifty', seed: 9 }, current: { mode: 'none' } },
  startLocation: 'start-bay-practice',
  startHeadingDeg: 0,
  startSpeedKn: 3,
};

/** Sail a little with the keys: bear away, then trim the main by hand, then tack. */
function sail(ctl: SimController): void {
  ctl.press('helmRight', true);
  ctl.advance(2);
  ctl.press('helmRight', false);
  ctl.advance(6);
  ctl.press('mainIn', true);
  ctl.advance(1.5);
  ctl.press('mainIn', false);
  ctl.advance(4);
  ctl.press('helmLeft', true);
  ctl.advance(3);
  ctl.press('helmLeft', false);
  ctl.advance(9.37);
}

describe('replay format', () => {
  it('encodes and decodes the input log exactly', () => {
    const log: InputLogEntry[] = [
      { step: 0, input: { helm: 0, mainSheet: 0.3, jibSheet: 0.31, crewHike: 0.6, autoMain: false, autoJib: true, autoCrew: true } },
      { step: 17, input: { helm: -0.014000000000000002, mainSheet: 0.29650000000000004, jibSheet: 1, crewHike: 0, autoMain: true, autoJib: false, autoCrew: false } },
    ];
    expect(decodeInputs(encodeInputs(log))).toEqual(log);
    expect(encodeInputs(log)[1]![5]).toBe(1);
  });

  it('rejects files that are not replays, with a reason', () => {
    expect(() => parseRecording(null)).toThrow(/not a JSON object/);
    expect(() => parseRecording({ schema: 'other' })).toThrow(/expected schema/);
    const base = { schema: REPLAY_SCHEMA, scenario: FREE, inputs: [[0, 0, 0.3, 0.3, 0.6, 6]], checkpoints: [], endStep: 10, dart: 'none' };
    expect(parseRecording(base).endStep).toBe(10);
    expect(() => parseRecording({ ...base, inputs: [[0, 0, 0.3]] })).toThrow(/bad input row/);
    expect(() => parseRecording({ ...base, inputs: [[5, 0, 0, 0, 0, 0], [5, 0, 0, 0, 0, 0]] })).toThrow(/increase/);
    expect(() => parseRecording({ ...base, inputs: [[0, 0, 0, 0, 0, Number.NaN]] })).toThrow(/bad input row/);
    expect(() => parseRecording({ ...base, dart: 'maybe' })).toThrow(/dart/);
  });
});

describe('replay in the app controller', () => {
  it('plays a recorded free-sailing session back, matching every checkpoint bit for bit', () => {
    const rec1 = new SimController();
    expect(rec1.restart(FREE)).toBe(true);
    sail(rec1);
    const rec = rec1.saveRecording('test');
    expect(rec.endStep).toBe(Math.round(25.87 / 0.01));
    expect(rec.inputs.length).toBeGreaterThan(100);
    // Checkpoints every CHECKPOINT_STEPS steps plus the end.
    expect(rec.checkpoints.map((c) => c[0])).toEqual([1000, 2000, rec.endStep]);

    const play = new SimController();
    // A different run first, so the replay has to rebuild everything from the file.
    play.restart({ ...FREE, startHeadingDeg: 90 });
    play.advance(3);
    expect(play.startReplay(JSON.parse(JSON.stringify(rec)))).toBe(true);
    play.advance(rec.endStep * 0.01 + 1); // runs to the end and stops there
    const st = play.getState().replay!;
    expect(st.finished).toBe(true);
    expect(st.state).toBe('ended');
    expect(st.checkpointsMatched).toBe(3);
    expect(st.checkpointsTotal).toBe(3);
    expect(play.sim.step).toBe(rec.endStep);
    expect(play.stateHash()).toBe(rec.checkpoints[2]![1]);
  });

  it('detects a changed input: the replay reports where it diverged', () => {
    const c = new SimController();
    c.restart(FREE);
    sail(c);
    const rec = c.saveRecording('tampered');
    // Nudge the helm of one row before the first checkpoint.
    const i = rec.inputs.findIndex((r) => r[0] > 50 && r[0] < CHECKPOINT_STEPS);
    rec.inputs[i]![1] += 0.05;
    const play = new SimController();
    expect(play.startReplay(rec)).toBe(true);
    play.advance(rec.endStep * 0.01 + 1);
    const st = play.getState().replay!;
    expect(st.state).toBe('diverged');
    expect(st.divergedAtS).toBe(10);
    expect(st.checkpointsMatched).toBe(0);
  });

  it('replays a race with AI boats from the seed (only the user is logged)', () => {
    const race: AppScenario = {
      ...FREE,
      course: { source: 'practice', kind: 'windward-leeward' },
      race: { sequence: 'one-minute', startInS: 30 },
      fleet: { aiCount: 3, level: 'good', prepFlag: 'P' },
    };
    const c = new SimController();
    expect(c.restart(race)).toBe(true);
    sail(c);
    c.advance(20);
    const rec = c.saveRecording('race');
    expect(rec.scenario.course?.source).toBe('inline'); // the course travels with the replay
    const play = new SimController();
    expect(play.startReplay(rec)).toBe(true);
    play.advance(rec.endStep * 0.01 + 1);
    const st = play.getState().replay!;
    expect(st.state).toBe('ended');
    expect(st.checkpointsMatched).toBe(st.checkpointsTotal);
    expect(st.checkpointsTotal).toBe(5);
  });

  it('take over: controls work again and the run continues from the replayed state', () => {
    const c = new SimController();
    c.restart(FREE);
    sail(c);
    const rec = c.saveRecording('t');
    const play = new SimController();
    play.startReplay(rec);
    play.advance(5);
    play.setInput({ helm: 0.5 }); // ignored while playing back
    expect(play.sim.input.helm).not.toBe(0.5);
    play.takeOver();
    expect(play.getState().replay).toBeUndefined();
    play.setInput({ helm: 0.5 });
    expect(play.sim.input.helm).toBe(0.5);
  });

  it('reports a file that is not a replay without stopping the current run', () => {
    const c = new SimController();
    c.restart(FREE);
    c.advance(1);
    expect(c.startReplay({ schema: 'squib-replay/0' })).toBe(false);
    expect(c.getState().scenarioError).toMatch(/expected schema/);
    expect(c.sim.step).toBe(100);
  });
});

describe('scenario library', () => {
  it('every built-in scenario starts; those needing missing data say why instead', () => {
    const replayFile = readFileSync('public/live/metoffice-replay-2026-10-23T1400Z.json', 'utf8');
    const source = { id: 'r', kind: 'replay' as const, label: 'r', url: 'live/metoffice-replay-2026-10-23T1400Z.json', validTime: '2026-10-23T14:00:00Z', json: JSON.parse(replayFile) };
    const without = builtInScenarios([], false);
    const metOffice = without.find((s) => s.id.startsWith('metoffice'))!;
    expect(metOffice.scenario).toBeUndefined();
    expect(metOffice.unavailable).toMatch(/not found/);
    expect(without.filter((s) => s.unavailable).map((s) => s.id).sort()).toEqual(['metoffice-2026-10-23', 'river-range', 'wind-against-tide']);
    // Here the River Dart data is not loaded, so check the river scenarios' conditions need it, and run the rest.
    const all = builtInScenarios([source], true);
    expect(all.every((s) => s.scenario)).toBe(true);
    for (const s of all) {
      if (without.find((w) => w.id === s.id)?.unavailable && s.id !== metOffice.id) {
        if (s.scenario!.conditions.current.mode === 'dart') expect(() => buildConditions(s.scenario!.conditions)).toThrow(/River Dart data/);
        continue;
      }
      const c = new SimController();
      expect(c.restart(s.scenario!), `${s.id}: ${c.getState().scenarioError}`).toBe(true);
      c.advance(1);
    }
  });

  it('scenario files round-trip and are checked on import', () => {
    const f = scenarioFile('Mine', FREE, 'a note');
    expect(parseScenarioFile(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(f.schema).toBe(SCENARIO_SCHEMA);
    expect(() => parseScenarioFile({ ...f, schema: 'x' })).toThrow(/schema/);
    expect(() => parseScenarioFile({ ...f, scenario: { ...FREE, startLocation: 'nowhere' } })).toThrow(/start location/);
    expect(() => parseScenarioFile({ ...f, title: '' })).toThrow(/title/);
  });
});
