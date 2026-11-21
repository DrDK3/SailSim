/**
 * Replays: a session recorded as everything needed to run it again, bit for bit (criterion 11): the scenario
 * (with its course and any live-data snapshot inside it), the seed (in the scenario), the input the boat was
 * built with, the user's input log, and state hashes every CHECKPOINT_STEPS steps to prove the replay
 * matches. AI boats need no log: they are reproduced from the seed.
 *
 * Pure functions (no DOM): the controller records and plays; tests check the format.
 */
import type { ControlInput, InputLogEntry } from '../sim/simulation';
import type { AppScenario } from './controller';

export const REPLAY_SCHEMA = 'squib-replay/1';
/**
 * A recording in which the River Dart data joined the run part-way (review #9): the same as /1 with `dartFromStep`.
 * Written only for such runs, so every other recording stays /1 and older builds (and the club table's verifier) read
 * it as before; an older build refuses a /2 file rather than replaying it wrongly.
 */
export const REPLAY_SCHEMA_RIVER_JOINED = 'squib-replay/2';
/**
 * A recording whose inputs use the next round's controls (package B): the spinnaker calls and trim, the flattening
 * controls one by one and the jib lead, and the crew's requests to stuff a hole (`plug`, which /1 and /2 rows did not
 * carry, so a replay of a run that used it diverged). Its rows have 15 columns. Written only when a run used one of
 * them; it may also carry `dartFromStep` as /2 does. Older builds refuse it rather than replaying it wrongly.
 */
export const REPLAY_SCHEMA_SAIL_CONTROLS = 'squib-replay/3';
/**
 * Compact inputs (package C, review #12, issue 214): `inputsQ` in place of `inputs`, a flat list of small integers,
 * one row per change: [step delta, mask of the fields that changed, then those fields' values]. The player's
 * controls are kept on a grid of thousandths (`quantiseInput`), so every value is a whole number of grid steps and
 * the file decodes to the very inputs sailed. Written whenever every input is on the grid (any run
 * of this build sailed by a person); a recording with a value off the grid is written as before. It may carry
 * `dartFromStep` as /2 does. Older builds refuse it rather than replaying it wrongly; every older schema still reads.
 */
export const REPLAY_SCHEMA_COMPACT = 'squib-replay/4';
const SCHEMAS = [REPLAY_SCHEMA, REPLAY_SCHEMA_RIVER_JOINED, REPLAY_SCHEMA_SAIL_CONTROLS, REPLAY_SCHEMA_COMPACT];

/**
 * The grid the player's controls are kept on: thousandths (of the sheets' and the crew's travel, of the helm either
 * side; E, imperceptible). Decimal, so the app's own settings (a crew position of 0.6, a sheet of 0.3) lie on it.
 */
export const INPUT_GRID = 1000;
const GRID_FIELDS = ['helm', 'mainSheet', 'jibSheet', 'crewHike', 'flatten', 'spinSheet', 'kicker', 'cunningham', 'outhaul', 'jibLead'] as const;

/** A change of input with every control value on the grid (the player's inputs: keys, buttons, sliders, stick, touch). */
export function quantiseInput<T extends Partial<ControlInput>>(change: T): T {
  let out: T | undefined;
  for (const k of GRID_FIELDS) {
    const v = change[k];
    if (typeof v !== 'number') continue;
    const q = Math.round(v * INPUT_GRID) / INPUT_GRID;
    if (q !== v) (out ??= { ...change })[k] = q as T[typeof k];
  }
  return out ?? change;
}

/** The compact row's fields, in mask-bit order. */
const Q_FIELDS = ['helm', 'mainSheet', 'jibSheet', 'crewHike', 'flags', 'flatten', 'spin', 'spinGybe', 'spinSheet', 'kicker', 'cunningham', 'outhaul', 'jibLead', 'plug'] as const;
type QField = (typeof Q_FIELDS)[number];
/** A control not set (spinSheet, kicker, cunningham, outhaul, jibLead follow their defaults; flatten absent). */
const Q_UNSET = 4096;
const OPTIONAL_Q: ReadonlySet<QField> = new Set(['flatten', 'spinSheet', 'kicker', 'cunningham', 'outhaul', 'jibLead']);
/** Counts (spinnaker calls and pole gybes, plug requests) and the flags: −1 when not set. */
const COUNT_Q: ReadonlySet<QField> = new Set(['spin', 'spinGybe', 'plug']);
const COUNT_UNSET = -1;

