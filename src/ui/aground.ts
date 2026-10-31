import type { BoatSnapshot } from '../sim/simulation';

/** Speed over the ground (m/s) below which a grounded boat counts as stuck rather than sliding along the bottom. */
export const STUCK_SOG = 0.1;

/**
 * What the Aground warning says. A boat still moving may slide off; one that has stopped stays until the water
 * rises (docs/PHYSICS.md §15: the bottom holds her against the sails; the crew cannot push or heel her off), so
 * the warning says whether the tide will do that or Reset is the way out.
 */
export function agroundText(s: Pick<BoatSnapshot, 'grounded' | 'sog' | 'env'>): { text: string; title?: string } | undefined {
  if (!s.grounded) return undefined;
  if (s.sog >= STUCK_SOG) return { text: 'Aground: the keel is on the bottom' };
  const title = 'The keel is on the bottom and the boat has stopped. In the simulator only rising water floats a grounded boat off: the crew cannot push or heel her off.';
  const tide = s.env?.tide;
  if (tide?.rising) return { text: 'Aground and stopped: the rising tide will float her off, or press R to start again', title };
  const why = tide ? 'the tide is falling, so she will stay until it turns' : 'the water level does not change in this session, so she will stay';
  return { text: `Aground and stopped: ${why}. Press R to start again`, title };
}
