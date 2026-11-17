/**
 * Device check (juniors round, Workstream 1): a measurement anyone at the club can run on their own device, from
 * Settings → Graphics → "Check this device". It sails a fixed route on a fixed seed for a fixed wall-clock time and
 * reports how smoothly the device drew it, in plain words and as JSON to copy or save.
 *
 * Pure helpers (no DOM): the statistics, the verdict, the route and the report's shape. The runner that drives the
 * app is src/app/deviceCheckRunner.ts.
 *
 * Nothing personal is recorded: no name, no location, no identifiers. The graphics card's name, the screen size, the
 * pixel ratio, the processor count and the memory class are what the browser tells any page; they are kept only in
 * the report the person chooses to copy or save.
 */
import type { AppScenario } from './controller';

export const DEVICE_CHECK_SCHEMA = 'squib-device-check/1';
/** Wall-clock length of the route (s). 45–60 s is the brief's range. */
export const DEVICE_CHECK_SECONDS = 50;
/** A frame longer than this is "slow" (two 60 Hz frames; 30 frames a second). */
export const SLOW_FRAME_MS = 33.4;
/** A frame longer than this is a hitch a player notices. */
export const HITCH_MS = 100;

/** The fixed conditions: Start Bay, 12 kn from the south-west, moderate gusts on seed 7, a summer midday. */
export const DEVICE_CHECK_SCENARIO: AppScenario = {
  conditions: {
    startTime: '2026-07-15T12:00:00Z',
    weather: { source: 'manual', twsKn: 12, twdDeg: 225 },
    gusts: { preset: 'moderate', seed: 7 },
    current: { mode: 'none' },
    sky: { source: 'preset', preset: 'fair' },
  },
  startLocation: 'start-bay-practice',
  startHeadingDeg: 315,
  startSpeedKn: 4,
};

/**
 * The route, as key presses at wall-clock times (s from the start of the check) with how long each is held:
 * bear away, come up, trim, tack, ease, gybe-ish turn. Key codes go through the app's own keyboard handler, so the
 * check measures the same input path a player uses. A press is also when the input delay is measured.
 */
export const DEVICE_CHECK_ROUTE: readonly { at: number; code: string; holdS: number }[] = [
  { at: 4, code: 'KeyD', holdS: 1.5 },
  { at: 10, code: 'KeyA', holdS: 1.5 },
  { at: 15, code: 'KeyW', holdS: 1 },
  { at: 20, code: 'KeyA', holdS: 3 },
  { at: 28, code: 'KeyS', holdS: 1 },
  { at: 32, code: 'KeyD', holdS: 1.5 },
  { at: 38, code: 'KeyD', holdS: 3 },
  { at: 45, code: 'KeyA', holdS: 1 },
];

export interface FrameSummary {
  frames: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  /** Frames longer than SLOW_FRAME_MS. */
  over33: number;
  /** Frames longer than HITCH_MS. */
  over100: number;
  longestMs: number;
  /** Frames a second over the whole run. */
  fps: number;
  /** How even the pacing is: the median absolute difference between successive frame times (ms). */
  jitterMs: number;
}

/** Percentile by nearest rank (p in 0…100). */
export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function summariseFrames(ms: readonly number[]): FrameSummary {
  const s = [...ms].sort((a, b) => a - b);
  const total = ms.reduce((a, b) => a + b, 0);
  const diffs: number[] = [];
  for (let i = 1; i < ms.length; i++) diffs.push(Math.abs(ms[i]! - ms[i - 1]!));
  diffs.sort((a, b) => a - b);
  return {
    frames: ms.length,
    medianMs: r1(percentile(s, 50)),
    p95Ms: r1(percentile(s, 95)),
    p99Ms: r1(percentile(s, 99)),
    over33: ms.filter((x) => x > SLOW_FRAME_MS).length,
    over100: ms.filter((x) => x > HITCH_MS).length,
    longestMs: r1(s.at(-1) ?? 0),
    fps: total > 0 ? r1((ms.length * 1000) / total) : 0,
    jitterMs: r1(percentile(diffs, 50)),
  };
}

export interface Stall {
  /** ms since the page started loading. */
  atMs: number;
  ms: number;
  /** What happened in that frame, when the app knows: new shader programs compiled, the first frame, … */
  cause: 'first frame' | 'shader compile' | 'unknown';
}

export interface DeviceReport {
  schema: typeof DEVICE_CHECK_SCHEMA;
  /** When the check ran (ISO, to the minute: no finer timing that could link reports). */
  ranAt: string;
  build: string;
  /** What the person ran it on, as the browser reports it (all optional: browsers differ). */
  device: {
    gpu?: string;
    screen: { w: number; h: number };
    pixelRatio: number;
    /** Approximate memory class in GB (navigator.deviceMemory: Chromium only, rounded by the browser). */
    memoryGb?: number;
    cpuCores?: number;
    touch: boolean;
    /** Browser engine family (not the full user-agent string). */
    engine: 'chromium' | 'gecko' | 'webkit' | 'other';
  };
  graphics: {
    presetAtStart: string;
    presetAtEnd: string;
    /** Resolution share at the end (dynamic resolution may have lowered it). */
    resolutionAtEnd: number;
    autoLowered: boolean;
  };
  /** The sailing part of the run: time between frames on screen. */
  frames: FrameSummary;
  /**
   * Main-thread work per frame (physics, scene update, submitting the drawing; not the GPU's own drawing). On a machine
   * without a graphics card the drawing is done in software and dominates `frames`; this part is what a slower
   * processor (or a CPU-throttled stand-in) changes.
   */
  cpu?: FrameSummary;
  startup: {
    /** Page load to the first frame drawn (ms). */
    firstFrameMs?: number;
    /** Page load to the first frame with the river loaded and the boat sailable (ms). */
    sailableMs?: number;
    /** Frames over HITCH_MS from the first frame to sailable and the 10 s after (shader compiles and first draws). */
    stalls: Stall[];
  };
  input: {
    /** Key event to the end of the frame that first drew the helm moving (ms), one per route press measured. */
    samplesMs: number[];
    medianMs?: number;
    maxMs?: number;
  };
  verdict: Verdict;
}

