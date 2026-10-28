import * as THREE from 'three';
import { ACT, gaitRate, peopleMesh, peopleTime, setMotion, statureScale } from './people';
import { createRng } from '../sim/math/rng';

/**
 * Street life: the roads and footways (OSM via Overture, public/geo/roads.json) drawn on the ground, cars
 * driving on them (on the left) and parked in the town streets, and people walking the footways and
 * pavements and standing on the quays and pontoons. The roads are data (S); their widths, and all the cars
 * and people (numbers, colours, speeds, where they go), are illustrative (E).
 */

/** roads.json: class code (manifest `roads.classes`), polyline [e, n][] (local metres), name. */
export interface RoadsData {
  roads: { c: string; l: [number, number][]; n?: string }[];
}

/** Carriageway or path width by class (m, E). */
export const ROAD_WIDTH: Record<string, number> = { p: 6.5, s: 6, t: 5.5, u: 4.5, r: 4.5, l: 4, v: 3, w: 4, f: 1.8, x: 1.5 };
/** Classes cars drive on, with a town speed for each (m/s, E: 30 mph on the A379, 20 mph in the streets). */
export const CAR_SPEED: Record<string, number> = { p: 12, s: 10, t: 9, u: 8, r: 7, l: 4.5 };
/** Classes people walk on: footways, pedestrian streets and steps; and the pavements of town streets. */
const WALK = new Set(['f', 'w', 'x']);
const PAVEMENT = new Set(['r', 'l', 't', 's', 'p']);
/** The two towns, where most cars park and people walk (local metres, E). */
export const TOWNS = [
  { name: 'Dartmouth', eMin: -720, eMax: -180, nMin: -40, nMax: 1000 },
  { name: 'Kingswear', eMin: -60, eMax: 420, nMin: -220, nMax: 420 },
] as const;
const inTown = (e: number, n: number) => TOWNS.some((t) => e >= t.eMin && e <= t.eMax && n >= t.nMin && n <= t.nMax);

const CAR_COLOURS = [0xf2f2f0, 0xb9bcc0, 0x1d1f22, 0x24324a, 0x8e1c1c, 0x5c6066, 0x2f4a35, 0x6b7f99, 0xd9d2c4];
const SHIRT_COLOURS = [0x2c4f7c, 0xc0392b, 0xf1f1ee, 0x2d6a4f, 0xe5a823, 0x3b3b3b, 0x8e6fb5, 0xd35d6e, 0x5c8fa8, 0xb07d48];

interface Seg {
  c: string;
  pts: [number, number][];
  /** Cumulative length at each point. */
  cum: number[];
  len: number;
  /** Node keys at the two ends (for the road graph). */
  a: string;
  b: string;
}

function makeSeg(c: string, l: [number, number][]): Seg {
  const cum = [0];
  for (let i = 1; i < l.length; i++) cum.push(cum[i - 1]! + Math.hypot(l[i]![0] - l[i - 1]![0], l[i]![1] - l[i - 1]![1]));
  const key = (p: [number, number]) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  return { c, pts: l, cum, len: cum[cum.length - 1]!, a: key(l[0]!), b: key(l[l.length - 1]!) };
}

/** Point and unit direction at distance s along a segment. */
export function along(seg: Seg, s: number): { e: number; n: number; de: number; dn: number } {
  const x = Math.max(0, Math.min(seg.len, s));
  let i = 1;
  while (i < seg.cum.length - 1 && seg.cum[i]! < x) i++;
  const p0 = seg.pts[i - 1]!;
  const p1 = seg.pts[i]!;
  const l = seg.cum[i]! - seg.cum[i - 1]! || 1;
  const f = (x - seg.cum[i - 1]!) / l;
  return { e: p0[0] + (p1[0] - p0[0]) * f, n: p0[1] + (p1[1] - p0[1]) * f, de: (p1[0] - p0[0]) / l, dn: (p1[1] - p0[1]) / l };
}

// ------------------------------------------------------------------ road surfaces

/**
 * The road surfaces: a ribbon for each segment at the ground (resampled every 4 m so it follows the slope),
 * tarmac for roads with dashed centre lines on the main ones, paving or gravel for paths. Steps are left to
 * the ground picture.
 */
