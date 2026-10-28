import * as THREE from 'three';
import type { QuayWall } from '../sim/env/quays';
import { stoneTex } from './rdyc';

/** Below this (m ODN) the stone is wet and weedy (about mean high water, E). */
const WEED_ODN = 2.0;
/** The wall's foot, well below the lowest tide and the bed beside it (m ODN). */
const FOOT_ODN = -4;
/** Coping stones along the top: their width and thickness (m). */
const COPING_W = 0.9;
const COPING_T = 0.3;

/**
 * The towns' quay walls (src/sim/env/quays.ts) in rubble stone, as the owner's photographs show them along both
 * waterfronts: grey-brown stone, dark with weed below high water, and a course of lighter coping stones on top.
 * One mesh; the stone is the yacht club's sea-wall texture, 2.4 by 1.2 m a repeat.
 */
export function quayMesh(walls: readonly QuayWall[]): THREE.Mesh {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], uva: number[][], ca: number[][]) => {
    for (const [p, t, k] of [[a, uva[0], ca[0]], [b, uva[1], ca[1]], [c, uva[2], ca[2]], [a, uva[0], ca[0]], [c, uva[2], ca[2]], [d, uva[3], ca[3]]] as [number[], number[], number[]][]) {
      pos.push(p[0]!, p[1]!, p[2]!);
      nor.push(n[0]!, n[1]!, n[2]!);
      uv.push(t[0]!, t[1]!);
      col.push(k[0]!, k[1]!, k[2]!);
    }
  };
  const tone = (y: number) => (y < WEED_ODN ? [0.5, 0.52, 0.42] : [1, 1, 1]);
  const coping = [1.35, 1.32, 1.25];
  for (const w of walls) {
    let s = 0;
    for (let k = 1; k < w.line.length; k++) {
      const [ae, an] = w.line[k - 1]!;
      const [be, bn] = w.line[k]!;
      const len = Math.hypot(be - ae, bn - an);
      if (len < 1e-3) continue;
      // The face looks out over the water: the right of the line's direction (the land is on its left).
      const ue = (be - ae) / len;
      const un = (bn - an) / len;
      const ne = un;
      const nn = -ue;
      const n3 = [ne, 0, -nn];
      const top = w.top;
      // The face in two bands, weedy below high water and clean above.
      for (const [y0, y1] of [[FOOT_ODN, WEED_ODN], [WEED_ODN, top]] as [number, number][]) {
        if (y1 <= y0) continue;
        quad([ae, y0, -an], [be, y0, -bn], [be, y1, -bn], [ae, y1, -an], n3, [[s / 2.4, y0 / 1.2], [(s + len) / 2.4, y0 / 1.2], [(s + len) / 2.4, y1 / 1.2], [s / 2.4, y1 / 1.2]], [tone(y0), tone(y0), tone(y0), tone(y0)]);
      }
      // Coping: its outer face, then its top, reaching back over the filled quay.
      const oe = ne * 0.05;
      const on = nn * 0.05;
      const ie = -ne * COPING_W;
      const inn = -nn * COPING_W;
      const yT = top + COPING_T;
      quad([ae + oe, top, -(an + on)], [be + oe, top, -(bn + on)], [be + oe, yT, -(bn + on)], [ae + oe, yT, -(an + on)], n3, [[s / 1.2, 0], [(s + len) / 1.2, 0], [(s + len) / 1.2, 0.25], [s / 1.2, 0.25]], [coping, coping, coping, coping]);
      quad([ae + oe, yT, -(an + on)], [be + oe, yT, -(bn + on)], [be + ie, yT, -(bn + inn)], [ae + ie, yT, -(an + inn)], [0, 1, 0], [[s / 1.2, 0.25], [(s + len) / 1.2, 0.25], [(s + len) / 1.2, 0.6], [s / 1.2, 0.6]], [coping, coping, coping, coping]);
      s += len;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const tex = stoneTex();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex ?? null, color: tex ? 0xb5aea4 : 0x6c6258, vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }));
  m.name = 'quay-walls';
  m.castShadow = m.receiveShadow = true;
  return m;
}
