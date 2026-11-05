import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { SimController, UiState } from '../app/controller';
import { deg, pct } from './format';
import { sailAdvice, sailState } from '../app/sailStatus';
import { helmAction, type SteeringMode } from '../app/steering';

/**
 * The tiller from above (review UX-8): the after end of the cockpit, the rudder blade and the tiller, at the
 * simulation's rudder angle. The bow turns the way the blade's trailing edge points, so the tiller always lies
 * the other way: push the tiller to port and the bow goes to starboard. Drawn in both steering modes.
 */
export function TillerView({ rudder, mode }: { rudder: number; mode: SteeringMode }) {
  const d = (Math.abs(rudder) * 180) / Math.PI;
  const centred = d < 0.5;
  const bow = rudder > 0 ? 'starboard' : 'port';
  const tiller = rudder > 0 ? 'port' : 'starboard';
  // The picture exaggerates the angle a little so that small helm movements show.
  const a = Math.max(-1.2, Math.min(1.2, rudder * 1.5));
  const stock = { x: 0, y: 30 };
  const tip = { x: -Math.sin(a) * 25, y: stock.y - Math.cos(a) * 25 };
  const blade = { x: Math.sin(a) * 9, y: stock.y + Math.cos(a) * 9 };
  const text = centred ? 'Tiller centred' : `Tiller ${Math.round(d)}° to ${tiller} · bow turning to ${bow}`;
  return (
    <div className="rudder-bar tiller-view" title={`${text}. ${mode === 'tiller' ? 'Steering like a tiller: A / ← push it to port, D / → to starboard.' : 'Steering by the bow: A / ← turn the bow to port, D / → to starboard; the tiller goes the other way.'} (More → Graphics and sound to change)`} data-testid="tiller">
      <svg viewBox="-34 -2 68 44" width="58" height="38" aria-hidden="true" className="tiller-svg">
        <path className="tv-hull" d="M -30 -2 L -27 28 Q -24 36 -16 37 L 16 37 Q 24 36 27 28 L 30 -2" />
        <line className="tv-blade" x1={stock.x} y1={stock.y} x2={blade.x} y2={blade.y} />
        <line className="tv-tiller" x1={stock.x} y1={stock.y} x2={tip.x} y2={tip.y} />
        <circle className="tv-stock" cx={stock.x} cy={stock.y} r="2.2" />
      </svg>
      <span>{text}</span>
    </div>
  );
}

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
      {/* The sheet: ease and trim either side of a meter of how far it is eased. */}
      <div className="sail-sheet">
        <Hold ctl={ctl} action={sail === 'main' ? 'mainOut' : 'jibOut'} label={`Ease ${sail} (${keys.ease})`}>Ease <Key k={keys.ease} /></Hold>
        <div
          className="sheet-bar sheet-meter"
          role="meter"
          aria-label={`${sail === 'main' ? 'Main' : 'Jib'} sheet eased`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(sheet * 100)}
          title={`Sheet eased ${pct(sheet)}`}
          data-testid={`${sail}-sheet`}
        >
          <div className="sheet-fill" style={{ width: pct(sheet) }} />
          <span className="sheet-value">
            {pct(sheet)}
            <span className="sheet-word"> eased</span>
          </span>
        </div>
        <Hold ctl={ctl} action={sail === 'main' ? 'mainIn' : 'jibIn'} label={`Trim ${sail} (${keys.trim})`}>Trim <Key k={keys.trim} /></Hold>
      </div>
      {/* The assist and how the sail is working, in words. */}
      <div className="sail-assist">
        <label className="toggle" title={`Auto-trim assist (${sail === 'main' ? 'M' : 'J'})`}>
          <input type="checkbox" checked={auto} onChange={(e) => ctl.setInput(sail === 'main' ? { autoMain: e.target.checked } : { autoJib: e.target.checked })} />
          Auto-trim
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
    </div>
  );
}

export function Controls({ ctl, ui, onHide }: { ctl: SimController; ui: UiState; onHide?: () => void }) {
  const s = ui.snapshot;
  const tillerMode = ui.steering === 'tiller';
  // At the Learn level the dock leaves out its advanced controls (src/app/level.ts); the keys still work.
  const advanced = ui.level !== 'learn';
  return (
    <section className="panel controls dock" aria-label="Sailing controls">
      <div className="controls-sails" role="group" aria-label="Sails">
        <SailRow ctl={ctl} ui={ui} sail="main" />
        <SailRow ctl={ctl} ui={ui} sail="jib" />
      </div>
      <div className="controls-boat" role="group" aria-label="Helm and crew">
        <div className="helm-row" data-tutorial="helm">
          <Hold ctl={ctl} action={helmAction('left', ui.steering)} label={tillerMode ? 'Tiller to port, bow to starboard (A / ←)' : 'Steer to port (A / ←)'}>◀ <Key k="A" /></Hold>
          <TillerView rudder={s.rudder} mode={ui.steering} />
          <Hold ctl={ctl} action={helmAction('right', ui.steering)} label={tillerMode ? 'Tiller to starboard, bow to port (D / →)' : 'Steer to starboard (D / →)'}><Key k="D" /> ▶</Hold>
          <button onClick={() => ctl.centreHelm()} title="Centre the helm (Space)">Centre</button>
        </div>
        <div className="misc-row">
          <button onClick={() => ctl.releaseSheets()} title="Let both sheets fly: the sails luff and stop driving. To stop the boat, also turn head to wind (X)" data-tutorial="release">Release sheets <Key k="X" /></button>
          <label className="toggle" title="Crew move to keep the boat upright (K)" data-tutorial="crew">
            <input type="checkbox" checked={s.input.autoCrew} onChange={(e) => ctl.setInput({ autoCrew: e.target.checked })} />
            Auto crew
          </label>
          {advanced && !s.input.autoCrew && (
            <label className="slider" title="Crew weight out to windward">
              Hike
              <input type="range" min={0} max={1} step={0.05} value={s.input.crewHike} onChange={(e) => ctl.setInput({ crewHike: Number(e.target.value) })} />
            </label>
          )}
          {advanced && (
            <label className="slider" title="Flatten the sails to depower in a breeze: cunningham, outhaul and kicker on, leech twisted open. Less heel and weather helm, less power (Z flatter, Shift+Z fuller)" data-tutorial="flatten">
              Flatten <Key k="Z" />
              <input type="range" min={0} max={1} step={0.05} value={s.input.flatten ?? 0} aria-valuetext={pct(s.input.flatten ?? 0)} onChange={(e) => ctl.setInput({ flatten: Number(e.target.value) })} />
              <span className="slider-value">{pct(s.input.flatten ?? 0)}</span>
            </label>
          )}
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
