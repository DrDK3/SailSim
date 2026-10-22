/** Unit conversions. The simulation is SI internally; knots and degrees only at the edges. */
export const KNOT = 1852 / 3600; // m/s per knot (exact by definition)
export const msToKn = (ms: number): number => ms / KNOT;
export const knToMs = (kn: number): number => kn * KNOT;

/** Physical constants (standard values). */
export const G = 9.80665; // m/s², standard gravity
export const RHO_WATER = 1025; // kg/m³, typical sea water
export const RHO_AIR = 1.225; // kg/m³, ISA sea level
export const NU_WATER = 1.19e-6; // m²/s, sea water kinematic viscosity at ~15 °C (ITTC)
