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
  ['X', 'Release both sheets (sails luff; head to wind as well to stop)'],
  ['P', 'Pause / resume'],
  ['R', 'Reset to the scenario start'],
  ['C', 'Cycle camera: chase, helm, orbit, top'],
  ['F', 'Show physics force arrows'],
  ['G', 'Show the physics debug panel'],
  ['V', 'Validation dashboard (live charts, table, CSV export)'],
  ['L / N', 'Place labels / minimap'],
  ['Esc', 'Close the open panels and menus'],
  ['H or ?', 'This help'],
];

export function Help({ onClose, onTutorial }: { onClose: () => void; onTutorial: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Help" onClick={onClose}>
      <section className="panel help" onClick={(e) => e.stopPropagation()}>
        <div className="row left help-top">
          <button className="primary" onClick={onTutorial} autoFocus>Start the tutorial</button>
          <span className="fine">A step-by-step lesson: steer, trim, tack, gybe and stop (about 5 minutes).</span>
        </div>
        <h3>How to sail</h3>
        <p>
          You helm a National Squib. Sail angle is set by the sheet: the sail blows out until the sheet stops it.
          Too far out and it luffs (no drive); too far in and it stalls. Watch the status chips under the sails.
          To tack, steer through the wind keeping speed; to stop, release the sheets and head into the wind.
        </p>
        <table>
          <tbody>{KEYS.map(([k, d]) => <tr key={k}><td className="key">{k}</td><td>{d}</td></tr>)}</tbody>
        </table>
        <h3>Racing</h3>
        <p>
          In Scenario, choose a course and up to 20 AI boats. Watch the flags: class flag at the warning signal, P (or U,
          black) at the preparatory signal, coming down at one minute; the start when the class flag comes down. Flag X:
          someone was over early (return behind the line); First Substitute: general recall. Port tack keeps clear of
          starboard, windward of leeward, clear astern of clear ahead, and a boat tacking keeps clear. If you hit a boat
          you should have kept clear of, take a Two-Turns Penalty (two turns the same way, each with a tack and a gybe);
          for touching a mark, one turn. The judge is a simplified subset of the racing rules, not an authoritative one.
        </p>
        <p className="fine">
          On the River Dart: terrain, buildings, piers and the shoreline come from open data; water
          depths mid-channel, individual moorings, ferry timetables and the tidal stream are provisional estimates (see
          Layers). You can run aground: the keel stops you in shallow water, and moored boats and ferries are solid. The boat heels dynamically, the boom swings on its own and can gybe
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
