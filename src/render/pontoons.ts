import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Piers, jetties and pontoons drawn in detail (they were plain boxes). A floating pontoon: black floats with
 * about 0.25 m of freeboard, a planked deck on top, fender strips along both sides, cleats every 4 m, held by
 * steel guide piles on alternate sides with a hoop that rides up and down them, and a gangway from its shore end
 * up to the bank that steepens as the tide falls. A fixed jetty: a planked deck at quay level on timber piles
 * driven into the bed, with cross beams and a rail. Sizes and spacings are typical of small-craft marinas, not
 * surveyed (E). The solid outline the boats meet is in src/sim/race/piers.ts.
 */

export interface PontoonPier {
  name: string | null;
  floating: boolean;
  line?: [number, number][];
  width?: number;
  poly?: [number, number][];
  /** A named gangway: from the shore (e, n) to the pontoon (e, n). */
  gangway?: { shore: [number, number]; pontoon: [number, number] };
}

/** Heights (m): floating pontoon deck top above the water, fixed jetty deck top (ODN), pile tops (ODN). */
export const PONTOON = {
  floatDeck: 0.42,
  floatBottom: -0.2,
  fixedDeck: 3.0,
  pileTop: 4.6,
  pileFoot: -8,
  cleatEvery: 4,
  guidePileEvery: 18,
  jettyPileEvery: 4,
};

let plankTex: THREE.Texture | undefined;
/** Deck planks across the deck, 0.15 m boards with gaps (a weathered timber or composite grey-brown). */
function plankTexture(): THREE.Texture | undefined {
  if (plankTex || typeof document === 'undefined') return plankTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d')!;
  // 8 boards across 256 px: one texture repeat is 8 boards = 1.2 m along the deck.
  for (let i = 0; i < 8; i++) {
    const shade = 120 + ((i * 37) % 23);
    g.fillStyle = `rgb(${shade + 18}, ${shade + 8}, ${shade - 6})`;
    g.fillRect(i * 32, 0, 32, 32);
    g.fillStyle = 'rgba(40, 32, 24, 0.55)';
    g.fillRect(i * 32 + 30, 0, 2, 32);
    // Grain.
    g.fillStyle = 'rgba(255, 255, 255, 0.06)';
    for (let k = 0; k < 4; k++) g.fillRect(i * 32 + 3 + k * 7, 0, 1, 32);
  }
  plankTex = new THREE.CanvasTexture(c);
  plankTex.colorSpace = THREE.SRGBColorSpace;
  plankTex.wrapS = plankTex.wrapT = THREE.RepeatWrapping;
  plankTex.anisotropy = 4;
  return plankTex;
}

/** A box along a segment: from a to b (e, n), `half` m either side, between heights y0 and y1; u runs along it in metres. */
function segmentBox(a: [number, number], b: [number, number], half: number, y0: number, y1: number, uScale = 1): THREE.BufferGeometry {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.BoxGeometry(2 * half, y1 - y0, L);
  // Top face UVs: u along the length (in board repeats), v across.
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, ((pos.getZ(i) + L / 2) / 1.2) * uScale, (pos.getX(i) + half) / (2 * half));
  }
  g.rotateY(-Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI);
  g.translate((a[0] + b[0]) / 2, (y0 + y1) / 2, -(a[1] + b[1]) / 2);
  return g;
}

function cleatGeometry(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.06, 0.05, 0.12);
  base.translate(0, 0.025, 0);
  const horn = new THREE.BoxGeometry(0.04, 0.035, 0.28);
  horn.translate(0, 0.07, 0);
  return mergeGeometries([base, horn])!;
}

export interface Gangway {
  mesh: THREE.Group;
  /** Pontoon end (e, n) and shore end (e, n, y ODN). */
  from: { e: number; n: number };
  to: { e: number; n: number; y: number };
}

export interface Pontoons {
  /** Moves with the water (decks, floats, fenders, cleats, pile hoops). */
  floating: THREE.Group;
  /** Fixed to the land (piles, jetty decks, gangways). */
  fixed: THREE.Group;
  gangways: Gangway[];
  /** Tilt the gangways for the water level (m ODN). */
  update(waterLevelOdn: number): void;
}

