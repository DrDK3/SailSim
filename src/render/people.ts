import * as THREE from 'three';

/**
 * People ashore: a jointed low-poly figure drawn by the thousand as instanced meshes, posed and animated on the
 * GPU. Each vertex carries the part it belongs to (thighs, shins, arms, head, body); each instance its motion
 * (gait phase and rate, an activity and a seed), and the vertex shader turns the parts about their joints:
 * walkers stride and swing their arms at their pace, people standing shift their weight and look about,
 * chatting ones gesture, watchers lean on the rail, sitters sit with their knees bent. Built at the mean
 * adult stature (1.68 m: the mean of the men's and women's means, src/render/crew.ts STATURE) and scaled per
 * instance (about 1.55-1.80 m). Proportions are an adult's; the motions are illustrative (E).
 */

export const PERSON = {
  stature: 1.68,
  hipY: 0.87,
  kneeY: 0.47,
  shoulderY: 1.38,
  neckY: 1.46,
  hipX: 0.09,
  shoulderX: 0.19,
  /** Seat height when sitting on a bench (m). */
  seatY: 0.46,
  /** Stride: distance covered per gait cycle (two steps), m. */
  stride: 1.4,
};

/** Activities, as the shader knows them. */
export const ACT = { idle: 0, walk: 1, chat: 2, lean: 3, sit: 4 } as const;

const PART = { body: 0, thighL: 1, thighR: 2, shinL: 3, shinR: 4, armL: 5, armR: 6, head: 7 } as const;

const SKIN = [0xd9a888, 0xc68d6a, 0x8d5a3b, 0xe8c09a, 0x6e4630];
const HAIR = [0x2a2018, 0x5a4632, 0x9a7a4a, 0x1c1c1c, 0xb8b2a8];
const TROUSERS = [0x2b3442, 0x30343b, 0x5a6f8a, 0x6b5a45, 0x8a7a63, 0x1f2328];

interface Part {
  geo: THREE.BufferGeometry;
  part: number;
  colour: number;
  shirt?: boolean;
}

/** A tapered limb between two heights at x, radius r0 at the top and r1 at the bottom. */
const limb = (x: number, y0: number, y1: number, r0: number, r1: number, seg = 5) => new THREE.CylinderGeometry(r0, r1, y0 - y1, seg, 1).translate(x, (y0 + y1) / 2, 0);

/**
 * The figure, facing -z, feet at y = 0, with attributes `aPart` (which part) and `aShirt` (1 where the
 * instance colour, the clothing, shows). Skin, hair and trousers vary with `variant`.
 */
