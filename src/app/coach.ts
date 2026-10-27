/**
 * The race coach: a briefing before the start from the conditions and the course, short tips while racing,
 * and a debrief afterwards on the decisions that cost or gained most. Pure (no DOM): the controller feeds it
 * samples of the user's boat and race state; tests drive it directly.
 *
 * The thresholds (what counts as overpowered, a header, a slow tack…) are the coach's rules of thumb (E), not
 * measured Squib data. The advice is training advice, not an adjudication: it never decides a rules question.
 */
import type { Polar } from '../sim/ai/polar';

const DEG = Math.PI / 180;
const KN = 1852 / 3600;
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The coach's rules of thumb (E). */
export const COACH = {
  overpoweredHeel: 30 * DEG,
  /** A shift big enough to tack on, on a beat. */
  headerDeg: 8,
  /** Time constant of the "mean" wind direction that shifts are measured against (s). */
  meanWindS: 90,
  /** A tack or gybe that loses more than this fraction of speed is slow. */
  slowTackLoss: 0.35,
  /** Same tip again no sooner than this (s), and any tip no sooner than `gapS` after the last. */
  repeatS: 45,
  gapS: 8,
} as const;

export interface CoachLine {
  a: { n: number; e: number };
  b: { n: number; e: number };
}

export interface BriefingInput {
  twsKn: number;
  /** Direction the wind blows from (deg). */
  twdDeg: number;
  gusts: string;
  /** Stream at the start (towards, deg; kn), if any. */
  current?: { setDeg: number; rateKn: number };
  line: CoachLine;
  /** What the line's ends are, a then b (e.g. "pin", "committee boat"). */
  endLabels?: [string, string];
  /** The first mark (normally to windward). */
  firstMark: { n: number; e: number };
  sequence: string;
  competitors: number;
}

export interface Tip {
  id: string;
  text: string;
  /** Simulated time it was given (s). */
  t: number;
  tone: 'info' | 'warn' | 'good';
}

/** Which end of the line is upwind, and by how much (m): positive = the `b` end (the committee boat, usually). */
export function lineBias(line: CoachLine, twdDeg: number): { favoured: 'a' | 'b' | 'square'; metres: number; deg: number } {
  const dn = line.b.n - line.a.n;
  const de = line.b.e - line.a.e;
  const len = Math.hypot(dn, de) || 1;
  // Upwind unit vector; the projection of a→b on it is how much further upwind b lies.
  const up = { n: Math.cos(twdDeg * DEG), e: Math.sin(twdDeg * DEG) };
  const metres = dn * up.n + de * up.e;
  const deg = Math.asin(Math.max(-1, Math.min(1, metres / len))) / DEG;
  // Less than a third of a boat length (5.8 m) either way is square for practical purposes (E).
  return { favoured: Math.abs(metres) < 2 ? 'square' : metres > 0 ? 'b' : 'a', metres, deg };
}

function endLabel(i: BriefingInput, end: 'a' | 'b'): string {
  const [a, b] = i.endLabels ?? ['pin', 'committee boat'];
  return end === 'a' ? a : b;
}

