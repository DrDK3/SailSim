/**
 * Local metric projection about an origin (WGS84 ellipsoid): north = meridian arc difference, east = Δλ ×
 * prime-vertical radius × cos φ at the point's own latitude. Over the ~10 km simulation area this keeps
 * scale errors far below a metre (meridian convergence < 0.1°). Phase 3 uses the same functions for all
 * geographic data.
 */
const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const DEG = Math.PI / 180;

/** Meridian arc length from the equator to latitude φ (rad), series to e⁶. */
function meridianArc(phi: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return (
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi))
  );
}

function primeVertical(phi: number): number {
  return A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
}

export interface LocalProjection {
  readonly lat0: number;
  readonly lon0: number;
  toLocal(lat: number, lon: number): { n: number; e: number };
  toLatLon(n: number, e: number): { lat: number; lon: number };
}

export function createLocalProjection(lat0: number, lon0: number): LocalProjection {
  const m0 = meridianArc(lat0 * DEG);
  const toLocal = (lat: number, lon: number) => {
    const phi = lat * DEG;
    return { n: meridianArc(phi) - m0, e: (lon - lon0) * DEG * primeVertical(phi) * Math.cos(phi) };
  };
  const toLatLon = (n: number, e: number) => {
    // Invert the meridian arc by Newton iteration, then the east coordinate at that latitude.
    let phi = lat0 * DEG + n / A;
    for (let i = 0; i < 6; i++) {
      const m = meridianArc(phi) - m0;
      const rho = (A * (1 - E2)) / Math.pow(1 - E2 * Math.sin(phi) ** 2, 1.5);
      phi -= (m - n) / rho;
    }
    const lon = lon0 + e / (primeVertical(phi) * Math.cos(phi)) / DEG;
    return { lat: phi / DEG, lon };
  };
  return { lat0, lon0, toLocal, toLatLon };
}

/** RDYC clubhouse footprint centroid (OSM via Overture; see docs/RESEARCH_REPORT.md §2). Simulation origin. */
export const RDYC_ORIGIN = { lat: 50.34801, lon: -3.57339 };

/** Great-circle distance on the WGS84 mean sphere (m), for tests and sanity checks. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
