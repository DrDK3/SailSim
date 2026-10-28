import * as THREE from 'three';

/**
 * Sailors in a Squib: an articulated figure, one skinned mesh (one draw call), posed every frame from where
 * the physics puts the crew's weight. Two-bone inverse kinematics reaches for real things in the boat: the
 * helm's hand on the tiller extension (which swings with the rudder) and the mainsheet, the crew's on the
 * jib sheet, feet on the cockpit floor or hooked under the toe straps. The caller (squibModel.ts) decides the
 * pose: sitting in, sitting out and leaning back to hike, crouching across under the boom in a tack or gybe,
 * looking at the sails. Figures are built to the measured mean stature of adults (STATURE: 1.75 m for men,
 * 1.61 m for women); proportions otherwise are illustrative, as are the poses. Visual only: the physics' crew
 * weight is its own calibration estimate, whoever is drawn.
 *
 * Every bone's frame: origin at its joint, +y along the segment (towards the next joint), +z its front (the
 * chest, the face, the knee cap, the top of the foot). Bones are posed directly in the parent's frame (the
 * boat's), not as a chain, so the inverse kinematics can place each one where it is solved.
 */

const BONES = [
  'pelvis',
  'spine',
  'chest',
  'neck',
  'head',
  'upperArmL',
  'forearmL',
  'handL',
  'upperArmR',
  'forearmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const;
type BoneName = (typeof BONES)[number];
const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;

/** Segment lengths and widths (m) the parts are modelled at: a reference figure 1.877 m tall (REF_STATURE). */
export const BODY = {
  pelvisToSpine: 0.06,
  spine: 0.22,
  chest: 0.27,
  neck: 0.09,
  shoulderHalf: 0.185,
  shoulderDrop: 0.05,
  hipHalf: 0.09,
  hipDrop: 0.04,
  upperArm: 0.3,
  forearm: 0.27,
  thigh: 0.44,
  shin: 0.45,
} as const;

export type Body = { readonly [K in keyof typeof BODY]: number };

/** Standing height of the reference figure: ankle (0.09 m), legs, hip drop, torso, neck and head (0.217 m). */
export const REF_STATURE = 0.09 + BODY.shin + BODY.thigh + BODY.hipDrop + BODY.pelvisToSpine + BODY.spine + BODY.chest + BODY.neck + 0.217;

export type CrewBuild = 'male' | 'female';

/**
 * Mean measured stature of adults (m): Scottish Health Survey 2008, ages 16 and over, men 175.0 cm and women
 * 161.3 cm (S, docs/SOURCES.md R1); the figures are built to these.
 */
export const STATURE: Record<CrewBuild, number> = { male: 1.75, female: 1.613 };

/**
 * A figure's proportions: the reference scaled to the stature, and for a woman's build somewhat narrower
 * shoulders and wider hips for her height (E).
 */
export function bodyOf(build: CrewBuild, stature = STATURE[build]): Body {
  const k = stature / REF_STATURE;
  const out = Object.fromEntries(Object.entries(BODY).map(([key, v]) => [key, v * k])) as Record<keyof typeof BODY, number>;
  if (build === 'female') {
    out.shoulderHalf *= SHAPE.female.shoulders;
    out.hipHalf *= SHAPE.female.hips;
  }
  return out;
}

/** Breadth factors for a build (on top of the stature scaling), applied to the chest and pelvis parts too. */
const SHAPE: Record<CrewBuild, { shoulders: number; hips: number }> = {
  male: { shoulders: 1, hips: 1 },
  female: { shoulders: 0.93, hips: 1.08 },
};

export type CrewRole = 'helm' | 'crew';

export interface CrewColours {
  jacket: number;
  trousers: number;
  lifejacket: number;
  cap: number;
  skin: number;
  boots: number;
  gloves: number;
  /** Hair (for a figure whose hair shows: a ponytail under the cap). */
  hair?: number;
}

export const CREW_COLOURS: Record<CrewRole, CrewColours> = {
  helm: { jacket: 0x1f3550, trousers: 0x2b2f36, lifejacket: 0xc0392b, cap: 0xf2f2ee, skin: 0xd8a47f, boots: 0x1c2733, gloves: 0x26282c },
  crew: { jacket: 0x3a4a5c, trousers: 0x30343b, lifejacket: 0xe3b21c, cap: 0x1d2b3a, skin: 0xc68d6a, boots: 0x1c2733, gloves: 0x26282c },
};

/** What a pose asks for, in the parent's (the boat's) frame. */
export interface CrewPose {
  /** Pelvis centre. */
  hip: THREE.Vector3;
  /** Horizontal direction the body faces. */
  facing: THREE.Vector3;
  /** Torso lean back from upright (rad); < 0 leans forward (crouching). */
  back: number;
  /** Ankle targets, left and right. */
  feet: [THREE.Vector3, THREE.Vector3];
  /** Wrist targets, left and right. */
  hands: [THREE.Vector3, THREE.Vector3];
  /** The point the sailor looks at. */
  look: THREE.Vector3;
}

/** The torso's frame for a pose: where the shoulders are, so the caller can choose what the hands reach. */
export interface BodyFrame {
  right: THREE.Vector3;
  up: THREE.Vector3;
  front: THREE.Vector3;
  shoulders: [THREE.Vector3, THREE.Vector3];
  neck: THREE.Vector3;
}

const Y = new THREE.Vector3(0, 1, 0);

export function bodyFrame(hip: THREE.Vector3, facing: THREE.Vector3, back: number, out?: BodyFrame, bd: Body = BODY): BodyFrame {
  const o = out ?? { right: new THREE.Vector3(), up: new THREE.Vector3(), front: new THREE.Vector3(), shoulders: [new THREE.Vector3(), new THREE.Vector3()], neck: new THREE.Vector3() };
  const f = o.front.set(facing.x, 0, facing.z).normalize();
  o.right.crossVectors(f, Y).normalize();
  // Leaning back tips the torso away from the way it faces (a hiking sailor faces inboard and leans out).
  o.up.copy(Y).multiplyScalar(Math.cos(back)).addScaledVector(f, -Math.sin(back));
  o.front.multiplyScalar(Math.cos(back)).addScaledVector(Y, Math.sin(back));
  const top = bd.pelvisToSpine + bd.spine + bd.chest;
  o.neck.copy(hip).addScaledVector(o.up, top);
  for (let i = 0; i < 2; i++) {
    o.shoulders[i]!.copy(hip)
      .addScaledVector(o.up, top - bd.shoulderDrop)
      .addScaledVector(o.right, (i === 0 ? -1 : 1) * bd.shoulderHalf);
  }
  return o;
}

/**
 * Two-bone inverse kinematics: from root `a`, segments l1 and l2, reach `target` (or as near as the limb
 * allows), bending towards `pole`. Writes the middle joint and the end.
 */
export function twoBone(a: THREE.Vector3, l1: number, l2: number, target: THREE.Vector3, pole: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3): void {
  const d = TB.d.subVectors(target, a);
  let dist = d.length();
  const dir = dist > 1e-9 ? d.divideScalar(dist) : d.set(0, -1, 0);
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4);
  end.copy(a).addScaledVector(dir, dist);
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = TB.p.subVectors(pole, a);
  perp.addScaledVector(dir, -perp.dot(dir));
  if (perp.lengthSq() < 1e-10) perp.set(dir.y, -dir.x, 0);
  perp.normalize();
  mid.copy(a).addScaledVector(dir, l1 * cosA).addScaledVector(perp, l1 * sinA);
}
const TB = { d: new THREE.Vector3(), p: new THREE.Vector3() };

