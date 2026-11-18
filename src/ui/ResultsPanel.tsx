import { useState } from 'react';
import type { FleetRow, RaceUi } from '../app/controller';
import { gapText, ordinal } from '../app/raceStory';

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

/** Time against the start signal, to the hundredth of a second. */
function rel(t: number, start: number): string {
  const d = t - start;
  const a = Math.abs(d);
  const m = Math.floor(a / 60);
  return `${d < 0 ? '−' : '+'}${m}:${(a - m * 60).toFixed(2).padStart(5, '0')}`;
}

/**
 * Results of the race: your place, large, with the gaps to the boats either side and your place at the start and at
 * each mark (owner, 18 Nov 2026); then the table (Appendix A low points for one race; provisional until the race is
 * over) and the incidents and penalties the simplified judge found (moved here from the race panel).
 */
export function ResultsPanel({
  rows,
  final,
  race,
  onClose,
  onDebrief,
  onProtest,
  onShare,
}: {
  rows: FleetRow[];
  final: boolean;
  race?: Pick<RaceUi, 'story' | 'markPlaces' | 'rulings' | 'events'>;
  onClose: () => void;
  onDebrief?: () => void;
  onProtest?: () => void;
  onShare?: () => Promise<string | undefined>;
}) {
  const [shared, setShared] = useState<string>();
  const story = race?.story;
  const places = race?.markPlaces ?? [];
  const rulings = race?.rulings ?? [];
  const t0 = race?.events.find((e) => e.type === 'signal' && e.name === 'start')?.t ?? 0;
  const you = rows.find((r) => r.you);
  return (
    <section className="panel results" aria-label="Results" data-testid="results">
      <div className="race-head">
        <strong>Results{final ? '' : ' (provisional: race still running)'}</strong>
        {onDebrief && (
          <button onClick={onDebrief} data-testid="results-debrief">
            Your sail
          </button>
        )}
        {onProtest && (
          <button onClick={onProtest} data-testid="results-protest">
            Protest room
          </button>
        )}
        {onShare && (
          <button onClick={() => void onShare().then(setShared)} title="A link with this race in it: whoever opens it races you as a ghost (nothing is uploaded)" data-testid="results-share">
            Challenge a friend
          </button>
        )}
        <button onClick={onClose} aria-label="Close results">×</button>
      </div>
      {shared && <p className="fine" role="status" data-testid="results-shared">{shared}</p>}
      {story ? (
        <div className="finish-story" data-testid="finish-story">
          <div className="finish-place" data-testid="finish-place">
            <span className="finish-place-n">{ordinal(story.place)}</span>
            <span className="finish-place-of">of {story.of}</span>
          </div>
          <div className="finish-gaps">
            <div data-testid="finish-gaps">
              {story.ahead ? `${gapText(story.ahead.gapS)} behind ${story.ahead.boat}` : story.of > 1 ? 'You won' : 'Finished'}
              {story.behind ? ` · ${gapText(story.behind.gapS)} ahead of ${story.behind.boat}` : ''}
            </div>
            <div className="fine-inline">
              Your time {clock(story.elapsedS)} from the start signal
              {story.toWinnerS > 0 && story.ahead && story.place > 2 ? ` · ${gapText(story.toWinnerS)} behind the winner` : ''}
              {final ? '' : ' · provisional: boats are still racing'}
            </div>
          </div>
        </div>
      ) : (
        you && you.code !== undefined && you.code !== 'FIN' && (
          <div className="finish-story" data-testid="finish-story">
            <div className="finish-place">
              <span className="finish-place-n">{you.code}</span>
            </div>
            <div className="finish-gaps">
              <div>{CODES[you.code] ?? you.status}</div>
            </div>
          </div>
        )
      )}
      {places.length > 0 && (
        <ol className="mark-places" aria-label="Your place at the start and at each mark" data-testid="mark-places">
          {places.map((p, i) => (
            <li key={`${p.label}-${i}`}>
              <span className="mark-places-label">{p.label}</span>
              <span className="mark-places-n">{ordinal(p.place)}</span>
            </li>
          ))}
        </ol>
      )}
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
      {rulings.length > 0 && (
        <>
          <h4 className="results-sub">Incidents and penalties</h4>
          <ol className="race-events race-log" aria-label="Incidents and penalties" data-testid="results-rulings">
            {rulings.map((l, i) => (
              <li key={`${l.t}-${i}`} className={`ev ${l.kind === 'incident' ? 'bad' : 'warn'}`}>
                <span className="ev-t">{rel(l.t, t0)}</span> {l.text}
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="fine">
        Low-point scoring (Appendix A): place = points; boats that did not start, finish or were disqualified score the number of
        entries + 1. Elapsed from the start signal. Penalties: incidents found by the simplified judge (no protests or hearings).
        The finishing window (15 min after the first finisher) is an estimate standing in for the sailing instructions.
      </p>
      <p className="fine" data-testid="results-disclaimer">Simplified rules, not an authoritative adjudication; AI sail numbers invented.</p>
    </section>
  );
}
