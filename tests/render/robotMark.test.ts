/** Robotic racing marks with sponsors' names (the owner's request): seeded sponsors, a footprint the physics matches. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ROBOT_MARK, SPONSORS, robotMark, sponsorsFor } from '../../src/render/robotMark';
import { markRadius } from '../../src/sim/race/fleet';

describe('sponsors', () => {
  it('deals all four before any repeats, the same each time for a course, differently for another', () => {
    const ids = ['w', 'l', 'g1', 'g2', 'pin', 'x'];
    const a = sponsorsFor(ids, 'course-a');
    expect(new Set(ids.slice(0, 4).map((id) => a.get(id)))).toEqual(new Set(SPONSORS));
    expect(a.get('pin')).toBe(a.get('w'));
    expect([...sponsorsFor(ids, 'course-a')]).toEqual([...a]);
    const orders = new Set(['course-b', 'course-c', 'course-d', 'course-e'].map((s) => ids.slice(0, 4).map((id) => sponsorsFor(ids, s).get(id)).join()));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('the robotic mark', () => {
  it('carries its sponsor on a band, and its pin version a flag', () => {
    const m = robotMark(0xff7a1a, 'Salcombe Gin');
    expect(m.getObjectByName('robot-mark-band')!.userData.sponsor).toBe('Salcombe Gin');
    expect(m.getObjectByName('robot-mark-flag')).toBeUndefined();
    expect(robotMark(0xff7a1a, 'RDYC', 0xff7a1a).getObjectByName('robot-mark-flag')).toBeDefined();
  });

  it('fits inside the circle the boats meet, and stands about 2 m out of the water', () => {
    const m = robotMark(0xff7a1a, 'Henri Lloyd');
    m.updateMatrixWorld(true);
    let reach = 0;
    let top = 0;
    const v = new THREE.Vector3();
    m.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        // Below the mast: the hull, pontoons and inflatable.
        if (v.y < ROBOT_MARK.markFoot + ROBOT_MARK.markHeight + 0.3) reach = Math.max(reach, Math.hypot(v.x, v.z));
        top = Math.max(top, v.y);
      }
    });
    expect(reach).toBeLessThanOrEqual(markRadius('inflatable')! + 0.01);
    expect(markRadius('pin')).toBe(markRadius('inflatable'));
    expect(top).toBeGreaterThan(2);
    expect(top).toBeLessThan(3);
  });
});
