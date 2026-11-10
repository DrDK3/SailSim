import { sunPosition, type SunPosition } from '../sim/env/sun';

/**
 * Daylight view (owner, 10 Nov 2026: "an option to switch to day mode if it is dark in real time"). Sailing in real
 * time after sunset is dark, as it is on the river. With the daylight view on, the picture is lit as at that day's
 * midday whenever the real sun is low or down, while the run itself stays real: the clock, the tide, the wind, the
 * stream and the traffic are unchanged (only the light the 3D view is drawn with changes). It is a picture
 * setting, kept in this browser; the time of day can still be changed for real in Settings → Light.
 */

/** Below this the real sun is replaced in the picture (deg): from the golden hour on, the light fades fast. */
export const DAYLIGHT_VIEW_BELOW_DEG = 6;
/** The sun is down (deg; its upper limb at the horizon, with refraction). The card offers the daylight view below it. */
export const SUNSET_DEG = -0.833;
/** A run counts as real time when it started within this of the clock (ms): the Real time light, or live weather. */
export const REAL_TIME_WITHIN_MS = 20 * 60_000;

const noonCache = new Map<number, SunPosition>();

/** The sun at its highest on the (UTC) day of epochMs, at (lat, lon). */
export function middaySun(epochMs: number, lat: number, lon: number): SunPosition {
  const d0 = Math.floor(epochMs / 86_400_000) * 86_400_000;
  const key = d0 + lat * 1e-3 + lon * 1e-6;
  let best = noonCache.get(key);
  if (!best) {
    best = sunPosition(d0, lat, lon);
    for (let m = 5; m < 1440; m += 5) {
      const s = sunPosition(d0 + m * 60_000, lat, lon);
      if (s.elevationDeg > best.elevationDeg) best = s;
    }
    if (noonCache.size > 32) noonCache.clear();
    noonCache.set(key, best);
  }
  return best;
}

/** The sun the picture is drawn with: the real one, or with the daylight view on and the sun low, the day's midday sun. */
export function viewSun(epochMs: number, lat: number, lon: number, daylightView: boolean): SunPosition & { substituted: boolean } {
  const real = sunPosition(epochMs, lat, lon);
  if (!daylightView || real.elevationDeg >= DAYLIGHT_VIEW_BELOW_DEG) return { ...real, substituted: false };
  return { ...middaySun(epochMs, lat, lon), substituted: true };
}

/** "21:14" in UK time (the Dart's), for the card. */
export function ukClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}
