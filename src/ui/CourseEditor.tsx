import { useEffect, useMemo, useRef, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { allCourses, deleteUserCourse, saveUserCourse, PRACTICE_KINDS } from '../app/courseLibrary';
import { markPosition, parseCourse } from '../sim/course/course';
import { practiceCourse } from '../sim/course/practice';
import { validateCourse, type CourseIssue } from '../sim/course/validate';
import { COURSE_SCHEMA, type Course, type CourseLeg, type CourseMark } from '../sim/course/types';
import { DART_PROJECTION } from '../sim/geo/projection';

const W = 620;
const H = 560;
const KINDS: CourseMark['kind'][] = ['inflatable', 'pin', 'committee-boat', 'nav-buoy', 'fixed', 'virtual'];

function blankCourse(centre: { n: number; e: number }): Course {
  return {
    schema: COURSE_SCHEMA,
    id: `user-${Date.now().toString(36)}`,
    name: 'New course',
    status: 'simulated',
    provenance: { kind: 'user', notes: 'Drawn in the course editor.' },
    marks: [
      { id: 'S1', name: 'Pin end', kind: 'pin', position: { n: Math.round(centre.n), e: Math.round(centre.e - 40) } },
      { id: 'S2', name: 'Committee boat', kind: 'committee-boat', position: { n: Math.round(centre.n), e: Math.round(centre.e + 40) } },
      { id: 'M1', name: 'Mark 1', kind: 'inflatable', position: { n: Math.round(centre.n + 400), e: Math.round(centre.e) } },
    ],
    start: { ends: ['S1', 'S2'] },
    legs: [{ type: 'mark', mark: 'M1', rounding: 'port' }],
    laps: 1,
    finish: { ends: ['S1', 'S2'] },
  };
}

const local = (m: CourseMark) => markPosition(m.position, DART_PROJECTION);

/**
 * Course editor: draw, inspect and sequence marks on the River Dart map, set rounding sides, gates, start and
 * finish lines and boundaries, check the course live with the validator, and import/export the JSON. Club courses
 * are entered here from their document (status pending-check) and can be marked verified by a named checker.
 */
export function CourseEditor({ ctl, ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  const start = ctl.race?.course ?? null;
  const [course, setCourse] = useState<Course>(() => structuredClone(start ?? blankCourse({ n: ctl.sim.state.n, e: ctl.sim.state.e })));
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'select' | 'add'>('select');
  const [view, setView] = useState(() => {
    const ps = course.marks.map(local);
    const n = ps.reduce((a, p) => a + p.n, 0) / ps.length;
    const e = ps.reduce((a, p) => a + p.e, 0) / ps.length;
    const span = Math.max(300, ...ps.map((p) => Math.hypot(p.n - n, p.e - e) * 2.6));
    return { n, e, scale: Math.min(W, H) / span };
  });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [message, setMessage] = useState<string>('');
  const [importText, setImportText] = useState('');
  const drag = useRef<{ kind: 'mark' | 'pan'; id?: string; x: number; y: number; n: number; e: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const data = ctl.dartData;
  const m = data?.manifest;

  useEffect(() => {
    if (!data?.minimapUrl) return;
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = data.minimapUrl;
  }, [data?.minimapUrl]);

  const validation = useMemo(() => validateCourse(course, ctl.validationContext()), [course, ctl, ui.dart.status]);
  const errorsAt = (pred: (i: CourseIssue) => boolean) => validation.issues.some((i) => i.severity === 'error' && pred(i));
  const pos = new Map(course.marks.map((mk) => [mk.id, local(mk)]));
  const toPx = (n: number, e: number) => [W / 2 + (e - view.e) * view.scale, H / 2 - (n - view.n) * view.scale] as const;
  const fromPx = (x: number, y: number) => ({ n: view.n - (y - H / 2) / view.scale, e: view.e + (x - W / 2) / view.scale });
  const svgXY = (ev: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return [((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * H] as const;
  };

  const update = (f: (c: Course) => Course) => setCourse((c) => f(structuredClone(c)));
  const setMark = (id: string, patch: Partial<CourseMark>) => update((c) => ({ ...c, marks: c.marks.map((mk) => (mk.id === id ? { ...mk, ...patch } : mk)) }));
  const newId = () => {
    let k = course.marks.length + 1;
    while (course.marks.some((mk) => mk.id === `M${k}`)) k++;
    return `M${k}`;
  };

  const onPointerDown = (ev: React.PointerEvent<SVGSVGElement>) => {
    const [x, y] = svgXY(ev);
    const target = (ev.target as Element).closest('[data-mark]');
    if (target) {
      const id = target.getAttribute('data-mark')!;
      setSelected(id);
      const p = pos.get(id)!;
      drag.current = { kind: 'mark', id, x, y, n: p.n, e: p.e };
    } else if (mode === 'add') {
      const p = fromPx(x, y);
      const id = newId();
      update((c) => ({ ...c, marks: [...c.marks, { id, name: `Mark ${id.slice(1)}`, kind: 'inflatable', position: { n: Math.round(p.n), e: Math.round(p.e) } }] }));
      setSelected(id);
      setMode('select');
    } else {
      drag.current = { kind: 'pan', x, y, n: view.n, e: view.e };
    }
    (ev.currentTarget as SVGSVGElement).setPointerCapture(ev.pointerId);
  };
  const onPointerMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = svgXY(ev);
    if (d.kind === 'pan') setView((v) => ({ ...v, n: d.n + (y - d.y) / v.scale, e: d.e - (x - d.x) / v.scale }));
    else if (d.id) setMark(d.id, { position: { n: Math.round(d.n - (y - d.y) / view.scale), e: Math.round(d.e + (x - d.x) / view.scale) } });
  };
  const onWheel = (ev: React.WheelEvent<SVGSVGElement>) => {
    const [x, y] = svgXY(ev);
    const p = fromPx(x, y);
    const k = ev.deltaY < 0 ? 1.25 : 0.8;
    setView((v) => {
      const scale = Math.min(4, Math.max(0.02, v.scale * k));
      return { scale, n: p.n + (y - H / 2) / scale, e: p.e - (x - W / 2) / scale };
    });
  };

  const sel = course.marks.find((mk) => mk.id === selected);
  const selPos = sel ? local(sel) : undefined;
  const geo = data?.geo;
  const depth = (p: { n: number; e: number }, levelOdn: number) => (geo ? geo.depth(p.n, p.e, levelOdn) : NaN);
  const ll = selPos ? DART_PROJECTION.toLatLon(selPos.n, selPos.e) : undefined;

  const legLines: { a: { n: number; e: number }; b: { n: number; e: number }; i: number }[] = [];
  if (validation.resolved) {
    const r = validation.resolved;
    const lap1 = r.legs.filter((l) => l.lap === 1);
    const mid = (a: { n: number; e: number }, b: { n: number; e: number }) => ({ n: (a.n + b.n) / 2, e: (a.e + b.e) / 2 });
    let prev = mid(r.start[0], r.start[1]);
    lap1.forEach((l, i) => {
      legLines.push({ a: prev, b: l.target, i });
      prev = l.target;
    });
    legLines.push({ a: prev, b: mid(r.finish[0], r.finish[1]), i: lap1.length });
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(course, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${course.id}.course.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = (text: string) => {
    try {
      const { course: c, errors } = parseCourse(JSON.parse(text));
      if (!c) return setMessage(`Not imported: ${errors.join('; ')}`);
      setCourse(c);
      setSelected(null);
      setMessage(`Imported "${c.name}".`);
    } catch (err) {
      setMessage(`Not imported: ${(err as Error).message}`);
    }
  };
  const sail = () => {
    const saved = saveUserCourse(course);
    const choice = saved ? { source: 'library' as const, id: course.id } : { source: 'inline' as const, course };
    ctl.leaveTo('Sailing this course', () => {
      if (ctl.restart({ ...ctl.scenario, course: choice, race: ctl.scenario.race ?? { sequence: 'one-minute', startInS: 90 } })) onClose();
      else setMessage(ctl.getState().scenarioError ?? 'Could not start this course.');
    });
  };
  const prov = course.provenance;
  const setProv = (patch: Partial<Course['provenance']>) => update((c) => ({ ...c, provenance: { ...c.provenance, ...patch } }));

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Course editor">
      <section className="panel editor" onClick={(e) => e.stopPropagation()}>
        <div className="dash-head">
          <h3>Course editor</h3>
          <div className="row tight">
            <button onClick={sail} className="primary" disabled={!validation.ok}>Save and sail</button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="editor-body">
          <div className="editor-map">
            <div className="row tight left">
              <button aria-pressed={mode === 'add'} onClick={() => setMode(mode === 'add' ? 'select' : 'add')}>{mode === 'add' ? 'Click the map to place the mark…' : 'Add mark'}</button>
              <span className="fine-inline">Drag marks to move them; drag the map to pan; scroll to zoom.</span>
            </div>
            <svg ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} data-testid="editor-map" role="img" aria-label="Course map"
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)} onWheel={onWheel}>
              <rect width={W} height={H} fill="#1f4b6b" />
              {img && m && (() => {
                const [x0, y0] = toPx(m.domain.nMax, m.domain.eMin);
                const [x1, y1] = toPx(m.domain.nMin, m.domain.eMax);
                return <image href={img.src} x={x0} y={y0} width={x1 - x0} height={y1 - y0} preserveAspectRatio="none" />;
              })()}
              {legLines.map((l) => {
                const [x0, y0] = toPx(l.a.n, l.a.e);
                const [x1, y1] = toPx(l.b.n, l.b.e);
                const bad = errorsAt((i) => i.leg === l.i);
                return <line key={l.i} x1={x0} y1={y0} x2={x1} y2={y1} className={`ed-leg${bad ? ' bad' : ''}`} />;
              })}
              {[['start', course.start.ends], ['finish', course.finish.ends], ...(course.boundaries ?? []).map((b) => ['boundary', b.ends] as const)].map(([which, ends], i) => {
                const a = pos.get(ends[0]);
                const b = pos.get(ends[1]);
                if (!a || !b) return null;
                const [x0, y0] = toPx(a.n, a.e);
                const [x1, y1] = toPx(b.n, b.e);
                return <line key={`l${i}`} x1={x0} y1={y0} x2={x1} y2={y1} className={`ed-line ${which}${errorsAt((x) => x.line === which) ? ' bad' : ''}`} />;
              })}
              {course.marks.map((mk) => {
                const p = pos.get(mk.id)!;
                const [x, y] = toPx(p.n, p.e);
                const bad = errorsAt((i) => i.mark === mk.id);
                return (
                  <g key={mk.id} data-mark={mk.id} className={`ed-mark${selected === mk.id ? ' sel' : ''}${bad ? ' bad' : ''}`} transform={`translate(${x},${y})`}>
                    <circle r={mk.kind === 'committee-boat' ? 7 : 6} />
                    <text x={9} y={4}>{mk.name}</text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="editor-side">
            <h4>Course</h4>
            <label className="field select-field"><span>Name</span><input value={course.name} onChange={(e) => update((c) => ({ ...c, name: e.target.value }))} /></label>
            <label className="field select-field"><span>Id</span><input value={course.id} onChange={(e) => update((c) => ({ ...c, id: e.target.value.replace(/[^a-z0-9-]/gi, '-').toLowerCase() }))} /></label>
            <label className="field select-field"><span>Laps</span><input type="number" min={1} max={20} value={course.laps} onChange={(e) => update((c) => ({ ...c, laps: Math.max(1, Math.min(20, Math.round(Number(e.target.value)) || 1)) }))} /></label>
            <label className="field select-field">
              <span>Status</span>
              <select
                value={course.status}
                onChange={(e) => {
                  const status = e.target.value as Course['status'];
                  update((c) => ({ ...c, status, provenance: { ...c.provenance, kind: status === 'simulated' ? 'user' : 'club-document' } }));
                }}
              >
                <option value="simulated">Simulated (practice; not a club course)</option>
                <option value="pending-check">Club course: entered from a document, pending check</option>
                <option value="verified">Club course: verified against the document</option>
              </select>
            </label>
            {prov.kind === 'club-document' && (
              <>
                <label className="field select-field"><span>Document</span><input placeholder="Title, edition, date" value={prov.document ?? ''} onChange={(e) => setProv({ document: e.target.value })} /></label>
                <label className="field select-field"><span>Reference</span><input placeholder="Section, page, course letter" value={prov.reference ?? ''} onChange={(e) => setProv({ reference: e.target.value })} /></label>
                <label className="field select-field"><span>Entered by</span><input value={prov.enteredBy ?? ''} onChange={(e) => setProv({ enteredBy: e.target.value })} /></label>
                {course.status === 'verified' && (
                  <>
                    <label className="field select-field"><span>Checked by</span><input value={prov.checkedBy ?? ''} onChange={(e) => setProv({ checkedBy: e.target.value })} /></label>
                    <label className="field select-field"><span>Checked on</span><input type="date" value={prov.checkedOn ?? ''} onChange={(e) => setProv({ checkedOn: e.target.value })} /></label>
                  </>
                )}
              </>
            )}

            {sel && selPos && (
              <>
                <h4>Mark {sel.id}</h4>
                <label className="field select-field"><span>Name</span><input value={sel.name} onChange={(e) => setMark(sel.id, { name: e.target.value })} /></label>
                <label className="field select-field">
                  <span>Kind</span>
                  <select value={sel.kind} onChange={(e) => setMark(sel.id, { kind: e.target.value as CourseMark['kind'] })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
                </label>
                <div className="field select-field coords">
                  <span>Lat, lon</span>
                  <span>
                    <input aria-label="Latitude" type="number" step={0.00001} value={ll!.lat.toFixed(5)} onChange={(e) => setMark(sel.id, { position: { lat: Number(e.target.value), lon: ll!.lon } })} />
                    <input aria-label="Longitude" type="number" step={0.00001} value={ll!.lon.toFixed(5)} onChange={(e) => setMark(sel.id, { position: { lat: ll!.lat, lon: Number(e.target.value) } })} />
                  </span>
                </div>
                <p className="fine">
                  Local n {selPos.n.toFixed(0)} m, e {selPos.e.toFixed(0)} m from RDYC.
                  {geo && (depth(selPos, 0.1) < 0
                    ? ` Dry ground, ${(-depth(selPos, 0.1)).toFixed(1)} m above the mid-tide level.`
                    : ` Depth ≈ ${depth(selPos, 0.1).toFixed(1)} m at mid-tide, ${depth(selPos, -geo.cdBelowOdn).toFixed(1)} m at chart datum (${depth(selPos, -geo.cdBelowOdn) < 0 ? 'dries' : 'provisional mid-channel'}).`)}
                </p>
                <div className="row tight left">
                  <button
                    onClick={() => {
                      update((c) => ({
                        ...c,
                        marks: c.marks.filter((mk) => mk.id !== sel.id),
                        legs: c.legs.filter((l) => (l.type === 'mark' ? l.mark !== sel.id : !l.marks.includes(sel.id))),
                        boundaries: c.boundaries?.filter((b) => !b.ends.includes(sel.id)),
                      }));
                      setSelected(null);
                    }}
                    disabled={course.start.ends.includes(sel.id) || course.finish.ends.includes(sel.id)}
                    title="Start and finish marks cannot be deleted: change the line ends first"
                  >
                    Delete mark
                  </button>
                </div>
              </>
            )}

            <h4>Start and finish</h4>
            {(['start', 'finish'] as const).map((which) => (
              <div className="field select-field" key={which}>
                <span>{which === 'start' ? 'Start line' : 'Finish line'}</span>
                <span className="pair">
                  {[0, 1].map((k) => (
                    <select key={k} value={course[which].ends[k]} onChange={(e) => update((c) => { const ends = [...c[which].ends] as [string, string]; ends[k] = e.target.value; return { ...c, [which]: { ends } }; })}>
                      {course.marks.map((mk) => <option key={mk.id} value={mk.id}>{mk.name}</option>)}
                    </select>
                  ))}
                </span>
              </div>
            ))}

            <h4>Legs (one lap)</h4>
            <ol className="ed-legs">
              {course.legs.map((l, i) => (
                <li key={i} className={errorsAt((x) => x.leg === i) ? 'bad' : ''}>
                  {l.type === 'mark' ? (
                    <>
                      <select aria-label={`Leg ${i + 1} mark`} value={l.mark} onChange={(e) => update((c) => { c.legs[i] = { ...l, mark: e.target.value }; return c; })}>
                        {course.marks.map((mk) => <option key={mk.id} value={mk.id}>{mk.name}</option>)}
                      </select>
                      <button className="side-toggle" aria-label={`Leg ${i + 1} rounding`} onClick={() => update((c) => { c.legs[i] = { ...l, rounding: l.rounding === 'port' ? 'starboard' : 'port' }; return c; })}>
                        {l.rounding === 'port' ? 'to port' : 'to starboard'}
                      </button>
                    </>
                  ) : (
                    <>
                      Gate
                      {[0, 1].map((k) => (
                        <select key={k} aria-label={`Leg ${i + 1} gate mark ${k + 1}`} value={l.marks[k]} onChange={(e) => update((c) => { const ms = [...l.marks] as [string, string]; ms[k] = e.target.value; c.legs[i] = { type: 'gate', marks: ms }; return c; })}>
                          {course.marks.map((mk) => <option key={mk.id} value={mk.id}>{mk.name}</option>)}
                        </select>
                      ))}
                    </>
                  )}
                  <button aria-label="Move leg up" disabled={i === 0} onClick={() => update((c) => { [c.legs[i - 1], c.legs[i]] = [c.legs[i]!, c.legs[i - 1]!]; return c; })}>↑</button>
                  <button aria-label="Remove leg" disabled={course.legs.length === 1} onClick={() => update((c) => ({ ...c, legs: c.legs.filter((_, j) => j !== i) }))}>✕</button>
                </li>
              ))}
            </ol>
            <div className="row tight left">
              <button onClick={() => update((c) => ({ ...c, legs: [...c.legs, { type: 'mark', mark: selected ?? c.marks[c.marks.length - 1]!.id, rounding: 'port' } as CourseLeg] }))}>Add mark leg</button>
              <button onClick={() => update((c) => ({ ...c, legs: [...c.legs, { type: 'gate', marks: [c.marks[0]!.id, c.marks[1]!.id] }] }))}>Add gate</button>
              <button onClick={() => update((c) => ({ ...c, boundaries: [...(c.boundaries ?? []), { ends: [c.marks[0]!.id, c.marks[1]!.id], label: `Boundary ${(c.boundaries?.length ?? 0) + 1}` }] }))}>Add boundary</button>
            </div>

            <h4>Check</h4>
            <ul className="ed-issues" data-testid="editor-issues">
              {validation.issues.length === 0 && <li className="ok">No problems found{ui.dart.status === 'loaded' ? '' : ' (River Dart data not loaded: land and depth not checked)'}.</li>}
              {validation.issues.map((i, k) => (
                <li key={k} className={i.severity}>{i.severity === 'error' ? 'Error' : 'Warning'}: {i.message}</li>
              ))}
            </ul>

            <h4>Load, import and export</h4>
            <div className="row tight left wrap">
              <select aria-label="Load a course" value="" onChange={(e) => { const c = allCourses().find((x) => x.id === e.target.value); if (c) { setCourse(structuredClone(c.course)); setSelected(null); } }}>
                <option value="">Load…</option>
                {allCourses().map((c) => <option key={`${c.group}-${c.id}`} value={c.id}>{c.group === 'user' ? 'Mine: ' : c.group === 'club' ? 'Club: ' : ''}{c.name}</option>)}
              </select>
              <select aria-label="Generate a practice course" value="" onChange={(e) => {
                const kind = PRACTICE_KINDS.find((k) => k.kind === e.target.value);
                if (!kind) return;
                const wind = ui.snapshot.twdGround * (180 / Math.PI);
                setCourse({ ...practiceCourse({ kind: kind.kind, centre: { n: view.n, e: view.e }, windFromDeg: wind }), id: `user-${kind.kind}-${Date.now().toString(36)}`, provenance: { kind: 'user', notes: `Generated in the editor at the map centre for wind from ${Math.round(wind)}°.` } });
              }}>
                <option value="">Practice course here…</option>
                {PRACTICE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <button onClick={() => { setCourse(blankCourse({ n: view.n, e: view.e })); setSelected(null); }}>New</button>
              <button onClick={exportJson}>Export JSON</button>
              <button onClick={() => setMessage(saveUserCourse(course) ? `Saved "${course.name}" in this browser.` : 'Browser storage is unavailable: export the JSON instead.')}>Save</button>
              {allCourses().some((c) => c.group === 'user' && c.id === course.id) && <button onClick={() => { deleteUserCourse(course.id); setMessage('Deleted from this browser.'); }}>Delete saved</button>}
            </div>
            <textarea aria-label="Paste course JSON" placeholder="Paste course JSON here, then Import" value={importText} onChange={(e) => setImportText(e.target.value)} rows={3} />
            <div className="row tight left">
              <button onClick={() => importJson(importText)} disabled={!importText.trim()}>Import</button>
              <label className="file-btn">Import file<input type="file" accept=".json,application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) importJson(await f.text()); }} /></label>
            </div>
            {message && <p className="fine" role="status">{message}</p>}
            <p className="fine">Saved courses stay in this browser only; export the JSON to keep or share them. Club courses must come from an official document (docs/COURSES.md).</p>
          </div>
        </div>
      </section>
    </div>
  );
}
