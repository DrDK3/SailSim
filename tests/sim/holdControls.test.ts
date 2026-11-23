/**
 * Design handover (23 Nov 2026), item 2: sailing controls work through every input route. The controller's side:
 * a single activation (a click with no pointer or key held behind it: assistive technology, voice control) acts for
 * a bounded moment and lets go; a pointer or key press takes over from it; hiding the page or losing the window lets
 * go of everything, so no control is left held. (The button's keyboard handling is in tests/e2e/handover.spec.ts.)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController, TAP_S } from '../../src/app/controller';

beforeEach(() => {
  const memory = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

const held = (c: SimController) => (c as unknown as { held: Set<string> }).held;

describe('a single activation is bounded', () => {
  it('a tap turns the helm for its moment, then lets go', () => {
    const c = new SimController();
    const before = c.sim.input.helm ?? 0;
    c.tap('helmLeft');
    c.advance(TAP_S / 2);
    expect(held(c).has('helmLeft')).toBe(true);
    expect(c.sim.input.helm).not.toBe(before);
    c.advance(TAP_S);
    expect(held(c).has('helmLeft')).toBe(false);
  });

  it('a pointer pressed during a tap holds on past the tap’s moment', () => {
    const c = new SimController();
    c.tap('helmLeft');
    c.press('helmLeft', true);
    c.advance(1);
    expect(held(c).has('helmLeft')).toBe(true);
    c.press('helmLeft', false);
    expect(held(c).has('helmLeft')).toBe(false);
  });

  it('a tap while a key or pointer already holds the control does not cut the hold short', () => {
    const c = new SimController();
    c.press('mainIn', true);
    c.tap('mainIn');
    c.advance(1);
    expect(held(c).has('mainIn')).toBe(true);
  });
});

describe('nothing is left held', () => {
  it('the page hidden: every held control and tap let go', () => {
    const c = new SimController();
    c.press('helmRight', true);
    c.tap('mainOut');
    const doc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = { hidden: true };
    try {
      (c as unknown as { onVisibility(): void }).onVisibility();
    } finally {
      (globalThis as { document?: unknown }).document = doc;
    }
    expect(held(c).size).toBe(0);
  });

  it('the window losing the keys: the same', () => {
    const c = new SimController();
    c.press('helmRight', true);
    c.tap('mainOut');
    (c as unknown as { onBlur(): void }).onBlur();
    expect(held(c).size).toBe(0);
    c.advance(1);
    expect(held(c).size).toBe(0);
  });
});
