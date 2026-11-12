import * as THREE from 'three';

/**
 * Cars, less blocky (owner, 12 Nov 2026): a body lofted from a side profile with a rounded nose, a curved bonnet and
 * roof, wheel arches cut into its sills and bevelled edges; a glass cabin set in from the sides under a body-coloured
 * roof, with door pillars; bumpers, a grille, head and tail lights, wheels with hubcaps. Four kinds: a hatchback, a
 * saloon, an SUV and a van. Shared by the street cars (src/render/population.ts, instanced: the body takes the
 * instance colour) and the cars on the ferries' decks (src/render/vessels.ts). Proportions are typical of small UK
 * cars (E). Local frame: x across (centred), y up from the ground, z along with the bow at -z, centred.
 */

export type CarType = 0 | 1 | 2 | 3;
export type CarRole = 'body' | 'glass' | 'tyre' | 'trim' | 'light' | 'tail' | 'chrome';
export interface CarPart {
  geo: THREE.BufferGeometry;
  role: CarRole;
}

/** Length and width by type (m): hatchback, saloon, SUV, van. */
export const CAR_SIZE: Record<CarType, { length: number; width: number; height: number }> = {
  0: { length: 4.1, width: 1.76, height: 1.45 },
  1: { length: 4.7, width: 1.8, height: 1.43 },
  2: { length: 4.6, width: 1.88, height: 1.68 },
  3: { length: 5.0, width: 1.95, height: 1.95 },
};

/** Profile points (z from the nose, y up) for the body's top line, front to back. */
function topLine(type: CarType, L: number): [number, number][] {
  switch (type) {
    case 0:
      return [[0.05, 0.72], [0.45, 0.82], [0.95, 0.88], [L - 0.35, 0.95], [L - 0.06, 0.9]];
    case 1:
      return [[0.05, 0.7], [0.5, 0.8], [1.0, 0.87], [L - 1.2, 0.95], [L - 0.35, 0.98], [L - 0.06, 0.93]];
    case 2:
      return [[0.05, 0.86], [0.45, 0.96], [0.95, 1.03], [L - 0.3, 1.08], [L - 0.06, 1.04]];
    default:
      return [[0.05, 0.84], [0.4, 0.97], [1.12, 1.82], [1.45, 1.93], [L - 0.15, 1.95], [L - 0.04, 1.86]];
  }
}

/** The glass cabin's outline (z, y), closed, or none (the van: its body runs to the roof). */
function cabinLine(type: CarType, L: number): [number, number][] | undefined {
  switch (type) {
    case 0:
      return [[0.98, 0.88], [1.72, 1.36], [2.3, 1.44], [L - 0.55, 1.43], [L - 0.14, 0.97]];
    case 1:
      return [[1.05, 0.88], [1.85, 1.36], [2.5, 1.43], [3.2, 1.41], [L - 1.0, 0.97]];
    case 2:
      return [[0.98, 1.04], [1.55, 1.6], [2.2, 1.68], [L - 0.3, 1.66], [L - 0.1, 1.1]];
    default:
      return undefined;
  }
}

/** Wheel centres along the car (from the nose). */
export function wheelBase(type: CarType): [number, number] {
  const L = CAR_SIZE[type].length;
  return [0.82, L - (type === 3 ? 0.95 : 0.85)];
}

const R = 0.33;
const ARCH = 0.4;

function bodyShape(type: CarType): THREE.Shape {
  const L = CAR_SIZE[type].length;
  const top = topLine(type, L);
  const [w0, w1] = wheelBase(type);
  const s = new THREE.Shape();
  s.moveTo(0.12, 0.28);
  // The nose, rounded.
  s.quadraticCurveTo(0, 0.32, 0, 0.5);
  s.quadraticCurveTo(0, top[0]![1], top[0]![0], top[0]![1]);
  // Along the top: bonnet, belt or roof.
  for (let i = 1; i < top.length; i++) {
    const [z, y] = top[i]!;
    const [pz, py] = top[i - 1]!;
    s.quadraticCurveTo((pz + z) / 2, Math.max(py, y) + 0.02, z, y);
  }
  // The tail, rounded down to the bumper.
  s.quadraticCurveTo(L, top[top.length - 1]![1] - 0.05, L, 0.5);
  s.quadraticCurveTo(L, 0.3, L - 0.12, 0.28);
  // The sill with the wheel arches, back to front.
  s.lineTo(w1 + ARCH, 0.28);
  s.absarc(w1, 0.33, ARCH, 0, Math.PI, false);
  s.lineTo(w0 + ARCH, 0.28);
  s.absarc(w0, 0.33, ARCH, 0, Math.PI, false);
  s.lineTo(0.12, 0.28);
  return s;
}

function closedShape(pts: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) {
    const [z, y] = pts[i]!;
    const [pz, py] = pts[i - 1]!;
    // The roof's top a little crowned; the screens straight.
    if (Math.abs(y - py) < 0.15) s.quadraticCurveTo((pz + z) / 2, Math.max(py, y) + 0.03, z, y);
    else s.lineTo(z, y);
  }
  s.lineTo(pts[0]![0], pts[0]![1]);
  return s;
}

