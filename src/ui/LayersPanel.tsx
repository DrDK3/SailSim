import type { SimController, UiState } from '../app/controller';

const STATUS: Record<string, { label: string; cls: string }> = {
  data: { label: 'Data', cls: 'good' },
  partial: { label: 'Partial', cls: 'warn' },
  provisional: { label: 'Provisional', cls: 'warn' },
};

/**
 * Which parts of the River Dart are data and which are provisional estimates, with sources, licences and
 * attribution. Built from public/geo/manifest.json, so it always describes the data actually loaded.
 */
export function LayersPanel({ ctl, ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  const d = ctl.dartData;
  const layers = d?.manifest?.layers ?? [];
  const provisional = layers.filter((l) => l.status !== 'data');
  const notPlaced = d?.features?.marksNotPlaced ?? [];
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Map layers and sources" onClick={onClose}>
      <section className="panel layers" onClick={(e) => e.stopPropagation()}>
        <div className="dash-head">
          <h3>River Dart: layers, provisional elements and sources</h3>
          <button onClick={onClose}>Close</button>
        </div>
        {ui.dart.issues.length > 0 && (
          <>
            <h4>Load problems</h4>
            <ul className="issues" data-testid="load-issues">
              {ui.dart.issues.map((i) => (
                <li key={i.asset}><strong>{i.asset}</strong>: {i.message}. {i.effect}</li>
              ))}
            </ul>
          </>
        )}
        {ui.dart.status === 'unavailable' && <p className="error">The River Dart data is not loaded: you are sailing on open water.</p>}
        <h4>Provisional elements</h4>
        <p className="fine">These are estimates or illustrations, not data. They affect what you see and, for depths and the stream, how the boat behaves.</p>
        <ul className="provisional" data-testid="provisional-list">
          {provisional.map((l) => (
            <li key={l.id}>
              <span className={`status ${STATUS[l.status]?.cls ?? 'warn'}`}>{STATUS[l.status]?.label ?? l.status}</span> <strong>{l.label}</strong> (tag {l.tag}): {l.notes.join(' ')}
            </li>
          ))}
          <li>
            <span className="status warn">Provisional</span> <strong>Chart datum offset</strong>: water levels use chart datum {d?.manifest?.verticalDatum.chartDatumBelowOdn ?? '?'} m below ODN, from a secondary source.
          </li>
          {notPlaced.length > 0 && (
            <li>
              <span className="status bad">Not shown</span> <strong>Marks without an established position</strong>: {notPlaced.map((m) => m.name).join(', ')}.
            </li>
          )}
          <li><span className="status bad">Not shown</span> <strong>Official RDYC courses and marks</strong>: club documents not yet available.</li>
        </ul>
        <h4>All layers and sources</h4>
        <table className="layers-table">
          <thead><tr><th>Layer</th><th>Status</th><th>Tag</th><th>Source</th><th>Licence</th></tr></thead>
          <tbody>
            {layers.map((l) => (
              <tr key={l.id}>
                <td>{l.label}</td>
                <td><span className={`status ${STATUS[l.status]?.cls ?? 'warn'}`}>{STATUS[l.status]?.label ?? l.status}</span></td>
                <td>{l.tag}</td>
                <td>{l.source}</td>
                <td>{l.licence}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4>Attribution</h4>
        <ul className="attribution">
          <li>© OpenStreetMap contributors (ODbL 1.0), via Overture Maps Foundation; building footprints also from Microsoft ML Buildings (ODbL).</li>
          <li>© Environment Agency copyright and/or database right 2015. All rights reserved. Open Government Licence v3 (LIDAR terrain via Tilezen/AWS Open Data).</li>
          <li>Contains modified Copernicus Sentinel data 2025.</li>
          <li>Weather: British Crown copyright, the Met Office, CC BY-SA 4.0 (when a Met Office source is used).</li>
        </ul>
        <p className="fine">Generated {d?.manifest?.generated ?? '—'} by tools/geodata/build.py. Codes: V verified, S secondary, E estimate, N not established. Not for navigation.</p>
      </section>
    </div>
  );
}
