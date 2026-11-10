/**
 * The lofted hulls of the river traffic (src/render/vessels.ts hull()): the paint bands change along straight lines
 * and the deck stays inside the shell (owner, 6 Nov 2026: the foot ferry's white sawtooth along her waterline and a
 * tan wedge at her stem, the deck showing through her flared topsides).
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('../../src/render/labels', () => ({ makeLabel: () => new THREE.Sprite() }));
const { Kit, VMAT, hull } = await import('../../src/render/vessels');
const { TrafficView } = await import('../../src/render/traffic');

const COLOURS = { bottom: 0x6b1d1d, boot: 0xf2f1ec, topsides: 0x18212f, deck: 0x9a7350, bulwarkInside: 0xeeeeee };
/** The foot ferry's hull (src/render/traffic.ts passengerFerry): flared, a deep bulwark, a raked stem. */
const SPEC = {
  length: 18, beam: 5.2, freeboard: 1.15, draft: 1.1, sheerBow: 0.5, sheerStern: 0.2, stemRake: 1.2, entry: 0.4, transom: 0.72, transomRake: 0.15,
  flare: 0.1, bulwark: 0.85, colours: COLOURS, bootTop: 0.18,
};

function build(spec = SPEC) {
  const kit = new Kit();
  const h = hull(kit, spec);
  const parts = (kit as unknown as { parts: Map<THREE.Material, THREE.BufferGeometry[]> }).parts.get(VMAT.paint)!;
  // In the order hull() adds them: shell (with transom), deck, the bulwarks' inside faces.
  return { h, shell: parts[0]!, deck: parts[1]!, bulwarks: parts.slice(2) };
}

const linear = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const same = (c: THREE.BufferAttribute, i: number, hex: number) => {
  const k = linear(hex);
  return Math.abs(c.getX(i) - k.r) < 1e-4 && Math.abs(c.getY(i) - k.g) < 1e-4 && Math.abs(c.getZ(i) - k.b) < 1e-4;
};

describe('a lofted hull', () => {
  it('paints in bands that change along straight lines: no triangle straddles two colours', () => {
    const { shell } = build();
    const c = shell.getAttribute('color') as THREE.BufferAttribute;
    let mixed = 0;
    for (let t = 0; t < c.count; t += 3) {
      const a = [c.getX(t), c.getY(t), c.getZ(t)].join();
      if ([c.getX(t + 1), c.getY(t + 1), c.getZ(t + 1)].join() !== a || [c.getX(t + 2), c.getY(t + 2), c.getZ(t + 2)].join() !== a) mixed++;
    }
    expect(mixed).toBe(0);
  });

  it('keeps the antifouling below the waterline and the boot top between it and 0.18 m', () => {
    const { shell } = build();
    const p = shell.getAttribute('position') as THREE.BufferAttribute;
    const c = shell.getAttribute('color') as THREE.BufferAttribute;
    let boots = 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (same(c, i, COLOURS.bottom)) expect(y).toBeLessThan(1e-3);
      if (same(c, i, COLOURS.boot)) {
        boots++;
        expect(y).toBeGreaterThan(-1e-3);
        expect(y).toBeLessThan(0.18 + 1e-3);
      }
      if (same(c, i, COLOURS.topsides)) expect(y).toBeGreaterThan(0.18 - 1e-3);
    }
    expect(boots).toBeGreaterThan(100);
  });

  it('lays the deck and the bulwarks inside the shell, flared topsides and raked stem included', () => {
    const { shell, deck, bulwarks } = build();
    const sp = shell.getAttribute('position') as THREE.BufferAttribute;
    // The shell's half-breadth near (y, z): the widest shell point within 0.25 m (from both sides).
    const shellHalf = (y: number, z: number) => {
      let m = 0;
      for (let i = 0; i < sp.count; i++) if (Math.abs(sp.getZ(i) - z) < 0.25 && Math.abs(sp.getY(i) - y) < 0.25) m = Math.max(m, Math.abs(sp.getX(i)));
      return m;
    };
    let worst = -Infinity;
    for (const g of [deck, ...bulwarks]) {
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i += 7) {
        const x = Math.abs(p.getX(i));
        if (x < 0.05) continue;
        worst = Math.max(worst, x - shellHalf(p.getY(i), p.getZ(i)));
      }
    }
    expect(worst).toBeLessThan(0.02);
  });

  it("gives the deck's half-breadth for parts standing on it, inside the sheer's", () => {
    const { h } = build();
    for (const z of [-7, -3, 0, 4, 8]) {
      expect(h.deckHalf(z)).toBeLessThan(h.half(z));
      expect(h.deckHalf(z)).toBeGreaterThan(h.half(z) - 0.5);
    }
  });
});

describe('the foot ferry', () => {
  it("wears the river boats' dark blue, not the old bright blue", () => {
    const view = new TrafficView();
    view.update([{ id: 'pf', name: 'test', label: 'test', unit: 0, kind: 'passenger-ferry', length: 18, beam: 5.2, ram: false, n: 0, e: 0, heading: 0, sog: 0, moving: false, phase: 'berthed', ramp: 1, parts: [] } as never], 0, new THREE.PerspectiveCamera(), false);
    let navy = 0;
    let oldBlue = 0;
    view.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.name !== 'passenger-ferry-body') return;
      const c = o.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (!c) return;
      for (let i = 0; i < c.count; i++) {
        if (same(c, i, 0x18212f)) navy++;
        if (same(c, i, 0x1d4d8a)) oldBlue++;
      }
    });
    expect(navy).toBeGreaterThan(100);
    expect(oldBlue).toBe(0);
  });
});
