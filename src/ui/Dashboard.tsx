import { useMemo, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import type { Channel } from '../app/telemetry';
import { LineChart, type Series } from './charts/LineChart';

const KN = 1852 / 3600;
const D = 180 / Math.PI;
const WINDOWS = [30, 60, 120, 300];

interface ChartDef {
  title: string;
  unit: string;
  decimals?: number;
  include?: number[];
  series: { name: string; ch: Channel; scale: number }[];
}

/** One measure per chart (no dual axes); at most two series per chart, in fixed colour order. */
const CHARTS: ChartDef[] = [
  { title: 'Speed', unit: 'kn', decimals: 2, series: [{ name: 'STW', ch: 'stw', scale: 1 / KN }, { name: 'SOG', ch: 'sog', scale: 1 / KN }] },
  { title: 'Wind angle', unit: '° (+ stbd)', decimals: 0, series: [{ name: 'TWA', ch: 'twa', scale: D }, { name: 'AWA', ch: 'awa', scale: D }] },
  { title: 'Heel', unit: '° (+ stbd)', series: [{ name: 'Heel', ch: 'heel', scale: D }, { name: 'Static equilibrium', ch: 'heelEq', scale: D }] },
  { title: 'Helm', unit: '°', series: [{ name: 'Rudder', ch: 'rudder', scale: D }, { name: 'Balance (+ weather)', ch: 'helmBalance', scale: D }] },
  { title: 'Sail incidence', unit: '°', decimals: 0, include: [0], series: [{ name: 'Main α', ch: 'alphaMain', scale: D }, { name: 'Jib α', ch: 'alphaJib', scale: D }] },
  { title: 'Drive and resistance', unit: 'N', decimals: 0, include: [0], series: [{ name: 'Sail drive', ch: 'drive', scale: 1 }, { name: 'Hull resistance', ch: 'resistance', scale: 1 }] },
  { title: 'True wind at the boat', unit: 'kn', series: [{ name: 'TWS', ch: 'tws', scale: 1 / KN }] },
  { title: 'Main boom angle', unit: '° (+ port)', decimals: 0, series: [{ name: 'Boom', ch: 'boom', scale: D }] },
];

const COLORS = ['var(--series-1)', 'var(--series-2)'];

export function Dashboard({ ctl, ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  const [windowS, setWindowS] = useState(60);
  const [table, setTable] = useState(false);
  const tNow = ui.snapshot.t;
  const data = useMemo(() => ctl.telemetry.window(tNow - windowS), [ctl, tNow, windowS, ui.telemetryVersion]);

  const exportCsv = () => {
    const blob = new Blob([ctl.telemetry.toCsv()], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `squib-telemetry-t${Math.round(tNow)}s.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const stats = (vals: number[]) => {
    const f = vals.filter(Number.isFinite);
    if (!f.length) return { now: NaN, min: NaN, max: NaN, mean: NaN };
    return { now: f[f.length - 1]!, min: Math.min(...f), max: Math.max(...f), mean: f.reduce((a, b) => a + b, 0) / f.length };
  };

  return (
    <section className="panel dashboard" aria-label="Validation dashboard">
      <div className="dash-head">
        <h3>Validation dashboard</h3>
        <button onClick={onClose} aria-label="Close dashboard">Close</button>
      </div>
      <div className="dash-filters" role="group" aria-label="Time window">
        {WINDOWS.map((w) => (
          <button key={w} aria-pressed={windowS === w} onClick={() => setWindowS(w)}>{w < 120 ? `${w} s` : `${w / 60} min`}</button>
        ))}
        <span className="spacer" />
        <button aria-pressed={table} onClick={() => setTable(!table)}>Table</button>
        <button onClick={exportCsv}>Export CSV</button>
      </div>
      <p className="fine">Live model variables at 10 Hz. Coefficients are estimates; these are model outputs, not measurements.</p>
      {table ? (
        <table className="dash-table">
          <thead><tr><th>Variable</th><th>Now</th><th>Min</th><th>Max</th><th>Mean</th></tr></thead>
          <tbody>
            {CHARTS.flatMap((c) => c.series.map((s) => {
              const st = stats(data[s.ch].map((v) => v * s.scale));
              const f = (v: number) => (Number.isFinite(v) ? v.toFixed(c.decimals ?? 1) : '–');
              return (
                <tr key={s.ch}><td>{s.name} ({c.unit})</td><td>{f(st.now)}</td><td>{f(st.min)}</td><td>{f(st.max)}</td><td>{f(st.mean)}</td></tr>
              );
            }))}
          </tbody>
        </table>
      ) : (
        <div className="dash-grid">
          {CHARTS.map((c) => {
            const series: Series[] = c.series.map((s, i) => ({ name: s.name, values: data[s.ch].map((v) => v * s.scale), color: COLORS[i]! }));
            return <LineChart key={c.title} title={c.title} unit={c.unit} t={data.t} series={series} tNow={tNow} windowS={windowS} decimals={c.decimals} include={c.include} />;
          })}
        </div>
      )}
    </section>
  );
}
