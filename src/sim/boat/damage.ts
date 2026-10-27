/**
 * Damage from collisions and groundings (all thresholds and rates are estimates, E: there are no published
 * impact tests for a Squib). An impact's energy is the kinetic energy of the closing speed along the contact
 * normal, ½·m·v² (m: the boat with its added mass for a fixed object, half that for two boats meeting). Up to a
 * scrape it does nothing; beyond, depending on where the boat is struck:
 *  - anywhere, a hard enough knock cracks the hull: it leaks into the bilge (extra weight, so slower), faster
 *    the worse the damage; the crew pump some of it out;
 *  - at the stern (or the rudder heel on the bottom), the rudder: it grips less, and a bent blade pulls aside;
 *  - at the bow, a big impact the rig (the forestay and its fittings): the sails drive less, and at worst the
 *    rig fails and the sails come down;
 *  - running aground at speed, the keel and its bolts: a leak.
 * The boat does not sink: a Squib carries buoyancy, so the bilge is capped (E).
 */

export interface Damage {
  /** Hull: 0 sound … 1 badly holed (sets the leak rate). */
  hull: number;
  /** Rudder: 0 sound … 1 badly damaged (grip lost, blade bent). */
  rudder: number;
  /** Rig: 0 sound … 1 failed (the sails down). */
  rig: number;
  /** Water in the bilge (kg). */
  bilge: number;
}

export type ImpactRegion = 'bow' | 'side' | 'stern' | 'keel';

export interface Impact {
  t: number;
  /** What was hit (a label for the log). */
  what: string;
  region: ImpactRegion;
  /** Closing speed (m/s) and impact energy (J). */
  speed: number;
  energy: number;
  /** What it did, in words (empty: no damage). */
  effects: string[];
}

export const NO_DAMAGE: Readonly<Damage> = { hull: 0, rudder: 0, rig: 0, bilge: 0 };

/** Thresholds (J), how much each joule beyond them damages, and the leak, pump and bilge limits (E). */
export const DAMAGE = {
  /** Below this an impact only scuffs the gelcoat. */
  scrapeJ: 300,
  /** Hull: damage per joule beyond the threshold; a leak of `leakMaxKgS` at full damage. */
  hullJ: 800,
  hullPerJ: 1 / 6000,
  leakMaxKgS: 3,
  /** The crew pump the bilge (kg/s) while there is water in it. */
  pumpKgS: 0.4,
  /** Water the hull can hold before the buoyancy keeps her up (kg). */
  bilgeMaxKg: 300,
  rudderJ: 400,
  rudderPerJ: 1 / 3000,
  /** Grip a fully damaged rudder keeps, and the bias of its bent blade at full damage (rad). */
  rudderKeepsGrip: 0.25,
  rudderBentRad: (6 * Math.PI) / 180,
  rigJ: 2500,
  rigPerJ: 1 / 8000,
  /** A grounding below this speed over the ground (m/s) is gentle. */
  groundingSpeed: 0.8,
};

export function newDamage(): Damage {
  return { hull: 0, rudder: 0, rig: 0, bilge: 0 };
}

/** Impact energy (J) for a closing speed and the effective mass (kg). */
export function impactEnergy(speed: number, mass: number): number {
  return 0.5 * mass * speed * speed;
}

/** Apply an impact to the damage (in place); returns what it did, in words. */
export function applyImpact(d: Damage, region: ImpactRegion, energy: number): string[] {
  const out: string[] = [];
  if (energy <= DAMAGE.scrapeJ) return out;
  if (energy > DAMAGE.hullJ) {
    const before = d.hull;
    d.hull = Math.min(1, d.hull + (energy - DAMAGE.hullJ) * DAMAGE.hullPerJ);
    if (d.hull > before) out.push(d.hull >= 0.5 ? 'hull holed: leaking fast' : 'hull cracked: leaking');
  }
  if (region === 'stern' && energy > DAMAGE.rudderJ) {
    d.rudder = Math.min(1, d.rudder + (energy - DAMAGE.rudderJ) * DAMAGE.rudderPerJ);
    out.push(d.rudder >= 0.6 ? 'rudder badly damaged' : 'rudder damaged');
  }
  if (region === 'bow' && energy > DAMAGE.rigJ) {
    d.rig = Math.min(1, d.rig + (energy - DAMAGE.rigJ) * DAMAGE.rigPerJ);
    out.push(d.rig >= 1 ? 'rig failed: sails down' : 'rig damaged (forestay)');
  }
  if (!out.length) out.push('scraped');
  return out;
}

/** Leak in, pump out, over dt (s): updates the bilge (in place). */
export function stepBilge(d: Damage, dt: number): void {
  const inflow = d.hull * DAMAGE.leakMaxKgS;
  if (inflow <= 0 && d.bilge <= 0) return;
  d.bilge = Math.min(DAMAGE.bilgeMaxKg, Math.max(0, d.bilge + (inflow - (d.bilge > 0 ? DAMAGE.pumpKgS : 0)) * dt));
}

/** Share of the sails' force the rig still gives (1 sound … 0 failed). */
export function rigFactor(d: Damage | undefined): number {
  return d ? 1 - d.rig : 1;
}

/** Share of its grip the rudder keeps, and the bias (rad) its bent blade adds. */
export function rudderDamage(d: Damage | undefined): { grip: number; bias: number } {
  if (!d || d.rudder <= 0) return { grip: 1, bias: 0 };
  return { grip: 1 - (1 - DAMAGE.rudderKeepsGrip) * d.rudder, bias: DAMAGE.rudderBentRad * d.rudder };
}

/** One line for the instruments ('' when sound). */
export function damageSummary(d: Damage | undefined): string {
  if (!d) return '';
  const parts: string[] = [];
  if (d.hull > 0) parts.push(`hull leaking ${(d.hull * DAMAGE.leakMaxKgS).toFixed(1)} kg/s`);
  if (d.bilge >= 1) parts.push(`${d.bilge.toFixed(0)} kg in the bilge`);
  if (d.rudder > 0) parts.push(`rudder ${Math.round(d.rudder * 100)}% damaged`);
  if (d.rig >= 1) parts.push('rig failed: sails down');
  else if (d.rig > 0) parts.push(`rig ${Math.round(d.rig * 100)}% damaged`);
  return parts.join(' · ');
}
