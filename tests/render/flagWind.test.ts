/**
 * Every flag and vane moves with the wind (owner, 17 Nov 2026: "All flags and weather vanes should move with the
 * wind"; src/render/flagMotion.ts). For several wind directions and speeds each kind flies downwind (vanes point into
 * the wind) of the wind where it is, within a stated tolerance: on a moving boat the apparent wind, moored, at anchor
 * or ashore the true wind there. The flutter grows with the wind, is near nothing in a calm, and is cut with reduced
 * motion while the direction still follows the wind.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VesselState } from '../../src/sim/env/traffic';
import type { Course } from '../../src/sim/course/types';
import type { ResolvedCourse } from '../../src/sim/course/course';

// Labels draw text on a canvas (a browser API): plain sprites here.
vi.mock('../../src/render/labels', () => ({ makeLabel: () => new THREE.Sprite() }));
const { REDUCED_FLUTTER, apparentWind, downwind, flagFlutter, setFlagMotionReduced } = await import('../../src/render/flagMotion');
const { Burgee } = await import('../../src/render/burgee');
const { ShipBuoysView } = await import('../../src/render/mosaique');
const { CLUB_BURGEE_FLY, ClubBurgee, ClubEnsign } = await import('../../src/render/clubEnsign');
const { TrafficView } = await import('../../src/render/traffic');
const { CourseScene } = await import('../../src/render/course');
const { BerthedFleet } = await import('../../src/render/berthed');

const DEG = Math.PI / 180;
const DIRS = [0, 75, 160, 225, 300];
const SPEEDS = [1.5, 5, 11];
const DAY = Date.parse('2026-07-15T11:00:00Z');
afterEach(() => setFlagMotionReduced(false));

/** Angle between two compass bearings (deg, 0..180). */
const off = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) / DEG;
/** A uniform true wind from `fromDir` (rad) at `speed` m/s, as the simulation gives it (where the air moves to). */
const uniform = (fromDir: number, speed: number) => () => ({ n: -speed * Math.cos(fromDir), e: -speed * Math.sin(fromDir) });

/**
 * The compass bearing (rad) a flag's cloth lies from its hoist: from the mesh's origin (the hoist, on the staff) to
 * the centre of its vertices, in the horizontal (scene x = east, -z = north).
 */
/**
 * A flag on a raked staff turns about the staff (src/render/vane.ts yawOnStaff), so in light air it droops down the
 * staff: the angle (degrees) between its fly and the downwind direction, both seen across the staff (projected on the
 * plane square to it). `staff` is the frame the flag's pivot sits in (its +y up the staff).
 */
function offAcrossStaff(mesh: THREE.Object3D, staff: THREE.Object3D, downwindBearing: number): number {
  mesh.updateWorldMatrix(true, false);
  const m = mesh as THREE.Mesh;
  const pos = m.geometry.getAttribute('position');
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) c.add(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  c.divideScalar(pos.count);
  const o = staff.getWorldPosition(new THREE.Vector3());
  const axis = staff.localToWorld(new THREE.Vector3(0, 1, 0)).sub(o).normalize();
  const fly = c.sub(o);
  fly.addScaledVector(axis, -fly.dot(axis)).normalize();
  const dw = new THREE.Vector3(Math.sin(downwindBearing), 0, -Math.cos(downwindBearing));
  dw.addScaledVector(axis, -dw.dot(axis)).normalize();
  return (Math.acos(Math.max(-1, Math.min(1, fly.dot(dw)))) * 180) / Math.PI;
}

function flyBearing(mesh: THREE.Object3D): number {
  mesh.updateWorldMatrix(true, false);
  const m = mesh as THREE.Mesh;
  const pos = m.geometry.getAttribute('position');
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) c.add(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  c.divideScalar(pos.count);
  const o = new THREE.Vector3().applyMatrix4(m.matrixWorld);
  return Math.atan2(c.x - o.x, -(c.z - o.z));
}

/** How far the cloth of a cloth flag stands out of its plane (rms of the local z of its vertices, m). */
function clothRipple(mesh: THREE.Object3D): number {
  const pos = (mesh as THREE.Mesh).geometry.getAttribute('position');
  let s = 0;
  for (let i = 0; i < pos.count; i++) s += pos.getZ(i) ** 2;
  return Math.sqrt(s / pos.count);
}

/** A Squib's burgee (also the Class of 1866 boats' club burgees: the same flag, another picture) on a boat. */
function squibBurgee(heading: number) {
  const boat = new THREE.Group();
  boat.rotation.y = -heading;
  const b = new Burgee(null);
  boat.add(b.group);
  return { b, flag: b.group.getObjectByName('burgee-flag')! };
}