/** Build every pier's detail. `groundAt(e, n)` is the ground (m ODN) as the picture draws it. */
export function buildPontoons(piers: readonly PontoonPier[], groundAt: (e: number, n: number) => number): Pontoons {
  const floating = new THREE.Group();
  floating.name = 'pontoons';
  const fixed = new THREE.Group();
  fixed.name = 'pontoons-fixed';
  const tex = plankTexture();
  const deckMat = new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : 0x8a7f70, map: tex ?? null, roughness: 0.92 });
  const floatMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.7 });
  const fenderMat = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.8 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xa8adb2, roughness: 0.45, metalness: 0.6 });
  const pileMat = new THREE.MeshStandardMaterial({ color: 0x4f4a42, roughness: 0.95 });
  const decks: THREE.BufferGeometry[] = [];
  const floats: THREE.BufferGeometry[] = [];
  const fenders: THREE.BufferGeometry[] = [];
  const jettyDecks: THREE.BufferGeometry[] = [];
  const beams: THREE.BufferGeometry[] = [];
  const cleats: THREE.Matrix4[] = [];
  const guidePiles: THREE.Matrix4[] = [];
  const hoops: THREE.Matrix4[] = [];
  const jettyPiles: THREE.Matrix4[] = [];
  const rails: THREE.BufferGeometry[] = [];
  const gangways: Gangway[] = [];
  const up = new THREE.Vector3(0, 1, 0);

  const along = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  for (const p of piers) {
    if (p.line && p.line.length >= 2) {
      const half = Math.max(0.6, (p.width ?? 2.4) / 2);
      let run = 0;
      for (let i = 0; i < p.line.length - 1; i++) {
        const a = p.line[i]!;
        const b = p.line[i + 1]!;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.5) continue;
        const ue = (b[0] - a[0]) / L;
        const un = (b[1] - a[1]) / L;
        // Grow each segment by half the width at its ends so the joints are covered.
        const a2: [number, number] = [a[0] - ue * half * (i === 0 ? 0 : 1), a[1] - un * half * (i === 0 ? 0 : 1)];
        const b2: [number, number] = [b[0] + ue * half * (i === p.line.length - 2 ? 0 : 1), b[1] + un * half * (i === p.line.length - 2 ? 0 : 1)];
        const yaw = -Math.atan2(ue, un);
        const q = new THREE.Quaternion().setFromAxisAngle(up, yaw);
        if (p.floating) {
          floats.push(segmentBox(a2, b2, half - 0.05, PONTOON.floatBottom, PONTOON.floatDeck - 0.06));
          decks.push(segmentBox(a2, b2, half, PONTOON.floatDeck - 0.06, PONTOON.floatDeck));
          for (const s of [-1, 1]) {
            const off: [number, number] = [un * s * (half + 0.04), -ue * s * (half + 0.04)];
            fenders.push(segmentBox([a2[0] + off[0], a2[1] + off[1]], [b2[0] + off[0], b2[1] + off[1]], 0.05, PONTOON.floatDeck - 0.22, PONTOON.floatDeck - 0.04));
            for (let d = 1; d < L; d += PONTOON.cleatEvery) {
              const [ce, cn] = along(a, b, d / L);
              cleats.push(new THREE.Matrix4().compose(new THREE.Vector3(ce + un * s * (half - 0.15), PONTOON.floatDeck, -(cn - ue * s * (half - 0.15))), q, new THREE.Vector3(1, 1, 1)));
            }
          }
          // Guide piles on alternate sides, just outside the deck: fixed to the bed; a hoop rides on each.
          for (let d = (run % PONTOON.guidePileEvery) === 0 ? 2 : PONTOON.guidePileEvery - (run % PONTOON.guidePileEvery); d < L; d += PONTOON.guidePileEvery) {
            const k = Math.round((run + d) / PONTOON.guidePileEvery);
            const s = k % 2 === 0 ? 1 : -1;
            const [pe, pn] = along(a, b, d / L);
            const x = pe + un * s * (half + 0.3);
            const z = -(pn - ue * s * (half + 0.3));
            guidePiles.push(new THREE.Matrix4().compose(new THREE.Vector3(x, (PONTOON.pileTop + PONTOON.pileFoot) / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, PONTOON.pileTop - PONTOON.pileFoot, 1)));
            hoops.push(new THREE.Matrix4().compose(new THREE.Vector3(x, PONTOON.floatDeck - 0.1, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
          }
        } else {
          jettyDecks.push(segmentBox(a2, b2, half, PONTOON.fixedDeck - 0.12, PONTOON.fixedDeck));
          beams.push(segmentBox(a2, b2, half - 0.1, PONTOON.fixedDeck - 0.42, PONTOON.fixedDeck - 0.12, 0));
          for (let d = 0; d <= L + 1e-6; d += PONTOON.jettyPileEvery) {
            const [pe, pn] = along(a, b, Math.min(1, d / L));
            for (const s of [-1, 1]) {
              const x = pe + un * s * (half - 0.15);
              const z = -(pn - ue * s * (half - 0.15));
              const foot = Math.min(PONTOON.fixedDeck - 0.5, groundAt(x, -z));
              jettyPiles.push(new THREE.Matrix4().compose(new THREE.Vector3(x, (PONTOON.fixedDeck - 0.12 + foot - 0.5) / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, PONTOON.fixedDeck - 0.12 - foot + 0.5, 1)));
            }
          }
          // A rail along each side: posts every 2 m and a top rail (E).
          for (const s of [-1, 1]) {
            const off: [number, number] = [un * s * (half - 0.05), -ue * s * (half - 0.05)];
            rails.push(segmentBox([a2[0] + off[0], a2[1] + off[1]], [b2[0] + off[0], b2[1] + off[1]], 0.03, PONTOON.fixedDeck + 0.95, PONTOON.fixedDeck + 1.02, 0));
            for (let d = 0; d <= L; d += 2) {
              const [pe, pn] = along(a, b, d / L);
              const post = new THREE.BoxGeometry(0.06, 1.0, 0.06);
              post.translate(pe + off[0], PONTOON.fixedDeck + 0.5, -(pn + off[1]));
              rails.push(post);
            }
          }
        }
        run += L;
      }
      if (p.floating) {
        const g = gangwayFor(p.line, half, groundAt);
        if (g) gangways.push(g);
      }
    } else if (p.poly && p.poly.length >= 3) {
      const shape = new THREE.Shape(p.poly.map(([e, n]) => new THREE.Vector2(e, n)));
      const top = p.floating ? PONTOON.floatDeck : PONTOON.fixedDeck;
      const depth = p.floating ? PONTOON.floatDeck - PONTOON.floatBottom : 0.8;
      // The top face's UVs are the shape's (e, n) in metres: planks of the deck texture, world-aligned.
      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.2, uv.getY(i) / 1.2);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, top - depth, 0);
      (p.floating ? decks : jettyDecks).push(geo);
      if (p.floating) {
        const g = p.gangway
          ? makeGangway({ e: p.gangway.pontoon[0], n: p.gangway.pontoon[1] }, { e: p.gangway.shore[0], n: p.gangway.shore[1], y: groundAt(p.gangway.shore[0], p.gangway.shore[1]) + 0.05 }, 1.2)
          : gangwayFromCorner(p.poly, groundAt);
        if (g) gangways.push(g);
      }
      if (!p.floating) {
        // Piles round the edge every 5 m.
        for (let i = 0; i < p.poly.length; i++) {
          const a = p.poly[i]!;
          const b = p.poly[(i + 1) % p.poly.length]!;
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let d = 0; d < L; d += 5) {
            const [x, n] = along(a, b, d / L);
            const foot = Math.min(top - 1, groundAt(x, n));
            jettyPiles.push(new THREE.Matrix4().compose(new THREE.Vector3(x, (top - depth + foot - 0.5) / 2, -n), new THREE.Quaternion(), new THREE.Vector3(1, top - depth - foot + 0.5, 1)));
          }
        }
      }
    }
  }

  const add = (group: THREE.Group, geos: THREE.BufferGeometry[], mat: THREE.Material, name: string) => {
    if (!geos.length) return;
    const g = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)).map((x) => { for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; }));
    if (!g) return;
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);
  };
  add(floating, decks, deckMat, 'pontoon-decks');
  add(floating, floats, floatMat, 'pontoon-floats');
  add(floating, fenders, fenderMat, 'pontoon-fenders');
  add(fixed, jettyDecks, deckMat, 'jetty-decks');
  add(fixed, beams, pileMat, 'jetty-beams');
  add(fixed, rails, steelMat, 'jetty-rails');
  const inst = (group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], name: string) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.name = name;
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  };
  inst(floating, cleatGeometry(), steelMat, cleats, 'pontoon-cleats');
  inst(fixed, new THREE.CylinderGeometry(0.17, 0.17, 1, 10), steelMat, guidePiles, 'pontoon-piles');
  inst(floating, new THREE.TorusGeometry(0.26, 0.04, 6, 14).rotateX(Math.PI / 2), steelMat, hoops, 'pontoon-hoops');
  inst(fixed, new THREE.CylinderGeometry(0.15, 0.17, 1, 8), pileMat, jettyPiles, 'jetty-piles');
  for (const g of gangways) fixed.add(g.mesh);

  let lastLevel = NaN;
  return {
    floating,
    fixed,
    gangways,
    update(level: number) {
      if (Math.abs(level - lastLevel) < 0.02) return;
      lastLevel = level;
      for (const g of gangways) placeGangway(g, level);
    },
  };
}

