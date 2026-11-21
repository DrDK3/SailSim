import * as THREE from 'three';
import { smoothstep } from '../sim/math/angles';
import type { SpinPhase } from '../sim/boat/spinnaker';

/**
 * The symmetric spinnaker and its pole as drawn (package B, B4). Driven only by the physics' spinnaker state (what the
 * crew are doing, how much is up, how full it is, the pole's side) and the apparent wind, so the picture never shows
 * a sail the physics does not have: hoisting it rises gathered along the luff; filled it is a round sail ahead of the
 * forestay on the pole's side; collapsing it falls in behind the forestay and flogs; gybing the pole swings across;
 * dropped it comes down into the cockpit. One mesh, shaped between those states every frame (about 150 vertices).
 *
 * The colours are the simulator's own (a canvas texture drawn here in panels, no third-party image), chosen in
 * Settings for the player's boat; AI boats fly their club's colour with white.
 *
 * Model frame (as src/render/squibModel.ts): x to starboard, y up, z aft (the bow at −z).
 */
export interface SpinnakerPose {
  phase: SpinPhase;
  deployed: number;
  fill: number;
  /** +1 the pole to starboard, −1 to port. */
  poleSide: 1 | -1;
  /** Apparent wind angle (rad, > 0 from starboard) and speed (m/s). */
  awa: number;
  aws: number;
  /** Progress of the crew's current task (0…1). */
  progress: number;
}

export { DEFAULT_SPINNAKER_COLOURS, SPINNAKER_COLOURS, isSpinnakerColour, type SpinnakerColourId } from '../app/spinnakerColours';
import { DEFAULT_SPINNAKER_COLOURS, SPINNAKER_COLOURS } from '../app/spinnakerColours';

/** Rig geometry for the spinnaker (model frame, m; E where the class rules give no figure). */
export interface SpinRig {
  mastZ: number;
  /** Height of the halyard at the hounds (the head when hoisted), and of the pole on the mast. */
  headY: number;
  poleY: number;
  /** Pole length (class rule C16: 2.14 m) and the forestay's tack (for the collapsed sail). */
  poleLength: number;
  bowZ: number;
  deckY: number;
}

const NU = 10;
const NV = 12;

