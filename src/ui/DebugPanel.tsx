import type { UiState } from '../app/controller';
import { deg, kn } from './format';

const N = (x: number) => x.toFixed(0);

export function DebugPanel({ ui }: { ui: UiState }) {
  const s = ui.snapshot;
  const f = s.forces;
  const rows: [string, string, string, string][] = [
    ['Main', N(f.main.x), N(f.main.y), N(f.main.n)],
    ['Jib', N(f.jib.x), N(f.jib.y), N(f.jib.n)],
    ['Windage', N(f.windage.x), N(f.windage.y), N(f.windage.n)],
    ['Keel + hull lift', N(f.lateral.x), N(f.lateral.y), N(f.lateral.n)],
    ['Rudder', N(f.rudder.x), N(f.rudder.y), N(f.rudder.n)],
    ['Hull resistance', N(f.hull.x), '0', '0'],
    ['Cross-flow', '0', N(f.crossFlow.y), N(f.crossFlow.n)],
    ['Yaw damping', '0', '0', N(f.yawDamping)],
    ['Total', N(f.total.x), N(f.total.y), N(f.total.n)],
  ];
  return (
    <section className="panel debug" aria-label="Physics debug">
      <h3>Physics (live)</h3>
      <table>
        <thead><tr><th>Force</th><th>X fwd N</th><th>Y stbd N</th><th>Yaw N·m</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
      </table>
      <dl>
        <dt>Main α / CL / CD</dt><dd>{deg(f.main.incidence, 1)}° / {f.main.cl.toFixed(2)} / {f.main.cd.toFixed(2)} (luff {f.main.luff.toFixed(2)}, stall {f.main.stall.toFixed(2)})</dd>
        <dt>Jib α / CL / CD</dt><dd>{deg(f.jib.incidence, 1)}° / {f.jib.cl.toFixed(2)} / {f.jib.cd.toFixed(2)} (eff. {f.jibEffectiveness.toFixed(2)})</dd>
        <dt>Keel α / CL</dt><dd>{deg(f.lateral.alpha, 1)}° / {f.lateral.cl.toFixed(3)}</dd>
        <dt>Rudder α / CL</dt><dd>{deg(f.rudder.alpha, 1)}° / {f.rudder.cl.toFixed(3)}</dd>
        <dt>Resistance</dt><dd>friction {N(f.hull.friction)} N, residuary {N(f.hull.residuary)} N, Fn {f.hull.froude.toFixed(3)}</dd>
        <dt>u / v / r</dt><dd>{s.u.toFixed(3)} / {s.v.toFixed(3)} m/s / {deg(s.r, 2)}°/s</dd>
        <dt>Heel / equilibrium</dt><dd>{deg(s.heel, 1)}° / {deg(s.heelEquilibrium, 1)}°, roll rate {deg(s.rollRate, 1)}°/s, crew y {s.crewY.toFixed(2)} m</dd>
        <dt>Roll moments N·m</dt><dd>sails {N(f.roll.sails)}, foils {N(f.roll.hydro)}, crew {N(f.roll.crew)}, righting {N(f.roll.righting)}, damping {N(f.roll.damping)}</dd>
        <dt>Boom</dt><dd>{deg(s.boomMain, 1)}° at {deg(s.boomRate, 0)}°/s{s.mainInverted ? ' (by the lee, inverted)' : ''}{s.lastBoomEvent ? `; last fetched up at ${deg(Math.abs(s.lastBoomEvent.rate), 0)}°/s, t=${s.lastBoomEvent.t.toFixed(1)} s` : ''}</dd>
        <dt>Bottom contact</dt><dd>{s.grounded ? `aground (${f.contact.points.filter((p) => p.clearance < 0).map((p) => p.name).join(', ')}); force ${N(f.contact.x)}, ${N(f.contact.y)} N` : 'clear'}; water {s.waterLevel.toFixed(2)} m ODN, depth at keel {Number.isFinite(s.depthAtKeel) ? s.depthAtKeel.toFixed(2) : '—'} m</dd>
        <dt>Helm balance</dt><dd>{deg(s.helmBalance, 1)}° (+ = weather helm)</dd>
        <dt>Sheet limits</dt><dd>main {deg(s.mainSheetLimit)}°, jib {deg(s.jibSheetLimit)}°</dd>
        <dt>Wind over ground</dt><dd>{kn(s.twsGround)} kn from {deg(s.twdGround)}°</dd>
        <dt>Sim time / step</dt><dd>{s.t.toFixed(2)} s / {s.step}</dd>
        <dt>Frame</dt><dd>{ui.fps.toFixed(0)} fps, physics {ui.physicsMsPerFrame.toFixed(2)} ms/frame</dd>
      </dl>
      <p className="fine">Coefficients are estimates (tag E). See docs/PHYSICS.md.</p>
    </section>
  );
}
