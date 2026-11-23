import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { SimController, UiState } from '../app/controller';
import { deg, pct } from './format';
import { SLACK_RAD, sailAdvice, sailState } from '../app/sailStatus';
import { plainWords } from '../app/flags';
import { useRef, useState } from 'react';
import { helmAction, type SteeringMode } from '../app/steering';
import { spinnakerWords } from '../app/spinnakerWords';
import { TrustNote } from './trust';

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
    <div className="rudder-dial" title={`${text}. ${mode === 'tiller' ? 'Steering like a tiller: A / ← push it to port, D / → to starboard.' : 'Steering by the bow: A / ← turn the bow to port, D / → to starboard; the tiller goes the other way.'} Or drag the tiller. (Settings → All settings → Controls to change)`} data-testid="tiller">
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

/**
 * A control that acts while held (steering, the sheets). Design handover item 2: it works through every input route.
 * - A pointer (mouse, touch, pen): held from press to release, as before.
 * - The keyboard on the focused button (W3C button pattern): Space or Enter held acts while held; key repeats do
 *   nothing more; the click the browser makes from the key is not acted on again.
 * - A click with no pointer or key behind it (assistive technology, voice control, a switch): one bounded activation
 *   (SimController.tap).
 * Losing the focus lets go; so do the window losing the keys and the page being hidden (the controller).
 */
function Hold({ ctl, action, children, label, hint, className }: { ctl: SimController; action: string; children: ReactNode; label: string; hint?: boolean; className?: string }) {
  const keyHeld = useRef(false);
  const lastKeyAt = useRef(-Infinity);
  const on = (e: ReactPointerEvent) => {
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests, assistive tech) have no capturable pointer; holding still works.
    }
    ctl.press(action, true);
  };
  const off = () => ctl.press(action, false);
  const isActivationKey = (e: ReactKeyboardEvent) => e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar';
  const keyOn = (e: ReactKeyboardEvent) => {
    if (!isActivationKey(e)) return;
    e.preventDefault();
    lastKeyAt.current = performance.now();
    if (keyHeld.current || e.repeat) return;
    keyHeld.current = true;
    ctl.press(action, true);
  };
  const keyOff = (e: ReactKeyboardEvent) => {
    if (!isActivationKey(e)) return;
    e.preventDefault();
    lastKeyAt.current = performance.now();
    if (!keyHeld.current) return;
    keyHeld.current = false;
    ctl.press(action, false);
  };
  const click = (e: ReactMouseEvent) => {
    // A pointer's click (detail ≥ 1) was handled by the press and release; a key's by the key handlers.
    if (e.detail !== 0 || keyHeld.current || performance.now() - lastKeyAt.current < 600) return;
    ctl.tap(action);
  };
  const blur = () => {
    if (keyHeld.current) {
      keyHeld.current = false;
      ctl.press(action, false);
    }
  };
  return (
    <button
      className={`hold${hint ? ' suggest' : ''}${className ? ` ${className}` : ''}`}
      title={label}
      onPointerDown={on}
      onPointerUp={off}
      onPointerCancel={off}
      onPointerLeave={off}
      onKeyDown={keyOn}
      onKeyUp={keyOff}
      onClick={click}
      onBlur={blur}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* The name is the full label, from the content (WCAG 2.5.3, label in name: axe flagged aria-label "Trim main (W)"
          over the visible "Trim W"). The visible face is hidden from the name; the label starts with its word. */}
      <span className="hold-face" aria-hidden="true">
        {children}
      </span>
      <span className="sr-only">{label}</span>
    </button>
  );
}

/**
 * Look up at the masthead while held (review #1): the T key's button. Pointer or keyboard (Space, Enter): the view
 * eases up the mast to the burgee or vane, and back on release. A view change only, never a sailing input.
 */
