import { describe, expect, it } from 'vitest';
import { DEVICE_CHECK_ROUTE, DEVICE_CHECK_SECONDS, engineOf, percentile, reportText, summariseFrames, verdictFor, isDeviceReport, DEVICE_CHECK_SCHEMA, type DeviceReport } from '../../src/app/deviceCheck';
import { StartupMonitor } from '../../src/app/deviceCheckRunner';

describe('device check statistics', () => {
  it('percentiles by nearest rank', () => {
    const s = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(s, 50)).toBe(50);
    expect(percentile(s, 95)).toBe(95);
    expect(percentile(s, 99)).toBe(99);
    expect(percentile([], 50)).toBe(0);
  });

  it('summarises frames: counts over 33 and 100 ms, the longest, frames a second', () => {
    const f = summariseFrames([...Array(97).fill(16.7), 40, 120, 250]);
    expect(f.frames).toBe(100);
    expect(f.medianMs).toBe(16.7);
    expect(f.over33).toBe(3);
    expect(f.over100).toBe(2);
    expect(f.longestMs).toBe(250);
    expect(f.fps).toBeGreaterThan(40);
  });

  it('gives a plain verdict with its reasons', () => {
    expect(verdictFor(summariseFrames(Array(300).fill(16.7)), 30).label).toBe('Smooth');
    const mostly = verdictFor(summariseFrames([...Array(280).fill(20), ...Array(20).fill(45)]));
    expect(mostly.label).toBe('Mostly smooth');
    expect(mostly.reasons[0]).toMatch(/1 frame in 20/);
    const bad = verdictFor(summariseFrames(Array(100).fill(60)));
    expect(bad.label).toBe('Struggling');
    expect(bad.reasons[0]).toMatch(/longer than 33 ms/);
    expect(verdictFor(summariseFrames([])).label).toBe('Struggling');
  });

  it('keeps only the browser engine family', () => {
    expect(engineOf('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe('chromium');
    expect(engineOf('Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/131.0')).toBe('gecko');
    expect(engineOf('Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('webkit');
  });

  it('the route fits in the check and alternates the helm', () => {
    expect(DEVICE_CHECK_ROUTE.every((p) => p.at + p.holdS < DEVICE_CHECK_SECONDS)).toBe(true);
    expect(DEVICE_CHECK_SECONDS).toBeGreaterThanOrEqual(45);
    expect(DEVICE_CHECK_SECONDS).toBeLessThanOrEqual(60);
  });

  it('start-up monitor: first frame, sailable, stalls labelled by shader compiles, only in the first 10 s after sailable', () => {
    const m = new StartupMonitor();
    m.frame(900, 0, false, 10);
    m.frame(7000, 6100, false, 25); // compiled new programs
    m.frame(7016, 16, true, 25);
    m.frame(9000, 400, true, 25);
    m.frame(30000, 400, true, 25); // later than 10 s after sailable: not start-up
    expect(m.firstFrameMs).toBe(900);
    expect(m.sailableMs).toBe(7016);
    expect(m.stalls.map((s) => s.cause)).toEqual(['first frame', 'shader compile', 'unknown']);
  });

  it('a report has no personal fields and reads back', () => {
    const r: DeviceReport = {
      schema: DEVICE_CHECK_SCHEMA, ranAt: '2026-11-17T10:00Z', build: 'x', device: { screen: { w: 1, h: 1 }, pixelRatio: 1, touch: false, engine: 'chromium' },
      graphics: { presetAtStart: 'performance', presetAtEnd: 'performance', resolutionAtEnd: 0.75, autoLowered: false },
      frames: summariseFrames([16, 17]), startup: { stalls: [] }, input: { samplesMs: [] }, verdict: { label: 'Smooth', reasons: [] },
    };
    expect(isDeviceReport(JSON.parse(JSON.stringify(r)))).toBe(true);
    expect(Object.keys(r.device).sort()).toEqual(['engine', 'pixelRatio', 'screen', 'touch']);
    expect(reportText(r)).toMatch(/^SailSim device check: Smooth/);
  });
});
