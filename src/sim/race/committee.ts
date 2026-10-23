import { startSequence, type StartSignal } from '../course/judge';
import type { LocalPoint } from '../course/types';
import { cross } from '../course/geometry';

/**
 * Race committee: the starting system, recalls, the finishing window and results for ONE race of one class.
 *
 * Rules followed (RRS 2025–2028 as checked against secondary copies, see docs/RACING.md and SOURCES RR5–RR9;
 * the club's sailing instructions are NOT available, so every SI-dependent choice is a labelled default):
 *  - Rule 26: warning 5 min (class flag), preparatory 4 min (P, U or black flag), one-minute (preparatory
 *    flag removed), start (class flag removed). Times are from the visual signals.
 *  - Rule 29.1: flag X when a boat is on the course side at her starting signal, until all such boats are
 *    completely on the pre-start side or four minutes after the start, whichever is earlier. Not with U or
 *    black flag (rule 29.1 does not apply then).
 *  - Rule 29.2: general recall (First Substitute); the new warning signal one minute after its removal.
 *    The committee may recall when it cannot identify OCS boats. Here every boat is identified, so the
 *    "cannot identify" judgement is a SIMULATION POLICY: recall when at least `generalRecall.minBoats` and
 *    `generalRecall.fraction` of the fleet are OCS (E).
 *  - Rules 30.3 / 30.4: with U or black flag, a boat with any part of her hull in the triangle formed by the
 *    ends of the starting line and the first mark during the last minute is disqualified without a hearing
 *    (UFD; BFD also stands if the race is restarted, and she may not sail the restart).
 *  - Appendix A (A4, A5.2): low points; a boat that did not start, sail the course or finish, or was
 *    disqualified, scores the number of boats entered + 1.
 * Finishing window and time limit come from the SIs in real racing: defaults here are estimates (E).
 */
export type PrepFlag = 'P' | 'U' | 'black';

export interface CommitteeOptions {
  sequence: 'five-minute' | 'three-minute' | 'one-minute';
  /** Sim time of the first start signal (s). */
  startAt: number;
  prepFlag: PrepFlag;
  /** Preparatory flag for starts after a general recall (race officers often move to U or black: E). */
  prepFlagAfterRecall: PrepFlag;
  generalRecall: { enabled: boolean; minBoats: number; fraction: number };
  /** First Substitute is lowered this long after the start signal it recalled (E). */
  firstSubstituteS: number;
  /** Boats still racing this long after the first finisher are scored DNF (SI-dependent; E). */
  finishWindowS: number;
  /** Overall time limit after the start signal (SI-dependent; E). */
  timeLimitS: number;
  /** Most general recalls before the committee abandons the attempt sequence (E). */
  maxRecalls: number;
}

export const DEFAULT_COMMITTEE: Omit<CommitteeOptions, 'startAt'> = {
  sequence: 'five-minute',
  prepFlag: 'P',
  prepFlagAfterRecall: 'U',
  generalRecall: { enabled: true, minBoats: 3, fraction: 0.3 },
  firstSubstituteS: 60,
  finishWindowS: 900,
  timeLimitS: 5400,
  maxRecalls: 3,
};

export type Flag = 'class' | 'P' | 'U' | 'black' | 'X' | 'first-substitute';

export interface Signal {
  t: number;
  name: 'warning' | 'preparatory' | 'one-minute' | 'start' | 'individual-recall' | 'x-down' | 'general-recall' | 'first-substitute-down';
  sounds: number;
  /** Long sound (one-minute signal). */
  long?: boolean;
  attempt: number;
}

export type ResultCode = 'FIN' | 'OCS' | 'DNS' | 'DNF' | 'UFD' | 'BFD' | 'RET';

export interface BoatRaceStatus {
  id: string;
  started: boolean;
  /** On the course side at her starting signal and not (yet) returned. */
  ocs: boolean;
  /** Was on the course side at her starting signal (this attempt), whether or not she returned. */
  wasOcs: boolean;
  finished: boolean;
  finishTime?: number;
  startTime?: number;
  retired: boolean;
}

