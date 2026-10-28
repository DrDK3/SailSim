import type { NE } from '../boat/forces';
import { gridGradient, int16Grid, sampleGrid, type Grid } from './grid';

/** The parts of public/geo/manifest.json the simulation needs (written by tools/geodata/build.py). */
export interface DartManifest {
  projection: string;
  verticalDatum: { chartDatumBelowOdn: number };
  domain: { eMin: number; eMax: number; nMin: number; nMax: number };
  /** `file` holds the grid; `packing` names its lossless packing (src/sim/geo/pack.ts), absent for raw Int16. */
  elevation: { file: string; packing?: string; scale: number; cell: number; nx: number; ny: number; e0: number; n0: number };
  current: { file: string; packing?: string; scale: number; cell: number; nx: number; ny: number; e0: number; n0: number; components: string[] };
  entrance: { a: [number, number]; b: [number, number] };
  layers: { id: string; label: string; status: string; tag: string; source: string; licence: string; notes: string[] }[];
}

/** Bed (or ground) elevation in metres above Ordnance Datum Newlyn. */
export interface Seabed {
  bedElevation(n: number, e: number): number;
  bedGradient(n: number, e: number): { n: number; e: number };
}

/**
 * The River Dart data used by the physics: one elevation grid for land, drying areas and (provisional) bed,
 * and the provisional tidal-stream pattern. Pure data; the app fetches the files, tests read them from disk.
 */
export class DartGeo implements Seabed {
  readonly elevation: Grid;
  readonly tidal: { e: Grid; n: Grid };
  readonly river: { e: Grid; n: Grid };
  readonly cdBelowOdn: number;
  /** False when the stream grid was missing: the pattern is then zero everywhere. */
  readonly hasStream: boolean;

  constructor(readonly manifest: DartManifest, elevation: ArrayBuffer, currentGrid?: ArrayBuffer) {
    const m = manifest;
    this.elevation = int16Grid(elevation, m.elevation, m.elevation.scale);
    const c = m.current;
    this.hasStream = currentGrid !== undefined;
    const current = currentGrid ?? new ArrayBuffer(c.nx * c.ny * 2 * c.components.length);
    const comp = (name: string) => {
      const k = c.components.indexOf(name);
      if (k < 0) throw new Error(`current.bin has no component ${name}`);
      return int16Grid(current, c, c.scale, k);
    };
    this.tidal = { e: comp('tidal_ve'), n: comp('tidal_vn') };
    this.river = { e: comp('river_ve'), n: comp('river_vn') };
    this.cdBelowOdn = m.verticalDatum.chartDatumBelowOdn;
  }

  bedElevation(n: number, e: number): number {
    return sampleGrid(this.elevation, n, e);
  }

  bedGradient(n: number, e: number): { n: number; e: number } {
    return gridGradient(this.elevation, n, e);
  }

  /** Ebb-direction stream patterns (unit mean speed across the entrance). */
  streamPattern(n: number, e: number): { tidal: NE; river: NE } {
    return {
      tidal: { n: sampleGrid(this.tidal.n, n, e), e: sampleGrid(this.tidal.e, n, e) },
      river: { n: sampleGrid(this.river.n, n, e), e: sampleGrid(this.river.e, n, e) },
    };
  }

  /** Water depth (m) at a point for a water level in m ODN; negative = dry ground above the water. */
  depth(n: number, e: number, waterLevelOdn: number): number {
    return waterLevelOdn - this.bedElevation(n, e);
  }

  /** The mapped area's bounds (local metres). */
  get domain(): { nMin: number; nMax: number; eMin: number; eMax: number } {
    return this.manifest.domain;
  }

  inDomain(n: number, e: number): boolean {
    const d = this.manifest.domain;
    return e >= d.eMin && e <= d.eMax && n >= d.nMin && n <= d.nMax;
  }
}