/** The pre-start briefing: what to set up and where to start, from the conditions and the course. */
export function briefing(i: BriefingInput): string[] {
  const out: string[] = [];
  const w = i.twsKn;
  if (w < 6) out.push(`Light airs (${w.toFixed(0)} kn): sails full (flatten 0%), sheets a little eased for power, crew to leeward and forward; turn gently, every tack costs a lot.`);
  else if (w < 12) out.push(`${w.toFixed(0)} kn: full power (flatten 0%). Hike to keep her flat upwind; sail the angles the instruments show.`);
  else if (w < 18) out.push(`${w.toFixed(0)} kn: flatten about halfway (Z twice) before the start, hike hard, and ease the main in the puffs rather than letting her heel past 25°.`);
  else out.push(`Heavy air (${w.toFixed(0)} kn): flatten fully (Z four times) before the start and keep the auto main on or play the mainsheet hard. Downwind, bear away in the gusts and gybe in a lull, not in a puff.`);
  if (i.gusts === 'steady') out.push('Steady breeze: few shifts, so tack only to reach the layline or to clear your air; boat speed wins.');
  else if (i.gusts === 'gusty') out.push(`Gusty off the hills: look upwind for dark patches on the water. On a beat, tack on headers of ${COACH.headerDeg}° or more; feather up and ease in the gusts.`);
  else out.push(`Shifty: on the beat, tack when headed by ${COACH.headerDeg}° or more and sail the lifts; head for the side with more pressure (darker water).`);
  const bias = lineBias(i.line, i.twdDeg);
  if (bias.favoured === 'square') out.push('The line is square to the wind: start where there is room and clear air.');
  else out.push(`The ${endLabel(i, bias.favoured)} end is favoured by about ${Math.abs(bias.metres).toFixed(0)} m (${Math.abs(bias.deg).toFixed(0)}°): start near it if you can get a clear lane.`);
  if (i.current && i.current.rateKn >= 0.3) {
    // Stream along the course: with the stream pushing towards the first mark, the line comes up early.
    const toMark = Math.atan2(i.firstMark.e - (i.line.a.e + i.line.b.e) / 2, i.firstMark.n - (i.line.a.n + i.line.b.n) / 2);
    const along = Math.cos(i.current.setDeg * DEG - toMark) * i.current.rateKn;
    if (along > 0.2) out.push(`The stream (${i.current.rateKn.toFixed(1)} kn) is setting you over the line and up the course: hang back before the gun, and expect to lay the windward mark early.`);
    else if (along < -0.2) out.push(`The stream (${i.current.rateKn.toFixed(1)} kn) is against you: be on the line early and look for less stream in the shallows.`);
    else out.push(`The stream (${i.current.rateKn.toFixed(1)} kn) runs across the course: it moves the laylines; allow for it at the marks.`);
  }
  if (i.competitors >= 8) out.push(`${i.competitors} boats: a busy line. Find a gap with a clear lane to leeward and protect it in the last minute.`);
  const seq = i.sequence.charAt(0).toUpperCase() + i.sequence.slice(1);
  out.push(`${seq} sequence: be on the line at full speed at the gun; over early means going back (flag X).`);
  return out;
}

/** What the controller tells the coach every half second. Angles in rad, speeds in m/s. */
export interface CoachSample {
  t: number;
  n: number;
  e: number;
  stw: number;
  /** Velocity made good to windward (> 0 upwind). */
  vmg: number;
  tws: number;
  twd: number;
  /** True wind angle, > 0 wind from starboard. */
  twa: number;
  heel: number;
  /** Rudder angle over its travel (−1 … 1). */
  rudderFrac: number;
  mainLuff: number;
  mainStall: number;
  autoMain: boolean;
  flatten: number;
  race: {
    phase: 'pre-start' | 'racing' | 'finished';
    toStart: number;
    ocs: boolean;
    mark?: { n: number; e: number };
    penaltyOwed: number;
  };
}

type LegKind = 'beat' | 'reach' | 'run';

interface Manoeuvre {
  t: number;
  kind: 'tack' | 'gybe';
  before: number;
  min: number;
}

export interface DebriefItem {
  area: 'Start' | 'Upwind' | 'Downwind' | 'Boat handling' | 'Heavy air' | 'Rules';
  verdict: 'good' | 'ok' | 'work';
  text: string;
}

export interface Debrief {
  items: DebriefItem[];
  /** The one thing to work on first. */
  focus?: string;
}

/** Live tips and the debrief, from samples of the user's boat during a race. */
export class RaceCoach {
  readonly briefing: string[];
  private tips: Tip[] = [];
  private lastTipT = -Infinity;
  private lastById = new Map<string, number>();
  private meanWind?: { x: number; y: number };
  private prev?: CoachSample;
  private history: { t: number; stw: number }[] = [];
  private manoeuvres: Manoeuvre[] = [];
  private open?: Manoeuvre;
  private overSince?: number;
  private helmSince?: number;
  private luffSince?: number;
  private stallSince?: number;
  private headedSince?: number;
  private start?: { behindM: number; speed: number; along: number; ocs: boolean; late?: number };
  private gunT?: number;
  private wasOcs = false;
  // Time totals while racing (s).
  private tot = { beat: 0, run: 0, reach: 0, headed: 0, over: 0, overFlat: 0, poorTrim: 0, beatEff: 0, runEff: 0, beatN: 0, runN: 0 };

