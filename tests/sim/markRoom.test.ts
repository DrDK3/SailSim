import { describe, expect, it } from 'vitest';
import { MarkRoomTracker, ZONE_HULL_LENGTHS, distanceToOutline, markRoomRuling, rule18Applies, type MarkRoomBoat } from '../../src/sim/race/markRoom';
import { hullOutline, placeOutline } from '../../src/sim/race/hull';

/**
 * Simplified rule 18 (package F, review #26): the zone of three hull lengths, who must give mark-room when the first
 * boat reaches it (overlapped: the outside boat; not: the boat that has not reached it), the exceptions, and when it
 * ends. Scenarios on a mark at the origin to be left to port.
 */
const LOA = 5.79;
const HULL = hullOutline(LOA, 1.9);
const D = Math.PI / 180;
const MARK = { n: 0, e: 0 };

/** A boat at (n, e), heading (deg), true wind angle (deg, > 0 from starboard), bound for the mark at the origin. */
function boat(id: string, n: number, e: number, headingDeg: number, twaDeg: number, extra: Partial<MarkRoomBoat> = {}): MarkRoomBoat {
  const heading = headingDeg * D;
  return {
    id,
    n,
    e,
    heading,
    twa: twaDeg * D,
    mainSide: twaDeg >= 0 ? 1 : -1,
    tack: twaDeg >= 0 ? 'starboard' : 'port',
    tacking: false,
    outline: placeOutline(HULL, n, e, heading),
    markKey: 'leg1:A',
    mark: MARK,
    rounding: 'port',
    length: LOA,
    ...extra,
  };
}

describe('simplified rule 18: mark-room', () => {
  it('the zone is three hull lengths of the boat nearer the mark, measured to any part of her hull', () => {
    expect(ZONE_HULL_LENGTHS).toBe(3);
    // A boat sailing straight at the mark from the north (heading south): her bow is 2.95 m ahead of her centre.
    const zone = 3 * LOA;
    const justOut = boat('a', zone + 3.2, 0, 180, 150);
    const justIn = boat('a', zone + 2.7, 0, 180, 150);
    expect(distanceToOutline(MARK, justOut.outline)).toBeGreaterThan(zone);
    expect(distanceToOutline(MARK, justIn.outline)).toBeLessThan(zone);
    // A point inside the hull is at distance 0.
    expect(distanceToOutline({ n: 10, e: 0 }, boat('b', 10, 0, 90, 150).outline)).toBe(0);
  });

  it('overlapped as the first reaches the zone: the inside boat is entitled, the outside boat must give mark-room', () => {
    const t = new MarkRoomTracker();
    // Running south towards the mark, side by side: B is nearer the mark (inside, on the mark's side), A outside.
    t.update(0, [boat('A', 30, 4, 180, 160), boat('B', 30, 1.5, 180, 160)]);
    expect(t.entitlement('A', 'B')).toBeUndefined(); // neither in the zone yet
    t.update(1, [boat('A', 18, 4, 180, 160), boat('B', 18, 1.5, 180, 160)]);
    expect(t.entitlement('A', 'B')).toMatchObject({ entitled: 'B', giver: 'A', reason: 'overlapped' });
    // At contact, the boat that owed mark-room is at fault under rule 18.2, labelled as simplified.
    const r = markRoomRuling(t.entitlement('A', 'B')!, (id) => `boat ${id}`);
    expect(r).toMatchObject({ atFault: 'A', rule: '18.2' });
    expect(r.notes.join(' ')).toMatch(/simplified, not authoritative/);
  });

  it('clear ahead as she reaches the zone: she keeps the entitlement even if the boat astern then gets an inside overlap', () => {
    const t = new MarkRoomTracker();
    // A clear ahead and reaching the zone; B a boat length and a half astern.
    t.update(0, [boat('A', 17, 2, 180, 160), boat('B', 27, 1, 180, 160)]);
    expect(t.entitlement('A', 'B')).toMatchObject({ entitled: 'A', giver: 'B', reason: 'reached-first' });
    // B sails up inside A in the zone: 18.2(a) fixed the entitlement when A reached the zone.
    t.update(1, [boat('A', 12, 3, 180, 160), boat('B', 12, 0.8, 180, 160)]);
    expect(t.entitlement('A', 'B')).toMatchObject({ entitled: 'A', giver: 'B' });
  });

  it('does not apply between boats on opposite tacks on a beat to windward', () => {
    const port = boat('P', -15, 3, 45, -42);
    const stbd = boat('S', -15, -3, 315, 42);
    expect(rule18Applies(port, stbd)).toBe(false);
    const t = new MarkRoomTracker();
    t.update(0, [port, stbd]);
    expect(t.entitlement('P', 'S')).toBeUndefined();
    // Downwind, on opposite gybes, it does apply.
    expect(rule18Applies(boat('P', 15, 3, 200, -160), boat('S', 15, -3, 160, 160))).toBe(true);
  });

  it('does not apply between a boat approaching the mark and one leaving it, or with different rounding sides', () => {
    expect(rule18Applies(boat('A', 10, 0, 180, 160), boat('B', -6, 2, 90, 90, { markKey: 'leg2:B' }))).toBe(false);
    expect(rule18Applies(boat('A', 10, 0, 180, 160), boat('B', 10, 3, 180, 160, { rounding: 'starboard' }))).toBe(false);
  });

  it('ends when the entitled boat leaves the zone, passes head to wind, or rounds the mark', () => {
    const start = () => {
      const t = new MarkRoomTracker();
      t.update(0, [boat('A', 18, 4, 180, 160), boat('B', 18, 1.5, 180, 160)]);
      expect(t.entitlement('A', 'B')?.entitled).toBe('B');
      return t;
    };
    let t = start();
    t.update(1, [boat('A', 40, 4, 0, -20), boat('B', 40, 1.5, 0, -20)]); // both sailed back out of the zone
    expect(t.entitlement('A', 'B')).toBeUndefined();
    t = start();
    t.update(1, [boat('A', 12, 4, 180, 160), boat('B', 12, 1.5, 180, 160, { tacking: true })]);
    expect(t.entitlement('A', 'B')).toBeUndefined();
    t = start();
    t.update(1, [boat('A', 4, 4, 180, 160), boat('B', -3, -1, 90, 90, { markKey: 'leg2:B' })]); // B has rounded
    expect(t.entitlement('A', 'B')).toBeUndefined();
  });
});
