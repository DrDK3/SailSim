import * as THREE from 'three';
import type { CuePuff } from './cues';
import { makeLabel } from './labels';

/**
 * Gust outlines (juniors round, Workstream 2): an optional teaching aid that rings each puff on the water, at the
 * wind model's own position and radius (one standard deviation of its Gaussian core), with the nearest three labelled
 * in words ("gust +25%") so the meaning does not rest on the ring's brightness alone. Off by default and off in races
 * unless asked for (Settings → Help and accessibility). Removing it leaves the natural cat's paws on the water
 * untouched: they are drawn by the water shader from the same cue state, whatever this does.
 */
const MAX = 24;
const SEGMENTS = 48;

export class PuffOutlines {
  readonly group = new THREE.Group();
  private readonly rings: THREE.LineLoop[] = [];
  private readonly labels: { sprite: THREE.Sprite; text: string }[] = [];
  private readonly material: THREE.LineBasicMaterial[] = [];

  constructor() {
    this.group.name = 'gust-outlines';
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    for (let i = 0; i < MAX; i++) {
      const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, fog: true });
      const ring = new THREE.LineLoop(geo, m);
      ring.name = 'gust-outline';
      ring.visible = false;
      ring.renderOrder = 5;
      this.rings.push(ring);
      this.material.push(m);
      this.group.add(ring);
    }
    this.group.visible = false;
  }

  /** Show or hide the outlines. */
  set visible(on: boolean) {
    this.group.visible = on;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Place the rings on the puffs (north/east metres) nearest the boat; `waterY` the surface height. */
  update(puffs: readonly CuePuff[], bn: number, be: number, waterY: number): void {
    if (!this.group.visible) return;
    const near = [...puffs].sort((a, b) => Math.hypot(a.n - bn, a.e - be) - a.radius - (Math.hypot(b.n - bn, b.e - be) - b.radius)).slice(0, MAX);
    for (let i = 0; i < MAX; i++) {
      const ring = this.rings[i]!;
      const p = near[i];
      ring.visible = !!p;
      if (!p) continue;
      ring.position.set(p.e, waterY + 0.08, -p.n);
      ring.scale.setScalar(p.radius);
      this.material[i]!.opacity = Math.min(0.9, 0.25 + 2 * p.strength);
    }
    for (let i = 0; i < 3; i++) {
      const p = near[i];
      const text = p ? `gust +${Math.round(p.strength * 100)}%` : '';
      let l = this.labels[i];
      if (!l || l.text !== text) {
        if (l) {
          this.group.remove(l.sprite);
          l.sprite.material.map?.dispose();
          l.sprite.material.dispose();
        }
        l = { sprite: makeLabel(text || ' ', '#ffffff'), text };
        l.sprite.name = 'gust-outline-label';
        this.labels[i] = l;
        this.group.add(l.sprite);
      }
      l.sprite.visible = !!p;
      if (p) l.sprite.position.set(p.e, waterY + 3, -p.n);
    }
  }

  dispose(): void {
    this.rings[0]?.geometry.dispose();
    for (const m of this.material) m.dispose();
    for (const l of this.labels) {
      l.sprite.material.map?.dispose();
      l.sprite.material.dispose();
    }
  }
}
