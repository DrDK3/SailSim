import * as THREE from 'three';
import { RDYC_ORIGIN } from '../sim/geo/projection';
import { coloursFlying } from './colours';
import { flagDroop, flagYaw } from './vane';

let tex: THREE.Texture | undefined;

const RED = '#d0101e';
const GOLD = '#f2c200';
const ARROW = '#ffe21a';

/** The Union Flag in a w × h box at (x, y), drawn in its 60 × 30 units: the saltires counterchanged, the cross over them. */
function unionFlag(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.save();
  g.translate(x, y);
  g.scale(w / 60, h / 30);
  g.beginPath();
  g.rect(0, 0, 60, 30);
  g.clip();
  g.fillStyle = '#012169';
  g.fillRect(0, 0, 60, 30);
  // The white saltire (6 wide).
  g.strokeStyle = '#ffffff';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(60, 30);
  g.moveTo(60, 0);
  g.lineTo(0, 30);
  g.stroke();
  // The red saltire (2 wide), counterchanged: in each quarter it lies along one edge of the white, turning round
  // the centre (the broad white above it at the hoist's top, below it in the fly's).
  g.fillStyle = '#c8102e';
  const quarters: { corner: [number, number]; nrm: [number, number]; clip: [number, number, number, number] }[] = [
    { corner: [0, 0], nrm: [-1, 2], clip: [0, 0, 30, 15] },
    { corner: [60, 0], nrm: [-1, -2], clip: [30, 0, 30, 15] },
    { corner: [60, 30], nrm: [1, -2], clip: [30, 15, 30, 15] },
    { corner: [0, 30], nrm: [1, 2], clip: [0, 15, 30, 15] },
  ];
  for (const q of quarters) {
    g.save();
    g.beginPath();
    g.rect(...q.clip);
    g.clip();
    const len = Math.hypot(q.nrm[0], q.nrm[1]);
    const nx = (q.nrm[0] / len) * 2;
    const ny = (q.nrm[1] / len) * 2;
    const [cx, cy] = q.corner;
    // From beyond the corner to beyond the centre, along the diagonal, two units wide on the normal's side.
    const dx = (30 - cx) * 1.2;
    const dy = (15 - cy) * 1.2;
    g.beginPath();
    g.moveTo(cx - dx * 0.2, cy - dy * 0.2);
    g.lineTo(cx + dx, cy + dy);
    g.lineTo(cx + dx + nx, cy + dy + ny);
    g.lineTo(cx - dx * 0.2 + nx, cy - dy * 0.2 + ny);
    g.closePath();
    g.fill();
    g.restore();
  }
  // The cross of St George, white-edged (10 wide, red 6).
  g.fillStyle = '#ffffff';
  g.fillRect(25, 0, 10, 30);
  g.fillRect(0, 10, 60, 10);
  g.fillStyle = '#c8102e';
  g.fillRect(27, 0, 6, 30);
  g.fillRect(0, 12, 60, 6);
  g.restore();
}

/** A St Edward's crown centred at (cx, cy), `s` across: red cap, gold arches with pearls, orb and cross, jewelled band, ermine. */
function crown(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const u = s / 100;
  const P = (x: number, y: number): [number, number] => [cx + x * u, cy + y * u];
  const dot = (x: number, y: number, r: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(...P(x, y), r * u, 0, Math.PI * 2);
    g.fill();
  };
  // The red velvet cap inside the arches.
  g.fillStyle = '#b5000f';
  g.beginPath();
  g.moveTo(...P(-44, 22));
  g.bezierCurveTo(...P(-50, -18), ...P(-24, -40), ...P(0, -30));
  g.bezierCurveTo(...P(24, -40), ...P(50, -18), ...P(44, 22));
  g.closePath();
  g.fill();
  // Arches: the two outer ones and the middle one, gold.
  g.strokeStyle = GOLD;
  g.lineCap = 'round';
  g.lineWidth = 6 * u;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(...P(side * 44, 20));
    g.bezierCurveTo(...P(side * 50, -18), ...P(side * 24, -40), ...P(0, -30));
    g.stroke();
  }
  g.lineWidth = 5 * u;
  g.beginPath();
  g.moveTo(...P(0, 20));
  g.lineTo(...P(0, -30));
  g.stroke();
  // Pearls along the outer arches.
  for (let i = 1; i <= 7; i++) {
    const t = i / 8;
    for (const side of [-1, 1]) {
      const bx = (1 - t) ** 3 * 44 + 3 * (1 - t) ** 2 * t * 50 + 3 * (1 - t) * t * t * 24;
      const by = (1 - t) ** 3 * 20 + 3 * (1 - t) ** 2 * t * -18 + 3 * (1 - t) * t * t * -40 + t ** 3 * -30;
      dot(side * bx * 1.0, by - 1, 3.4, '#ffffff');
    }
  }
  // Orb and cross on top.
  dot(0, -36, 8, GOLD);
  g.fillStyle = GOLD;
  g.fillRect(...P(-2.6, -62), 5.2 * u, 20 * u);
  g.fillRect(...P(-8, -56), 16 * u, 5.2 * u);
  // Crosses pattée and fleurs-de-lis on the rim (simplified as gold points).
  for (const x of [-34, -17, 0, 17, 34]) {
    g.beginPath();
    g.moveTo(...P(x - 6, 22));
    g.lineTo(...P(x, x % 34 === 0 ? 8 : 12));
    g.lineTo(...P(x + 6, 22));
    g.closePath();
    g.fill();
  }
  // The band: gold, with green and red stones.
  g.fillStyle = GOLD;
  g.fillRect(...P(-46, 20), 92 * u, 13 * u);
  for (const [x, c] of [[-30, '#1e8f4e'], [-10, '#c8102e'], [10, '#1e3f9a'], [30, '#1e8f4e']] as [number, string][]) dot(x, 26.5, 3.6, c);
  // Ermine below it: white with black tails.
  g.fillStyle = '#f4f4f2';
  g.beginPath();
  g.ellipse(...P(0, 40), 47 * u, 8 * u, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111111';
  for (const x of [-34, -20, -6, 8, 22, 36]) g.fillRect(...P(x - 1.5, 37), 3 * u, 6 * u);
}