// ------------------------------------------------------------------ geometry

/** Accumulates rigid parts, each bound to one bone, into one skinned geometry with vertex colours. */
class PartBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly skin: number[] = [];
  private readonly idx: number[] = [];
  private readonly c = new THREE.Color();

  add(geo: THREE.BufferGeometry, bone: number, colour: number, m?: THREE.Matrix4): void {
    if (m) geo.applyMatrix4(m);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    const base = this.pos.length / 3;
    this.c.setHex(colour, THREE.SRGBColorSpace);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.skin.push(bone, 0, 0, 0);
    }
    const index = geo.index;
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    geo.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skin, 4));
    const w = new Float32Array((this.skin.length / 4) * 4);
    for (let i = 0; i < w.length; i += 4) w[i] = 1;
    g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
    g.setIndex(this.idx);
    return g;
  }
}

const M = new THREE.Matrix4();
const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => M.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)).clone();
/** Tessellation scale while a body is built: 1 for the sailors, less for passengers seen from further off. */
let detail = 1;
const segs = (n: number) => Math.max(4, Math.round(n * detail));
const ellipsoid = (rx: number, ry: number, rz: number, seg = 14) => new THREE.SphereGeometry(1, segs(seg), segs(seg * 0.75)).scale(rx, ry, rz);

