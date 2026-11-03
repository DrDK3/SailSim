import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_SCENARIO, SimController, type AppScenario, type DataSource } from '../../src/app/controller';
import { freshLiveWeather, liveNowConditions, nowStartTime } from '../../src/app/liveNow';

/**
 * Real-time weather and lighting (owner review, 1 Nov 2026). When the site's live forecast covers now, an
 * untouched default session sails in it from this minute (so the sun is where it really is); "Real time"
 * lighting does the same on request. Nothing switches under a session the user has started.
 */
const forecast = JSON.parse(readFileSync(new URL('../fixtures/metoffice-snapshot-2026-10-22T0715Z.json', import.meta.url), 'utf8')) as unknown;
const live = (status: 'fresh' | 'stale' | 'expired' = 'fresh'): DataSource => ({
  id: 'live/latest.json', kind: status === 'expired' ? 'replay' : 'live', label: 'Live: Met Office UKV', url: 'live/latest.json', json: forecast,
  freshness: { status, ageMin: 5, message: '' },
});
const goLive = (c: SimController) => (c as unknown as { goLiveIfUntouched(): void }).goLiveIfUntouched();

describe('real-time conditions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T07:20:30Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('live conditions start this minute with the forecast, its gusts and its sky', () => {
    expect(nowStartTime()).toBe('2026-10-22T07:20:00Z');
    const c = liveNowConditions(live());
    expect(c).toMatchObject({ startTime: '2026-10-22T07:20:00Z', weather: { source: 'metoffice', replay: false }, gusts: { preset: 'from-data' }, sky: { source: 'data' }, current: { mode: 'none' } });
    // A stream needs a tide: without a live tide there is none, even when asked for.
    expect(liveNowConditions(live(), { stream: true }).current).toEqual({ mode: 'none' });
    expect(freshLiveWeather([live('stale')])).toBeUndefined();
    expect(freshLiveWeather([live('expired')])).toBeUndefined();
    expect(freshLiveWeather([live('stale'), live('fresh')])?.freshness?.status).toBe('fresh');
  });

  it('an untouched default session goes live when the forecast arrives', () => {
    const c = new SimController();
    c.weatherSources = [live()];
    goLive(c);
    expect(c.scenario.conditions.weather.source).toBe('metoffice');
    expect(c.scenario.conditions.startTime).toBe('2026-10-22T07:20:00Z');
    // The place and the boat are the default's.
    expect(c.scenario.startLocation).toBe(DEFAULT_SCENARIO.startLocation);
  });

  it('never switches a session the user has started, nor to a forecast that does not cover now', () => {
    const race: AppScenario = { ...structuredClone(DEFAULT_SCENARIO), startLocation: 'start-bay-practice', course: { source: 'practice', kind: 'windward-leeward' }, race: { sequence: 'one-minute', startInS: 10 }, fleet: { aiCount: 1, level: 'good', prepFlag: 'P' } };
    const c = new SimController();
    c.restart(race);
    c.weatherSources = [live()];
    goLive(c);
    expect(c.scenario.conditions.weather.source).toBe('manual');
    const d = new SimController();
    d.weatherSources = [live('stale')];
    goLive(d);
    expect(d.scenario.conditions.weather.source).toBe('manual');
  });

  it('"Real time" light: live weather if there is some, else the wind as set at this minute', () => {
    const c = new SimController();
    c.setLighting('now');
    expect(c.scenario.conditions.startTime).toBe('2026-10-22T07:20:00Z');
    expect(c.scenario.conditions.weather).toEqual(DEFAULT_SCENARIO.conditions.weather);
    c.weatherSources = [live()];
    c.setLighting('now');
    expect(c.scenario.conditions.weather.source).toBe('metoffice');
  });
});
