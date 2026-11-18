/**
 * The fleet's tracks for the replay from above (owner, 18 Nov 2026): a record of where every boat was, once a second,
 * read back between samples; thinned, never dropped, when a race runs very long.
 */
import { describe, expect, it } from 'vitest';
import { FleetTrack } from '../../src/app/fleetTrack';

const boat = (id: string, n: number, e: number, heading = 0) => ({ id, label: id.toUpperCase(), colour: 0x123456, you: id === 'you', n, e, heading });

describe('the fleet\'s tracks', () => {
  it('records each boat and reads back between samples', () => {
    const f = new FleetTrack();
    expect(f.at(3)).toEqual([]);
    expect(f.span).toBeUndefined();
    for (let t = 0; t <= 10; t++) f.add(t, [boat('you', t * 2, 0, 0), boat('a', 100, t * 3, Math.PI / 2)]);
    expect(f.boats.map((b) => b.id)).toEqual(['you', 'a']);
    expect(f.boats[0]).toEqual({ id: 'you', label: 'YOU', colour: 0x123456, you: true });
    expect(f.length).toBe(11);
    expect(f.span).toEqual({ from: 0, to: 10 });
    const p = f.at(4.5);
    expect(p[0]).toMatchObject({ id: 'you', n: 9, e: 0 });
    expect(p[1]!.e).toBeCloseTo(13.5, 9);
    // Before the first and after the last sample: the ends.
    expect(f.at(-5)[0]!.n).toBe(0);
    expect(f.at(99)[0]!.n).toBe(20);
    expect(f.track(0).n).toHaveLength(11);
  });

  it('turns the short way round between headings', () => {
    const f = new FleetTrack();
    f.add(0, [boat('you', 0, 0, (350 * Math.PI) / 180)]);
    f.add(1, [boat('you', 0, 0, (10 * Math.PI) / 180)]);
    const h = ((f.at(0.5)[0]!.heading * 180) / Math.PI + 360) % 360;
    expect(Math.min(h, 360 - h)).toBeLessThan(1e-6);
  });

  it('a very long race is thinned to half, the spacing doubled, the whole race kept', () => {
    const f = new FleetTrack(100);
    for (let t = 0; t < 400; t++) f.add(t, [boat('you', t, 0)]);
    expect(f.length).toBeLessThanOrEqual(100);
    expect(f.length).toBeGreaterThan(40);
    expect(f.span!.from).toBe(0);
    expect(f.span!.to).toBeGreaterThan(390);
    // Still where she was at any time, to within the coarser spacing.
    expect(f.at(123.4)[0]!.n).toBeCloseTo(123.4, 6);
    f.clear();
    expect(f.length).toBe(0);
    expect(f.boats).toEqual([]);
  });

  it('a boat missing from a later sample keeps her last place', () => {
    const f = new FleetTrack();
    f.add(0, [boat('you', 0, 0), boat('a', 5, 5)]);
    f.add(1, [boat('you', 1, 0)]);
    expect(f.at(1)[1]).toMatchObject({ id: 'a', n: 5, e: 5 });
  });
});
