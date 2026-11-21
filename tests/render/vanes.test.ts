/** Flags and vanes show the wind: ensigns fly with the wind a boat feels, masthead vanes point into the true wind. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { flagDroop, flagYaw, vaneYaw } from '../../src/render/vane';
import { BerthedFleet } from '../../src/render/berthed';

const DEG = Math.PI / 180;

/** Where the fly points, in the boat frame (x starboard, z aft), for a pivot yaw. */
const fly = (yaw: number) => new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

describe('ensigns', () => {
  it('fly downwind of a boat lying still', () => {
    // Heading north; wind from the east (090): the air moves west, to port (-x).
    const a = flagYaw(90 * DEG, 5, 0, 0);
    expect(fly(a.yaw).x).toBeCloseTo(-1, 6);
    expect(a.aws).toBeCloseTo(5, 6);
    // Wind from ahead: the fly streams aft (+z).
    expect(fly(flagYaw(0, 5, 0, 0).yaw).z).toBeCloseTo(1, 6);
    // Heading east, wind from the north: on her port beam, so the fly goes to starboard.
    expect(fly(flagYaw(0, 5, 90 * DEG, 0).yaw).x).toBeCloseTo(1, 6);
  });

  it('fly aft under way in a calm, and with the apparent wind in a breeze', () => {
    const calm = flagYaw(0, 0, 30 * DEG, 4);
    expect(fly(calm.yaw).z).toBeCloseTo(1, 6);
    expect(calm.aws).toBeCloseTo(4, 6);
    // 4 m/s of way, 4 m/s of wind on the beam (from starboard): the apparent wind is 45° on the starboard bow.
    const v = fly(flagYaw(90 * DEG, 4, 0, 4).yaw);
    expect(v.x).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(v.z).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('hang limp in a calm and stream out in a breeze', () => {
    expect(flagDroop(0)).toBeGreaterThan(1.2);
    expect(flagDroop(8)).toBeLessThan(0.05);
  });
});

describe('masthead vanes', () => {
  it('point into the wind', () => {
    for (const from of [0, 45, 135, 200, 300]) {
      const arrow = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), vaneYaw(from * DEG));
      // three.js: x east, z south. The arrow points toward where the wind comes from.
      expect(arrow.x).toBeCloseTo(Math.sin(from * DEG), 6);
      expect(-arrow.z).toBeCloseTo(Math.cos(from * DEG), 6);
    }
  });

  it('stand at the mast top of each near sloop, none on the motor boats, and turn with the wind', () => {
    const fleet = new BerthedFleet(10);
    fleet.set(0, { n: 0, e: 0, heading: 0, length: 10, kind: 'yacht', seed: 0, visible: true });
    fleet.set(1, { n: 50, e: 0, heading: 1, length: 8, kind: 'yacht', seed: 1, visible: true });
    fleet.set(2, { n: 0, e: 50, heading: 0, length: 12, kind: 'motor', seed: 0, visible: true });
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 20, 0);
    fleet.setWind(200 * DEG);
    fleet.update(cam);
    const vanes = fleet.group.getObjectByName('berthed-vanes') as THREE.InstancedMesh;
    expect(vanes.count).toBe(2);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    vanes.getMatrixAt(0, m);
    m.decompose(p, q, s);
    expect(p.y).toBeCloseTo(13.5, 6);
    const arrow = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    expect(Math.atan2(arrow.x, -arrow.z) / DEG + 360).toBeCloseTo(200, 4);
    // The 8 m boat's mast is lower.
    vanes.getMatrixAt(1, m);
    m.decompose(p, q, s);
    expect(p.y).toBeCloseTo(13.5 * 0.8, 6);
    // A shift of a degree waits; ten turn them.
    fleet.setWind(201 * DEG);
    fleet.update(cam);
    vanes.getMatrixAt(0, m);
    m.decompose(p, q, s);
    expect(Math.atan2(new THREE.Vector3(0, 0, -1).applyQuaternion(q).x, -new THREE.Vector3(0, 0, -1).applyQuaternion(q).z) / DEG + 360).toBeCloseTo(200, 4);
    fleet.setWind(210 * DEG);
    fleet.update(cam);
    vanes.getMatrixAt(0, m);
    m.decompose(p, q, s);
    const a2 = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    expect(Math.atan2(a2.x, -a2.z) / DEG + 360).toBeCloseTo(210, 4);
  });
});

describe('the player\'s masthead vane and the indicator in words (review #1–#4)', () => {
  it('points into the apparent wind, with tacking tabs either side of dead aft', async () => {
    const { MastheadVane } = await import('../../src/render/mastheadVane');
    const THREE = await import('three');
    const v = new MastheadVane(30);
    // Wind from 40° to starboard: the arrow (built along −z, ahead) turns to point there, i.e. to +x and −z.
    v.update((40 * Math.PI) / 180);
    const tip = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.yaw);
    expect(tip.x).toBeCloseTo(Math.sin((40 * Math.PI) / 180), 6);
    expect(tip.z).toBeCloseTo(-Math.cos((40 * Math.PI) / 180), 6);
    const tabs = v.group.children.filter((c) => c.name === 'masthead-vane-tab');
    expect(tabs.map((t) => Math.round((t.rotation.y * 180) / Math.PI)).sort((a, b) => a - b)).toEqual([-30, 30]);
    v.setTabs(42);
    expect(tabs.map((t) => Math.round((Math.abs(t.rotation.y) * 180) / Math.PI))).toEqual([42, 42]);
  });

  it('the text alternative says where the wind comes from, rounded to 5°', async () => {
    const { indicatorText, clampTabDeg, indicatorPose } = await import('../../src/app/windIndicator');
    const D = Math.PI / 180;
    expect(indicatorText(41 * D, 5)).toBe('Wind indicator: wind from 40° to starboard of the bow');
    expect(indicatorText(-118 * D, 5)).toBe('Wind indicator: wind from 120° to port of the bow');
    expect(indicatorText(1 * D, 5)).toBe('Wind indicator: wind from dead ahead');
    expect(indicatorText(179.5 * D, 5)).toBe('Wind indicator: wind from dead astern');
    expect(indicatorText(40 * D, 0.1)).toMatch(/limp/);
    expect(clampTabDeg(10)).toBe(20);
    expect(clampTabDeg(60)).toBe(45);
    expect(clampTabDeg(Number.NaN)).toBe(30);
    // The 2D drawing: the fly streams downwind (opposite where the wind comes from) and hangs shorter in light air.
    const p = indicatorPose(40 * D, 6);
    expect(p.flyDeg).toBeCloseTo(220, 6);
    expect(p.arrowDeg).toBeCloseTo(40, 6);
    expect(indicatorPose(40 * D, 0.5).flyLen).toBeLessThan(p.flyLen);
  });
});
