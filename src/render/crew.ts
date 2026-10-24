import * as THREE from 'three';

/**
 * A sailor sitting in a Squib: jacket, lifejacket, cap, arms and legs, posed from the crew's lateral position
 * in the physics (sitting inboard … sitting out on the side deck, leaning out to hike). Proportions are those
 * of an adult (about 1.75 m); the poses are illustrative, not measured. Visual only.
 *
 * Figure frame: origin at the hips (the seat), x = outboard, y = up, z = aft (the boat's frame).
 * The figure faces inboard (−x); the group is mirrored for the port side.
 */

const Y = new THREE.Vector3(0, 1, 0);
const TORSO = 0.5;
const THIGH = 0.44;
const SHIN = 0.45;
const UPPER_ARM = 0.3;
const FOREARM = 0.28;

const skin = new THREE.MeshStandardMaterial({ color: 0xd8a47f, roughness: 0.7 });
const shoe = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 });

export type CrewRole = 'helm' | 'crew';

export interface CrewColours {
  jacket: number;
  trousers: number;
  lifejacket: number;
  cap: number;
}

export const CREW_COLOURS: Record<CrewRole, CrewColours> = {
  helm: { jacket: 0x1f3550, trousers: 0x2b2f36, lifejacket: 0xc0392b, cap: 0xf2f2ee },
  crew: { jacket: 0x3a4a5c, trousers: 0x2b2f36, lifejacket: 0xe3b21c, cap: 0x1d2b3a },
};

const materials = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number): THREE.MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) materials.set(color, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.8 })));
  return m;
}

/** A capsule limb of fixed length, placed between a joint and a direction. */
class Limb {
  readonly mesh: THREE.Mesh;
  constructor(radius: number, readonly length: number, material: THREE.Material) {
    this.mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - 2 * radius), 4, 8), material);
  }
  /** Place from `from` along unit `dir`; returns the far end. */
  place(from: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(dir).multiplyScalar(this.length).add(from);
    this.mesh.position.copy(from).add(out).multiplyScalar(0.5);
    this.mesh.quaternion.setFromUnitVectors(Y, dir);
    return out;
  }
}

export class CrewFigure {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torso: Limb;
  private readonly vest: THREE.Mesh;
  private readonly head = new THREE.Group();
  private readonly thighs: Limb[];
  private readonly shins: Limb[];
  private readonly shoes: THREE.Mesh[];
  private readonly upperArms: Limb[];
  private readonly forearms: Limb[];
  private readonly v = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3() };

  constructor(readonly role: CrewRole, colours: CrewColours = CREW_COLOURS[role]) {
    this.group.name = `crew-${role}`;
    this.torso = new Limb(0.15, TORSO, mat(colours.jacket));
    this.vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.175, 0.2, 4, 10), mat(colours.lifejacket));
    this.vest.scale.set(1, 1, 0.9);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 12), skin);
    const capMat = mat(colours.cap);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.112, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    crown.position.y = 0.02;
    this.head.add(face, crown);
    if (role === 'helm') {
      // Peaked cap, the peak facing inboard (the way the figure looks).
      const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 14, 1, false, Math.PI, Math.PI), capMat);
      peak.position.set(-0.07, 0.03, 0);
      this.head.add(peak);
    } else {
      // Beanie: a taller crown with a turned-up band.
      crown.scale.y = 1.25;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.018, 6, 18), capMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.025;
      this.head.add(band);
    }
    const trousers = mat(colours.trousers);
    const sleeve = mat(colours.jacket);
    this.thighs = [new Limb(0.07, THIGH, trousers), new Limb(0.07, THIGH, trousers)];
    this.shins = [new Limb(0.055, SHIN, trousers), new Limb(0.055, SHIN, trousers)];
    this.shoes = [0, 1].map(() => new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.1), shoe));
    this.upperArms = [new Limb(0.05, UPPER_ARM, sleeve), new Limb(0.05, UPPER_ARM, sleeve)];
    this.forearms = [new Limb(0.045, FOREARM, sleeve), new Limb(0.045, FOREARM, sleeve)];
    const hands = [0, 1].map(() => new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin));
    hands.forEach((h, i) => this.forearms[i]!.mesh.add(h));
    hands.forEach((h) => (h.position.y = FOREARM / 2));
    this.body.add(this.torso.mesh, this.vest, this.head);
    for (const l of [...this.thighs, ...this.shins, ...this.upperArms, ...this.forearms]) this.body.add(l.mesh);
    this.body.add(...this.shoes);
    this.group.add(this.body);
    this.setPose(0.5);
  }

  /**
   * Pose for a hiking fraction 0 (sitting upright, inboard) … 1 (sitting out on the side deck, leaning well
   * out). The figure's frame is set by the caller (seat position, side).
   */
  setPose(hike: number): void {
    const h = Math.min(1, Math.max(0, hike));
    const { a, b, c, d } = this.v;
    const hip = a.set(0, 0, 0);
    // Torso leans outboard as the sailor hikes (up to ~50°).
    const lean = 0.88 * smooth(0.45, 1, h);
    const tdir = b.set(Math.sin(lean), Math.cos(lean), 0);
    const shoulder = this.torso.place(hip, tdir, c).clone();
    this.vest.position.copy(hip).addScaledVector(tdir, TORSO * 0.62);
    this.vest.quaternion.setFromUnitVectors(Y, tdir);
    this.head.position.copy(shoulder).addScaledVector(tdir, 0.19);
    this.head.rotation.z = -lean * 0.6; // looks up the boat rather than at the sky
    // Legs: thighs inboard and down into the cockpit; straighter when hiking (feet under the toe straps).
    const thighDown = 0.5 - 0.35 * h;
    const shinBack = 0.15 + 0.45 * h;
    for (let i = 0; i < 2; i++) {
      const zOff = i === 0 ? -0.11 : 0.11;
      const hipJ = d.set(0, 0, zOff);
      const knee = this.thighs[i]!.place(hipJ, b.set(-Math.cos(thighDown), -Math.sin(thighDown), 0), c).clone();
      const foot = this.shins[i]!.place(knee, b.set(-Math.sin(shinBack), -Math.cos(shinBack), 0), c);
      this.shoes[i]!.position.set(foot.x - 0.06, foot.y - 0.03, foot.z);
    }
    // Arms: the helm's aft hand on the tiller extension, the other on the knee; the crew holds the jib sheet.
    for (let i = 0; i < 2; i++) {
      const s = d.copy(shoulder).add(b.set(0, -0.04, i === 0 ? -0.19 : 0.19));
      const up = this.role === 'helm' && i === 1 ? b.set(-0.45, -0.75, 0.48) : this.role === 'helm' ? b.set(-0.55, -0.8, -0.1) : b.set(-0.75, -0.55, i === 0 ? -0.35 : -0.15);
      const elbow = this.upperArms[i]!.place(s, up.normalize(), c).clone();
      const fore = this.role === 'helm' && i === 1 ? b.set(-0.5, 0.15, 0.85) : b.set(-0.95, -0.15, -0.25);
      this.forearms[i]!.place(elbow, fore.normalize(), c);
    }
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
