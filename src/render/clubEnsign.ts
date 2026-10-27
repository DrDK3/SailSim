import * as THREE from 'three';
import { RDYC_ORIGIN } from '../sim/geo/projection';
import { coloursFlying } from './colours';
import { flagDroop, flagYaw } from './vane';

let tex: THREE.Texture | undefined;
/**
 * The Royal Dart Yacht Club's ensign: a red ensign (the Union Flag in the canton) defaced in the fly with a
 * crown above a golden arrow (Flags of the World, docs/SOURCES.md). The drawing of the badge is simplified (E).
 */
function ensignTexture(): THREE.Texture | undefined {
  if (tex || typeof document === 'undefined') return tex;
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 120;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8102e';
  g.fillRect(0, 0, 240, 120);
  // Canton: the Union Flag.
  g.save();
  g.beginPath();
  g.rect(0, 0, 120, 60);
  g.clip();
  g.fillStyle = '#012169';
  g.fillRect(0, 0, 120, 60);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(120, 60);
  g.moveTo(120, 0);
  g.lineTo(0, 60);
  g.stroke();
  g.strokeStyle = '#c8102e';
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillRect(50, 0, 20, 60);
  g.fillRect(0, 20, 120, 20);
  g.fillStyle = '#c8102e';
  g.fillRect(54, 0, 12, 60);
  g.fillRect(0, 24, 120, 12);
  g.restore();
  // The badge in the fly: a crown above a golden arrow.
  g.fillStyle = '#e8b923';
  const cx = 180;
  g.fillRect(cx - 26, 82, 46, 6);
  g.beginPath();
  g.moveTo(cx + 30, 85);
  g.lineTo(cx + 16, 75);
  g.lineTo(cx + 16, 95);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(cx - 26, 85);
  g.lineTo(cx - 34, 78);
  g.lineTo(cx - 34, 92);
  g.closePath();
  g.fill();
  // Crown: a band and five points with pearls.
  g.fillRect(cx - 16, 62, 32, 7);
  g.beginPath();
  g.moveTo(cx - 16, 62);
  for (let k = 0; k <= 4; k++) {
    g.lineTo(cx - 16 + k * 8, k % 2 ? 50 : 44);
    if (k < 4) g.lineTo(cx - 12 + k * 8, 58);
  }
  g.lineTo(cx + 16, 62);
  g.closePath();
  g.fill();
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
