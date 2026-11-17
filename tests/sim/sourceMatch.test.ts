/**
 * Issue 198 (O1): after a restart with a Met Office replay the instruments said "Met Office UKV (replay)" and the
 * Options panel's Source said "Manual", because the panel edits a deep copy of the scenario and looked the file up by
 * object identity. The same for the tide. The lookup must find the file the copy came from.
 */
import { describe, expect, it } from 'vitest';
import { matchDataSource } from '../../src/app/sourceMatch';

const weather = [
  { id: 'live/weather.json', json: { model: { run: '2026-11-17T12:00Z', tws: [4.1, 4.3] }, validTime: '2026-11-17T15:00Z' } },
  { id: 'replay/weather-2026-10-22.json', json: { model: { run: '2026-10-22T06:00Z', tws: [6.2, 6.0] }, validTime: '2026-10-22T09:00Z' } },
];

describe('matching a scenario to its data file (issue 198)', () => {
  it('finds the file when the scenario holds a deep copy of it (as the Options panel does)', () => {
    const copy = structuredClone(weather[1]!.json);
    expect(matchDataSource(weather, copy)?.id).toBe('replay/weather-2026-10-22.json');
  });

  it('still finds the very object, and finds nothing for a file that is not offered', () => {
    expect(matchDataSource(weather, weather[0]!.json)?.id).toBe('live/weather.json');
    expect(matchDataSource(weather, { model: { run: 'other' } })).toBeUndefined();
    expect(matchDataSource(weather, undefined)).toBeUndefined();
  });

  it('works for the tide files the same way', () => {
    const tide = [{ id: 'live/tide.json', json: { predictions: { source: 'harmonic', events: [{ t: '2026-11-17T10:00Z', h: 4.1 }] } } }];
    expect(matchDataSource(tide, structuredClone(tide[0]!.json))?.id).toBe('live/tide.json');
  });
});
