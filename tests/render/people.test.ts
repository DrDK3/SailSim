/** People ashore: proportions and heights, the shader's parts, and what the people standing about do. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ACT, PERSON, gaitRate, peopleMesh, personPartsGeometry, statureScale } from '../../src/render/people';
import { placePeople } from '../../src/render/population';
import { ferryQueues } from '../../src/render/dart';
import { readFileSync } from 'node:fs';
import type { DartFeatures } from '../../src/app/geoLoader';

describe('a person', () => {
  it('stands 1.68 m tall at scale 1, about 0.4 m across the shoulders, with every vertex in a part', () => {
    const g = personPartsGeometry();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.y).toBeCloseTo(PERSON.stature, 1);
    expect(b.min.y).toBeCloseTo(0, 6);
    // Shoulder to shoulder (arms included) under half a metre; front to back under 0.3 m.
    expect(b.max.x - b.min.x).toBeLessThan(0.5);
    expect(b.max.x - b.min.x).toBeGreaterThan(0.35);
    expect(b.max.z - b.min.z).toBeLessThan(0.3);
    const parts = g.getAttribute('aPart');
    const seen = new Set<number>();
    for (let i = 0; i < parts.count; i++) seen.add(parts.getX(i));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // The clothing (the instance colour) is the torso and the sleeves only.
    const shirt = g.getAttribute('aShirt');
    let n = 0;
    for (let i = 0; i < shirt.count; i++) n += shirt.getX(i);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(shirt.count / 2);
  });

  it('comes in heights from about 1.55 to 1.80 m, and walks a stride per gait cycle', () => {
    expect(PERSON.stature * statureScale(0)).toBeCloseTo(1.546, 2);
    expect(PERSON.stature * statureScale(0.999)).toBeLessThan(1.81);
    // 1.4 m/s: a cycle (two steps) per 1.4 m.
    expect(gaitRate(1.4)).toBeCloseTo(2 * Math.PI, 9);
    const m = peopleMesh(5, 0, 'test');
    expect((m.geometry.getAttribute('iMotion') as THREE.InstancedBufferAttribute).itemSize).toBe(4);
  });
});

describe('people about the quays', () => {
  // A quay at +3 m ODN south of n = 0, the river (bed -5 m) north of it.
  const groundAt = (_e: number, n: number) => (n > 0 ? -5 : 3);
  let seed = 7;
  const rng = { next: () => ((seed = (seed * 16807) % 2147483647) / 2147483647) };

  it('chat in twos and threes facing each other, watch the river, sit on benches facing it, or stand', () => {
    const standing = Array.from({ length: 120 }, (_, i) => ({ e: i * 6, n: -2, floating: false, deck: 3 }));
    const { people, benches, activities } = placePeople({ standing, groundAt }, rng);
    expect(activities.chatting).toBeGreaterThan(10);
    expect(activities.watching).toBeGreaterThan(10);
    expect(activities.sitting).toBeGreaterThan(3);
    expect(benches.length).toBeGreaterThan(2);
    // Watchers lean on the rail facing the water (north: 0).
    for (const p of people.filter((x) => x.act === ACT.lean)) expect(Math.abs(Math.atan2(Math.sin(p.facing), Math.cos(p.facing)))).toBeLessThan(0.4);
    for (const b of benches) expect(Math.abs(Math.atan2(Math.sin(b.facing), Math.cos(b.facing)))).toBeLessThan(0.4);
    // A chatting group faces its middle.
    const chat = people.filter((x) => x.act === ACT.chat);
    const a = chat[0]!;
    const mates = chat.filter((x) => Math.hypot(x.e - a.e, x.n - a.n) < 1.2);
    expect(mates.length).toBeGreaterThanOrEqual(2);
    const ce = mates.reduce((s, x) => s + x.e, 0) / mates.length;
    const cn = mates.reduce((s, x) => s + x.n, 0) / mates.length;
    const toMiddle = Math.atan2(ce - a.e, cn - a.n);
    expect(Math.abs(Math.atan2(Math.sin(toMiddle - a.facing), Math.cos(toMiddle - a.facing)))).toBeLessThan(0.05);
  });

  it('queue at the ferry landings on dry land, facing the boat', () => {
    const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as DartFeatures;
    const qs = ferryQueues(features);
    expect(qs.length).toBeGreaterThan(8);
    const { people, activities } = placePeople({ queues: [{ e: 0, n: -10, de: 0, dn: 1 }], groundAt }, rng);
    expect(activities.queueing).toBeGreaterThanOrEqual(3);
    for (const p of people) {
      expect(p.n).toBeLessThanOrEqual(-10 + 0.2);
      expect(Math.abs(p.facing)).toBeLessThan(0.25);
    }
  });
});
