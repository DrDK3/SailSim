/**
 * The seamanship lessons (src/app/lessons.ts): picking up a mooring, coming alongside, man overboard, each sailed to
 * the end by a scripted helmsman (steer to a spot downwind of the buoy, then turn into the wind with the sheets let go).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController } from '../../src/app/controller';
import { LESSONS, lessonAfter, lessonsIn } from '../../src/app/lessons';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

const R2D = 180 / Math.PI;
const KN = 0.514444;
const WIND_FROM = 225;
type Inner = { lessonTarget?: { n: number; e: number } };
const wrap = (d: number) => ((d % 360) + 540) % 360 - 180;

/** Steer (helm held, set directly) to a compass heading for up to `s` seconds or until `until`. */
function steer(c: SimController, headingOf: () => number, s: number, until: () => boolean, sheets?: () => void) {
  for (let i = 0; i < s * 10 && !until(); i++) {
    const sn = c.sim.snapshot(false);
    const err = wrap(headingOf() - sn.heading * R2D);
    c.setInput({ helm: Math.max(-1, Math.min(1, err / 25 - (c.sim.state.r * R2D) / 20)) });
    sheets?.();
    c.advance(0.1);
  }
}

const bearingTo = (c: SimController, p: { n: number; e: number }) => {
  const s = c.sim.snapshot(false);
  return Math.atan2(p.e - s.e, p.n - s.n) * R2D;
};
const distTo = (c: SimController, p: { n: number; e: number }) => {
  const s = c.sim.snapshot(false);
  return Math.hypot(p.n - s.n, p.e - s.e);
};

/**
 * Approach a point as taught: in on a close reach (60° off the wind), the sheets let go at a distance that grows with
 * speed (a keelboat carries her way: about 30 m from 4 kn here), and a luff head to wind for the last 14 m; sheeting
 * in again for a moment if she stops short. `side`: aim that far to port of the point.
 */
function approach(c: SimController, target: { n: number; e: number }, side = 0) {
  const H = ((WIND_FROM - 60) * Math.PI) / 180;
  const left = H - Math.PI / 2;
  const aim = { n: target.n + Math.cos(left) * side, e: target.e + Math.sin(left) * side };
  const p = { n: aim.n - Math.cos(H) * 45, e: aim.e - Math.sin(H) * 45 };
  c.setInput({ autoMain: true, autoJib: true });
  // To the start of the approach (no closer than 50° to the wind; keep the tack chosen).
  let tack = 0;
  steer(c, () => {
    const b = bearingTo(c, p);
    const off = wrap(b - WIND_FROM);
    if (Math.abs(off) >= 50) {
      tack = 0;
      return b;
    }
    tack ||= Math.sign(off) || 1;
    return WIND_FROM + tack * 50;
  }, 240, () => distTo(c, p) < 6);
  // In towards it: sheets let go when close enough to coast to a stop, in again if she stops short.
  const done = () => {
    const t = c.getState().tutorial;
    return !t || t.finished || (t.done && (t.step.id === 'stop' || t.step.id === 'back'));
  };
  // The last few metres: luff head to wind, which stops her quickly.
  steer(c, () => (distTo(c, aim) < 14 ? WIND_FROM : bearingTo(c, aim)), 120, done, () => {
    const d = distTo(c, aim);
    const kn = c.sim.snapshot(false).sog / KN;
    if (d < 7 * kn) c.setInput({ autoMain: false, autoJib: false, mainSheet: 1, jibSheet: 1 });
    else if (kn < 1.2 && d > 8) c.setInput({ autoMain: true, autoJib: true });
  });
}

function finish(c: SimController) {
  for (let i = 0; i < 40 && !c.getState().tutorial?.finished; i++) {
    c.advance(0.5);
    if (c.getState().tutorial?.step.goal === undefined) c.tutorialNext();
  }
}

describe('seamanship lessons', () => {
  it('three, in their own group after the six basics; the basics flow is unchanged', () => {
    expect(lessonsIn('basics').map((l) => l.id)).toEqual(['steer', 'wind', 'trim', 'turns', 'start', 'tide']);
    expect(lessonsIn('seamanship').map((l) => l.id)).toEqual(['mooring', 'alongside', 'mob']);
    expect(lessonAfter('tide')).toBeUndefined();
    expect(lessonAfter('mooring')?.id).toBe('alongside');
    expect(LESSONS.every((l) => l.steps.length >= 3)).toBe(true);
  });

  it('picking up a mooring: stopped with the buoy at the bow', () => {
    const c = new SimController();
    c.startLesson('mooring');
    c.tutorialNext();
    const tg = (c as unknown as Inner).lessonTarget!;
    // Aimed a few metres to port: the luff at the end swings her that far to starboard, onto the buoy.
    approach(c, tg, 4.5);
    finish(c);
    const t = c.getState().tutorial!;
    expect(t.finished).toBe(true);
    expect(t.result!.lines.join(' ')).toMatch(/You stopped \d+\.\d m from the buoy/);
    expect(c.sim.snapshot(false).sog / KN).toBeLessThan(1.2);
  });

  it('coming alongside: stopped with the pontoon end abeam', () => {
    const c = new SimController();
    c.startLesson('alongside');
    c.tutorialNext();
    const tg = (c as unknown as Inner).lessonTarget!;
    approach(c, tg, 1.5);
    finish(c);
    expect(c.getState().tutorial!.result!.lines.join(' ')).toMatch(/You stopped alongside/);
  });

  it('man overboard: away, tack, back and stopped beside them', () => {
    const c = new SimController();
    c.startLesson('mob');
    c.tutorialNext();
    const tg = (c as unknown as Inner).lessonTarget!;
    // Away on the reach she starts on.
    steer(c, () => 135, 60, () => distTo(c, tg) > 55);
    expect(c.getState().tutorial!.step.id).toBe('turn');
    // Tack: up through the wind onto the other tack, close-hauled.
    steer(c, () => WIND_FROM + 50, 30, () => c.getState().tutorial!.step.id !== 'turn');
    expect(c.getState().tutorial!.step.id).toBe('back');
    approach(c, tg);
    finish(c);
    expect(c.getState().tutorial!.result!.lines.join(' ')).toMatch(/Back beside them after/);
  });
});
