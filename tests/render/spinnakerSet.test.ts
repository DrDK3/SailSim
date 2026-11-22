import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { withSpinnaker } from '../../src/sim/boat/spinnaker';
import { SquibModel } from '../../src/render/squibModel';
import type { SpinnakerPose } from '../../src/render/spinnakerView';

/**
 * Fixes of 21 Nov 2026, §3.5: where the drawn spinnaker sets, checked by geometry on both gybes (the physics is not
 * changed). A full spinnaker's centroid is forward of the forestay and on the pole's side, and the pole is on the
 * windward side. Model frame (src/render/squibModel.ts): x to starboard, y up, z aft (the bow at −z).
 */
const D = Math.PI / 180;
// The forestay as the model draws the jib's luff: from the tack at the stem to the hounds.
const TACK = { y: 0.9, z: -2.85 };
const HOUNDS = { y: 6.2, z: -0.6 };
/** The forestay's z at height y (forward of it is a smaller z). */
const forestayZ = (y: number) => TACK.z + ((y - TACK.y) / (HOUNDS.y - TACK.y)) * (HOUNDS.z - TACK.z);

function set(awaDeg: number): { centroid: THREE.Vector3; poleTip: THREE.Vector3; poleSide: 1 | -1 } {
  const m = new SquibModel(withSpinnaker(squibParams()));
  // Wind from starboard (awa > 0): the pole to starboard, the windward side; from port, to port.
  const poleSide: 1 | -1 = awaDeg > 0 ? 1 : -1;
  const spin: SpinnakerPose = { phase: 'up', deployed: 1, fill: 1, poleSide, awa: awaDeg * D, aws: 5, progress: 1 };
  const boom = -poleSide * 1.2;
  for (let k = 0; k < 120; k++) m.update({ main: { angle: boom, luff: 1, fill: 1 }, jib: { angle: boom * 0.8, luff: 1, fill: 1 }, rudder: 0, crewY: 0, time: k / 30, spin } as never);
  m.group.updateMatrixWorld(true);
  const sail = m.group.getObjectByName('spinnaker-sail') as THREE.Mesh;
  const pole = m.group.getObjectByName('spinnaker-pole') as THREE.Mesh;
  expect(sail.visible && sail.parent!.visible).toBe(true);
  const pos = sail.geometry.getAttribute('position');
  const centroid = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) centroid.add(sail.localToWorld(v.fromBufferAttribute(pos, i)));
  centroid.divideScalar(pos.count);
  // The pole's outer end: its geometry runs from the mast (0) to −1 along its own z, scaled to the pole's length.
  const poleTip = pole.localToWorld(new THREE.Vector3(0, 0, -1));
  return { centroid, poleTip, poleSide };
}

describe('§3.5: the full spinnaker sets ahead of the forestay, on the pole’s side, the pole to windward', () => {
  for (const [gybe, awa] of [
    ['starboard gybe (wind from starboard)', 150],
    ['port gybe (wind from port)', -150],
    ['starboard, a broad reach', 110],
    ['port, a broad reach', -110],
  ] as const) {
    it(gybe, () => {
      const { centroid, poleTip, poleSide } = set(awa);
      expect(centroid.z).toBeLessThan(forestayZ(centroid.y));
      expect(Math.sign(centroid.x)).toBe(poleSide);
      // The pole's end is out on the windward side, forward of the mast.
      expect(Math.sign(poleTip.x)).toBe(poleSide);
      expect(Math.abs(poleTip.x)).toBeGreaterThan(0.5);
      expect(poleTip.z).toBeLessThan(-0.55);
    });
  }
});