function LookUp({ ctl, toggle }: { ctl: SimController; toggle: boolean }) {
  // The toggle setting (§3.3): a plain button that switches looking up on and off, its state announced (aria-pressed).
  if (toggle)
    return (
      <button
        className={`hold look-up${ctl.lookingUp ? ' on' : ''}`}
        title={ctl.lookingUp ? 'Look back down (T)' : 'Look up at the masthead (T): the burgee (or vane) shows the wind you sail by; press again to look back'}
        aria-pressed={ctl.lookingUp}
        onClick={() => ctl.lookUpPress(true)}
        data-testid="look-up"
      >
        <span className="hold-face" aria-hidden="true">
          ⇡ <Key k="T" />
        </span>
        <span className="sr-only">Look up at the masthead (T to switch)</span>
      </button>
    );
  const on = (e: ReactPointerEvent) => {
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no capturable pointer.
    }
    ctl.setLookUp(true);
  };
  const off = () => ctl.setLookUp(false);
  const key = (down: boolean) => (e: ReactKeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) ctl.setLookUp(down);
  };
  return (
    <button
      className="hold look-up"
      title="Look up at the masthead while held (T): the burgee (or vane) shows the wind you sail by"
      onPointerDown={on}
      onPointerUp={off}
      onPointerCancel={off}
      onPointerLeave={off}
      onKeyDown={key(true)}
      onKeyUp={key(false)}
      onBlur={off}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="look-up"
    >
      <span className="hold-face" aria-hidden="true">
        ⇡ <Key k="T" />
      </span>
      <span className="sr-only">Look up at the masthead (hold T)</span>
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
  const state = sailState(f, angle);
  // The sail inside the angle its sheet allows: a slack sheet (review #23: easing it moves nothing, and the advice says so).
  const limit = sail === 'main' ? s.mainSheetLimit : s.jibSheetLimit;
  const slack = Math.abs(angle) < limit - SLACK_RAD;
  const st = sailAdvice(state, keys, { sail, sheet, auto, slack, angle, plain: plainWords(ui.level) });
  const ok = st.cls === 'good';
  const name = sail === 'main' ? 'Main' : 'Jib';
  // Which way the sheet is going now (review #23, #24): an arrow on the bar while it moves, whoever works it.
  const move = useRef({ v: sheet, t: 0, dir: 0 });
  const now = performance.now();
  if (Math.abs(sheet - move.current.v) > 0.0015) move.current = { v: sheet, t: now, dir: Math.sign(sheet - move.current.v) };
  const moving = now - move.current.t < 600 ? move.current.dir : 0;
  const moveWord = moving > 0 ? 'easing' : moving < 0 ? 'trimming' : '';
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
        {/* Auto-trim at work (review #24): the toggle reads "Crew trimming" while the crew works the sheet, and the
            arrow on the sheet's bar shows which way. Its name for assistive technology stays "Auto-trim". */}
        <label
          className="toggle"
          title={auto ? `Auto-trim is on: the crew is trimming this sheet; the arrow on the bar shows which way (${sail === 'main' ? 'M' : 'J'} to take it back)` : `Auto-trim: the crew trims this sheet for you (${sail === 'main' ? 'M' : 'J'})`}
          data-word={auto ? 'Crew' : 'Auto'}
          data-testid={`${sail}-auto`}
        >
          <input type="checkbox" checked={auto} aria-label={`Auto-trim, ${name.toLowerCase()}`} onChange={(e) => ctl.setInput(sail === 'main' ? { autoMain: e.target.checked } : { autoJib: e.target.checked })} />
          {auto ? (
            <span data-testid={`${sail}-crew`}>
              Crew<span className="label-more"> trimming</span>
            </span>
          ) : (
            <span>
              Auto<span className="label-more">-trim</span>
            </span>
          )}
        </label>
      </div>
      <div className="mod-row">
        <Hold ctl={ctl} action={sail === 'main' ? 'mainOut' : 'jibOut'} label={`Ease ${sail} (${keys.ease})`} hint={st.action === 'ease'}>Ease <Key k={keys.ease} /></Hold>
        <div
          className="sheet-bar sheet-meter"
          role="meter"
          aria-label={`${name} sheet eased`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(sheet * 100)}
          aria-valuetext={`${pct(sheet)} eased${moveWord ? `, ${auto ? 'the crew is ' : ''}${moveWord}` : ''}${slack ? ', slack' : ''}`}
          title={`Sheet eased ${pct(sheet)}${moveWord ? ` (${auto ? 'crew ' : ''}${moveWord})` : ''}${slack ? ': slack, the wind holds the sail inside the sheet' : ''}`}
          data-testid={`${sail}-sheet`}
          data-moving={moving}
        >
          <div className="sheet-fill" style={{ width: pct(sheet) }} />
          {moving !== 0 && (
            <span className={`sheet-move ${moving > 0 ? 'out' : 'in'}`} style={{ left: `clamp(7px, ${pct(sheet)}, calc(100% - 7px))` }} aria-hidden="true" data-testid={`${sail}-sheet-move`}>
              {moving > 0 ? '▸' : '◂'}
            </span>
          )}
          <span className="sheet-value">
            {pct(sheet)}
            <span className="sheet-word"> eased</span>
          </span>
        </div>
        <Hold ctl={ctl} action={sail === 'main' ? 'mainIn' : 'jibIn'} label={`Trim ${sail} (${keys.trim})`} hint={st.action === 'trim'}>Trim <Key k={keys.trim} /></Hold>
      </div>
    </div>
  );
}

