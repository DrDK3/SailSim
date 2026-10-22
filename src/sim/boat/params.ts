import { DEG } from '../math/angles';
import { G } from '../units';

/**
 * Provenance: V verified, S(p) primary seen via excerpt, S secondary, E estimated, N not established,
 * C calibrated (fitted to the observations named in `source`, see docs/CALIBRATION.md).
 */
export type Tag = 'V' | 'S(p)' | 'S' | 'E' | 'N' | 'C';
const TAGS: readonly Tag[] = ['V', 'S(p)', 'S', 'E', 'N', 'C'];

export interface Param<T = number> {
  value: T;
  unit: string;
  tag: Tag;
  source: string;
  note?: string;
}

export interface ProvenanceRecord {
  path: string;
  value: unknown;
  unit: string;
  tag: Tag;
  source: string;
  note?: string;
}

/**
 * Walk a parameter document and check that every leaf parameter carries value, unit, tag and source.
 * Keys starting with "_" are metadata. Returns the flattened records; throws on the first violation.
 */
export function validateProvenance(doc: unknown, path = ''): ProvenanceRecord[] {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error(`Parameter document at "${path || '<root>'}" must be an object`);
  }
  const out: ProvenanceRecord[] = [];
  for (const [key, val] of Object.entries(doc)) {
    if (key.startsWith('_')) continue;
    const p = path ? `${path}.${key}` : key;
    if (typeof val !== 'object' || val === null) throw new Error(`"${p}" is not a parameter or section`);
    if ('value' in val) {
      const v = val as Partial<Param<unknown>>;
      if (typeof v.unit !== 'string') throw new Error(`"${p}" has no unit`);
      if (!v.tag || !TAGS.includes(v.tag)) throw new Error(`"${p}" has missing or invalid tag "${String(v.tag)}"`);
      if (typeof v.source !== 'string' || v.source.length === 0) throw new Error(`"${p}" has no source`);
      const isNumber = typeof v.value === 'number' && Number.isFinite(v.value);
      const isTable = Array.isArray(v.value) && v.value.every((r) => Array.isArray(r) && r.every((n) => typeof n === 'number'));
      if (!isNumber && !isTable) throw new Error(`"${p}" value must be a finite number or numeric table`);
      out.push({ path: p, value: v.value, unit: v.unit, tag: v.tag, source: v.source, note: v.note });
    } else {
      out.push(...validateProvenance(val, p));
    }
  }
  return out;
}

export interface SailCoeffParams {
  clMax: number;
  alphaPeak: number;
  stallWidth: number;
  cd0: number;
  effectiveAR: number;
  cn90: number;
  alphaLuffStart: number;
  alphaFull: number;
  cdFlap: number;
}

export interface SailParams {
  area: number;
  foot: number;
  ceHeight: number;
  ceChordFrac: number;
  /** x of the pivot (mast for the main, tack for the jib), forward of CG. */
  pivotX: number;
  sheetMin: number;
  sheetMax: number;
  autoTrimAlpha: number;
  byTheLee: number;
  coeff: SailCoeffParams;
}

export interface FoilParams {
  area: number;
  x: number;
  ar: number;
  efficiency: number;
  clMax: number;
  stall: number;
  stallWidth: number;
  cn90: number;
}

/** Flat, SI-unit parameter set consumed by the physics. Built from the JSON documents by buildSquibParams. */
export interface BoatParams {
  loa: number;
  lwl: number;
  beam: number;
  draft: number;
  mastLength: number;
  mass: number;
  crewMass: number;
  weight: number;
  m11: number;
  m22: number;
  i66: number;
  main: SailParams;
  jib: SailParams;
  jibBlanketStartAwa: number;
  jibBlanketMin: number;
  jibDownwashOnMain: number;
  mainUpwashOnJib: number;
  windageCdA: number;
  windageHeight: number;
  boomGain: number;
  boomMaxRate: number;
  wettedArea: number;
  formFactor: number;
  residuary: [number, number][];
  heelResistance: number;
  lateral: FoilParams;
  rudder: FoilParams & { maxAngle: number; rate: number; flowStraightening: number };
  hullCrossFlowCd: number;
  hullDraft: number;
  yawLinearDamping: number;
  gm: number;
  /** Righting arm table [heel rad, GZ m], symmetric about zero. */
  gz: [number, number][];
  /** Roll inertia including added inertia (kg m²). */
  i44: number;
  rollLinearDamping: number;
  clrDepth: number;
  rudderDepth: number;
  boomInertia: number;
  boomMassMoment: number;
  boomDamping: number;
  boomRestitution: number;
  crewX: number;
  crewIn: number;
  crewOut: number;
  crewSpeed: number;
}