export function personPartsGeometry(variant = 0): THREE.BufferGeometry {
  const P = PERSON;
  const skin = SKIN[variant % SKIN.length]!;
  const hair = HAIR[(variant * 3) % HAIR.length]!;
  const trousers = TROUSERS[(variant * 7) % TROUSERS.length]!;
  const parts: Part[] = [];
  for (const [s, thigh, shin, arm] of [[-1, PART.thighL, PART.shinL, PART.armL], [1, PART.thighR, PART.shinR, PART.armR]] as const) {
    const x = s * P.hipX;
    parts.push({ geo: limb(x, P.hipY, P.kneeY, 0.078, 0.06), part: thigh, colour: trousers });
    parts.push({ geo: limb(x, P.kneeY, 0.07, 0.058, 0.045), part: shin, colour: trousers });
    parts.push({ geo: new THREE.BoxGeometry(0.095, 0.07, 0.25).translate(x, 0.035, -0.04), part: shin, colour: 0x2a2622 });
    const ax = s * P.shoulderX;
    parts.push({ geo: limb(ax, P.shoulderY, 0.86, 0.046, 0.038), part: arm, colour: 0xffffff, shirt: true });
    parts.push({ geo: new THREE.SphereGeometry(0.042, 5, 3).translate(ax, 0.82, 0), part: arm, colour: skin });
  }
  // Hips and torso (the clothing), slimmer at the waist; shoulders rounded.
  parts.push({ geo: new THREE.CylinderGeometry(0.15, 0.16, 0.18, 7, 1).scale(1, 1, 0.62).translate(0, 0.92, 0), part: PART.body, colour: trousers });
  parts.push({ geo: new THREE.CylinderGeometry(0.185, 0.145, 0.5, 7, 1).scale(1, 1, 0.6).translate(0, 1.2, 0), part: PART.body, colour: 0xffffff, shirt: true });
  parts.push({ geo: new THREE.SphereGeometry(0.19, 7, 2, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 0.6).translate(0, 1.44, 0), part: PART.body, colour: 0xffffff, shirt: true });
  // Neck, head, hair.
  parts.push({ geo: limb(0, P.neckY + 0.04, 1.42, 0.048, 0.05, 5), part: PART.head, colour: skin });
  parts.push({ geo: new THREE.SphereGeometry(0.1, 8, 5).scale(0.9, 1.08, 0.98).translate(0, 1.575, 0), part: PART.head, colour: skin });
  parts.push({ geo: new THREE.SphereGeometry(0.104, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.92, 1.05, 1.0).translate(0, 1.59, 0.012), part: PART.head, colour: hair });

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const partA: number[] = [];
  const shirtA: number[] = [];
  const c = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    g.computeVertexNormals();
    c.setHex(p.colour, THREE.SRGBColorSpace);
    const ps = g.getAttribute('position');
    const ns = g.getAttribute('normal');
    for (let i = 0; i < ps.count; i++) {
      pos.push(ps.getX(i), ps.getY(i), ps.getZ(i));
      nor.push(ns.getX(i), ns.getY(i), ns.getZ(i));
      col.push(c.r, c.g, c.b);
      partA.push(p.part);
      shirtA.push(p.shirt ? 1 : 0);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('aPart', new THREE.Float32BufferAttribute(partA, 1));
  out.setAttribute('aShirt', new THREE.Float32BufferAttribute(shirtA, 1));
  out.computeBoundingSphere();
  return out;
}

/** Shared clock for every people material (seconds). */
export const peopleTime = { value: 0 };

const POSE_GLSL = /* glsl */ `
attribute float aPart;
attribute float aShirt;
attribute vec4 iMotion;
uniform float uPeopleTime;
vec3 pRotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 pRotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
vec3 pRotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
// Pose a vertex (and its normal) of part 'part' for the instance's motion.
void personPose(inout vec3 p, inout vec3 n) {
  float part = aPart;
  float act = iMotion.z;
  float seed = iMotion.w;
  float t = uPeopleTime;
  float gait = iMotion.x + t * iMotion.y;
  float walking = act > 0.5 && act < 1.5 ? 1.0 : 0.0;
  float sitting = act > 3.5 ? 1.0 : 0.0;
  // Legs: hips swing, knees flex in the swing; sitting, thighs forward and knees bent.
  float swing = walking * 0.42 * sin(gait);
  // (A positive turn about x swings a hanging limb forward, towards -z; a negative one tips an upright part forward.)
  float hipL = swing + sitting * 1.5;
  float hipR = -swing + sitting * 1.5;
  float kneeL = -walking * 0.65 * max(0.0, -sin(gait - 0.6)) - sitting * 1.5;
  float kneeR = -walking * 0.65 * max(0.0, sin(gait - 0.6)) - sitting * 1.5;
  // Standing still: the weight shifts from foot to foot now and then.
  float still = 1.0 - walking - sitting;
  float shift = still * 0.05 * sin(t * 0.37 + seed * 7.0);
  vec3 hipLp = vec3(-${PERSON.hipX.toFixed(3)}, ${PERSON.hipY.toFixed(3)}, 0.0);
  vec3 hipRp = vec3(${PERSON.hipX.toFixed(3)}, ${PERSON.hipY.toFixed(3)}, 0.0);
  vec3 kneeLp = vec3(-${PERSON.hipX.toFixed(3)}, ${PERSON.kneeY.toFixed(3)}, 0.0);
  vec3 kneeRp = vec3(${PERSON.hipX.toFixed(3)}, ${PERSON.kneeY.toFixed(3)}, 0.0);
  if (part > 2.5 && part < 4.5) {
    bool left = part < 3.5;
    vec3 kp = left ? kneeLp : kneeRp;
    float ka = left ? kneeL : kneeR;
    p = kp + pRotX(p - kp, ka);
    n = pRotX(n, ka);
  }
  if (part > 0.5 && part < 4.5) {
    bool left = part < 1.5 || (part > 2.5 && part < 3.5);
    vec3 hp = left ? hipLp : hipRp;
    float ha = left ? hipL : hipR;
    p = hp + pRotX(p - hp, ha);
    n = pRotX(n, ha);
  }
  // Arms: swing against the legs walking; chatting, the right hand gestures; leaning, both forward on the rail.
  float chat = act > 1.5 && act < 2.5 ? 1.0 : 0.0;
  float lean = act > 2.5 && act < 3.5 ? 1.0 : 0.0;
  float armL = -swing * 0.9 + still * 0.04 * sin(t * 0.5 + seed) + lean * 0.9 + sitting * 0.35;
  float armR = swing * 0.9 + still * 0.04 * sin(t * 0.45 + seed * 2.0) + lean * 0.9 + sitting * 0.35
    + chat * (0.55 + 0.35 * sin(t * 1.9 + seed * 5.0)) * smoothstep(-0.3, 0.3, sin(t * 0.31 + seed * 3.0));
  if (part > 4.5 && part < 6.5) {
    bool left = part < 5.5;
    vec3 sp = vec3(left ? -${PERSON.shoulderX.toFixed(3)} : ${PERSON.shoulderX.toFixed(3)}, ${PERSON.shoulderY.toFixed(3)}, 0.0);
    float aa = left ? armL : armR;
    p = sp + pRotX(p - sp, aa);
    n = pRotX(n, aa);
  }
  // Head: looking about when still (now and then over a shoulder), down at the water leaning.
  if (part > 6.5) {
    vec3 np = vec3(0.0, ${PERSON.neckY.toFixed(3)}, 0.0);
    float yaw = (still + sitting) * 0.5 * sin(t * 0.21 + seed * 11.0) * smoothstep(0.2, 0.8, sin(t * 0.13 + seed * 2.0));
    p = np + pRotY(p - np, yaw);
    n = pRotY(n, yaw);
    p = np + pRotX(p - np, lean * -0.35);
    n = pRotX(n, lean * -0.35);
  }
  // Upper body: leaning forward on the rail; a slight sway; the weight shift tilts the hips.
  if (part < 0.5 || part > 4.5) {
    vec3 wp = vec3(0.0, 0.95, 0.0);
    float bend = -(lean * 0.3 + walking * 0.05);
    p = wp + pRotX(p - wp, bend);
    n = pRotX(n, bend);
    float roll = shift + walking * 0.04 * sin(gait);
    p = wp + pRotZ(p - wp, roll);
    n = pRotZ(n, roll);
  }
  // Sitting: down onto the seat; walking, a little bob.
  p.y -= sitting * ${(PERSON.hipY - PERSON.seatY).toFixed(3)};
  p.y += walking * 0.025 * abs(sin(gait));
}
`;

/** A material for people: vertex colours, the instance colour on the clothing only, posed by the shader. */
export function peopleMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPeopleTime = peopleTime;
    shader.vertexShader = POSE_GLSL + shader.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(normal);\nvec3 posedPos = vec3(position);\npersonPose(posedPos, objectNormal);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif')
      .replace('#include <begin_vertex>', 'vec3 transformed = posedPos;')
      .replace('#include <color_vertex>', 'vColor = vec4(1.0);\n#ifdef USE_COLOR\nvColor.rgb *= color.rgb;\n#endif\n#ifdef USE_INSTANCING_COLOR\nvColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aShirt);\n#endif');
  };
  m.customProgramCacheKey = () => 'people-v2';
  return m;
}