function panelTexture(panels: readonly string[]): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  // Horizontal panels, the head panel in the first colour, seams as faint lines.
  const bands = [0, 0.38, 0.62, 1];
  for (let i = 0; i < 3; i++) {
    g.fillStyle = panels[i]!;
    g.fillRect(0, c.height * (1 - bands[i + 1]!), c.width, c.height * (bands[i + 1]! - bands[i]!));
  }
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  for (let y = 8; y < c.height; y += 16) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(c.width, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SpinnakerView {
  readonly group = new THREE.Group();
  readonly sail: THREE.Mesh;
  readonly pole: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.MeshStandardMaterial;
  /** Smoothed pole angle from the centreline (rad, signed to the pole's side), so a gybe swings it across. */
  private poleAngle = 0;
  private poleInit = false;

  constructor(
    private readonly rig: SpinRig,
    panels: readonly string[] = SPINNAKER_COLOURS[DEFAULT_SPINNAKER_COLOURS].panels,
  ) {
    this.group.name = 'spinnaker';
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((NU + 1) * (NV + 1) * 3), 3));
    const uv: number[] = [];
    for (let v = 0; v <= NV; v++) for (let u = 0; u <= NU; u++) uv.push(u / NU, v / NV);
    this.geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const idx: number[] = [];
    for (let v = 0; v < NV; v++) {
      for (let u = 0; u < NU; u++) {
        const a = v * (NU + 1) + u;
        idx.push(a, a + 1, a + NU + 1, a + 1, a + NU + 2, a + NU + 1);
      }
    }
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide, map: panelTexture(panels) });
    if (!this.mat.map) this.mat.color.set(panels[0]!);
    this.sail = new THREE.Mesh(this.geo, this.mat);
    this.sail.name = 'spinnaker-sail';
    this.sail.castShadow = true;
    this.sail.frustumCulled = false;
    const poleGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 8);
    poleGeo.rotateX(Math.PI / 2);
    poleGeo.translate(0, 0, -0.5);
    this.pole = new THREE.Mesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: 0.35, metalness: 0.6 }));
    this.pole.name = 'spinnaker-pole';
    this.group.add(this.sail, this.pole);
    this.group.visible = false;
  }

  setColours(panels: readonly string[]): void {
    this.mat.map?.dispose();
    this.mat.map = panelTexture(panels);
    this.mat.color.set(this.mat.map ? '#ffffff' : panels[0]!);
    this.mat.needsUpdate = true;
  }

  /** Shape it for this frame. `dt` (s) smooths the pole's swing. */
  update(s: SpinnakerPose | undefined, time: number, dt: number): void {
    const up = !!s && s.deployed > 0.001;
    this.group.visible = up || (!!s && s.phase === 'hoisting');
    if (!s || !this.group.visible) {
      this.poleInit = false;
      return;
    }
    const R = this.rig;
    const awaAbs = Math.min(Math.PI, Math.abs(s.awa));
    // How far the pole is squared back: near the forestay on a reach, square to the boat on a run (E).
    const run = smoothstep(60 * (Math.PI / 180), 170 * (Math.PI / 180), awaAbs);
    const want = s.poleSide * (0.55 + 0.95 * run);
    // During a pole gybe the pole swings through the forestay to the new side as the task goes on.
    const target = s.phase === 'gybing' ? -s.poleSide * (0.55 + 0.95 * run) * Math.cos(Math.PI * s.progress) : want;
    if (!this.poleInit) {
      this.poleAngle = target;
      this.poleInit = true;
    } else this.poleAngle += (target - this.poleAngle) * Math.min(1, dt * 4);
    const ang = this.poleAngle;
    const poleLen = R.poleLength * (s.phase === 'hoisting' || s.phase === 'dropping' ? 0.4 + 0.6 * s.deployed : 1);
    const heel = new THREE.Vector3(0.0, R.poleY, R.mastZ - 0.05);
    const tack = heel.clone().add(new THREE.Vector3(Math.sin(ang) * poleLen, 0.15 * run, -Math.cos(ang) * poleLen));
    // The pole's mesh lies along −z from its heel: turned (in the model's frame) to point at the tack.
    this.pole.position.copy(heel);
    this.pole.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(heel, tack, new THREE.Vector3(0, 1, 0)));
    this.pole.scale.set(1, 1, poleLen);

    const side = Math.sign(ang) || s.poleSide;
    const dep = Math.min(1, s.deployed);
    const fill = s.fill * smoothstep(0.6, 1, dep);
    // The head goes up the halyard as it is hoisted (and comes down as it is dropped).
    const headY = R.deckY + 0.5 + (R.headY - R.deckY - 0.5) * dep;
    // The head flies well forward of the mast once it fills (the halyard block is at the hounds).
    const head = new THREE.Vector3(side * 0.2 * (1 - run) * fill, headY, R.mastZ - (0.5 + 1.0 * fill));
    // The clew: out on the leeward side, about a foot's length (some 3.5 m) from the pole's end when full, its sheet
    // led aft to the leeward quarter; at the tack when gathered.
    const clewFull = new THREE.Vector3(-side * (0.7 + 0.9 * run) * fill, R.poleY - 0.1, R.mastZ - 0.9 - 0.9 * run + 0.9 * (1 - run));
    // Collapsed: hanging behind the forestay, the clew drawn in to leeward of the mast.
    const clewLimp = new THREE.Vector3(-side * 0.35, R.deckY + 0.9, R.mastZ - 0.4);
    const clew = clewLimp.clone().lerp(clewFull, fill);
    if (s.phase === 'hoisting' || s.phase === 'dropping') clew.lerp(tack, 0.6 * (1 - fill));
    // The belly: forward and down-wind of the chord between luff and leech; flogging, ripples instead.
    const depth = (0.35 + 0.65 * fill) * 1.6 * fill;
    const flog = (1 - s.fill) * dep * Math.min(1, s.aws / 5);
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const p = new THREE.Vector3();
    // The bulge direction: forward and to leeward, a little up.
    const bulge = new THREE.Vector3(-side * 0.35 * (1 - run), 0.1, -1).normalize();
    for (let iv = 0; iv <= NV; iv++) {
      const v = iv / NV;
      // Luff: tack → head, bowed forward; leech: clew → head, bowed forward.
      a.copy(tack).lerp(head, v);
      b.copy(clew).lerp(head, v);
      const bow = Math.sin(Math.PI * v) * (0.25 + 0.8 * fill);
      a.z -= bow * 0.9;
      b.z -= bow * 0.7;
      // Luff and leech curve out to their sides (a spinnaker's shoulders), most at mid-height.
      a.x += side * Math.sin(Math.PI * v) * 0.45 * fill;
      b.x -= side * Math.sin(Math.PI * v) * 0.45 * fill;
      // A gathered sail (hoisting, dropping, flogging) is narrower.
      const width = 0.12 + 0.88 * Math.max(fill, 0.25 * (1 - flog));
      for (let iu = 0; iu <= NU; iu++) {
        const u = iu / NU;
        p.copy(a).lerp(b, 0.5 + (u - 0.5) * width);
        const belly = Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.05 + 0.02)) * depth;
        p.addScaledVector(bulge, belly);
        if (flog > 0.01) {
          const w = Math.sin(time * 9 + u * 7 + v * 3) * Math.sin(Math.PI * u) * 0.18 * flog;
          p.x += w * side;
          p.z += w * 0.5;
          // A collapsed sail sags.
          p.y -= Math.sin(Math.PI * u) * 0.35 * flog * v;
        }
        pos.setXYZ(iv * (NU + 1) + iu, p.x, p.y, p.z);
      }
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.map?.dispose();
    this.mat.dispose();
    (this.pole.geometry as THREE.BufferGeometry).dispose();
    (this.pole.material as THREE.Material).dispose();
  }
}