/** A rounded, tapered limb along +y from 0 to len (radius r0 at the joint, r1 at the far end). */
function limb(r0: number, r1: number, len: number, seg = 12): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const K = Math.max(2, Math.round(5 * detail));
  for (let i = 0; i <= K; i++) {
    const a = -Math.PI / 2 + (i / K) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, r0 * Math.cos(a)), r0 * 0.6 * Math.sin(a)));
  }
  for (let i = 0; i <= K; i++) {
    const a = (i / K) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, r1 * Math.cos(a)), len + r1 * 0.6 * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, segs(seg));
}

/** A body of revolution from a radius profile [radius, y][], squashed front to back (sz) and widened (sx). */
function body(profile: [number, number][], sx: number, sz: number, seg = 18): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)),
    segs(seg),
  );
  return g.scale(sx, 1, sz);
}

function buildGeometry(role: CrewRole, c: CrewColours, tessellation = 1, build: CrewBuild = 'male', stature = STATURE[build]): THREE.BufferGeometry {
  detail = tessellation;
  try {
    const g = buildParts(role, c, build);
    // Every part is in its bone's frame, about the joint: scaling the vertices scales the parts and their
    // offsets along the bone alike. Breadth: the chest (shoulders) and pelvis (hips) for the build.
    const k = stature / REF_STATURE;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const bone = g.getAttribute('skinIndex');
    for (let i = 0; i < pos.count; i++) {
      const b = bone.getX(i);
      const wide = b === B.chest ? SHAPE[build].shoulders : b === B.pelvis ? SHAPE[build].hips : 1;
      pos.setXYZ(i, pos.getX(i) * k * wide, pos.getY(i) * k, pos.getZ(i) * k);
    }
    return g;
  } finally {
    detail = 1;
  }
}

