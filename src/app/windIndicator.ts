/**
 * The masthead wind indicator (review #1–#4, 20 Nov 2026): what flies at the top of the player's mast and in the
 * small picture of it by the compass. Both are driven by the same value, the apparent wind the physics gives (the
 * simulation has one apparent wind for the whole rig: no change with height is modelled).
 *
 * Which indicator Squib sailors use, a club burgee or a masthead vane, is a question for the sailors (review #4,
 * pending): until they answer it is a setting, the RDYC burgee by default (the club approved the use of its name and
 * burgee, owner, 20 Nov 2026: docs/CLUB_DOCUMENTS.md).
 */
export type IndicatorType = 'burgee' | 'vane';

export const INDICATOR_LABEL: Record<IndicatorType, string> = { burgee: 'RDYC burgee', vane: 'Masthead vane' };

/**
 * The vane's tacking tabs: the two fixed arms a sailor lines the vane's tail up with when close-hauled, each this far
 * either side of dead aft (deg). E (evidence L5): a common setting is about the boat's close-hauled apparent wind
 * angle; Windex's instructions say to set them to suit the boat, so this is configurable, 20°–45°.
 */
export const DEFAULT_TAB_DEG = 30;
export const TAB_DEG_RANGE = [20, 45] as const;

export function clampTabDeg(d: number): number {
  return Math.round(Math.min(TAB_DEG_RANGE[1], Math.max(TAB_DEG_RANGE[0], Number.isFinite(d) ? d : DEFAULT_TAB_DEG)));
}

/**
 * The indicator in words, for a screen reader (rounded to 5° so it does not chatter): "Wind indicator: wind from 40°
 * to starboard of the bow". `awa`: apparent wind angle (rad, > 0 from starboard); `aws` (m/s).
 */
export function indicatorText(awa: number, aws: number): string {
  if (!Number.isFinite(awa) || aws < 0.3) return 'Wind indicator: hanging limp, almost no wind';
  const d = Math.round(Math.abs((awa * 180) / Math.PI) / 5) * 5;
  if (d <= 2) return 'Wind indicator: wind from dead ahead';
  if (d >= 178) return 'Wind indicator: wind from dead astern';
  return `Wind indicator: wind from ${d}° to ${awa > 0 ? 'starboard' : 'port'} of the bow`;
}

/**
 * The 2D drawing's geometry (lowest graphics preset, and when the small 3D view cannot run): in a box 100 units square,
 * bow up, the mast at the centre. The burgee's fly points away from where the wind comes from and hangs shorter in
 * light air (the same droop law as the 3D flag); the vane's arrow points into the wind.
 */
export function indicatorPose(awa: number, aws: number): { flyDeg: number; flyLen: number; arrowDeg: number } {
  const a = Number.isFinite(awa) ? (awa * 180) / Math.PI : 0;
  // Screen degrees clockwise from up (the bow). The wind comes from `a`; the fly streams to a + 180.
  const droop = 1 / (1 + (Math.max(0, aws) / 1.5) ** 2);
  return { flyDeg: a + 180, flyLen: 34 * (1 - 0.7 * droop), arrowDeg: a };
}
