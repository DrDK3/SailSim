import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SimController } from './app/controller';
import { App } from './ui/App';
import { runDeterminismProbe, runDeterminismState } from './sim/testing/determinism';
import './ui/styles.css';

const ctl = new SimController();

// Test and debugging hooks (types in src/app/hooks.d.ts).
window.__squib = {
  snapshot: () => {
    const s = ctl.sim.snapshot();
    return { t: s.t, n: s.n, e: s.e, heading: s.heading, stw: s.stw, heel: s.heel, boomMain: s.boomMain, rudder: s.rudder, mainSide: s.mainSide };
  },
  input: () => ({ ...ctl.sim.input }),
  determinism: runDeterminismProbe,
  determinismState: runDeterminismState,
  advance: (seconds: number) => ctl.advance(seconds),
  controller: ctl,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App ctl={ctl} />
  </StrictMode>,
);
