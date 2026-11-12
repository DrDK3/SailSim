import * as THREE from 'three';
import { facingDir } from './landmarks';

/**
 * A lettered board on a building's front: a plane just proud of the wall facing `faceDeg` (the compass bearing the
 * front looks towards), centred along it, with a depth offset so it never fights the wall for the same pixels.
 * Used for names the photographs show on a building (src/render/dart.ts). Without a canvas (tests) only the board
 * itself is drawn.
 */
export interface SignSpec {
  text: string;
  /** Height of the board's middle (m ODN). */
  y: number;
  faceDeg: number;
  /** Board size (m); the width is capped at 90 % of the wall. */
  width: number;
  height: number;
  /** Letters and board (CSS colours); the board transparent when `bg` is omitted. */
  fg: string;
  bg?: string;
  /** A darker edge round the letters (gold leaf on a light front). */
  edge?: string;
  font?: string;
}

function signTexture(s: SignSpec, w: number): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.max(32, Math.round((1024 * s.height) / w));
  const g = c.getContext('2d');
  if (!g) return undefined;
  if (s.bg) {
    g.fillStyle = s.bg;
    g.fillRect(0, 0, c.width, c.height);
  } else g.clearRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = s.font ?? `700 ${Math.round(c.height * 0.62)}px Georgia, "Times New Roman", serif`;
  if (s.edge) {
    g.lineWidth = Math.max(2, c.height * 0.05);
    g.strokeStyle = s.edge;
    g.strokeText(s.text, c.width / 2, c.height / 2 + 2, c.width - 40);
  }
  g.fillStyle = s.fg;
  g.fillText(s.text, c.width / 2, c.height / 2 + 2, c.width - 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The board on the wall of `ring` (local e, n, counter-clockwise) facing `spec.faceDeg`. */
export function buildFrontSign(name: string, ring: readonly [number, number][], spec: SignSpec): THREE.Object3D {
  const group = new THREE.Group();
  group.name = name;
  if (ring.length < 3) return group;
  const [a, b] = facingDir(ring, spec.faceDeg);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return group;
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // Outward: right of a→b on a counter-clockwise ring.
  const oe = (b[1] - a[1]) / len;
  const on = -(b[0] - a[0]) / len;
  const w = Math.min(spec.width, len * 0.9);
  const tex = signTexture(spec, w);
  const mat = tex
    ? new THREE.MeshStandardMaterial({ map: tex, transparent: !spec.bg, alphaTest: spec.bg ? 0 : 0.35, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
    : new THREE.MeshStandardMaterial({ color: spec.bg ?? '#ffffff', roughness: 0.5 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, spec.height), mat);
  plane.name = `${name}-plane`;
  plane.position.set(mid[0] + oe * 0.08, spec.y, -(mid[1] + on * 0.08));
  plane.rotation.y = Math.atan2(oe, -on);
  group.add(plane);
  return group;
}
