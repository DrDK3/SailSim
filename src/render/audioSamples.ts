/**
 * Recorded sounds, optional (review, 10 Nov 2026): the owner's own recordings, or freely licensed ones, put in
 * public/audio/ and listed in public/audio/manifest.json, take the place of the synthesised sound of the same kind;
 * anything not listed is still made in the browser (audio.ts). None ship with the simulator: the manifest is empty
 * until recordings with a known source and licence are added (docs/SOUND.md).
 *
 * Every entry must say where the recording came from and under what licence, and its files must be plain names in
 * that folder: nothing is fetched from anywhere else.
 */

export const SAMPLE_KINDS = ['wind', 'water', 'flutter', 'halyard', 'horn', 'horn-long', 'whistle', 'whistle-long', 'boom', 'knock'] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

/** Loops that follow the boat continuously (the rest are played once per event). */
export const LOOPED: readonly SampleKind[] = ['wind', 'water', 'flutter'];

export interface SampleEntry {
  /** One or more files in public/audio/ (one is picked at random each time, for variety). */
  files: string[];
  /** Level relative to the synthesised sound it replaces (0 … 2, default 1). */
  gain: number;
  /** Who recorded it, where and when (or the library and its page). */
  source: string;
  /** The licence it may be used under (e.g. "owner's own recording", "CC0 1.0"). */
  licence: string;
}

export type SampleManifest = Partial<Record<SampleKind, SampleEntry>>;

const FILE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(ogg|oga|mp3|wav|m4a|aac|webm|flac|opus)$/;

/** Read the manifest, keeping only valid entries; the problems say what was left out and why. */
export function parseManifest(raw: unknown): { samples: SampleManifest; problems: string[] } {
  const samples: SampleManifest = {};
  const problems: string[] = [];
  const list = raw && typeof raw === 'object' ? (raw as { samples?: unknown }).samples : undefined;
  if (!list || typeof list !== 'object') return { samples, problems: raw === undefined ? [] : ['no "samples" object'] };
  for (const [kind, v] of Object.entries(list as Record<string, unknown>)) {
    if (!(SAMPLE_KINDS as readonly string[]).includes(kind)) {
      problems.push(`${kind}: not a sound the simulator plays`);
      continue;
    }
    const e = v as Partial<Record<keyof SampleEntry, unknown>> | null;
    const files = Array.isArray(e?.files) ? e.files.filter((f): f is string => typeof f === 'string') : typeof (e as { file?: unknown })?.file === 'string' ? [(e as { file: string }).file] : [];
    const bad = files.filter((f) => !FILE.test(f));
    if (!files.length || bad.length) {
      problems.push(`${kind}: ${files.length ? `not a plain audio file name in public/audio: ${bad.join(', ')}` : 'no files'}`);
      continue;
    }
    if (typeof e?.source !== 'string' || !e.source.trim() || typeof e?.licence !== 'string' || !e.licence.trim()) {
      problems.push(`${kind}: say where the recording came from ("source") and its licence ("licence")`);
      continue;
    }
    const gain = typeof e.gain === 'number' && Number.isFinite(e.gain) ? Math.min(2, Math.max(0, e.gain)) : 1;
    samples[kind as SampleKind] = { files, gain, source: e.source.trim(), licence: e.licence.trim() };
  }
  return { samples, problems };
}

/** One of an entry's files, picked with `rand` (0 … 1). */
export function pickFile(e: SampleEntry, rand: number): string {
  return e.files[Math.min(e.files.length - 1, Math.floor(rand * e.files.length))]!;
}
