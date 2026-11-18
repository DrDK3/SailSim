import { useRef } from 'react';
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
      <h4>Keys</h4>
      <p className="fine">A / D steer · W / S main · Q / E jib · P pause · C camera · H help and every key.</p>
    </div>
  );
}

/** The About page on its own (Settings → About this simulator). */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
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
