import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SimController } from './app/controller';
import { App } from './ui/App';
import { AiSkipper, aiSkill, type AiLevel } from './sim/ai/skipper';
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
  // Tests only: the AI on the helm of your own boat in a race (its inputs are logged as yours, so a replay repeats
  // them). Used to finish a course in the end-to-end tests without hours of software rendering.
  aiHelm: (level: AiLevel = 'good') => {
    const s = ctl.race?.session;
    const you = s?.fleet.boat('you');
    if (!s || !you) return false;
    const sk = new AiSkipper(you, s, aiSkill(level, 1, 0, 1), 0);
    you.sim.controller = (sim) => sk.control(sim);
    return true;
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App ctl={ctl} />
  </StrictMode>,
);
