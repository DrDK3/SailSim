import { squibParams } from '../../sim/index';
import { KNOBS } from '../../sim/calibration/calibrate';
import { DEFAULT_THRESHOLDS } from './config';
import { compareDemos, type DemoPolicy } from './counterfactual';
import { windShiftSetup } from './windShift';

/** One variant of the sensitivity harness: a knob's multiplier, or a pointing angle. */
export interface SensitivityRow {
  label: string;
  tackS?: number;
  holdS?: number;
  better?: DemoPolicy;
  marginS?: number;
}

/**
 * The wind-shift exercise's comparison under changed coefficients (test harness only; the shipped boat is never
 * changed): sail lift, friction, wave resistance and righting scaled to the edges of plausible ranges, and the
 * demonstration's pointing angle varied.
 */
export function shiftSensitivity(): SensitivityRow[] {
  const t = DEFAULT_THRESHOLDS.windShift;
  const base = squibParams();
  const variants: { label: string; params?: ReturnType<typeof squibParams>; point?: number }[] = [
    { label: 'as calibrated (42° pointing)' },
    { label: 'sail lift × 0.85', params: KNOBS.sailLift!.apply(base, 0.85) },
    { label: 'sail lift × 1.15', params: KNOBS.sailLift!.apply(base, 1.15) },
    { label: 'friction × 0.85', params: KNOBS.friction!.apply(base, 0.85) },
    { label: 'friction × 1.3', params: KNOBS.friction!.apply(base, 1.3) },
    { label: 'wave resistance × 0.7', params: KNOBS.residuary!.apply(base, 0.7) },
    { label: 'wave resistance × 1.5', params: KNOBS.residuary!.apply(base, 1.5) },
    { label: 'righting × 0.8', params: KNOBS.righting!.apply(base, 0.8) },
    { label: 'righting × 1.2', params: KNOBS.righting!.apply(base, 1.2) },
    { label: 'pointing 38°', point: 38 },
    { label: 'pointing 48°', point: 48 },
  ];
  return variants.map((v) => {
    const { setup, events } = windShiftSetup(t);
    const c = compareDemos({ ...setup, params: v.params, pointTwaDeg: v.point }, events);
    return { label: v.label, tackS: c.tack.timeS, holdS: c.hold.timeS, better: c.better, marginS: c.marginS };
  });
}
