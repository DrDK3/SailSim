import { useEffect, useMemo, useRef, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { AFTER_S, BEFORE_S, RULE_NOTES, frameAt, penaltyText, type BoatPose } from '../app/protestRoom';

const W = 520;
const H = 340;
const LOA = 5.8;
const BEAM = 1.9;

/**
 * The protest room (src/app/protestRoom.ts): your incidents in this race, each watched again from above with the rule
 * the simplified judge applied. Not a protest hearing: the judge covers rules 10–13 and 31 only, and its calls are
 * not authoritative.
 */
export function ProtestRoom({ ctl, ui: _ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  const cases = ctl.protestCases;
  const [sel, setSel] = useState(Math.max(0, cases.length - 1));
  const c = cases[Math.min(sel, cases.length - 1)];
  const [at, setAt] = useState(-BEFORE_S);
  const [playing, setPlaying] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setAt(-BEFORE_S);
    setPlaying(true);
  }, [c?.id]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setAt((a) => {
        const next = a + dt;
        if (next >= AFTER_S) {
          setPlaying(false);
          return AFTER_S;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, c?.id]);

  // The view: centred on the boats involved over the clip, at least 60 m across.
  const view = useMemo(() => {
    if (!c) return undefined;
    const ids = new Set(c.incident.boats);
    const pts = c.frames.flatMap((f) => f.boats.filter((b) => ids.has(b.id)));
    if (!pts.length) return undefined;
    const nMin = Math.min(...pts.map((p) => p.n));
    const nMax = Math.max(...pts.map((p) => p.n));
    const eMin = Math.min(...pts.map((p) => p.e));
    const eMax = Math.max(...pts.map((p) => p.e));
    const span = Math.max(60, (nMax - nMin) * 1.25, ((eMax - eMin) * 1.25 * H) / W);
    const cn = (nMin + nMax) / 2;
    const ce = (eMin + eMax) / 2;
    const k = H / span;
    return { k, toPx: (n: number, e: number) => [W / 2 + (e - ce) * k, H / 2 - (n - cn) * k] as const };
  }, [c?.id, c?.frames.length]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !c || !view) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    if (cv.width !== Math.round(W * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1d4560';
    ctx.fillRect(0, 0, W, H);
    // A 10 m grid for scale.
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let x = (W / 2) % (10 * view.k); x < W; x += 10 * view.k) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = (H / 2) % (10 * view.k); y < H; y += 10 * view.k) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    const t = c.incident.t + at;
    const ids = new Set(c.incident.boats);
    // The involved boats' wakes up to now.
    for (const id of ids) {
      ctx.strokeStyle = id === 'you' ? 'rgba(255,255,255,0.45)' : 'rgba(255,210,120,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      let first = true;
      for (const f of c.frames) {
        if (f.t > t) break;
        const b = f.boats.find((x) => x.id === id);
        if (!b) continue;
        const [x, y] = view.toPx(b.n, b.e);
        if (first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
    }
    const f = frameAt(c.frames, t);
    for (const b of f?.boats ?? []) drawBoat(ctx, view, b, ids.has(b.id), b.id === c.incident.atFault);
    // The wind: an arrow blowing from its direction, top right.
    const wx = W - 34;
    const wy = 34;
    const dx = -Math.sin(c.windFrom);
    const dy = Math.cos(c.windFrom);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx - dx * 16, wy - dy * 16);
    ctx.lineTo(wx + dx * 12, wy + dy * 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(wx + dx * 16, wy + dy * 16);
    ctx.lineTo(wx + dx * 8 - dy * 5, wy + dy * 8 + dx * 5);
    ctx.lineTo(wx + dx * 8 + dy * 5, wy + dy * 8 - dx * 5);
    ctx.closePath();
    ctx.fill();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('wind', wx, wy + 26);
    // The moment of contact.
    if (Math.abs(at) < 0.6) {
      ctx.fillStyle = 'rgba(255, 80, 60, 0.9)';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText('Contact', W / 2, 20);
    }
  }, [c, view, at]);

  if (!c) {
    return (
      <section className="panel dashboard protest-room" aria-label="Protest room" data-testid="protest-room">
        <div className="dash-head">
          <h3>Protest room</h3>
          <button onClick={onClose}>Close</button>
        </div>
        <p className="fine">No incidents involving you in this race. Contacts with another boat or a mark appear here to watch again.</p>
      </section>
    );
  }
  const note = c.incident.rule ? RULE_NOTES[c.incident.rule] : undefined;
  const pen = penaltyText(c.incident);
  return (
    <section className="panel dashboard protest-room" aria-label="Protest room" data-testid="protest-room">
      <div className="dash-head">
        <h3>Protest room</h3>
        {cases.length > 1 && (
          <select value={sel} onChange={(e) => setSel(Number(e.target.value))} aria-label="Incident">
            {cases.map((x, i) => (
              <option key={x.id} value={i}>
                {Math.round(x.incident.t)} s · {x.incident.rule ? `rule ${x.incident.rule}` : x.incident.kind}
              </option>
            ))}
          </select>
        )}
        <button onClick={onClose}>Close</button>
      </div>
      <canvas ref={canvas} style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8 }} role="img" aria-label={`The incident from above: ${c.incident.summary}`} />
      <div className="row left protest-timeline">
        <button onClick={() => (at >= AFTER_S ? (setAt(-BEFORE_S), setPlaying(true)) : setPlaying(!playing))} data-testid="protest-play">
          {playing ? 'Pause' : at >= AFTER_S ? 'Watch again' : 'Play'}
        </button>
        <input type="range" min={-BEFORE_S} max={AFTER_S} step={0.2} value={at} onChange={(e) => (setPlaying(false), setAt(Number(e.target.value)))} aria-label="Time before the contact" />
        <span className="fine-inline">{at < 0 ? `${(-at).toFixed(1)} s before` : at < 0.1 ? 'contact' : `${at.toFixed(1)} s after`}</span>
      </div>
      <p data-testid="protest-summary">
        <strong>{c.incident.summary}</strong>
      </p>
      {note && (
        <>
          <h4>{note.title}</h4>
          <p>{note.says}</p>
          <p>
            <em>What could have been done:</em> {note.couldHave}
          </p>
        </>
      )}
      {pen && <p>{pen}</p>}
      {c.incident.notes.length > 0 && (
        <ul className="fine">
          {c.incident.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <p className="fine">
        A simplified judge, not a protest hearing: it applies rules 10–13 and 31 only (not mark-room, obstructions, exoneration or redress), and the rules
        are paraphrased here; the Racing Rules of Sailing 2025–2028 are the authority.
      </p>
    </section>
  );
}

function drawBoat(ctx: CanvasRenderingContext2D, view: { k: number; toPx: (n: number, e: number) => readonly [number, number] }, b: BoatPose, involved: boolean, atFault: boolean): void {
  const [x, y] = view.toPx(b.n, b.e);
  const k = Math.max(view.k, 1.6);
  const L = LOA * k;
  const B = BEAM * k;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(b.heading);
  ctx.beginPath();
  ctx.moveTo(0, -L / 2);
  ctx.quadraticCurveTo(B / 2, -L / 6, B / 2, L / 2);
  ctx.lineTo(-B / 2, L / 2);
  ctx.quadraticCurveTo(-B / 2, -L / 6, 0, -L / 2);
  ctx.closePath();
  ctx.fillStyle = !involved ? 'rgba(255,255,255,0.25)' : b.id === 'you' ? '#ffffff' : '#ffd27a';
  ctx.fill();
  ctx.lineWidth = atFault ? 2.5 : 1;
  ctx.strokeStyle = atFault ? '#ff5a3c' : '#08101a';
  ctx.stroke();
  // The boom: from the mast, aft and out on the side the main is set.
  ctx.strokeStyle = '#08101a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -L / 10);
  ctx.lineTo((b.mainSide > 0 ? -1 : 1) * B * 0.8, L * 0.32);
  ctx.stroke();
  ctx.restore();
  if (involved) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.label, x, y - L / 2 - 6);
  }
}
