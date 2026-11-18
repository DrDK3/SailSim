/**
 * The committee boat rides the drawn sea (owner, 18 Nov 2026: "The committee boat is not moving up and down with the
 * motion of the wave"): heave, pitch and roll from the surface over her waterplane, as the boats do (visual only).
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Course } from '../../src/sim/course/types';
import type { ResolvedCourse } from '../../src/sim/course/course';

// Labels draw text on a canvas (a browser API): plain sprites here.
vi.mock('../../src/render/labels', () => ({ makeLabel: () => new THREE.Sprite() }));
const { CourseScene } = await import('../../src/render/course');

function course() {
  const c = { id: 't', name: 'T', marks: [{ id: 'cb', name: 'Start boat', kind: 'committee-boat' }, { id: 'pin', name: 'Pin', kind: 'pin' }] } as unknown as Course;
  const r = {
    pos: new Map([['cb', { n: 100, e: 50 }], ['pin', { n: 100, e: -50 }]]),
    start: [{ n: 100, e: -50 }, { n: 100, e: 50 }], finish: [{ n: 100, e: -50 }, { n: 100, e: 50 }], legs: [], boundaries: [],
  } as unknown as ResolvedCourse;
  const scene = new CourseScene(r, c);
  const boat = scene.group.getObjectByName('committee-boat')!;
  return { scene, boat };
}

describe('the committee boat on the drawn sea', () => {
  it('in a calm (and without a sea given) she sits level at the waterline', () => {
    const { scene, boat } = course();
    scene.setCommitteeHeading(() => Math.PI / 3);
    scene.update(0, 'racing', true, 1);
    expect(Math.abs(boat.position.y)).toBe(0);
    for (let t = 0; t < 5; t += 0.1) scene.update(0, 'racing', true, t, { height: () => 0, dt: 0.1 });
    expect(Math.abs(boat.position.y)).toBe(0);
    expect(Math.abs(boat.rotation.x)).toBe(0);
    expect(Math.abs(boat.rotation.z)).toBe(0);
    expect(boat.rotation.y).toBeCloseTo(-Math.PI / 3, 12);
  });

  it('on a swell she rises and falls with the surface under her, and pitches as it runs along her', () => {
    const { scene, boat } = course();
    // She lies head to the north; a 0.5 m swell 60 m long runs from the north (along her length).
    scene.setCommitteeHeading(() => 0);
    const A = 0.5;
    const k = (2 * Math.PI) / 60;
    const w = Math.sqrt(9.81 * k);
    const height = (t: number) => (_x: number, z: number) => A * Math.sin(k * z - w * t);
    const ys: number[] = [];
    const pitches: number[] = [];
    let worst = 0;
    for (let t = 0; t < 20; t += 0.05) {
      scene.update(0, 'racing', true, t, { height: height(t), dt: 0.05 });
      ys.push(boat.position.y);
      pitches.push(boat.rotation.x);
      // The surface at her centre (x = e = 50, z = −n = −100): her heave follows it (the plane over her waterplane
      // averages a long swell only a little).
      worst = Math.max(worst, Math.abs(boat.position.y - height(t)(50, -100)));
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1.6 * A);
    expect(worst).toBeLessThan(0.15 * A);
    // Bow up and bow down as crests pass: a few degrees each way.
    expect(Math.max(...pitches)).toBeGreaterThan(0.02);
    expect(Math.min(...pitches)).toBeLessThan(-0.02);
    expect(Math.max(...pitches.map(Math.abs))).toBeLessThan(0.15);
    // Her heading is kept while she rides.
    expect(boat.rotation.y).toBeCloseTo(0, 12);
  });

  it('a swell across her rolls her rather than pitching her', () => {
    const { scene, boat } = course();
    scene.setCommitteeHeading(() => 0);
    const k = (2 * Math.PI) / 40;
    const w = Math.sqrt(9.81 * k);
    let maxRoll = 0;
    let maxPitch = 0;
    for (let t = 0; t < 15; t += 0.05) {
      // Running from the east (across a boat heading north).
      scene.update(0, 'racing', true, t, { height: (x) => 0.4 * Math.sin(k * x - w * t), dt: 0.05 });
      maxRoll = Math.max(maxRoll, Math.abs(boat.rotation.z));
      maxPitch = Math.max(maxPitch, Math.abs(boat.rotation.x));
    }
    expect(maxRoll).toBeGreaterThan(0.01);
    expect(maxPitch).toBeLessThan(1e-9);
  });
});