type Doc = Record<string, unknown>;

function num(doc: Doc, path: string): number {
  let cur: unknown = doc;
  for (const k of path.split('.')) cur = (cur as Doc)[k];
  const v = (cur as Param | undefined)?.value;
  if (typeof v !== 'number') throw new Error(`Missing numeric parameter "${path}"`);
  return v;
}

function table(doc: Doc, path: string): [number, number][] {
  let cur: unknown = doc;
  for (const k of path.split('.')) cur = (cur as Doc)[k];
  const v = (cur as Param<unknown> | undefined)?.value;
  if (!Array.isArray(v)) throw new Error(`Missing table parameter "${path}"`);
  return v.map((r) => [Number(r[0]), Number(r[1])] as [number, number]);
}

function sailCoeff(cal: Doc, s: 'main' | 'jib'): SailCoeffParams {
  const p = `sails.${s}`;
  return {
    clMax: num(cal, `${p}.clMax`),
    alphaPeak: num(cal, `${p}.alphaPeakDeg`) * DEG,
    stallWidth: num(cal, `${p}.stallWidthDeg`) * DEG,
    cd0: num(cal, `${p}.cd0`),
    effectiveAR: num(cal, `${p}.effectiveAR`),
    cn90: num(cal, `${p}.cn90`),
    alphaLuffStart: num(cal, `${p}.alphaLuffStartDeg`) * DEG,
    alphaFull: num(cal, `${p}.alphaFullDeg`) * DEG,
    cdFlap: num(cal, `${p}.cdFlap`),
  };
}

