import { useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import {
  builtInScenarios,
  deleteUserScenario,
  fileSlug,
  parseScenarioFile,
  saveUserScenario,
  scenarioFile,
  startLabel,
  userScenarios,
  type LibraryScenario,
} from '../app/scenarioLibrary';
import { CHECKPOINT_STEPS } from '../app/replay';
import { DT } from '../sim/simulation';

function download(name: string, json: unknown): void {
  const blob = new Blob([JSON.stringify(json)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function minutes(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Scenario library (built-in and saved scenarios, import and export) and replays (save and open). */
export function LibraryPanel({ ctl, ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  const [user, setUser] = useState(() => userScenarios());
  const [title, setTitle] = useState('My scenario');
  const [replayTitle, setReplayTitle] = useState('Squib session');
  const [message, setMessage] = useState<string>();
  const builtIn = builtInScenarios(ui.weatherSources, ui.dart.status === 'loaded');

  const load = (s: LibraryScenario) => {
    const sc = s.scenario;
    if (!sc) return;
    ctl.leaveTo(`Loading “${s.title}”`, () => {
      if (ctl.startSession(sc)) setMessage(`Started "${s.title}".`);
      else setMessage(`Could not start "${s.title}": ${ctl.getState().scenarioError ?? 'invalid settings'}`);
    });
  };
  const save = () => {
    const ok = saveUserScenario(scenarioFile(title.trim() || 'My scenario', ui.scenario));
    setUser(userScenarios());
    setMessage(ok ? `Saved "${title.trim() || 'My scenario'}" in this browser.` : 'Not saved: browser storage is unavailable or full. Export the file instead.');
  };
  const importScenario = async (file: File) => {
    try {
      const f = parseScenarioFile(JSON.parse(await file.text()));
      setTitle(f.title);
      ctl.leaveTo(`Importing “${f.title}”`, () => {
        if (ctl.startSession(f.scenario)) setMessage(`Imported and started "${f.title}". Save it to keep it in this browser.`);
        else setMessage(`Imported "${f.title}" but could not start it: ${ctl.getState().scenarioError ?? 'invalid settings'}`);
      });
    } catch (err) {
      setMessage(`Not imported: ${(err as Error).message}`);
    }
  };
  const saveReplay = () => {
    const t = replayTitle.trim() || 'Squib session';
    const rec = ctl.saveRecording(t);
    download(`${fileSlug(t)}.replay.json`, rec);
    setMessage(`Saved a replay of ${minutes(rec.endStep * DT)} (${rec.inputs.length} input changes, ${rec.checkpoints.length} checkpoints).`);
  };
  const openReplay = async (file: File) => {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      setMessage('Not a replay: the file is not JSON.');
      return;
    }
    ctl.leaveTo('Opening a replay', () => {
      if (ctl.startReplay(json)) {
        setMessage('Playing the replay: see the bar at the bottom.');
        onClose();
      } else setMessage(`Cannot play it: ${ctl.getState().scenarioError ?? 'invalid replay'}`);
    });
  };

  const row = (s: LibraryScenario) => (
    <li key={s.id} className="lib-row">
      <div className="lib-text">
        <strong>{s.title}</strong>
        <span className="fine">{s.description}{s.scenario ? ` Start: ${startLabel(s.scenario.startLocation)}.` : ''}</span>
        {s.unavailable && <span className="fine warn-text">{s.unavailable}</span>}
      </div>
      <div className="lib-actions">
        <button onClick={() => load(s)} disabled={!s.scenario} aria-label={`Load ${s.title}`}>Load</button>
        {s.group === 'user' && (
          <>
            <button onClick={() => download(`${fileSlug(s.title)}.scenario.json`, scenarioFile(s.title, s.scenario!, s.description || undefined))} aria-label={`Export ${s.title}`}>Export</button>
            <button
              onClick={() => {
                deleteUserScenario(s.title);
                setUser(userScenarios());
              }}
              aria-label={`Delete ${s.title}`}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );

  return (
    <section className="panel library" aria-label="Library">
      <div className="race-head">
        <h3>Library</h3>
        <button onClick={onClose} aria-label="Close library">Close</button>
      </div>
      <h4>Scenarios</h4>
      <ul className="lib-list" data-testid="scenario-list">
        {builtIn.map(row)}
        {user.map(row)}
      </ul>
      <p className="fine">Built-in scenarios are practice set-ups: their wind, tide and sky are chosen, not recorded, except the Met Office replay.</p>
      <div className="row left wrap">
        <input aria-label="Scenario title" value={title} onChange={(e) => setTitle(e.target.value)} className="lib-input" />
        <button onClick={save}>Save current</button>
        <button onClick={() => download(`${fileSlug(title)}.scenario.json`, scenarioFile(title.trim() || 'My scenario', ui.scenario))}>Export current</button>
        <label className="file-btn">
          Import…
          <input type="file" accept=".json,application/json" aria-label="Import scenario file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importScenario(f); e.target.value = ''; }} />
        </label>
      </div>
      <p className="fine">Saved scenarios stay in this browser only; export them to keep or share them.</p>

      <h4>Replays</h4>
      <p className="fine">
        A replay holds the scenario, your control inputs and a check of the boat states every {CHECKPOINT_STEPS * DT} s. Playing it back runs the
        same physics again and confirms it matches, step for step. AI boats are reproduced from the scenario's seed.
      </p>
      <div className="row left wrap">
        <input aria-label="Replay title" value={replayTitle} onChange={(e) => setReplayTitle(e.target.value)} className="lib-input" />
        <button onClick={saveReplay} data-testid="save-replay">Save replay of this run</button>
        <label className="file-btn">
          Open replay…
          <input type="file" accept=".json,application/json" aria-label="Open replay file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void openReplay(f); e.target.value = ''; }} />
        </label>
      </div>
      {message && <p className="fine" role="status" data-testid="library-message">{message}</p>}
    </section>
  );
}
