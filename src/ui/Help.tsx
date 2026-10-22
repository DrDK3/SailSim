const KEYS: [string, string][] = [
  ['A / ←', 'Steer to port (hold)'],
  ['D / →', 'Steer to starboard (hold)'],
  ['Shift (held)', 'Hold the helm where it is (no self-centring)'],
  ['Space', 'Centre the helm'],
  ['W / ↑', 'Trim (pull in) the mainsheet'],
  ['S / ↓', 'Ease the mainsheet'],
  ['E / Q', 'Trim / ease the jib sheet'],
  ['M / J', 'Toggle auto-trim assist for main / jib'],
  ['K', 'Toggle auto crew weight'],
  ['X', 'Release both sheets (sails luff, boat slows: “stop”)'],
  ['P', 'Pause / resume'],
  ['R', 'Reset to the scenario start'],
  ['C', 'Cycle camera: chase, helm, orbit, top'],
  ['F', 'Show physics force arrows'],
  ['G', 'Show the physics debug panel'],
  ['V', 'Validation dashboard (live charts, table, CSV export)'],
  ['Esc', 'Close help and the polar panel'],
  ['H or ?', 'This help'],
];

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Help" onClick={onClose}>
      <section className="panel help" onClick={(e) => e.stopPropagation()}>
        <h3>How to sail</h3>
        <p>
          You helm a National Squib. Sail angle is set by the sheet: the sail blows out until the sheet stops it.
          Too far out and it luffs (no drive); too far in and it stalls. Watch the status chips under the sails.
          To tack, steer through the wind keeping speed; to stop, head into the wind or release the sheets.
        </p>
        <table>
          <tbody>{KEYS.map(([k, d]) => <tr key={k}><td className="key">{k}</td><td>{d}</td></tr>)}</tbody>
        </table>
        <p className="fine">
          Phase 2 prototype on open water. The boat heels dynamically, the boom swings on its own and can gybe
          unexpectedly by the lee, and the wind has seeded gusts and shifts (dark patches on the water are puffs).
          Boat dimensions are from class sources; hydrodynamic and sail coefficients are estimates awaiting
          calibration. Weather and tide sources are labelled in the instruments. Not for navigation or performance
          prediction.
        </p>
        <button className="primary" onClick={onClose}>Close</button>
      </section>
    </div>
  );
}
