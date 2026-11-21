/**
 * Fixes of 21 Nov 2026, §3.3: "look up at the masthead" as a toggle, for players who cannot hold a key. Off (the
 * default): T (or the button) looks up while held, as before. On: each press looks up or back, and letting go does
 * nothing. Reduced motion cuts the movement either way.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController } from '../../src/app/controller';
import { DEFAULT_PREFS, loadPrefs } from '../../src/app/prefs';
import { lookUpBlend } from '../../src/render/frames';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

type Keys = { onKeyDown(ev: Partial<KeyboardEvent>): void; onKeyUp(ev: Partial<KeyboardEvent>): void; onBlur(): void };
const ev = (code: string, repeat = false): Partial<KeyboardEvent> => ({ code, repeat, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, preventDefault: () => {} });
const down = (c: SimController, repeat = false) => (c as unknown as Keys).onKeyDown(ev('KeyT', repeat));
const up = (c: SimController) => (c as unknown as Keys).onKeyUp(ev('KeyT'));

describe('§3.3: look up, held or toggled', () => {
  it('the setting is off by default, and a browser’s older settings (without it) read as off', () => {
    expect(DEFAULT_PREFS.lookUpToggle).toBe(false);
    memory.set('squib.prefs.v1', JSON.stringify({ hints: false }));
    expect(loadPrefs().lookUpToggle).toBe(false);
  });

  it('held (the default): T looks up while held, and back on release or when the window loses the keys', () => {
    const c = new SimController();
    down(c);
    expect(c.lookingUp).toBe(true);
    down(c, true); // the key repeating changes nothing
    expect(c.lookingUp).toBe(true);
    up(c);
    expect(c.lookingUp).toBe(false);
    down(c);
    (c as unknown as Keys).onBlur();
    expect(c.lookingUp).toBe(false);
  });

  it('toggled: one press looks up and stays up after the key is let go; the next press looks back', () => {
    const c = new SimController();
    c.setPrefs({ lookUpToggle: true });
    down(c);
    up(c);
    expect(c.lookingUp).toBe(true);
    down(c, true);
    expect(c.lookingUp).toBe(true);
    // Losing the keys does not undo a toggle.
    (c as unknown as Keys).onBlur();
    expect(c.lookingUp).toBe(true);
    down(c);
    up(c);
    expect(c.lookingUp).toBe(false);
    // The console's button does the same as the key.
    c.lookUpPress(true);
    expect(c.lookingUp).toBe(true);
    // Switching the setting off brings the view back down.
    c.setPrefs({ lookUpToggle: false });
    expect(c.lookingUp).toBe(false);
  });

  it('reduced motion cuts straight there and back, held or toggled (the view eases otherwise)', () => {
    expect(lookUpBlend(0, true, 1 / 60, true)).toBe(1);
    expect(lookUpBlend(1, false, 1 / 60, true)).toBe(0);
    const eased = lookUpBlend(0, true, 1 / 60, false);
    expect(eased).toBeGreaterThan(0);
    expect(eased).toBeLessThan(0.5);
  });
});
