import { useEffect, useRef } from 'react';

const KEY = 'squib.welcomed.v1';

/** Whether to greet a first-time visitor (kept in this browser; storage errors count as "seen"). */
export function shouldWelcome(): boolean {
  try {
    return !localStorage.getItem(KEY) && !new URLSearchParams(location.search).has('nowelcome');
  } catch {
    return false;
  }
}

export function markWelcomed(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // storage unavailable: the welcome may show again next time
  }
}

/** First visit: what this is, and a choice of where to start. */
export function Welcome({ onTutorial, onExplore, onLibrary }: { onTutorial: () => void; onExplore: () => void; onLibrary: () => void }) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title" onKeyDown={(e) => e.key === 'Escape' && onExplore()}>
      <section className="panel welcome">
        <h2 id="welcome-title">Squib sailing simulator</h2>
        <p>
          Sail a National Squib, the 5.8 m keelboat raced at the Royal Dart Yacht Club, on the River Dart and in
          Start Bay. The boat moves by a physics model (its coefficients are still estimates), and the wind can come
          from the Met Office forecast.
        </p>
        <ul className="welcome-list">
          <li><strong>New to sailing or to this simulator?</strong> The tutorial teaches steering, trimming, tacking and gybing in about five minutes.</li>
          <li><strong>Know how to sail?</strong> Explore the river, or pick a scenario: fog, a fresh breeze, a race against AI boats.</li>
        </ul>
        <div className="row left wrap">
          <button ref={primary} className="primary" onClick={onTutorial}>Start the tutorial</button>
          <button onClick={onLibrary}>Choose a scenario</button>
          <button onClick={onExplore}>Just sail</button>
        </div>
        <p className="fine">Keys: A/D steer, W/S main sheet, H help. Not for navigation; physics coefficients are estimates.</p>
      </section>
    </div>
  );
}