function buildParts(role: CrewRole, c: CrewColours, build: CrewBuild = 'male'): THREE.BufferGeometry {
  const b = new PartBuilder();
  const dark = 0x15181c;
  // Pelvis and seat (trousers), with a belt line.
  b.add(ellipsoid(0.165, 0.11, 0.12), B.pelvis, c.trousers, at(0, 0.01, -0.005));
  b.add(body([[0, -0.02], [0.13, -0.02], [0.145, 0.02], [0.14, 0.07], [0, 0.07]], 1.08, 0.78), B.pelvis, c.trousers);
  // Lower torso (jacket), the buoyancy aid over it with a waist strap and buckle.
  b.add(body([[0, 0], [0.135, 0], [0.14, 0.08], [0.15, 0.17], [0.155, 0.24], [0, 0.24]], 1.08, 0.74), B.spine, c.jacket);
  b.add(body([[0, 0.05], [0.158, 0.05], [0.165, 0.14], [0.17, 0.25], [0, 0.25]], 1.1, 0.86), B.spine, c.lifejacket);
  b.add(body([[0.171, 0.085], [0.171, 0.115]], 1.1, 0.87), B.spine, dark);
  b.add(new THREE.BoxGeometry(0.06, 0.04, 0.02), B.spine, 0x8a8f96, at(0, 0.1, 0.152));
  // Chest and shoulders (jacket), the buoyancy aid's chest panels, a collar.
  b.add(body([[0, 0], [0.155, 0], [0.17, 0.08], [0.18, 0.16], [0.172, 0.22], [0.13, 0.265], [0.07, 0.285], [0, 0.29]], 1.12, 0.72), B.chest, c.jacket);
  b.add(body([[0, 0], [0.172, 0], [0.18, 0.08], [0.188, 0.16], [0.17, 0.215], [0, 0.215]], 1.1, 0.84), B.chest, c.lifejacket);
  b.add(new THREE.BoxGeometry(0.012, 0.2, 0.01), B.chest, dark, at(0, 0.11, 0.152)); // zip
  for (const s of [-1, 1]) {
    b.add(ellipsoid(0.065, 0.06, 0.07), B.chest, c.jacket, at(s * 0.17, 0.22, 0));
    b.add(new THREE.BoxGeometry(0.03, 0.006, 0.12), B.chest, 0xd9dde0, at(s * 0.1, 0.06, 0.125)); // reflective tape
  }
  b.add(limb(0.075, 0.07, 0.07, 14), B.chest, c.jacket, at(0, 0.255, -0.01));
  // Neck and head: face, nose, ears, eyes; a peaked cap and sunglasses (helm) or a beanie (crew).
  b.add(limb(0.048, 0.045, 0.09), B.neck, c.skin);
  b.add(ellipsoid(0.083, 0.112, 0.098, 18), B.head, c.skin, at(0, 0.105, 0.006));
  b.add(ellipsoid(0.07, 0.045, 0.07), B.head, c.skin, at(0, 0.045, 0.03)); // jaw
  b.add(new THREE.ConeGeometry(0.017, 0.04, 8).rotateX(Math.PI / 2), B.head, c.skin, at(0, 0.095, 0.112));
  for (const s of [-1, 1]) {
    b.add(ellipsoid(0.012, 0.028, 0.02), B.head, c.skin, at(s * 0.084, 0.1, 0));
    b.add(ellipsoid(0.011, 0.008, 0.006, 8), B.head, role === 'helm' ? dark : 0x2a2018, at(s * 0.031, 0.122, 0.094));
  }
  if (role === 'helm') {
    b.add(new THREE.BoxGeometry(0.15, 0.028, 0.012), B.head, dark, at(0, 0.123, 0.099)); // sunglasses
    b.add(new THREE.SphereGeometry(0.093, segs(18), segs(9), 0, Math.PI * 2, 0, Math.PI / 2).scale(0.98, 0.85, 1.08), B.head, c.cap, at(0, 0.135, 0.004));
    b.add(new THREE.CylinderGeometry(0.075, 0.08, 0.008, segs(18), 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.05), B.head, c.cap, at(0, 0.142, 0.07));
  } else {
    b.add(new THREE.SphereGeometry(0.094, segs(18), segs(10), 0, Math.PI * 2, 0, Math.PI / 1.9).scale(1, 1.18, 1.08), B.head, c.cap, at(0, 0.12, 0.002));
    b.add(new THREE.TorusGeometry(0.093, 0.016, segs(6), segs(20)).rotateX(Math.PI / 2).scale(1, 1, 1.07), B.head, c.cap, at(0, 0.13, 0.004));
  }
  if (build === 'female') {
    // Hair: a ponytail out of the back of the cap, and hair over the ears and nape.
    const hair = c.hair ?? 0x4a3020;
    b.add(ellipsoid(0.088, 0.07, 0.07), B.head, hair, at(0, 0.075, -0.035));
    b.add(ellipsoid(0.03, 0.09, 0.03), B.head, hair, at(0, 0.03, -0.11));
    b.add(ellipsoid(0.034, 0.024, 0.034), B.head, c.cap === hair ? dark : 0x2b2b2b, at(0, 0.11, -0.1)); // band
  }
  // Arms (jacket sleeves with dark cuffs) and gloved hands; the thumb on the inside.
  for (const [ua, fa, hd, s] of [[B.upperArmL, B.forearmL, B.handL, -1], [B.upperArmR, B.forearmR, B.handR, 1]] as const) {
    b.add(limb(0.056, 0.047, BODY.upperArm), ua, c.jacket);
    b.add(ellipsoid(0.05, 0.05, 0.05), ua, c.jacket, at(0, BODY.upperArm, 0));
    b.add(limb(0.046, 0.038, BODY.forearm - 0.03), fa, c.jacket);
    b.add(limb(0.042, 0.042, 0.03), fa, dark, at(0, BODY.forearm - 0.045, 0));
    b.add(ellipsoid(0.04, 0.055, 0.022), hd, c.gloves, at(0, 0.05, 0.004));
    b.add(ellipsoid(0.036, 0.042, 0.019), hd, c.gloves, at(0, 0.115, 0.014));
    b.add(ellipsoid(0.014, 0.034, 0.014), hd, c.gloves, at(-s * 0.034, 0.055, 0.02));
  }
  // Legs: trousers, knees, sailing boots with pale soles.
  for (const [th, sh, ft] of [[B.thighL, B.shinL, B.footL], [B.thighR, B.shinR, B.footR]] as const) {
    b.add(limb(0.083, 0.06, BODY.thigh), th, c.trousers);
    b.add(ellipsoid(0.06, 0.06, 0.062), th, c.trousers, at(0, BODY.thigh, 0.008));
    b.add(limb(0.058, 0.05, 0.24), sh, c.trousers);
    b.add(limb(0.066, 0.06, BODY.shin - 0.2), sh, c.boots, at(0, 0.2, 0));
    b.add(ellipsoid(0.052, 0.14, 0.05), ft, c.boots, at(0, 0.085, 0.0));
    b.add(new THREE.BoxGeometry(0.098, 0.27, 0.018), ft, 0xe6e6e0, at(0, 0.08, -0.045));
  }
  return b.build();
}

const MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
const geometryCache = new Map<string, THREE.BufferGeometry>();

export class CrewFigure {
  readonly group = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  /** This figure's proportions (its build and stature). */
  readonly body: Body;
  private readonly bones: THREE.Bone[];
  private readonly frameOut: BodyFrame = bodyFrame(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 0);
  private readonly v = Array.from({ length: 10 }, () => new THREE.Vector3());
  private readonly m = new THREE.Matrix4();

  constructor(
    readonly role: CrewRole,
    colours: CrewColours = CREW_COLOURS[role],
    tessellation = 1,
    readonly build: CrewBuild = 'male',
    stature = STATURE[build],
  ) {
    this.group.name = `crew-${role}`;
    this.body = bodyOf(build, stature);
    const shared = colours === CREW_COLOURS[role] && tessellation === 1 && stature === STATURE[build];
    const key = `${role}:${build}`;
    let geo = shared ? geometryCache.get(key) : undefined;
    if (!geo) {
      geo = buildGeometry(role, colours, tessellation, build, stature);
      if (shared) geometryCache.set(key, geo);
    }
    this.bones = BONES.map((n) => {
      const bone = new THREE.Bone();
      bone.name = n;
      this.group.add(bone);
      return bone;
    });
    this.mesh = new THREE.SkinnedMesh(geo, MATERIAL);
    this.mesh.name = `crew-${role}-body`;
    // Each part is drawn in its bone's frame: the bind pose is every bone at the origin.
    this.mesh.bind(new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
    // The bounds of the bind pose say nothing about the posed figure.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
  }

  /** The posed figure as static geometry (positions, normals, colours): its skinning applied once. */
  bake(): THREE.BufferGeometry {
    const src = this.mesh.geometry;
    const pos = src.getAttribute('position');
    const nor = src.getAttribute('normal');
    const si = src.getAttribute('skinIndex');
    const mats = this.bones.map((b) => new THREE.Matrix4().compose(b.position, b.quaternion, ONE));
    const nmats = mats.map((m) => new THREE.Matrix3().getNormalMatrix(m));
    const p = new Float32Array(pos.count * 3);
    const n = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const b = si.getX(i);
      v.fromBufferAttribute(pos, i).applyMatrix4(mats[b]!);
      p.set([v.x, v.y, v.z], i * 3);
      v.fromBufferAttribute(nor, i).applyMatrix3(nmats[b]!).normalize();
      n.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.setAttribute('color', src.getAttribute('color').clone());
    g.setIndex(src.getIndex()!.clone());
    return g;
  }

  /** Bone position (in the parent's frame) after the last pose: for tests and attaching things. */
  joint(name: BoneName): THREE.Vector3 {
    return this.bones[B[name]]!.position;
  }

  private set(name: BoneName, pos: THREE.Vector3, yAxis: THREE.Vector3, zHint: THREE.Vector3): void {
    const bone = this.bones[B[name]]!;
    const y = this.v[7]!.copy(yAxis).normalize();
    const z = this.v[8]!.copy(zHint).addScaledVector(y, -zHint.dot(y));
    if (z.lengthSq() < 1e-10) {
      z.set(-y.y, y.x, 0);
      if (z.lengthSq() < 1e-10) z.set(0, -y.z, y.y);
    }
    z.normalize();
    const x = this.v[9]!.crossVectors(y, z);
    bone.position.copy(pos);
    bone.quaternion.setFromRotationMatrix(this.m.makeBasis(x, y, z));
  }

  /** The torso's frame for a pose of this figure (where its shoulders are). */
  frame(hip: THREE.Vector3, facing: THREE.Vector3, back: number, out?: BodyFrame): BodyFrame {
    return bodyFrame(hip, facing, back, out, this.body);
  }

  pose(p: CrewPose): void {
    const BODY = this.body;
    const f = bodyFrame(p.hip, p.facing, p.back, this.frameOut, BODY);
    const [a, b, c, d, e] = this.v as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
    this.set('pelvis', p.hip, f.up, f.front);
    const spine = a.copy(p.hip).addScaledVector(f.up, BODY.pelvisToSpine);
    this.set('spine', spine, f.up, f.front);
    const chest = b.copy(spine).addScaledVector(f.up, BODY.spine);
    this.set('chest', chest, f.up, f.front);

    // Head: towards what the sailor looks at, within what a neck allows (about 70° from the chest's front).
    const look = c.subVectors(p.look, f.neck).normalize();
    const cos = look.dot(f.front);
    if (cos < 0.34) look.lerp(f.front, Math.min(1, (0.34 - cos) / 1.34)).normalize();
    const headUp = d.copy(f.up).addScaledVector(look, -f.up.dot(look)).normalize();
    const neckDir = e.copy(f.up).add(headUp).normalize();
    this.set('neck', f.neck, neckDir, look);
    this.set('head', a.copy(f.neck).addScaledVector(neckDir, BODY.neck), headUp, look);

    // Arms: elbows down and out to the side.
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const sh = f.shoulders[i]!;
      const pole = b.copy(sh).addScaledVector(f.up, -1).addScaledVector(f.right, s * 0.7).addScaledVector(f.front, -0.3);
      const elbow = c;
      const wrist = d;
      twoBone(sh, BODY.upperArm, BODY.forearm, p.hands[i]!, pole, elbow, wrist);
      const upper = e.subVectors(elbow, sh);
      this.set(i === 0 ? 'upperArmL' : 'upperArmR', sh, upper, f.front);
      const fore = a.subVectors(wrist, elbow);
      this.set(i === 0 ? 'forearmL' : 'forearmR', elbow, fore, f.front);
      // The hand carries on from the forearm, palm inwards.
      this.set(i === 0 ? 'handL' : 'handR', wrist, fore, b.copy(f.right).multiplyScalar(-s).add(f.front));
    }

    // Legs: knees forward and up; feet flat, toes the way the body faces.
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const hip = a.copy(p.hip).addScaledVector(f.right, s * BODY.hipHalf).addScaledVector(f.up, -BODY.hipDrop);
      const flat = b.set(p.facing.x, 0, p.facing.z).normalize();
      const pole = c.copy(hip).addScaledVector(flat, 1).addScaledVector(Y, 0.6).addScaledVector(f.right, s * 0.15);
      const knee = d;
      const ankle = e;
      twoBone(hip, BODY.thigh, BODY.shin, p.feet[i]!, pole, knee, ankle);
      const thighDir = this.v[5]!.subVectors(knee, hip);
      const kneeFront = this.v[6]!.subVectors(pole, hip);
      this.set(i === 0 ? 'thighL' : 'thighR', hip, thighDir, kneeFront);
      const shinDir = this.v[5]!.subVectors(ankle, knee);
      this.set(i === 0 ? 'shinL' : 'shinR', knee, shinDir, flat);
      // Toes a little out from the way the body faces.
      const toes = this.v[6]!.copy(flat).addScaledVector(f.right, s * 0.25).normalize();
      this.set(i === 0 ? 'footL' : 'footR', ankle, toes, Y);
    }
  }
}

