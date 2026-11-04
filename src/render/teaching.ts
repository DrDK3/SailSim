import * as THREE from 'three';
import type { BoatSnapshot } from '../sim/simulation';
import type { OverlayPart } from '../app/lessons';
import { makeLabel } from './labels';

/**
 * The teaching overlay (review UX-9, §8.3): what the instruments say, drawn on the water round the boat, each
 * part labelled in words so that no meaning rests on colour alone (U8).
 *  - Heading: a solid line from the bow, where the boat points.
 *  - Course over ground: a dashed line, where the boat is actually going.
 *  - Stream: an arrow at the boat, the water's own movement, with its rate.
 *  - True wind and apparent wind: arrows above the boat, pointing the way each blows.
 *  - VMG: a line along the wind axis, as long as the speed made good towards (or away from) the wind.
 * A lesson may add a target buoy to sail to. Visual only.
 */

const LINE_M = 30;
const WIND_M_PER_MS = 1.2;
const STREAM_M_PER_MS = 12;
const VMG_M_PER_MS = 8;
const KN = 0.514444;

const COLOURS = {
  heading: 0xffffff,
  cog: 0xffd166,
  current: 0x4cc9f0,
  trueWind: 0x5b8cff,
  apparentWind: 0xff9f1c,
  vmg: 0x80ed99,
} as const;

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** A label whose text can change (the sprite is rebuilt only when the text does). */
class Label {
  sprite: THREE.Sprite;
  private text: string;
  constructor(
    private readonly parent: THREE.Object3D,
    text: string,
    private readonly colour: string,
  ) {
    this.text = text;
    this.sprite = makeLabel(text, colour);
    parent.add(this.sprite);
  }
  set(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const old = this.sprite;
    this.sprite = makeLabel(text, this.colour);
    this.sprite.position.copy(old.position);
    this.sprite.visible = old.visible;
    this.parent.remove(old);
    old.material.map?.dispose();
    old.material.dispose();
    this.parent.add(this.sprite);
  }
  dispose(): void {
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
  }
}

function line(colour: number, dashed: boolean): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
  const m = dashed
    ? new THREE.LineDashedMaterial({ color: colour, dashSize: 1.6, gapSize: 1.1, depthTest: false, transparent: true })
    : new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true });
  const l = new THREE.Line(g, m);
  l.renderOrder = 9;
  l.frustumCulled = false;
  return l;
}

function arrow(colour: number): THREE.ArrowHelper {
  const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, colour, 1, 0.6);
  for (const c of [a.line, a.cone]) {
    (c.material as THREE.Material).depthTest = false;
    c.renderOrder = 9;
  }
  return a;
}

/** World (north, east) vector → three.js direction (x = east, z = south). */
const dir3 = (n: number, e: number) => new THREE.Vector3(e, 0, -n);

export class TeachingOverlay {
  readonly group = new THREE.Group();
  private parts = new Set<OverlayPart>();
  private readonly heading = line(COLOURS.heading, false);
  private readonly cog = line(COLOURS.cog, true);
  private readonly vmgLine = arrow(COLOURS.vmg);
  private readonly stream = arrow(COLOURS.current);
  private readonly trueWind = arrow(COLOURS.trueWind);
  private readonly appWind = arrow(COLOURS.apparentWind);
  private readonly labels: Record<'heading' | 'cog' | 'stream' | 'trueWind' | 'appWind' | 'vmg' | 'target', Label>;
  private readonly target = new THREE.Group();

