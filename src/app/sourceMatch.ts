/**
 * Which weather or tide file (src/app/controller.ts DataSource) a scenario's conditions use. The Options panel
 * (src/ui/ScenarioPanel.tsx) edits a deep copy of the scenario, so its snapshot is a copy of the file's contents:
 * found by the same object when it is the same, else by the same contents (issue 198: by identity alone the copy
 * never matched, and Options showed "Manual" while the instruments showed the Met Office replay).
 */
const serialised = new WeakMap<object, string>();

function contents(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? '';
  let s = serialised.get(x);
  if (s === undefined) {
    s = JSON.stringify(x);
    serialised.set(x, s);
  }
  return s;
}

export function matchDataSource<T extends { id: string; json: unknown }>(sources: readonly T[], snapshot: unknown): T | undefined {
  if (snapshot === undefined || snapshot === null) return undefined;
  const same = sources.find((s) => s.json === snapshot);
  if (same) return same;
  const want = contents(snapshot);
  return sources.find((s) => contents(s.json) === want);
}
