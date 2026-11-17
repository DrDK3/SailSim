/**
 * The Class of 1866 (owner, 17 Nov 2026): every race's AI fleet comes from the four yacht clubs founded in 1866, the
 * Royal Dart's year (Royal Ulster, Kongelig Dansk Yachtklub, Boston, Atlantic), in their colours and flying their
 * burgees. These tests hold the clubs, how a fleet is drawn from them, and that a race's AI boats carry them.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CLASS_OF_1866, class1866Entry, raceClub } from '../../src/sim/race/class1866';
import { createRace } from '../../src/sim/race/setup';
import { practiceCourse } from '../../src/sim/course/practice';
import { squibParams } from '../../src/sim/boat/squib';

vi.mock('../../src/render/labels', () => ({ makeLabel: () => new THREE.Sprite() }));
const { SquibModel } = await import('../../src/render/squibModel');
const { FleetView } = await import('../../src/render/fleet');

describe('the Class of 1866', () => {
  it('is the four clubs, all founded in 1866', () => {
    expect(CLASS_OF_1866.map((c) => c.name)).toEqual(['Royal Ulster Yacht Club', 'Kongelig Dansk Yachtklub', 'Boston Yacht Club', 'Atlantic Yacht Club']);
    for (const c of CLASS_OF_1866) expect(c.founded).toBe(1866);
    // Each club's boats look different: no two share topsides, stripe and boot top.
    const looks = new Set(CLASS_OF_1866.map((c) => `${c.paint.topsides}${c.paint.stripe}${c.paint.boot}`));
    expect(looks.size).toBe(4);
    expect(new Set(CLASS_OF_1866.map((c) => c.mark)).size).toBe(4);
  });

  it('a fleet takes the clubs in turn, so every club sails once there are four boats; names and sail numbers are labelled', () => {
    const e = Array.from({ length: 9 }, (_, i) => class1866Entry(i));
    expect(e.map((x) => x.club)).toEqual(['ruyc', 'kdy', 'byc', 'ayc', 'ruyc', 'kdy', 'byc', 'ayc', 'ruyc']);
    expect(e.map((x) => x.name).slice(0, 5)).toEqual(['RUYC 1', 'KDY 1', 'BYC 1', 'AYC 1', 'RUYC 2']);
    expect(e[0]!.sailNumber).toBe('AI01');
    expect(e[8]!.sailNumber).toBe('AI09');
    for (const x of e) expect(x.colour).toBe(raceClub(x.club)!.mark);
    expect(raceClub('rdyc')).toBeUndefined();
  });

  it("a race's AI boats are the Class of 1866; the user's boat is not", () => {
    const course = practiceCourse({ kind: 'windward-leeward', centre: { n: 0, e: 0 }, windFromDeg: 225, startLineM: 120 });
    const { session } = createRace({
      conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'moderate', seed: 3 }, current: { mode: 'none' } },
      course,
      aiCount: 5,
      level: 'good',
      seed: 3,
      human: {},
      committee: { startAt: 60, sequence: 'one-minute' },
    });
    const ai = session.fleet.boats.filter((b) => b.kind === 'ai');
    expect(ai.map((b) => b.club)).toEqual(['ruyc', 'kdy', 'byc', 'ayc', 'ruyc']);
    expect(ai.map((b) => b.name)).toEqual(['RUYC 1', 'KDY 1', 'BYC 1', 'AYC 1', 'RUYC 2']);
    expect(session.fleet.boats.find((b) => b.id === 'you')!.club).toBeUndefined();
  });
});

describe('drawn in their colours', () => {
  const hullOf = (g: THREE.Object3D) => {
    let m: THREE.Material | undefined;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === 'hull') m = o.material as THREE.Material;
    });
    return m!;
  };

  it("a club boat's hull is painted in its club's colours, untinted; the user's keeps the club Squib's", () => {
    const c = CLASS_OF_1866[0]!;
    const m = new SquibModel(squibParams(), { transom: c.short, paint: c.paint });
    m.setHullPaint(c.paint);
    const mat = hullOf(m.group) as THREE.MeshStandardMaterial;
    expect(mat.customProgramCacheKey()).toContain(c.paint.topsides);
    expect(mat.color.getHex()).toBe(0xffffff);
    const own = hullOf(new SquibModel(squibParams()).group);
    expect(own.customProgramCacheKey()).not.toContain(c.paint.topsides);
  });

  it('the fleet view paints each AI boat in her club colours and keeps a plain tint for a boat with no club', () => {
    const v = new FleetView(squibParams());
    v.setBoats([
      { id: 'ai-1', label: 'RUYC · AI01', colour: 0x3a62c4, club: 'ruyc' },
      { id: 'ai-2', label: 'KDY · AI02', colour: 0xd42a3c, club: 'kdy' },
      { id: 'x', label: 'X', colour: 0x00ff00 },
    ]);
    const boat = (id: string) => v.group.getObjectByName(`fleet-boat-${id}`)!;
    expect((hullOf(boat('ai-1')) as THREE.MeshStandardMaterial).customProgramCacheKey()).toContain('#1b2d5a');
    expect((hullOf(boat('ai-2')) as THREE.MeshStandardMaterial).customProgramCacheKey()).toContain('#c8102e');
    expect((hullOf(boat('x')) as THREE.MeshStandardMaterial).color.getHex()).toBe(0x00ff00);
  });
});