export interface ResultRow {
  place: number | null;
  id: string;
  code: ResultCode;
  points: number;
  /** Elapsed time from the start signal (s), for finishers. */
  elapsed?: number;
  finishTime?: number;
}

export class RaceCommittee {
  readonly opts: CommitteeOptions;
  attempt = 1;
  /** Signals of the current attempt (warning … start), for the course judges. */
  signals: StartSignal[];
  readonly log: Signal[] = [];
  flags = new Set<Flag>();
  /** Boats disqualified under 30.3 (this attempt) or 30.4 (all attempts). */
  readonly ufd = new Set<string>();
  readonly bfd = new Set<string>();
  readonly entries: string[];
  firstFinish?: number;
  finished = false;
  abandoned = false;
  private xUp = false;
  private fsDownAt?: number;
  private signalIdx = 0;
  private readonly triangle: LocalPoint[];
  private lastT = 0;

  constructor(opts: CommitteeOptions, entries: string[], startLine: [LocalPoint, LocalPoint], firstMark: LocalPoint) {
    this.opts = opts;
    this.entries = entries;
    this.signals = startSequence(opts.startAt, opts.sequence);
    this.triangle = [startLine[0], startLine[1], firstMark];
  }

  get startTime(): number {
    return this.signals[this.signals.length - 1]!.t;
  }

  get prepFlag(): PrepFlag {
    return this.attempt === 1 ? this.opts.prepFlag : this.opts.prepFlagAfterRecall;
  }

  /** True when the start of this attempt uses rule 30.3 or 30.4 (no individual recall). */
  get triangleRule(): boolean {
    return this.prepFlag !== 'P';
  }

  /** Is a point inside the starting triangle (line ends and first mark)? */
  inTriangle(p: LocalPoint): boolean {
    const [a, b, c] = this.triangle as [LocalPoint, LocalPoint, LocalPoint];
    const s1 = Math.sign(cross(a, b, p));
    const s2 = Math.sign(cross(b, c, p));
    const s3 = Math.sign(cross(c, a, p));
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  }

  private emit(t: number, name: Signal['name'], sounds: number, long = false): Signal {
    const s: Signal = { t, name, sounds, long, attempt: this.attempt };
    this.log.push(s);
    return s;
  }

