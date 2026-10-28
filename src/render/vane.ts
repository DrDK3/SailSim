import * as THREE from 'three';

/**
 * Wind indicators on boats other than the Squibs (whose burgees are in burgee.ts): the ensigns of the river
 * traffic fly with the wind each boat feels (the true wind less its own way), and the masthead vanes (Windex
 * type) of boats lying on moorings and in the marinas point into the true wind.
 */

/**
 * The yaw (three.js rotation.y, in the boat's model frame: x starboard, z aft) that flies a flag whose fly
 * extends along +x, from its hoist, the way the apparent wind blows; and the apparent wind speed (m/s).
 * `windFromDir` is the compass direction the wind comes from, `heading` the boat's (both rad), `sog` its speed
 * (m/s, taken along the heading: a ferry's crab into the stream is ignored, E).
 */
export function flagYaw(windFromDir: number, tws: number, heading: number, sog: number): { yaw: number; aws: number } {
  // Air velocity over the ground (moving away from where it comes from), less the boat's.
  const an = -tws * Math.cos(windFromDir) - sog * Math.cos(heading);
  const ae = -tws * Math.sin(windFromDir) - sog * Math.sin(heading);
  // Ahead (along the bow) and to starboard, in the boat frame.
  const fwd = an * Math.cos(heading) + ae * Math.sin(heading);
  const stbd = -an * Math.sin(heading) + ae * Math.cos(heading);
  // The fly points along (stbd, -fwd) in (x, z): +x turned by rotation.y = a is (cos a, -sin a).
  return { yaw: Math.atan2(fwd, stbd), aws: Math.hypot(fwd, stbd) };
}

/** How far a flag hangs below the horizontal (rad): limp in a calm, nearly straight out from about 6 m/s (E). */
export function flagDroop(aws: number): number {
  return 1.35 * Math.exp(-aws / 2.2);
}

/**
 * The world yaw (three.js rotation.y) that points a vane's arrow (built along -z) into the wind: -fromDir, the
 * same convention as a boat's heading.
 */
export function vaneYaw(windFromDir: number): number {
  return -windFromDir;
}

/**
 * A masthead wind vane: a spindle, the arrow along -z (into the wind) and a pair of tail fins splayed aft, the
 * vane 0.38 m long overall (a Windex 15, sold for 5-12 m boats, has a 15 in vane: SOURCES.md R2). The pivot is at the origin.
 */
export function windexGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const spindle = new THREE.CylinderGeometry(0.007, 0.007, 0.2, 4);
  spindle.translate(0, 0.1, 0);
  parts.push(spindle);
  const shaft = new THREE.CylinderGeometry(0.005, 0.005, 0.38, 4);
  shaft.rotateX(Math.PI / 2);
  shaft.translate(0, 0.2, 0.04);
  parts.push(shaft);
  const head = new THREE.ConeGeometry(0.02, 0.06, 4);
  head.rotateX(-Math.PI / 2);
  head.translate(0, 0.2, -0.17);
  parts.push(head);
  for (const s of [-1, 1]) {
    // Each fin a thin triangle, splayed 12° off the centreline (the vee).
    const fin = new THREE.BufferGeometry();
    fin.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.21, 0.1, 0, 0.29, 0.23, 0, 0.19, 0.23], 3));
    fin.computeVertexNormals();
    fin.rotateY(s * 0.21);
    parts.push(fin);
  }
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    const a = g.getAttribute('position');
    for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i));
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.computeVertexNormals();
  return merged;
}
