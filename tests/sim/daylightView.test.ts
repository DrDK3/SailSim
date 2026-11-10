/**
 * Daylight view (src/app/daylightView.ts): a dark real-time run can be drawn in the day's midday light, while the
 * run itself (its clock, tide, wind) stays real; it is offered once when a real-time run is dark.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYLIGHT_VIEW_BELOW_DEG, middaySun, viewSun } from '../../src/app/daylightView';
import { SimController, DEFAULT_SCENARIO } from '../../src/app/controller';
import { RDYC_ORIGIN } from '../../src/sim/index';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});
afterEach(() => vi.useRealTimers());

const { lat, lon } = RDYC_ORIGIN;
const EVENING = Date.parse('2026-11-10T19:30:00Z'); // 19:30 in Dartmouth, two and a half hours after sunset
const NOON = Date.parse('2026-11-10T12:15:00Z');

describe('the daylight view', () => {
  it("the day's midday sun at the Dart in November: due south, about 22° up", () => {
    const s = middaySun(EVENING, lat, lon);
    expect(Math.abs(s.azimuthDeg - 180)).toBeLessThan(3);
    expect(s.elevationDeg).toBeGreaterThan(18);
    expect(s.elevationDeg).toBeLessThan(26);
  });

  it('replaces the sun only when it is low or down, and only when on', () => {
    expect(viewSun(EVENING, lat, lon, false).elevationDeg).toBeLessThan(-15);
    const on = viewSun(EVENING, lat, lon, true);
    expect(on.substituted).toBe(true);
    expect(on.elevationDeg).toBeGreaterThan(DAYLIGHT_VIEW_BELOW_DEG);
    const day = viewSun(NOON, lat, lon, true);
    expect(day.substituted).toBe(false);
  });

  it('a real-time run after dark offers it; choosing it lights the picture, and the run is unchanged', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(EVENING);
    const c = new SimController();
    c.restart({ ...DEFAULT_SCENARIO, conditions: { ...DEFAULT_SCENARIO.conditions, startTime: new Date(EVENING).toISOString() } });
    let l = c.getState().light;
    expect(l.realTime).toBe(true);
    expect(l.dark).toBe(true);
    expect(l.offer).toBe(true);
    expect(l.clock).toBe('19:30');
    expect(c.sceneWeather().sunElevationDeg).toBeLessThan(-15);
    c.advance(5);
    const before = { hash: (c as unknown as { stateHash(): string }).stateHash(), t: c.sim.time };
    c.setPrefs({ daylightView: true });
    l = c.getState().light;
    expect(l.offer).toBe(false);
    expect(l.daylightView).toBe(true);
    expect(c.sceneWeather().sunElevationDeg).toBeGreaterThan(18);
    // Only the picture: the run's state is what it was.
    expect((c as unknown as { stateHash(): string }).stateHash()).toBe(before.hash);
    expect(c.sim.time).toBe(before.t);
    // Kept in this browser.
    expect(JSON.parse(memory.get('squib.prefs.v1')!).daylightView).toBe(true);
  });

  it('not offered for a run set at night on purpose (not real time), nor after "Keep it dark"', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
    const c = new SimController();
    c.restart({ ...DEFAULT_SCENARIO, conditions: { ...DEFAULT_SCENARIO.conditions, startTime: new Date(EVENING).toISOString() } });
    expect(c.getState().light.dark).toBe(true);
    expect(c.getState().light.offer).toBe(false);
    vi.setSystemTime(EVENING);
    const d = new SimController();
    d.restart({ ...DEFAULT_SCENARIO, conditions: { ...DEFAULT_SCENARIO.conditions, startTime: new Date(EVENING).toISOString() } });
    expect(d.getState().light.offer).toBe(true);
    d.dismissDark();
    expect(d.getState().light.offer).toBe(false);
  });
});
