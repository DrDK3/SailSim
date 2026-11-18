import type * as THREE from 'three';

/**
 * The sailing cues every graphics preset must keep (juniors round, hard rule: presets may change beauty, never
 * cues). An audit of what is actually in the scene and drawn this frame, used by the end-to-end test at each preset
 * (tests/e2e/juniorsCues.spec.ts) and available from the console as `__squib.controller.cueAudit()`.
 */
export interface CueAudit {
  /** The sails drawn (their shape follows the physics: src/render/squibModel.ts). */
  sails: boolean;
  /** The jib's telltales drawn. */
  telltales: number;
  /** The boat's roll in the picture differs from upright when the physics heels her (rad, from the boat's pose). */
  heelDrawn: number;
  /** Wake behind the boat, and the bow wave and hull foam (speed cues). */
  wake: boolean;
  bowWave: boolean;
  /** Puffs written to the water shader (cat's paws) this frame. */
  puffsDrawn: number;
  /** The masthead burgee (the wind indicator on the boat). */
  vane: boolean;
  /** Racing marks drawn (when there is a course). */
  marks: number;
  /** Other boats drawn (when there is a fleet). */
  otherBoats: number;
}

/** Visible all the way up to the scene. */
function shown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export function auditCues(scene: THREE.Scene, puffsDrawn: number, heelDrawn: number): CueAudit {
  let sails = 0;
  let telltales = 0;
  let wake = false;
  let bowWave = false;
  let vane = false;
  let marks = 0;
  let otherBoats = 0;
  scene.traverse((o) => {
    switch (o.name) {
      case 'mainsail':
      case 'jib':
        if (shown(o) && !o.parent?.name.startsWith('fleet')) sails++;
        break;
      case 'telltale':
        if (shown(o)) telltales++;
        break;
      case 'wake':
        if (shown(o)) wake = true;
        break;
      case 'hull-foam':
        if (shown(o)) bowWave = true;
        break;
      case 'burgee-flag':
        if (shown(o)) vane = true;
        break;
      case 'course-mark':
        if (shown(o)) marks++;
        break;
      default:
        if (o.name.startsWith('fleet-boat-') && shown(o)) otherBoats++;
    }
  });
  return { sails: sails >= 2, telltales, heelDrawn, wake, bowWave, puffsDrawn, vane, marks, otherBoats };
}
