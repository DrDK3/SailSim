import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The Daymark ("The Tower"), Kingswear: the Dartmouth Harbour Commissioners' day beacon of 1864 on the hill above
 * Froward Point, a guide to the harbour entrance. A hollow octagonal limestone tower 24 m (80 ft) high on arched legs
 * (Historic England list entry 1108546, Grade II; Wikipedia "Kingswear Daymark", via search: docs/SOURCES.md D1-D2).
 * It stands at the list entry's grid reference, SX 90334 50283 (here 50.34223 N, 3.54252 W). The legs' proportions,
 * the arches and the taper are drawn from photographs (E). Drawn in the land-fixed group (m ODN).
 */

export const DAYMARK = { lat: 50.342227, lon: -3.542523, height: 24 };

const STONE = 0xd2cec3;

/** The tower, its foot at (e, n) on ground `ground` (m ODN). */
export function buildDaymark(e: number, n: number, ground: number): THREE.Mesh {
  const H = DAYMARK.height;
  const legs = 6.5;
  const rBase = 3.4;
  const parts: THREE.BufferGeometry[] = [];
  // Eight legs at the octagon's corners, leaning in with the taper, and a ring course over the arches.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const leg = new THREE.BoxGeometry(1.0, legs, 1.0);
    leg.translate(Math.cos(a) * (rBase - 0.5), legs / 2, Math.sin(a) * (rBase - 0.5));
    parts.push(leg);
    // The arch's head between this leg and the next: a block across the top of the opening.
    const b = a + Math.PI / 8;
    const head = new THREE.BoxGeometry(2.0, 1.2, 0.8);
    head.rotateY(-b + Math.PI / 2);
    head.translate(Math.cos(b) * (rBase - 0.55), legs - 0.6, Math.sin(b) * (rBase - 0.55));
    parts.push(head);
  }
  const course = new THREE.CylinderGeometry(rBase - 0.15, rBase, 0.6, 8, 1);
  course.rotateY(Math.PI / 8);
  course.translate(0, legs + 0.3, 0);
  parts.push(course);
  // The octagonal shaft, tapering to a point, with a small finial.
  const shaft = new THREE.CylinderGeometry(0.35, rBase - 0.25, H - legs - 1.2, 8, 3);
  shaft.rotateY(Math.PI / 8);
  shaft.translate(0, legs + 0.6 + (H - legs - 1.2) / 2, 0);
  parts.push(shaft);
  const tip = new THREE.ConeGeometry(0.35, 0.6, 8);
  tip.rotateY(Math.PI / 8);
  tip.translate(0, H - 0.3, 0);
  parts.push(tip);
  const geo = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHex(STONE, THREE.SRGBColorSpace), roughness: 0.9, flatShading: true }));
  mesh.name = 'daymark';
  mesh.position.set(e, ground - 0.3, -n);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