// ------------------------------------------------------------------ passengers

/** Clothes for people aboard the ferries: jackets, trousers, a few hats (illustrative). */
const PASSENGER_COLOURS: CrewColours[] = [
  { jacket: 0x2f4f7f, trousers: 0x2b2f36, lifejacket: 0x2f4f7f, cap: 0x5a4632, skin: 0xd8a47f, boots: 0x3a2f28, gloves: 0xd8a47f },
  { jacket: 0xb03a2e, trousers: 0x30343b, lifejacket: 0xb03a2e, cap: 0x2a2018, skin: 0xc68d6a, boots: 0x1c1c1c, gloves: 0xc68d6a },
  { jacket: 0xe0d6c2, trousers: 0x5a6f8a, lifejacket: 0xe0d6c2, cap: 0xc9a46a, skin: 0xe2b590, boots: 0xf0f0ec, gloves: 0xe2b590 },
  { jacket: 0x3f6b4a, trousers: 0x6b5a45, lifejacket: 0x3f6b4a, cap: 0x2a2018, skin: 0x8d5a3b, boots: 0x2a2520, gloves: 0x8d5a3b },
  { jacket: 0x7a4b8c, trousers: 0x2b2f36, lifejacket: 0x7a4b8c, cap: 0xd9c08a, skin: 0xd8a47f, boots: 0xf0f0ec, gloves: 0xd8a47f },
  { jacket: 0xf2c14e, trousers: 0x3b4a5c, lifejacket: 0xf2c14e, cap: 0x1d2b3a, skin: 0xc68d6a, boots: 0x1c1c1c, gloves: 0xc68d6a },
  { jacket: 0x22262b, trousers: 0x8a7a63, lifejacket: 0x22262b, cap: 0x7a5a3a, skin: 0xe2b590, boots: 0x5a3a28, gloves: 0xe2b590 },
  { jacket: 0x9fb3c8, trousers: 0x30343b, lifejacket: 0x9fb3c8, cap: 0x30343b, skin: 0x6e4630, boots: 0x1c1c1c, gloves: 0x6e4630 },
];

