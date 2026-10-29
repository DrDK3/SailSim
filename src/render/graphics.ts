/**
 * Graphics settings: three presets (Performance, Balanced, Ultra) and the individual options they set, kept in
 * the browser (per viewer). Most options apply at once; the scenery detail and the shadow technique are chosen
 * when the 3D view is built, so changing them asks for a reload. Visual only: nothing here touches the physics.
 *
 * The default is Balanced on a real graphics card and Performance on a software renderer (CI, a machine with
 * no GPU). `?quality=low|high` in the address still forces the scenery and shadows (tests and screenshots).
 */

export type GraphicsPreset = 'performance' | 'balanced' | 'ultra';

export interface GraphicsSettings {
  preset: GraphicsPreset | 'custom';
  /** Rendering resolution as a share of the screen's (device pixels), 0.5 … 1. */
  resolutionScale: number;
  /** Highest device-pixel ratio drawn (sharpness on high-density screens). */
  maxPixelRatio: number;
  /** Scenery detail and shadows: 'high' = cascaded shadows over the town and woods, more trees (needs reload). */
  scenery: 'low' | 'high';
  /** Shadow maps: 'fine' doubles their resolution (sharper shadows; needs reload). */
  shadows: 'standard' | 'fine';
  /** Water: 'high' adds sky reflections from the environment and fine ripple detail; 'low' a sky gradient. */
  water: 'low' | 'high';
  /** Foam round the hull, the bow wave and the wake's foam texture. */
  hullFoam: boolean;
  /** Spray thrown from the bow when it slams into a wave at speed. */
  spray: boolean;
  /** Haze towards the sun and warm light low in the sky (aerial perspective). */
  atmosphere: boolean;
  /** How much of the boat's motion the chase and scenic cameras follow (0 = steady, 1 = full). */
  cameraMotion: number;
}

export const PRESETS: Record<GraphicsPreset, Omit<GraphicsSettings, 'preset' | 'cameraMotion'>> = {
  performance: { resolutionScale: 0.75, maxPixelRatio: 1, scenery: 'low', shadows: 'standard', water: 'low', hullFoam: true, spray: false, atmosphere: false },
  balanced: { resolutionScale: 1, maxPixelRatio: 1.5, scenery: 'high', shadows: 'standard', water: 'high', hullFoam: true, spray: true, atmosphere: true },
  ultra: { resolutionScale: 1, maxPixelRatio: 2, scenery: 'high', shadows: 'fine', water: 'high', hullFoam: true, spray: true, atmosphere: true },
};

export const DEFAULT_CAMERA_MOTION = 0.5;
const KEY = 'squib.graphics.v1';

/** The preset for this renderer: Performance on a software renderer, otherwise Balanced. */
export function defaultPreset(rendererName: string): GraphicsPreset {
  return /swiftshader|llvmpipe|software|basic render/i.test(rendererName) ? 'performance' : 'balanced';
}

export function presetSettings(p: GraphicsPreset, cameraMotion = DEFAULT_CAMERA_MOTION): GraphicsSettings {
  return { preset: p, cameraMotion, ...PRESETS[p] };
}

/** Which preset the options match, or 'custom'. */
export function matchPreset(s: Omit<GraphicsSettings, 'preset'>): GraphicsSettings['preset'] {
  for (const p of Object.keys(PRESETS) as GraphicsPreset[]) {
    const q = PRESETS[p];
    if ((Object.keys(q) as (keyof typeof q)[]).every((k) => q[k] === s[k])) return p;
  }
  return 'custom';
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Settings from storage (anything missing or invalid falls back to the default preset's). */
export function loadGraphics(rendererName: string): GraphicsSettings {
  const base = presetSettings(defaultPreset(rendererName));
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<GraphicsSettings>;
  const out: GraphicsSettings = {
    preset: 'custom',
    resolutionScale: typeof r.resolutionScale === 'number' ? clamp(r.resolutionScale, 0.5, 1) : base.resolutionScale,
    maxPixelRatio: typeof r.maxPixelRatio === 'number' ? clamp(r.maxPixelRatio, 1, 2) : base.maxPixelRatio,
    scenery: r.scenery === 'low' || r.scenery === 'high' ? r.scenery : base.scenery,
    shadows: r.shadows === 'standard' || r.shadows === 'fine' ? r.shadows : base.shadows,
    water: r.water === 'low' || r.water === 'high' ? r.water : base.water,
    hullFoam: typeof r.hullFoam === 'boolean' ? r.hullFoam : base.hullFoam,
    spray: typeof r.spray === 'boolean' ? r.spray : base.spray,
    atmosphere: typeof r.atmosphere === 'boolean' ? r.atmosphere : base.atmosphere,
    cameraMotion: typeof r.cameraMotion === 'number' ? clamp(r.cameraMotion, 0, 1) : base.cameraMotion,
  };
  out.preset = matchPreset(out);
  return out;
}

export function saveGraphics(s: GraphicsSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked (private window): the settings last for this visit only.
  }
}

/** The device-pixel ratio to draw at. */
export function pixelRatioFor(s: GraphicsSettings, devicePixelRatio: number): number {
  return Math.max(0.5, Math.min(devicePixelRatio, s.maxPixelRatio) * s.resolutionScale);
}
