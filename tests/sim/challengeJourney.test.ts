/**
 * Design handover (23 Nov 2026), item 24: the friend challenge journey. Before racing, the recipient sees how long it
 * takes, how it was set up, the sender's support category and whether this version re-sails the ghost faithfully;
 * a link cut short by a messaging app gives a reason and the replay-file fallback; the ghost is said to be a recording.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CHALLENGE_RECOVERY, challengePayload, challengePreview, challengeUrl, decodeChallenge, encodeChallenge, type Challenge } from '../../src/app/challenge';
import { SimController, type AppScenario } from '../../src/app/controller';
import { RULESET } from '../../src/app/bests';

beforeEach(() => {
  const memory = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };
});

const FREE: AppScenario = {
  conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 11, twdDeg: 225 }, gusts: { preset: 'steady', seed: 9 }, current: { mode: 'none' } },
  startLocation: 'start-bay-practice',
  startHeadingDeg: 0,
  startSpeedKn: 3,
  spinnaker: true,
};
const rec = () => {
  const c = new SimController();
  c.restart(FREE);
  c.advance(3);
  return c.saveRecording('t');
};
const ch = (over: Partial<Challenge> = {}): Challenge => ({ v: 1, name: 'Blue Heron 42', course: 'Short course in Start Bay · 11 kn from 225°', key: `challenge:2026-11-23:${RULESET}`, finishS: 312, splits: [], independent: false, rec: rec(), ...over });

describe('what the recipient sees before racing', () => {
  it('duration, set-up and support', () => {
    const p = challengePreview(ch(), ch().rec.build);
    expect(p.duration).toBe('about 5 minutes of sailing (their time 5:12)');
    expect(p.setup.join(' · ')).toMatch(/^Short course in Start Bay · 11 kn from 225° · a .+ · with a spinnaker · no AI boats · rule 18 advisory$/);
    expect(p.support).toMatch(/^assisted/);
  });

  it('the same build: the ghost follows their exact path', () => {
    const c = ch();
    expect(challengePreview(c, c.rec.build).compatibility).toEqual([{ ok: true, text: expect.stringMatching(/exact path/) }]);
  });

  it('another build: said plainly that the ghost may drift', () => {
    const c = ch();
    const compat = challengePreview(c, 'production-somethingelse').compatibility;
    expect(compat[0]!.ok).toBe(false);
    expect(compat[0]!.text).toMatch(/may drift from their path/);
  });

  it('a challenge under earlier race rules: kept apart', () => {
    const c = ch({ key: 'challenge:2026-11-17:r1' });
    expect(challengePreview(c, c.rec.build).compatibility.some((x) => /earlier race rules/.test(x.text))).toBe(true);
  });
});

describe('a link cut short', () => {
  it('reads as damaged or incomplete, and the card offers the replay file instead', async () => {
    const url = challengeUrl('https://example.org/SailSim/', await encodeChallenge(ch()));
    const payload = challengePayload(new URL(url).hash)!;
    const cut = payload.slice(0, Math.floor(payload.length * 0.6));
    await expect(decodeChallenge(cut)).rejects.toThrow(/damaged or incomplete \(was it cut short\?\)/);
    expect(CHALLENGE_RECOVERY).toMatch(/replay file/);
    expect(CHALLENGE_RECOVERY).toMatch(/Race a ghost from a replay file/);
  });

  it('the social hub shows the preview with an invite, and the error with a broken one', async () => {
    const c = new SimController();
    const url = challengeUrl('https://example.org/SailSim/', await encodeChallenge(ch()));
    await c.social.openLink(new URL(url).hash);
    expect(c.getState().social.invite?.preview.setup.length).toBeGreaterThan(3);
    await c.social.openLink(new URL(url).hash.slice(0, 60));
    expect(c.getState().social.error).toBeDefined();
  });
});
