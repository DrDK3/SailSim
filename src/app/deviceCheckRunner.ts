/**
 * Runs the device check (src/app/deviceCheck.ts) in the app: sails the fixed route for DEVICE_CHECK_SECONDS of wall
 * time and gathers the frame times, input delays and start-up stalls the controller reports through `onFrame`.
 *
 * The key presses of the route are dispatched as real KeyboardEvents on window, so they take the same path as a
 * player's keys (src/app/controller.ts onKeyDown → press → sampled at the next physics step → drawn).
 */
import {
  DEVICE_CHECK_ROUTE, DEVICE_CHECK_SCHEMA, DEVICE_CHECK_SECONDS, HITCH_MS, engineOf, summariseFrames, verdictFor,
  type DeviceReport, type Stall,
} from './deviceCheck';

/** What the runner needs from the app (kept small so it can be tested with a stand-in). */
export interface DeviceCheckHost {
  build: string;
  gpuName?: string;
  preset(): string;
  resolution(): number;
  autoLowered(): boolean;
  startup: StartupMonitor;
}

/**
 * Start-up timing, from the page's own clock (performance.now() is ms since navigation): the first frame, the first
 * frame that can be sailed (the river loaded, or found unavailable), and every frame over HITCH_MS from the first frame
 * until 10 s after it could be sailed, each with whether new shader programs were compiled in it.
 */
export class StartupMonitor {
  firstFrameMs?: number;
  sailableMs?: number;
  readonly stalls: Stall[] = [];
  private programs = 0;

  /** Every drawn frame: its end time, its length, whether the boat can be sailed, and the shader-program count. */
  frame(now: number, frameMs: number, sailable: boolean, programs: number): void {
    const compiled = programs > this.programs;
    this.programs = programs;
    if (this.firstFrameMs === undefined) {
      this.firstFrameMs = now;
      this.stalls.push({ atMs: Math.round(now), ms: Math.round(now), cause: 'first frame' });
      return;
    }
    if (sailable && this.sailableMs === undefined) this.sailableMs = now;
    const watching = this.sailableMs === undefined || now - this.sailableMs < 10_000;
    if (watching && frameMs > HITCH_MS && this.stalls.length < 50) this.stalls.push({ atMs: Math.round(now), ms: Math.round(frameMs), cause: compiled ? 'shader compile' : 'unknown' });
  }
}

export class DeviceCheckRunner {
  readonly startedAt: number;
  private readonly frames: number[] = [];
  private readonly cpu: number[] = [];
  private readonly inputs: number[] = [];
  private nextPress = 0;
  private readonly releases: { at: number; code: string }[] = [];
  private pending?: { t0: number; rudder: number };
  private readonly presetAtStart: string;
  done?: DeviceReport;

  constructor(private readonly host: DeviceCheckHost, now: number, readonly seconds = DEVICE_CHECK_SECONDS) {
    this.startedAt = now;
    this.presetAtStart = host.preset();
  }

  /** Progress 0…1. */
  progress(now: number): number {
    return Math.min(1, (now - this.startedAt) / (this.seconds * 1000));
  }

  /** Each drawn frame: its length and the helm angle drawn in it. Returns the report when the check ends. */
  onFrame(now: number, frameMs: number, rudderDrawn: number, cpuMs = 0): DeviceReport | undefined {
    if (this.done) return this.done;
    const t = (now - this.startedAt) / 1000;
    // The first frame's length includes the restart: leave it out.
    if (t > 0.05) {
      this.frames.push(frameMs);
      this.cpu.push(cpuMs);
    }
    if (this.pending && Math.abs(rudderDrawn - this.pending.rudder) > 1e-4) {
      this.inputs.push(Math.round(performance.now() - this.pending.t0));
      this.pending = undefined;
    }
    // Scale the route to the check's length (tests run a shorter check).
    const scale = this.seconds / DEVICE_CHECK_SECONDS;
    while (this.nextPress < DEVICE_CHECK_ROUTE.length && t >= DEVICE_CHECK_ROUTE[this.nextPress]!.at * scale) {
      const p = DEVICE_CHECK_ROUTE[this.nextPress++]!;
      const ev = new KeyboardEvent('keydown', { code: p.code, bubbles: true });
      // Measure from the event's own time stamp (when the browser says it happened).
      if (!this.pending) this.pending = { t0: ev.timeStamp || performance.now(), rudder: rudderDrawn };
      window.dispatchEvent(ev);
      this.releases.push({ at: t + p.holdS * scale, code: p.code });
    }
    for (let i = this.releases.length - 1; i >= 0; i--) {
      if (t >= this.releases[i]!.at) {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: this.releases[i]!.code, bubbles: true }));
        this.releases.splice(i, 1);
      }
    }
    if (t >= this.seconds) this.done = this.report();
    return this.done;
  }

  /** Let go of any key still held (the check was cancelled). */
  cancel(): void {
    for (const r of this.releases) window.dispatchEvent(new KeyboardEvent('keyup', { code: r.code, bubbles: true }));
    this.releases.length = 0;
  }

  private report(): DeviceReport {
    this.cancel();
    const frames = summariseFrames(this.frames);
    const s = [...this.inputs].sort((a, b) => a - b);
    const medianMs = s.length ? s[Math.floor((s.length - 1) / 2)] : undefined;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const st = this.host.startup;
    return {
      schema: DEVICE_CHECK_SCHEMA,
      ranAt: new Date().toISOString().slice(0, 16) + 'Z',
      build: this.host.build,
      device: {
        gpu: this.host.gpuName,
        screen: { w: screen.width, h: screen.height },
        pixelRatio: Math.round(devicePixelRatio * 100) / 100,
        memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
        cpuCores: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : undefined,
        touch: navigator.maxTouchPoints > 0,
        engine: engineOf(navigator.userAgent),
      },
      graphics: { presetAtStart: this.presetAtStart, presetAtEnd: this.host.preset(), resolutionAtEnd: this.host.resolution(), autoLowered: this.host.autoLowered() },
      frames,
      cpu: summariseFrames(this.cpu),
      startup: { firstFrameMs: round(st.firstFrameMs), sailableMs: round(st.sailableMs), stalls: [...st.stalls] },
      input: { samplesMs: this.inputs, medianMs, maxMs: s.at(-1) },
      verdict: verdictFor(frames, medianMs),
    };
  }
}

const round = (x?: number) => (x === undefined ? undefined : Math.round(x));
