import type { BoatSnapshot } from '../sim/simulation';
import type { EnvironmentInfo } from '../sim/env/environment';
import { Compass } from './Compass';
import { bearing, deg, kn, sideAngle } from './format';

function Cell({ label, value, unit, title }: { label: string; value: string; unit?: string; title?: string }) {
  return (
    <div className="cell" title={title}>
      <div className="cell-label">{label}</div>
      <div className="cell-value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

export function Instruments({ s }: { s: BoatSnapshot }) {
  const tack = s.mainSide === 1 ? 'Starboard' : 'Port';
  return (
    <section className="panel instruments" aria-label="Instruments">
      <div className="instr-top">
        <Compass s={s} />
        <div className="big">
          <div className="cell-label">Speed through water</div>
          <div className="big-value" data-testid="stw">{kn(s.stw, 2)}<span className="unit">kn</span></div>
          <div className="tack-chip" data-tack={tack.toLowerCase()}>{tack} tack</div>
        </div>
      </div>
      <div className="grid">
        <Cell label="Heading" value={bearing(s.heading)} unit="°" />
        <Cell label="SOG" value={kn(s.sog, 2)} unit="kn" title="Speed over ground" />
        <Cell label="COG" value={bearing(s.cog)} unit="°" title="Course over ground" />
        <Cell label="TWA" value={sideAngle(s.twa)} title="True wind angle (relative to the water)" />
        <Cell label="TWS" value={kn(s.tws)} unit="kn" title="True wind speed (relative to the water)" />
        <Cell label="VMG" value={kn(s.vmg, 2)} unit="kn" title="Velocity made good towards the true wind (through the water)" />
        <Cell label="AWA" value={sideAngle(s.awa)} title="Apparent wind angle" />
        <Cell label="AWS" value={kn(s.aws)} unit="kn" title="Apparent wind speed" />
        <Cell label="Heel" value={`${deg(Math.abs(s.heel))}° ${s.heel > 0.005 ? 'stbd' : s.heel < -0.005 ? 'port' : ''}`} />
        <Cell label="Leeway" value={deg(Math.abs(s.leeway), 1)} unit="°" />
        <Cell label="Rudder" value={sideAngle(s.rudder)} />
        <Cell label="Helm balance" value={helmText(s.helmBalance)} title="Rudder angle that would hold the boat straight right now. Weather helm = the boat wants to round up." />
        <Cell label="Current" value={Math.hypot(s.current.n, s.current.e) < 0.01 ? 'none' : `${kn(Math.hypot(s.current.n, s.current.e))} → ${bearing(Math.atan2(s.current.e, s.current.n))}°`} unit={Math.hypot(s.current.n, s.current.e) < 0.01 ? undefined : 'kn'} title={s.env?.currentLabel ?? 'Water velocity over the ground at the boat'} />
      </div>
      {s.env && <Conditions env={s.env} />}
    </section>
  );
}

function helmText(b: number): string {
  const d = Math.round(Math.abs(b) / (Math.PI / 180));
  if (d === 0 || !Number.isFinite(b)) return 'neutral';
  return `${d}° ${b > 0 ? 'weather' : 'lee'}`;
}

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** Where the conditions come from, with provenance; nothing here is presented as a measurement. */
function Conditions({ env }: { env: EnvironmentInfo }) {
  const w = env.weather;
  const source = w.kind === 'manual' ? 'Manual' : w.kind === 'replay' ? 'Met Office UKV (replay)' : 'Met Office UKV (model)';
  const tide = env.tide;
  return (
    <div className="conditions" data-testid="conditions">
      <div className="cond-row">
        <span className="cell-label">Clock</span>
        <span className="cond-value" data-testid="clock">{new Date(env.epochMs).toISOString().slice(11, 19)} UTC</span>
      </div>
      <div className="cond-row" title={[w.label, ...w.notes, w.attribution ?? ''].filter(Boolean).join('\n')}>
        <span className="cell-label">Wind source</span>
        <span className="cond-value">
          {source}
          {w.validTime && <span className="fine-inline"> valid {hhmm(Date.parse(w.validTime))}Z</span>}
          <span className="fine-inline"> · gust ×{env.gustFactor.toFixed(2)}</span>
        </span>
      </div>
      {tide && (
        <div className="cond-row" title={[tide.label, ...tide.notes].join('\n')}>
          <span className="cell-label">Tide</span>
          <span className="cond-value" data-testid="tide">
            {tide.height.toFixed(1)} m CD {tide.rising ? 'rising' : 'falling'}
            <span className="fine-inline">
              {tide.nextHW && ` · HW ${hhmm(tide.nextHW.epochMs)}Z`}
              {tide.nextLW && ` · LW ${hhmm(tide.nextLW.epochMs)}Z`}
            </span>
          </span>
        </div>
      )}
      <div className="cond-row" title={env.currentNotes.join('\n')}>
        <span className="cell-label">Stream</span>
        <span className="cond-value">{env.currentLabel}</span>
      </div>
      {env.windAgainstTide && <div className="chip warn" role="status">Wind against tide: short, steep chop</div>}
    </div>
  );
}