export interface Verdict {
  label: 'Smooth' | 'Mostly smooth' | 'Struggling';
  reasons: string[];
}

/**
 * The plain-language verdict (thresholds E: the brief's provisional targets).
 * Smooth: 95% of frames under 33 ms, nothing over 100 ms while sailing, input shown within 100 ms.
 * Struggling: the median frame over 33 ms (under 30 frames a second most of the time), or more than 2% hitches.
 * Otherwise Mostly smooth.
 */
export function verdictFor(f: FrameSummary, inputMedianMs?: number): Verdict {
  const reasons: string[] = [];
  if (f.frames === 0) return { label: 'Struggling', reasons: ['No frames were drawn during the check.'] };
  const hitchShare = f.over100 / f.frames;
  if (f.medianMs > SLOW_FRAME_MS) reasons.push(`Most frames took longer than 33 ms (typical frame ${f.medianMs} ms, about ${Math.round(1000 / f.medianMs)} frames a second).`);
  if (hitchShare > 0.02) reasons.push(`${f.over100} hitches over 100 ms (${(hitchShare * 100).toFixed(1)}% of frames).`);
  const struggling = reasons.length > 0;
  if (!struggling) {
    if (f.p95Ms > SLOW_FRAME_MS) reasons.push(`1 frame in 20 took longer than 33 ms (95th percentile ${f.p95Ms} ms).`);
    if (f.over100 > 0) reasons.push(`${f.over100} hitch${f.over100 === 1 ? '' : 'es'} over 100 ms (longest ${f.longestMs} ms).`);
    if (inputMedianMs !== undefined && inputMedianMs > 100) reasons.push(`The helm took about ${Math.round(inputMedianMs)} ms to show a key press.`);
  }
  if (struggling) return { label: 'Struggling', reasons };
  if (reasons.length) return { label: 'Mostly smooth', reasons };
  return { label: 'Smooth', reasons: [`95% of frames under 33 ms (${f.p95Ms} ms), no hitches over 100 ms${inputMedianMs !== undefined ? `, helm shown about ${Math.round(inputMedianMs)} ms after a key press` : ''}.`] };
}

/** The browser engine family from the user-agent string (only the family is kept). */
export function engineOf(ua: string): DeviceReport['device']['engine'] {
  if (/Firefox\//.test(ua)) return 'gecko';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'chromium';
  if (/AppleWebKit\//.test(ua)) return 'webkit';
  return 'other';
}

/** The report as plain text for pasting into a message (the JSON follows it). */
export function reportText(r: DeviceReport): string {
  const f = r.frames;
  return [
    `SailSim device check: ${r.verdict.label}`,
    ...r.verdict.reasons.map((x) => `- ${x}`),
    `Frames: median ${f.medianMs} ms, 95% ${f.p95Ms} ms, 99% ${f.p99Ms} ms, longest ${f.longestMs} ms, ${f.over33} over 33 ms, ${f.fps} frames/s`,
    ...(r.cpu ? [`Main-thread work per frame: median ${r.cpu.medianMs} ms, 95% ${r.cpu.p95Ms} ms, longest ${r.cpu.longestMs} ms`] : []),
    `Start-up: first frame ${fmtMs(r.startup.firstFrameMs)}, sailable ${fmtMs(r.startup.sailableMs)}, ${r.startup.stalls.length} stall(s) over 100 ms`,
    `Input to screen: ${r.input.medianMs !== undefined ? `median ${r.input.medianMs} ms, max ${r.input.maxMs} ms` : 'not measured'}`,
    `Graphics: ${r.graphics.presetAtStart} → ${r.graphics.presetAtEnd}, resolution ${Math.round(r.graphics.resolutionAtEnd * 100)}%${r.graphics.autoLowered ? ', lowered automatically' : ''}`,
    `Device: ${r.device.gpu ?? 'graphics unknown'}, ${r.device.screen.w}×${r.device.screen.h} at ${r.device.pixelRatio}×, ${r.device.cpuCores ?? '?'} cores, ${r.device.memoryGb ?? '?'} GB class, ${r.device.engine}`,
    `Build ${r.build}`,
  ].join('\n');
}

const fmtMs = (ms?: number) => (ms === undefined ? 'not recorded' : `${(ms / 1000).toFixed(1)} s`);

/** Check a report read back (tests, the stand-in tool): every field present and numeric where it should be. */
export function isDeviceReport(x: unknown): x is DeviceReport {
  const r = x as DeviceReport;
  return !!r && r.schema === DEVICE_CHECK_SCHEMA && typeof r.frames?.p95Ms === 'number' && Array.isArray(r.startup?.stalls) && Array.isArray(r.input?.samplesMs) && !!r.verdict?.label;
}