/** An extruded side profile turned into the car's frame: profile z along -z from the nose, extruded across `width`. */
function extrude(shape: THREE.Shape, width: number, L: number, bevel: number, curveSegments = 5, bevelSegments = 2): THREE.BufferGeometry {
  const depth = Math.max(0.05, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments, curveSegments });
  // Shape x (along, from the nose) -> z - L/2; the extrusion (0..depth) -> x across, centred.
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  g.translate(depth / 2, 0, -L / 2);
  return g;
}

const boxAt = (w: number, h: number, l: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, l).translate(x, y, z);

/**
 * The parts of a car of this type, in its own frame. `light`: fewer curve and bevel steps and plainer wheels (about
 * 500 triangles instead of about 1 400), for the street cars drawn by the hundred.
 */
export function carParts(type: CarType, light = false): CarPart[] {
  const { length: L, width: W } = CAR_SIZE[type];
  const parts: CarPart[] = [];
  const curves = light ? 2 : 5;
  const steps = light ? 1 : 2;
  parts.push({ geo: extrude(bodyShape(type), W, L, 0.08, curves, steps), role: 'body' });
  const cab = cabinLine(type, L);
  const z = (from: number) => from - L / 2;
  if (cab) {
    // The glass, set in from the sides; the roof over it in the body's colour; pillars between the windows.
    parts.push({ geo: extrude(closedShape(cab), W - 0.3, L, 0.05, curves, steps), role: 'glass' });
    const roofZ0 = cab[1]![0] + 0.05;
    const roofZ1 = cab[cab.length - 2]![0] - 0.05;
    const roofY = Math.min(...cab.slice(1, -1).map((p) => p[1]));
    const roofTop = Math.max(...cab.map((p) => p[1]));
    parts.push({ geo: boxAt(W - 0.26, 0.07 + roofTop - roofY, roofZ1 - roofZ0, 0, roofY + (roofTop - roofY + 0.07) / 2 + 0.01, z((roofZ0 + roofZ1) / 2)), role: 'body' });
    const belt = cab[0]![1];
    for (const f of type === 1 ? [0.5] : [0.48]) {
      const pz = cab[1]![0] + (cab[cab.length - 2]![0] - cab[1]![0]) * f;
      parts.push({ geo: boxAt(W - 0.24, roofY - belt, 0.12, 0, belt + (roofY - belt) / 2, z(pz)), role: 'body' });
    }
  } else {
    // The van: a raked windscreen and the cab's side windows in its body.
    const a = Math.atan2(1.82 - 0.97, 1.12 - 0.4);
    const len = Math.hypot(1.12 - 0.4, 1.82 - 0.97);
    const ws = new THREE.BoxGeometry(W - 0.25, 0.05, len).rotateX(-a).translate(0, (0.97 + 1.82) / 2 + 0.02, z((0.4 + 1.12) / 2) - 0.02);
    parts.push({ geo: ws, role: 'glass' });
    parts.push({ geo: boxAt(W + 0.02, 0.62, 0.95, 0, 1.38, z(1.75)), role: 'glass' });
  }
  // Bumpers, grille, lights.
  parts.push({ geo: boxAt(W - 0.05, 0.2, 0.16, 0, 0.36, z(0.06)), role: 'trim' });
  parts.push({ geo: boxAt(W - 0.05, 0.2, 0.16, 0, 0.36, z(L - 0.06)), role: 'trim' });
  const front = topLine(type, L)[0]![1];
  parts.push({ geo: boxAt(W * 0.42, 0.14, 0.05, 0, Math.min(front - 0.12, 0.62), z(0.01)), role: 'trim' });
  for (const sx of [-1, 1]) {
    parts.push({ geo: boxAt(0.3, 0.11, 0.06, sx * (W / 2 - 0.28), Math.min(front - 0.1, 0.66), z(0.03)), role: 'light' });
    parts.push({ geo: boxAt(0.26, 0.14, 0.06, sx * (W / 2 - 0.22), type === 3 ? 0.95 : 0.78, z(L - 0.02)), role: 'tail' });
  }
  // Wheels with hubcaps.
  for (const wz of wheelBase(type)) {
    for (const sx of [-1, 1]) {
      parts.push({ geo: new THREE.CylinderGeometry(R, R, 0.22, light ? 8 : 12).rotateZ(Math.PI / 2).translate(sx * (W / 2 - 0.15), R, z(wz)), role: 'tyre' });
      if (!light) parts.push({ geo: new THREE.CylinderGeometry(0.19, 0.19, 0.02, 10).rotateZ(Math.PI / 2).translate(sx * (W / 2 - 0.03), R, z(wz)), role: 'chrome' });
    }
  }
  return parts;
}

/** Colours (sRGB hex) for the parts that do not take the body's colour. */
export const CAR_TRIM: Record<Exclude<CarRole, 'body'>, number> = {
  glass: 0x1a1f24,
  tyre: 0x151515,
  trim: 0x2b2d30,
  light: 0xefede4,
  tail: 0x9c1d1a,
  chrome: 0xbfc2c6,
};
