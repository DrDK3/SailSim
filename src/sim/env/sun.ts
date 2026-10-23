/**
 * Position of the sun for a time and place: NOAA's solar position algorithm (the NOAA Solar Calculator,
 * after Meeus, "Astronomical Algorithms"), with NOAA's atmospheric refraction correction. Accurate to about
 * 0.01° in elevation between 1900 and 2100; checked against NREL's SPA (pvlib) in tests/sim/sun.test.ts.
 * Used only to light the scene (visual).
 */

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Apparent elevation above the horizon, degrees (refraction included); negative below it. */
  elevationDeg: number;
  /** Azimuth, degrees clockwise from true north. */
  azimuthDeg: number;
}

function mod360(x: number): number {
  return ((x % 360) + 360) % 360;
}

export function sunPosition(epochMs: number, latDeg: number, lonDeg: number): SunPosition {
  const jd = epochMs / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = mod360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * RAD) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTimeMin =
    4 *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD)) /
    RAD;
  const minutesUtc = ((epochMs / 60000) % 1440 + 1440) % 1440;
  const trueSolarMin = (((minutesUtc + eqTimeMin + 4 * lonDeg) % 1440) + 1440) % 1440;
  const ha = trueSolarMin / 4 - 180; // hour angle, degrees
  const lat = latDeg * RAD;
  const cosZen = Math.min(1, Math.max(-1, Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha * RAD)));
  const zen = Math.acos(cosZen) / RAD;
  const elev = 90 - zen;
  // Atmospheric refraction (NOAA), degrees.
  let refr = 0;
  if (elev <= 85) {
    const te = Math.tan(elev * RAD);
    if (elev > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (elev > -0.575) refr = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    else refr = -20.772 / te;
    refr /= 3600;
  }
  const sinZen = Math.sin(zen * RAD);
  let az: number;
  if (sinZen < 1e-9) az = 180;
  else {
    const a = Math.acos(Math.min(1, Math.max(-1, (Math.sin(lat) * cosZen - Math.sin(decl)) / (Math.cos(lat) * sinZen)))) / RAD;
    az = ha > 0 ? mod360(a + 180) : mod360(540 - a);
  }
  return { elevationDeg: elev + refr, azimuthDeg: az };
}

/**
 * Daylight on a 0 … 1 scale from the sun's elevation: 0 below −6° (end of civil twilight), 1 above +10°,
 * smooth in between. Used to dim the scene's lights and sky.
 */
export function daylight(elevationDeg: number): number {
  const x = Math.min(1, Math.max(0, (elevationDeg + 6) / 16));
  return x * x * (3 - 2 * x);
}
