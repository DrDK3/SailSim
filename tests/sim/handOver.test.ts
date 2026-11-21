/**
 * Issue 201: turning auto-trim off hands the sheet to the crew where auto-trim had it (the M and J keys, the Auto
 * boxes, a lesson step), as the sheet keys already did. Before, the sheet jumped back to the crew's last manual
 * setting. Control input only: the simulation's physics is unchanged.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController, DEFAULT_SCENARIO } from '../../src/app/controller';
import { INPUT_GRID } from '../../src/app/replay';

/**
 * Handed over at the same setting: to within half a step of the grid of thousandths the player's controls are kept on
 * (package C, compact replays), far below anything a jump would be.
 */
const handedOver = (now: number, before: number) => expect(Math.abs(now - before)).toBeLessThanOrEqual(0.5 / INPUT_GRID + 1e-12);

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

/** Broad reach (wind from 225°, heading 0°: TWA 135°) in a steady 10 kn, no stream, auto-trim on both sails. */
function broadReach(): SimController {
  const c = new SimController();
  const ok = c.restart({
    ...structuredClone(DEFAULT_SCENARIO),
    conditions: { ...structuredClone(DEFAULT_SCENARIO.conditions), gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } },
    startLocation: 'start-bay-practice',
    startHeadingDeg: 0,
    startSpeedKn: 4,
  });
  expect(ok).toBe(true);
  // The crew's own (manual) settings are well in: the old jump would be large.
  c.setInput({ autoMain: true, autoJib: true, mainSheet: 0.3, jibSheet: 0.3 });
  c.advance(20);
  return c;
}

const key = (c: SimController, code: string) =>
  (c as unknown as { onKeyDown(ev: Partial<KeyboardEvent>): void }).onKeyDown({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, preventDefault: () => {} });

describe('issue 201: auto-trim off hands the sheet over without a jump', () => {
  it('the Auto box (setInput): the main sheet stays where auto-trim had it', () => {
    const c = broadReach();
    const before = c.sim.currentSheet('main');
    // Precondition: auto-trim's setting is far from the crew's last manual one.
    expect(Math.abs(before - 0.3)).toBeGreaterThan(0.2);
    c.setInput({ autoMain: false });
    expect(c.sim.input.autoMain).toBe(false);
    handedOver(c.sim.currentSheet('main'), before);
    // And the boat sails on as before: speed after 3 s within 2% of the boat that kept auto-trim.
    const kept = broadReach();
    c.advance(3);
    kept.advance(3);
    expect(Math.abs(c.sim.snapshot(false).stw - kept.sim.snapshot(false).stw) / kept.sim.snapshot(false).stw).toBeLessThan(0.02);
  });

  it('the J key: the jib sheet stays where auto-trim had it', () => {
    const c = broadReach();
    const before = c.sim.currentSheet('jib');
    expect(Math.abs(before - 0.3)).toBeGreaterThan(0.2);
    key(c, 'KeyJ');
    expect(c.sim.input.autoJib).toBe(false);
    handedOver(c.sim.currentSheet('jib'), before);
  });

  it('a lesson step that gives the crew the sheet (Trim, step "main") hands it over at the same setting', () => {
    const c = new SimController();
    c.startLesson('trim');
    c.advance(10);
    const before = c.sim.currentSheet('main');
    c.tutorialNext();
    expect(c.getState().tutorial?.step.id).toBe('main');
    expect(c.sim.input.autoMain).toBe(false);
    handedOver(c.sim.currentSheet('main'), before);
  });

  it('a change that sets the sheet keeps its own value (release sheets, explicit settings)', () => {
    const c = broadReach();
    c.setInput({ autoMain: false, mainSheet: 1 });
    expect(c.sim.input.mainSheet).toBe(1);
    const d = broadReach();
    d.releaseSheets();
    expect(d.sim.input.mainSheet).toBe(1);
    expect(d.sim.input.jibSheet).toBe(1);
  });
});
