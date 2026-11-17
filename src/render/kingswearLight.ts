import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isletGeometry } from './islets';
import { glowSprite, letterSprite } from './navLights';
import { BAYARDS_COVE_LIGHT, KINGSWEAR_LIGHT, MHW_ODN, kingswearLightLocal, kingswearRockOutline, kingswearRockTop, lightColour, lightLocal, lightOn, type SectorColour, type SectorLightSpec } from '../sim/env/shoreLights';

/**
 * A sector light's glow: one sprite for each colour at its focal point, showing the colour of the sector the camera
 * is in, on its timing (src/sim/env/shoreLights.ts); with the colour-blind letters on, G or R above it in the
 * coloured sectors. `prefix` names the sprites (prefix-white, prefix-letter-G, …).
 */
export class SectorGlow {
  readonly group = new THREE.Group();
  private readonly glows: Record<SectorColour, THREE.Sprite>;
  private readonly letters: Partial<Record<SectorColour, THREE.Sprite>> = {};
  private shown: SectorColour | undefined;

  constructor(
    private readonly spec: SectorLightSpec,
    at: THREE.Vector3,
    prefix: string,
  ) {
    const make = (colour: SectorColour) => {
      const g = glowSprite(colour);
      g.name = `${prefix}-${colour}`;
      g.position.copy(at);
      g.visible = false;
      this.group.add(g);
      return g;
    };
    this.glows = { green: make('green'), white: make('white'), red: make('red') };
    for (const [colour, letter] of [['green', 'G'], ['red', 'R']] as const) {
      const l = letterSprite(letter);
      if (!l) continue;
      l.name = `${prefix}-letter-${letter}`;
      l.position.copy(at).add(new THREE.Vector3(0, 2.2, 0));
      l.visible = false;
      this.group.add(l);
      this.letters[colour] = l;
    }
  }

  /** At night (`lit`), show the colour of the camera's sector while the light is on; `letters` adds G or R. */
  update(camera: THREE.Camera, timeS: number, lit: boolean, letters = false): void {
    const colour = lit ? lightColour(this.spec, camera.position.x, -camera.position.z) : undefined;
    this.shown = lightOn(this.spec, timeS) ? colour : undefined;
    for (const k of Object.keys(this.glows) as SectorColour[]) this.glows[k].visible = this.shown === k;
    // The letter stays while the light is dark between flashes, so it can be read.
    for (const [k, l] of Object.entries(this.letters) as [SectorColour, THREE.Sprite][]) l.visible = letters && colour === k;
  }

  get showing(): boolean {
    return this.shown !== undefined;
  }

  get showingColour(): SectorColour | undefined {
    return this.shown;
  }
}

/**
 * The Kingswear light (src/sim/env/shoreLights.ts): a large rock at the water's edge, and on it a compact round
 * tower 4 m high with a conical lantern, its window facing south-west over the entrance. At night its light shows,
 * isophase every 3 s, the colour of the sector the viewer is in: green 318°–325°, white 325°–331°, red 331°–340°
 * (bearings of the light from seaward); outside them it is not seen. With the colour-blind letters on, a G or an R
 * stands by it in the coloured sectors. The tower's colours are estimates (E). Land-fixed group (m ODN).
 */
export class KingswearLightView {
  readonly group = new THREE.Group();
  private readonly glow: SectorGlow;

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
    const focal = top + H - 1.1 + 0.3;
    this.glow = new SectorGlow(KINGSWEAR_LIGHT, new THREE.Vector3(c.e, focal, -c.n), 'kingswear-light');
    this.group.add(this.glow.group);
  }

  /**
   * At night (`lit`), the light shows to the camera the colour of the sector it is in, on and off every 1.5 s;
   * `letters` adds G or R beside it in the coloured sectors.
   */
  update(camera: THREE.Camera, timeS: number, lit: boolean, letters = false): void {
    this.glow.update(camera, timeS, lit, letters);
  }

  /** Whether its light shows now (for tests). */
  get showing(): boolean {
    return this.glow.showing;
  }

  /** The colour it shows now, if any (for tests). */
  get showingColour(): SectorColour | undefined {
    return this.glow.showingColour;
  }
}

/**
 * Bayard's Cove light (src/sim/env/shoreLights.ts): a white post with a small dark lantern on the quay by Bayard's
 * Cove Fort, the light 5 m above high water, flashing every 2 s the colour of the viewer's sector. The post, its place
 * and the sectors' limits are estimates (E) until the charted figures are given. Land-fixed group (m ODN).
 */
export class BayardsLightView {
  readonly group = new THREE.Group();
  private readonly glow: SectorGlow;

  /** `ground` is the ground's height (m ODN) at the light. */
  constructor(ground: number) {
    this.group.name = 'bayards-cove-light';
    const c = lightLocal(BAYARDS_COVE_LIGHT);
    const focal = Math.max(ground + 1.5, MHW_ODN + BAYARDS_COVE_LIGHT.focalAboveMHW);
    const white = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHex(0xeeede6, THREE.SRGBColorSpace), roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHex(0x23272b, THREE.SRGBColorSpace), roughness: 0.5, metalness: 0.3 });
    const postH = focal - 0.25 - ground;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, postH, 12), white);
    post.position.set(c.e, ground + postH / 2, -c.n);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 12), dark);
    lantern.position.set(c.e, focal, -c.n);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.18, 12), dark);
    cap.position.set(c.e, focal + 0.3, -c.n);
    for (const m of [post, lantern, cap]) {
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    post.name = 'bayards-cove-light-post';
    this.glow = new SectorGlow(BAYARDS_COVE_LIGHT, new THREE.Vector3(c.e, focal, -c.n), 'bayards-cove-light');
    this.group.add(this.glow.group);
  }

  update(camera: THREE.Camera, timeS: number, lit: boolean, letters = false): void {
    this.glow.update(camera, timeS, lit, letters);
  }

  get showing(): boolean {
    return this.glow.showing;
  }

  get showingColour(): SectorColour | undefined {
    return this.glow.showingColour;
  }
}
