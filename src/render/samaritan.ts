import * as THREE from 'three';
import { Kit, VMAT, cabin, hull, place } from './vessels';

/**
 * The race committee boat: SAMARITAN, a Southerly deck-saloon sloop, drawn from the owner's photograph of her
 * at her berth (31 Oct 2026): white hull, the saloon's long window band, a navy blue sprayhood and cockpit
 * canopy, a navy sail cover on the boom, a radome on the mast and a solar panel on the coachroof.
 *
 * Her model is not known from the photograph. The principal dimensions are the Southerly 110's (10.82 m
 * overall, 3.57 m beam; broker listings, docs/SOURCES.md V14), an estimate (E) until the owner confirms the
 * model. Shapes, heights, colours and where the name is painted are estimated from the photograph (E).
 * Visual only: the race physics still treat the committee boat as a 2.5 m circle at the line's end
 * (OUTSTANDING_ISSUES 111).
 */

export const SAMARITAN = { name: 'SAMARITAN', loa: 10.82, beam: 3.57 };

const NAVY = 0x1d2a47;
const WHITE = 0xf6f6f2;
const ALLOY = 0xd6d9dc;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The boat's name for her topsides: navy capitals on a clear background (null without a DOM, e.g. tests). */
function nameTexture(text: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const g = c.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, c.width, c.height);
  g.font = "700 108px 'Helvetica Neue', Arial, sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#1d2a47';
  g.letterSpacing = '10px';
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * The committee boat, bow towards −z (the model frame of src/render/vessels.ts), centred on the origin at the
 * waterline. Named meshes: `samaritan-body`, `samaritan-name-port`, `samaritan-name-starboard`.
 */
