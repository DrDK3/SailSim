import type { SimController, UiState } from '../app/controller';
import { PRESETS, matchPreset, presetSettings, type GraphicsPreset, type GraphicsSettings } from '../render/graphics';
import { LIGHTING_PRESETS } from '../app/lighting';
import type { AudioSettings } from '../render/audio';

const PRESET_INFO: Record<GraphicsPreset, { label: string; note: string }> = {
  performance: { label: 'Performance', note: 'For older laptops: lower resolution, simple water and shadows, less scenery detail.' },
  balanced: { label: 'Balanced', note: 'Sky reflections in the water, foam and spray, haze, shadows over the town and woods.' },
  ultra: { label: 'Ultra', note: 'As Balanced, drawn at full sharpness on high-density screens.' },
};

/**
 * Graphics and sound: three presets and the options they set, the lighting presets (a time of day and sky for
 * the scenario's date), and the sound's levels. Everything is visual or audible only: the physics never changes.
 */
export function SettingsPanel({ ctl, ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  const g = ui.graphics;
  const a = ui.audio;
  const setG = (change: Partial<GraphicsSettings>) => {
    if (!g) return;
    const next = { ...g, ...change };
    ctl.setGraphics({ ...next, preset: matchPreset(next) });
  };
  const setA = (change: Partial<AudioSettings>) => ctl.setAudio({ ...a, ...change });
  const needsReload = !!g && ((!!ui.sceneryBuilt && g.scenery !== ui.sceneryBuilt) || (!!ui.shadowsBuilt && g.shadows !== ui.shadowsBuilt));
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Graphics and sound" onClick={onClose}>
      <section className="panel settings" onClick={(e) => e.stopPropagation()} data-testid="settings-panel">
        <div className="dash-head">
          <h3>Graphics and sound</h3>
          <button onClick={onClose}>Close</button>
        </div>
        {!g ? (
          <p className="error">The 3D view is not running.</p>
        ) : (
          <>
            <h4>Graphics quality</h4>
            <div className="seg" role="radiogroup" aria-label="Graphics preset">
              {(Object.keys(PRESETS) as GraphicsPreset[]).map((p) => (
                <button key={p} role="radio" aria-checked={g.preset === p} className={g.preset === p ? 'on' : ''} title={PRESET_INFO[p].note} onClick={() => ctl.setGraphics(presetSettings(p, g.cameraMotion))}>
                  {PRESET_INFO[p].label}
                </button>
              ))}
              {g.preset === 'custom' && <span className="fine">Custom</span>}
            </div>
            <p className="fine">{g.preset !== 'custom' ? PRESET_INFO[g.preset].note : 'Your own mix of the options below.'} Measured now: {ui.fps.toFixed(ui.fps < 10 ? 1 : 0)} frames a second.</p>
            <div className="settings-grid">
              <label>
                Resolution <span className="fine">{pct(g.resolutionScale)}</span>
                <input type="range" min={0.5} max={1} step={0.05} value={g.resolutionScale} onChange={(e) => setG({ resolutionScale: Number(e.target.value) })} />
              </label>
              <label>
                Sharpness on high-density screens
                <select value={String(g.maxPixelRatio)} onChange={(e) => setG({ maxPixelRatio: Number(e.target.value) })}>
                  <option value="1">Standard (1×)</option>
                  <option value="1.5">High (1.5×)</option>
                  <option value="2">Full (2×)</option>
                </select>
              </label>
              <label>
                Water
                <select value={g.water} onChange={(e) => setG({ water: e.target.value as 'low' | 'high' })}>
                  <option value="high">Detailed: reflects the sky, fine ripples</option>
                  <option value="low">Simple</option>
                </select>
              </label>
              <label>
                Scenery and shadows
                <select value={g.scenery} onChange={(e) => setG({ scenery: e.target.value as 'low' | 'high' })}>
                  <option value="high">Detailed: shadows over the town and woods</option>
                  <option value="low">Light: shadow of the boat only</option>
                </select>
              </label>
              <label>
                Shadow detail
                <select value={g.shadows} onChange={(e) => setG({ shadows: e.target.value as 'standard' | 'fine' })}>
                  <option value="standard">Standard</option>
                  <option value="fine">Fine (sharper, costs more)</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={g.hullFoam} onChange={(e) => setG({ hullFoam: e.target.checked })} /> Foam round the hull and the bow wave
              </label>
              <label className="check">
                <input type="checkbox" checked={g.spray} onChange={(e) => setG({ spray: e.target.checked })} /> Spray from the bow
              </label>
              <label className="check">
                <input type="checkbox" checked={g.atmosphere} onChange={(e) => setG({ atmosphere: e.target.checked })} /> Haze matched to the sky (warm towards a low sun)
              </label>
              <label>
                Camera motion <span className="fine">{g.cameraMotion < 0.05 ? 'steady horizon' : pct(g.cameraMotion)}</span>
                <input type="range" min={0} max={1} step={0.05} value={g.cameraMotion} onChange={(e) => setG({ cameraMotion: Number(e.target.value) })} />
              </label>
            </div>
            {needsReload && (
              <p className="notice-inline">
                The scenery and shadow settings take effect when the page is reloaded. <button onClick={() => location.reload()}>Reload now</button>
              </p>
            )}
            <h4>Light</h4>
            <p className="fine">Restarts the scenario at that time of day on the same date (the tide follows); the wind is kept.</p>
            <div className="seg">
              {LIGHTING_PRESETS.map((l) => (
                <button key={l.id} title={l.detail} onClick={() => ctl.leaveTo(`Changing the light to ${l.label.toLowerCase()}`, () => ctl.setLighting(l.id))}>
                  {l.label}
                </button>
              ))}
            </div>
          </>
        )}
        <h4>Sound</h4>
        <div className="settings-grid">
          <label className="check">
            <input type="checkbox" checked={!a.muted} onChange={(e) => setA({ muted: !e.target.checked })} /> Sound on <kbd>U</kbd>
          </label>
          {(
            [
              ['master', 'Volume'],
              ['wind', 'Wind'],
              ['water', 'Water'],
              ['effects', 'Sails and boom'],
              ['ambience', 'Harbour'],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              {label} <span className="fine">{pct(a[k])}</span>
              <input type="range" min={0} max={1} step={0.05} value={a[k]} disabled={a.muted} onChange={(e) => setA({ [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        {!a.muted && !ui.audioRunning && <p className="fine">Sound starts when you press a key or click in the view.</p>}
        <p className="fine">The sounds are made in the browser from the wind, the boat's speed and her sails; nothing is downloaded.</p>
      </section>
    </div>
  );
}
