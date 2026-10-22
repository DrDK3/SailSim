import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SimController } from '../app/controller';
import { Instruments } from './Instruments';
import { Controls } from './Controls';
import { DebugPanel } from './DebugPanel';
import { ScenarioPanel } from './ScenarioPanel';
import { Help } from './Help';
import type { CameraMode } from '../render/scene';

export function App({ ctl }: { ctl: SimController }) {
  const host = useRef<HTMLDivElement>(null);
  const ui = useSyncExternalStore(ctl.subscribe, ctl.getState);
  const [scenarioOpen, setScenarioOpen] = useState(false);

  useEffect(() => {
    const el = host.current!;
    ctl.attach(el);
    const ro = new ResizeObserver(() => ctl.resize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => {
      ro.disconnect();
      ctl.detach();
    };
  }, [ctl]);

  return (
    <div className="app">
      <div ref={host} className="viewport" data-testid="viewport" />
      {ui.webglError && <div className="banner error" role="alert">{ui.webglError}</div>}
      <Instruments s={ui.snapshot} />
      <nav className="panel toolbar" aria-label="Simulation">
        <button onClick={() => ctl.togglePause()} data-testid="pause">{ui.paused ? 'Resume' : 'Pause'}</button>
        <button onClick={() => ctl.restart()} title="Reset to the scenario start (R)">Reset</button>
        <label className="select">
          Camera
          <select value={ui.camera} onChange={(e) => ctl.setCamera(e.target.value as CameraMode)}>
            <option value="chase">Chase</option>
            <option value="helm">Helm</option>
            <option value="orbit">Orbit (drag)</option>
            <option value="top">Top-down</option>
          </select>
        </label>
        <button aria-pressed={ui.showForces} onClick={() => ctl.toggleForces()} title="Force arrows (F)">Forces</button>
        <button aria-pressed={ui.showDebug} onClick={() => ctl.toggleDebug()} title="Physics panel (G)">Debug</button>
        <button aria-pressed={scenarioOpen} onClick={() => setScenarioOpen(!scenarioOpen)}>Scenario</button>
        <button onClick={() => ctl.toggleHelp()} title="Help (H)">Help</button>
      </nav>
      <div className="side">
        {scenarioOpen && <ScenarioPanel ctl={ctl} ui={ui} onClose={() => setScenarioOpen(false)} />}
        {ui.showDebug && <DebugPanel ui={ui} />}
      </div>
      <Controls ctl={ctl} ui={ui} />
      {ui.paused && <div className="banner">Paused (P to resume)</div>}
      <footer className="badge">
        Phase 1 prototype · open water · wind {ui.scenario.twsKn} kn from {ui.scenario.twdDeg}° · coefficients estimated · not for navigation
      </footer>
      {ui.showHelp && <Help onClose={() => ctl.toggleHelp(false)} />}
    </div>
  );
}
