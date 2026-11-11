import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { SimController, UiState } from '../app/controller';
import { deg, pct } from './format';
import { sailAdvice, sailState } from '../app/sailStatus';
import { helmAction, type SteeringMode } from '../app/steering';

/**
 * The helm console (owner review, 5 Nov 2026, third: "not looking good … too much white space … lacks the
 * immersive experience … the height expands as the rudder moves"). The sailing controls as four instrument-like
 * modules side by side, MAIN, JIB, HELM and BOAT, each exactly two rows tall, every readout of a fixed width and
 * no text that wraps: the console never changes size as the rudder, the sheets or the sails' states change.
 *  - A sail: its name, its state as a coloured pill (Drawing, Luffing, Stalled, By the lee) and the Auto-trim
 *    switch; under them Ease, a meter of how far the sheet is eased, and Trim. When the sail needs something done,
 *    the button that does it glows (Trim when it luffs, Ease when it stalls), so a novice sees what to press and
 *    an expert reads the state at a glance; the advice in words is in the pill's tooltip and read out with it.
 *  - The helm: steer either way either side of the rudder and tiller seen from above; under them where the bow
 *    is turning, in a fixed-width readout, and Centre.
 *  - The boat: release both sheets and flatten the sails (in the keys' 25% steps); the crew on auto, or hiking in
 *    the same steps by hand.
 */

/**
 * The tiller from above (review UX-8): the after end of the cockpit, the rudder blade and the tiller, at the
 * simulation's rudder angle. The bow turns the way the blade's trailing edge points, so the tiller always lies
 * the other way: push the tiller to port and the bow goes to starboard. Drawn in both steering modes; the whole
 * sentence is read out (and shown on hover), the console shows the short readout under it.
 */
export function TillerView({ rudder, mode }: { rudder: number; mode: SteeringMode }) {
  const d = (Math.abs(rudder) * 180) / Math.PI;
  const centred = d < 0.5;
  const bow = rudder > 0 ? 'starboard' : 'port';
  const tiller = rudder > 0 ? 'port' : 'starboard';
  // The picture exaggerates the angle a little so that small helm movements show.
  const a = Math.max(-1.2, Math.min(1.2, rudder * 1.5));
  const stock = { x: 0, y: 30 };
  const tip = { x: -Math.sin(a) * 25, y: stock.y - Math.cos(a) * 25 };
  const blade = { x: Math.sin(a) * 9, y: stock.y + Math.cos(a) * 9 };
  const text = centred ? 'Tiller centred' : `Tiller ${Math.round(d)}° to ${tiller} · bow turning to ${bow}`;
  return (
    <div className="rudder-dial" title={`${text}. ${mode === 'tiller' ? 'Steering like a tiller: A / ← push it to port, D / → to starboard.' : 'Steering by the bow: A / ← turn the bow to port, D / → to starboard; the tiller goes the other way.'} Or drag the tiller. (More → Settings → Controls to change)`} data-testid="tiller">
      <svg viewBox="-34 -2 68 44" aria-hidden="true" className="tiller-svg">
        <path className="tv-hull" d="M -30 -2 L -27 28 Q -24 36 -16 37 L 16 37 Q 24 36 27 28 L 30 -2" />
        <line className="tv-blade" x1={stock.x} y1={stock.y} x2={blade.x} y2={blade.y} />
        <line className="tv-tiller" x1={stock.x} y1={stock.y} x2={tip.x} y2={tip.y} />
        <circle className="tv-stock" cx={stock.x} cy={stock.y} r="2.2" />
      </svg>
      <span className="sr-only">{text}</span>
    </div>
  );
}

/**
 * The tiller picture as a control (phones and tablets; a mouse works too): drag it and the tiller follows the finger,
 * at the keys' rate; let go and it comes back to the middle, as with the keys. Push it to port and the bow turns to
 * starboard, whichever steering mode the keys use, because it is the tiller you are moving.
 */
function DragTiller({ ctl, rudder, mode }: { ctl: SimController; rudder: number; mode: SteeringMode }) {
  const target = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    // The tip to the left (port) is the helm to starboard (+): the bow turns to starboard.
    return -((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 1.4;
  };
  return (
    <div
      className="tiller-drag"
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic events have no capturable pointer.
        }
        ctl.setHelmDrag(target(e));
      }}
      onPointerMove={(e) => {
        if (e.buttons || e.pointerType === 'touch') ctl.setHelmDrag(target(e));
      }}
      onPointerUp={() => ctl.setHelmDrag(undefined)}
      onPointerCancel={() => ctl.setHelmDrag(undefined)}
      data-testid="tiller-drag"
    >
      <TillerView rudder={rudder} mode={mode} />
    </div>
  );
}

