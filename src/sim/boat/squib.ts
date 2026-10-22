import classSpec from '../../../data/boats/squib/class-spec.json' with { type: 'json' };
import calibration from '../../../data/boats/squib/calibration.json' with { type: 'json' };
import { buildBoatParams, validateProvenance, type BoatParams, type ProvenanceRecord } from './params';

export const SQUIB_CLASS_SPEC = classSpec as Record<string, unknown>;
export const SQUIB_CALIBRATION = calibration as Record<string, unknown>;

/** The default Squib parameter set (validated on first use). */
export function squibParams(overrides?: Partial<BoatParams>): BoatParams {
  return { ...buildBoatParams(SQUIB_CLASS_SPEC, SQUIB_CALIBRATION), ...overrides };
}

/** Every parameter with its provenance, for the UI and documentation. */
export function squibProvenance(): { classSpec: ProvenanceRecord[]; calibration: ProvenanceRecord[] } {
  return { classSpec: validateProvenance(SQUIB_CLASS_SPEC), calibration: validateProvenance(SQUIB_CALIBRATION) };
}
