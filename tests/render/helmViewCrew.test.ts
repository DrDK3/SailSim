import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { SquibModel } from '../../src/render/squibModel';
import { CREW_FADED_OPACITY } from '../../src/render/crew';
import { DEFAULT_HELM_FOV, DEFAULT_PREFS } from '../../src/app/prefs';

/**
 * Fixes of 21 Nov 2026, §3.4: in the helm view on a beat the crew, sitting forward of the helm on the same deck, filled
 * much of the view ahead. The eye is now a little higher and further outboard within the side deck, the default field of
 * view wider (74°, was 68°), and "Crew in helm view: faded" draws the crew see-through (a presentation choice).
 */
function beat(tack: 1 | -1, fadeCrew = false): SquibModel {
  const m = new SquibModel(squibParams());
  for (let k = 0; k < 90; k++) m.update({ main: { angle: -tack * 0.12, luff: 1, fill: 1 }, jib: { angle: -tack * 0.1, luff: 1, fill: 1 }, rudder: 0, crewY: 0.5 * tack, crewTo: 0.5 * tack, time: k / 30, hideHelm: true, fadeCrew });
  m.group.updateMatrixWorld(true);
  return m;
}

/** The share of a 16:9 helm view the crew figure's bounding box covers, looking ahead from the helm's eye. */
function crewShare(m: SquibModel, tack: 1 | -1, fov: number): number {
  const box = new THREE.Box3().setFromObject(m.group.getObjectByName('crew-crew')!);
  const cam = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 500);
  cam.position.copy(m.helmEye());
  // As the scene aims the helm view by default: ahead, a little to the helm's side, at the height of the sails' foot.
  cam.lookAt(tack * 0.2, 0.9, -25);
  cam.updateMatrixWorld(true);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(cam);
        xs.push(Math.max(-1, Math.min(1, p.x)));
        ys.push(Math.max(-1, Math.min(1, p.y)));
      }
  return ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / 4;
}

describe('§3.4: the helm view on a beat', () => {
  it('the default field of view is 74° (was 68°), and the crew are shown by default', () => {
    expect(DEFAULT_HELM_FOV).toBe(74);
    expect(DEFAULT_PREFS.helmFovDeg).toBe(74);
    expect(DEFAULT_PREFS.helmCrew).toBe('shown');
  });

  for (const tack of [1, -1] as const) {
    it(`${tack > 0 ? 'starboard' : 'port'} tack: the crew take under 30% of the view ahead (36% before)`, () => {
      expect(crewShare(beat(tack), tack, DEFAULT_HELM_FOV)).toBeLessThan(0.3);
    });

    it(`${tack > 0 ? 'starboard' : 'port'} tack: faded draws the crew see-through, and only the crew (not the helm’s hands)`, () => {
      const faded = beat(tack, true);
      const crew = faded.group.getObjectByName('crew-crew')!.children.find((c) => c instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh;
      const helm = faded.group.getObjectByName('crew-helm')!.children.find((c) => c instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh;
      const mat = crew.material as THREE.MeshStandardMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBeCloseTo(CREW_FADED_OPACITY, 6);
      expect((helm.material as THREE.MeshStandardMaterial).transparent).toBe(false);
      // Shown again: opaque.
      const shown = beat(tack, false);
      const m2 = (shown.group.getObjectByName('crew-crew')!.children.find((c) => c instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh).material as THREE.MeshStandardMaterial;
      expect(m2.transparent).toBe(false);
    });
  }
});
