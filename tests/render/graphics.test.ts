/** The graphics upgrade's logic: presets, sound levels, lighting times, the cameras' follow rules, sails' set, the wake. */
import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import { PRESETS, defaultPreset, loadGraphics, matchPreset, pixelRatioFor, presetSettings, saveGraphics } from '../../src/render/graphics';
import { flutterVoice, waterVoice, windVoice } from '../../src/render/audio';
import { lightingStart } from '../../src/app/lighting';
import { sunPosition } from '../../src/sim/env/sun';
import { RDYC_ORIGIN } from '../../src/sim/geo/projection';
import { chaseHeight, followHeave, scenicPose } from '../../src/render/frames';
import { sailTrim } from '../../src/render/squibModel';
import { WakeTrail } from '../../src/render/boatWater';

// A stand-in for the browser's storage.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

describe('graphics presets', () => {
  it('defaults to Performance on a software renderer and Balanced on a graphics card', () => {
    expect(defaultPreset('Google SwiftShader')).toBe('performance');
    expect(defaultPreset('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('performance');
    expect(defaultPreset('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe('balanced');
    expect(loadGraphics('SwiftShader').preset).toBe('performance');
    expect(loadGraphics('NVIDIA GeForce RTX 3060').preset).toBe('balanced');
  });

  it('presets rise in cost: Performance draws fewer pixels and simpler water than Balanced and Ultra', () => {
    expect(PRESETS.performance.resolutionScale).toBeLessThan(PRESETS.balanced.resolutionScale);
    expect(PRESETS.performance.water).toBe('low');
    expect(PRESETS.balanced.water).toBe('high');
    expect(PRESETS.ultra.maxPixelRatio).toBeGreaterThan(PRESETS.balanced.maxPixelRatio);
  });

  it("keeps the viewer's choice, recognises a preset, and falls back on bad values", () => {
    const s = { ...presetSettings('balanced'), spray: false };
    expect(matchPreset(s)).toBe('custom');
    saveGraphics({ ...s, preset: 'custom' });
    const back = loadGraphics('ANGLE (NVIDIA)');
    expect(back.spray).toBe(false);
    expect(back.preset).toBe('custom');
    store.set('squib.graphics.v1', JSON.stringify({ resolutionScale: 9, water: 'wet', cameraMotion: -3 }));
    const bad = loadGraphics('ANGLE (NVIDIA)');
    expect(bad.resolutionScale).toBe(1);
    expect(bad.water).toBe('high');
    expect(bad.cameraMotion).toBe(0);
    store.set('squib.graphics.v1', 'not json');
    expect(loadGraphics('SwiftShader').preset).toBe('performance');
  });

  it("draws at the screen's density up to the cap, scaled by the resolution", () => {
    expect(pixelRatioFor(presetSettings('ultra'), 2)).toBe(2);
    expect(pixelRatioFor(presetSettings('balanced'), 2)).toBe(1.5);
    expect(pixelRatioFor(presetSettings('performance'), 2)).toBeCloseTo(0.75, 12);
    expect(pixelRatioFor({ ...presetSettings('performance'), resolutionScale: 0.5 }, 1)).toBe(0.5);
  });
});

describe('sound levels', () => {
  it('wind louder and higher with more wind; whistle only in a breeze', () => {
    const a = windVoice(2);
    const b = windVoice(10);
    expect(b.level).toBeGreaterThan(a.level);
    expect(b.freq).toBeGreaterThan(a.freq);
    expect(windVoice(5).whistle).toBe(0);
    expect(windVoice(15).whistle).toBeGreaterThan(0.5);
    for (const w of [0, 3, 8, 30]) expect(windVoice(w).level).toBeLessThanOrEqual(1);
  });

  it('water rush grows with speed; bubbles only when she is going', () => {
    expect(waterVoice(0).rush).toBe(0);
    expect(waterVoice(2).rush).toBeGreaterThan(waterVoice(1).rush);
    expect(waterVoice(1).hiss).toBe(0);
    expect(waterVoice(3.5).hiss).toBeCloseTo(1, 6);
  });

  it('a drawing sail is silent; a flogging one flutters faster in more wind', () => {
    expect(flutterVoice(1, 8).level).toBe(0);
    expect(flutterVoice(0.1, 8).level).toBeGreaterThan(0.5);
    expect(flutterVoice(0.1, 10).rate).toBeGreaterThan(flutterVoice(0.1, 3).rate);
  });
});

describe('lighting presets', () => {
  const { lat, lon } = RDYC_ORIGIN;
  const el = (iso: string) => sunPosition(Date.parse(iso), lat, lon);

  it('on 15 July 2026 at the Dart: morning sun about 20° in the east, golden hour about 6° in the west, midday highest', () => {
    const m = lightingStart('2026-07-15T13:00:00Z', 'morning', lat, lon);
    const g = lightingStart('2026-07-15T13:00:00Z', 'golden', lat, lon);
    const n = lightingStart('2026-07-15T13:00:00Z', 'midday', lat, lon);
    expect(el(m.startTime).elevationDeg).toBeGreaterThan(18);
    expect(el(m.startTime).elevationDeg).toBeLessThan(21);
    expect(el(m.startTime).azimuthDeg).toBeLessThan(180);
    expect(el(g.startTime).elevationDeg).toBeGreaterThan(4);
    expect(el(g.startTime).elevationDeg).toBeLessThan(7);
    expect(el(g.startTime).azimuthDeg).toBeGreaterThan(180);
    expect(el(n.startTime).elevationDeg).toBeGreaterThan(59);
    // Same date; clear skies except the overcast preset.
    for (const x of [m, g, n]) expect(x.startTime.slice(0, 10)).toBe('2026-07-15');
    expect(m.sky).toBe('clear');
    expect(lightingStart('2026-07-15T13:00:00Z', 'overcast', lat, lon)).toEqual({ startTime: n.startTime, sky: 'overcast' });
  });

  it('in midwinter, when the sun never reaches 20°, the morning preset is just short of its highest', () => {
    const m = lightingStart('2026-12-21T12:00:00Z', 'morning', lat, lon);
    const e = el(m.startTime).elevationDeg;
    expect(e).toBeGreaterThan(10);
    expect(e).toBeLessThan(17);
  });
});

describe('camera follow rules', () => {
  it('a steady camera ignores the waves; full motion follows half of each', () => {
    expect(followHeave(0.1, 0.5, 0)).toBeCloseTo(0.1, 12);
    expect(followHeave(0.1, 0.5, 1)).toBeCloseTo(0.3, 12);
    expect(followHeave(0.1, 0.5, 5)).toBeCloseTo(0.3, 12);
  });

  it("zooming keeps the chase view's angle, and the scenic camera stays low and well off", () => {
    expect(chaseHeight(15)).toBeCloseTo(5.5, 12);
    expect(chaseHeight(30) / 30).toBeCloseTo(5.5 / 15, 12);
    for (let t = 0; t < 900; t += 7) {
      const p = scenicPose(t);
      expect(p.distance).toBeGreaterThanOrEqual(24);
      expect(p.distance).toBeLessThanOrEqual(36);
      expect(p.height).toBeGreaterThanOrEqual(2.6);
      expect(p.height).toBeLessThanOrEqual(3.8);
    }
  });
});

describe('sails set by the controls', () => {
  it('flattening takes depth out and twists the leech; easing the sheet twists it more; flogging speeds up in wind', () => {
    const full = sailTrim(0, 0, 6);
    const flat = sailTrim(1, 0, 6);
    expect(flat.depth).toBeLessThan(full.depth);
    expect(flat.depth).toBeCloseTo(0.65, 12);
    expect(flat.draft).toBeLessThan(full.draft);
    expect(flat.twist).toBeGreaterThan(full.twist);
    expect(sailTrim(0, 1, 6).twist).toBeGreaterThan(full.twist);
    expect(sailTrim(0, 0, 12).flutterW).toBeGreaterThan(sailTrim(0, 0, 3).flutterW);
    // Out-of-range inputs are clamped.
    expect(sailTrim(5, -2, 6)).toEqual(sailTrim(1, 0, 6));
  });
});

describe('wake', () => {
  it('spreads at the Kelvin angle (19.5° each side) behind the stern', () => {
    const u = { value: 0 };
    const sea = { uTime: u, uComp: { value: [] }, uCurrent: { value: new THREE.Vector2() }, uField: { value: null }, uFieldOrigin: { value: new THREE.Vector2() }, uFieldCell: { value: 50 } };
    const wake = new WakeTrail(sea);
    const boat = new THREE.Object3D();
    // Sailing north (towards -z) at 2.5 m/s for 10 s.
    for (let t = 0; t <= 10.001; t += 0.1) {
      boat.position.set(0, 0, -2.5 * t);
      boat.updateMatrixWorld();
      wake.update(boat, 2.5, 0, t);
    }
    const half = wake.mesh.geometry.getAttribute('aHalf') as THREE.BufferAttribute;
    const age = wake.mesh.geometry.getAttribute('aAge') as THREE.BufferAttribute;
    // The oldest point: about 10 s old, spread to 0.7 m + 2.5 m/s × 10 s × tan 19.47°.
    let k = 0;
    for (let i = 0; i < half.count; i += 2) if (age.getX(i) > age.getX(k)) k = i;
    expect(age.getX(k)).toBeGreaterThan(9.5);
    expect(half.getX(k)).toBeCloseTo(0.7 + 2.5 * age.getX(k) * Math.tan((19.47 * Math.PI) / 180), 6);
    // Vertices across the trail lie on the track (the core) and at its edges, so each band follows the waves.
    const lat = wake.mesh.geometry.getAttribute('aLat') as THREE.BufferAttribute;
    const pos = wake.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lats = [];
    for (let i = 0; i < half.count; i++) if (age.getX(i) === age.getX(k)) lats.push(lat.getX(i));
    expect(Math.min(...lats)).toBeCloseTo(-half.getX(k), 6);
    expect(Math.max(...lats)).toBeCloseTo(half.getX(k), 6);
    expect(lats).toContain(0);
    for (let i = 0; i < half.count; i++) if (age.getX(i) === age.getX(k)) expect(pos.getX(i)).toBeCloseTo(lat.getX(i), 6);
  });
});