const baked = new Map<string, THREE.BufferGeometry>();
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * A passenger standing or sitting, as static geometry with vertex colours (the figure posed once and its
 * skinning applied): feet at the origin, facing -z. Many people aboard cost nothing per frame.
 */
export function bakedPerson(seed: number, sitting: boolean): THREE.BufferGeometry {
  const build: CrewBuild = seed % 2 === 0 ? 'male' : 'female';
  const key = `${seed % PASSENGER_COLOURS.length}:${build}:${sitting}`;
  let g = baked.get(key);
  if (!g) {
    const fig = new CrewFigure(seed % 3 === 0 ? 'helm' : 'crew', PASSENGER_COLOURS[seed % PASSENGER_COLOURS.length], 0.45, build);
    const bd = fig.body;
    const k = bd.thigh / BODY.thigh;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    // Standing: the hips over the ankles, knees all but straight; sitting on a 0.45 m bench.
    const stand = 0.09 * k + bd.shin + bd.thigh + bd.hipDrop - 0.02;
    fig.pose(
      sitting
        ? { hip: V(0, 0.5, 0.05), facing: V(0, 0, -1), back: 0.06, feet: [V(-0.12, 0.09 * k, -0.4 * k), V(0.12, 0.09 * k, -0.4 * k)], hands: [V(-0.16, 0.6, -0.3), V(0.16, 0.6, -0.3)], look: V(0, 1.1, -5) }
        : { hip: V(0, stand, 0), facing: V(0, 0, -1), back: -0.02, feet: [V(-0.11, 0.09 * k, 0.02), V(0.11, 0.09 * k, -0.04)], hands: [V(-0.22, stand - 0.2, 0.05), V(0.22, stand - 0.2, 0.0)], look: V(0, 1.6, -5) },
    );
    g = fig.bake();
    baked.set(key, g);
  }
  return g.clone();
}