/** A people mesh with room for `count`, its own motion attribute (gait phase, rate rad/s, activity, seed). */
export function peopleMesh(count: number, variant: number, name: string): THREE.InstancedMesh {
  const geo = personPartsGeometry(variant);
  geo.setAttribute('iMotion', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 4), 4));
  const mesh = new THREE.InstancedMesh(geo, peopleMaterial(), Math.max(1, count));
  mesh.name = name;
  mesh.count = count;
  mesh.frustumCulled = false;
  return mesh;
}

/** Set an instance's motion. */
export function setMotion(mesh: THREE.InstancedMesh, i: number, phase: number, rate: number, act: number, seed: number): void {
  const a = mesh.geometry.getAttribute('iMotion') as THREE.InstancedBufferAttribute;
  a.setXYZW(i, phase, rate, act, seed);
  a.needsUpdate = true;
}

/** Gait rate (rad/s) for a walking speed (m/s) and a stature scale: a full cycle per stride. */
export function gaitRate(speed: number, scale = 1): number {
  return (2 * Math.PI * speed) / (PERSON.stride * scale);
}

/** A stature scale for a seeded random number in [0, 1): about 0.92 … 1.07 of 1.68 m (1.55 … 1.80 m). */
export function statureScale(r: number): number {
  return 0.92 + 0.15 * r;
}
