/**
 * Social goals in the app (juniors round, Workstream 3, layer A; layer B in src/app/clubTable.ts): the weekly course
 * and its model-sailed targets, like-for-like bests with the assist record, and "Challenge a friend". Kept apart from
 * the controller, which calls the hooks below (restart, every few steps, a finish, a link in the address, the UI state).
 *
 * Nothing leaves the device here except what the player chooses to share as a link (and a link's fragment is never sent
 * to a web server). The weekly targets are read from the site's own static files.
 */
import { noAssists, noteAssists, type AssistRecord } from './assists';
import { isLikeForLikeKey, loadLikeForLike, recordAttempt, type LikeForLike, type BestResult } from './bests';
import { challengePayload, challengeResult, challengeUrl, decodeChallenge, encodeChallenge, splitsFrom, type Challenge, type Split } from './challenge';
import { loadName, randomName, saveName } from './safeNames';
import { targetsStatus, trackPoses, type Medal, type TargetsStatus } from './targets';
import { weeklyCourse, weeklyKey, type WeeklyCourse } from './weekly';
import type { AppScenario } from './controller';
import type { Recording } from './replay';
import type { RaceEvent } from '../sim/course/judge';
import type { FleetPose } from '../render/fleet';

/** What the social features need from the controller. */
export interface SocialHost {
  restart(s: AppScenario): boolean;
  /** Race a ghost from a recording (src/app/controller.ts startGhost). */
  startGhost(rec: unknown): boolean;
  /** Race a ghost from poses every 0.1 s (a model-sailed target). */
  startPoseGhost(title: string, scenario: AppScenario, poses: FleetPose[]): boolean;
  saveRecording(title: string): Recording;
  /** The race being sailed is tagged with a best-time key (weekly or challenge). */
  tagRace(key: string, scenario: AppScenario): void;
  publish(): void;
}

export interface FinishInfo {
  key: string;
  label: string;
  timeS: number;
  splits: Split[];
  assist: AssistRecord;
  best?: BestResult;
}

export interface SocialUi {
  name: string;
  weekly: { key: string; week: string; name: string; status?: string; summary: string; terms: WeeklyCourse['terms']; best?: LikeForLike };
  targets: TargetsStatus | { state: 'loading' };
  /** The last finish of a like-for-like course in this session (for "Challenge a friend"). */
  finish?: FinishInfo;
  /** A challenge link opened and waiting for the player's answer. */
  invite?: { name: string; course: string; finishS: number; independent: boolean };
  /** The challenge being raced, and its result after the finish. */
  racing?: { name: string; finishS: number };
  result?: ReturnType<typeof challengeResult>;
  error?: string;
  /** The assist record of the run so far. */
  assist: AssistRecord;
}

export class SocialHub {
  name = typeof localStorage === 'undefined' ? randomName() : loadName();
  private assist = noAssists();
  private targets: SocialUi['targets'] = { state: 'loading' };
  private targetsFor?: string;
  private finish?: FinishInfo;
  private invite?: Challenge;
  private racing?: Challenge;
  private result?: SocialUi['result'];
  private error?: string;

  constructor(private readonly host: SocialHost, private readonly base = 'weekly/') {}

  /** This week's course, built in the app from the week alone (no server needed). */
  weekly(now = new Date()): WeeklyCourse {
    return weeklyCourse(now);
  }

  /** A new run started: the assist record starts again; a challenge or target ends if the course changed. */
  onRestart(scenario: AppScenario): void {
    this.assist = noAssists();
    this.finish = undefined;
    if (this.racing && JSON.stringify(this.racing.rec.scenario) !== JSON.stringify(scenario)) this.racing = undefined;
    this.result = undefined;
  }

  /** Every few steps: what assists are on now. */
  noteAssists(now: Partial<AssistRecord['assists']>): void {
    noteAssists(this.assist, now);
  }

  /** The player finished a tagged race: keep the like-for-like best and the history, and compare with a challenge. */
  onFinish(key: string | undefined, label: string, timeS: number, events: readonly RaceEvent[], startSignalT: number): void {
    const splits = splitsFrom(events, startSignalT);
    const assist = structuredClone(this.assist);
    const best = key && isLikeForLikeKey(key) ? recordAttempt(key, label, timeS, assist.independent) : undefined;
    this.finish = key ? { key, label, timeS: Math.round(timeS * 10) / 10, splits, assist, best } : undefined;
    if (this.racing) this.result = challengeResult({ finishS: timeS, splits }, this.racing);
    this.host.publish();
  }

