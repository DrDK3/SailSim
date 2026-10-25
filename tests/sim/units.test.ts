import { describe, expect, it } from 'vitest';
import { wrapPi, wrap2Pi, smoothstep, DEG } from '../../src/sim/math/angles';
import { interpTable } from '../../src/sim/math/interp';
import { hypot2 } from '../../src/sim/math/hypot';
import { createRng } from '../../src/sim/math/rng';
import { hashNumbers } from '../../src/sim/hash';
import { validateProvenance, buildBoatParams } from '../../src/sim/boat/params';
import { SQUIB_CALIBRATION, SQUIB_CLASS_SPEC, squibParams, squibProvenance } from '../../src/sim/boat/squib';
import { foilCoefficients, sailCoefficients } from '../../src/sim/boat/coefficients';
import { hullResistance } from '../../src/sim/boat/forces';
import { updateSide } from '../../src/sim/boat/dynamics';

describe('math utilities', () => {
  it('wraps angles', () => {
    expect(wrapPi(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapPi(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapPi(-190 * DEG)).toBeCloseTo(170 * DEG, 12);
    expect(wrap2Pi(-10 * DEG)).toBeCloseTo(350 * DEG, 12);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });

  it('interpolates and extrapolates tables', () => {
    const t: [number, number][] = [[0, 0], [1, 10], [2, 30]];
    expect(interpTable(t, 0.5)).toBe(5);
    expect(interpTable(t, 1.5)).toBe(20);
    expect(interpTable(t, 3)).toBe(50);
  });

  it('seeded RNG is reproducible', () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b.next()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('hypot2 is bit-identical to Math.hypot (two arguments)', () => {
    const specials = [0, -0, 1, -1, 3, 4, Infinity, -Infinity, NaN, 5e-324, 1e-308, 1e-160, 1e154, 1e308];
    for (const a of specials) for (const b of specials) expect(Object.is(hypot2(a, b), Math.hypot(a, b))).toBe(true);
    const rng = createRng(7);
    const bits = new Float64Array(1);
    const words = new Uint32Array(bits.buffer);
    let mismatches = 0;
    for (let i = 0; i < 300_000; i++) {
      let x: number;
      let y: number;
      if (i % 3 === 0) {
        // Arbitrary bit patterns (any exponent, subnormals, NaNs).
        words[0] = rng.next() * 2 ** 32;
        words[1] = rng.next() * 2 ** 32;
        x = bits[0]!;
        words[0] = rng.next() * 2 ** 32;
        words[1] = rng.next() * 2 ** 32;
        y = bits[0]!;
      } else {
        x = (rng.next() - 0.5) * 10 ** (rng.next() * 8 - 4);
        y = (rng.next() - 0.5) * 10 ** (rng.next() * 8 - 4);
      }
      if (!Object.is(hypot2(x, y), Math.hypot(x, y))) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('hash is bit-exact', () => {
    expect(hashNumbers([1, 2, 3])).toBe(hashNumbers([1, 2, 3]));
    expect(hashNumbers([1, 2, 3])).not.toBe(hashNumbers([1, 2, 3 + 1e-15]));
  });
});

describe('boat data provenance', () => {
  it('every parameter carries value, unit, tag and source', () => {
    const p = squibProvenance();
    expect(p.classSpec.length).toBeGreaterThan(10);
    expect(p.calibration.length).toBeGreaterThan(40);
    // Calibration coefficients are estimates by definition; the one fact among them is the build's cockpit.
    expect(p.calibration.filter((r) => r.tag !== 'E').map((r) => `${r.path} ${r.tag}`)).toEqual(['cockpit.selfDraining S']);
  });

  it('rejects parameters without provenance', () => {
    expect(() => validateProvenance({ x: { value: 1, unit: 'm', tag: 'E' } })).toThrow(/source/);
    expect(() => validateProvenance({ x: { value: 1, unit: 'm', tag: 'Q', source: 's' } })).toThrow(/tag/);
    const broken = JSON.parse(JSON.stringify(SQUIB_CALIBRATION));
    delete broken.stability.gm.source;
    expect(() => buildBoatParams(SQUIB_CLASS_SPEC, broken)).toThrow(/stability.gm/);
  });

  it('derives masses from the class data', () => {
    const p = squibParams();
    expect(p.mass).toBe(680 + 2 * 80);
    expect(p.main.area + p.jib.area).toBeCloseTo(16.5, 9);
  });
});

describe('coefficient models', () => {
  const p = squibParams();
  it('foil lift is odd, drag even, in all quadrants', () => {
    for (const a of [3, 10, 25, 60, 120, 170]) {
      const pos = foilCoefficients(a * DEG, p.rudder);
      const neg = foilCoefficients(-a * DEG, p.rudder);
      expect(pos.cl).toBeCloseTo(-neg.cl, 12);
      expect(pos.cd).toBeCloseTo(neg.cd, 12);
      expect(pos.cd).toBeGreaterThanOrEqual(0);
    }
    expect(foilCoefficients(0, p.rudder).cl).toBe(0);
  });

  it('sail luffs at low incidence and stalls into a drag device at high incidence', () => {
    const luffing = sailCoefficients(1 * DEG, p.main.coeff);
    expect(luffing.luff).toBe(0);
    expect(luffing.cl).toBe(0);
    expect(luffing.cd).toBeCloseTo(p.main.coeff.cdFlap, 12);
    const peak = sailCoefficients(p.main.coeff.alphaPeak, p.main.coeff);
    expect(peak.cl).toBeCloseTo(p.main.coeff.clMax, 6);
    const square = sailCoefficients(90 * DEG, p.main.coeff);
    expect(Math.abs(square.cl)).toBeLessThan(0.05);
    expect(square.cd).toBeGreaterThan(1.0);
  });

  it('hull resistance grows monotonically with speed and with heel', () => {
    let last = 0;
    for (let kn = 0.5; kn <= 8; kn += 0.5) {
      const r = hullResistance(p, kn * 0.514444, 0, 1025).total;
      expect(r).toBeGreaterThan(last);
      last = r;
    }
    expect(hullResistance(p, 2.5, 0.3, 1025).total).toBeGreaterThan(hullResistance(p, 2.5, 0, 1025).total);
  });

  it('sail side switches on a tack immediately but only well by the lee on a gybe', () => {
    expect(updateSide(1, -2 * DEG, 15 * DEG)).toBe(-1); // tack through head to wind
    expect(updateSide(1, -170 * DEG, 15 * DEG)).toBe(1); // 10° by the lee: boom stays
    expect(updateSide(1, -160 * DEG, 15 * DEG)).toBe(-1); // 20° by the lee: gybe
    expect(updateSide(-1, -60 * DEG, 15 * DEG)).toBe(-1);
  });
});
