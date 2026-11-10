/**
 * Navigation lights after the COLREGs (src/render/navLights.ts): each light only inside its arc (Rule 21) and range
 * (Rule 22), and each vessel's set for what she is (Rules 23, 24, 27, 30).
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('../../src/render/labels', () => ({ makeLabel: () => new THREE.Sprite() }));
const { buildLights, colregsLights, inArc, lightRanges, updateLights } = await import('../../src/render/navLights');
const { TrafficView } = await import('../../src/render/traffic');

describe('the arcs (Rule 21)', () => {
  it('masthead 225°, sidelights 112.5° each from dead ahead, sternlight 135°, all-round 360°', () => {
    expect(inArc('masthead', 0)).toBe(true);
    expect(inArc('masthead', 112)).toBe(true);
    expect(inArc('masthead', 113)).toBe(false);
    expect(inArc('masthead', -112)).toBe(true);
    expect(inArc('starboard', 10)).toBe(true);
    expect(inArc('starboard', 112)).toBe(true);
    expect(inArc('starboard', 113)).toBe(false);
    expect(inArc('starboard', -10)).toBe(false);
    expect(inArc('port', -10)).toBe(true);
    expect(inArc('port', 10)).toBe(false);
    // Dead ahead you see both sidelights (within the 1–3° Annex I allows across the bow).
    expect(inArc('port', 0) && inArc('starboard', 0)).toBe(true);
    expect(inArc('stern', 180)).toBe(true);
    expect(inArc('stern', 113)).toBe(true);
    expect(inArc('stern', 112)).toBe(false);
    expect(inArc('stern', -150)).toBe(true);
    for (const b of [0, 90, 180, 270]) expect(inArc('all-round', b)).toBe(true);
    // Masthead and stern lights together cover the horizon once.
    for (let b = -180; b <= 180; b += 0.5) expect(inArc('masthead', b) !== inArc('stern', b) || Math.abs(Math.abs(b) - 112.5) < 1e-9).toBe(true);
  });
});

describe('the ranges (Rule 22)', () => {
  it('by length', () => {
    expect(lightRanges(10)).toEqual({ masthead: 2, side: 1, stern: 2, allRound: 2 });
    expect(lightRanges(18)).toEqual({ masthead: 3, side: 2, stern: 2, allRound: 2 });
    expect(lightRanges(33)).toEqual({ masthead: 5, side: 2, stern: 2, allRound: 2 });
    expect(lightRanges(60)).toEqual({ masthead: 6, side: 3, stern: 3, allRound: 3 });
  });
});

describe('the sets (Rules 23, 24, 25, 27, 30)', () => {
  const g = { length: 18, beam: 5, mastY: 6, sideY: 3 };
  const kinds = (l: ReturnType<typeof colregsLights>) => l.map((x) => `${x.arc}:${x.colour}`).sort();
  it('under power: a masthead light, sidelights and a sternlight; under 12 m an all-round white and sidelights', () => {
    expect(kinds(colregsLights('power', g))).toEqual(['masthead:white', 'port:red', 'starboard:green', 'stern:white']);
    expect(kinds(colregsLights('power-small', { ...g, length: 10 }))).toEqual(['all-round:white', 'port:red', 'starboard:green']);
  });
  it('towing alongside: two masthead lights in a vertical line; the vessel towed alongside: sidelights forward and a sternlight', () => {
    const tug = colregsLights('towing-alongside', g);
    const mh = tug.filter((l) => l.arc === 'masthead');
    expect(mh).toHaveLength(2);
    expect(mh[0]!.x).toBe(mh[1]!.x);
    expect(mh[0]!.z).toBe(mh[1]!.z);
    expect(Math.abs(mh[0]!.y - mh[1]!.y)).toBeGreaterThan(0.5);
    const float = colregsLights('towed-alongside', g);
    expect(kinds(float)).toEqual(['port:red', 'starboard:green', 'stern:white']);
    // At her forward end (bow towards −z).
    expect(float.find((l) => l.arc === 'port')!.z).toBeLessThan(-g.length / 2 + 1);
  });
  it('a sailing vessel shows no masthead light', () => {
    expect(colregsLights('sailing', g).some((l) => l.arc === 'masthead')).toBe(false);
  });
  it('restricted in her ability to manoeuvre: red, white, red all-round in a vertical line, above the rest', () => {
    const l = colregsLights('power', g, true);
    const ram = l.filter((x) => x.arc === 'all-round').sort((a, b) => b.y - a.y);
    expect(ram.map((x) => x.colour)).toEqual(['red', 'white', 'red']);
    expect(Math.min(...ram.map((x) => x.y))).toBeGreaterThan(Math.max(...l.filter((x) => x.arc !== 'all-round').map((x) => x.y)));
  });
  it('at anchor: one all-round white light (under 50 m)', () => {
    expect(kinds(colregsLights('anchored', g))).toEqual(['all-round:white']);
  });
});

describe('seen from around the vessel', () => {
  /** A vessel heading north at the origin (bow towards −z), with her lights; the camera at a bearing and distance. */
  const seen = (role: Parameters<typeof colregsLights>[0], bearingDeg: number, distance = 200, lit = true) => {
    const vessel = new THREE.Group();
    const lights = buildLights(colregsLights(role, { length: 18, beam: 5, mastY: 6, sideY: 3 }));
    vessel.add(lights);
    const cam = new THREE.PerspectiveCamera();
    const b = (bearingDeg * Math.PI) / 180;
    cam.position.set(Math.sin(b) * distance, 3, -Math.cos(b) * distance);
    updateLights(lights, cam, lit);
    return lights.children.filter((c) => c.visible && c.name.startsWith('light-')).map((c) => c.name.replace('light-', '')).sort();
  };
  it('ahead: masthead, red and green; on the starboard bow: masthead and green only', () => {
    expect(seen('power', 0)).toEqual(['masthead-white', 'port-red', 'starboard-green']);
    expect(seen('power', 45)).toEqual(['masthead-white', 'starboard-green']);
    expect(seen('power', -45)).toEqual(['masthead-white', 'port-red']);
  });
  it('from astern: the sternlight alone, never red and green together', () => {
    expect(seen('power', 180)).toEqual(['stern-white']);
    expect(seen('power', 150)).toEqual(['stern-white']);
  });
  it('none by day, none beyond their range (a sidelight of an 18 m vessel: 2 miles)', () => {
    expect(seen('power', 0, 200, false)).toEqual([]);
    expect(seen('power', 45, 2 * 1852 + 50)).toEqual(['masthead-white']);
  });
});

