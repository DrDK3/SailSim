import * as THREE from 'three';

/**
 * The Royal Dart Yacht Club burgee at the masthead. Its blazon, from the club's rules (rule 3.1, docs/SOURCES.md
 * R8): "a Burgee Gules charged in fess by a royal crown and dart in flight to the sinister Or" - a red
 * triangular flag carrying, side by side across its middle, a gold royal crown and a gold dart flying
 * towards the fly. The proportions (hoist 3 : fly 5) follow the Wikimedia Commons drawing (R10); the
 * crown and dart are drawn here from the blazon, so their detail is illustrative.
 *
 * The flag streams in the apparent wind at the masthead, like the real one on its spindle: it is a visual
 * wind indicator, read from the physics' apparent wind.
 */
export const BURGEE_GULES = '#c8102e';
export const BURGEE_OR = '#f2c14e';
const W = 500;
const H = 300;

let texture: THREE.CanvasTexture | undefined;

/** The burgee artwork (canvas, hoist on the left, fly point on the right). */
export function burgeeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(W, H / 2);
  g.lineTo(0, H);
  g.closePath();
  g.fillStyle = BURGEE_GULES;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = BURGEE_OR;
  g.strokeStyle = BURGEE_OR;
  drawCrown(g, 120, H / 2 + 6, 112);
  drawDart(g, 215, 400, H / 2);
  g.restore();
  return c;
}

/** A royal crown: jewelled band, rim of pearls, two arches meeting under an orb and cross. */
function drawCrown(g: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const s = size / 100;
  const band = { x: cx - 42 * s, y: cy + 18 * s, w: 84 * s, h: 18 * s };
  g.fillRect(band.x, band.y, band.w, band.h);
  // Arches: from the band's ends up to the centre, filled as a bonnet shape.
  g.beginPath();
  g.moveTo(cx - 42 * s, cy + 18 * s);
  g.bezierCurveTo(cx - 52 * s, cy - 20 * s, cx - 20 * s, cy - 36 * s, cx, cy - 26 * s);
  g.bezierCurveTo(cx + 20 * s, cy - 36 * s, cx + 52 * s, cy - 20 * s, cx + 42 * s, cy + 18 * s);
  g.closePath();
  g.fill();
  // The field shows through between the arches (the crown's cap), so the arches read as arches.
  g.fillStyle = BURGEE_GULES;
  g.beginPath();
  g.moveTo(cx - 30 * s, cy + 14 * s);
  g.bezierCurveTo(cx - 34 * s, cy - 10 * s, cx - 14 * s, cy - 22 * s, cx - 4 * s, cy - 16 * s);
  g.lineTo(cx - 4 * s, cy + 14 * s);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(cx + 30 * s, cy + 14 * s);
  g.bezierCurveTo(cx + 34 * s, cy - 10 * s, cx + 14 * s, cy - 22 * s, cx + 4 * s, cy - 16 * s);
  g.lineTo(cx + 4 * s, cy + 14 * s);
  g.closePath();
  g.fill();
  // Jewels on the band.
  for (const dx of [-28, 0, 28]) {
    g.beginPath();
    g.arc(cx + dx * s, band.y + band.h / 2, 4.5 * s, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = BURGEE_OR;
  // Pearls along the arches and the rim.
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    for (const side of [-1, 1]) {
      const x = cx + side * (42 - 40 * t) * s;
      const y = cy + 16 * s - Math.sin(t * Math.PI * 0.95) * 38 * s;
      g.beginPath();
      g.arc(x, y, 3.2 * s, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Orb and cross.
  g.beginPath();
  g.arc(cx, cy - 32 * s, 8 * s, 0, Math.PI * 2);
  g.fill();
  g.fillRect(cx - 2.5 * s, cy - 56 * s, 5 * s, 18 * s);
  g.fillRect(cx - 8 * s, cy - 50 * s, 16 * s, 5 * s);
}

/** A dart in flight towards the fly (right): barbed head, shaft and flights. */
function drawDart(g: CanvasRenderingContext2D, x0: number, x1: number, y: number): void {
  const len = x1 - x0;
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x0 + 0.12 * len, y);
  g.lineTo(x1 - 0.12 * len, y);
  g.stroke();
  // Head.
  g.beginPath();
  g.moveTo(x1, y);
  g.lineTo(x1 - 0.16 * len, y - 14);
  g.lineTo(x1 - 0.12 * len, y);
  g.lineTo(x1 - 0.16 * len, y + 14);
  g.closePath();
  g.fill();
  // Flights.
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(x0 + 0.2 * len, y);
    g.lineTo(x0, y + side * 22);
    g.lineTo(x0 + 0.08 * len, y + side * 22);
    g.lineTo(x0 + 0.26 * len, y);
    g.closePath();
    g.fill();
  }
}

function burgeeTexture(): THREE.CanvasTexture {
  if (!texture) {
    texture = new THREE.CanvasTexture(burgeeCanvas());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }
  return texture;
}

/** Burgee size (m): hoist 3 : fly 5 (R10). Size on a Squib's burgee stick: an estimate. */
export const BURGEE_FLY = 0.4;
export const BURGEE_HOIST = 0.24;
/** Burgee stick above the masthead (m, E). */
export const BURGEE_STICK = 0.7;

const NU = 14;
const NV = 4;

export class Burgee {
  readonly group = new THREE.Group();
  private readonly flag: THREE.Mesh;
  private readonly geo: THREE.PlaneGeometry;
  private readonly rest: Float32Array;

  constructor() {
    this.group.name = 'burgee';
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, BURGEE_STICK, 6), new THREE.MeshStandardMaterial({ color: 0x8b6a43, roughness: 0.6 }));
    stick.position.y = BURGEE_STICK / 2;
    this.geo = new THREE.PlaneGeometry(BURGEE_FLY, BURGEE_HOIST, NU, NV);
    // Hoist at x = 0 (on the spindle), fly towards +x.
    this.geo.translate(BURGEE_FLY / 2, 0, 0);
    this.rest = Float32Array.from(this.geo.getAttribute('position').array as Float32Array);
    // Bunting is matt; a little below full albedo so the sunlit red stays red under the tone mapping.
    this.flag = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ map: burgeeTexture(), color: 0xa8a8a8, side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.9 }));
    this.flag.name = 'burgee-flag';
    this.flag.position.y = BURGEE_STICK - BURGEE_HOIST / 2 - 0.01;
    this.group.add(stick, this.flag);
  }

  /**
   * Stream the flag in the apparent wind: `awa` (rad, > 0 from starboard) and `aws` (m/s) in the boat's frame
   * (model x = starboard, z = aft). It droops in light air and flutters faster as the wind rises.
   */
  update(awa: number, aws: number, time: number): void {
    // Fly direction: away from where the wind comes from.
    this.flag.rotation.y = Math.atan2(-Math.cos(awa), -Math.sin(awa));
    const droop = 1 / (1 + (aws / 1.5) ** 2);
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const freq = 1.2 + 0.35 * aws;
    const amp = 0.05 * (0.4 + Math.min(1, aws / 8));
    for (let i = 0; i < pos.count; i++) {
      const x = this.rest[i * 3]!;
      const y = this.rest[i * 3 + 1]!;
      const f = x / BURGEE_FLY;
      const wave = amp * f * Math.sin(f * 7 - time * freq * 2 * Math.PI) + 0.4 * amp * f * Math.sin(f * 13 - time * freq * 3.1 + y * 9);
      // Droop: the fly swings down towards the stick in light air.
      const a = droop * 1.25;
      pos.setXYZ(i, x * Math.cos(a), y - x * Math.sin(a), wave);
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