  constructor(readonly input: BriefingInput, private readonly polar: Polar) {
    this.briefing = briefing(input);
  }

  /** The latest tips, newest first. */
  get recent(): readonly Tip[] {
    return this.tips;
  }

  private say(t: number, id: string, text: string, tone: Tip['tone'] = 'info'): void {
    if (t - this.lastTipT < COACH.gapS) return;
    if (t - (this.lastById.get(id) ?? -Infinity) < COACH.repeatS) return;
    this.lastById.set(id, t);
    this.lastTipT = t;
    this.tips = [{ id, text, t, tone }, ...this.tips].slice(0, 4);
  }

  /** The leg the boat is on, from the bearing to the next mark and the wind. */
  private legOf(s: CoachSample): LegKind | undefined {
    const m = s.race.mark;
    if (!m) return undefined;
    const off = Math.abs(wrapPi(Math.atan2(m.e - s.e, m.n - s.n) - s.twd));
    return off < 60 * DEG ? 'beat' : off > 120 * DEG ? 'run' : 'reach';
  }

  update(s: CoachSample): void {
    const dt = this.prev ? Math.max(0, Math.min(2, s.t - this.prev.t)) : 0;
    // The mean wind direction, as a vector average with a 90 s memory.
    const k = this.meanWind ? 1 - Math.exp(-dt / COACH.meanWindS) : 1;
    const wx = Math.sin(s.twd);
    const wy = Math.cos(s.twd);
    this.meanWind = this.meanWind ? { x: this.meanWind.x + (wx - this.meanWind.x) * k, y: this.meanWind.y + (wy - this.meanWind.y) * k } : { x: wx, y: wy };
    const shift = wrapPi(s.twd - Math.atan2(this.meanWind.x, this.meanWind.y)) / DEG;
    const r = s.race;
    const leg = r.phase === 'racing' ? this.legOf(s) : undefined;

    // ---- the start
    if (r.phase === 'pre-start') {
      if (r.toStart <= 62 && r.toStart > 58) this.say(s.t, 'one-minute', 'One minute: pick your spot near the favoured end, keep a gap to leeward, and keep clear of the line.');
      if (r.toStart <= 22 && r.toStart > 18) this.say(s.t, 'build-speed', 'Twenty seconds: bear away a little and sheet in to build speed for the gun.');
    }
    if (this.gunT === undefined && r.toStart <= 0 && this.prev && this.prev.race.toStart > 0) {
      this.gunT = s.t;
      const { behindM, along } = this.lineState(s);
      this.start = { behindM, speed: s.stw, along, ocs: r.ocs || behindM < 0 };
    }
    if (r.ocs && !this.wasOcs) this.say(s.t, 'ocs', 'Over early: turn back and recross the start line from the course side (flag X).', 'warn');
    this.wasOcs = r.ocs;
    if (this.start && this.start.late === undefined && r.phase === 'racing') this.start.late = s.t - (this.gunT ?? s.t);

    // ---- tacks and gybes: speed before, and the lowest speed in the 12 s after
    if (this.prev && Math.sign(s.twa) !== Math.sign(this.prev.twa) && Math.sign(this.prev.twa) !== 0) {
      const before = this.history.find((h) => h.t >= s.t - 4)?.stw ?? this.prev.stw;
      if (this.open) this.manoeuvres.push(this.open);
      this.open = { t: s.t, kind: Math.abs(s.twa) < 90 * DEG ? 'tack' : 'gybe', before, min: s.stw };
    }
    if (this.open) {
      this.open.min = Math.min(this.open.min, s.stw);
      if (s.t - this.open.t > 12) {
        const m = this.open;
        this.manoeuvres.push(m);
        this.open = undefined;
        if (r.phase === 'racing' && m.before > 1 && 1 - m.min / m.before > COACH.slowTackLoss) {
          this.say(s.t, 'slow-tack', `That ${m.kind} lost ${(100 * (1 - m.min / m.before)).toFixed(0)}% of your speed: turn more smoothly, and ${m.kind === 'tack' ? 'bear off a little after it to build speed before pointing' : 'keep the boat flat and centre the main through it'}.`, 'warn');
        }
      }
    }
    this.history.push({ t: s.t, stw: s.stw });
    while (this.history.length && this.history[0]!.t < s.t - 10) this.history.shift();

    // ---- overpowered and weather helm (any time)
    if (Math.abs(s.heel) > COACH.overpoweredHeel) this.overSince ??= s.t;
    else this.overSince = undefined;
    if (this.overSince !== undefined && s.t - this.overSince > 3) {
      if (s.flatten < 0.7) this.say(s.t, 'overpowered', `Overpowered (${Math.round(Math.abs(s.heel) / DEG)}° of heel): flatten the sails (Z) and ease the main in the gusts (S)${s.autoMain ? '' : ', or turn the auto main on (M)'}.`, 'warn');
      else this.say(s.t, 'overpowered-flat', 'Still overpowered: ease the main further in the gusts and feather up a little on the beat.', 'warn');
    }
    // Weather helm: the rudder nearly hard over to bear away (to port on starboard tack), heeled, not mid-turn.
    const bearingAway = -s.rudderFrac * Math.sign(s.twa);
    if (bearingAway > 0.8 && Math.abs(s.heel) > 15 * DEG && Math.abs(s.twa) > 30 * DEG) this.helmSince ??= s.t;
    else this.helmSince = undefined;
    if (this.helmSince !== undefined && s.t - this.helmSince > 2) this.say(s.t, 'weather-helm', 'Heavy weather helm: the rudder is almost hard over. Ease the main to stop her rounding up.', 'warn');
    if (s.tws < 7 * KN && s.flatten > 0.3) this.say(s.t, 'power-up', 'Light breeze: power the sails up again (Shift+Z).');

    // ---- trim (manual main only)
    if (!s.autoMain && r.phase === 'racing') {
      if (s.mainLuff < 0.6) this.luffSince ??= s.t;
      else this.luffSince = undefined;
      if (s.mainStall > 0.5) this.stallSince ??= s.t;
      else this.stallSince = undefined;
      if (this.luffSince !== undefined && s.t - this.luffSince > 5) this.say(s.t, 'luffing', 'Main luffing: trim it in (W) until it just stops.');
      if (this.stallSince !== undefined && s.t - this.stallSince > 5) this.say(s.t, 'stalled', 'Main stalled (over-sheeted): ease it (S) until the luff just lifts, then trim back a touch.');
    }

    // ---- shifts on the beat
    const headed = leg === 'beat' && Math.abs(s.twa) < 70 * DEG && (s.twa > 0 ? shift < -COACH.headerDeg : shift > COACH.headerDeg);
    if (headed) this.headedSince ??= s.t;
    else this.headedSince = undefined;
    if (this.headedSince !== undefined && s.t - this.headedSince > 8) this.say(s.t, 'header', `Headed by ${Math.abs(shift).toFixed(0)}°: tack onto the lift (unless you are near the layline or someone is in the way).`);

    // ---- layline to the windward mark
    if (leg === 'beat' && r.mark) {
      const beat = this.polar.beat(s.tws);
      const brg = Math.atan2(r.mark.e - s.e, r.mark.n - s.n);
      const offWind = wrapPi(brg - s.twd);
      // On starboard (wind from starboard) the mark is laid on port once it is beat.twa to the right of the wind.
      const otherTackLays = s.twa > 0 ? offWind > beat.twa : offWind < -beat.twa;
      const dist = Math.hypot(r.mark.n - s.n, r.mark.e - s.e);
      if (otherTackLays && dist > 40) this.say(s.t, 'layline', `On the layline: you can lay the mark on the other tack now (${dist.toFixed(0)} m).`, 'good');
    }

    // ---- downwind in a gust
    if (leg === 'run' && this.prev && s.tws > this.prev.tws * 1.15 && s.tws > 12 * KN) this.say(s.t, 'gust-run', 'Gust: bear away with it to keep the boat flat and surf; head up again in the lull.');

    if (r.penaltyOwed > 0) this.say(s.t, 'penalty', `You owe ${r.penaltyOwed === 1 ? 'a one-turn' : 'a two-turns'} penalty: take it promptly, clear of other boats.`, 'warn');

    // ---- totals for the debrief
    if (r.phase === 'racing' && leg) {
      this.tot[leg] += dt;
      if (leg === 'beat') {
        if (headed) this.tot.headed += dt;
        const target = this.polar.beat(s.tws).vmg;
        if (target > 0.1) {
          this.tot.beatEff += Math.max(0, Math.min(1.5, s.vmg / target)) * dt;
          this.tot.beatN += dt;
        }
      } else if (leg === 'run') {
        const target = this.polar.run(s.tws).vmg;
        if (target > 0.1) {
          this.tot.runEff += Math.max(0, Math.min(1.5, -s.vmg / target)) * dt;
          this.tot.runN += dt;
        }
      }
      if (Math.abs(s.heel) > COACH.overpoweredHeel) {
        this.tot.over += dt;
        if (s.flatten >= 0.7) this.tot.overFlat += dt;
      }
      if (!s.autoMain && (s.mainLuff < 0.6 || s.mainStall > 0.5)) this.tot.poorTrim += dt;
    }
    this.prev = s;
  }

