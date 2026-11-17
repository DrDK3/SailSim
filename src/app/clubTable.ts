/// <reference types="vite/client" />
/**
 * The club table (juniors round §6.4, layer B), behind the `clubTable` feature flag: on only when the site was built
 * with VITE_CLUB_TABLE_URL (the owner's endpoint, server/club-table/worker.js). Off, or with the endpoint unreachable,
 * nothing breaks and, while off, no request is made to it at all.
 *
 * Submitting is opt-in per run, after a finish on the weekly course, with a plain explanation of what is sent:
 * the replay (inputs and scenario, with the claimed finish), the word-list name, the build, the browser engine family
 * and a random deletion token that stays on this device (to remove the entry later, or to read the verdict).
 * Nothing else. The table itself is a static file on the site (club/weekly-<week>.json), written by a scheduled Action.
 */
import type { Recording } from './replay';
import { engineOf } from './deviceCheck';

export const CLUB_TABLE_SCHEMA = 'squib-club-table/1';

export interface TableEntry {
  name: string;
  timeS: number;
  category: 'independent' | 'assisted';
  /** yyyy-mm-dd (the day it was received). */
  date: string;
}

export interface ClubTableFile {
  schema: typeof CLUB_TABLE_SCHEMA;
  week: string;
  generated: string;
  /** Verified runs, fastest first. */
  entries: TableEntry[];
  /** Recorded on another browser engine and not verified to the tolerance: listed apart, not ranked. */
  otherEngine: TableEntry[];
  /** Input timing that looked scripted: listed apart (a low-stakes table, not anti-cheat). */
  flagged: TableEntry[];
  /** The week's top three verified runs as ghosts (replay files next to the table). */
  ghosts: { rank: number; name: string; file: string }[];
  note: string;
}

/** The flag: the endpoint's address when the owner has configured one at build time, else undefined. */
export function clubTableUrl(): string | undefined {
  const u = (import.meta.env?.VITE_CLUB_TABLE_URL as string | undefined)?.trim();
  return u ? u.replace(/\/+$/, '') : undefined;
}

export function turnstileSiteKey(): string | undefined {
  return (import.meta.env?.VITE_TURNSTILE_SITEKEY as string | undefined)?.trim() || undefined;
}

/** A random deletion token (32 random bytes as hex). */
export function newToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** The replay as sent: its JSON compressed (deflate-raw): tens of kB for a 10-minute run sailed with the keys. */
export async function compressReplay(rec: Recording): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(rec));
  const stream = new Blob([json as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Exactly what is sent, and nothing else: the compressed replay as the body; the word-list name, the build, the engine
 * family and the deletion token as four headers.
 */
export async function submissionRequest(rec: Recording, name: string, build: string, token: string, ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  return {
    headers: { 'content-type': 'application/octet-stream', 'x-squib-name': name, 'x-squib-build': build, 'x-squib-engine': engineOf(ua), 'x-squib-token': token },
    body: await compressReplay(rec),
  };
}

/** The runs submitted from this device: week, time, token (to remove or to ask the verdict). Kept in this browser only. */
export interface MySubmission {
  week: string;
  timeS: number;
  token: string;
  status: string;
  reason?: string;
  removed?: boolean;
}

const KEY = 'squib.clubSubmissions.v1';

export function loadMine(): MySubmission[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as MySubmission[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveMine(list: MySubmission[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-50)));
  } catch {
    // storage unavailable: the token lasts for this visit
  }
}

export function parseTable(json: unknown): ClubTableFile | undefined {
  const t = json as Partial<ClubTableFile>;
  if (!t || t.schema !== CLUB_TABLE_SCHEMA || !Array.isArray(t.entries)) return undefined;
  return t as ClubTableFile;
}

/** What the verifier's reason codes mean, for the submitter. */
export const REASONS: Record<string, string> = {
  'built-by-another-version': 'it was sailed on a version of SailSim the checker no longer keeps',
  'name-not-on-word-list': 'the name was not a word-list name',
  'not-a-replay': 'the run could not be read',
  'no-claimed-result': 'the run did not say its finish time',
  'not-this-weeks-course': 'it was not this week’s course',
  'not-the-weekly-course': 'it was not the weekly course',
  'conditions-changed': 'the conditions were not the week’s',
  'boat-changed': 'the boat was not the week’s',
  'race-set-up-changed': 'the race set-up was not the week’s',
  'course-changed': 'the course was not the week’s',
  'assists-not-as-claimed': 'it was marked as sailed on your own but auto-trim was used',
  'replay-would-not-start': 'the run could not be sailed again',
  'recomputed-within-tolerance': 'checked by sailing it again (the time shown is the checker’s)',
  'did-not-finish': 'sailing it again did not reach the finish',
  'time-not-as-claimed': 'sailing it again gave a different time',
  'other-engine-time-differs': 'recorded on another browser engine and not verified (listed separately)',
  'other-engine-did-not-finish-when-re-sailed': 'recorded on another browser engine and not verified (listed separately)',
};
