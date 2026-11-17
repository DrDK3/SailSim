import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isletGeometry } from './islets';
import { glowSprite } from './navLights';
import { KINGSWEAR_LIGHT, inWhiteSector, kingswearLightLocal, kingswearRockOutline, kingswearRockTop } from '../sim/env/shoreLights';

/**
 * The Kingswear light (src/sim/env/shoreLights.ts): a large rock at the water's edge, and on it a compact round
 * tower 4 m high with a conical lantern, its window facing south-west over the entrance. At night its light shows
 * white to a viewer inside the white sector (325°–331°), isophase every 3 s; the red and green sectors are not
 * drawn (their limits are not established). The tower's colours are estimates (E). Land-fixed group (m ODN).
 */
export class KingswearLightView {
  readonly group = new THREE.Group();
  private readonly glow: THREE.Sprite;

  constructor() {
    this.group.name = 'kingswear-light';
    const c = kingswearLightLocal();
    const top = kingswearRockTop();
    // The islets' rock, a shade darker, as the slate along this shore (src/render/coastRocks.ts).
    const rock = new THREE.Mesh(isletGeometry(kingswearRockOutline(), top, 41), new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x8c8780, roughness: 0.95, flatShading: true }));
    rock.name = 'kingswear-light-rock';
    rock.castShadow = rock.receiveShadow = true;
    this.group.add(rock);
    const { height: H, radius: R } = KINGSWEAR_LIGHT.tower;
    const white = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHex(0xf1f0ea, THREE.SRGBColorSpace), roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHex(0x23272b, THREE.SRGBColorSpace), roughness: 0.5, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHex(0x1c2a33, THREE.SRGBColorSpace), roughness: 0.15, metalness: 0.4 });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.92, R, H - 1.1, 20), white);
    tower.position.y = (H - 1.1) / 2;
    // The lantern: a dark band with the window (towards the south-west), then the conical roof and a vent.
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.78, R * 0.82, 0.6, 20), dark);
    lantern.position.y = H - 1.1 + 0.3;
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.12), glass);
    // South-west (bearing 225°): +x east, -z north in the land-fixed frame.
    const sw = (225 * Math.PI) / 180;
    window.position.set(Math.sin(sw) * R * 0.8, H - 1.1 + 0.3, -Math.cos(sw) * R * 0.8);
    window.rotation.y = -sw;
    const roof = new THREE.Mesh(mergeGeometries([new THREE.ConeGeometry(R * 0.95, 0.55, 20).translate(0, 0.275, 0), new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8).translate(0, 0.6, 0)])!, dark);
    roof.position.y = H - 0.5;
    const tg = new THREE.Group();
    tg.name = 'kingswear-light-tower';
    tg.add(tower, lantern, window, roof);
    tg.position.set(c.e, top, -c.n);
    for (const m of [tower, lantern, roof]) m.castShadow = m.receiveShadow = true;
    this.group.add(tg);
    this.glow = glowSprite('white');
    this.glow.name = 'kingswear-light-glow';
    this.glow.position.set(c.e, top + H - 1.1 + 0.3, -c.n);
    this.glow.visible = false;
    this.group.add(this.glow);
  }

  /** At night (`lit`), the light shows to the camera in its white sector, on and off every 1.5 s. */
  update(camera: THREE.Camera, timeS: number, lit: boolean): void {
    const e = camera.position.x;
    const n = -camera.position.z;
    const on = ((timeS % KINGSWEAR_LIGHT.period) + KINGSWEAR_LIGHT.period) % KINGSWEAR_LIGHT.period < KINGSWEAR_LIGHT.period / 2;
    this.glow.visible = lit && on && inWhiteSector(e, n);
  }

  /** Whether its light shows now (for tests). */
  get showing(): boolean {
    return this.glow.visible;
  }
}