export function buildRoadSurfaces(data: RoadsData, groundAt: (e: number, n: number) => number): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const road: number[] = [];
  const idx: number[] = [];
  const lin = (hex: number) => {
    const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
    return [c.r, c.g, c.b];
  };
  const TARMAC = lin(0x3d4043);
  const PAVING = lin(0x8f8b84);
  const GRAVEL = lin(0x9a8e76);
  for (const r of data.roads) {
    if (r.c === 'x' || r.l.length < 2) continue;
    const w = (ROAD_WIDTH[r.c] ?? 3) / 2;
    const isPath = r.c === 'f' || r.c === 'w';
    const colour = isPath ? (inTown(r.l[0]![0], r.l[0]![1]) ? PAVING : GRAVEL) : TARMAC;
    const dashed = r.c === 'p' || r.c === 's' || r.c === 't' ? 1 : 0;
    // Resample every 4 m.
    const seg = makeSeg(r.c, r.l);
    const steps = Math.max(1, Math.ceil(seg.len / 4));
    const base = pos.length / 3;
    for (let k = 0; k <= steps; k++) {
      const s = (seg.len * k) / steps;
      const p = along(seg, s);
      // Mitred joins: average the directions either side of a vertex.
      const q = along(seg, Math.min(seg.len, s + 0.5));
      const o = along(seg, Math.max(0, s - 0.5));
      let de = q.e - o.e;
      let dn = q.n - o.n;
      const dl = Math.hypot(de, dn) || 1;
      de /= dl;
      dn /= dl;
      const le = -dn;
      const ln = de;
      for (const side of [-1, 1]) {
        const e = p.e + le * w * side;
        const n = p.n + ln * w * side;
        pos.push(e, groundAt(e, n) + 0.12, -n);
        col.push(...colour);
        road.push(s, side, dashed);
      }
      if (k > 0) {
        const i0 = base + (k - 1) * 2;
        idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aRoad', new THREE.Float32BufferAttribute(road, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoad;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Dashed white centre line on the main roads (4 m dash, 5 m gap); worn edges.
        float dash = vRoad.z * step(abs(vRoad.y), 0.035) * step(fract(vRoad.x / 9.0), 0.45);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.85, 0.8), dash);
        diffuseColor.rgb *= 0.9 + 0.1 * smoothstep(1.0, 0.8, abs(vRoad.y));`,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'roads';
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ models

function merge(parts: { geo: THREE.BufferGeometry; colour: number }[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  for (const { geo, colour } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const c = new THREE.Color().setHex(colour, THREE.SRGBColorSpace);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

const box = (w: number, h: number, l: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, l).translate(x, y, z);

/** A small car (about 4.2 m by 1.8 m), bow to -z; the body takes the instance colour, glass and tyres stay dark. */
export function carGeometry(): THREE.BufferGeometry {
  const wheel = (x: number, z: number) => new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10).rotateZ(Math.PI / 2).translate(x, 0.32, z);
  return merge([
    { geo: box(1.76, 0.62, 4.2, 0, 0.62, 0), colour: 0xffffff },
    { geo: box(1.56, 0.5, 2.2, 0, 1.18, 0.25), colour: 0xffffff },
    { geo: box(1.6, 0.36, 2.0, 0, 1.17, 0.25), colour: 0x1a1f24 },
    { geo: box(1.5, 0.3, 0.05, 0, 0.62, -2.11), colour: 0xeeeeea },
    { geo: wheel(-0.82, -1.35), colour: 0x151515 },
    { geo: wheel(0.82, -1.35), colour: 0x151515 },
    { geo: wheel(-0.82, 1.35), colour: 0x151515 },
    { geo: wheel(0.82, 1.35), colour: 0x151515 },
  ]);
}

// ------------------------------------------------------------------ cars and people

interface Mover {
  seg: number;
  dir: 1 | -1;
  s: number;
  v: number;
  /** Sideways offset from the centreline, metres to the left of travel. */
  side: number;
  phase: number;
  /** Stature (of 1.68 m), for walkers. */
  scale?: number;
}

export interface StreetLifeOptions {
  roads: RoadsData;
  groundAt: (e: number, n: number) => number;
  /** Places people stand: quays (fixed, at their deck) and pontoons (floating). */
  standing?: { e: number; n: number; floating: boolean; deck: number }[];
  /** Ferry landings: where a queue forms (e, n, m) and the way to the boat (unit de, dn). */
  queues?: { e: number; n: number; de: number; dn: number }[];
  detail?: 'high' | 'low';
  seed?: number;
}

/** Moving and parked cars and people. Seeded, so a screenshot is the same each time. */
export class StreetLife {
  readonly fixed = new THREE.Group();
  readonly floating = new THREE.Group();
  private readonly segs: Seg[];
  private readonly drive: number[];
  private readonly walk: number[];
  private readonly byNode = new Map<string, number[]>();
  private readonly cars: Mover[] = [];
  private readonly walkers: Mover[] = [];
  private readonly carMesh: THREE.InstancedMesh;
  private readonly parkedMesh: THREE.InstancedMesh;
  private readonly walkerMesh: THREE.InstancedMesh;
  private readonly walkerMeshes: THREE.InstancedMesh[];
  private readonly sv = new THREE.Vector3(1, 1, 1);
  private counts0: { activities: Record<string, number> } = { activities: {} };
  private readonly standMeshes: THREE.InstancedMesh[] = [];
  private readonly rng;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3(1, 1, 1);
  private lastTime?: number;
  private daylight = 1;

  constructor(private readonly o: StreetLifeOptions) {
    this.rng = createRng(o.seed ?? 4242);
    const low = o.detail === 'low';
    this.segs = o.roads.roads.filter((r) => r.l.length >= 2).map((r) => makeSeg(r.c, r.l)).filter((s) => s.len > 3);
    this.drive = [];
    this.walk = [];
    this.segs.forEach((s, i) => {
      if (CAR_SPEED[s.c] !== undefined) {
        this.drive.push(i);
        for (const k of [s.a, s.b]) {
          const list = this.byNode.get(k) ?? [];
          list.push(i);
          this.byNode.set(k, list);
        }
      }
      if (WALK.has(s.c) || (PAVEMENT.has(s.c) && inTown(s.pts[0]![0], s.pts[0]![1]))) this.walk.push(i);
    });
    // Moving cars, more on the main roads and in the towns.
    const carWeight = (i: number) => {
      const s = this.segs[i]!;
      const town = inTown(s.pts[0]![0], s.pts[0]![1]) ? 3 : 1;
      return s.len * town * (s.c === 'p' ? 3 : s.c === 's' || s.c === 't' ? 2 : 1);
    };
    const nCars = low ? 50 : 130;
    for (let k = 0; k < nCars; k++) {
      const seg = this.pick(this.drive, carWeight);
      const s = this.segs[seg]!;
      this.cars.push({ seg, dir: this.rng.next() < 0.5 ? 1 : -1, s: this.rng.next() * s.len, v: CAR_SPEED[s.c]! * (0.8 + 0.3 * this.rng.next()), side: Math.min(1.6, ROAD_WIDTH[s.c]! / 4), phase: 0 });
    }
    const carGeo = carGeometry();
    const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 });
    this.carMesh = new THREE.InstancedMesh(carGeo, carMat, this.cars.length);
    this.carMesh.name = 'cars';
    this.cars.forEach((_, i) => this.carMesh.setColorAt(i, new THREE.Color(CAR_COLOURS[Math.floor(this.rng.next() * CAR_COLOURS.length)]!)));
    // Parked cars: along the town streets, on the left kerb, about one space in two taken.
    const parked: THREE.Matrix4[] = [];
    for (const i of this.drive) {
      const s = this.segs[i]!;
      if (!(s.c === 'r' || s.c === 'l' || s.c === 'u') || !inTown(s.pts[0]![0], s.pts[0]![1])) continue;
      for (let x = 4; x < s.len - 4; x += 6) {
        if (this.rng.next() < 0.5) continue;
        const p = along(s, x);
        const side = ROAD_WIDTH[s.c]! / 2 - 0.9;
        const e = p.e - p.dn * side;
        const n = p.n + p.de * side;
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(p.de, p.dn));
        parked.push(new THREE.Matrix4().compose(new THREE.Vector3(e, o.groundAt(e, n) + 0.05, -n), this.q.clone(), this.sc));
      }
    }
    const maxParked = low ? 200 : 600;
    while (parked.length > maxParked) parked.splice(Math.floor(this.rng.next() * parked.length), 1);
    this.parkedMesh = new THREE.InstancedMesh(carGeo, carMat, Math.max(1, parked.length));
    this.parkedMesh.name = 'parked-cars';
    parked.forEach((mm, i) => {
      this.parkedMesh.setMatrixAt(i, mm);
      this.parkedMesh.setColorAt(i, new THREE.Color(CAR_COLOURS[Math.floor(this.rng.next() * CAR_COLOURS.length)]!));
    });
    this.parkedMesh.count = parked.length;
    // Walkers on the footways and the town pavements: three looks (skin, hair, trousers), shirts in the
    // instance colour, heights 1.55-1.80 m, striding at their own pace (the shader animates the gait).
    const nWalk = low ? 120 : 320;
    const walkWeight = (i: number) => this.segs[i]!.len * (inTown(this.segs[i]!.pts[0]![0], this.segs[i]!.pts[0]![1]) ? 6 : 1);
    for (let k = 0; k < nWalk && this.walk.length; k++) {
      const seg = this.pick(this.walk, walkWeight);
      const s = this.segs[seg]!;
      const pave = PAVEMENT.has(s.c) ? ROAD_WIDTH[s.c]! / 2 + 0.7 : 0.3;
      this.walkers.push({ seg, dir: this.rng.next() < 0.5 ? 1 : -1, s: this.rng.next() * s.len, v: 1.1 + 0.5 * this.rng.next(), side: (this.rng.next() < 0.5 ? 1 : -1) * pave, phase: this.rng.next() * 6.28, scale: statureScale(this.rng.next()) });
    }
    const looks = 3;
    this.walkerMeshes = Array.from({ length: looks }, (_, v) => peopleMesh(Math.ceil(this.walkers.length / looks), v, 'walkers'));
    this.walkers.forEach((w, i) => {
      const mesh = this.walkerMeshes[i % looks]!;
      const j = Math.floor(i / looks);
      mesh.setColorAt(j, new THREE.Color(SHIRT_COLOURS[Math.floor(this.rng.next() * SHIRT_COLOURS.length)]!));
      setMotion(mesh, j, w.phase, gaitRate(w.v, w.scale), ACT.walk, this.rng.next());
    });
    this.walkerMesh = this.walkerMeshes[0]!;
    // People standing about on the quays (with the land) and the pontoons (floating with the tide), doing
    // things: chatting in twos and threes, watching the river from the rail, sitting on benches facing it,
    // or just standing; and queues at the ferry landings.
    const placed = placePeople(o, this.rng);
    for (const floating of [false, true]) {
      const list = placed.people.filter((x) => x.floating === floating);
      if (!list.length) continue;
      const meshes = Array.from({ length: looks }, (_, v) => peopleMesh(Math.ceil(list.length / looks), v + 1, floating ? 'people-on-pontoons' : 'people-on-quays'));
      list.forEach((x, i) => {
        const mesh = meshes[i % looks]!;
        const j = Math.floor(i / looks);
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -x.facing);
        mesh.setMatrixAt(j, new THREE.Matrix4().compose(new THREE.Vector3(x.e, x.y, -x.n), this.q.clone(), new THREE.Vector3(x.scale, x.scale, x.scale)));
        mesh.setColorAt(j, new THREE.Color(SHIRT_COLOURS[Math.floor(this.rng.next() * SHIRT_COLOURS.length)]!));
        setMotion(mesh, j, 0, 0, x.act, this.rng.next());
      });
      for (const m of meshes) {
        (floating ? this.floating : this.fixed).add(m);
        this.standMeshes.push(m);
      }
    }
    if (placed.benches.length) {
      const bench = new THREE.InstancedMesh(benchGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), placed.benches.length);
      bench.name = 'benches';
      placed.benches.forEach((b, i) => {
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b.facing);
        bench.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(b.e, b.y, -b.n), this.q.clone(), this.sc));
      });
      bench.receiveShadow = true;
      this.fixed.add(bench);
    }
    this.counts0 = { activities: placed.activities };
    for (const mesh of [this.carMesh, this.parkedMesh, ...this.walkerMeshes]) {
      mesh.frustumCulled = false;
      mesh.castShadow = !low && !this.walkerMeshes.includes(mesh);
      this.fixed.add(mesh);
    }
  }

  private pick(list: number[], weight: (i: number) => number): number {
    let total = 0;
    for (const i of list) total += weight(i);
    let r = this.rng.next() * total;
    for (const i of list) {
      r -= weight(i);
      if (r <= 0) return i;
    }
    return list[list.length - 1]!;
  }

  /** 0 at night … 1 by day: fewer cars and people after dark. */
  setDaylight(day: number): void {
    this.daylight = day;
  }

  /** Move the cars and walkers on by the frame's time (s); far ones are not drawn. */
  update(time: number, camera: THREE.Camera): void {
    const dt = this.lastTime === undefined ? 0 : Math.max(0, Math.min(0.25, time - this.lastTime));
    this.lastTime = time;
    const cam = camera.position;
    const activeCars = Math.round(this.cars.length * (0.25 + 0.75 * this.daylight));
    this.cars.forEach((c, i) => {
      this.advance(c, dt, true);
      this.place(this.carMesh, i, c, 0.05, i < activeCars, cam, 1500);
    });
    this.carMesh.instanceMatrix.needsUpdate = true;
    const activeWalk = Math.round(this.walkers.length * (0.15 + 0.85 * this.daylight));
    const looks = this.walkerMeshes.length;
    this.walkers.forEach((w, i) => {
      this.advance(w, dt, false);
      this.place(this.walkerMeshes[i % looks]!, Math.floor(i / looks), w, 0, i < activeWalk, cam, 450, w.scale);
    });
    for (const m of this.walkerMeshes) m.instanceMatrix.needsUpdate = true;
    peopleTime.value = time;
  }

  /** On along the segment; at its end, on to a connected road (cars) or back the way they came (walkers). */
  private advance(x: Mover, dt: number, car: boolean): void {
    x.s += x.dir * x.v * dt;
    const seg = this.segs[x.seg]!;
    if (x.s >= 0 && x.s <= seg.len) return;
    const end = x.s > seg.len ? seg.b : seg.a;
    const over = x.s > seg.len ? x.s - seg.len : -x.s;
    const next = car ? (this.byNode.get(end) ?? []).filter((j) => j !== x.seg) : [];
    if (!next.length) {
      // A dead end or a path's end: turn round.
      x.dir = x.dir === 1 ? -1 : 1;
      x.s = x.s > seg.len ? seg.len - over : over;
      return;
    }
    const j = next[Math.floor(this.rng.next() * next.length)]!;
    const ns = this.segs[j]!;
    x.seg = j;
    if (ns.a === end) {
      x.dir = 1;
      x.s = Math.min(over, ns.len);
    } else {
      x.dir = -1;
      x.s = Math.max(0, ns.len - over);
    }
    x.v = CAR_SPEED[ns.c]! * (0.8 + 0.3 * this.rng.next());
    x.side = Math.min(1.6, ROAD_WIDTH[ns.c]! / 4);
  }

  private place(mesh: THREE.InstancedMesh, i: number, x: Mover, lift: number, active: boolean, cam: THREE.Vector3, range: number, scale = 1): void {
    const seg = this.segs[x.seg]!;
    const p = along(seg, x.s);
    const de = p.de * x.dir;
    const dn = p.dn * x.dir;
    // Keep left: the left of travel is (-dn, de).
    const e = p.e - dn * x.side;
    const n = p.n + de * x.side;
    const far = (e - cam.x) ** 2 + (-n - cam.z) ** 2 > range * range;
    if (!active || far) {
      this.m.makeScale(0, 0, 0);
      mesh.setMatrixAt(i, this.m);
      return;
    }
    // The models face -z: a turn of -atan2(de, dn) about y points them along (de, dn).
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), -Math.atan2(de, dn));
    this.m.compose(this.v.set(e, this.o.groundAt(e, n) + lift, -n), this.q, this.sv.set(scale, scale, scale));
    mesh.setMatrixAt(i, this.m);
  }

  get counts(): { cars: number; parked: number; walkers: number; standing: number; activities: Record<string, number> } {
    return { cars: this.cars.length, parked: this.parkedMesh.count, walkers: this.walkers.length, standing: this.standMeshes.reduce((a, m) => a + m.count, 0), activities: this.counts0.activities };
  }
}

// ------------------------------------------------------------------ people about the quays

/** One person placed: where (m; y in its group's frame), which way they face (rad, compass), height, activity. */
interface Placed {
  e: number;
  n: number;
  y: number;
  floating: boolean;
  facing: number;
  scale: number;
  act: number;
}

/**
 * The compass direction from (e, n) towards the water (the lowest ground around it), for someone standing at
 * height `standY` (m ODN: a jetty's deck, or the ground), or undefined in the middle of a flat quay.
 */
function towardsWater(groundAt: (e: number, n: number) => number, e: number, n: number, standY = -Infinity): number | undefined {
  let best: number | undefined;
  let low = Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    let sum = 0;
    for (const d of [3, 6, 10]) sum += groundAt(e + Math.sin(a) * d, n + Math.cos(a) * d);
    if (sum < low) {
      low = sum;
      best = a;
    }
  }
  // Only where the water is clearly lower than here (an edge, or out on a jetty), not in the middle of a quay.
  return low / 3 < Math.max(groundAt(e, n), standY) - 1.5 ? best : undefined;
}

/**
 * What the people standing about do, from the standing spots and the ferry landings (seeded): chatting groups
 * of two or three facing each other, watchers at the edge facing the water (leaning on the rail on a quay),
 * sitters on benches facing the water (quays), others standing about; queues at the ferry landings facing the
 * boat. Illustrative (E).
 */
export function placePeople(o: Pick<StreetLifeOptions, 'standing' | 'queues' | 'groundAt'>, rng: { next(): number }): { people: Placed[]; benches: { e: number; n: number; y: number; facing: number }[]; activities: Record<string, number> } {
  const people: Placed[] = [];
  const benches: { e: number; n: number; y: number; facing: number }[] = [];
  const activities: Record<string, number> = { chatting: 0, watching: 0, sitting: 0, standing: 0, queueing: 0 };
  for (const p of o.standing ?? []) {
    const r = rng.next();
    const water = p.floating ? undefined : towardsWater(o.groundAt, p.e, p.n, p.deck);
    if (r < 0.32) {
      // A group of two or three, facing the middle.
      const k = rng.next() < 0.5 ? 2 : 3;
      const turn = rng.next() * Math.PI * 2;
      for (let i = 0; i < k; i++) {
        const a = turn + (i * 2 * Math.PI) / k;
        const rad = k === 2 ? 0.45 : 0.55;
        people.push({ e: p.e + Math.sin(a) * rad, n: p.n + Math.cos(a) * rad, y: p.deck, floating: p.floating, facing: a + Math.PI, scale: statureScale(rng.next()), act: ACT.chat });
        activities.chatting!++;
      }
    } else if (r < 0.62 && (water !== undefined || p.floating)) {
      const facing = water ?? rng.next() * Math.PI * 2;
      people.push({ e: p.e, n: p.n, y: p.deck, floating: p.floating, facing, scale: statureScale(rng.next()), act: p.floating ? ACT.idle : ACT.lean });
      activities.watching!++;
    } else if (r < 0.74 && !p.floating && water !== undefined) {
      // A bench facing the water, with one or two on it.
      benches.push({ e: p.e, n: p.n, y: p.deck, facing: water });
      const two = rng.next() < 0.5;
      for (const off of two ? [-0.35, 0.35] : [0]) {
        people.push({ e: p.e + Math.cos(water) * off, n: p.n - Math.sin(water) * off, y: p.deck, floating: false, facing: water, scale: statureScale(rng.next()), act: ACT.sit });
        activities.sitting!++;
      }
    } else {
      people.push({ e: p.e, n: p.n, y: p.deck, floating: p.floating, facing: rng.next() * Math.PI * 2, scale: statureScale(rng.next()), act: ACT.idle });
      activities.standing!++;
    }
  }
  for (const q of o.queues ?? []) {
    const k = 3 + Math.floor(rng.next() * 5);
    const facing = Math.atan2(q.de, q.dn);
    for (let i = 0; i < k; i++) {
      const e = q.e - q.de * (i * 0.8);
      const n = q.n - q.dn * (i * 0.8);
      const y = o.groundAt(e, n);
      // Only on dry land (not on the water beyond a slip's end).
      if (y < 0.8) continue;
      people.push({ e: e + (rng.next() - 0.5) * 0.2, n: n + (rng.next() - 0.5) * 0.2, y, floating: false, facing: facing + (rng.next() - 0.5) * 0.4, scale: statureScale(rng.next()), act: ACT.idle });
      activities.queueing!++;
    }
  }
  return { people, benches, activities };
}

/** A slatted bench (1.6 m) with a back, seat at 0.45 m, facing -z (the sitters' way). */
export function benchGeometry(): THREE.BufferGeometry {
  return merge([
    { geo: box(1.6, 0.05, 0.42, 0, 0.45, 0.02), colour: 0x8a6a48 },
    { geo: box(1.6, 0.36, 0.04, 0, 0.72, 0.24), colour: 0x8a6a48 },
    { geo: box(0.06, 0.45, 0.4, -0.7, 0.225, 0.03), colour: 0x2a2c2e },
    { geo: box(0.06, 0.45, 0.4, 0.7, 0.225, 0.03), colour: 0x2a2c2e },
  ]);
}
