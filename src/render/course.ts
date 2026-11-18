import * as THREE from 'three';
import type { ResolvedCourse } from '../sim/course/course';
import type { Course } from '../sim/course/types';
import { makeLabel } from './labels';
import { robotMark, sponsorsFor } from './robotMark';
import { samaritanModel } from './samaritan';
import { flagSwing, trueWindAt, type FlagWind, type WindAt } from './flagMotion';
import { flagDroop, flagYaw } from './vane';
import { easeRide, orientBoat, rideWaves, type WaveRide } from './frames';
import { SAMARITAN } from './samaritan';

/**
 * Course marks and lines on the water (floating at y = 0): robotic marks (src/render/robotMark.ts) for the
 * turning marks and the pin, each with a sponsor's name, lying head to wind; the committee boat, SAMARITAN
 * (src/render/samaritan.ts), at anchor head to wind; the start and finish lines (dashed), lane boundaries, and a
 * ring on the next mark.
 */
export class CourseScene {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly labels: THREE.Sprite[] = [];
  private readonly lines: THREE.Object3D[] = [];
  /** The robotic marks, each with a phase for its gentle bob. */
  private readonly robots: { g: THREE.Group; phase: number }[] = [];
  /** The committee boats, at anchor at their marks: they lie as the simulation says (`setCommitteeHeading`). */
  private laylines?: readonly { tack: 'starboard' | 'port'; from: { n: number; e: number }; to: { n: number; e: number } }[];
  private readonly layObjs: { line: THREE.LineSegments }[] = [];
  private readonly committee: { boat: THREE.Object3D; n: number; e: number; heading: number; flag?: THREE.Object3D; ride: WaveRide; rideStarted: boolean }[] = [];
  /** The pin ends' flags: their marks' positions (local n, e) and the flag pivots. */
  private readonly pinFlags: { n: number; e: number; pivot: THREE.Object3D }[] = [];
  /** The wind the marks and flags answer: the one wind, and the true wind at a point (flagMotion.ts). */
  private wind: FlagWind = { fromDir: 0, speed: 5 };
  private windAt?: WindAt;

