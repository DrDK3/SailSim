import type { BoatSnapshot } from '../sim/simulation';
import type { FleetPose } from '../render/fleet';

/**
 * Ghost racing (src/app/controller.ts startGhost): the recorded boat's pose, kept every GHOST_EVERY physics steps
 * (0.1 s) and drawn between them. Pure helpers.
 */
export const GHOST_EVERY = 10;

/** A boat's pose for the fleet view, from a snapshot. */
export function poseOf(id: string, sn: BoatSnapshot): FleetPose {
  return {
    id, n: sn.n, e: sn.e, heading: sn.heading, heel: sn.heel, boomMain: sn.boomMain, boomJib: sn.boomJib,
    mainSide: sn.mainSide, jibSide: sn.jibSide, mainLuff: sn.forces.main.luff, jibLuff: sn.forces.jib.luff,
    mainAwa: sn.forces.main.aws > 0 ? sn.forces.main.awa : sn.awa, jibAwa: sn.forces.jib.aws > 0 ? sn.forces.jib.awa : sn.awa,
    rudder: sn.rudder, crewY: sn.crewY, crewTo: sn.crewTo, sailsDown: sn.damage.rig >= 1, awa: sn.awa, aws: sn.aws, water: sn.cockpitWater, stw: sn.stw,
    damage: sn.damage.version > 0 || sn.damage.state !== 'afloat' ? sn.damage : undefined,
  };
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
/** Between two angles the short way round (rad). */
const lerpAngle = (a: number, b: number, f: number) => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * f;
};

/**
 * The ghost at sample position k (fractional: steps / GHOST_EVERY): positions, angles and trim drawn smoothly between
 * the samples, the rest from the nearer one. After the recording ends she stays where it ended; undefined before.
 */
export function ghostPoseAt(poses: readonly FleetPose[], k: number): FleetPose | undefined {
  if (!poses.length || k < 0) return undefined;
  const i = Math.min(Math.floor(k), poses.length - 1);
  const a = poses[i]!;
  const b = poses[Math.min(i + 1, poses.length - 1)]!;
  const f = i + 1 < poses.length ? Math.min(1, k - i) : 0;
  const near = f < 0.5 ? a : b;
  return {
    ...near,
    id: 'ghost',
    n: lerp(a.n, b.n, f),
    e: lerp(a.e, b.e, f),
    heading: lerpAngle(a.heading, b.heading, f),
    heel: lerp(a.heel, b.heel, f),
    boomMain: lerp(a.boomMain, b.boomMain, f),
    boomJib: lerp(a.boomJib, b.boomJib, f),
    mainLuff: lerp(a.mainLuff, b.mainLuff, f),
    jibLuff: lerp(a.jibLuff, b.jibLuff, f),
    mainAwa: lerpAngle(a.mainAwa, b.mainAwa, f),
    jibAwa: lerpAngle(a.jibAwa, b.jibAwa, f),
    rudder: lerp(a.rudder, b.rudder, f),
    crewY: lerp(a.crewY, b.crewY, f),
    awa: lerpAngle(a.awa, b.awa, f),
    aws: lerp(a.aws, b.aws, f),
    water: lerp(a.water, b.water, f),
    stw: lerp(a.stw ?? 0, b.stw ?? 0, f),
  };
}
