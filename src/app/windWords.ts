/**
 * Where the wind comes from, in plain words for the Learn level (review #18; fixes of 21 Nov 2026, §2.4): a direction a
 * beginner can picture, with the angle off the bow small alongside, e.g. "from behind, a little to your right (170°)" or
 * "from ahead and to your left (40°)". The wind's side is the boat's side it blows onto: starboard is your right, port
 * your left, facing forward.
 *
 * The bands, by the angle off the bow (deg; E: chosen to match the words a coach would use, not from a source):
 *   ahead          under 20°        ("from ahead", within 5°: "from dead ahead")
 *   ahead-side     20° to under 70°
 *   across         70° to 110°
 *   behind-side    over 110° to 160°
 *   behind         over 160°        ("from behind", within 5° of dead behind: "from dead behind")
 */
export type WindBand = 'ahead' | 'ahead-side' | 'across' | 'behind-side' | 'behind';

/** The band edges (deg off the bow; E). */
export const WIND_BAND_EDGES = { aheadSide: 20, across: 70, behindSide: 110, behind: 160, dead: 5 } as const;

/** The band of an angle off the bow, in whole degrees (0 = head to wind … 180 = dead behind). */
export function windBand(offBowDeg: number): WindBand {
  const d = Math.round(Math.abs(offBowDeg));
  const E = WIND_BAND_EDGES;
  if (d < E.aheadSide) return 'ahead';
  if (d < E.across) return 'ahead-side';
  if (d <= E.behindSide) return 'across';
  if (d <= E.behind) return 'behind-side';
  return 'behind';
}

/** The words and the angle for a wind angle `rad` (> 0: from starboard, the right; < 0: from port, the left). */
export function windWords(rad: number): { words: string; deg: number; band: WindBand } {
  const d = Math.round(Math.abs((rad * 180) / Math.PI));
  const side = rad > 0 ? 'right' : 'left';
  const band = windBand(d);
  const dead = WIND_BAND_EDGES.dead;
  let words: string;
  switch (band) {
    case 'ahead':
      words = d <= dead ? 'from dead ahead' : `from ahead, a little to your ${side}`;
      break;
    case 'ahead-side':
      words = `from ahead and to your ${side}`;
      break;
    case 'across':
      words = `from your ${side} side`;
      break;
    case 'behind-side':
      words = `from behind and to your ${side}`;
      break;
    case 'behind':
      words = d >= 180 - dead ? 'from dead behind' : `from behind, a little to your ${side}`;
      break;
  }
  return { words, deg: d, band };
}
