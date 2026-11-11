/** Sharing a run as a link (src/app/shareLink.ts): the replay inside the fragment, compressed, read back exactly. */
import { describe, expect, it } from 'vitest';
import { SHARE_PREFIX, decodeShare, encodeShare, sharedPayload, shareUrl } from '../../src/app/shareLink';
import { REPLAY_SCHEMA, type Recording } from '../../src/app/replay';
import { DEFAULT_SCENARIO } from '../../src/app/controller';

const rec = (rows: number): Recording => ({
  schema: REPLAY_SCHEMA,
  created: '2026-11-10T12:00:00.000Z',
  title: 'Today’s challenge (2026-11-10) — Ann’s run',
  build: 'test',
  scenario: DEFAULT_SCENARIO,
  initialInput: null,
  dart: 'loaded',
  inputs: Array.from({ length: rows }, (_, i) => [i, Math.sin(i / 50) * 0.7, 0.23, 0.46, 0.6, 6, 0] as Recording['inputs'][number]),
  checkpoints: [[1000, 'abcdef0123456789']],
  endStep: rows,
});

describe('a run shared as a link', () => {
  it('round-trips exactly, every input to the last bit', async () => {
    const r = rec(3000);
    const payload = await encodeShare(r);
    expect(payload.startsWith(SHARE_PREFIX)).toBe(true);
    expect(payload).toMatch(/^r1\.[A-Za-z0-9_-]+$/);
    expect(await decodeShare(payload)).toEqual(r);
    // Compressed, even with every input changing (a real run's steering ramps compress further: about a tenth).
    expect(payload.length).toBeLessThan(JSON.stringify(r).length / 2);
  });

  it('lives after the # of this page, and is found there again', async () => {
    const payload = await encodeShare(rec(10));
    const url = shareUrl('https://example.org/squib/?nowelcome#old', payload);
    expect(url).toBe(`https://example.org/squib/?nowelcome#ghost=${payload}`);
    expect(sharedPayload(new URL(url).hash)).toBe(payload);
    expect(sharedPayload('#other=1')).toBeUndefined();
  });

  it('a damaged or cut link says so', async () => {
    const payload = await encodeShare(rec(500));
    await expect(decodeShare(payload.slice(0, payload.length / 2))).rejects.toThrow(/damaged or incomplete/);
    await expect(decodeShare('x9.abc')).rejects.toThrow(/not a shared run/);
  });
});