/**
 * The Royal Dart Yacht Club's ensign: a red ensign defaced in the fly with a crown above a golden arrow pointing to the
 * hoist, a ball at its end (the owner's drawing of 14 Nov 2026, and Flags of the World, docs/SOURCES.md R6). 2 : 1,
 * the Union Flag in the upper hoist quarter. The crown's detail is simplified (E).
 */
export function rdycEnsignCanvas(): HTMLCanvasElement {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = RED;
  g.fillRect(0, 0, W, H);
  unionFlag(g, 0, 0, W / 2, H / 2);
  crown(g, W * 0.744, H * 0.42, W * 0.2);
  // The arrow: its head towards the hoist, a ball at the fly end.
  const y = H * 0.747;
  const x0 = W * 0.565;
  const x1 = W * 0.912;
  g.fillStyle = ARROW;
  g.fillRect(x0 + W * 0.04, y - H * 0.018, x1 - x0 - W * 0.04, H * 0.036);
  g.beginPath();
  g.moveTo(x0, y);
  g.lineTo(x0 + W * 0.05, y - H * 0.05);
  g.lineTo(x0 + W * 0.05, y + H * 0.05);
  g.closePath();
  g.fill();
  g.beginPath();
  g.arc(x1, y, H * 0.045, 0, Math.PI * 2);
  g.fill();
  return c;
}

/** The ensign's texture, shared (none outside a browser). */
export function rdycEnsignTexture(): THREE.Texture | undefined {
  if (tex || typeof document === 'undefined') return tex;
  tex = new THREE.CanvasTexture(rdycEnsignCanvas());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
const ensignTexture = rdycEnsignTexture;

/**
 * A club's ensign on its flagstaff's gaff, flown at colours (0800 or 0900 to sunset, src/render/colours.ts) and
 * streaming with the wind. Sizes E. Lives in the land-fixed group (positions in m ODN).
 */
export class ClubEnsign {
  readonly group = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly flag: THREE.Mesh;

  constructor(at: [number, number], fromM: number, height: number) {
    this.group.name = 'club-ensign';
    const geo = new THREE.PlaneGeometry(1.8, 0.9);
    // Hoist (the canton side) at the pivot, the fly along +x, hanging below the gaff's peak.
    geo.translate(0.9, -0.45, 0);
    const t = ensignTexture();
    this.flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: t ? 0xffffff : 0xc8102e, map: t ?? null, roughness: 0.9, side: THREE.DoubleSide }));
    this.flag.name = 'club-ensign-flag';
    this.pivot.add(this.flag);
    // The gaff's peak: aft of the mast (south) and above the yard (src/render/landmarks.ts flagstaff).
    this.pivot.position.set(at[0], fromM + height * 0.7 + 0.9, -(at[1] - 2.2));
    this.group.add(this.pivot);
  }

  /** Show it at colours, flying with the wind (from `windFromDir` rad, `windSpeed` m/s). */
  update(epochMs: number, windFromDir: number, windSpeed: number, time: number): void {
    const up = coloursFlying(epochMs, RDYC_ORIGIN.lat, RDYC_ORIGIN.lon);
    this.group.visible = up;
    if (!up) return;
    const { yaw, aws } = flagYaw(windFromDir, windSpeed, 0, 0);
    this.pivot.rotation.y = yaw + Math.min(0.1, 0.02 * aws) * Math.sin(time * (2 + aws));
    this.flag.rotation.z = -flagDroop(aws);
  }

  get flying(): boolean {
    return this.group.visible;
  }
}
