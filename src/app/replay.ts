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
/** Hash the state every 1000 steps (10 s simulated). */
export const CHECKPOINT_STEPS = 1000;

/** One input-log row: [step, helm, mainSheet, jibSheet, crewHike, flags] with flags autoMain 1 | autoJib 2 | autoCrew 4. */
export type InputRow = [number, number, number, number, number, number];

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
  inputs: InputRow[];
  /** [step, state hash] every CHECKPOINT_STEPS steps, and at the end. */
  checkpoints: [number, string][];
  endStep: number;
}

export function encodeInputs(log: readonly InputLogEntry[]): InputRow[] {
  return log.map(({ step, input: i }) => [step, i.helm, i.mainSheet, i.jibSheet, i.crewHike, (i.autoMain ? 1 : 0) | (i.autoJib ? 2 : 0) | (i.autoCrew ? 4 : 0)]);
}

export function decodeInputs(rows: readonly InputRow[]): InputLogEntry[] {
  return rows.map(([step, helm, mainSheet, jibSheet, crewHike, f]) => ({
    step,
    input: { helm, mainSheet, jibSheet, crewHike, autoMain: (f & 1) !== 0, autoJib: (f & 2) !== 0, autoCrew: (f & 4) !== 0 },
  }));
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Check a recording read from a file. Throws with a reason; the scenario itself is checked when it is run. */
export function parseRecording(json: unknown): Recording {
  const r = json as Partial<Recording>;
  if (!r || typeof r !== 'object') throw new Error('replay: not a JSON object');
  if (r.schema !== REPLAY_SCHEMA) throw new Error(`replay: expected schema ${REPLAY_SCHEMA}, found ${String(r.schema)}`);
  if (!r.scenario || typeof r.scenario !== 'object' || !r.scenario.conditions) throw new Error('replay: missing scenario');
  if (!Array.isArray(r.inputs)) throw new Error('replay: missing inputs');
  let prev = -1;
  for (const row of r.inputs) {
    if (!Array.isArray(row) || row.length !== 6 || !row.every(isNum)) throw new Error('replay: bad input row');
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
