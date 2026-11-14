import { LEVELS } from '../app/level';
import { useRef, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { ReportProblem } from './ReportProblem';
import { useModal } from './useModal';
import { PRESETS, matchPreset, presetSettings, type GraphicsPreset, type GraphicsSettings } from '../render/graphics';
import { LIGHTING_PRESETS } from '../app/lighting';
import type { AudioSettings } from '../render/audio';

const PRESET_INFO: Record<GraphicsPreset, { label: string; note: string }> = {
  performance: { label: 'Performance', note: 'For older laptops: lower resolution, simple water and shadows, less scenery detail.' },
  balanced: { label: 'Balanced', note: 'The sky and, in calm water, the shore and boats reflected; foam and spray, haze, shadows over the town and woods.' },
  ultra: { label: 'Ultra', note: 'As Balanced, with sharper reflections and shadows, soft shadows where surfaces meet, drawn at full sharpness on high-density screens.' },
};

/**
 * Settings, in groups (display, controls, help and accessibility, sound, troubleshooting). Display: three presets and the options they set, the lighting presets (a time of day and sky for
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
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  const [copied, setCopied] = useState(false);
  return (
    <div ref={ref} className="overlay" role="dialog" aria-modal="true" aria-label="Settings" onClick={onClose}>
      <section className="panel settings" onClick={(e) => e.stopPropagation()} data-testid="settings-panel">
        <div className="dash-head">
          <h3>Settings</h3>
          <button onClick={onClose}>Close</button>
        </div>
        <h4 className="settings-group">Display</h4>
        {!g ? (
          <p className="error">The 3D view is not running.</p>
        ) : (
          <>
            <h5>Graphics quality</h5>
            <div className="seg" role="radiogroup" aria-label="Graphics preset">
              {(Object.keys(PRESETS) as GraphicsPreset[]).map((p) => (
                <button key={p} role="radio" aria-checked={g.preset === p} className={g.preset === p ? 'on' : ''} title={PRESET_INFO[p].note} onClick={() => ctl.setGraphics(presetSettings(p, g.cameraMotion))}>
                  {PRESET_INFO[p].label}
                </button>
              ))}
              {g.preset === 'custom' && <span className="fine">Custom</span>}
            </div>
            <p className="fine">{g.preset !== 'custom' ? PRESET_INFO[g.preset].note : 'Your own mix of the options below.'} Measured now: {ui.fps.toFixed(ui.fps < 10 ? 1 : 0)} frames a second.</p>
            <label className="check">
              <input type="checkbox" checked={ui.autoLowerGraphics} onChange={(e) => ctl.setAutoLowerGraphics(e.target.checked)} />
              Lower the graphics when the simulation cannot keep up with real time (until you choose graphics yourself)
            </label>
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
                Reflections in calm water
                <select value={g.water === 'high' ? g.reflections : 'off'} disabled={g.water !== 'high'} onChange={(e) => setG({ reflections: e.target.value as 'off' | 'low' | 'high' })}>
                  <option value="high">Sharp: the shore and boats mirrored (costs more)</option>
                  <option value="low">Soft</option>
                  <option value="off">Off: the sky only</option>
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
                <input type="checkbox" checked={g.ambientOcclusion} onChange={(e) => setG({ ambientOcclusion: e.target.checked })} data-testid="gfx-ao" /> Soft shadows where
                surfaces meet (ambient occlusion: eaves, corners, the cockpit; costs more)
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
            <h5>Light</h5>
            <label className="check">
              <input type="checkbox" checked={ui.prefs.daylightView} onChange={(e) => ctl.setPrefs({ daylightView: e.target.checked })} data-testid="pref-daylight" />
              Daylight view when it is dark: the picture lit as at midday whenever the sun is low or down; the time, tide, wind and traffic stay real
              {ui.light.daylightView ? <span className="fine-inline"> · on now</span> : ui.light.dark ? <span className="fine-inline"> · it is dark now</span> : null}
            </label>
            <p className="fine">Or change the time itself: these restart the scenario at that time of day on the same date (the tide follows); the wind is kept. Real time: now, in today's live weather where the site has it.</p>
            <div className="seg">
              {LIGHTING_PRESETS.map((l) => (
                <button key={l.id} title={l.detail} onClick={() => ctl.leaveTo(`Changing the light to ${l.label.toLowerCase()}`, () => ctl.setLighting(l.id))}>
                  {l.label}
                </button>
              ))}
            </div>
          </>
        )}
        <h4 className="settings-group">Controls</h4>
        <h5>Steering</h5>
        <div className="row left" role="radiogroup" aria-label="Steering keys">
          <label className="check">
            <input type="radio" name="steering" checked={ui.steering === 'bow'} onChange={() => ctl.setSteering('bow')} /> Turn the bow (A / ← bow to port)
          </label>
          <label className="check">
            <input type="radio" name="steering" checked={ui.steering === 'tiller'} onChange={() => ctl.setSteering('tiller')} /> Move the tiller, as on the boat (A / ← tiller to port, bow to starboard)
          </label>
        </div>
        <h5>Interface level</h5>
        <div className="row left wrap" role="radiogroup" aria-label="Interface level" data-testid="level">
          {LEVELS.map((l) => (
            <label key={l.id} className="check" title={l.text}>
              <input type="radio" name="level" checked={ui.level === l.id} onChange={() => ctl.setLevel(l.id)} /> {l.label}
            </label>
          ))}
        </div>
        <p className="fine">{LEVELS.find((l) => l.id === ui.level)?.text} It sets what is shown by default; each part can still be switched on or off.</p>
        <h4 className="settings-group">Help and accessibility</h4>
        <label className="check">
          <input type="checkbox" checked={ui.prefs.lightLabels} onChange={(e) => ctl.setPrefs({ lightLabels: e.target.checked })} data-testid="pref-light-labels" />
          Name the ships' sidelights at night (P port, red; S starboard, green), for anyone who finds red and green hard to tell apart
        </label>
        <label className="check">
          <input type="checkbox" checked={ui.prefs.hints} onChange={(e) => ctl.setPrefs({ hints: e.target.checked })} data-testid="pref-hints" />
          Hints when you are stuck (in irons, sails flapping, aground)
        </label>
        <label className="check">
          <input type="checkbox" checked={ui.prefs.batterySaver} onChange={(e) => ctl.setPrefs({ batterySaver: e.target.checked })} data-testid="pref-battery" />
          Battery saver: draw at most 30 frames a second (the sailing is the same; on by default on phones and tablets)
        </label>
        <label className="check">
          <input type="checkbox" checked={ui.prefs.devTools} onChange={(e) => ctl.setPrefs({ devTools: e.target.checked })} data-testid="pref-dev" />
          Physics and developer tools in the Settings menu (validation dashboard, polar sweep, physics panel, force arrows; on at the Expert level)
        </label>
        <h4 className="settings-group">Sound</h4>
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
        <label className="check">
          <input type="checkbox" checked={ui.prefs.spokenCountdown} onChange={(e) => ctl.setPrefs({ spokenCountdown: e.target.checked })} data-testid="pref-countdown" />
          Spoken start countdown in races (the minutes, 30 and 20 seconds, then from ten), in this device's own voice
          {ui.voice ? <span className="fine-inline"> · {ui.voice}</span> : <span className="fine-inline"> · no voice on this device: nothing will be spoken</span>}
        </label>
        <p className="fine">
          The sounds are made in the browser from the wind, the boat's speed and her sails, and placed round you (the horn at the committee boat, ships'
          whistles at each ship, halyards at the moorings): best on headphones.{' '}
          {ui.recordedSounds.length ? `Recordings in use: ${ui.recordedSounds.join(', ')}.` : 'No recordings are included; any added to the audio folder are used in place of the synthesised sound (docs/SOUND.md).'} The
          countdown uses only voices on this device; nothing is sent anywhere.
        </p>
        <h4 className="settings-group">Troubleshooting</h4>
        <h5>Graphics check</h5>
        <div data-testid="gpu-check">
          <p className="fine">
            Measures how this graphics card draws painted surfaces (hulls, racing marks) and, if they come out black, uses the first drawing mode that
            fixes it. On a graphics card it runs by itself in daylight, 8 s after loading, and shows its result once for each graphics card (and whenever
            it finds a fault). The report stays on this device until you paste or attach it.
          </p>
          <p>
            {ui.materialCheck ? (
              <>
                <strong>{ui.materialCheck.fault ? 'Fault found' : 'Painted surfaces draw correctly'}</strong> ({ui.materialCheck.mode}):{' '}
                {ui.materialCheck.reason}.
              </>
            ) : (
              'Not measured yet.'
            )}
          </p>
          <label>
            Drawing mode{' '}
            <select value={ui.materialMode ?? 'none'} onChange={(e) => ctl.setMaterialMode(e.target.value as 'none' | 'no-reflections' | 'simple-materials')}>
              <option value="none">As built</option>
              <option value="no-reflections">Without sky reflections</option>
              <option value="simple-materials">Simple materials</option>
            </select>
          </label>
          <div className="row left">
            <button onClick={() => ctl.runMaterialCheck()}>Run the check</button>
            <button
              onClick={() => {
                const text = ctl.materialReport();
                void navigator.clipboard?.writeText(text).catch(() => undefined);
                setCopied(true);
              }}
              data-testid="gpu-copy"
            >
              {copied ? 'Report copied' : 'Copy the report'}
            </button>
          </div>
          <p className="fine">
            Graphics card: {ui.gpuName ?? 'unknown'} · build {ui.build.id} ({ui.build.time})
          </p>
        </div>
        <h5>Something looks wrong?</h5>
        <ReportProblem ctl={ctl} />
      </section>
    </div>
  );
}
