/**
 * The deck's non-slip pattern fades with the camera's distance (owner, 10 Nov 2026: "a rippling effect across the
 * top of the squib"). Its diamonds are about 1 cm apart; from the chase view's 8 m a pixel covers about as much
 * deck, and bump shading at a pattern finer than a pixel aliases into moiré ripples that crawl as the boat moves.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { NON_SLIP_FADE, SquibModel, nonSlipStrength } from '../../src/render/squibModel';

/** Deck metres covered by one screen pixel at `distance` m: 55° vertical field of view, `rows` pixels high. */
const pixelAt = (distance: number, rows: number) => (2 * distance * Math.tan((27.5 * Math.PI) / 180)) / rows;
/** The non-slip diamonds' spacing on the deck (m): 6 texture repeats a metre, 16 diamonds to a repeat. */
const PITCH = 1 / 6 / 16;

describe('the non-slip deck', () => {
  it('is full strength close up (the helm looking at the deck) and gone at chase distance', () => {
    expect(nonSlipStrength(1)).toBe(1);
    expect(nonSlipStrength(NON_SLIP_FADE.near)).toBe(1);
    expect(nonSlipStrength(NON_SLIP_FADE.far)).toBe(0);
    expect(nonSlipStrength(8)).toBe(0);
    expect(nonSlipStrength((NON_SLIP_FADE.near + NON_SLIP_FADE.far) / 2)).toBeCloseTo(0.5, 6);
  });

  it('is only drawn where a diamond spans several pixels, even on an 800-pixel-high window', () => {
    // Wherever the bump shows at all, a diamond is over 2.5 pixels across; at the chase view's 8 m it would be about one.
    expect(PITCH / pixelAt(NON_SLIP_FADE.far, 800)).toBeGreaterThan(2.5);
    expect(PITCH / pixelAt(8, 800)).toBeLessThan(1.1);
  });

  it("sets the deck's and cockpit sole's bump from the camera's distance", () => {
    const m = new SquibModel(squibParams());
    // The deck's material: its colour (0xe4dfd2), wherever the model has merged it.
    const deck = (): THREE.MeshStandardMaterial | undefined => {
      let d: THREE.MeshStandardMaterial | undefined;
      m.group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) if (mat instanceof THREE.MeshStandardMaterial && mat.color.getHex() === 0xe4dfd2) d = mat;
      });
      return d;
    };
    m.setViewDistance(1);
    const close = deck()!.bumpScale;
    expect(close).toBeGreaterThan(0);
    m.setViewDistance(9);
    expect(deck()!.bumpScale).toBe(0);
    m.setViewDistance(1);
    expect(deck()!.bumpScale).toBe(close);
  });
});