/** Where the bow is turning, in a few characters of fixed width: "Straight", "12° → stbd", "35° → port". */
export function helmReadout(rudder: number): string {
  const d = Math.round((Math.abs(rudder) * 180) / Math.PI);
  if (d < 1) return 'Straight';
  return `${d}° → ${rudder > 0 ? 'stbd' : 'port'}`;
}

function Hold({ ctl, action, children, label, hint, className }: { ctl: SimController; action: string; children: ReactNode; label: string; hint?: boolean; className?: string }) {
  const on = (e: ReactPointerEvent) => {
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests, assistive tech) have no capturable pointer; holding still works.
    }
    ctl.press(action, true);
  };
  const off = () => ctl.press(action, false);
  return (
    <button
      className={`hold${hint ? ' suggest' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      onPointerDown={on}
      onPointerUp={off}
      onPointerCancel={off}
      onPointerLeave={off}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/** A key name shown on a button, for recognition rather than recall. */
const Key = ({ k }: { k: string }) => <kbd className="key-hint" aria-hidden="true">{k}</kbd>;

/** The next of the 25% steps the keys use (Z, Shift+Z): forward with a click, back with Shift or a right click. */
function step(v: number, back: boolean): number {
  const q = Math.round(v * 4);
  return (back ? (q + 4) % 5 : (q + 1) % 5) / 4;
}

function SailModule({ ctl, ui, sail }: { ctl: SimController; ui: UiState; sail: 'main' | 'jib' }) {
  const s = ui.snapshot;
  const f = sail === 'main' ? s.forces.main : s.forces.jib;
  const auto = sail === 'main' ? s.input.autoMain : s.input.autoJib;
  const sheet = ctl.sim.currentSheet(sail);
  const angle = sail === 'main' ? s.boomMain : s.boomJib;
  const keys = sail === 'main' ? { trim: 'W', ease: 'S' } : { trim: 'E', ease: 'Q' };
  const state = sailState(f);
  const st = sailAdvice(state, keys);
  const ok = st.cls === 'good';
  const name = sail === 'main' ? 'Main' : 'Jib';
  return (
    <div className={`mod sail-mod is-${st.cls}`} data-tutorial={sail} role="group" aria-label={`${name} sheet`}>
      <div className="mod-top">
        <span className="mod-label" aria-hidden="true">{name}</span>
        <span
          className={`status ${st.cls}`}
          title={`${st.text}: ${st.advice}. Angle of the airflow on the sail (α) ${deg(Math.abs(f.incidence))}°, sail ${deg(Math.abs(angle))}° off the centreline`}
          data-testid={`${sail}-status`}
          role="status"
        >
          <span className="dot" aria-hidden="true" />
          <strong>{st.text}</strong>
          {!ok && <span className="sr-only"> · {st.advice}</span>}
        </span>
        <label className="toggle" title={`Auto-trim: the crew trims this sheet for you (${sail === 'main' ? 'M' : 'J'})`}>
          <input type="checkbox" checked={auto} onChange={(e) => ctl.setInput(sail === 'main' ? { autoMain: e.target.checked } : { autoJib: e.target.checked })} />
          <span>
            Auto<span className="label-more">-trim</span>
          </span>
        </label>
      </div>
      <div className="mod-row">
        <Hold ctl={ctl} action={sail === 'main' ? 'mainOut' : 'jibOut'} label={`Ease ${sail} (${keys.ease})`} hint={state === 'stalled'}>Ease <Key k={keys.ease} /></Hold>
        <div
          className="sheet-bar sheet-meter"
          role="meter"
          aria-label={`${name} sheet eased`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(sheet * 100)}
          title={`Sheet eased ${pct(sheet)}`}
          data-testid={`${sail}-sheet`}
        >
          <div className="sheet-fill" style={{ width: pct(sheet) }} />
          <span className="sheet-value">
            {pct(sheet)}
            <span className="sheet-word"> eased</span>
          </span>
        </div>
        <Hold ctl={ctl} action={sail === 'main' ? 'mainIn' : 'jibIn'} label={`Trim ${sail} (${keys.trim})`} hint={state === 'luffing'}>Trim <Key k={keys.trim} /></Hold>
      </div>
    </div>
  );
}

export function Controls({ ctl, ui, onHide }: { ctl: SimController; ui: UiState; onHide?: () => void }) {
  const s = ui.snapshot;
  const tillerMode = ui.steering === 'tiller';
  // At the Learn level the console leaves out the advanced controls (src/app/level.ts); the keys still work.
  const advanced = ui.level !== 'learn';
  const flatten = s.input.flatten ?? 0;
  const stepFlatten = (e: ReactMouseEvent) => {
    e.preventDefault();
    ctl.setInput({ flatten: step(flatten, e.shiftKey || e.type === 'contextmenu') });
  };
  const stepHike = (e: ReactMouseEvent) => {
    e.preventDefault();
    ctl.setInput({ crewHike: step(s.input.crewHike, e.shiftKey || e.type === 'contextmenu') });
  };
  return (
    <section className="panel controls dock console" aria-label="Sailing controls">
      <SailModule ctl={ctl} ui={ui} sail="main" />
      <SailModule ctl={ctl} ui={ui} sail="jib" />
      <div className="mod helm-mod" data-tutorial="helm" role="group" aria-label="Helm">
        <div className="mod-row">
          <Hold ctl={ctl} action={helmAction('left', ui.steering)} label={tillerMode ? 'Tiller to port, bow to starboard (A / ←)' : 'Steer to port (A / ←)'}>◀ <Key k="A" /></Hold>
          <DragTiller ctl={ctl} rudder={s.rudder} mode={ui.steering} />
          <Hold ctl={ctl} action={helmAction('right', ui.steering)} label={tillerMode ? 'Tiller to starboard, bow to port (D / →)' : 'Steer to starboard (D / →)'}><Key k="D" /> ▶</Hold>
        </div>
        <div className="mod-row">
          <span className="helm-readout" aria-hidden="true">{helmReadout(s.rudder)}</span>
          <button onClick={() => ctl.centreHelm()} title="Centre the helm (Space)">Centre</button>
        </div>
      </div>
      <div className="mod boat-mod" role="group" aria-label="Crew and sails">
        <div className="mod-row">
          <button onClick={() => ctl.releaseSheets()} title="Release both sheets: the sails luff and stop driving. To stop the boat, also turn head to wind (X)" data-tutorial="release">Release <Key k="X" /></button>
          {advanced && (
            <button
              className="stepper"
              onClick={stepFlatten}
              onContextMenu={stepFlatten}
              aria-label={`Flatten the sails: ${pct(flatten)}. Click for more, Shift-click for less (Z, Shift+Z)`}
              title={`Flatten ${pct(flatten)}: cunningham, outhaul and kicker on, leech twisted open, to depower in a breeze. Less heel and weather helm, less power. Click for more, Shift-click or right-click for less (Z, Shift+Z)`}
              data-tutorial="flatten"
            >
              Flat <span className="stepper-value">{pct(flatten)}</span> <Key k="Z" />
            </button>
          )}
        </div>
        <div className="mod-row">
          <label className="toggle" title="Crew move to keep the boat upright (K)" data-tutorial="crew">
            <input type="checkbox" checked={s.input.autoCrew} onChange={(e) => ctl.setInput({ autoCrew: e.target.checked })} />
            Auto crew
          </label>
          {advanced && !s.input.autoCrew && (
            <button
              className="stepper"
              onClick={stepHike}
              onContextMenu={stepHike}
              aria-label={`Crew hiking out: ${pct(s.input.crewHike)}. Click for more, Shift-click for less`}
              title={`Crew weight out to windward: ${pct(s.input.crewHike)}. Click for more, Shift-click or right-click for less`}
            >
              Hike <span className="stepper-value">{pct(s.input.crewHike)}</span>
            </button>
          )}
        </div>
      </div>
      {onHide && (
        <button className="controls-hide" onClick={onHide} title="Put the controls away (the keys still work; More → Sailing controls brings them back)" aria-label="Hide sailing controls">
          <span aria-hidden="true">▾</span>
        </button>
      )}
    </section>
  );
}