  /** Distance behind the start line (m, > 0 on the pre-start side) and the fraction along it from the pin. */
  private lineState(s: CoachSample): { behindM: number; along: number } {
    const { a, b } = this.input.line;
    const dn = b.n - a.n;
    const de = b.e - a.e;
    const len = Math.hypot(dn, de) || 1;
    // Normal to the line, pointing to the course side (the first mark's side).
    let nn = -de / len;
    let ne = dn / len;
    const mk = this.input.firstMark;
    if ((mk.n - a.n) * nn + (mk.e - a.e) * ne < 0) {
      nn = -nn;
      ne = -ne;
    }
    const behindM = -((s.n - a.n) * nn + (s.e - a.e) * ne);
    const along = ((s.n - a.n) * dn + (s.e - a.e) * de) / (len * len);
    return { behindM, along };
  }

  /** The debrief: what went well and what to work on, with the numbers behind each. */
  debrief(result?: { place?: number; fleet: number; incidents: number }): Debrief {
    const items: DebriefItem[] = [];
    const st = this.start;
    if (st) {
      const bias = lineBias(this.input.line, this.input.twdDeg);
      const kn = st.speed / KN;
      if (st.ocs) items.push({ area: 'Start', verdict: 'work', text: 'Over the line early at the gun: hold back a few lengths in the last 20 s and time your run in.' });
      else if (st.behindM > 25 || kn < 2.5) items.push({ area: 'Start', verdict: 'work', text: `At the gun you were ${st.behindM.toFixed(0)} m behind the line at ${kn.toFixed(1)} kn. Aim to be within a length (6 m) at full speed.` });
      else if (st.behindM > 10) items.push({ area: 'Start', verdict: 'ok', text: `A reasonable start: ${st.behindM.toFixed(0)} m behind the line at ${kn.toFixed(1)} kn at the gun.` });
      else items.push({ area: 'Start', verdict: 'good', text: `A good start: on the line (${st.behindM.toFixed(0)} m) at ${kn.toFixed(1)} kn at the gun.` });
      if (bias.favoured !== 'square' && Math.abs(bias.metres) > 6) {
        const atFavoured = bias.favoured === 'b' ? st.along > 0.6 : st.along < 0.4;
        items.push(atFavoured
          ? { area: 'Start', verdict: 'good', text: `You started at the favoured ${endLabel(this.input, bias.favoured)} end (worth about ${Math.abs(bias.metres).toFixed(0)} m).` }
          : { area: 'Start', verdict: 'work', text: `The ${endLabel(this.input, bias.favoured)} end was favoured by about ${Math.abs(bias.metres).toFixed(0)} m; you started ${st.along < 0.4 ? `near the ${endLabel(this.input, 'a')}` : st.along > 0.6 ? `near the ${endLabel(this.input, 'b')}` : 'mid-line'}.` });
      }
    } else items.push({ area: 'Start', verdict: 'work', text: 'The coach did not see you at the line at the gun.' });

    const t = this.tot;
    if (t.beatN > 30) {
      const eff = t.beatEff / t.beatN;
      items.push({ area: 'Upwind', verdict: eff > 0.9 ? 'good' : eff > 0.75 ? 'ok' : 'work', text: `Upwind you made ${(100 * eff).toFixed(0)}% of the target VMG (model polar, E). ${eff > 0.9 ? 'Well sailed.' : 'Keep the boat flat, sail the target angle and avoid pinching.'}` });
      const headedPct = (100 * t.headed) / Math.max(1, t.beat);
      if (headedPct > 25) items.push({ area: 'Upwind', verdict: 'work', text: `You sailed ${headedPct.toFixed(0)}% of the beats on a header of ${COACH.headerDeg}° or more: tack on the headers and sail the lifts.` });
      else if (this.input.gusts !== 'steady') items.push({ area: 'Upwind', verdict: 'good', text: `Only ${headedPct.toFixed(0)}% of the beats on a big header: you played the shifts well.` });
    }
    if (t.runN > 30) {
      const eff = t.runEff / t.runN;
      items.push({ area: 'Downwind', verdict: eff > 0.9 ? 'good' : eff > 0.75 ? 'ok' : 'work', text: `Downwind you made ${(100 * eff).toFixed(0)}% of the target VMG. ${eff > 0.9 ? 'Good angles.' : 'Sail the target angle (often 150–165° off the wind) and gybe on the shifts rather than running dead downwind.'}` });
    }
    const all = [...this.manoeuvres, ...(this.open ? [this.open] : [])].filter((m) => m.before > 1);
    if (all.length) {
      const loss = all.reduce((a, m) => a + (1 - m.min / m.before), 0) / all.length;
      const tacks = all.filter((m) => m.kind === 'tack').length;
      items.push({ area: 'Boat handling', verdict: loss < 0.25 ? 'good' : loss < COACH.slowTackLoss ? 'ok' : 'work', text: `${tacks} tack${tacks === 1 ? '' : 's'} and ${all.length - tacks} gybe${all.length - tacks === 1 ? '' : 's'}, losing ${(100 * loss).toFixed(0)}% of your speed on average. ${loss < 0.25 ? 'Smooth.' : 'Turn more gently and build speed before pointing again.'}` });
    }
    if (t.poorTrim > 20) items.push({ area: 'Boat handling', verdict: 'work', text: `The main was luffing or stalled for ${t.poorTrim.toFixed(0)} s: watch its status and trim to the edge of the luff.` });
    if (t.over > 10) {
      items.push({ area: 'Heavy air', verdict: t.over > 60 ? 'work' : 'ok', text: `${t.over.toFixed(0)} s heeled past ${COACH.overpoweredHeel / DEG}°${t.overFlat < t.over / 2 ? ', mostly with the sails not flattened: flatten (Z) before the breeze builds' : ': ease the main sooner in the gusts'}.` });
    } else if (this.input.twsKn >= 15) items.push({ area: 'Heavy air', verdict: 'good', text: 'You kept her on her feet in a breeze.' });
    if (result && result.incidents > 0) items.push({ area: 'Rules', verdict: 'work', text: `${result.incidents} rules incident${result.incidents === 1 ? '' : 's'} (simplified judging, not an adjudication): keep a lookout and give room early.` });
    const work = items.filter((i) => i.verdict === 'work');
    return { items, focus: work[0] ? `${work[0].area}: ${work[0].text}` : undefined };
  }
}
