import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { BOOM_CLEAR_M, SquibModel } from '../../src/render/squibModel';
import { FIRST_PERSON_HIDDEN } from '../../src/render/crew';

/**
 * Review #15 (20 Nov 2026): the helm view from the helm's own eye on the side deck, facing forward. Before, the camera
 * sat at a fixed point (0.8 m out, 1.5 m up, 2.15 m aft) and the whole helm figure was hidden, so the tiller hand and
 * legs vanished; now the eye is where the helm figure's head is, the head and torso are not drawn but the hands,
 * forearms and legs are, and the eye keeps clear of the boom.
 */
const pose = (m: SquibModel, crewY: number, mainAngle: number, hideHelm: boolean, rudder = 0) => {
  for (let k = 0; k < 90; k++) m.update({ main: { angle: mainAngle, luff: 1, fill: 1 }, jib: { angle: mainAngle * 0.8, luff: 1, fill: 1 }, rudder, crewY, crewTo: crewY, time: k / 30, hideHelm });
  m.group.updateMatrixWorld(true);
};
const helm = (m: SquibModel) => m.group.getObjectByName('crew-helm')!;
const bone = (m: SquibModel, name: string) => helm(m).children.find((c) => c.name === name)!;

describe('the helm view from the helm’s eye (review #15)', () => {
  for (const tack of [1, -1] as const) {
    for (const [leg, angle] of [['upwind', 0.12], ['downwind', 1.35]] as const) {
      it(`${tack > 0 ? 'starboard' : 'port'} side deck, ${leg}: at the helm’s head, on the windward deck aft, clear of the boom`, () => {
        const m = new SquibModel(squibParams());
        // Weight to windward (crewY > 0: starboard); the boom out to leeward.
        pose(m, 0.5 * tack, -tack * angle, true);
        const eye = m.helmEye();
        const head = bone(m, 'head').position;
        // At the head, not at a fixed point: a little above and outboard of it since 21 Nov 2026 (§3.4, so the crew sitting
        // forward on the same deck takes less of the view ahead).
        expect(eye.distanceTo(head)).toBeLessThan(0.25);
        expect(Math.abs(eye.x)).toBeGreaterThanOrEqual(Math.abs(head.x));
        // On the windward side deck, aft of the mast, at a sitting helm's eye height above the water.
        expect(Math.sign(eye.x)).toBe(tack);
        expect(Math.abs(eye.x)).toBeGreaterThan(0.45);
        expect(eye.z).toBeGreaterThan(1.2);
        expect(eye.y).toBeGreaterThan(0.9);
        expect(eye.y).toBeLessThan(1.9);
      });
    }
  }

  it('the head and torso are not drawn in the helm view; the hands, forearms and legs are; other views draw the whole figure', () => {
    const m = new SquibModel(squibParams());
    pose(m, 0.5, -0.2, true);
    expect(helm(m).visible).toBe(true);
    for (const n of FIRST_PERSON_HIDDEN) expect(bone(m, n).scale.x, n).toBe(0);
    for (const n of ['handL', 'handR', 'forearmL', 'forearmR', 'thighL', 'shinR', 'footL']) expect(bone(m, n).scale.x, n).toBe(1);
    // The tiller and its extension stay drawn.
    expect(m.group.getObjectByName('tiller')?.visible ?? true).toBe(true);
    pose(m, 0.5, -0.2, false);
    for (const n of FIRST_PERSON_HIDDEN) expect(bone(m, n).scale.x, n).toBe(1);
  });

  it('ducks under the boom: with the boom across the cockpit at the eye, the eye drops to keep BOOM_CLEAR_M from its spar', () => {
    const m = new SquibModel(squibParams());
    pose(m, 0.5, 0, true);
    const boom = m.group.getObjectByName('boom')!;
    // Bring the boom to the eye's height (the worst case: a gybe with the helm sitting up), then ask for the eye.
    const plain = m.helmEye().clone();
    boom.position.y = plain.y;
    boom.rotation.y = Math.atan2(plain.x - boom.position.x, plain.z - boom.position.z);
    const eye = m.helmEye();
    const dir = new THREE.Vector3(0, 0, 1).applyEuler(boom.rotation);
    const t = Math.max(0, eye.clone().sub(boom.position).dot(dir));
    const d = eye.distanceTo(boom.position.clone().addScaledVector(dir, t));
    expect(eye.y).toBeLessThan(plain.y);
    expect(d).toBeGreaterThanOrEqual(BOOM_CLEAR_M - 1e-6);
  });
});
