import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { RailwayView } from '../../src/render/railway';
import type { RailwayFeatures } from '../../src/sim/env/railway';

const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as { railway: RailwayFeatures };

/** The railway in the picture: track, Kingswear's platform and train shed, and the train when one is due. */
describe('railway view', () => {
  const view = new RailwayView(features.railway, () => 4);
  const named = (n: string) => {
    const out: THREE.Object3D[] = [];
    view.group.traverse((o) => o.name === n && out.push(o));
    return out;
  };

  it('builds track, a platform, the train shed and the tunnel mouths', () => {
    expect(named('rails').length).toBeGreaterThan(3);
    expect((named('sleepers')[0] as THREE.InstancedMesh).count).toBeGreaterThan(4000);
    expect(named('platform').length).toBeGreaterThanOrEqual(1);
    expect(named('train-shed')).toHaveLength(1);
    expect(named('tunnel-portal')).toHaveLength(2);
  });

  it('shows the train while one is at Kingswear or on its way, upright on the rails, and hides it otherwise', () => {
    view.update(Date.parse('2026-07-15T10:05:00Z'), 0, { e: 1, n: 0 });
    const loco = named('loco')[0]!;
    expect(loco.visible).toBe(true);
    // Rail top at 4 m ODN (flat ground plus the formation): the engine stands on it, level.
    expect(loco.position.y).toBeGreaterThan(4);
    expect(loco.position.y).toBeLessThan(4.6);
    expect(Math.abs(loco.rotation.x)).toBeLessThan(0.01);
    expect(named('coach').filter((c) => c.visible)).toHaveLength(7);
    // Every vehicle part is above the rails (no roof or wheel turned the wrong way).
    const box = new THREE.Box3().setFromObject(named('coach')[0]!);
    expect(box.min.y).toBeGreaterThan(3.9);
    expect(box.max.y - box.min.y).toBeLessThan(4.2);
    expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeLessThan(21);
    view.update(Date.parse('2026-07-15T18:00:00Z'), 1, { e: 1, n: 0 });
    expect(loco.visible).toBe(false);
  });
});
