import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Simulation, squibParams, uniformEnvironment } from '../../src/sim/index';
import { TeachingOverlay } from '../../src/render/teaching';

/** The teaching overlay (review UX-9): heading, course over ground, stream, true and apparent wind, VMG, a buoy. */

function stubCanvas(): void {
  const ctx: unknown = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 60 }) : () => undefined), set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
}
afterEach(() => vi.unstubAllGlobals());

const D = Math.PI / 180;
/** A Squib close-hauled on starboard tack (wind from 225°, heading 180°) in a 1.2 kn stream setting 045°. */
function sailing() {
  const sim = new Simulation({
    params: squibParams(),
    env: uniformEnvironment({ twsKn: 10, twdDeg: 225, currentSetDeg: 45, currentRateKn: 1.2 }),
    initial: { n: 0, e: 0, headingDeg: 180, speedKn: 4 },
    input: { autoMain: true, autoJib: true, autoCrew: true },
  });
  sim.advance(20);
  return sim.snapshot();
}
/** The direction an arrow or line points in, as a compass bearing (three.js: x = east, z = south). */
const bearingOf = (v: THREE.Vector3) => ((Math.atan2(v.x, -v.z) / D) + 360) % 360;
const diff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

describe('teaching overlay', () => {
  it('draws nothing until asked', () => {
    stubCanvas();
    const o = new TeachingOverlay();
    o.set([]);
    expect(o.group.visible).toBe(false);
    o.set([], { n: 100, e: 50 });
    expect(o.group.visible).toBe(true);
    expect(o.shown).toEqual(['target']);
  });

  it('each part points the way it should, and every part has a label in words', () => {
    stubCanvas();
    const s = sailing();
    const o = new TeachingOverlay();
    o.set(['heading', 'cog', 'current', 'wind', 'vmg']);
    const boat = new THREE.Vector3(s.e, 0, -s.n);
    o.update(s, boat, 0);
    const lines = o.group.children.filter((c): c is THREE.Line => c instanceof THREE.Line && !(c.parent instanceof THREE.ArrowHelper));
    const arrows = o.group.children.filter((c): c is THREE.ArrowHelper => c instanceof THREE.ArrowHelper);
    const along = (l: THREE.Line) => {
      const p = l.geometry.getAttribute('position');
      return new THREE.Vector3(p.getX(1) - p.getX(0), 0, p.getZ(1) - p.getZ(0));
    };
    const [heading, cog] = lines as [THREE.Line, THREE.Line];
    expect(diff(bearingOf(along(heading)), s.heading / D)).toBeLessThan(1);
    expect(diff(bearingOf(along(cog)), s.cog / D)).toBeLessThan(2);
    // The stream sets 045°; the course over ground is pushed that way from the heading.
    const dirOf = (a: THREE.ArrowHelper) => new THREE.Vector3(0, 1, 0).applyQuaternion(a.quaternion);
    const [vmg, stream, trueWind] = arrows as [THREE.ArrowHelper, THREE.ArrowHelper, THREE.ArrowHelper, THREE.ArrowHelper];
    expect(stream.visible).toBe(true);
    expect(diff(bearingOf(dirOf(stream)), 45)).toBeLessThan(1);
    // The true wind blows from 225° towards 045° (over the ground, with the stream: within a few degrees).
    expect(diff(bearingOf(dirOf(trueWind)), 45)).toBeLessThan(8);
    // Close-hauled, VMG is made towards the wind: the line points upwind (towards 225°).
    expect(s.vmg).toBeGreaterThan(0);
    expect(diff(bearingOf(dirOf(vmg)), 225)).toBeLessThan(8);
    // Labels: one sprite per part, all shown.
    const sprites = o.group.children.filter((c) => c instanceof THREE.Sprite && c.visible);
    expect(sprites.length).toBe(6);
  });
});