function state(extra: Partial<VesselState>): VesselState {
  return { id: 'rc', name: 'test', label: 'test', unit: 0, kind: 'river-cruiser', length: 30, beam: 6.4, ram: false, n: 0, e: 0, heading: 0, sog: 0, moving: true, phase: 'underway', parts: [], ...extra } as VesselState;
}

/** A course with a committee boat and a pin end at (100, ±50). */
function courseScene() {
  const course = { id: 't', name: 'T', marks: [{ id: 'cb', name: 'Start boat', kind: 'committee-boat' }, { id: 'pin', name: 'Pin', kind: 'pin' }] } as unknown as Course;
  const r = {
    pos: new Map([['cb', { n: 100, e: 50 }], ['pin', { n: 100, e: -50 }]]),
    start: [{ n: 100, e: -50 }, { n: 100, e: 50 }], finish: [{ n: 100, e: -50 }, { n: 100, e: 50 }], legs: [], boundaries: [],
  } as unknown as ResolvedCourse;
  const scene = new CourseScene(r, course);
  let committee: THREE.Object3D | undefined;
  let pin: THREE.Object3D | undefined;
  scene.group.traverse((o) => {
    if (o.name === 'committee-flag-cloth') committee = o;
    if (o.name === 'robot-mark-flag') pin = o;
  });
  return { scene, committee: committee!, pin: pin! };
}

/** The bearing (rad) a berthed boat's vane arrow (along its -z) points in, instance i. */
function vaneBearing(fleet: InstanceType<typeof BerthedFleet>, i: number): number {
  const vanes = fleet.group.getObjectByName('berthed-vanes') as THREE.InstancedMesh;
  const m = new THREE.Matrix4();
  vanes.getMatrixAt(i, m);
  const d = new THREE.Vector3(0, 0, -1).transformDirection(m);
  return Math.atan2(d.x, -d.z);
}
function berthedFleet(boats: { n: number; e: number }[]) {
  const fleet = new BerthedFleet(boats.length, 420, 3000);
  boats.forEach((b, i) => fleet.set(i, { n: b.n, e: b.e, heading: 0.3, length: 9, kind: 'yacht', seed: 0, visible: true }));
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(boats[0]!.e, 20, -boats[0]!.n);
  fleet.update(cam);
  return fleet;
}

