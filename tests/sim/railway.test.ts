import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Railway, TRAIN, pathPoint, type RailVehicle, type RailwayFeatures } from '../../src/sim/env/railway';

const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as { railway: RailwayFeatures };
const rail = new Railway(features.railway);
const ms = (iso: string) => Date.parse(iso);

/** Do two vehicles' bodies (over buffers less the buffers and gangways, 0.8 m; 2.9 m wide) overlap? Separating axes. */
function overlap(a: RailVehicle, b: RailVehicle): boolean {
  const box = (v: RailVehicle) => ({ ...v, length: (v.kind === 'loco' ? TRAIN.locoLength : TRAIN.coachLength) - 0.8, beam: 2.9 });
  const [p, q] = [box(a), box(b)];
  for (const r of [p, q]) {
    for (const ax of [[Math.sin(r.heading), Math.cos(r.heading)], [Math.cos(r.heading), -Math.sin(r.heading)]] as const) {
      const ext = (v: typeof p) => {
        const c = v.e * ax[0] + v.n * ax[1];
        const h = (v.length / 2) * Math.abs(Math.sin(v.heading) * ax[0] + Math.cos(v.heading) * ax[1]) + (v.beam / 2) * Math.abs(Math.cos(v.heading) * ax[0] - Math.sin(v.heading) * ax[1]);
        return [c - h, c + h];
      };
      const [a0, a1] = ext(p);
      const [b0, b1] = ext(q);
      if (a1! < b0! - 0.05 || b1! < a0! - 0.05) return false;
    }
  }
  return true;
}

describe('the railway at Kingswear (OpenStreetMap track)', () => {
  it('runs from the buffer stops by the station along the east bank, through the Greenway tunnel, to the edge of the map', () => {
    const st = rail.station!;
    expect(st.name).toMatch(/Kingswear/);
    const start = pathPoint(rail.main!, 0);
    expect(Math.hypot(start.e - st.e, start.n - st.n)).toBeLessThan(80);
    expect(rail.main!.length).toBeGreaterThan(4000);
    // The 495-yard (453 m) Greenway tunnel, found from the ground rising over the line.
    expect(rail.main!.tunnels).toHaveLength(1);
    const [a, b] = rail.main!.tunnels[0]!;
    expect(b - a).toBeGreaterThan(400);
    expect(b - a).toBeLessThan(500);
    // A loop beside the platform road for the engine to run round its train.
    expect(rail.loop!.length).toBeGreaterThan(150);
  });
});

describe('steam trains (operator timetable, 25 Oct 2026; train make-up and moves estimated)', () => {
  it('a train arrives from Paignton at 11:00, the engine runs round, and it leaves at 11:10', () => {
    // Wednesday 15 July 2026 (BST): 10:58 arriving, 11:01 standing, 11:04 running round, 11:09 coupled, 11:12 leaving.
    expect(rail.state(ms('2026-07-15T09:58:00Z'))!.phase).toBe('arriving');
    expect(rail.state(ms('2026-07-15T10:00:30Z'))!.phase).toBe('standing');
    expect(rail.state(ms('2026-07-15T10:02:00Z'))!.phase).toBe('running-round');
    expect(rail.state(ms('2026-07-15T10:09:00Z'))!.phase).toBe('standing');
    expect(rail.state(ms('2026-07-15T10:12:00Z'))!.phase).toBe('departing');
    // No train at 10:00, out of season, or late in the evening.
    expect(rail.state(ms('2026-07-15T09:00:00Z'))).toBeUndefined();
    expect(rail.state(ms('2026-12-02T11:00:00Z'))).toBeUndefined();
    expect(rail.state(ms('2026-07-15T18:00:00Z'))).toBeUndefined();
    // The four trains of the day each call.
    const arrivals = ['10:59', '12:29', '14:29', '15:59'].map((t) => rail.state(ms(`2026-07-15T${String(+t.slice(0, 2) - 1).padStart(2, '0')}${t.slice(2)}:30Z`))?.phase);
    expect(arrivals).toEqual(['arriving', 'arriving', 'arriving', 'arriving']);
  });

  it('moves smoothly, keeps its coaches in line, and the engine never runs through them', () => {
    let prev: RailVehicle[] | undefined;
    let maxJump = 0;
    let maxSpeed = 0;
    const phases = new Set<string>();
    for (let t = ms('2026-07-15T09:40:00Z'); t < ms('2026-07-15T10:30:00Z'); t += 1000) {
      const st = rail.state(t);
      if (!st) {
        prev = undefined;
        continue;
      }
      phases.add(st.phase);
      maxSpeed = Math.max(maxSpeed, st.speed);
      const v = st.vehicles;
      expect(v).toHaveLength(1 + TRAIN.coaches);
      if (prev) for (let i = 0; i < v.length; i++) maxJump = Math.max(maxJump, Math.hypot(v[i]!.e - prev[i]!.e, v[i]!.n - prev[i]!.n));
      for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (!v[i]!.hidden && !v[j]!.hidden) expect(overlap(v[i]!, v[j]!), `${st.phase} ${i}-${j} at ${new Date(t).toISOString()}`).toBe(false);
      prev = v;
    }
    expect([...phases]).toEqual(['arriving', 'standing', 'running-round', 'departing']);
    expect(maxSpeed).toBeLessThanOrEqual(25 * 0.44704 + 1e-6);
    expect(maxJump).toBeLessThan(12);
  });
});
