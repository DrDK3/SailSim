import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { SquibModel } from '../../src/render/squibModel';

/**
 * Issue 225 / review #36: a fully flogging sail (luff 0) lines up with the wind, so its belly (the fill) is zero; the
 * flogging wave was scaled by the fill and vanished exactly then, leaving the sail flat and edge-on from astern. The
 * wave now runs across the chord's own normal, driven by the luff value: the sail visibly flaps from any side.
 */
function shape(luff: number, fill: number, time: number): Float32Array {
  const m = new SquibModel(squibParams());
  const sail = { angle: 0, luff, fill };
  m.update({ main: sail, jib: sail, rudder: 0, crewY: 0.3, time, aws: 6 });
  const main = m.group.getObjectByName('mainsail') as THREE.Mesh;
  return Float32Array.from((main.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array);
}

/** How far the cloth moves between moments (m, the largest over the sail): the flapping, not the sail's set or twist. */
function motion(luff: number, fill: number): number {
  const shots = [0.3, 1.1, 2.4, 3.7].map((t) => shape(luff, fill, t));
  let worst = 0;
  for (const s of shots.slice(1)) for (let i = 0; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i]! - shots[0]![i]!));
  return worst;
}

describe('a flogging sail flaps however it lies to the wind (issue 225)', () => {
  it('fully flogging, wind along the sail (fill 0): the cloth moves out of its plane, more at the leech', () => {
    expect(motion(0, 0)).toBeGreaterThan(0.15);
  });
  it('drawing (luff 1) with no fill: no flapping; the flapping grows as the luff value falls', () => {
    expect(motion(1, 0)).toBeLessThan(0.005);
    expect(motion(0, 0)).toBeGreaterThan(motion(0.5, 0));
    expect(motion(0.5, 0)).toBeGreaterThan(motion(0.95, 0));
  });
});
