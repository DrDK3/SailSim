import type { BoatSnapshot } from '../sim/simulation';
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
        <Cell label="Tide / current" value={Math.hypot(s.current.n, s.current.e) < 0.01 ? 'none' : `${kn(Math.hypot(s.current.n, s.current.e))} kn → ${bearing(Math.atan2(s.current.e, s.current.n))}°`} title="Phase 1: uniform current from the scenario (no tidal model yet)" />
      </div>
    </section>
  );
}