/** Validate provenance of both documents and derive the flat parameter set. */
export function buildBoatParams(spec: Doc, cal: Doc): BoatParams {
  validateProvenance(spec);
  validateProvenance(cal);
  const loa = num(spec, 'loa');
  const crewMass = num(spec, 'crewCount') * num(cal, 'mass.crewMassEach');
  const mass = num(spec, 'minBoatMass') + crewMass;
  const kzz = num(cal, 'mass.yawRadiusOfGyrationFrac') * loa;
  const izz = mass * kzz * kzz;
  return {
    loa,
    lwl: num(spec, 'lwl'),
    beam: num(spec, 'beam'),
    draft: num(spec, 'draft'),
    mastLength: num(spec, 'mastLength'),
    mass,
    crewMass,
    weight: mass * G,
    m11: mass * (1 + num(cal, 'mass.addedMassSurgeFrac')),
    m22: mass * (1 + num(cal, 'mass.addedMassSwayFrac')),
    i66: izz * (1 + num(cal, 'mass.addedInertiaYawFrac')),
    main: {
      area: num(spec, 'mainArea'),
      foot: num(spec, 'boomOuterPoint'),
      ceHeight: num(cal, 'geometry.mainCEHeight'),
      ceChordFrac: num(cal, 'geometry.mainCEChordFrac'),
      pivotX: num(cal, 'geometry.mastX'),
      sheetMin: num(cal, 'sails.main.sheetMinDeg') * DEG,
      sheetMax: num(cal, 'sails.main.sheetMaxDeg') * DEG,
      autoTrimAlpha: num(cal, 'sails.main.autoTrimAlphaDeg') * DEG,
      byTheLee: num(cal, 'sails.byTheLeeMainDeg') * DEG,
      coeff: sailCoeff(cal, 'main'),
    },
    jib: {
      area: num(spec, 'jibArea'),
      foot: num(cal, 'geometry.jibFoot'),
      ceHeight: num(cal, 'geometry.jibCEHeight'),
      ceChordFrac: num(cal, 'geometry.jibCEChordFrac'),
      pivotX: num(cal, 'geometry.jibTackX'),
      sheetMin: num(cal, 'sails.jib.sheetMinDeg') * DEG,
      sheetMax: num(cal, 'sails.jib.sheetMaxDeg') * DEG,
      autoTrimAlpha: num(cal, 'sails.jib.autoTrimAlphaDeg') * DEG,
      byTheLee: num(cal, 'sails.byTheLeeJibDeg') * DEG,
      coeff: sailCoeff(cal, 'jib'),
    },
    jibBlanketStartAwa: num(cal, 'sails.jibBlanketStartAwaDeg') * DEG,
    jibBlanketMin: num(cal, 'sails.jibBlanketMin'),
    jibDownwashOnMain: num(cal, 'sails.jibDownwashOnMainDeg') * DEG,
    mainUpwashOnJib: num(cal, 'sails.mainUpwashOnJibDeg') * DEG,
    windageCdA: num(cal, 'sails.windageCdA'),
    windageHeight: num(cal, 'geometry.windageHeight'),
    boomGain: num(cal, 'sails.boomGain'),
    boomMaxRate: num(cal, 'sails.boomMaxRateDegS') * DEG,
    wettedArea: num(cal, 'hydro.hullWettedArea') + num(cal, 'hydro.keelWettedArea') + num(cal, 'hydro.rudderWettedArea'),
    formFactor: num(cal, 'hydro.formFactor'),
    residuary: table(cal, 'hydro.residuaryTable'),
    heelResistance: num(cal, 'hydro.heelResistanceFactor'),
    lateral: {
      area: num(cal, 'hydro.lateralArea'),
      x: num(cal, 'geometry.lateralX'),
      ar: num(cal, 'hydro.lateralAR'),
      efficiency: num(cal, 'hydro.lateralEfficiency'),
      clMax: num(cal, 'hydro.lateralClMax'),
      stall: num(cal, 'hydro.lateralStallDeg') * DEG,
      stallWidth: num(cal, 'hydro.lateralStallWidthDeg') * DEG,
      cn90: num(cal, 'hydro.lateralCn90'),
    },
    rudder: {
      area: num(cal, 'hydro.rudderArea'),
      x: num(cal, 'geometry.rudderX'),
      ar: num(cal, 'hydro.rudderAR'),
      efficiency: num(cal, 'hydro.rudderEfficiency'),
      clMax: num(cal, 'hydro.rudderClMax'),
      stall: num(cal, 'hydro.rudderStallDeg') * DEG,
      stallWidth: num(cal, 'hydro.rudderStallWidthDeg') * DEG,
      cn90: num(cal, 'hydro.rudderCn90'),
      maxAngle: num(cal, 'hydro.rudderMaxDeg') * DEG,
      rate: num(cal, 'hydro.rudderRateDegS') * DEG,
      flowStraightening: num(cal, 'hydro.rudderFlowStraightening'),
    },
    hullCrossFlowCd: num(cal, 'hydro.hullCrossFlowCd'),
    hullDraft: num(cal, 'hydro.hullDraft'),
    yawLinearDamping: num(cal, 'hydro.yawLinearDamping'),
    gm: num(cal, 'stability.gm'),
    gz: table(cal, 'stability.gzTable').map(([d, v]) => [d * DEG, v] as [number, number]),
    i44: mass * num(cal, 'stability.rollRadiusOfGyration') ** 2 * (1 + num(cal, 'stability.addedRollInertiaFrac')),
    rollLinearDamping: num(cal, 'stability.rollLinearDamping'),
    clrDepth: num(cal, 'geometry.clrDepth'),
    rudderDepth: num(cal, 'stability.rudderDepth'),
    boomInertia: num(cal, 'sails.boomInertia'),
    boomMassMoment: num(cal, 'sails.boomMassMoment'),
    boomDamping: num(cal, 'sails.boomDamping'),
    boomRestitution: num(cal, 'sails.boomRestitution'),
    crewX: num(cal, 'geometry.crewX'),
    crewIn: num(cal, 'geometry.crewLateralIn'),
    crewOut: num(cal, 'geometry.crewLateralOut'),
    crewSpeed: num(cal, 'geometry.crewMoveSpeed'),
  };
}
