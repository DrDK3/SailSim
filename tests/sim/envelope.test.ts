import { describe, expect, it } from 'vitest';
import { squibParams } from '../../src/sim/boat/squib';
import { crewPolicyPoint } from '../../src/sim/ai/polar';
import { AI_POLAR } from '../../src/sim/ai/polarData';
import { boatImpact, committeePass, coastDown, jettyImpact, pileTunnelling, pinnedOnJetty, upwind } from '../../src/sim/validation/envelope';

/**
 * Regression checks on the behaviour envelope (comprehensive review, Package 1; docs/review/ACCEPTANCE_SCENARIOS.md).
 * These pin what the model does; they are not realism validation.
 */
const P = squibParams();

describe('contact (A-CO-1, A-CO-5, A-CO-7)', () => {
  it('no tunnelling: 8 kn square into a 0.3 m jetty, 14 kn into a 0.3 m pile', () => {
    expect(jettyImpact(P, 8, 0.3).passedThrough).toBe(false);
    expect(pileTunnelling(P).rows[0]!.passed_through).toBe(false);
  });

  it('no collision gains energy', () => {
    for (const kn of [4, 8]) expect(jettyImpact(P, kn, 0.3).maxKeGain).toBeLessThan(1);
    expect(boatImpact(P, [0, 0, 0, 4], [8, 0, 90, 0]).keGain).toBeLessThan(1);
    expect(boatImpact(P, [0, 0, 0, 6], [14, 0, 180, 6]).keGain).toBeLessThan(1);
    expect(boatImpact(P, [0, -0.9, 0, 4], [8, 0.9, 15, 0]).keGain).toBeLessThan(1);
  });

  it('a boat pinned against a pontoon by 20 kn of wind lies still (jitter under 5 mm)', () => {
    expect(pinnedOnJetty(P).rows[0]!.jitter_last_10s_mm as number).toBeLessThan(5);
  });

  it('the committee boat collides where SAMARITAN is drawn (within 0.2 m), not as a 2.5 m circle', () => {
    expect(committeePass(P, 0.2).contact).toBe(true);
    expect(committeePass(P, -0.2).contact).toBe(false);
  });
});

describe('one polar generator (PH-2, PH-7)', () => {
  it('the dashboard\'s point is the AI\'s table value, with the crew policy', () => {
    const p = crewPolicyPoint(P, 10, 42);
    const i = AI_POLAR.twsKn.indexOf(10);
    const j = AI_POLAR.twaDeg.indexOf(42);
    expect(Math.abs(p.stwKn - AI_POLAR.stwKn[i]![j]!)).toBeLessThan(0.02);
    expect(p.settled).toBe(true);
  });

  it('a point that is still swinging is flagged, not passed off as steady (25 kn close-hauled)', () => {
    const p = crewPolicyPoint(P, 25, 42);
    expect(p.settled).toBe(false);
    expect(p.heelRangeDeg).toBeGreaterThan(1);
  });
});

describe('envelope scenarios are deterministic', () => {
  it('the same run gives the same numbers', () => {
    expect(coastDown(P)).toEqual(coastDown(P));
    expect(upwind(P, [10])).toEqual(upwind(P, [10]));
  });
});