function qValues(i: ControlInput): number[] | undefined {
  const out: number[] = [];
  for (const f of Q_FIELDS) {
    if (f === 'flags') {
      // autoSpin has three states (not set, on, off), so two bits.
      out.push((i.autoMain ? 1 : 0) | (i.autoJib ? 2 : 0) | (i.autoCrew ? 4 : 0) | (i.autoSpin === false ? 8 : 0) | (i.autoSpin === true ? 16 : 0));
      continue;
    }
    const v = i[f] as number | undefined;
    if (v === undefined) {
      if (OPTIONAL_Q.has(f)) out.push(Q_UNSET);
      else if (COUNT_Q.has(f)) out.push(COUNT_UNSET);
      else return undefined;
      continue;
    }
    if (COUNT_Q.has(f)) {
      if (!Number.isInteger(v) || v < 0 || v > 1e6) return undefined;
      out.push(v);
      continue;
    }
    // On the grid exactly when the decoder's division gives this very value back.
    const t = Math.round(v * INPUT_GRID);
    if (t / INPUT_GRID !== v || Math.abs(t) > INPUT_GRID) return undefined;
    out.push(t);
  }
  return out;
}

/** The rows the compact form starts from (the defaults), so the first row holds only what differs. */
const Q_START: readonly number[] = qValues({ helm: 0, mainSheet: 0, jibSheet: 0, crewHike: 0, autoMain: false, autoJib: false, autoCrew: false })!;

/** The input log in the compact form, or undefined when a value is off the grid (then the recording is written as before). */
export function encodeInputsCompact(log: readonly InputLogEntry[]): number[] | undefined {
  const out: number[] = [];
  let prevStep = 0;
  let prev = Q_START;
  for (const { step, input } of log) {
    const v = qValues(input);
    if (!v) return undefined;
    let mask = 0;
    const vals: number[] = [];
    v.forEach((x, k) => {
      if (x !== prev[k]) {
        mask |= 1 << k;
        vals.push(x);
      }
    });
    out.push(step - prevStep, mask, ...vals);
    prevStep = step;
    prev = v;
  }
  return out;
}

/** The compact form back to the input log (exactly the inputs sailed). Throws on a malformed list. */
export function decodeInputsCompact(q: readonly number[]): InputLogEntry[] {
  const out: InputLogEntry[] = [];
  let step = 0;
  const cur = [...Q_START];
  let i = 0;
  while (i < q.length) {
    const d = q[i++]!;
    const mask = q[i++];
    if (!Number.isInteger(d) || d < 0 || mask === undefined || !Number.isInteger(mask) || mask < 0 || mask >= 1 << Q_FIELDS.length) throw new Error('replay: bad compact input row');
    step += d;
    for (let k = 0; k < Q_FIELDS.length; k++) {
      if (!(mask & (1 << k))) continue;
      const x = q[i++];
      if (x === undefined || !Number.isInteger(x)) throw new Error('replay: bad compact input value');
      cur[k] = x;
    }
    const input: ControlInput = { helm: 0, mainSheet: 0, jibSheet: 0, crewHike: 0, autoMain: false, autoJib: false, autoCrew: false };
    const set = input as unknown as Record<string, number>;
    Q_FIELDS.forEach((f, k) => {
      const x = cur[k]!;
      if (f === 'flags') {
        input.autoMain = (x & 1) !== 0;
        input.autoJib = (x & 2) !== 0;
        input.autoCrew = (x & 4) !== 0;
        if (x & 8) input.autoSpin = false;
        else if (x & 16) input.autoSpin = true;
      } else if (OPTIONAL_Q.has(f)) {
        if (x !== Q_UNSET) set[f] = x / INPUT_GRID;
      } else if (COUNT_Q.has(f)) {
        if (x !== COUNT_UNSET) set[f] = x;
      } else set[f] = x / INPUT_GRID;
    });
    out.push({ step, input });
  }
  return out;
}

/** The optional controls: a recorded input without one had it unset (handed back to its default). */
const OPTIONAL_INPUTS = ['flatten', 'spin', 'spinGybe', 'autoSpin', 'spinSheet', 'kicker', 'cunningham', 'outhaul', 'jibLead', 'plug'] as const;

/**
 * A recorded input as a change that replaces the whole input (the simulation merges changes): a control the recording
 * has unset is set to undefined explicitly, so a replay hands it back as the run did (a kicker returned to the Flat
 * control, say) instead of keeping its last value.
 */
export function replacingInput(input: ControlInput): Partial<ControlInput> {
  const out: Partial<ControlInput> = { ...input };
  for (const k of OPTIONAL_INPUTS) if (!(k in out)) (out as Record<string, unknown>)[k] = undefined;
  return out;
}

/** A recording's input log, whichever form it was written in. */
export function recordingLog(rec: Pick<Recording, 'inputs' | 'inputsQ'>): InputLogEntry[] {
  return rec.inputsQ ? decodeInputsCompact(rec.inputsQ) : decodeInputs(rec.inputs ?? []);
}

