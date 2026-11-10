import { parseRecording, type Recording } from './replay';

/**
 * "Continue where you left off" (red team, 10 Nov 2026): the run so far is kept in this browser as a replay recording
 * (src/app/replay.ts), at most once a minute and when the page is hidden or closed. On the next visit it is sailed
 * again, quickly and step by step, to where it was left, and the player carries on from there. Nothing leaves the
 * device. Kept only for free sailing and races (lessons are short), and only after the first 30 s.
 */

export interface ResumePoint {
  rec: Recording;
  /** What it was, as the card says it: "Race: Start Bay short course", "Free sailing from off the club". */
  label: string;
  savedAt: string;
}

const KEY = 'squib.resume.v1';
/** Larger than this (a very long session) is not kept: browser storage is small (about 5 MB a site). */
export const RESUME_MAX_BYTES = 2_500_000;
/** Too short to be worth offering (s). */
export const RESUME_MIN_S = 30;

export function saveResume(p: ResumePoint): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const text = JSON.stringify(p);
    if (text.length > RESUME_MAX_BYTES) return false;
    localStorage.setItem(KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function loadResume(): ResumePoint | undefined {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return undefined;
    const p = JSON.parse(raw) as Partial<ResumePoint>;
    if (typeof p.label !== 'string' || typeof p.savedAt !== 'string') return undefined;
    return { rec: parseRecording(p.rec), label: p.label, savedAt: p.savedAt };
  } catch {
    return undefined;
  }
}

export function clearResume(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** "12 min in · saved 3 h ago" */
export function resumeSummary(p: ResumePoint, now: Date, stepS: number): string {
  const inS = p.rec.endStep * stepS;
  const ago = Math.max(0, (now.getTime() - Date.parse(p.savedAt)) / 1000);
  const span = (s: number) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`);
  return `${span(inS)} in · saved ${ago < 60 ? 'just now' : `${span(ago)} ago`}`;
}
