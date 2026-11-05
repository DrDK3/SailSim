import * as THREE from 'three';

/**
 * Noss on Dart, the former Philip & Son shipyard (owner's photographs, 5 Nov 2026; NO1): the lettering on the
 * shipbuilding hall's river gable, PHILIP & SON LTD · SHIPBUILDERS & ENGINEERS, white on the red brick, with the
 * three round windows high in the gable above it. The hall itself (brick, grey roof) is a landmark look
 * (src/render/landmarks.ts 'noss-philip-hall'); this adds only what the look cannot carry.
 */

/** A point inside the hall's footprint (local e, n): the same as its landmark look. */
export const NOSS_HALL_AT: [number, number] = [-188, 2106];
/** Where the river is from the hall (local e, n): its lettered gable is the end facing it. */
const RIVER: [number, number] = [-300, 2100];

/** The gable end of a four-sided footprint that faces `toward`: its two corners (e, n), counter-clockwise order kept. */
export function gableFacing(ring: readonly (readonly [number, number])[], toward: [number, number]): [[number, number], [number, number]] | undefined {
  if (ring.length < 4) return undefined;
  let best: [[number, number], [number, number]] | undefined;
  let bestScore = Infinity;
  // The short sides are the gable ends (the ridge runs along the long axis).
  const sides = ring.map((a, i) => [a, ring[(i + 1) % ring.length]!] as const);
  const lens = sides.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
  const shortest = [...lens].sort((x, y) => x - y)[1]!;
  sides.forEach(([a, b], i) => {
    if (lens[i]! > shortest + 0.5) return;
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = Math.hypot(m[0]! - toward[0], m[1]! - toward[1]);
    if (d < bestScore) {
      bestScore = d;
      best = [[a[0], a[1]], [b[0], b[1]]];
    }
  });
  return best;
}

function letteringTexture(): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 640;
  const g = c.getContext('2d');
  if (!g) return undefined;
  g.clearRect(0, 0, c.width, c.height);
  // The three round windows high in the gable.
  for (const x of [372, 512, 652]) {
    g.beginPath();
    g.arc(x, 150, 46, 0, Math.PI * 2);
    g.fillStyle = '#2d3238';
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = '#e9e4da';
    g.stroke();
  }
  g.fillStyle = '#f4f1ea';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '600 74px Georgia, "Times New Roman", serif';
  g.fillText('PHILIP & SON LTD', 512, 340);
  g.font = '600 92px Georgia, "Times New Roman", serif';
  g.fillText('SHIPBUILDERS & ENGINEERS.', 512, 470);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The lettering and round windows on the hall's gable facing the river: a plane just proud of the wall (with a
 * depth offset, so it never fights the wall for the same pixels), from below the eaves up into the gable.
 * `ring` is the hall's footprint (local e, n), `eaves` and `top` its eaves and ridge (m ODN).
 */
export function buildNossLettering(ring: readonly (readonly [number, number])[], eaves: number, top: number): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'noss-lettering';
  const tex = letteringTexture();
  const end = gableFacing(ring, RIVER);
  if (!tex || !end) return group;
  const [a, b] = end;
  const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // Outward: away from the footprint's centre.
  const ce = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cn = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  let oe = mid[0] - ce;
  let on = mid[1] - cn;
  const ol = Math.hypot(oe, on) || 1;
  oe /= ol;
  on /= ol;
  const h = Math.min(width * 0.62, top - eaves + 5.5);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.92, h),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  plane.name = 'noss-lettering-plane';
  // A plane faces +z; turn it to face outward (three.js: x = east, z = −north).
  plane.position.set(mid[0] + oe * 0.12, top - h / 2 - 0.3, -(mid[1] + on * 0.12));
  plane.rotation.y = Math.atan2(oe, -on);
  group.add(plane);
  return group;
}
