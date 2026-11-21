import * as THREE from 'three';
import { windexGeometry } from './vane';
import { DEFAULT_TAB_DEG } from '../app/windIndicator';

/**
 * A masthead vane (Windex type) for the player's own boat, as the alternative to the burgee (review #4, a setting
 * pending the sailors' answer): the vane (src/render/vane.ts's shape) turns to point into the apparent wind, and two
 * fixed tacking tabs reach aft from the spindle at ±`tabDeg` (E, configurable). Driven by the same apparent wind as the
 * burgee: angle (rad, > 0 from starboard) in the boat's frame (model x = starboard, z = aft).
 */
const MAT = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.5, side: THREE.DoubleSide });
const TAB_MAT = new THREE.MeshStandardMaterial({ color: 0xd8262a, roughness: 0.6, side: THREE.DoubleSide });
/** Length of each tab (m): Windex's own are shorter than the vane. */
const TAB_LEN = 0.16;

export class MastheadVane {
  readonly group = new THREE.Group();
  private readonly vane: THREE.Mesh;
  private readonly tabs: THREE.Mesh[] = [];

  constructor(tabDeg = DEFAULT_TAB_DEG) {
    this.group.name = 'masthead-vane';
    this.vane = new THREE.Mesh(windexGeometry(), MAT);
    this.vane.name = 'masthead-vane-arrow';
    this.group.add(this.vane);
    const g = new THREE.BoxGeometry(0.008, 0.008, TAB_LEN);
    g.translate(0, 0.17, TAB_LEN / 2);
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(g, TAB_MAT);
      t.name = 'masthead-vane-tab';
      t.userData.side = s;
      this.tabs.push(t);
      this.group.add(t);
    }
    this.setTabs(tabDeg);
  }

  /** The tabs' angle either side of dead aft (deg). */
  setTabs(tabDeg: number): void {
    for (const t of this.tabs) t.rotation.y = (t.userData.side as number) * ((tabDeg * Math.PI) / 180);
  }

  /** Point into the apparent wind (`awa` rad, > 0 from starboard): the arrow is built along −z (ahead). */
  update(awa: number): void {
    this.vane.rotation.y = -awa;
  }

  /** The vane's yaw in the boat frame (tests). */
  get yaw(): number {
    return this.vane.rotation.y;
  }
}
