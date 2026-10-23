import type { FleetRow } from '../app/controller';

function clock(s?: number): string {
  if (s === undefined) return '';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

const CODES: Record<string, string> = {
  FIN: 'Finished',
  DNF: 'Did not finish (within the finishing window)',
  DNS: 'Did not start',
  OCS: 'On the course side at the start and did not return (or did not start)',
  UFD: 'Disqualified under rule 30.3 (U flag)',
  BFD: 'Disqualified under rule 30.4 (black flag)',
  RET: 'Retired',
};

/** Results of the race: Appendix A low points for one race; provisional until the race is over. */
export function ResultsPanel({ rows, final, onClose }: { rows: FleetRow[]; final: boolean; onClose: () => void }) {
  return (
    <section className="panel results" aria-label="Results" data-testid="results">
      <div className="race-head">
        <strong>Results{final ? '' : ' (provisional: race still running)'}</strong>
        <button onClick={onClose} aria-label="Close results">×</button>
      </div>
      <table>
        <thead>
          <tr><th>Place</th><th>Boat</th><th>Result</th><th>Elapsed</th><th>Points</th><th>Penalties</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.you ? 'you' : ''}>
              <td>{r.place ?? '–'}</td>
              <td><span className="swatch" style={{ background: `#${r.colour.toString(16).padStart(6, '0')}` }} aria-hidden="true" /> {r.sailNumber} {r.name}</td>
              <td title={CODES[r.code ?? ''] ?? ''}>{r.code === 'FIN' ? 'FIN' : r.code === undefined ? r.status : final ? r.code : r.status}</td>
              <td>{clock(r.elapsed)}</td>
              <td>{final ? r.points : ''}</td>
              <td className="fine-inline">{r.penalties}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine">
        Low-point scoring (Appendix A): place = points; boats that did not start, finish or were disqualified score the number of
        entries + 1. Elapsed from the start signal. Penalties: incidents found by the simplified judge (no protests or hearings).
        The finishing window (15 min after the first finisher) is an estimate standing in for the sailing instructions.
      </p>
    </section>
  );
}
