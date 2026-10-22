import type { BoatSnapshot } from '../sim/simulation';
import { bearing } from './format';

/** Heading-up compass: boat at the centre, card rotates; true (blue) and apparent (violet) wind arrows. */
export function Compass({ s }: { s: BoatSnapshot }) {
  const size = 168;
  const r = 70;
  const c = size / 2;
  const hdgDeg = (s.heading * 180) / Math.PI;
  const ticks = [];
  for (let d = 0; d < 360; d += 10) {
    const major = d % 30 === 0;
    const a = ((d - hdgDeg) * Math.PI) / 180;
    const x1 = c + Math.sin(a) * r;
    const y1 = c - Math.cos(a) * r;
    const x2 = c + Math.sin(a) * (r - (major ? 9 : 5));
    const y2 = c - Math.cos(a) * (r - (major ? 9 : 5));
    ticks.push(<line key={d} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'tick major' : 'tick'} />);
    if (d % 90 === 0) {
      const lx = c + Math.sin(a) * (r - 19);
      const ly = c - Math.cos(a) * (r - 19);
      ticks.push(<text key={`l${d}`} x={lx} y={ly} className="card-label" dominantBaseline="central" textAnchor="middle">{['N', 'E', 'S', 'W'][d / 90]}</text>);
    }
  }
  // Wind arrows point the way the wind blows, drawn from the FROM side towards the centre.
  const arrow = (fromRelRad: number, cls: string, len: number) => {
    const x0 = c + Math.sin(fromRelRad) * len;
    const y0 = c - Math.cos(fromRelRad) * len;
    const x1 = c + Math.sin(fromRelRad) * 18;
    const y1 = c - Math.cos(fromRelRad) * 18;
    return <line x1={x0} y1={y0} x2={x1} y2={y1} className={`wind ${cls}`} markerEnd={`url(#head-${cls})`} />;
  };
  return (
    <svg className="compass" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Heading ${bearing(s.heading)}`}>
      <defs>
        {['true', 'app'].map((k) => (
          <marker key={k} id={`head-${k}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={`wind-head ${k}`} />
          </marker>
        ))}
      </defs>
      <circle cx={c} cy={c} r={r} className="ring" />
      {ticks}
      {arrow(s.twa, 'true', r - 2)}
      {arrow(s.awa, 'app', r - 12)}
      <path d={`M${c},${c - 15} C${c + 6},${c - 6} ${c + 6},${c + 8} ${c + 4},${c + 14} L${c - 4},${c + 14} C${c - 6},${c + 8} ${c - 6},${c - 6} ${c},${c - 15} z`} className="boat-icon" />
      <text x={c} y={14} textAnchor="middle" className="hdg-label">{bearing(s.heading)}°</text>
    </svg>
  );
}