  /** Sail this week's course (alone; targets and friends are ghosts). */
  sailWeekly(): boolean {
    const w = this.weekly();
    if (!this.host.restart(structuredClone(w.scenario))) return false;
    this.host.tagRace(weeklyKey(w.week), w.scenario);
    return true;
  }

  /** Read this week's targets from the site (once a week per visit). Missing or stale: "not available". */
  async loadTargets(fetchFn: typeof fetch = fetch): Promise<void> {
    const w = this.weekly();
    if (this.targetsFor === w.week.key && this.targets.state !== 'loading') return;
    this.targetsFor = w.week.key;
    try {
      const r = await fetchFn(`${this.base}${w.week.key}.json`, { cache: 'no-cache' });
      this.targets = r.ok ? targetsStatus(await r.json(), w.week.key, JSON.stringify(w.scenario)) : { state: 'unavailable', reason: r.status === 404 ? 'not published yet' : `the site answered ${r.status}` };
    } catch {
      this.targets = { state: 'unavailable', reason: 'the targets file could not be read (offline?)' };
    }
    this.host.publish();
  }

  /** Race a model-sailed target's ghost on this week's course. */
  raceTarget(medal: Medal): boolean {
    if (this.targets.state !== 'ok') return false;
    const t = this.targets.file.targets.find((x) => x.medal === medal);
    if (!t) return false;
    const w = this.weekly();
    if (!this.host.startPoseGhost(`${medal[0]!.toUpperCase()}${medal.slice(1)} target (model-sailed, ${t.level} AI)`, structuredClone(w.scenario), trackPoses(t.track))) return false;
    this.host.tagRace(weeklyKey(w.week), w.scenario);
    return true;
  }

  setName(name: string): void {
    saveName(name);
    this.name = loadName();
    this.host.publish();
  }

  rerollName(): void {
    this.setName(randomName());
  }

  /** A link that challenges a friend to beat the last finish (the whole run is in the link's fragment). */
  async challengeLink(page: string): Promise<string | undefined> {
    const f = this.finish;
    if (!f) return undefined;
    const rec = this.host.saveRecording(`${this.name}: ${f.label}`);
    const c: Challenge = { v: 1, name: this.name, course: f.label, key: f.key, finishS: f.timeS, splits: f.splits, independent: f.assist.independent, rec };
    return challengeUrl(page, await encodeChallenge(c));
  }

  /** A #challenge= link in the address: read it and ask the player (the card). True if there was one. */
  async openLink(hash: string): Promise<boolean> {
    const payload = challengePayload(hash);
    if (!payload) return false;
    try {
      this.invite = await decodeChallenge(payload);
      this.error = undefined;
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.host.publish();
    return true;
  }

  acceptChallenge(): boolean {
    const c = this.invite;
    this.invite = undefined;
    if (!c) return false;
    this.racing = c;
    this.result = undefined;
    const ok = this.host.startGhost(c.rec);
    if (ok) this.host.tagRace(c.key, c.rec.scenario);
    this.host.publish();
    return ok;
  }

  declineChallenge(): void {
    this.invite = undefined;
    this.error = undefined;
    this.host.publish();
  }

  /** The challenge being raced, for the comparison at the finish (the controller passes it on). */
  get challenge(): Challenge | undefined {
    return this.racing;
  }

  ui(): SocialUi {
    const w = this.weekly();
    const key = weeklyKey(w.week);
    return {
      name: this.name,
      weekly: { key, week: w.week.key, name: w.name, status: w.status, summary: w.summary, terms: w.terms, best: typeof localStorage === 'undefined' ? undefined : loadLikeForLike(key) },
      targets: this.targets,
      finish: this.finish,
      invite: this.invite ? { name: this.invite.name, course: this.invite.course, finishS: this.invite.finishS, independent: this.invite.independent } : undefined,
      racing: this.racing ? { name: this.racing.name, finishS: this.racing.finishS } : undefined,
      result: this.result,
      error: this.error,
      assist: this.assist,
    };
  }
}
