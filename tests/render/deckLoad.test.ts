/**
 * Cars and foot passengers come and go at the ferry slips (owner, 12 Nov 2026: "when the ferries dock, cars and
 * passengers get off, and new cars and passengers get on"): the set that came across drives and walks off over the
 * ramp once it is down, lane by lane; the other set comes aboard after them and is in its places before she leaves;
 * under way she carries her set; overnight she lies empty.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DeckLoad, type DeckLayout } from '../../src/render/deckLoad';

const layout: DeckLayout = {
  deckY: 1,
  deckL: 30,
  lanes: [-1, 1].map((s) => ({ x: s * 2.6, z: [-8.1, -2.7, 2.7, 8.1] })),
  walks: [{ x: -4.9, y: 0 }, { x: 4.9, y: 0 }],
};

/** Visible instances' positions, by mesh name prefix. */
function placed(load: DeckLoad, prefix: string): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (const o of load.group.children) {
    if (!(o instanceof THREE.InstancedMesh) || !o.name.startsWith(prefix) || o.name.includes('trim')) continue;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      m.decompose(p, q, s);
      // Hidden ones are parked 50 m down at no size (decompose reports a size of 1 for them).
      if (p.y > -40) out.push(p.clone());
    }
  }
  return out;
}

describe('deck loads at the slips', () => {
  const load = new DeckLoad(layout, 11, 1);
  const cars = (set: 0 | 1) => load.count(set).cars;

  it('carries a full set of each: two lanes of four', () => {
    expect(cars(0)).toBe(8);
    expect(cars(1)).toBe(8);
    expect(load.count(0).people).toBeGreaterThanOrEqual(2);
  });

  it('under way: her set in its lanes on the deck, the other ashore', () => {
    load.update({ set: 1 }, false, -1, -1, true);
    const on = placed(load, 'deck-cars');
    expect(on).toHaveLength(8);
    for (const p of on) {
      expect(Math.abs(p.z)).toBeLessThan(layout.deckL / 2);
      expect(p.y).toBeCloseTo(1.05, 6);
    }
  });

  it('at the slip: off over the ramp lane by lane, up the slip and out of sight; the new set comes aboard to the mirrored places', () => {
    const at = (since: number, left: number) => load.update({ set: 1, since, left }, true, -1, -1, true, () => 3);
    // Ramp coming down: everyone still aboard (set 1 arrived).
    at(2, 100);
    expect(placed(load, 'deck-cars')).toHaveLength(8);
    // A few seconds in: the first lane has moved towards the slip (-z); the second not yet.
    at(13, 90);
    const moving = placed(load, 'deck-cars');
    expect(moving.some((p) => p.z < -9)).toBe(true);
    // A few seconds later the first are over the ramp, climbing to the slip's height (3 m) from the deck's.
    at(17, 86);
    expect(placed(load, 'deck-cars').some((p) => p.z < -15 && p.y > 1.5)).toBe(true);
    // All ashore, nobody aboard yet.
    at(40, 60);
    expect(placed(load, 'deck-cars')).toHaveLength(0);
    // Before she leaves the new set is aboard, in the mirrored places (she turns end for end as she leaves).
    at(94, 6.5);
    const aboard = placed(load, 'deck-cars');
    expect(aboard).toHaveLength(8);
    for (const p of aboard) expect(Math.abs(p.z)).toBeLessThan(layout.deckL / 2);
    const slots = layout.lanes.flatMap((l) => l.z.map((z) => [-l.x, -z]));
    for (const p of aboard) expect(slots.some(([x, z]) => Math.abs(x! - p.x) < 0.01 && Math.abs(z! - p.z) < 0.01)).toBe(true);
    // Foot passengers: the new ones aboard too, at deck height.
    const people = placed(load, 'deck-people');
    expect(people.length).toBe(load.count(0).people);
  });

  it('they drive off over the ramp and up the slip, and on again, smoothly: no jumps up or down, tilted on the ramp (owner, 13 Nov 2026)', () => {
    // A slip whose ground steps up sharply 6 m beyond the ramp (as a wall or a smoothed bank can in the data).
    const steep = new DeckLoad(layout, 5, 1);
    const ground = (_x: number, z: number) => (Math.abs(z) > 27 ? 3 : -0.5);
    const frames: { p: THREE.Vector3; tilt: number }[][] = [];
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    for (let t = 0; t <= 120; t += 0.1) {
      steep.update({ set: 1, since: t, left: 130 - t }, true, -1, -1, true, ground);
      const now: { p: THREE.Vector3; tilt: number }[] = [];
      for (const o of steep.group.children) {
        if (!(o instanceof THREE.InstancedMesh) || !o.name.startsWith('deck-cars-') || o.name.includes('trim')) continue;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          m.decompose(pos, q, sc);
          if (pos.y < -40) continue;
          const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
          now.push({ p: pos.clone(), tilt: Math.asin(Math.max(-1, Math.min(1, nose.y))) });
        }
      }
      frames.push(now);
    }
    let worstDy = 0;
    let tilted = 0;
    for (let k = 1; k < frames.length; k++) {
      for (const c of frames[k]!) {
        // The same car a tenth of a second before: the nearest in plan within a metre (new arrivals have none).
        let best: { p: THREE.Vector3 } | undefined;
        let bd = 1;
        for (const o of frames[k - 1]!) {
          const d = Math.hypot(o.p.x - c.p.x, o.p.z - c.p.z);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        if (best) worstDy = Math.max(worstDy, Math.abs(c.p.y - best.p.y));
        if (Math.abs(c.p.z) > 15 && Math.abs(c.p.z) < 18.5 && Math.abs(c.tilt) > 0.05) tilted++;
      }
    }
    // At 3.5 m/s a tenth of a second is 0.35 m along the way: never more than about 6 cm up or down in it.
    expect(worstDy).toBeLessThan(0.07);
    expect(tilted).toBeGreaterThan(0);
    // And they leave the deck's end for the slip, not the deck's middle: some well beyond it, some coming aboard.
    expect(frames.some((f) => f.some((c) => c.p.z < -40))).toBe(true);
  });

  it('overnight she lies empty', () => {
    load.update({ set: 0, since: Infinity, left: Infinity }, true, -1, -1, true);
    expect(placed(load, 'deck-cars')).toHaveLength(0);
    expect(placed(load, 'deck-people')).toHaveLength(0);
  });
});
