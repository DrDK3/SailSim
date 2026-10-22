/**
 * Local metric coordinates: a Transverse Mercator projection on the WGS84 ellipsoid with its central meridian
 * and origin at a chosen point (scale 1 on the central meridian, false easting/northing 0). It matches PROJ
 * `+proj=tmerc +lat_0=… +lon_0=… +k=1 +x_0=0 +y_0=0 +ellps=WGS84`, which the geodata pipeline uses, so the
 * pipeline's pre-projected data and anything projected at run time share one frame. Krüger series to n⁴:
 * sub-millimetre over the simulation area (tests/sim/projection.test.ts compares with PROJ output).
 * Conformal, so angles are preserved; the scale error 5 km from the central meridian is about 3×10⁻⁷.
 */
const A = 6378137.0;
const F = 1 / 298.257223563;
const N = F / (2 - F);
const DEG = Math.PI / 180;
const N2 = N * N;
const N3 = N2 * N;
const N4 = N3 * N;
/** Rectifying radius. */
const AR = (A / (1 + N)) * (1 + N2 / 4 + N4 / 64);
const ALPHA = [
  N / 2 - (2 * N2) / 3 + (5 * N3) / 16 + (41 * N4) / 180,
  (13 * N2) / 48 - (3 * N3) / 5 + (557 * N4) / 1440,
  (61 * N3) / 240 - (103 * N4) / 140,
  (49561 * N4) / 161280,
];
const BETA = [
  N / 2 - (2 * N2) / 3 + (37 * N3) / 96 - N4 / 360,
  N2 / 48 + N3 / 15 - (437 * N4) / 1440,
  (17 * N3) / 480 - (37 * N4) / 840,
  (4397 * N4) / 161280,
];
const DELTA = [
  2 * N - (2 * N2) / 3 - 2 * N3 + (116 * N4) / 45,
  (7 * N2) / 3 - (8 * N3) / 5 - (227 * N4) / 45,
  (56 * N3) / 15 - (136 * N4) / 35,
  (4279 * N4) / 630,
];
const K = (2 * Math.sqrt(N)) / (1 + N);

/** TM coordinates (northing from the equator, easting from the central meridian), metres. */
function forward(phi: number, dLambda: number): { x: number; y: number } {
  const s = Math.sin(phi);
  const t = Math.sinh(Math.atanh(s) - K * Math.atanh(K * s));
  const xi = Math.atan2(t, Math.cos(dLambda));
  const eta = Math.atanh(Math.sin(dLambda) / Math.sqrt(1 + t * t));
  let x = xi;
  let y = eta;
  for (let j = 1; j <= 4; j++) {
    x += ALPHA[j - 1]! * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    y += ALPHA[j - 1]! * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  return { x: AR * x, y: AR * y };
}

function inverse(northing: number, easting: number): { phi: number; dLambda: number } {
  const xi = northing / AR;
  const eta = easting / AR;
  let xi1 = xi;
  let eta1 = eta;
  for (let j = 1; j <= 4; j++) {
    xi1 -= BETA[j - 1]! * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= BETA[j - 1]! * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 4; j++) phi += DELTA[j - 1]! * Math.sin(2 * j * chi);
  return { phi, dLambda: Math.atan2(Math.sinh(eta1), Math.cos(xi1)) };
}

export interface LocalProjection {
  readonly lat0: number;
  readonly lon0: number;
  toLocal(lat: number, lon: number): { n: number; e: number };
  toLatLon(n: number, e: number): { lat: number; lon: number };
}

export function createLocalProjection(lat0: number, lon0: number): LocalProjection {
  const n0 = forward(lat0 * DEG, 0).x;
  return {
    lat0,
    lon0,
    toLocal(lat, lon) {
      const p = forward(lat * DEG, (lon - lon0) * DEG);
      return { n: p.x - n0, e: p.y };
    },
    toLatLon(n, e) {
      const q = inverse(n + n0, e);
      return { lat: q.phi / DEG, lon: lon0 + q.dLambda / DEG };
    },
  };
}

/** RDYC clubhouse footprint centroid (OSM via Overture; see docs/RESEARCH_REPORT.md §2). Simulation origin. */
export const RDYC_ORIGIN = { lat: 50.34801, lon: -3.57339 };

/** The simulation's projection: TM about the RDYC origin. */
export const DART_PROJECTION = createLocalProjection(RDYC_ORIGIN.lat, RDYC_ORIGIN.lon);

/** PROJ string of the same projection (for the geodata pipeline and documentation). */
export const DART_PROJ_STRING = `+proj=tmerc +lat_0=${RDYC_ORIGIN.lat} +lon_0=${RDYC_ORIGIN.lon} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs`;

/** Great-circle distance on the WGS84 mean sphere (m), for tests and sanity checks. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
