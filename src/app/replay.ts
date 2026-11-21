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
const SCHEMAS = [REPLAY_SCHEMA, REPLAY_SCHEMA_RIVER_JOINED, REPLAY_SCHEMA_SAIL_CONTROLS];
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
  inputs: InputRow[];
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
  const joined = r.schema === REPLAY_SCHEMA_RIVER_JOINED || (r.schema === REPLAY_SCHEMA_SAIL_CONTROLS && r.dartFromStep !== undefined);
  if (joined ? !isNum(r.dartFromStep) || r.dartFromStep < 0 || r.dart !== 'loaded' : r.dartFromStep !== undefined) throw new Error('replay: bad river-joined step');
  if (!r.scenario || typeof r.scenario !== 'object' || !r.scenario.conditions) throw new Error('replay: missing scenario');
  if (!Array.isArray(r.inputs)) throw new Error('replay: missing inputs');
  let prev = -1;
  for (const row of r.inputs) {
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
