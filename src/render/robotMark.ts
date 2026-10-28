import * as THREE from 'three';

/**
 * Robotic ("radio-controlled") racing marks, as now used at regattas in place of anchored inflatables: a
 * high-visibility inflatable mark on a pair of inflatable pontoons, an electric thruster pod between them below
 * the water, and a short mast with the GPS antenna and a light; the mark holds its position by GPS and lies head
 * to wind (New Atlas, Sailing Scuttlebutt, Afloat: docs/SOURCES.md M1). Published sizes disagree (a footprint of
 * about 6–8 ft by 4 ft; an inflatable about 1.3 m tall), so this one is compact: pontoons 1.5 m long, the mark
 * 1.1 m across and 1.5 m tall (E). Each carries one sponsor's name on a white band, in plain type (the sponsors'
 * own logos and colours are not reproduced); the sponsors are chosen at random, the same each time for a course.
 */

/** The sponsors named by the owner (the order the shuffle starts from). */
export const SPONSORS = ['RDYC', 'Ancaster', 'Salcombe Gin', 'Henri Lloyd'] as const;
export type Sponsor = (typeof SPONSORS)[number];

export const ROBOT_MARK = {
  pontoonLength: 1.5,
  pontoonRadius: 0.17,
  /** Centre to centre (m). */
  pontoonGap: 0.8,
  markBase: 0.55,
  markTop: 0.42,
  markHeight: 1.5,
  /** The inflatable's foot above the water (m). */
  markFoot: 0.22,
  mast: 0.6,
};

/** A small seeded generator (mulberry32) from a string. */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A sponsor for each mark: the four in a random order (seeded by `seed`, e.g. the course's id), dealt round the
 * marks in turn, so no sponsor appears twice before each has appeared once.
 */
export function sponsorsFor(markIds: readonly string[], seed: string): Map<string, Sponsor> {
  const r = rng(seed);
  const deck = [...SPONSORS];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  const out = new Map<string, Sponsor>();
  markIds.forEach((id, i) => out.set(id, deck[i % deck.length]!));
  return out;
}

const bandCache = new Map<string, THREE.Texture>();
/** The sponsor band: the name three times round (one always faces the viewer), navy on white (browser only). */
function bandTexture(name: string): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const hit = bandCache.get(name);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f7f7f4';
  g.fillRect(0, 0, 768, 96);
  g.fillStyle = '#1b2a44';
  g.font = `bold ${name.length > 8 ? 34 : 46}px 'Helvetica Neue', Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const x of [128, 384, 640]) g.fillText(name.toUpperCase(), x, 50, 220);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  bandCache.set(name, t);
  return t;
}

/**
 * One robotic mark, bow along -z, floating at y = 0: the mark in `colour`, the sponsor's band, and (for a pin end)
 * a flag on the mast. Named 'robot-mark'; the band 'robot-mark-band'.
 */
export function robotMark(colour: number, sponsor: Sponsor, flag?: number): THREE.Group {
  const M = ROBOT_MARK;
  const g = new THREE.Group();
  g.name = 'robot-mark';
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x34383d, roughness: 0.7 });
  const markMat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.4, metalness: 0.6 });
  // The pontoons, a frame across them, and the thruster pod between them (just below the water).
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CapsuleGeometry(M.pontoonRadius, M.pontoonLength - 2 * M.pontoonRadius, 4, 12).rotateX(Math.PI / 2), hullMat);
    p.position.set((s * M.pontoonGap) / 2, 0.05, 0);
    g.add(p);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(M.pontoonGap, 0.06, 0.9), hullMat);
  deck.position.y = M.markFoot - 0.03;
  g.add(deck);
  const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.35, 4, 8).rotateX(Math.PI / 2), metal);
  pod.position.set(0, -0.35, 0.2);
  g.add(pod);
  // The inflatable: a tapered cylinder with a domed top, and the white sponsor band round its middle.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(M.markTop, M.markBase, M.markHeight, 24), markMat);
  body.position.y = M.markFoot + M.markHeight / 2;
  body.castShadow = true;
  g.add(body);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(M.markTop, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), markMat);
  dome.position.y = M.markFoot + M.markHeight;
  g.add(dome);
  const bandH = 0.42;
  const yMid = M.markFoot + M.markHeight * 0.5;
  // Radius of the taper at the band's middle, plus a little so it sits on the surface.
  const rMid = M.markBase + (M.markTop - M.markBase) * 0.5 + 0.012;
  const tex = bandTexture(sponsor);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(rMid - 0.018, rMid + 0.018, bandH, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : 0xf7f7f4, map: tex ?? null, roughness: 0.55 }),
  );
  band.position.y = yMid;
  band.name = 'robot-mark-band';
  band.userData.sponsor = sponsor;
  g.add(band);
  // The mast: GPS antenna and an amber light on top.
  const top = M.markFoot + M.markHeight + M.markTop * 0.45;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, M.mast, 6), metal);
  mast.position.y = top + M.mast / 2;
  g.add(mast);
  const gps = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.4 }));
  gps.position.y = top + M.mast;
  g.add(gps);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xffa000, emissiveIntensity: 1.2 }));
  light.position.y = top + M.mast + 0.07;
  light.name = 'robot-mark-light';
  g.add(light);
  if (flag !== undefined) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.38), new THREE.MeshStandardMaterial({ color: flag, side: THREE.DoubleSide }));
    f.position.set(0.28, top + M.mast - 0.22, 0);
    f.name = 'robot-mark-flag';
    g.add(f);
  }
  return g;
}
