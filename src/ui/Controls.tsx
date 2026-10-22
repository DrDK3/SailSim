import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { SimController, UiState } from '../app/controller';
import { deg, pct } from './format';
import type { SailForce } from '../sim/boat/forces';

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

function sailStatus(f: SailForce): { text: string; cls: string } {
  if (Math.abs(f.incidence) > Math.PI / 2) return { text: 'By the lee', cls: 'warn' };
  if (f.luff < 0.5) return { text: 'Luffing', cls: 'warn' };
  if (f.stall > 0.5) return { text: 'Stalled', cls: 'bad' };
  return { text: 'Drawing', cls: 'good' };
}

function SailRow({ ctl, ui, sail }: { ctl: SimController; ui: UiState; sail: 'main' | 'jib' }) {
  const s = ui.snapshot;
  const f = sail === 'main' ? s.forces.main : s.forces.jib;
  const auto = sail === 'main' ? s.input.autoMain : s.input.autoJib;
  const sheet = ctl.sim.currentSheet(sail);
  const angle = sail === 'main' ? s.boomMain : s.boomJib;
  const st = sailStatus(f);
  const keys = sail === 'main' ? 'W / S' : 'E / Q';
  return (
    <div className="sail-row">
      <div className="sail-name">{sail === 'main' ? 'Main' : 'Jib'}</div>
      <Hold ctl={ctl} action={sail === 'main' ? 'mainIn' : 'jibIn'} label={`Trim ${sail} (${keys.split(' / ')[0]})`}>Trim</Hold>
      <div className="sheet-bar" title={`Sheet eased ${pct(sheet)}`}>
        <div className="sheet-fill" style={{ width: pct(sheet) }} />
        <span>{pct(sheet)} eased</span>
      </div>
      <Hold ctl={ctl} action={sail === 'main' ? 'mainOut' : 'jibOut'} label={`Ease ${sail} (${keys.split(' / ')[1]})`}>Ease</Hold>
      <label className="toggle" title={`Auto-trim assist (${sail === 'main' ? 'M' : 'J'})`}>
        <input type="checkbox" checked={auto} onChange={(e) => ctl.setInput(sail === 'main' ? { autoMain: e.target.checked } : { autoJib: e.target.checked })} />
        Auto
      </label>
      <div className={`status ${st.cls}`} title="Incidence of the airflow on the sail (effective)">
        {st.text} · α {deg(Math.abs(f.incidence))}° · angle {deg(Math.abs(angle))}°
      </div>
    </div>
  );
}

export function Controls({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const s = ui.snapshot;
  const rudderPct = (s.rudder / ctl.sim.params.rudder.maxAngle) * 50 + 50;
  return (
    <section className="panel controls" aria-label="Sailing controls">
      <SailRow ctl={ctl} ui={ui} sail="main" />
      <SailRow ctl={ctl} ui={ui} sail="jib" />
      <div className="helm-row">
        <Hold ctl={ctl} action="helmLeft" label="Steer to port (A / ←)">◀ Port</Hold>
        <div className="rudder-bar" title="Rudder angle">
          <div className="rudder-mark" style={{ left: `${rudderPct}%` }} />
          <span>Helm {deg(Math.abs(s.rudder))}° {s.rudder > 0.01 ? 'to stbd' : s.rudder < -0.01 ? 'to port' : ''}</span>
        </div>
        <Hold ctl={ctl} action="helmRight" label="Steer to starboard (D / →)">Stbd ▶</Hold>
        <button onClick={() => ctl.centreHelm()} title="Centre the helm (Space)">Centre</button>
      </div>
      <div className="misc-row">
        <button onClick={() => ctl.releaseSheets()} title="Let both sheets fly: the sails luff and the boat slows (X)">Release sheets (stop)</button>
        <label className="toggle" title="Crew move to keep the boat upright (K)">
          <input type="checkbox" checked={s.input.autoCrew} onChange={(e) => ctl.setInput({ autoCrew: e.target.checked })} />
          Auto crew
        </label>
        <label className="slider" title="Crew weight out to windward (manual crew)">
          Hike
          <input type="range" min={0} max={1} step={0.05} value={s.input.crewHike} disabled={s.input.autoCrew} onChange={(e) => ctl.setInput({ crewHike: Number(e.target.value) })} />
        </label>
      </div>
    </section>
  );
}