  constructor() {
    this.group.name = 'teaching-overlay';
    this.group.add(this.heading, this.cog, this.vmgLine, this.stream, this.trueWind, this.appWind, this.target);
    this.labels = {
      heading: new Label(this.group, 'Heading', css(COLOURS.heading)),
      cog: new Label(this.group, 'Course over ground', css(COLOURS.cog)),
      stream: new Label(this.group, 'Stream', css(COLOURS.current)),
      trueWind: new Label(this.group, 'True wind', css(COLOURS.trueWind)),
      appWind: new Label(this.group, 'Apparent wind', css(COLOURS.apparentWind)),
      vmg: new Label(this.group, 'VMG', css(COLOURS.vmg)),
      target: new Label(this.target, 'Target', '#ffe066'),
    };
    // The target: a yellow buoy, its label above it.
    const buoy = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 1.5, 20), new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.5 }));
    buoy.position.y = 0.5;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 10), new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.5 }));
    top.position.y = 1.4;
    buoy.name = top.name = 'lesson-target';
    this.target.add(buoy, top);
    this.labels.target.sprite.position.y = 3.2;
    this.target.visible = false;
    this.group.visible = false;
  }

  /** Which parts to draw, and the target buoy (local metres), if any. */
  set(parts: OverlayPart[], target?: { n: number; e: number }): void {
    this.parts = new Set(parts);
    this.group.visible = parts.length > 0 || !!target;
    this.target.visible = !!target;
    if (target) this.target.position.set(target.e, 0, -target.n);
  }

  /** What is shown now (tests). */
  get shown(): string[] {
    return [...this.parts, ...(this.target.visible ? ['target'] : [])];
  }

  private place(obj: THREE.Line, from: THREE.Vector3, d: THREE.Vector3, len: number): THREE.Vector3 {
    const to = from.clone().addScaledVector(d, len);
    const pos = obj.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    obj.geometry.computeBoundingSphere();
    if (obj.material instanceof THREE.LineDashedMaterial) obj.computeLineDistances();
    return to;
  }

  private setArrow(a: THREE.ArrowHelper, at: THREE.Vector3, d: THREE.Vector3, len: number): void {
    a.visible = len > 0.3;
    if (!a.visible) return;
    a.position.copy(at);
    a.setDirection(d);
    a.setLength(len, Math.min(1.4, len * 0.3), Math.min(0.8, len * 0.18));
  }

  update(s: BoatSnapshot, boat: THREE.Vector3, waterY = 0): void {
    if (!this.group.visible) return;
    const p = this.parts;
    const y = waterY + 0.35;
    const at = new THREE.Vector3(boat.x, y, boat.z);
    const hd = dir3(Math.cos(s.heading), Math.sin(s.heading));
    // Heading, from the bow.
    this.heading.visible = this.labels.heading.sprite.visible = p.has('heading');
    if (p.has('heading')) this.labels.heading.sprite.position.copy(this.place(this.heading, at.clone().addScaledVector(hd, 3), hd, LINE_M)).add(new THREE.Vector3(0, 1.2, 0));
    // Course over ground.
    const gv = s.forces.groundVelocity;
    const sog = Math.hypot(gv.n, gv.e);
    const showCog = p.has('cog') && sog > 0.15;
    this.cog.visible = this.labels.cog.sprite.visible = showCog;
    if (showCog) this.labels.cog.sprite.position.copy(this.place(this.cog, at.clone().addScaledVector(hd, 3), dir3(gv.n / sog, gv.e / sog), LINE_M)).add(new THREE.Vector3(0, -0.4, 0));
    // The stream at the boat.
    const cur = s.current;
    const rate = Math.hypot(cur.n, cur.e);
    const showStream = p.has('current') && rate > 0.05;
    this.stream.visible = this.labels.stream.sprite.visible = showStream;
    if (showStream) {
      const len = Math.min(20, rate * STREAM_M_PER_MS);
      const from = at.clone().add(new THREE.Vector3(0, -0.1, 0));
      this.setArrow(this.stream, from, dir3(cur.n / rate, cur.e / rate), len);
      this.labels.stream.set(`Stream ${(rate / KN).toFixed(1)} kn`);
      this.labels.stream.sprite.position.copy(from).addScaledVector(dir3(cur.n / rate, cur.e / rate), len).add(new THREE.Vector3(0, 0.8, 0));
    }
    // True and apparent wind (as the debug arrows compute them), above the boat, pointing the way they blow.
    const c = Math.cos(s.heading);
    const sn = Math.sin(s.heading);
    const awN = s.forces.aw.ax * c - s.forces.aw.ay * sn;
    const awE = s.forces.aw.ax * sn + s.forces.aw.ay * c;
    const twN = awN + gv.n;
    const twE = awE + gv.e;
    const showWind = p.has('wind');
    this.trueWind.visible = this.appWind.visible = this.labels.trueWind.sprite.visible = this.labels.appWind.sprite.visible = showWind;
    if (showWind) {
      for (const [a, lab, vn, ve, h] of [
        [this.trueWind, this.labels.trueWind, twN, twE, 10.5],
        [this.appWind, this.labels.appWind, awN, awE, 12.2],
      ] as const) {
        const v = Math.hypot(vn, ve);
        if (v < 0.05) {
          a.visible = lab.sprite.visible = false;
          continue;
        }
        const d = dir3(vn / v, ve / v);
        const len = v * WIND_M_PER_MS;
        // Drawn from upwind so that the head ends over the boat.
        const from = new THREE.Vector3(boat.x, waterY + h, boat.z).addScaledVector(d, -len);
        this.setArrow(a, from, d, len);
        lab.sprite.position.copy(from).add(new THREE.Vector3(0, 0.9, 0));
      }
    }
    // VMG along the wind axis (towards where the wind comes from when positive).
    const showVmg = p.has('vmg');
    this.vmgLine.visible = this.labels.vmg.sprite.visible = showVmg;
    if (showVmg) {
      const wN = twN - cur.n;
      const wE = twE - cur.e;
      const w = Math.hypot(wN, wE);
      if (w > 0.05) {
        const up = dir3(-wN / w, -wE / w);
        const d = s.vmg >= 0 ? up : up.clone().negate();
        const len = Math.abs(s.vmg) * VMG_M_PER_MS;
        const from = at.clone().add(new THREE.Vector3(0, 0.15, 0));
        this.setArrow(this.vmgLine, from, d, len);
        this.labels.vmg.set(`VMG ${(s.vmg / KN).toFixed(1)} kn`);
        this.labels.vmg.sprite.position.copy(from).addScaledVector(d, len).add(new THREE.Vector3(0, 1.0, 0));
        this.labels.vmg.sprite.visible = this.vmgLine.visible;
      } else this.vmgLine.visible = this.labels.vmg.sprite.visible = false;
    }
    if (this.target.visible) this.target.position.y = waterY;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    for (const l of Object.values(this.labels)) l.dispose();
  }
}
