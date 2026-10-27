import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { SimController, UiState } from '../app/controller';
import { deg, pct } from './format';
import { sailAdvice, sailState } from '../app/sailStatus';

function Hold({ ctl, action, children, label }: { ctl: SimController; action: string; children: ReactNode; label: string }) {
  const on = (e: ReactPointerEvent) => {
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests, assistive tech) have no capturable pointer; holding still works.
    }
    ctl.press(action, true);
  };
  const off = () => ctl.press(action, false);
  return (
    <button className="hold" aria-label={label} title={label} onPointerDown={on} onPointerUp={off} onPointerCancel={off} onPointerLeave={off} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </button>
  );
}

/** A key name shown on a button, for recognition rather than recall. */
const Key = ({ k }: { k: string }) => <kbd className="key-hint" aria-hidden="true">{k}</kbd>;

function SailRow({ ctl, ui, sail }: { ctl: SimController; ui: UiState; sail: 'main' | 'jib' }) {
  const s = ui.snapshot;
  const f = sail === 'main' ? s.forces.main : s.forces.jib;
  const auto = sail === 'main' ? s.input.autoMain : s.input.autoJib;
  const sheet = ctl.sim.currentSheet(sail);
  const angle = sail === 'main' ? s.boomMain : s.boomJib;
  const keys = sail === 'main' ? { trim: 'W', ease: 'S' } : { trim: 'E', ease: 'Q' };
  const st = sailAdvice(sailState(f), keys);
  // The state in a word; the advice and the airflow angle only when the sail needs something done.
  const ok = st.cls === 'good';
  return (
    <div className="sail-row" data-tutorial={sail}>
      <div className="sail-name">{sail === 'main' ? 'Main' : 'Jib'}</div>
      <Hold ctl={ctl} action={sail === 'main' ? 'mainOut' : 'jibOut'} label={`Ease ${sail} (${keys.ease})`}>Ease <Key k={keys.ease} /></Hold>
      <div className="sheet-bar" title={`Sheet eased ${pct(sheet)}`}>
        <div className="sheet-fill" style={{ width: pct(sheet) }} />
        <span>{pct(sheet)} eased</span>
      </div>
      <Hold ctl={ctl} action={sail === 'main' ? 'mainIn' : 'jibIn'} label={`Trim ${sail} (${keys.trim})`}>Trim <Key k={keys.trim} /></Hold>
      <label className="toggle" title={`Auto-trim assist (${sail === 'main' ? 'M' : 'J'})`}>
        <input type="checkbox" checked={auto} onChange={(e) => ctl.setInput(sail === 'main' ? { autoMain: e.target.checked } : { autoJib: e.target.checked })} />
        Auto
      </label>
      <div
        className={`status ${st.cls}`}
        title={`${st.text}: ${st.advice}. Angle of the airflow on the sail (α) ${deg(Math.abs(f.incidence))}°, sail ${deg(Math.abs(angle))}° off the centreline`}
        data-testid={`${sail}-status`}
        role="status"
      >
        <strong>{st.text}</strong>
        {!ok && <span className="advice"> · {st.advice}</span>}
      </div>
    </div>
  );
}

export function Controls({ ctl, ui, onHide }: { ctl: SimController; ui: UiState; onHide?: () => void }) {
  const s = ui.snapshot;
  const rudderPct = (s.rudder / ctl.sim.params.rudder.maxAngle) * 50 + 50;
  return (
    <section className="panel controls" aria-label="Sailing controls">
      <div className="controls-sails">
        <SailRow ctl={ctl} ui={ui} sail="main" />
        <SailRow ctl={ctl} ui={ui} sail="jib" />
      </div>
      <div className="controls-boat">
        <div className="helm-row" data-tutorial="helm">
          <Hold ctl={ctl} action="helmLeft" label="Steer to port (A / ←)">◀ <Key k="A" /></Hold>
          <div className="rudder-bar" title="Rudder angle">
            <div className="rudder-mark" style={{ left: `${rudderPct}%` }} />
            <span>Helm {deg(Math.abs(s.rudder))}° {s.rudder > 0.01 ? 'to stbd' : s.rudder < -0.01 ? 'to port' : ''}</span>
          </div>
          <Hold ctl={ctl} action="helmRight" label="Steer to starboard (D / →)"><Key k="D" /> ▶</Hold>
          <button onClick={() => ctl.centreHelm()} title="Centre the helm (Space)">Centre</button>
        </div>
        <div className="misc-row">
          <button onClick={() => ctl.releaseSheets()} title="Let both sheets fly: the sails luff and stop driving. To stop the boat, also turn head to wind (X)" data-tutorial="release">Release sheets <Key k="X" /></button>
          <label className="toggle" title="Crew move to keep the boat upright (K)" data-tutorial="crew">
            <input type="checkbox" checked={s.input.autoCrew} onChange={(e) => ctl.setInput({ autoCrew: e.target.checked })} />
            Auto crew
          </label>
          {!s.input.autoCrew && (
            <label className="slider" title="Crew weight out to windward">
              Hike
              <input type="range" min={0} max={1} step={0.05} value={s.input.crewHike} onChange={(e) => ctl.setInput({ crewHike: Number(e.target.value) })} />
            </label>
          )}
          <label className="slider" title="Flatten the sails to depower in a breeze: cunningham, outhaul and kicker on, leech twisted open. Less heel and weather helm, less power (Z flatter, Shift+Z fuller)" data-tutorial="flatten">
            Flatten <Key k="Z" />
            <input type="range" min={0} max={1} step={0.05} value={s.input.flatten ?? 0} aria-valuetext={pct(s.input.flatten ?? 0)} onChange={(e) => ctl.setInput({ flatten: Number(e.target.value) })} />
            <span className="slider-value">{pct(s.input.flatten ?? 0)}</span>
          </label>
        </div>
      </div>
      {onHide && (
        <button className="controls-hide" onClick={onHide} title="Put the controls away (the keys still work; More → Sailing controls brings them back)" aria-label="Hide sailing controls">
          <span aria-hidden="true">▾</span>
        </button>
      )}
    </section>
  );
}
