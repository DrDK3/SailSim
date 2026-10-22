import * as THREE from 'three';
import type { BoatSnapshot } from '../sim/simulation';

const N_PER_M = 120; // force arrows: 1 m per 120 N
const WIND_SCALE = 0.8; // wind arrows: 0.8 m per m/s

/**
 * Debug overlay: physics forces drawn at their application points (body frame), plus true and apparent
 * wind and ground velocity (world frame). Forces are horizontal components from the simulation.
 */
export class ForceArrows {
  readonly bodyGroup = new THREE.Group();
  readonly worldGroup = new THREE.Group();
  private readonly a: Record<string, THREE.ArrowHelper> = {};

  constructor() {
    const mk = (name: string, color: number, world = false) => {
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, color, 0.35, 0.2);
      arrow.name = name;
      (world ? this.worldGroup : this.bodyGroup).add(arrow);
      this.a[name] = arrow;
    };
    mk('main', 0xff3b30);
    mk('jib', 0xff9500);
    mk('keel', 0x34c759);
    mk('rudder', 0x00c7be);
    mk('hull', 0x8e8e93);
    mk('total', 0xffffff);
    mk('trueWind', 0x007aff, true);
    mk('apparentWind', 0xaf52de, true);
    mk('velocity', 0xffcc00, true);
  }

  set visible(v: boolean) {
    this.bodyGroup.visible = v;
    this.worldGroup.visible = v;
  }

  /** Body force (x fwd, y stbd) → model frame (x stbd, z aft). */
  private setBody(name: string, fx: number, fy: number, at: THREE.Vector3): void {
    const arrow = this.a[name]!;
    const v = new THREE.Vector3(fy, 0, -fx);
    const len = v.length() / N_PER_M;
    arrow.visible = len > 0.05;
    if (!arrow.visible) return;
    arrow.position.copy(at);
    arrow.setDirection(v.normalize());
    arrow.setLength(len, Math.min(0.5, len * 0.3), Math.min(0.3, len * 0.2));
  }

  private setWorld(name: string, vn: number, ve: number, at: THREE.Vector3): void {
    const arrow = this.a[name]!;
    const v = new THREE.Vector3(ve, 0, -vn);
    const len = v.length() * WIND_SCALE;
    arrow.visible = len > 0.05;
    if (!arrow.visible) return;
    arrow.position.copy(at);
    arrow.setDirection(v.normalize());
    arrow.setLength(len, Math.min(0.8, len * 0.25), Math.min(0.5, len * 0.15));
  }

  update(s: BoatSnapshot, anchors: { mainCE: THREE.Vector3; jibCE: THREE.Vector3; keel: THREE.Vector3; rudder: THREE.Vector3; bow: THREE.Vector3 }, boatPos: THREE.Vector3): void {
    const f = s.forces;
    this.setBody('main', f.main.x, f.main.y, anchors.mainCE);
    this.setBody('jib', f.jib.x, f.jib.y, anchors.jibCE);
    this.setBody('keel', f.lateral.x, f.lateral.y, anchors.keel);
    this.setBody('rudder', f.rudder.x, f.rudder.y, anchors.rudder);
    this.setBody('hull', f.hull.x, f.crossFlow.y, anchors.bow);
    this.setBody('total', f.total.x, f.total.y, new THREE.Vector3(0, 0.8, 0));
    const top = boatPos.clone().add(new THREE.Vector3(0, 9.5, 0));
    // True wind over ground, apparent wind (in world frame), and velocity over ground.
    const c = Math.cos(s.heading);
    const sn = Math.sin(s.heading);
    const awN = f.aw.ax * c - f.aw.ay * sn;
    const awE = f.aw.ax * sn + f.aw.ay * c;
    const twN = awN + f.groundVelocity.n;
    const twE = awE + f.groundVelocity.e;
    this.setWorld('trueWind', twN, twE, top);
    this.setWorld('apparentWind', awN, awE, top.clone().add(new THREE.Vector3(0, 0.6, 0)));
    this.setWorld('velocity', f.groundVelocity.n, f.groundVelocity.e, boatPos.clone().add(new THREE.Vector3(0, 0.2, 0)));
  }
}
