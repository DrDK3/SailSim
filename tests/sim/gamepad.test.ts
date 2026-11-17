import { afterEach, describe, expect, it } from 'vitest';
import { CURVE, DEAD_ZONE, PAD, hapticPulse, readPad, shapeAxis, shapeTrigger, type PadState } from '../../src/app/gamepad';
import { SimController, type AppScenario } from '../../src/app/controller';

const rest = (): PadState => ({ axes: [0, 0, 0, 0], buttons: Array(17).fill(0) });
const withButtons = (b: Record<number, number>, axes = [0, 0, 0, 0]): PadState => {
  const s = rest();
  return { axes, buttons: s.buttons.map((v, i) => b[i] ?? v) };
};

describe('gamepad mapping', () => {
  it('dead zone, then a response curve, sign kept, full travel full', () => {
    expect(shapeAxis(DEAD_ZONE * 0.9)).toBe(0);
    expect(shapeAxis(-0.05)).toBe(0);
    expect(shapeAxis(1)).toBe(1);
    expect(shapeAxis(-1)).toBe(-1);
    const half = shapeAxis(0.5);
    expect(half).toBeCloseTo(((0.5 - DEAD_ZONE) / (1 - DEAD_ZONE)) ** CURVE, 6);
    expect(half).toBeLessThan(0.5); // fine control near the centre
    // Monotonic.
    let last = -2;
    for (let x = -1; x <= 1; x += 0.01) {
      const y = shapeAxis(x);
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
    expect(shapeAxis(Number.NaN)).toBe(0);
  });

  it('triggers: rest below 5%, proportional above', () => {
    expect(shapeTrigger(0.03)).toBe(0);
    expect(shapeTrigger(1)).toBe(1);
    expect(shapeTrigger(0.525)).toBeCloseTo(0.5, 6);
  });

  it('maps the standard layout to the app controls', () => {
    const f = readPad(withButtons({ [PAD.RT]: 1, [PAD.RB]: 1 }, [0.6, 0, 0, 0]), undefined, 0.5);
    expect(f.helm).toBeGreaterThan(0);
    expect(f.main).toBe(-1); // right trigger: trim in
    expect(f.jib).toBe(-1);
    expect(readPad(withButtons({ [PAD.LT]: 0.525 }), undefined, 0).main).toBeCloseTo(0.5, 6);
    expect(readPad(rest(), undefined, 0).helm).toBeUndefined();
  });

  it('tack turns the bow into the wind, gybe away, whichever side the wind is on', () => {
    expect(readPad(withButtons({ [PAD.A]: 1 }), undefined, 0.8).held).toEqual(['helmRight']);
    expect(readPad(withButtons({ [PAD.A]: 1 }), undefined, -0.8).held).toEqual(['helmLeft']);
    expect(readPad(withButtons({ [PAD.B]: 1 }), undefined, 0.8).held).toEqual(['helmLeft']);
  });

  it('commands fire once on the press, not while held', () => {
    const down = withButtons({ [PAD.START]: 1, [PAD.X]: 1 });
    expect(readPad(down, rest(), 0).commands).toEqual(['releaseSheets', 'pause']);
    expect(readPad(down, down, 0).commands).toEqual([]);
  });

  it('haptic pulses scale with the event and are zero for a zero event', () => {
    expect(hapticPulse('gust', 0)).toMatchObject({ strongMagnitude: 0, weakMagnitude: 0 });
    expect(hapticPulse('contact', 1).strongMagnitude).toBeGreaterThan(hapticPulse('contact', 0.3).strongMagnitude);
  });
});

const FREE: AppScenario = {
  conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 11, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } },
  startLocation: 'start-bay-practice',
  startHeadingDeg: 0,
  startSpeedKn: 3,
};

describe('gamepad through the controller (mocked navigator.getGamepads)', () => {
  const nav = globalThis.navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] };
  const original = nav.getGamepads;
  let state = rest();
  const fake = () => ({ index: 0, connected: true, mapping: 'standard', axes: state.axes, buttons: state.buttons.map((v) => ({ value: v, pressed: v > 0.5, touched: v > 0 })) }) as unknown as Gamepad;
  afterEach(() => {
    nav.getGamepads = original;
  });

  it('the stick moves the helm at the keys rate, in proportion; triggers trim the main; the input is logged for replays', () => {
    Object.defineProperty(nav, 'getGamepads', { value: () => [fake()], configurable: true, writable: true });
    const c = new SimController();
    c.restart(FREE);
    const poll = () => (c as unknown as { pollGamepad(): void }).pollGamepad();
    state = withButtons({}, [1, 0, 0, 0]);
    poll();
    c.advance(0.2);
    expect(c.sim.input.helm).toBeCloseTo(0.28, 2); // 1.4 per second, rate-limited like the keys
    c.advance(2);
    expect(c.sim.input.helm).toBeCloseTo(1, 5);
    state = withButtons({}, [0.5, 0, 0, 0]);
    poll();
    c.advance(2);
    expect(c.sim.input.helm).toBeCloseTo(shapeAxis(0.5), 5); // proportional
    state = withButtons({ [PAD.RT]: 1 });
    poll();
    const before = c.sim.currentSheet('main');
    c.advance(1);
    expect(c.sim.currentSheet('main')).toBeLessThan(before);
    expect(c.sim.input.autoMain).toBe(false);
    // Recorded like any other input.
    expect(c.saveRecording('pad').inputs.length).toBeGreaterThan(10);
    // Disconnected: everything let go.
    nav.getGamepads = () => [];
    poll();
    expect(c.gamepadConnected).toBe(false);
  });
});