  /**
   * `realMarks`: buoys the harbour scene already draws (src/render/dart.ts). A course mark on one of them (a club
   * course rounding Homestone, say) gets only its label and highlight here, not a second, orange buoy.
   */
  constructor(private readonly r: ResolvedCourse, course: Course, realMarks: readonly { n: number; e: number }[] = []) {
    this.group.name = 'course';
    const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.55 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.55 });
    const sponsors = sponsorsFor(course.marks.filter((m) => m.kind === 'inflatable' || m.kind === 'pin').map((m) => m.id), course.id);
    for (const m of course.marks) {
      const p = r.pos.get(m.id)!;
      const g = new THREE.Group();
      g.position.set(p.e, 0, -p.n);
      g.name = 'course-mark';
      if (m.kind === 'committee-boat') {
        const boat = samaritanModel();
        boat.name = 'committee-boat';
        g.add(boat);
        this.committee.push({ boat, n: p.n, e: p.e, heading: 0, flag: boat.getObjectByName('committee-flag'), ride: { heave: 0, pitch: 0, roll: 0 }, rideStarted: false });
      } else if (m.kind === 'virtual') {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.2, 10), yellow);
        post.position.y = 0.4;
        g.add(post);
      } else if (m.kind === 'pin' || m.kind === 'inflatable') {
        // A robotic mark; the pin end flies a flag from its mast.
        const robot = robotMark(0xff7a1a, sponsors.get(m.id)!, m.kind === 'pin' ? 0xff7a1a : undefined);
        g.add(robot);
        this.robots.push({ g: robot, phase: this.robots.length * 1.7 });
        const pivot = robot.getObjectByName('robot-mark-flag-pivot');
        if (pivot) this.pinFlags.push({ n: p.n, e: p.e, pivot });
      } else if (!realMarks.some((q) => Math.hypot(q.n - p.n, q.e - p.e) < 5)) {
        // Navigation buoys and fixed marks used as course marks (where no real buoy is drawn).
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 1.8, 20), orange);
        body.position.y = 0.6;
        g.add(body);
      }
      this.group.add(g);
      const lab = makeLabel(m.name, '#ffd8b8');
      lab.position.set(p.e, m.kind === 'committee-boat' ? 15.5 : 4, -p.n);
      // Marks in line from the boat (the top mark beyond the bottom one) would print their labels over each
      // other: each sits 0, 1 or 2 label heights up on the screen (owner's screenshot, 1 Nov 2026).
      lab.center.set(0.5, 0.5 - 1.25 * (this.labels.length % 3));
      this.labels.push(lab);
      this.group.add(lab);
    }
    const dashed = (a: { n: number; e: number }, b: { n: number; e: number }, color: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.e, 0.15, -a.n), new THREE.Vector3(b.e, 0.15, -b.n)]);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.85 }));
      line.computeLineDistances();
      line.name = 'course-line';
      this.lines.push(line);
      this.group.add(line);
    };
    dashed(r.start[0], r.start[1], 0xffffff);
    if (r.finish[0] !== r.start[0] || r.finish[1] !== r.start[1]) dashed(r.finish[0], r.finish[1], 0x9fe6ff);
    for (const b of r.boundaries) dashed(b.a, b.b, 0xffd23f);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(4.5, 5.2, 40), new THREE.MeshBasicMaterial({ color: 0x5fe08a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.name = 'next-mark';
    this.group.add(this.ring);
  }

  /**
   * `waves` (optional): the drawn sea's surface height at a Three.js (x, z), and the frame's length (s). With it the
   * committee boats ride the waves as the boats do (owner, 18 Nov 2026: "The committee boat is not moving up and down
   * with the motion of the wave").
   */
  update(nextLeg: number, phase: string, showLabels: boolean, time: number, waves?: { height: (x: number, z: number) => number; dt: number }): void {
    const leg = this.r.legs[nextLeg];
    this.ring.visible = phase === 'racing' && !!leg;
    if (leg) {
      this.ring.position.set(leg.target.e, 0.12, -leg.target.n);
      this.ring.scale.setScalar(leg.points.length > 1 ? Math.max(1, Math.hypot(leg.points[0]!.n - leg.points[1]!.n, leg.points[0]!.e - leg.points[1]!.e) / 9) : 1 + 0.08 * Math.sin(time * 3));
    }
    for (const l of this.labels) l.visible = showLabels;
    // The robotic marks ride the chop a little.
    for (const r of this.robots) {
      r.g.position.y = 0.04 * Math.sin(time * 1.3 + r.phase);
      r.g.rotation.x = 0.035 * Math.sin(time * 1.1 + r.phase * 1.3);
      r.g.rotation.z = 0.03 * Math.sin(time * 0.9 + r.phase * 0.7);
    }
    // Flags at anchor fly in the true wind where they are (the robots hold station, the committee boat is anchored):
    // downwind, swinging as they flutter, limp in a calm.
    for (const f of this.pinFlags) {
      const w = trueWindAt(this.windAt, f.n, f.e, this.wind);
      const { yaw, aws } = flagYaw(w.fromDir, w.speed, this.wind.fromDir, 0);
      f.pivot.rotation.set(0, yaw + flagSwing(aws, time, f.e), 0);
      f.pivot.children[0]!.rotation.z = -flagDroop(aws);
    }
    this.drawLaylines(waves?.height ?? FLAT);
    // The committee boats float on the drawn sea: heave, pitch and roll from the surface over their waterplane (eased
    // for a hull's inertia), visual only. Her waterplane is sampled over her own length, so short chop pitches her less
    // than a Squib (SAMARITAN is 10.8 m; the samples are a Squib's 5.8 m: E).
    for (const c of this.committee) {
      if (waves) {
        easeRide(c.ride, rideWaves(waves.height, c.e, -c.n, c.heading, RIDE_SCRATCH, SAMARITAN.loa / 5.8), waves.dt, !c.rideStarted);
        c.rideStarted = true;
      }
      c.boat.position.y = c.ride.heave;
      orientBoat(c.boat, c.heading, c.ride.roll, c.ride.pitch);
    }
    for (const c of this.committee) {
      if (!c.flag) continue;
      const w = trueWindAt(this.windAt, c.n, c.e, this.wind);
      const { yaw, aws } = flagYaw(w.fromDir, w.speed, c.heading, 0);
      c.flag.rotation.set(0, yaw + flagSwing(aws, time, c.e), 0);
      c.flag.children[0]!.rotation.z = -flagDroop(aws);
    }
  }

  /**
   * The robotic marks hold station head to wind (`fromDir`, rad, compass: where the wind comes from). `windAt`
   * (the true wind at a point, read only) and `speed` (m/s) fly the flags; without `windAt` they read `fromDir`.
   */
  setWind(fromDir: number, windAt?: WindAt, speed = 5): void {
    for (const r of this.robots) r.g.rotation.y = -fromDir;
    this.wind = { fromDir, speed };
    this.windAt = windAt;
  }

  /**
   * The laylines to the next mark (src/app/raceAids.ts), or none: two lines on the water from the mark, riding the
   * waves; the starboard-tack line green and solid, the port-tack line red and dashed (never colour alone).
   */
  setLaylines(lines?: readonly { tack: 'starboard' | 'port'; from: { n: number; e: number }; to: { n: number; e: number } }[]): void {
    this.laylines = lines;
    for (const l of this.layObjs) l.line.visible = false;
    if (!lines) return;
    lines.forEach((l, i) => {
      let o = this.layObjs[i];
      if (!o) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LAY_SEGMENTS * 2 * 3), 3));
        const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }));
        line.frustumCulled = false;
        line.name = 'layline';
        this.group.add(line);
        o = { line };
        this.layObjs[i] = o;
      }
      const stbd = l.tack === 'starboard';
      const m = o.line.material as THREE.LineBasicMaterial;
      m.color.setHex(stbd ? 0x5fe08a : 0xff6b5e);
      o.line.userData.tack = l.tack;
      o.line.visible = true;
    });
  }

  /** Lay the laylines' points on the water now (called from update with the sea's height). */
  private drawLaylines(height: (x: number, z: number) => number): void {
    const lines = this.laylines;
    if (!lines) return;
    lines.forEach((l, i) => {
      const o = this.layObjs[i];
      if (!o) return;
      const pos = o.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      // Short stretches, each laid on the water where it is; the port-tack line is dashed (every other stretch left out).
      const dashed = l.tack === 'port';
      const put = (k: number, f: number) => {
        const x = l.to.e + (l.from.e - l.to.e) * f;
        const z = -(l.to.n + (l.from.n - l.to.n) * f);
        pos.setXYZ(k, x, height(x, z) + 0.12, z);
      };
      for (let k = 0; k < LAY_SEGMENTS; k++) {
        const a = k / LAY_SEGMENTS;
        put(2 * k, a);
        put(2 * k + 1, dashed && k % 2 === 1 ? a : (k + 1) / LAY_SEGMENTS);
      }
      pos.needsUpdate = true;
    });
  }

  /**
   * The committee boats' headings (rad, compass) at their marks, from the simulation (src/sim/race/anchored.ts):
   * the hull drawn is the hull boats hit. The bow (−z in the model) points along the heading.
   */
  setCommitteeHeading(headingAt: (n: number, e: number) => number): void {
    for (const c of this.committee) {
      c.heading = headingAt(c.n, c.e);
      orientBoat(c.boat, c.heading, c.ride.roll, c.ride.pitch);
    }
  }
}

const RIDE_SCRATCH: WaveRide = { heave: 0, pitch: 0, roll: 0 };
/** Stretches along each layline (each follows the waves). */
const LAY_SEGMENTS = 64;
const FLAT = () => 0;
