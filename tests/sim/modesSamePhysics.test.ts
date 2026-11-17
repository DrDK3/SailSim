/**
 * Assists and displays change what you see and hear, never the physics (training slice §9): the same inputs give
 * the same state, bit for bit, whatever the interface level (Learn, Club, Expert), the teaching overlay, the coach,
 * the hints, the labels, the physics panel and the force arrows. (Auto-trim and auto-crew are inputs: they act
 * through the controls, as a crew would, so they are held the same here.)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController, DEFAULT_SCENARIO } from '../../src/app/controller';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

const SCN = {
  ...DEFAULT_SCENARIO,
  conditions: { ...DEFAULT_SCENARIO.conditions, gusts: { preset: 'shifty' as const, seed: 4 }, current: { mode: 'none' as const } },
  startLocation: 'start-bay-practice' as const,
  startHeadingDeg: 170,
  startSpeedKn: 3,
};

function run(mode: (c: SimController) => void): string {
  const c = new SimController();
  expect(c.restart(structuredClone(SCN))).toBe(true);
  mode(c);
  c.setInput({ autoMain: true, autoJib: true, autoCrew: true });
  // A tack and back, with the same key timings each run.
  c.press('helmRight', true);
  c.advance(4);
  c.press('helmRight', false);
  c.advance(20);
  c.press('helmLeft', true);
  c.advance(4);
  c.press('helmLeft', false);
  c.advance(30);
  return c.sim.stateHash();
}

describe('the same inputs give the same physics in every mode', () => {
  it('interface levels, overlay, coach, hints, labels, physics panel and force arrows change nothing in the state', () => {
    const plain = run(() => {});
    const modes: [string, (c: SimController) => void][] = [
      ['Learn', (c) => c.setLevel('learn')],
      ['Club', (c) => c.setLevel('club')],
      ['Expert', (c) => c.setLevel('expert')],
      ['teaching overlay on', (c) => c.toggleTeaching(true)],
      ['teaching overlay off', (c) => c.toggleTeaching(false)],
      ['coach toggled', (c) => c.toggleCoach()],
      ['hints off', (c) => c.setPrefs({ hints: false })],
      ['labels toggled', (c) => c.toggleLabels()],
      ['physics panel', (c) => c.toggleDebug()],
      ['force arrows', (c) => c.toggleForces()],
    ];
    for (const [name, mode] of modes) expect(run(mode), name).toBe(plain);
  });
});