describe('flags and vanes point with the wind where they are', () => {
  // Tolerances (deg): rigid flags swing up to 0.12 rad (7°) about the downwind line as they flutter; cloth flags
  // ripple; the vanes hunt up to 0.07 rad (4°).
  const RIGID = 10;
  const CLOTH = 15;
  const VANE = 6;

  it('a Squib\'s burgee (and the Class of 1866 burgees) on a boat lying still: downwind of the true wind', () => {
    for (const heading of [0, 1.1, 4]) {
      for (const d of DIRS) for (const s of SPEEDS) {
        const from = d * DEG;
        const { b, flag } = squibBurgee(heading);
        // The burgee reads the apparent wind in the boat's frame (from ahead 0, from starboard > 0).
        b.update(from - heading, s, 2.3);
        expect(off(flyBearing(flag), downwind(from)), `${d}° ${s} m/s`).toBeLessThan(CLOTH);
      }
    }
  });

  it('Mosaique\'s ensign and her masthead burgee (moored): downwind of the true wind where she lies', () => {
    const view = new ShipBuoysView();
    const ensign = view.yacht.getObjectByName('mosaique-ensign-cloth')!;
    const staff = view.yacht.getObjectByName('mosaique-ensign-staff')!;
    const burgee = view.yacht.getObjectByName('mosaique-burgee')!.getObjectByName('burgee-flag')!;
    for (const d of DIRS) for (const s of SPEEDS) {
      view.update(DAY, { fromDir: d * DEG, speed: s }, 4.1);
      // Turned about its raked staff (owner, 22 Nov 2026): downwind as seen across the staff.
      expect(offAcrossStaff(ensign, staff, downwind(d * DEG)), `ensign ${d}° ${s}`).toBeLessThan(CLOTH);
      expect(off(flyBearing(burgee), downwind(d * DEG)), `burgee ${d}° ${s}`).toBeLessThan(CLOTH);
    }
  });

  it('the club\'s ensign on its flagstaff ashore: downwind', () => {
    const en = new ClubEnsign([10, 20], 5, 12);
    const flag = en.group.getObjectByName('club-ensign-flag')!;
    for (const d of DIRS) for (const s of SPEEDS) {
      en.update(DAY, { fromDir: d * DEG, speed: s }, 7.7);
      expect(off(flyBearing(flag), downwind(d * DEG)), `${d}° ${s}`).toBeLessThan(RIGID);
    }
  });

  it('the club\'s burgee at its flagstaff\'s masthead (owner, 18 Nov 2026): downwind, at colours', () => {
    const b = new ClubBurgee([10, 20], 5, 12);
    const flag = b.group.getObjectByName('burgee-flag')!;
    // At the top of the 12 m staff (foot at 5 m ODN): the flag hangs from just above the truck.
    const box = new THREE.Box3().setFromObject(b.group);
    expect(box.max.y).toBeGreaterThan(5 + 12);
    expect(box.max.y).toBeLessThan(5 + 12 + 1);
    expect(box.max.x - box.min.x).toBeLessThan(CLUB_BURGEE_FLY * 1.3);
    for (const d of DIRS) for (const s of SPEEDS) {
      b.update(DAY, { fromDir: d * DEG, speed: s }, 7.7);
      expect(off(flyBearing(flag), downwind(d * DEG)), `${d}° ${s}`).toBeLessThan(CLOTH);
    }
    // Raised and lowered with the ensign, at colours (owner, later on 18 Nov 2026): flying at 11:00 in July, down at
    // 02:00, and down at 08:10 on a November morning (colours there are at 09:00), as the ensign is.
    const en = new ClubEnsign([10, 20], 5, 12);
    const wind = { fromDir: 250 * DEG, speed: 6 };
    for (const [at, up] of [['2026-07-15T11:00:00Z', true], ['2026-07-15T02:00:00Z', false], ['2026-11-18T08:10:00Z', false], ['2026-11-18T12:00:00Z', true]] as const) {
      b.update(Date.parse(at), wind, 3);
      en.update(Date.parse(at), wind, 3);
      expect(b.group.visible, at).toBe(up);
      expect(en.group.visible, at).toBe(up);
    }
  });

  it('the river traffic\'s ensigns (lying still): downwind of the true wind where each boat is', () => {
    const view = new TrafficView();
    const cam = new THREE.PerspectiveCamera();
    for (const d of DIRS) for (const s of SPEEDS) {
      // The wind turns 40° from west to east of the river: each boat reads her own.
      const at = (_n: number, e: number) => uniform((d + (e > 0 ? 40 : 0)) * DEG, s)();
      for (const e of [-200, 200]) {
        view.update([state({ e, sog: 0, moving: false, heading: 0.7 })], 3.3, cam, false, { fromDir: 0, speed: 1, at });
        const flag = view.group.getObjectByName('ensign')!.getObjectByName('ensign-flag')!;
        // Turned about its raked staff (owner, 22 Nov 2026): downwind as seen across the staff.
        const staff = view.group.getObjectByName('ensign-staff')!;
        expect(offAcrossStaff(flag, staff, downwind((d + (e > 0 ? 40 : 0)) * DEG)), `${d}° ${s} at e ${e}`).toBeLessThan(RIGID);
      }
    }
  });

  it('the committee boat\'s flag and the pin end\'s flag (at anchor, holding station): downwind', () => {
    const { scene, committee, pin } = courseScene();
    for (const d of DIRS) for (const s of SPEEDS) {
      // The robots hold head to the wind at the boat; the wind at the marks is 25° further round.
      scene.setWind(d * DEG, uniform((d + 25) * DEG, s), s);
      scene.setCommitteeHeading(() => (d + 10) * DEG);
      scene.update(0, 'racing', false, 5.2);
      expect(off(flyBearing(committee), downwind((d + 25) * DEG)), `committee ${d}° ${s}`).toBeLessThan(RIGID);
      expect(off(flyBearing(pin), downwind((d + 25) * DEG)), `pin ${d}° ${s}`).toBeLessThan(RIGID);
    }
  });

  it('the moored and berthed boats\' masthead vanes: into the true wind at each boat', () => {
    const fleet = berthedFleet([{ n: 0, e: -40 }, { n: 0, e: 40 }]);
    for (const d of DIRS) for (const s of SPEEDS) {
      // Different winds at the two boats (a puff turns it 60° at the eastern one).
      fleet.updateVanes((_n, e) => uniform((d + (e > 0 ? 60 : 0)) * DEG, s)(), s, 1000 + d + s);
      expect(off(vaneBearing(fleet, 0), d * DEG), `west ${d}° ${s}`).toBeLessThan(VANE);
      expect(off(vaneBearing(fleet, 1), (d + 60) * DEG), `east ${d}° ${s}`).toBeLessThan(VANE);
    }
  });

  it('a moving boat\'s flag follows the apparent wind, not the true wind', () => {
    const view = new TrafficView();
    const cam = new THREE.PerspectiveCamera();
    // Heading north at 5 m/s, a 3 m/s true wind from the east: the apparent wind comes from about 031°.
    const trueFrom = 90 * DEG;
    view.update([state({ heading: 0, sog: 5 })], 1.2, cam, false, { fromDir: 0, speed: 1, at: uniform(trueFrom, 3) });
    const flag = view.group.getObjectByName('ensign')!.getObjectByName('ensign-flag')!;
    const app = apparentWind({ fromDir: trueFrom, speed: 3 }, 0, 5);
    expect(app.fromDir / DEG).toBeCloseTo(31, 0);
    expect(off(flyBearing(flag), downwind(app.fromDir))).toBeLessThan(RIGID);
    expect(off(flyBearing(flag), downwind(trueFrom))).toBeGreaterThan(45);
    // The Squib's burgee reads the physics' apparent wind (src/render/squibModel.ts): given it, it flies with it too.
    const { b, flag: bf } = squibBurgee(0);
    b.update(app.fromDir, app.speed, 1.2);
    expect(off(flyBearing(bf), downwind(app.fromDir))).toBeLessThan(CLOTH);
  });
});

