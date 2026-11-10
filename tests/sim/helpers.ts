import { inflateSync } from 'node:zlib';
import {
  DEG,
  Simulation,
  autopilotHelm,
  optimalSheets,
  squibParams,
  uniformEnvironment,
  type ControlInput,
  type Environment,
} from '../../src/sim/index';

export const KN = 1852 / 3600;

export interface SailOpts {
  twsKn?: number;
  twaDeg: number;
  startKn?: number;
  /** Hold the TWA with the autopilot. */
  hold?: boolean;
  /** Max-drive trim refreshed every second. */
  optimise?: boolean;
  env?: Environment;
  input?: Partial<ControlInput>;
  lockHeading?: boolean;
}

/** A Squib on a steady TWA (wind from 000°), optionally autopiloted and max-drive trimmed. */
export function sailingSim(o: SailOpts): Simulation {
  const env = o.env ?? uniformEnvironment({ twsKn: o.twsKn ?? 10, twdDeg: 0 });
  const optimise = o.optimise ?? true;
  return new Simulation({
    params: squibParams(),
    env,
    // Wind from 000°: heading = -TWA puts the boat on the requested tack from the start.
    initial: { headingDeg: -o.twaDeg, speedKn: o.startKn ?? 4 },
    input: { autoMain: false, autoJib: false, ...o.input },
    lockHeading: o.lockHeading,
    controller: (s) => {
      const change: Partial<ControlInput> = {};
      if (o.hold ?? true) change.helm = autopilotHelm(s, { mode: 'twa', target: o.twaDeg * DEG });
      if (optimise && s.step % 100 === 0) Object.assign(change, optimalSheets(s));
      return change;
    },
  });
}

export const toKn = (ms: number): number => ms / KN;

import type { DartGeo } from '../../src/sim/index';
import { loadDartAppNode, loadDartGeoNode } from '../../tools/lib/dartGeoNode';

let geoCache: DartGeo | undefined;
/** The River Dart data from public/geo (as the app loads it, packed grids unpacked). */
export function loadDartGeo(): DartGeo {
  geoCache ??= loadDartGeoNode();
  return geoCache;
}

let appCache: ReturnType<typeof loadDartAppNode> | undefined;
/**
 * The River Dart data as the app sets it up: over the towns the physics stands on the ground the picture draws
 * (src/app/geoLoader.ts). A separate DartGeo from loadDartGeo's, which keeps the 8 m grid alone.
 */
export function loadDartApp(): ReturnType<typeof loadDartAppNode> {
  appCache ??= loadDartAppNode();
  return appCache;
}

/** Decode an 8-bit greyscale, non-interlaced PNG (what the pipeline writes). */
export function readGreyPng(buf: Buffer): { w: number; h: number; px: Uint8Array } {
  let off = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 0 || data[12] !== 0) throw new Error('not an 8-bit greyscale non-interlaced PNG');
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)]!;
    for (let x = 0; x < w; x++) {
      const v = raw[y * (w + 1) + 1 + x]!;
      const a = x > 0 ? px[y * w + x - 1]! : 0;
      const b = y > 0 ? px[(y - 1) * w + x]! : 0;
      const c = x > 0 && y > 0 ? px[(y - 1) * w + x - 1]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[y * w + x] = (v + [0, a, b, (a + b) >> 1, paeth][f]!) & 0xff;
    }
  }
  return { w, h, px };
}
