import { useState } from 'react';
import { damageSummary } from '../sim/boat/damage';
import type { BoatSnapshot } from '../sim/simulation';
import type { EnvironmentInfo } from '../sim/env/environment';
import { describeSky } from '../sim/env/sky';
import { Compass } from './Compass';
import { agroundText } from './aground';
import { bearing, deg, kn, sideAngle } from './format';

const MORE_KEY = 'squib.instruments.more';

/**
 * Show all the instruments and the conditions (remembered in this browser). By default only the ones a
 * helmsman watches: the rest is a click away, so the view of the water is not crowded out.
 */
function initialMore(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === '1';
  } catch {
    // storage unavailable: the default
    return false;
  }
}

/** `wide`: a value in words (damage), across the whole row and wrapping, so it cannot push the columns out of the panel. */
function Cell({ label, value, unit, title, tutorial, wide }: { label: string; value: string; unit?: string; title?: string; tutorial?: string; wide?: boolean }) {
  return (
    <div className={wide ? 'cell wide' : 'cell'} title={title} data-tutorial={tutorial}>
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
  const aground = agroundText(s);
  const [more, setMore] = useState(initialMore);
  const toggleMore = () => {
    setMore(!more);
    try {
      localStorage.setItem(MORE_KEY, more ? '0' : '1');
    } catch {
      // storage unavailable: the choice lasts for this visit
    }
  };
  return (
    <section className={`panel instruments ${more ? '' : 'compact'}`} aria-label="Instruments">
      <div className="instr-top">
        <div data-tutorial="compass">
          <Compass s={s} />
        </div>
        <div className="big" data-tutorial="speed">
          <div className="cell-label">Speed through water</div>
          <div className="big-value" data-testid="stw">{kn(s.stw, 2)}<span className="unit">kn</span></div>
          <div className="tack-chip" data-tack={tack.toLowerCase()}>{tack} tack</div>
        </div>
      </div>
      <div className="grid">
        <Cell label="Heading" value={bearing(s.heading)} unit="°" />
        <Cell label="TWA" value={sideAngle(s.twa)} title="True wind angle: where the wind comes from, relative to the bow (0° = head to wind, 180° = dead downwind)" tutorial="twa" />
        <Cell label="TWS" value={kn(s.tws)} unit="kn" title="True wind speed (relative to the water)" />
        <Cell label="Heel" value={`${deg(Math.abs(s.heel))}° ${s.heel > 0.005 ? 'stbd' : s.heel < -0.005 ? 'port' : ''}`} title="How far the boat leans over" />
        <Cell label="VMG" value={kn(s.vmg, 2)} unit="kn" title="Velocity made good: speed towards (or away from) the wind" />
        <Cell
          label="Depth"
          value={Number.isFinite(s.depthAtKeel) ? s.depthAtKeel.toFixed(1) : '—'}
          unit={Number.isFinite(s.depthAtKeel) ? 'm' : undefined}
          title="Water depth at the keel (draft 0.99 m). Near the shore from LIDAR; mid-channel from the PROVISIONAL depth estimate. Not for navigation."
        />
        {s.cockpitWater > 0.5 && (
          <Cell
            label="Water aboard"
            value={(s.cockpitWater / 1.025).toFixed(0)}
            unit="L"
            title="Water shipped into the cockpit (over the rail or in spray). A self-draining cockpit (Rondar) lets it out through the transom; older boats keep it until the crew bails. It makes the boat heavier and more tender."
          />
        )}
        {damageSummary(s.damage) && (
          <Cell
            label="Damage"
            wide
            value={damageSummary(s.damage)}
            title="From collisions and groundings: the hull leaks into the bilge (heavier, slower; the crew pump), a damaged rudder grips less and a bent one pulls aside, a damaged rig drives less. Thresholds and rates are estimates (E). Restart to repair."
          />
        )}
        {more && (
          <>
            <Cell label="SOG" value={kn(s.sog, 2)} unit="kn" title="Speed over ground" />
            <Cell label="COG" value={bearing(s.cog)} unit="°" title="Course over ground" />
            <Cell label="AWA" value={sideAngle(s.awa)} title="Apparent wind angle: the wind you feel on board" />
            <Cell label="AWS" value={kn(s.aws)} unit="kn" title="Apparent wind speed" />
            <Cell label="Leeway" value={deg(Math.abs(s.leeway), 1)} unit="°" title="Sideways slip through the water" />
            <Cell label="Rudder" value={sideAngle(s.rudder)} />
            <Cell label="Helm balance" value={helmText(s.helmBalance)} title="Rudder angle that would hold the boat straight right now. Weather helm = the boat wants to round up." />
            <Cell label="Current" value={Math.hypot(s.current.n, s.current.e) < 0.01 ? 'none' : `${kn(Math.hypot(s.current.n, s.current.e))} → ${bearing(Math.atan2(s.current.e, s.current.n))}°`} unit={Math.hypot(s.current.n, s.current.e) < 0.01 ? undefined : 'kn'} title={s.env?.currentLabel ?? 'Water velocity over the ground at the boat'} />
          </>
        )}
      </div>
      <button className="link more-toggle" aria-expanded={more} onClick={toggleMore}>
        {more ? 'Fewer instruments' : 'All instruments and conditions'}
      </button>
      {aground && (
        <div className="chip bad" role="alert" data-testid="aground" title={aground.title}>
          {aground.text}
        </div>
      )}
      {more && s.env && <Conditions env={s.env} waterLevel={s.waterLevel} />}
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
function Conditions({ env, waterLevel }: { env: EnvironmentInfo; waterLevel: number }) {
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
      {env.landEffect && (
        <div className="cond-row" title="The hills shelter the water in their lee and the valley turns the wind along the river: estimated from the terrain (docs/PHYSICS.md), not measured.">
          <span className="cell-label">Land effect</span>
          <span className="cond-value" data-testid="land-effect">
            wind {Math.round(env.landEffect.speed * 100)}% of the open-water wind
            {Math.abs(env.landEffect.turnDeg) >= 1 && <span className="fine-inline"> · turned {Math.abs(env.landEffect.turnDeg).toFixed(0)}° {env.landEffect.turnDeg > 0 ? 'clockwise' : 'anticlockwise'}</span>}
          </span>
        </div>
      )}
      {tide && (
        <div className="cond-row" title={[tide.label, ...tide.notes].join('\n')}>
          <span className="cell-label">Tide</span>
          <span className="cond-value" data-testid="tide">
            {tide.height.toFixed(1)} m CD {tide.rising ? 'rising' : 'falling'}
            <span className="fine-inline">
              {tide.nextHW && ` · HW ${hhmm(tide.nextHW.epochMs)}Z`}
              {tide.nextLW && ` · LW ${hhmm(tide.nextLW.epochMs)}Z`}
              {` · ${waterLevel >= 0 ? '+' : ''}${waterLevel.toFixed(2)} m ODN`}
            </span>
          </span>
        </div>
      )}
      <div className="cond-row" title={env.currentNotes.join('\n')}>
        <span className="cell-label">Stream</span>
        <span className="cond-value">{env.currentLabel}</span>
      </div>
      {env.sky && (
        <div className="cond-row" title={`${env.sky.label}. Visual only: does not change the wind or the boat.`}>
          <span className="cell-label">Sky</span>
          <span className="cond-value" data-testid="sky">
            {describeSky(env.sky)}
            <span className="fine-inline"> · {env.sky.kind === 'model' ? 'forecast' : 'preset'}</span>
          </span>
        </div>
      )}
      {env.sea && env.sea.hs > 0.02 && (
        <div
          className="cond-row"
          title={`Modelled wind sea: fetch ${(env.sea.fetch / 1000).toFixed(1)} km upwind; the stream along the waves is ${env.sea.currentAlong >= 0 ? 'with' : 'against'} them at ${kn(Math.abs(env.sea.currentAlong))} kn. In slack water the same wind would raise ${env.sea.slack.hs.toFixed(2)} m waves ${env.sea.slack.wavelength.toFixed(1)} m long. Not measured.`}
        >
          <span className="cell-label">Waves</span>
          <span className="cond-value" data-testid="waves">
            {env.sea.hs.toFixed(2)} m, {env.sea.wavelength.toFixed(1)} m apart
            <span className="fine-inline">
              {` · ${env.sea.tp.toFixed(1)} s`}
              {env.sea.slack.steepness > 0 && Math.abs(env.sea.steepness / env.sea.slack.steepness - 1) > 0.05 && ` · steepness ×${(env.sea.steepness / env.sea.slack.steepness).toFixed(1)} vs slack water`}
              {env.sea.whitecaps >= 0.005 && ` · whitecaps ${Math.round(env.sea.whitecaps * 100)}%`}
            </span>
          </span>
        </div>
      )}
      {env.windAgainstTide && (
        <div className="chip warn" role="status">
          Wind against tide: short, steep chop{env.sea?.blocked ? ' — the stream is stopping the waves and they are breaking' : ''}
        </div>
      )}
    </div>
  );
}