/**
 * The gangway of a floating pontoon: from whichever end of its line has the bank nearest beyond it (ground above
 * +1 m ODN within 30 m along the line), up to that bank. None if neither end has a bank close by.
 */
function gangwayFor(line: [number, number][], half: number, groundAt: (e: number, n: number) => number): Gangway | undefined {
  let best: Gangway | undefined;
  let bestD = Infinity;
  for (const [end, prev] of [[line[0]!, line[1]!], [line[line.length - 1]!, line[line.length - 2]!]] as const) {
    const L = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1;
    const ue = (end[0] - prev[0]) / L;
    const un = (end[1] - prev[1]) / L;
    for (let d = 3; d <= 30; d += 1) {
      const e = end[0] + ue * d;
      const n = end[1] + un * d;
      const gnd = groundAt(e, n);
      if (gnd > 1.0) {
        if (d < bestD) {
          bestD = d;
          best = makeGangway({ e: end[0] - ue * 1.5, n: end[1] - un * 1.5 }, { e, n, y: gnd + 0.1 }, Math.min(1.1, 2 * half - 0.2));
        }
        break;
      }
    }
  }
  return best;
}

/** A gangway (1.1 m wide or less, with side rails) from a pontoon end to a point on the bank. */
function makeGangway(from: { e: number; n: number }, to: { e: number; n: number; y: number }, width = 1.1): Gangway {
  const mesh = new THREE.Group();
  mesh.name = 'gangway';
  const steel = new THREE.MeshStandardMaterial({ color: 0x9ea4aa, roughness: 0.5, metalness: 0.6 });
  const tread = new THREE.MeshStandardMaterial({ color: 0x6d6a64, roughness: 0.9 });
  // Built along +z from the origin, 1 m long (scaled to the span): a treaded deck, and on each side a handrail,
  // a knee rail and posts about every 1.2 m (their thickness set for the span, which changes little with the tide).
  const span = Math.max(2, Math.hypot(to.e - from.e, to.n - from.n));
  const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 1).translate(0, 0, 0.5), tread);
  deck.name = 'gangway-deck';
  mesh.add(deck);
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    parts.push(new THREE.BoxGeometry(0.05, 0.05, 1).translate((s * width) / 2, 1.0, 0.5));
    parts.push(new THREE.BoxGeometry(0.04, 0.04, 1).translate((s * width) / 2, 0.5, 0.5));
    parts.push(new THREE.BoxGeometry(0.06, 0.18, 1).translate((s * width) / 2, 0.05, 0.5));
    const posts = Math.max(2, Math.round(span / 1.2) + 1);
    for (let k = 0; k < posts; k++) parts.push(new THREE.BoxGeometry(0.05, 1.0, 0.05 / span).translate((s * width) / 2, 0.5, k / (posts - 1)));
  }
  const rails = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed()))!, steel);
  rails.name = 'gangway-rail';
  mesh.add(rails);
  return { mesh, from, to };
}