export function samaritanModel(): THREE.Group {
  const kit = new Kit();
  const L = SAMARITAN.loa;
  const beam = SAMARITAN.beam;
  const h = hull(kit, {
    length: L, beam, freeboard: 1.2, draft: 0.6, sheerBow: 0.28, sheerStern: 0.06, stemRake: 0.55, entry: 0.48, transom: 0.86, transomRake: -0.4,
    deadrise: 0.3, flare: 0.05, colours: { bottom: 0x1f2a36, boot: NAVY, topsides: WHITE, deck: 0xe6e6e0, stripe: NAVY }, bootTop: 0.08, stripe: [0.16, 0.12],
    stations: 30, sections: 12,
  });
  // Deck saloon: a long, low coachroof with a band of dark windows all round its sides and front.
  const sz = -0.55;
  const sl = 4.4;
  const sy = h.deck(sz) - 0.02;
  cabin(kit, { z: sz, y: sy, length: sl, width: beam - 1.05, height: 0.72, rFront: 1.05, rBack: 0.25, rake: 0.5, tumble: 0.2, colour: WHITE, windows: [0.32, 0.78], front: [0.3, 0.8], noBackWindows: true, corner: 4 });
  const roofY = sy + 0.72;
  // Solar panel on the coachroof, just aft of the mast.
  const mastZ = sz - sl / 2 + 0.55;
  kit.box(0.95, 0.04, 0.6, VMAT.paint, 0x16202e, 0, roofY + 0.03, mastZ + 0.75);
  // Navy sprayhood and cockpit canopy over the whole cockpit (a half-cylinder hood, its ends closed).
  const cz0 = sz + sl / 2 - 0.1;
  const cz1 = L / 2 - 0.75;
  const clen = cz1 - cz0;
  const deckAt = h.deck((cz0 + cz1) / 2);
  const hood = new THREE.CylinderGeometry(1.25, 1.25, clen, 16, 1, false, -Math.PI / 2, Math.PI);
  hood.rotateX(-Math.PI / 2); // the curved half up, its axis fore and aft
  hood.scale(1, 0.95, 1);
  kit.add(hood, VMAT.canvas, NAVY, place(0, deckAt + 0.15, (cz0 + cz1) / 2));
  for (const z of [cz0, cz1]) {
    const end = new THREE.CircleGeometry(1.25, 16, 0, Math.PI);
    end.scale(1, 0.95, 1);
    kit.add(end, VMAT.canvas, NAVY, place(0, deckAt + 0.15, z));
  }
  // The hood's clear windows (dark from outside), front and sides.
  kit.add(new THREE.PlaneGeometry(1.4, 0.38), VMAT.glass, undefined, place(0, deckAt + 0.95, cz0 - 0.01, Math.PI));
  for (const s of [-1, 1]) kit.add(new THREE.PlaneGeometry(0.9, 0.32), VMAT.glass, undefined, place(s * 1.14, deckAt + 0.72, cz0 + 0.75, s * Math.PI / 2));
  // Mast, spreaders, radome; boom with its navy sail cover (stack pack); furled genoa on the forestay.
  const top = 14.0;
  const mastFoot = roofY;
  kit.add(new THREE.CylinderGeometry(0.07, 0.1, top - mastFoot, 8), VMAT.paint, ALLOY, place(0, (top + mastFoot) / 2, mastZ));
  for (const y of [5.6, 9.6]) kit.add(new THREE.BoxGeometry(2.3 - (y - 5.6) * 0.15, 0.05, 0.08), VMAT.paint, ALLOY, place(0, y, mastZ));
  kit.add(new THREE.CylinderGeometry(0.32, 0.32, 0.26, 16), VMAT.paint, 0xf4f4f2, place(0, 4.4, mastZ - 0.28));
  const boomY = roofY + 1.0;
  const boomEnd = L / 2 - 1.1;
  const blen = boomEnd - mastZ;
  kit.add(new THREE.CylinderGeometry(0.07, 0.07, blen, 8), VMAT.paint, ALLOY, place(0, boomY, mastZ + blen / 2, 0, Math.PI / 2));
  kit.add(new THREE.CapsuleGeometry(0.26, blen - 0.6, 3, 10).scale(0.85, 1, 1.25), VMAT.canvas, NAVY, place(0, boomY + 0.3, mastZ + blen / 2, 0, Math.PI / 2));
  const stem = V(0, h.sheer(-L / 2 + 0.15) + 0.05, -L / 2 + 0.2);
  const hounds = V(0, top - 1.6, mastZ);
  const fl = stem.distanceTo(hounds);
  const furl = new THREE.CylinderGeometry(0.03, 0.07, fl * 0.9, 8);
  kit.add(furl, VMAT.canvas, NAVY, new THREE.Matrix4().compose(stem.clone().lerp(hounds, 0.47), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), hounds.clone().sub(stem).normalize()), V(1, 1, 1)));
  // Standing rigging: backstay, cap shrouds and lowers.
  kit.rod(V(0, h.sheer(L / 2) + 0.1, L / 2 - 0.25), V(0, top, mastZ + 0.05), 0.01, VMAT.paint, 0x9aa0a6, 4);
  for (const s of [-1, 1]) {
    const chain = V(s * (h.half(mastZ + 0.2) - 0.1), h.sheer(mastZ + 0.2), mastZ + 0.2);
    kit.rod(chain, V(0, top - 0.3, mastZ), 0.009, VMAT.paint, 0x9aa0a6, 4);
    kit.rod(chain, V(s * 0.08, 5.6, mastZ), 0.009, VMAT.paint, 0x9aa0a6, 4);
  }
  // Pulpit, pushpit, stanchions and guard wires.
  for (const s of [-1, 1]) {
    const line = h.sheerLine(s, 0.12, 0.06, 0.95);
    const wire = line.map((p) => p.clone().setY(p.y + 0.62));
    const pts = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => wire[Math.round(f * (wire.length - 1))]!);
    for (let k = 1; k < pts.length; k++) kit.rod(pts[k - 1]!, pts[k]!, 0.012, VMAT.steel, undefined, 4);
    for (const p of pts) kit.rod(p.clone().setY(p.y - 0.62), p, 0.014, VMAT.steel, undefined, 4);
  }
  const bowRail = [-1, -0.5, 0, 0.5, 1].map((f) => V(f * 0.55, h.sheer(-L / 2 + 0.6) + 0.62, -L / 2 + 0.6 + Math.abs(f) * 0.35));
  for (let k = 1; k < bowRail.length; k++) kit.rod(bowRail[k - 1]!, bowRail[k]!, 0.014, VMAT.steel, undefined, 4);
  // Bow roller with the anchor.
  kit.box(0.18, 0.12, 0.5, VMAT.steel, undefined, 0, h.sheer(-L / 2) + 0.02, -L / 2 + 0.05);
  // The committee boat's flag (orange, by the sailing instructions' usual convention) on a staff at the stern.
  kit.rod(V(0.6, h.sheer(L / 2 - 0.3), L / 2 - 0.3), V(0.6, h.sheer(L / 2 - 0.3) + 2.4, L / 2 - 0.3), 0.02, VMAT.paint, 0xcfcfca, 6);
  kit.add(new THREE.PlaneGeometry(1.0, 0.65), VMAT.canvas, 0xff7a1a, place(0.6, h.sheer(L / 2 - 0.3) + 2.05, L / 2 + 0.2, Math.PI / 2));
  const g = kit.build('samaritan');
  for (const c of g.children) {
    (c as THREE.Mesh).castShadow = true;
    (c as THREE.Mesh).receiveShadow = true;
  }
  // Her name on both bows, on the white topsides between the stripe and the boot top.
  const map = nameTexture(SAMARITAN.name);
  if (map) {
    const mat = new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const s of [-1, 1]) {
      const z = -L / 2 + 2.3;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.36), mat);
      plane.position.set(s * (h.half(z) + 0.035), h.sheer(z) - 0.45, z);
      // Facing outboard, reading left to right as seen from alongside (aft to forward on starboard).
      plane.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      plane.name = s > 0 ? 'samaritan-name-starboard' : 'samaritan-name-port';
      g.add(plane);
    }
  }
  return g;
}
