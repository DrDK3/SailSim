import * as THREE from 'three';
import { facing } from './landmarks';

/**
 * The Royal Castle Hotel on the Quay, Dartmouth, facing the Boatfloat: its name in gold letters across the white
 * front between the upper floors, as a picture of the front shows it (Mike White, 2008, Geograph 940043,
 * CC BY-SA 2.0; docs/SOURCES.md M2). The building itself (white render, navy window surrounds, a castellated
 * parapet with corner turrets, slate roof) is a landmark look (src/render/landmarks.ts 'royal-castle-hotel'); this
 * adds only what the look cannot carry. Letter size and height on the front E.
 */

/** A point inside the hotel's footprint (local e, n): the same as its landmark look. */
export const ROYAL_CASTLE_AT: [number, number] = [-375, 390];

function letteringTexture(): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 88;
  const g = c.getContext('2d');
  if (!g) return undefined;
  g.clearRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 70px Georgia, "Times New Roman", serif';
  // Gold leaf: a darker edge so the letters read on white.
  g.lineWidth = 5;
  g.strokeStyle = '#6b5418';
  g.strokeText('ROYAL  CASTLE  HOTEL', 512, 46, 1000);
  g.fillStyle = '#d8b04a';
  g.fillText('ROYAL  CASTLE  HOTEL', 512, 46, 1000);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The lettering on the front facing the Boatfloat (east): a plane just proud of the wall, with a depth offset so it
 * never fights the wall for the same pixels, in the band between the third storey's window heads and the fourth's
 * sills. `ring` is the footprint (local e, n, counter-clockwise), `base` the foot of its walls (m ODN).
 */
export function buildRoyalCastleLettering(ring: readonly (readonly [number, number])[], base: number): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'royal-castle-lettering';
  const tex = letteringTexture();
  if (!tex || ring.length < 3) return group;
  const [a, b] = facing(ring as [number, number][], 30, 130);
  const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // Outward: right of a→b on a counter-clockwise ring.
  const oe = (b[1] - a[1]) / width;
  const on = -(b[0] - a[0]) / width;
  const w = Math.min(width * 0.7, 11);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, (w * 88) / 1024),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, roughness: 0.35, metalness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  plane.name = 'royal-castle-lettering-plane';
  // Between the window heads of the third storey (2.38 m into it) and the sills of the fourth (0.48 m into it).
  plane.position.set(mid[0] + oe * 0.06, base + 2 * 2.8 + 2.85, -(mid[1] + on * 0.06));
  plane.rotation.y = Math.atan2(oe, -on);
  group.add(plane);
  return group;
}
