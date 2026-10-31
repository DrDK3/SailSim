import { describe, expect, it } from 'vitest';
import { agroundText, STUCK_SOG } from '../../src/ui/aground';
import type { BoatSnapshot } from '../../src/sim/simulation';

/**
 * The Aground warning (river racing fix, 31 Oct 2026): a boat that has stopped on the bottom stays there until the
 * water rises (docs/PHYSICS.md §15), so the warning says whether the tide will float her off or Reset is the way.
 */
const tide = (rising: boolean) => ({ tide: { rising } }) as unknown as BoatSnapshot['env'];

describe('the Aground warning', () => {
  it('says nothing afloat, and only that she is on the bottom while she still moves', () => {
    expect(agroundText({ grounded: false, sog: 0, env: undefined })).toBeUndefined();
    expect(agroundText({ grounded: true, sog: STUCK_SOG + 0.1, env: tide(false) })).toEqual({ text: 'Aground: the keel is on the bottom' });
  });

  it('once stopped: the rising tide floats her off; on a falling tide or fixed water, Reset starts again', () => {
    expect(agroundText({ grounded: true, sog: 0, env: tide(true) })!.text).toBe('Aground and stopped: the rising tide will float her off, or press R to start again');
    expect(agroundText({ grounded: true, sog: 0, env: tide(false) })!.text).toBe('Aground and stopped: the tide is falling, so she will stay until it turns. Press R to start again');
    const fixed = agroundText({ grounded: true, sog: 0.02, env: { tide: undefined } as unknown as BoatSnapshot['env'] })!;
    expect(fixed.text).toBe('Aground and stopped: the water level does not change in this session, so she will stay. Press R to start again');
    expect(fixed.title).toMatch(/only rising water floats a grounded boat off/);
  });
});