  /**
   * Advance to time t. `status` describes every boat after this step; `hulls` gives their hull reference
   * points (for the U/black-flag triangle). Returns signals made in this step; a 'general-recall' means the
   * caller must restart the course judges with the new `signals`.
   */
  update(t: number, status: BoatRaceStatus[], hulls: (id: string) => LocalPoint[]): Signal[] {
    const out: Signal[] = [];
    this.lastT = t;
    if (this.finished || this.abandoned) return out;
    // Starting sequence of the current attempt.
    while (this.signalIdx < this.signals.length && t >= this.signals[this.signalIdx]!.t - 1e-9) {
      const sig = this.signals[this.signalIdx++]!;
      switch (sig.name) {
        case 'warning':
          this.flags.add('class');
          out.push(this.emit(t, 'warning', 1));
          break;
        case 'preparatory':
          this.flags.add(this.prepFlag);
          out.push(this.emit(t, 'preparatory', 1));
          break;
        case 'one-minute':
          // A one-minute sequence has no warning or preparatory signal: the class flag goes up now.
          this.flags.add('class');
          this.flags.delete(this.prepFlag);
          out.push(this.emit(t, 'one-minute', 1, true));
          break;
        case 'start': {
          this.flags.delete('class');
          out.push(this.emit(t, 'start', 1));
          const ocs = status.filter((s) => s.ocs && !this.ufd.has(s.id) && !this.bfd.has(s.id));
          const n = this.entries.length;
          const gr = this.opts.generalRecall;
          if (gr.enabled && this.attempt <= this.opts.maxRecalls && ocs.length >= Math.max(gr.minBoats, Math.ceil(gr.fraction * n))) {
            this.flags.add('first-substitute');
            out.push(this.emit(t, 'general-recall', 2));
            this.fsDownAt = t + this.opts.firstSubstituteS;
          } else if (ocs.length > 0 && !this.triangleRule) {
            this.flags.add('X');
            this.xUp = true;
            out.push(this.emit(t, 'individual-recall', 1));
          }
          break;
        }
      }
    }
    // U / black flag: the triangle in the last minute before the start.
    if (this.triangleRule && !this.recalling && t <= this.startTime + 1e-9 && t >= this.startTime - 60 - 1e-9) {
      for (const s of status) {
        if (this.ufd.has(s.id) || this.bfd.has(s.id)) continue;
        if (hulls(s.id).some((p) => this.inTriangle(p))) (this.prepFlag === 'black' ? this.bfd : this.ufd).add(s.id);
      }
    }
    // X flag down when every OCS boat has returned, or four minutes after the start.
    if (this.xUp && (t >= this.startTime + 240 - 1e-9 || status.every((s) => !s.ocs))) {
      this.xUp = false;
      this.flags.delete('X');
      out.push(this.emit(t, 'x-down', 0));
    }
    // First Substitute down; the new warning signal one minute later.
    if (this.fsDownAt !== undefined && t >= this.fsDownAt - 1e-9) {
      this.flags.delete('first-substitute');
      out.push(this.emit(t, 'first-substitute-down', 1));
      const lead = this.opts.sequence === 'five-minute' ? 300 : this.opts.sequence === 'three-minute' ? 180 : 60;
      const nextStart = Math.round(t + 60 + lead);
      this.fsDownAt = undefined;
      this.attempt += 1;
      this.ufd.clear(); // a U-flag disqualification does not stand if the race is restarted (30.3)
      this.signals = startSequence(nextStart, this.opts.sequence);
      this.signalIdx = 0;
    }
    // Finishing.
    if (this.firstFinish === undefined) {
      const f = status.filter((s) => s.finished && s.finishTime !== undefined).map((s) => s.finishTime!);
      if (f.length) this.firstFinish = Math.min(...f);
    }
    const windowClosed = this.firstFinish !== undefined && t >= this.firstFinish + this.opts.finishWindowS;
    const limit = t >= this.startTime + this.opts.timeLimitS;
    const allDone = t > this.startTime && status.every((s) => s.finished || s.retired || this.bfd.has(s.id) || this.ufd.has(s.id));
    if (this.signalIdx >= this.signals.length && this.fsDownAt === undefined && (windowClosed || limit || allDone)) this.finished = true;
    return out;
  }

  /** Is a general recall in progress (from the recall to the next warning signal)? */
  get recalling(): boolean {
    return this.fsDownAt !== undefined || (this.attempt > 1 && this.signalIdx === 0);
  }

  /** Abandon the race (e.g. the user stops it). */
  abandon(): void {
    this.abandoned = true;
  }

  /** Time of the next scheduled signal of the starting sequence (or undefined). */
  nextSignal(t = this.lastT): StartSignal | undefined {
    return this.signals.find((s) => s.t > t + 1e-9);
  }

  /** Results under Appendix A low point (A4, A5.2), for the boats' current status. */
  results(status: BoatRaceStatus[]): ResultRow[] {
    const n = this.entries.length;
    const dnfPoints = n + 1;
    const fin = status
      .filter((s) => s.finished && !this.ufd.has(s.id) && !this.bfd.has(s.id))
      .sort((a, b) => a.finishTime! - b.finishTime!);
    const rows: ResultRow[] = fin.map((s, i) => ({ place: i + 1, id: s.id, code: 'FIN', points: i + 1, finishTime: s.finishTime, elapsed: s.finishTime! - this.startTime }));
    for (const s of status) {
      if (rows.some((r) => r.id === s.id)) continue;
      let code: ResultCode;
      if (this.bfd.has(s.id)) code = 'BFD';
      else if (this.ufd.has(s.id)) code = 'UFD';
      else if (s.retired) code = 'RET';
      else if (!s.started) code = s.wasOcs ? 'OCS' : 'DNS';
      else code = 'DNF';
      rows.push({ place: null, id: s.id, code, points: dnfPoints });
    }
    return rows;
  }
}