/** The gangway of a floating pontoon drawn as an outline: from the corner nearest the bank (within 25 m), straight to it. */
function gangwayFromCorner(poly: [number, number][], groundAt: (e: number, n: number) => number): Gangway | undefined {
  let best: Gangway | undefined;
  let bestD = Infinity;
  const ce = poly.reduce((a, q) => a + q[0], 0) / poly.length;
  const cn = poly.reduce((a, q) => a + q[1], 0) / poly.length;
  for (const [e0, n0] of poly) {
    // Look outward from the pontoon (away from its centre) and to either side of that.
    const out = Math.atan2(e0 - ce, n0 - cn);
    for (const da of [0, -0.6, 0.6, -1.2, 1.2]) {
      const ue = Math.sin(out + da);
      const un = Math.cos(out + da);
      for (let d = 2; d <= Math.min(25, bestD - 1); d += 1) {
        const gnd = groundAt(e0 + ue * d, n0 + un * d);
        if (gnd > 1.0) {
          bestD = d;
          best = makeGangway({ e: e0, n: n0 }, { e: e0 + ue * d, n: n0 + un * d, y: gnd + 0.1 });
          break;
        }
      }
    }
  }
  return best;
}

/** Point a gangway from its pontoon end (the deck, at this water level) up to the bank. */
export function placeGangway(g: Gangway, waterLevelOdn: number): void {
  const a = new THREE.Vector3(g.from.e, waterLevelOdn + PONTOON.floatDeck, -g.from.n);
  const b = new THREE.Vector3(g.to.e, Math.max(g.to.y, waterLevelOdn + PONTOON.floatDeck), -g.to.n);
  const d = b.clone().sub(a);
  g.mesh.position.copy(a);
  g.mesh.scale.set(1, 1, d.length());
  // +z (the span) along a→b; up stays as near vertical as it can.
  g.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), d.clone().negate(), new THREE.Vector3(0, 1, 0)));
}
