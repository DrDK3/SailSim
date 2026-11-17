import * as THREE from 'three';
import { drawCrown } from './burgee';
import type { ClubId } from '../sim/race/class1866';

/**
 * The Class of 1866's burgees (src/sim/race/class1866.ts, docs/SOURCES.md C66-1 to C66-4), drawn on a canvas the
 * size of the club's own (hoist on the left, fly point on the right, hoist 3 : fly 5): each from its description,
 * so the detail of the crowns, the hand and the stars is illustrative.
 */
const W = 500;
const H = 300;

const BLUE_RUYC = '#1f3b7a';
const RED = '#c8102e';
const WHITE = '#f6f5f0';
const GOLD = '#f2c14e';
const BLUE_BYC = '#1f4e9e';

function triangle(g: CanvasRenderingContext2D, fill: string): void {
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(W, H / 2);
  g.lineTo(0, H);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
}

/** A heater shield (flat top, curved sides to a point). */
function shield(g: CanvasRenderingContext2D, cx: number, top: number, w: number, h: number): void {
  g.beginPath();
  g.moveTo(cx - w / 2, top);
  g.lineTo(cx + w / 2, top);
  g.lineTo(cx + w / 2, top + h * 0.45);
  g.quadraticCurveTo(cx + w / 2, top + h * 0.85, cx, top + h);
  g.quadraticCurveTo(cx - w / 2, top + h * 0.85, cx - w / 2, top + h * 0.45);
  g.closePath();
  g.fill();
}

/** The red hand of Ulster: an open right hand, fingers up, palm facing. */
function hand(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // Palm.
  g.beginPath();
  g.moveTo(cx - 14 * s, cy - 6 * s);
  g.lineTo(cx + 14 * s, cy - 6 * s);
  g.lineTo(cx + 12 * s, cy + 18 * s);
  g.quadraticCurveTo(cx, cy + 26 * s, cx - 12 * s, cy + 18 * s);
  g.closePath();
  g.fill();
  // Wrist.
  g.fillRect(cx - 8 * s, cy + 18 * s, 16 * s, 12 * s);
  // Four fingers, the middle ones longest.
  const fingers: [number, number][] = [[-11, 18], [-3.7, 24], [3.7, 22], [11, 16]];
  for (const [dx, len] of fingers) {
    g.beginPath();
    g.roundRect(cx + (dx - 3.2) * s, cy - (6 + len) * s, 6.4 * s, (len + 2) * s, 3 * s);
    g.fill();
  }
  // Thumb, out to the side.
  g.save();
  g.translate(cx - 14 * s, cy + 6 * s);
  g.rotate(-0.9);
  g.beginPath();
  g.roundRect(-3.4 * s, -16 * s, 6.8 * s, 18 * s, 3.2 * s);
  g.fill();
  g.restore();
}

/** Royal Ulster: blue, a white shield with the red hand, a crown above it. */
function ruyc(g: CanvasRenderingContext2D): void {
  triangle(g, BLUE_RUYC);
  g.save();
  g.clip();
  g.fillStyle = WHITE;
  shield(g, 140, 128, 78, 100);
  g.fillStyle = RED;
  hand(g, 140, 166, 1.25);
  g.fillStyle = GOLD;
  drawCrown(g, 140, 94, 70);
  g.restore();
}

/** KDY: white, a royal crown in its colours with three red stars below it, two over one, in the middle. */
function kdy(g: CanvasRenderingContext2D): void {
  triangle(g, WHITE);
  g.save();
  g.clip();
  const cx = 150;
  g.fillStyle = GOLD;
  drawCrown(g, cx, 100, 72);
  g.fillStyle = RED;
  star(g, cx - 26, 160, 19);
  star(g, cx + 26, 160, 19);
  star(g, cx, 200, 19);
  g.restore();
}

/** Boston: white, a cross of blue (horizontal) and red (vertical, over it), a white star where they cross. */
function byc(g: CanvasRenderingContext2D): void {
  triangle(g, WHITE);
  g.save();
  g.clip();
  const cx = 150;
  const bar = 52;
  g.fillStyle = BLUE_BYC;
  g.fillRect(0, H / 2 - bar / 2, W, bar);
  g.fillStyle = RED;
  g.fillRect(cx - bar / 2, 0, bar, H);
  g.fillStyle = WHITE;
  star(g, cx, H / 2, 32);
  g.restore();
}

/** Atlantic: white, the red "A" of Wikimedia Commons' drawing (its outline in units of the burgee's length and hoist). */
const AYC_A: [number, number][][] = [
  [[0.3058, 0.1529], [0.3585, 0.1793], [0.4231, 0.2115], [0.8338, 0.4169], [0.8725, 0.4362], [1, 0.5], [0.9453, 0.5273], [0.8331, 0.5835], [0.6956, 0.6522], [0.3984, 0.8008], [0.3058, 0.8471], [0, 1], [0, 0.8706], [0.2866, 0.7279], [0.25, 0.5], [0.2865, 0.2729], [0, 0.1297], [0, 0]],
  [[0.3791, 0.3192], [0.35, 0.5], [0.3792, 0.6818], [0.7426, 0.5009]],
];
function ayc(g: CanvasRenderingContext2D): void {
  triangle(g, WHITE);
  g.fillStyle = RED;
  g.beginPath();
  for (const ring of AYC_A) {
    ring.forEach(([x, y], i) => (i ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H)));
    g.closePath();
  }
  g.fill('evenodd');
}

const DRAW: Record<ClubId, (g: CanvasRenderingContext2D) => void> = { ruyc, kdy, byc, ayc };

/** A club's burgee artwork (canvas, hoist on the left, fly point on the right). */
export function clubBurgeeCanvas(id: ClubId): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  DRAW[id](g);
  return c;
}

const textures = new Map<ClubId, THREE.CanvasTexture>();

/** A club's burgee texture (none outside a browser, e.g. in unit tests). */
export function clubBurgeeTexture(id: ClubId): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  let t = textures.get(id);
  if (!t) {
    t = new THREE.CanvasTexture(clubBurgeeCanvas(id));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    textures.set(id, t);
  }
  return t;
}
