import classSpec from '../../../data/boats/squib/class-spec.json' with { type: 'json' };
import calibration from '../../../data/boats/squib/calibration.json' with { type: 'json' };
import variants from '../../../data/boats/squib/variants.json' with { type: 'json' };
import { buildBoatParams, validateProvenance, type BoatParams, type ProvenanceRecord } from './params';

export const SQUIB_CLASS_SPEC = classSpec as Record<string, unknown>;
export const SQUIB_CALIBRATION = calibration as Record<string, unknown>;

/** The Squib types the user can sail (data/boats/squib/variants.json): a hull build plus a sail package. */
export type SquibTypeId = 'rondar' | 'classic' | 'new-sails';
export const DEFAULT_SQUIB_TYPE: SquibTypeId = 'rondar';

export interface SquibType {
  id: SquibTypeId;
  label: string;
  hull: string;
  sails: string;
  summary: string;
  hullLabel: string;
  sailsLabel: string;
  /** Every parameter this type changes from the default, with its provenance. */
  differences: ProvenanceRecord[];
}

type Doc = Record<string, unknown>;
interface VariantDoc {
  _types: { id: SquibTypeId; label: string; hull: string; sails: string; summary: string }[];
  hulls: Record<string, { _label: string; calibration: Doc }>;
  sails: Record<string, { _label: string; calibration: Doc }>;
}
const VARIANTS = variants as unknown as VariantDoc;

/** Deep-merge partial parameter documents (a parameter, recognised by its `value`, replaces the whole leaf). */
function merge(base: Doc, over: Doc): Doc {
  const out: Doc = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    const isParam = typeof v === 'object' && v !== null && 'value' in v;
    out[k] = !isParam && typeof v === 'object' && v !== null && typeof b === 'object' && b !== null ? merge(b as Doc, v as Doc) : v;
  }
  return out;
}

function typeCalibration(id: SquibTypeId): { cal: Doc; overrides: Doc[] } {
  const t = VARIANTS._types.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown Squib type "${id}"`);
  const hull = VARIANTS.hulls[t.hull];
  const sails = VARIANTS.sails[t.sails];
  if (!hull || !sails) throw new Error(`Squib type "${id}" names a missing hull or sail package`);
  return { cal: merge(merge(SQUIB_CALIBRATION, hull.calibration), sails.calibration), overrides: [hull.calibration, sails.calibration] };
}

/** Parameters for a Squib type (validated each time); `overrides` replace individual values (studies, tests). */
export function squibTypeParams(id: SquibTypeId, overrides?: Partial<BoatParams>): BoatParams {
  return { ...buildBoatParams(SQUIB_CLASS_SPEC, typeCalibration(id).cal), ...overrides };
}

/** The default Squib parameter set (the Rondar type, as calibrated). */
export function squibParams(overrides?: Partial<BoatParams>): BoatParams {
  return squibTypeParams(DEFAULT_SQUIB_TYPE, overrides);
}

/** The selectable types with their labels and what each changes. */
export const SQUIB_TYPES: readonly SquibType[] = VARIANTS._types.map((t) => {
  const { overrides } = typeCalibration(t.id);
  return {
    ...t,
    hullLabel: VARIANTS.hulls[t.hull]!._label,
    sailsLabel: VARIANTS.sails[t.sails]!._label,
    differences: overrides.flatMap((o) => validateProvenance(o)),
  };
});

export function isSquibType(id: unknown): id is SquibTypeId {
  return typeof id === 'string' && SQUIB_TYPES.some((t) => t.id === id);
}

/** Every parameter with its provenance, for the UI and documentation. */
export function squibProvenance(): { classSpec: ProvenanceRecord[]; calibration: ProvenanceRecord[] } {
  return { classSpec: validateProvenance(SQUIB_CLASS_SPEC), calibration: validateProvenance(SQUIB_CALIBRATION) };
}
