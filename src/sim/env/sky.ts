/**
 * The sky and the air's clarity: cloud, visibility, rain and fog. VISUAL ONLY: nothing here changes the
 * physics (rain and visibility do not change the wind or the boat), so runs stay reproducible whatever the
 * sky shows.
 *
 * Sources: a preset chosen in the scenario, or the Met Office UKV sky fields in a squib-weather/2 snapshot
 * (forecast model output at the RDYC grid cell; tools/ingest/weather.py).
 */

export interface SkyState {
  /** Total cloud cover, 0 (clear) … 1 (overcast). */
  cloud: number;
  /** Low cloud cover, 0 … 1 (darkens the light more than high cloud). */
  lowCloud: number;
  /** Horizontal visibility near the surface (m). */
  visibilityM: number;
  /** Rain rate (mm/h): 0.5 light, 4 moderate, > 8 heavy. */
  rainMmH: number;
}

export type SkyPreset = 'clear' | 'fair' | 'hazy' | 'overcast' | 'mist' | 'fog' | 'rain' | 'heavy-rain';

/** Preset skies (E: chosen to look like their names, not from observations). */
export const SKY_PRESETS: Record<SkyPreset, SkyState & { label: string }> = {
  clear: { label: 'Clear', cloud: 0.05, lowCloud: 0, visibilityM: 40000, rainMmH: 0 },
  fair: { label: 'Fair weather cumulus', cloud: 0.35, lowCloud: 0.25, visibilityM: 30000, rainMmH: 0 },
  hazy: { label: 'Hazy sunshine', cloud: 0.15, lowCloud: 0, visibilityM: 7000, rainMmH: 0 },
  overcast: { label: 'Overcast', cloud: 0.95, lowCloud: 0.8, visibilityM: 20000, rainMmH: 0 },
  mist: { label: 'Mist (2 km)', cloud: 0.9, lowCloud: 0.9, visibilityM: 2000, rainMmH: 0 },
  fog: { label: 'Fog (300 m)', cloud: 1, lowCloud: 1, visibilityM: 300, rainMmH: 0 },
  rain: { label: 'Rain', cloud: 1, lowCloud: 0.9, visibilityM: 8000, rainMmH: 2.5 },
  'heavy-rain': { label: 'Heavy rain', cloud: 1, lowCloud: 1, visibilityM: 2500, rainMmH: 10 },
};

export interface SkySource {
  readonly label: string;
  readonly kind: 'preset' | 'model';
  readonly notes: string[];
  /** Sky at run time t (s since the scenario start). */
  at(t: number): SkyState;
}

export function presetSky(preset: SkyPreset): SkySource {
  const p = SKY_PRESETS[preset];
  const state: SkyState = { cloud: p.cloud, lowCloud: p.lowCloud, visibilityM: p.visibilityM, rainMmH: p.rainMmH };
  return { label: `Sky: ${p.label} (preset)`, kind: 'preset', notes: ['Scenario setting, not observed.'], at: () => state };
}

/** One sky step of a squib-weather/2 snapshot (values may be null when a field was unavailable). */
export interface SkyStep {
  valid: string;
  rdyc: Partial<Record<'cloud_total' | 'cloud_low' | 'visibility_m' | 'precip_mm_h' | 'rain_mm_h' | 'fog_fraction' | 'air_temp_c', number | null>>;
  area_mean?: SkyStep['rdyc'];
}

const DEFAULT_SKY: SkyState = { cloud: 0.3, lowCloud: 0.1, visibilityM: 20000, rainMmH: 0 };

function stepState(s: SkyStep): SkyState {
  const pick = (k: keyof SkyStep['rdyc']): number | undefined => {
    const v = s.rdyc[k] ?? s.area_mean?.[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const fog = pick('fog_fraction') ?? 0;
  const vis = pick('visibility_m') ?? DEFAULT_SKY.visibilityM;
  return {
    cloud: pick('cloud_total') ?? DEFAULT_SKY.cloud,
    lowCloud: pick('cloud_low') ?? DEFAULT_SKY.lowCloud,
    // The model's fog fraction is the share of the cell in fog: thicken the haze accordingly.
    visibilityM: fog > 0.5 ? Math.min(vis, 1000) : vis,
    rainMmH: pick('rain_mm_h') ?? pick('precip_mm_h') ?? 0,
  };
}

/** Sky from the forecast's hourly sky steps, interpolated linearly in time (visibility geometrically). */
export function modelSky(steps: SkyStep[], startEpochMs: number, label: string): SkySource {
  const pts = steps
    .map((s) => ({ t: (Date.parse(s.valid) - startEpochMs) / 1000, s: stepState(s) }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) throw new Error('modelSky: no valid sky steps');
  return {
    label,
    kind: 'model',
    notes: ['Cloud, visibility and rain from the Met Office UKV forecast at the RDYC grid cell (model output). Visual only.'],
    at(t: number): SkyState {
      if (t <= pts[0]!.t) return pts[0]!.s;
      const last = pts[pts.length - 1]!;
      if (t >= last.t) return last.s;
      let k = 0;
      while (t >= pts[k + 1]!.t) k++;
      const a = pts[k]!.s;
      const b = pts[k + 1]!.s;
      const w = (t - pts[k]!.t) / (pts[k + 1]!.t - pts[k]!.t);
      const lin = (x: number, y: number) => x + (y - x) * w;
      return {
        cloud: lin(a.cloud, b.cloud),
        lowCloud: lin(a.lowCloud, b.lowCloud),
        visibilityM: Math.exp(lin(Math.log(Math.max(a.visibilityM, 1)), Math.log(Math.max(b.visibilityM, 1)))),
        rainMmH: lin(a.rainMmH, b.rainMmH),
      };
    },
  };
}

/** Extinction coefficient (1/m) for a visibility: the 2% contrast threshold, σ = 3.912 / V (Koschmieder). */
export function extinctionPerM(visibilityM: number): number {
  return 3.912 / Math.max(visibilityM, 1);
}

/** A short description for the UI, e.g. "overcast, visibility 2.0 km, light rain". */
export function describeSky(s: SkyState): string {
  const cover = s.cloud < 0.15 ? 'clear' : s.cloud < 0.45 ? 'some cloud' : s.cloud < 0.85 ? 'mostly cloudy' : 'overcast';
  const vis = s.visibilityM >= 10000 ? `${Math.round(s.visibilityM / 1000)} km` : s.visibilityM >= 1000 ? `${(s.visibilityM / 1000).toFixed(1)} km` : `${Math.round(s.visibilityM)} m`;
  const rain = s.rainMmH < 0.1 ? '' : s.rainMmH < 1 ? ', light rain' : s.rainMmH < 6 ? ', rain' : ', heavy rain';
  const fog = s.visibilityM < 1000 ? ' (fog)' : s.visibilityM < 5000 ? ' (mist)' : '';
  return `${cover}, visibility ${vis}${fog}${rain}`;
}