/** A recording's input rows (the /1–/3 shape), whichever form it was written in (plausibility and assist checks). */
export function recordingRows(rec: Pick<Recording, 'inputs' | 'inputsQ'>): InputRow[] {
  return rec.inputs ?? encodeInputs(decodeInputsCompact(rec.inputsQ ?? []));
}
/**
 * The same recording in the row form older builds read (/1–/3): for tools and tests (an older reader, a hand edit of
 * one row). It replays identically.
 */
export function rowRecording(rec: Recording): Recording {
  if (!rec.inputsQ) return rec;
  const inputs = encodeInputs(decodeInputsCompact(rec.inputsQ));
  const out: Recording = { ...rec, schema: recordingSchema(inputs, rec.dartFromStep), inputs };
  delete out.inputsQ;
  return out;
}

/** Hash the state every 1000 steps (10 s simulated). */
export const CHECKPOINT_STEPS = 1000;

/**
 * One input-log row: [step, helm, mainSheet, jibSheet, crewHike, flags, flatten] with flags autoMain 1 | autoJib 2 |
 * autoCrew 4. Recordings made before the flatten control have six columns (flatten 0).
 */
export type InputRow = [number, number, number, number, number, number] | [number, number, number, number, number, number, number] | number[];

/**
 * Schema /3 rows: the seven columns above, then [spin, spinGybe, spinSheet, kicker, cunningham, outhaul, jibLead,
 * plug], with flag 8 for the spinnaker trimmed by hand (autoSpin off). A control left to follow its default is −1
 * (spinSheet: the best trim; kicker, cunningham, outhaul: the Flat control).
 */
export const ROW_COLUMNS_SAIL_CONTROLS = 15;

/** Whether an input uses any control that only schema /3 rows carry. */
function usesSailControls(i: ControlInput): boolean {
  return (
    (i.spin ?? 0) !== 0 || (i.spinGybe ?? 0) !== 0 || i.autoSpin === false || i.spinSheet !== undefined || i.kicker !== undefined ||
    i.cunningham !== undefined || i.outhaul !== undefined || (i.jibLead ?? 0) !== 0 || (i.plug ?? 0) !== 0
  );
}

export interface Recording {
  schema: string;
  /** When the recording was saved (ISO). */
  created: string;
  title: string;
  /** Build that recorded it (for the record; replays are expected to match only within the same build). */
  build: string;
  scenario: AppScenario;
  /** The input the user's boat was built with (null: the defaults); it sets the boat's starting trim. */
  initialInput: ControlInput | null;
  /** Whether the River Dart data was loaded (it changes depths, the stream and the obstacles). */
  dart: 'loaded' | 'none';
  /**
   * Schema /2 only: the step at which the River Dart data joined the run (the run began in open water and sailed on
   * with the river's depths, stream and obstacles from this step). `dart` is then 'loaded'.
   */
  dartFromStep?: number;
  /** The input log (schemas /1–/3); schema /4 has `inputsQ` instead (read both with `recordingLog`). */
  inputs?: InputRow[];
  /** Schema /4: the input log in the compact form (`encodeInputsCompact`). */
  inputsQ?: number[];
  /** [step, state hash] every CHECKPOINT_STEPS steps, and at the end. */
  checkpoints: [number, string][];
  endStep: number;
  /**
   * What the sailor's app said the run achieved, for a club-table submission (juniors round): the finish time from the
   * start signal and whether it was sailed without assists. The verifier re-sails the run and checks both.
   */
  claimed?: { finishS: number; independent: boolean };
}

export function encodeInputs(log: readonly InputLogEntry[]): InputRow[] {
  // Every row in the /3 shape once any input uses its controls, so that the file has one row shape.
  const wide = log.some((e) => usesSailControls(e.input));
  return log.map(({ step, input: i }): InputRow => {
    const flags = (i.autoMain ? 1 : 0) | (i.autoJib ? 2 : 0) | (i.autoCrew ? 4 : 0) | (wide && i.autoSpin === false ? 8 : 0);
    const row: InputRow = [step, i.helm, i.mainSheet, i.jibSheet, i.crewHike, flags];
    if (!wide) return i.flatten === undefined ? row : ([...row, i.flatten] as InputRow);
    const opt = (v: number | undefined) => (v === undefined ? -1 : v);
    return [...row, i.flatten ?? 0, i.spin ?? 0, i.spinGybe ?? 0, opt(i.spinSheet), opt(i.kicker), opt(i.cunningham), opt(i.outhaul), i.jibLead ?? 0, i.plug ?? 0];
  });
}

