import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RaceUi, SimController } from '../app/controller';
import { edgePointer, type Box } from '../app/edgePointer';
import { ordinal } from '../app/raceStory';

/**
 * The race at a glance (owner, 18 Nov 2026): a large countdown at the top centre for the last minute before the
 * start; an arrow at the screen's edge to the next mark (or the starting line) with its distance when that is out of
 * view; and, on a phone, the race panel as one line. The race panel keeps the same facts as text for screen readers,
 * so these are decoration to them (aria-hidden), not a second announcement.
 */

/** Whether the window is phone-narrow (the layout's 700 px break). */
export function useNarrow(): boolean {
  const query = '(max-width: 700px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    on();
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** m:ss for the last minute, the bare seconds for the last ten. */
export function countdownText(toStart: number): string {
  const s = Math.max(0, Math.ceil(toStart));
  return s <= 10 ? String(s) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Whether the big countdown shows: the last minute before the start signal, and "Start" for two seconds after it. */
export function countdownShows(race: Pick<RaceUi, 'phase' | 'toStart'>): 'count' | 'go' | undefined {
  if (race.phase === 'finished') return undefined;
  if (race.toStart > 0 && race.toStart <= 60) return 'count';
  if (race.toStart <= 0 && race.toStart > -2) return 'go';
  return undefined;
}

export function StartCountdown({ race, top }: { race: RaceUi; top?: number }) {
  const shows = countdownShows(race);
  // Below a message in the slot it shares the top centre with (a coach's tip, a hint), when one is showing.
  const [below, setBelow] = useState(0);
  useLayoutEffect(() => {
    if (!shows) return;
    let bottom = 0;
    for (const el of document.querySelectorAll('.coach-tip, .hint-card')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) bottom = Math.max(bottom, r.bottom);
    }
    if (Math.abs(bottom - below) > 1) setBelow(bottom);
  });
  if (!shows) return null;
  const last = shows === 'count' && race.toStart <= 10;
  const at = below > 0 ? Math.max(top ?? 0, below + 8) : top;
  return (
    <div className={`race-countdown${last ? ' last' : ''}${shows === 'go' ? ' go' : ''}`} style={at === undefined ? undefined : { top: at }} aria-hidden="true" data-testid="big-countdown">
      {shows === 'go' ? 'Start' : countdownText(race.toStart)}
    </div>
  );
}

const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`);

/** An arrow pointing straight up, turned by its parent. */
function Arrow({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.5 20 14h-5v7.5H9V14H4z" fill="currentColor" stroke="rgba(8,16,24,0.9)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

const rectOf = (el: Element | null): Box | undefined => {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : undefined;
};

/**
 * The arrow to the race's target when it is out of view. Placed every frame from the camera (smooth while the view
 * turns), outside React's rendering; the panels' places are read twice a second.
 */
export function MarkPointer({ ctl }: { ctl: SimController }) {
  const el = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let boxesAt = -Infinity;
    let safe: Box = { l: 0, t: 0, r: window.innerWidth, b: window.innerHeight };
    let avoid: Box[] = [];
    let shownText = '';
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const node = el.current;
      if (!node) return;
      const target = ctl.raceTarget;
      const ndc = target ? ctl.screenOf(target.n, target.e) : undefined;
      if (!target || !ndc) {
        node.dataset.shown = '0';
        return;
      }
      if (now - boxesAt > 500) {
        boxesAt = now;
        const w = window.innerWidth;
        const h = window.innerHeight;
        const bar = rectOf(document.querySelector('nav.toolbar'));
        const dock = rectOf(document.querySelector('.dock-wrap')) ?? rectOf(document.querySelector('.panel.dock'));
        // The toolbar spans the top on a wide screen; on a phone it is a button in the corner (avoided, not a band).
        const band = bar && bar.r - bar.l > w * 0.5;
        safe = { l: 0, t: band ? bar.b : 0, r: w, b: dock ? dock.t : h };
        avoid = ['.hud-left', '.minimap', '.side', '.race-countdown', '.camera-bar', '.race-strip', ...(band ? [] : ['nav.toolbar'])]
          .flatMap((q) => [...document.querySelectorAll(q)])
          .map(rectOf)
          .filter((b): b is Box => !!b);
      }
      // The words first, so that the size measured is the size drawn (hidden by visibility, so it always has one).
      const label = `${target.label} · ${metres(target.distanceM)}`;
      if (label !== shownText && text.current) {
        shownText = label;
        text.current.textContent = label;
      }
      const half = { x: node.offsetWidth / 2 || 70, y: node.offsetHeight / 2 || 16 };
      const p = edgePointer(ndc, { w: window.innerWidth, h: window.innerHeight }, safe, avoid, 10, half);
      node.dataset.shown = p.onScreen ? '0' : '1';
      if (p.onScreen) return;
      node.style.transform = `translate(${Math.round(p.x - half.x)}px, ${Math.round(p.y - half.y)}px)`;
      if (arrow.current) arrow.current.style.transform = `rotate(${p.angleDeg.toFixed(1)}deg)`;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ctl]);
  return (
    <div ref={el} className="mark-pointer" data-shown="0" aria-hidden="true" data-testid="mark-pointer">
      <span ref={arrow} className="mark-pointer-arrow">
        <Arrow />
      </span>
      <span ref={text} className="mark-pointer-text" />
    </div>
  );
}

/**
 * The race in one line, for a phone (the full panel covered the water): the countdown or your place, the next mark
 * with its distance and an arrow to it (up = ahead in the view), and anything that needs you now (over the line, a
 * penalty owed). Tap for the full panel.
 */
export function RaceStrip({ race, ctl, open, onToggle }: { race: RaceUi; ctl: SimController; open: boolean; onToggle: () => void }) {
  const target = ctl.raceTarget;
  const secs = Math.max(0, Math.ceil(race.toStart));
  const lead =
    race.phase === 'pre-start'
      ? race.toStart > 0
        ? secs <= 10
          ? String(secs)
          : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
        : race.ocs
          ? 'OCS'
          : 'Go'
      : race.phase === 'finished'
        ? 'Finished'
        : race.position !== undefined
          ? ordinal(race.position)
          : `Leg ${Math.min(race.legIndex + 1, race.legCount)}/${race.legCount}`;
  const placed = race.phase === 'racing' && race.position !== undefined;
  const alert = race.disqualified ? 'Disqualified' : race.ocs && race.toStart <= 0 ? 'Over the line: go back' : race.penaltyOwed > 0 ? `Penalty: ${race.penaltyOwed} turn${race.penaltyOwed === 1 ? '' : 's'}` : undefined;
  const rel = target ? (Math.atan2(target.e - ctl.getState().snapshot.e, target.n - ctl.getState().snapshot.n) - ctl.viewHeading) * (180 / Math.PI) : 0;
  return (
    <button className={`panel race-strip${alert ? ' alert' : ''}`} onClick={onToggle} aria-expanded={open} aria-label={`Race: ${lead}${placed ? ` of ${race.fleetSize}` : ''}${target ? `, ${target.label} ${metres(target.distanceM)}` : ''}${alert ? `, ${alert}` : ''}. ${open ? 'Hide' : 'Show'} the race panel`} data-testid="race-strip">
      <span className="race-strip-lead" data-testid="race-strip-lead">
        {lead}
        {placed && <span className="race-strip-of">/{race.fleetSize}</span>}
      </span>
      {alert ? (
        <span className="race-strip-alert">{alert}</span>
      ) : (
        race.shift && race.shift.call !== 'steady' && <span className={`race-strip-shift ${race.shift.call}`}>{race.shift.call === 'lifted' ? 'Lifted' : 'Headed'} {race.shift.deg}°</span>
      )}
      {target && (
        <span className="race-strip-next">
          <span className="race-strip-arrow" style={{ transform: `rotate(${rel.toFixed(0)}deg)` }}>
            <Arrow size={16} />
          </span>
          <span className="race-strip-label">{target.short}</span>
          <span className="race-strip-dist">{metres(target.distanceM)}</span>
        </span>
      )}
      <span className="race-strip-more" aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
  );
}