/**
 * The spinnaker's buttons (package B): call it up or down (O), and while it is up, gybe the pole (I). The crew carry
 * each call out; the button says what they are doing, and its state is read out (a polite live region) as it
 * changes. Colour and words agree.
 */
function SpinnakerButtons({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const sp = ui.snapshot.spin;
  if (!sp) return null;
  const w = spinnakerWords(sp, ui.level, ui.snapshot.input.autoSpin === false)!;
  const called = (ui.snapshot.input.spin ?? 0) >= 0.5;
  const plain = plainWords(ui.level);
  const name = plain ? 'the big front sail' : 'the spinnaker';
  return (
    <>
      <button
        className={`spin-call is-${w.tone}`}
        aria-pressed={called}
        onClick={() => ctl.callSpinnaker()}
        title={`${called ? `Drop ${name}` : `Hoist ${name}`} (O). Now: ${w.words}${w.advice ? `: ${w.advice}` : ''}`}
        aria-label={`${called ? `Drop ${name}` : `Hoist ${name}`} (O)`}
        data-testid="spin-call"
      >
        <span aria-hidden="true">
          {called ? 'Drop' : 'Hoist'} <Key k="O" />
        </span>
      </button>
      {sp.phase !== 'down' && (
        <button onClick={() => ctl.gybePole()} title={`Gybe the pole to the other side (I)${plain ? ': the crew move it across' : ''}`} aria-label="Gybe the pole (I)" data-testid="spin-gybe">
          <span aria-hidden="true">
            Pole <Key k="I" />
          </span>
        </button>
      )}
      <span className="sr-only" role="status" aria-live="polite" data-testid="spin-status">
        {w.words}
        {w.advice ? `: ${w.advice}` : ''}
      </span>
    </>
  );
}

/**
 * Expert (review #25): the flattening controls one by one (each follows Flat until moved, and "Follow Flat" hands it
 * back), the jib lead, and the spinnaker trimmed by hand. Effects are estimates (E, docs/PHYSICS.md §23).
 */
function SailControls({ ctl, ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  const s = ui.snapshot;
  const c = s.sailControls ?? { kicker: s.input.flatten ?? 0, cunningham: s.input.flatten ?? 0, outhaul: s.input.flatten ?? 0, jibLead: 0 };
  const row = (k: 'kicker' | 'cunningham' | 'outhaul', label: string, hint: string) => (
    <label className="sc-row">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={s.input[k] ?? c[k]} aria-label={`${label}: ${hint}`} onChange={(e) => ctl.setSailControl(k, Number(e.target.value))} data-testid={`sc-${k}`} />
      <span className="sc-val">{pct(s.input[k] ?? c[k])}</span>
      <button className="link" disabled={s.input[k] === undefined} onClick={() => ctl.setSailControl(k, null)}>Follow Flat</button>
    </label>
  );
  return (
    <div className="panel sail-controls" role="dialog" aria-label="Sail controls" data-testid="sail-controls">
      <div className="sc-head">
        <strong>Sail controls</strong>
        <button onClick={onClose} aria-label="Close the sail controls">Close</button>
      </div>
      {row('kicker', 'Kicker', 'pulls the boom down: a flatter, straighter leech')}
      {row('cunningham', 'Cunningham', 'tightens the luff: the draft forward, less power')}
      {row('outhaul', 'Outhaul', 'stretches the foot: a flatter lower main')}
      <label className="sc-row">
        <span>Jib lead</span>
        <input type="range" min={-1} max={1} step={0.1} value={s.input.jibLead ?? 0} aria-label="Jib lead: aft twists the jib open, forward closes it" onChange={(e) => ctl.setSailControl('jibLead', Number(e.target.value))} data-testid="sc-jibLead" />
        <span className="sc-val">{(s.input.jibLead ?? 0) > 0 ? 'aft' : (s.input.jibLead ?? 0) < 0 ? 'fwd' : 'set'}</span>
        <span />
      </label>
      {s.spin && (
        <label className="sc-row">
          <span>Spinnaker</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={s.input.spinSheet ?? 0.5}
            disabled={s.input.autoSpin !== false}
            aria-label="Spinnaker sheet: 0 trimmed in, 1 eased"
            onChange={(e) => ctl.setSpinnakerTrim(false, Number(e.target.value))}
            data-testid="sc-spinSheet"
          />
          <span className="sc-val">{s.input.autoSpin === false ? pct(s.input.spinSheet ?? 0.5) : 'crew'}</span>
          <label className="toggle">
            <input type="checkbox" checked={s.input.autoSpin !== false} onChange={(e) => ctl.setSpinnakerTrim(e.target.checked)} />
            Crew trim
          </label>
        </label>
      )}
      <p className="fine">Flat moves all three together, as before.</p>
      <TrustNote>The effects are estimates (E).</TrustNote>
    </div>
  );
}

export function Controls({ ctl, ui, onHide }: { ctl: SimController; ui: UiState; onHide?: () => void }) {
  const [sailControls, setSailControls] = useState(false);
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
          <LookUp ctl={ctl} toggle={ui.prefs.lookUpToggle} />
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
              title={`Flatten ${pct(flatten)}: cunningham, outhaul and kicker on, leech twisted open, to depower in a breeze. Less heel and weather helm, less power. Click for more, Shift-click or right-click for less (Z, Shift+Z)`}
              data-tutorial="flatten"
            >
              <span className="hold-face" aria-hidden="true">
                Flat <span className="stepper-value">{pct(flatten)}</span> <Key k="Z" />
              </span>
              <span className="sr-only">{`Flatten the sails: ${pct(flatten)}. Click for more, Shift-click for less (Z, Shift+Z)`}</span>
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
      {/* The spinnaker and Expert's sail controls: a tab on the console's top edge, so no module grows (package B). */}
      {(s.spin || ui.level === 'expert') && (
        <div className="spin-tab" role="group" aria-label="Spinnaker and sail controls">
          <SpinnakerButtons ctl={ctl} ui={ui} />
          {ui.level === 'expert' && (
            <button aria-expanded={sailControls} onClick={() => setSailControls(!sailControls)} title="Kicker, cunningham, outhaul, jib lead and the spinnaker's sheet, one by one" data-testid="sail-controls-open">
              Sails…
            </button>
          )}
        </div>
      )}
      {sailControls && ui.level === 'expert' && <SailControls ctl={ctl} ui={ui} onClose={() => setSailControls(false)} />}
      {onHide && (
        <button className="controls-hide" onClick={onHide} title="Put the controls away (the keys still work; Settings → Sailing controls brings them back)" aria-label="Hide sailing controls">
          <span aria-hidden="true">▾</span>
        </button>
      )}
    </section>
  );
}