describe('flutter', () => {
  it('rises with the wind and is near nothing in a calm', () => {
    const amps = [0, 0.5, 1, 2, 4, 6, 9, 14].map((s) => flagFlutter(s, false).amp);
    expect(amps[0]).toBe(0);
    expect(amps[1]).toBeLessThan(0.02);
    for (let i = 1; i < amps.length; i++) expect(amps[i]!).toBeGreaterThan(amps[i - 1]!);
    expect(amps.at(-1)!).toBeGreaterThan(0.95);
    const f = [0, 4, 10].map((s) => flagFlutter(s, false).freq);
    expect(f[1]!).toBeGreaterThan(f[0]!);
    expect(f[2]!).toBeGreaterThan(f[1]!);
  });

  it('a cloth flag ripples more as the wind rises, and hangs still in a calm', () => {
    const ripple = (s: number) => {
      const { b, flag } = squibBurgee(0);
      let worst = 0;
      for (let t = 0; t < 3; t += 0.13) {
        b.update(Math.PI / 3, s, t);
        worst = Math.max(worst, clothRipple(flag));
      }
      return worst;
    };
    const r = [0, 1, 3, 6, 10].map(ripple);
    expect(r[0]).toBeLessThan(1e-6);
    for (let i = 1; i < r.length; i++) expect(r[i]!).toBeGreaterThan(r[i - 1]!);
  });

  it('a rigid flag swings about the downwind line more as the wind rises, not at all in a calm', () => {
    const swing = (s: number) => {
      const en = new ClubEnsign([0, 0], 0, 10);
      const pivot = en.group.children[0]!;
      const ys: number[] = [];
      for (let t = 0; t < 6; t += 0.07) {
        en.update(DAY, { fromDir: 1, speed: s }, t);
        ys.push(pivot.rotation.y);
      }
      return Math.max(...ys) - Math.min(...ys);
    };
    const r = [0, 1, 4, 10].map(swing);
    expect(r[0]).toBeLessThan(1e-9);
    for (let i = 1; i < r.length; i++) expect(r[i]!).toBeGreaterThan(r[i - 1]!);
  });

  it('with reduced motion: the direction still follows the wind; the flutter is cut', () => {
    const run = () => {
      const { b, flag } = squibBurgee(0.5);
      let worst = 0;
      let dirOff = 0;
      for (let t = 0; t < 3; t += 0.13) {
        b.update(2 - 0.5, 8, t);
        worst = Math.max(worst, clothRipple(flag));
        dirOff = Math.max(dirOff, off(flyBearing(flag), downwind(2)));
      }
      return { worst, dirOff };
    };
    const full = run();
    setFlagMotionReduced(true);
    expect(flagFlutter(8).amp).toBeCloseTo(flagFlutter(8, false).amp * REDUCED_FLUTTER, 12);
    const reduced = run();
    expect(reduced.dirOff).toBeLessThan(10);
    expect(reduced.worst).toBeLessThan(full.worst * 0.3);
    expect(reduced.worst).toBeGreaterThan(0);
  });
});
