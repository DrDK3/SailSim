import { useEffect, useRef } from 'react';
import type { SimController, UiState } from '../app/controller';
import { INDICATOR_LABEL, indicatorPose, indicatorText, type IndicatorType } from '../app/windIndicator';

/**
 * The masthead in a small picture by the compass (review #2, 20 Nov 2026): the wind indicator at the top of the mast,
 * bow up, always in view however the camera points. A small 3D picture (src/render/mastheadInset.ts) drawn with the
 * same apparent wind as the burgee at the masthead; on the lowest graphics preset, or where a second WebGL canvas
 * cannot run, a 2D drawing of the same value instead. For a screen reader it is an image whose name says where the wind
 * comes from ("Wind indicator: wind from 40° to starboard of the bow"). Settings switches it off.
 */
export function MastheadInset({ ctl, ui, top }: { ctl: SimController; ui: UiState; top?: number }) {
  const on = ui.prefs.mastheadInset;
  const want3d = on && !!ui.graphics && ui.graphics.preset !== 'performance';
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!want3d) return;
    ctl.attachInset(canvas.current ?? undefined);
    return () => {
      ctl.attachInset(undefined);
    };
  }, [ctl, want3d]);
  if (!on) return null;
  const s = ui.snapshot;
  const type = ui.prefs.windIndicator;
  const is3d = want3d && ui.insetOk;
  return (
    <div
      className="panel masthead-inset"
      role="img"
      aria-label={indicatorText(s.awa, s.aws)}
      title={`${INDICATOR_LABEL[type]} at the masthead, bow up: what a sailor reads the wind from. Hold T (or the console's Look up) to look up at it. Settings → Wind indicator to change or hide it`}
      data-testid="masthead-inset"
      data-kind={is3d ? '3d' : '2d'}
      style={top === undefined ? undefined : { top }}
    >
      {want3d && <canvas ref={canvas} className="inset-3d" aria-hidden="true" style={is3d ? undefined : { display: 'none' }} />}
      {!is3d && <IndicatorDrawing awa={s.awa} aws={s.aws} type={type} tabDeg={ui.prefs.vaneTabDeg} />}
    </div>
  );
}

/** The 2D indicator: the boat from above, bow up, the mast at the centre and what flies there. */
export function IndicatorDrawing({ awa, aws, type, tabDeg }: { awa: number; aws: number; type: IndicatorType; tabDeg: number }) {
  const p = indicatorPose(awa, aws);
  return (
    <svg viewBox="-50 -50 100 100" className="inset-2d" aria-hidden="true" data-testid="inset-2d">
      <path className="inset-hull" d="M 0 -44 C 15 -22 17 8 13 40 L -13 40 C -17 8 -15 -22 0 -44 Z" />
      <line className="inset-forestay" x1="0" y1="0" x2="0" y2="-40" />
      {type === 'burgee' ? (
        <g transform={`rotate(${p.flyDeg.toFixed(1)})`} data-testid="inset-burgee">
          <path className="inset-burgee" d={`M -6 0 L 6 0 L 0 ${(-p.flyLen).toFixed(1)} Z`} />
          <circle className="inset-burgee-crown" cx="0" cy={(-p.flyLen * 0.35).toFixed(1)} r="2.2" />
        </g>
      ) : (
        <>
          {[-1, 1].map((sd) => (
            <line key={sd} className="inset-tab" x1="0" y1="0" x2={(Math.sin(((180 + sd * tabDeg) * Math.PI) / 180) * 20).toFixed(1)} y2={(-Math.cos(((180 + sd * tabDeg) * Math.PI) / 180) * 20).toFixed(1)} />
          ))}
          <g transform={`rotate(${p.arrowDeg.toFixed(1)})`} data-testid="inset-vane">
            <line className="inset-vane" x1="0" y1="24" x2="0" y2="-26" />
            <path className="inset-vane-head" d="M 0 -34 L 5 -24 L -5 -24 Z" />
            <path className="inset-vane-fin" d="M 0 14 L 7 28 L 0 24 L -7 28 Z" />
          </g>
        </>
      )}
      <circle className="inset-mast" cx="0" cy="0" r="3" />
    </svg>
  );
}
