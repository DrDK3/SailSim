/**
 * Saving to this browser's storage, with an honest status (design handover, 23 Nov 2026, item 1: "Show actionable
 * feedback when persistent saving fails"). Every write of progress a player values goes through `persist`: on
 * failure the status says whether storage is full (the browser's limit for this site, about 5 MB) or blocked (a
 * private window, or site data turned off), and what could not be kept, so the app can say so instead of failing
 * silently. Reading is unchanged: existing records stay readable whatever happens to a later write.
 */

export type StorageState = 'ok' | 'full' | 'blocked';

export interface StorageStatus {
  state: StorageState;
  /** What was not kept, in words ("your best times", "lesson progress"), when the last write failed. */
  what?: string;
  /** When the last failure happened (ISO), for the notice. */
  at?: string;
}

let status: StorageStatus = { state: 'ok' };
const listeners = new Set<(s: StorageStatus) => void>();

/** The current saving status (ok until a write fails; back to ok once a write succeeds). */
export function storageStatus(): StorageStatus {
  return status;
}

/** Be told when the status changes (the controller publishes it to the interface). */
export function onStorageStatus(f: (s: StorageStatus) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

function set(next: StorageStatus): void {
  if (next.state === status.state && next.what === status.what) return;
  status = next;
  for (const f of listeners) f(status);
}

/** Tests: start from a clean status. */
export function resetStorageStatus(): void {
  status = { state: 'ok' };
}

/** Full (the quota) rather than blocked: the names and codes browsers use for a quota error. */
function isQuota(e: unknown): boolean {
  const x = e as { name?: string; code?: number } | undefined;
  return !!x && (x.name === 'QuotaExceededError' || x.name === 'NS_ERROR_DOM_QUOTA_REACHED' || x.code === 22 || x.code === 1014);
}

/**
 * Keep `text` under `key`; true if it was kept. `what` names it for the player ("your best times"). A failure sets
 * the status (full or blocked); a success after a failure clears it.
 */
export function persist(key: string, text: string, what: string): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      set({ state: 'blocked', what, at: new Date().toISOString() });
      return false;
    }
    localStorage.setItem(key, text);
    if (status.state !== 'ok') set({ state: 'ok' });
    return true;
  } catch (e) {
    set({ state: isQuota(e) ? 'full' : 'blocked', what, at: new Date().toISOString() });
    return false;
  }
}

/** The notice's words for a status (none when saving works). */
export function storageNotice(s: StorageStatus): { title: string; detail: string } | undefined {
  if (s.state === 'ok') return undefined;
  const what = s.what ? ` (${s.what})` : '';
  if (s.state === 'full')
    return {
      title: `This browser's storage for the simulator is full: progress is not being saved${what}.`,
      detail: 'Your sailing carries on. To make room, delete saved scenarios, courses or replays you no longer need (Scenarios and replays), or clear older site data in the browser’s settings.',
    };
  return {
    title: `This browser is not letting the simulator save${what}.`,
    detail: 'Your sailing carries on, but progress made now is lost when the page closes. A private window or blocked site data does this; use a normal window to keep your progress.',
  };
}
