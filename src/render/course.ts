import * as THREE from 'three';
import type { ResolvedCourse } from '../sim/course/course';
import type { Course } from '../sim/course/types';
import { makeLabel } from './labels';

/**
 * Course marks and lines on the water (floating at y = 0): inflatable marks, the pin and the committee boat,
 * the start and finish lines (dashed), lane boundaries, and a ring on the next mark.
 */
export class CourseScene {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly labels: THREE.Sprite[] = [];
  private readonly lines: THREE.Object3D[] = [];

  constructor(private readonly r: ResolvedCourse, course: Course) {
    this.group.name = 'course';
    const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.55 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.55 });
    for (const m of course.marks) {
      const p = r.pos.get(m.id)!;
      const g = new THREE.Group();
      g.position.set(p.e, 0, -p.n);
      g.name = 'course-mark';
      if (m.kind === 'committee-boat') {
        const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 }));
        hull.position.y = 0.3;
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 3), new THREE.MeshStandardMaterial({ color: 0xdcdcd6 }));
        cabin.position.set(0, 1.5, 0.5);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4), new THREE.MeshStandardMaterial({ color: 0x999999 }));
        pole.position.set(0, 3, -2);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide }));
        flag.position.set(0.6, 4.6, -2);
        g.add(hull, cabin, pole, flag);
      } else if (m.kind === 'virtual') {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.2, 10), yellow);
        post.position.y = 0.4;
        g.add(post);
      } else if (m.kind === 'pin') {
        const buoy = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 10), orange);
        buoy.position.y = 0.2;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4), new THREE.MeshStandardMaterial({ color: 0x777777 }));
        pole.position.y = 1.4;
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide }));
        flag.position.set(0.3, 2.4, 0);
        g.add(buoy, pole, flag);
      } else {
        // Inflatable racing mark (cylinder, ~1.2 m across, ~1.8 m high).
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 1.8, 20), orange);
        body.position.y = 0.6;
        g.add(body);
      }
      this.group.add(g);
      const lab = makeLabel(m.name, '#ffd8b8');
      lab.position.set(p.e, m.kind === 'committee-boat' ? 7 : 4, -p.n);
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

  update(nextLeg: number, phase: string, showLabels: boolean, time: number): void {
    const leg = this.r.legs[nextLeg];
    this.ring.visible = phase === 'racing' && !!leg;
    if (leg) {
      this.ring.position.set(leg.target.e, 0.12, -leg.target.n);
      this.ring.scale.setScalar(leg.points.length > 1 ? Math.max(1, Math.hypot(leg.points[0]!.n - leg.points[1]!.n, leg.points[0]!.e - leg.points[1]!.e) / 9) : 1 + 0.08 * Math.sin(time * 3));
    }
    for (const l of this.labels) l.visible = showLabels;
  }
}
