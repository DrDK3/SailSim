import type { SimController, UiState } from '../app/controller';
import { placeName, type Damage } from '../sim/boat/damage';
import { FLOOD, worstReachable } from '../sim/boat/flooding';

/**
 * The damage report (owner, 6 Nov 2026): what the crew would know after a collision or a grounding. Where the
 * hull is open and how fast the water is coming in, how much is inside and how much freeboard is left, the
 * crew bailing, the rig and the rudder; and the one thing they can do about a hole they can reach: stuff a
 * sail bag in it. Shown only when there is damage. Rates and thresholds are estimates (E).
 */

const STATE: Record<Damage['state'], { text: string; cls: 'good' | 'warn' | 'bad' }> = {
  afloat: { text: 'Afloat', cls: 'good' },
  low: { text: 'Taking on water', cls: 'warn' },
  awash: { text: 'Awash', cls: 'bad' },
  sinking: { text: 'Sinking', cls: 'bad' },
  sunk: { text: 'Sunk', cls: 'bad' },
};

export function hasDamage(d: Damage | undefined): d is Damage {
  return !!d && (d.scars.length > 0 || d.breaches.length > 0 || d.rudder > 0 || d.rig > 0 || d.state !== 'afloat');
}

const tankName = { fore: ' into the forward tank', main: '', aft: ' into the aft tank' } as const;

export function DamageCard({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const d = ui.snapshot.damage;
  if (!hasDamage(d)) return null;
  const r = ui.snapshot.damageReport;
  // Afloat but holed or marked: say what matters (water coming in), not "afloat".
  const st =
    d.state === 'afloat' || (d.state === 'low' && d.bilge < 20)
      ? r && r.inflowLpm > 0.5
        ? { text: 'Taking on water', cls: 'warn' as const }
        : { text: 'Damaged', cls: 'warn' as const }
      : STATE[d.state];
  const inside = Math.round(d.bilge);
  const capacity = FLOOD.compartments.main.capacity;
  const reach = worstReachable(d);
  const rig = d.rigParts;
  const rigText = rig.down
    ? `dismasted: the mast fell ${rig.down === 'aft' ? 'aft' : `to ${rig.down === 'stbd' ? 'starboard' : 'port'}`}`
    : rig.shroudPort >= 1 || rig.shroudStbd >= 1
      ? `${rig.shroudPort >= 1 ? 'port' : 'starboard'} shroud broken: keep it to leeward`
      : rig.forestay > 0 || rig.shroudPort > 0 || rig.shroudStbd > 0
        ? 'strained: it drives less'
        : '';
  const rudderText = d.rudder >= 1 ? 'torn off: steer with the sails and the crew' : d.rudder > 0 ? `bent ${Math.round(d.rudder * 100)}%: it pulls aside` : '';
  return (
    <section className="panel damage" aria-label="Damage" data-testid="damage-card">
      <div className="damage-head">
        <h3>Damage</h3>
        <span className={`status ${st.cls}`} role="status" data-testid="damage-state">
          <span className="dot" aria-hidden="true" />
          <strong>{st.text}</strong>
        </span>
      </div>
      {(inside > 0 || (r && r.inflowLpm > 0.5)) && (
        <div className="damage-water">
          <div className="damage-row">
            <span>Water inside</span>
            <strong data-testid="damage-water">{inside} L</strong>
          </div>
          <div className="damage-bar" role="meter" aria-label="Water inside the hull" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={inside}>
            <div className="damage-fill" style={{ width: `${Math.min(100, (100 * d.water.main) / capacity)}%` }} />
          </div>
          {r && (
            <div className="damage-row fine">
              <span>
                In {Math.round(r.inflowLpm)} L/min{r.bailLpm > 0 ? ` · crew bailing ${Math.round(r.bailLpm)} L/min` : ''}
              </span>
              <span title="Height of her lowest deck edge above the water">Freeboard {Math.round(r.freeboard * 100)} cm</span>
            </div>
          )}
        </div>
      )}
      <ul className="damage-list">
        {d.breaches.map((b, i) => (
          <li key={i}>
            <strong>{b.kind === 'hole' ? 'Hole' : 'Crack'}</strong>, {placeName(b.x, b.y)}
            {r?.breaches[i]?.below ? ' below the waterline' : ' above the waterline'}
            {tankName[b.compartment]}
            {r && r.breaches[i]!.flowLpm >= 0.5 ? ` · ${Math.round(r.breaches[i]!.flowLpm)} L/min` : ''}
            {b.plugged > 0 ? ' · stuffed' : ''}
          </li>
        ))}
        {d.breaches.length === 0 && d.scars.length > 0 && <li>Hull marked: scuffs and gouges, no leak</li>}
        {rigText && (
          <li>
            <strong>Rig</strong> {rigText}
          </li>
        )}
        {rudderText && (
          <li>
            <strong>Rudder</strong> {rudderText}
          </li>
        )}
      </ul>
      {(reach || d.plugging > 0) && d.state !== 'sunk' && (
        <button className="primary damage-plug" onClick={() => ctl.plugLeak()} disabled={d.plugging > 0} title="One of the crew stuffs a sail bag or a cushion into the worst hole they can reach: most of the water stops">
          {d.plugging > 0 ? `Stuffing a sail bag in… ${Math.ceil(d.plugging)} s` : 'Stuff the hole'}
        </button>
      )}
      <p className="fine">Thresholds, sizes and rates are estimates (E). Restart to repair.</p>
    </section>
  );
}

/** Awash, going down, or on the bottom: say so plainly, and offer a way on. */
export function DamageBanner({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const d = ui.snapshot.damage;
  if (!d || (d.state !== 'awash' && d.state !== 'sinking' && d.state !== 'sunk')) return null;
  const text =
    d.state === 'awash'
      ? 'Awash: her buoyancy tanks keep her afloat, but she will not sail. In real life, stay with the boat and call for help.'
      : d.state === 'sinking'
        ? 'Sinking: a buoyancy tank has flooded too, and what is left cannot carry her.'
        : `Sunk: she lies on the bottom, about ${Math.round(d.sinkage + 1)} m down.`;
  return (
    <div className="banner error damage-banner" role="alert" data-testid="damage-banner">
      {text} <button onClick={() => ctl.requestReset()}>Start again</button>
    </div>
  );
}