describe('the river traffic', () => {
  it('each vessel carries her set: the Lower Ferry tug two masthead lights and red-white-red, the yacht under engine no all-round white', () => {
    const view = new TrafficView();
    const cam = new THREE.PerspectiveCamera();
    view.update([
      { id: 'tf', name: 'Lower Ferry', label: 'Lower Ferry', unit: 0, kind: 'tug-float', length: 33, beam: 11, ram: true, n: 0, e: 0, heading: 0, sog: 1, moving: true, phase: 'underway', ramp: 1, parts: [], tug: { n: 0, e: 7, heading: 0 } },
      { id: 'y', name: 'yacht', label: 'yacht', unit: 0, kind: 'yacht', length: 10, beam: 3.3, ram: false, n: 200, e: 0, heading: 0, sog: 2, moving: true, phase: 'underway', ramp: 1, parts: [] },
    ] as never, 0, cam, false);
    const names = (root: THREE.Object3D) => {
      const out: string[] = [];
      root.traverse((o) => {
        if (o.parent?.name === 'lights' && o.name.startsWith('light-') && o.name !== 'light-label') out.push(o.name);
      });
      return out.sort();
    };
    const all = names(view.group);
    // The tug: two masthead lights and the red-white-red; the float: no masthead light of her own.
    expect(all.filter((n) => n === 'light-masthead-white').length).toBe(3); // the tug's two and the yacht's steaming light
    expect(all.filter((n) => n === 'light-all-round-red').length).toBe(2);
    expect(all.filter((n) => n === 'light-all-round-white').length).toBe(1);
  });
});
