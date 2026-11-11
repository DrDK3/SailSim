/**
 * Race a friend without a server (review, 10 Nov 2026): a run is shared as a link with the whole replay inside it,
 * compressed, after the `#` (the fragment, which the browser never sends to the web server). Whoever opens the link
 * races that run as a ghost, in their own browser, in the same scenario (today's challenge included, since the
 * replay carries its scenario). Nothing is uploaded and nothing is stored anywhere but in the link itself.
 *
 * Live play against others, shared leaderboards and accounts would need a server, storage and a privacy notice:
 * a decision for the owner, costed in docs/DEPLOYMENT.md.
 *
 * Format: `#ghost=r1.` + base64url(deflate-raw(JSON of the replay)). The replay is checked as any replay file is
 * (src/app/replay.ts) when it is opened.
 */
import { parseRecording, type Recording } from './replay';

export const SHARE_PREFIX = 'r1.';
export const SHARE_PARAM = 'ghost';
/** Longer links than this are not offered (characters): send the replay file instead. */
export const SHARE_MAX_CHARS = 150_000;
/** Links longer than this may be cut short by some messaging apps (characters, E). */
export const SHARE_LONG_CHARS = 8_000;

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(t as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The fragment payload for a replay (without the `#ghost=`). */
export async function encodeShare(rec: Recording): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(rec));
  return SHARE_PREFIX + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** The replay in a payload; throws with a reason a person can read. */
export async function decodeShare(payload: string): Promise<Recording> {
  if (!payload.startsWith(SHARE_PREFIX)) throw new Error('This link is not a shared run this version can read.');
  let json: unknown;
  try {
    const bytes = await pipe(fromBase64Url(payload.slice(SHARE_PREFIX.length)), new DecompressionStream('deflate-raw'));
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The shared run in this link is damaged or incomplete (was the link cut short?).');
  }
  return parseRecording(json);
}

/** The whole link: this page's address with the run after the `#`. */
export function shareUrl(page: string, payload: string): string {
  return `${page.split('#')[0]}#${SHARE_PARAM}=${payload}`;
}

/** The payload in a page's fragment (`#ghost=…`), if any. */
export function sharedPayload(hash: string): string | undefined {
  const m = /(?:^#|&)ghost=([A-Za-z0-9._-]+)/.exec(hash);
  return m?.[1];
}
