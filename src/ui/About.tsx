import { useEffect, useRef } from 'react';
import { useModal } from './useModal';

/**
 * About the simulator: what it is and how far to trust it (owner, 18 Nov 2026: the caveats moved here from the
 * welcome, which is now one question and "Sail now"). Every statement is one the simulator already made elsewhere
 * (the old welcome, Help, the race panel, the coach): nothing new is claimed.
 */
export function AboutContent() {
  return (
    <div className="about" data-testid="about">
      <p>
        Sail a National Squib, the 5.8 m keelboat raced at the Royal Dart Yacht Club, on the River Dart and in Start Bay: learn to sail, explore the
        water, or race against AI Squibs. It runs in your browser.
      </p>
      <h4>How far to trust it</h4>
      <ul>
        <li>
          <strong>The boat.</strong> She moves by a physics model. Her dimensions are from class sources; the hydrodynamic and sail coefficients are
          estimates awaiting calibration.
        </li>
        <li>
          <strong>Wind and tide.</strong> The wind can come from the Met Office forecast; the weather and tide sources in use are named in the
          instruments.
        </li>
        <li>
          <strong>The river.</strong> Terrain, buildings, piers and the shoreline come from open data. Mid-channel depths, individual moorings, most
          ferry timetables and the tidal stream are provisional estimates (Settings → Layers and sources lists each one).
        </li>
        <li>
          <strong>Racing.</strong> The judge applies a simplified subset of the racing rules; it is not an authoritative adjudication. AI sail
          numbers are invented.
        </li>
        <li>
          <strong>Coaching and race aids.</strong> The coach, the laylines and the lifted or headed readout are rules of thumb on the simulator’s own
          model polar (estimates), not measured Squib data.
        </li>
      </ul>
      <p>
        <strong>Not for navigation or performance prediction.</strong>
      </p>
      <h4 id="trust-labels" tabIndex={-1} data-testid="about-trust">
        How far to trust this: the labels, one by one
      </h4>
      <p className="fine">
        These are the labels the screens show in the instructor view (Settings → Instructor view), where they apply. In the player view they are
        kept here instead. Estimates are tagged E; Settings → Layers and sources lists where each piece of the river comes from.
      </p>
      <ul className="trust-list">
        <li>Squib types: what each build or sail package changes, with the provenance of every difference (S secondary source, E estimate).</li>
        <li>The helm figure is appearance only: the boat&apos;s crew weight is an estimate in its calibration.</li>
        <li>
          The tidal stream on the river is illustrative: it follows the channel, about twice as fast in the narrows as at the entrance; slack at high
          and low water and strongest at mid-tide, a timing real streams need not follow. Not measured current data.
        </li>
        <li>Race times on the short course (about 5 minutes) are model output.</li>
        <li>The finishing window (15 minutes after the first finisher) is an estimate standing in for the sailing instructions.</li>
        <li>The coach judges against the app&apos;s model polar and rules of thumb (estimates), not measured Squib data.</li>
        <li>Damage: thresholds, sizes and rates are estimates (E).</li>
        <li>Expert&apos;s sail controls (kicker, cunningham, outhaul, jib lead) and the spinnaker: their effects are estimates (E).</li>
        <li>
          The exercises: their thresholds are provisional (E); an instructor can change them for one browser with a thresholds file, and results
          then say so. Each attempt&apos;s assistance (auto-trim, overlay, help) is recorded and shown, with the outcome, in the instructor view.
        </li>
      </ul>
      <h4>Keys</h4>
      <p className="fine">A / D steer · W / S main · Q / E jib · P pause · C camera · H help and every key.</p>
    </div>
  );
}

/** The About page on its own (Settings → About this simulator; "How far to trust this" opens it at the labels). */
export function AboutDialog({ onClose, at = 'top' }: { onClose: () => void; at?: 'top' | 'trust' }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  useEffect(() => {
    if (at !== 'trust') return;
    const h = ref.current?.querySelector<HTMLElement>('#trust-labels');
    h?.scrollIntoView({ block: 'start' });
    h?.focus();
  }, [at]);
  return (
    <div ref={ref} className="overlay hub-overlay" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={onClose}>
      <section className="panel hub hub-light" onClick={(e) => e.stopPropagation()}>
        <div className="hub-head">
          <h2 id="about-title">About this simulator</h2>
          <button className="hub-close" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <AboutContent />
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </section>
    </div>
  );
}