/** The schema a recording of these inputs needs: /3 for the new controls, else /2 if the river joined, else /1. */
export function recordingSchema(rows: readonly InputRow[], dartFromStep: number | undefined): string {
  if (rows.some((r) => r.length === ROW_COLUMNS_SAIL_CONTROLS)) return REPLAY_SCHEMA_SAIL_CONTROLS;
  return dartFromStep === undefined ? REPLAY_SCHEMA : REPLAY_SCHEMA_RIVER_JOINED;
}

export function decodeInputs(rows: readonly InputRow[]): InputLogEntry[] {
  return rows.map((row) => {
    const [step, helm, mainSheet, jibSheet, crewHike, f, flatten] = row as number[] as [number, number, number, number, number, number, number | undefined];
    const input: ControlInput = { helm, mainSheet, jibSheet, crewHike, autoMain: (f & 1) !== 0, autoJib: (f & 2) !== 0, autoCrew: (f & 4) !== 0, ...(flatten === undefined ? {} : { flatten }) };
    if (row.length === ROW_COLUMNS_SAIL_CONTROLS) {
      const [spin, spinGybe, spinSheet, kicker, cunningham, outhaul, jibLead, plug] = row.slice(7) as number[];
      const opt = (v: number) => (v < 0 ? undefined : v);
      Object.assign(input, { spin, spinGybe, autoSpin: (f & 8) === 0, jibLead, plug });
      if (opt(spinSheet!) !== undefined) input.spinSheet = spinSheet;
      if (opt(kicker!) !== undefined) input.kicker = kicker;
      if (opt(cunningham!) !== undefined) input.cunningham = cunningham;
      if (opt(outhaul!) !== undefined) input.outhaul = outhaul;
    }
    return { step, input };
  });
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Check a recording read from a file. Throws with a reason; the scenario itself is checked when it is run. */
export function parseRecording(json: unknown): Recording {
  const r = json as Partial<Recording>;
  if (!r || typeof r !== 'object') throw new Error('replay: not a JSON object');
  if (!SCHEMAS.includes(r.schema ?? '')) throw new Error(`replay: expected schema ${REPLAY_SCHEMA}, found ${String(r.schema)}`);
  const joined = r.schema === REPLAY_SCHEMA_RIVER_JOINED || ((r.schema === REPLAY_SCHEMA_SAIL_CONTROLS || r.schema === REPLAY_SCHEMA_COMPACT) && r.dartFromStep !== undefined);
  if (joined ? !isNum(r.dartFromStep) || r.dartFromStep < 0 || r.dart !== 'loaded' : r.dartFromStep !== undefined) throw new Error('replay: bad river-joined step');
  if (!r.scenario || typeof r.scenario !== 'object' || !r.scenario.conditions) throw new Error('replay: missing scenario');
  if (r.schema === REPLAY_SCHEMA_COMPACT) {
    if (!Array.isArray(r.inputsQ) || !r.inputsQ.every((x) => Number.isInteger(x))) throw new Error('replay: missing compact inputs');
    decodeInputsCompact(r.inputsQ);
  } else if (!Array.isArray(r.inputs)) throw new Error('replay: missing inputs');
  let prev = -1;
  for (const row of r.inputs ?? []) {
    const wide = r.schema === REPLAY_SCHEMA_SAIL_CONTROLS && Array.isArray(row) && row.length === ROW_COLUMNS_SAIL_CONTROLS;
    if (!Array.isArray(row) || (row.length !== 6 && row.length !== 7 && !wide) || !row.every(isNum)) throw new Error('replay: bad input row');
    if (row[0] <= prev && !(row[0] === 0 && prev === -1)) throw new Error('replay: input steps must increase');
    prev = row[0];
  }
  if (!Array.isArray(r.checkpoints) || r.checkpoints.some((c) => !Array.isArray(c) || !isNum(c[0]) || typeof c[1] !== 'string')) {
    throw new Error('replay: bad checkpoints');
  }
  if (!isNum(r.endStep) || r.endStep < 0) throw new Error('replay: bad end step');
  if (r.dart !== 'loaded' && r.dart !== 'none') throw new Error('replay: bad dart flag');
  return r as Recording;
}

/** Replay progress, as the UI shows it. */
export interface ReplayStatus {
  title: string;
  /** 'diverged' from the first checkpoint that did not match, even after the end. */
  state: 'playing' | 'ended' | 'diverged';
  /** The end of the recording was reached (the run is paused there). */
  finished: boolean;
  /** Simulated time up to which every checkpoint matched (s). */
  verifiedToS: number;
  checkpointsMatched: number;
  checkpointsTotal: number;
  divergedAtS?: number;
  endS: number;
  notes: string[];
}
