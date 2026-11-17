import { useEffect, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { BUILD_ID } from '../app/controller';
import { REASONS, clubTableUrl, loadMine, newToken, parseTable, saveMine, submissionRequest, turnstileSiteKey, type ClubTableFile, type MySubmission } from '../app/clubTable';
import { clockS } from './Social';

/**
 * The club table (layer B), shown only when the site was built with the owner's endpoint (the `clubTable` flag).
 * With the flag off these render nothing and make no request. The table itself is a static file on the site; only
 * submitting, removing and asking a verdict talk to the endpoint, and only when the player presses the button.
 */
export function ClubTableSection({ ui }: { ctl: SimController; ui: UiState }) {
  const url = clubTableUrl();
  const week = ui.social.weekly.week;
  const [table, setTable] = useState<ClubTableFile | null | undefined>();
  useEffect(() => {
    if (!url) return;
    let live = true;
    fetch(`club/weekly-${week}.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setTable(j ? parseTable(j) ?? null : null))
      .catch(() => live && setTable(null));
    return () => {
      live = false;
    };
  }, [url, week]);
  if (!url) return null;
  if (table === undefined) return <p className="fine">Looking for the club table…</p>;
  if (table === null) return <p className="fine" data-testid="club-table-none">The club table for this week is not available yet.</p>;
  const best = table.entries[0];
  const age = Math.max(0, Math.round((Date.now() - Date.parse(table.generated)) / 60000));
  return (
    <div className="club-table" data-testid="club-table">
      <p className="fine">
        <strong>Beat the club:</strong> {best ? `${clockS(best.timeS)} by ${best.name} (${best.category === 'independent' ? 'on their own' : 'with assists'})` : 'no verified times yet this week'}
        {' '}· the model-sailed targets are stepping stones · updated {age} minute{age === 1 ? '' : 's'} ago
      </p>
      {table.entries.length > 0 && (
        <table className="splits">
          <thead>
            <tr><th>#</th><th>Name</th><th>Time</th><th>How</th></tr>
          </thead>
          <tbody>
            {table.entries.slice(0, 10).map((e, i) => (
              <tr key={`${e.name}${e.timeS}`}>
                <td>{i + 1}</td>
                <td>{e.name}</td>
                <td>{clockS(e.timeS)}</td>
                <td>{e.category === 'independent' ? 'on their own' : 'with assists'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {table.otherEngine.length > 0 && <p className="fine">Recorded on another browser engine, not verified: {table.otherEngine.map((e) => `${e.name} ${clockS(e.timeS)}`).join(', ')}.</p>}
      {table.flagged.length > 0 && <p className="fine">Listed apart (input timing that looked scripted): {table.flagged.map((e) => `${e.name} ${clockS(e.timeS)}`).join(', ')}.</p>}
      <MySubmissions />
    </div>
  );
}

/** This device's submissions: ask the verdict, or remove the entry (the deletion token never leaves except for that). */
function MySubmissions() {
  const url = clubTableUrl()!;
  const [mine, setMine] = useState<MySubmission[]>(() => loadMine());
  if (!mine.length) return null;
  const update = (i: number, change: Partial<MySubmission>) => {
    const next = mine.map((m, k) => (k === i ? { ...m, ...change } : m));
    setMine(next);
    saveMine(next);
  };
  return (
    <ul className="fine" data-testid="club-mine">
      {mine.map((m, i) => (
        <li key={m.token}>
          {m.week} · {clockS(m.timeS)} · {m.removed ? 'removal asked for' : m.status}
          {m.reason ? ` (${REASONS[m.reason] ?? m.reason})` : ''}{' '}
          <button className="link" onClick={() => void fetch(`${url}/status?token=${m.token}`).then((r) => r.json()).then((j: { status: string; reason?: string }) => update(i, { status: j.status, reason: j.reason })).catch(() => update(i, { status: 'could not reach the club table' }))}>
            Check
          </button>{' '}
          {!m.removed && (
            <button className="link" data-testid="club-remove" onClick={() => void fetch(`${url}/remove`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: m.token }) }).then((r) => r.ok && update(i, { removed: true })).catch(() => update(i, { status: 'could not reach the club table' }))}>
              Remove my entry
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** After a finish on the weekly course: the opt-in submit, with what is sent and how to remove it. */
export function ClubSubmit({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const url = clubTableUrl();
  const f = ui.social.finish;
  const [state, setState] = useState<string>();
  if (!url || !f || !f.key.startsWith('weekly:')) return null;
  const submit = async () => {
    setState('Sending…');
    try {
      const token = newToken();
      const rec = { ...ctl.saveRecording(`${ui.social.name}: ${f.label}`), claimed: { finishS: f.timeS, independent: f.assist.independent } };
      const req = await submissionRequest(rec, ui.social.name, BUILD_ID, token);
      const headers: Record<string, string> = { ...req.headers };
      const bot = await turnstileToken();
      if (bot) headers['cf-turnstile-response'] = bot;
      const r = await fetch(`${url}/submit`, { method: 'POST', headers, body: req.body as BodyInit });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) return setState(`Not sent: ${j.error ?? r.status}.`);
      saveMine([...loadMine(), { week: f.key.slice(7), timeS: f.timeS, token, status: 'waiting to be checked' }]);
      setState('Sent. It is checked automatically within the hour; you can see the result, or remove your entry, from the course card.');
    } catch {
      setState('The club table could not be reached. Nothing was sent; you can try again later.');
    }
  };
  return (
    <div className="club-submit" data-testid="club-submit">
      <p className="fine">
        <strong>Submit to the club table?</strong> This sends your run (the course, the wind and your control inputs), your word-list name ({ui.social.name}),
        which version of SailSim and which kind of browser you used, and a random code kept on this device so you can remove the entry later. Nothing
        else: no real name, no account, no location. The run is checked by the simulator, then deleted unless it is one of the week’s top three, which
        others can race as ghosts. Tables are removed at the end of the season.
      </p>
      <button onClick={() => void submit()} data-testid="club-submit-button" disabled={!!state && state.startsWith('Sending')}>
        Submit to the club table
      </button>
      {state && <p className="fine" role="status" data-testid="club-submit-state">{state}</p>}
    </div>
  );
}

/**
 * The bot check (Cloudflare Turnstile), when the owner configured a site key: its script is loaded only now, when the
 * player has pressed Submit. Without a site key (the mock, the tests) no check is made here.
 */
async function turnstileToken(): Promise<string | undefined> {
  const key = turnstileSiteKey();
  if (!key) return undefined;
  const w = window as unknown as { turnstile?: { render: (el: HTMLElement, o: object) => void } };
  if (!w.turnstile) {
    await new Promise<void>((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.onload = () => res();
      s.onerror = () => rej(new Error('bot check unavailable'));
      document.head.appendChild(s);
    });
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    return await new Promise<string>((res, rej) => w.turnstile!.render(host, { sitekey: key, callback: res, 'error-callback': () => rej(new Error('bot check failed')) }));
  } finally {
    host.remove();
  }
}
