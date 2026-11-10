import type { SimController, UiState } from '../app/controller';

/**
 * It is dark on the Dart now (a real-time run after sunset): offer the daylight view, which lights the picture as at
 * midday while the time, tide, wind and traffic stay real (src/app/daylightView.ts).
 */
export function DarkCard({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const l = ui.light;
  if (!l.offer) return null;
  const below = Math.round(-l.sunDeg);
  return (
    <div className="hint-card" role="dialog" aria-label="It is dark on the river" data-testid="dark-card">
      <p>
        <strong>It is dark on the Dart now</strong> ({l.clock}, the sun {below >= 1 ? `${below}° below the horizon` : 'just set'}). Sail in a daylight
        view? Only the picture changes: the time, the tide, the wind and the traffic stay real.
      </p>
      <div className="row">
        <button className="primary" onClick={() => ctl.setPrefs({ daylightView: true })} data-testid="dark-daylight">
          Daylight view
        </button>
        <button onClick={() => ctl.dismissDark()} data-testid="dark-keep">Keep it dark</button>
        <button className="link" onClick={() => ctl.leaveTo('Changing the light to bright midday', () => ctl.setLighting('midday'))} title="Restarts at midday today: the tide follows the new time">
          Or restart at midday
        </button>
      </div>
    </div>
  );
}
