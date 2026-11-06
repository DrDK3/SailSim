import type { AppScenario, UiState } from '../app/controller';
import { SKY_PRESETS } from '../sim/env/sky';

/**
 * The session in one line: where (and which of it is provisional), the wind, tide, stream, sky, course and fleet,
 * and the caveats. It was a line along the bottom of the screen; at the owner's request (6 Nov 2026) it is shown
 * in Layers and sources instead, beside the attribution.
 */
export function conditionsText(sc: AppScenario): string {
  const c = sc.conditions;
  const wind = c.weather.source === 'manual' ? `wind ${c.weather.twsKn} kn from ${c.weather.twdDeg}°` : `Met Office UKV model wind${c.weather.replay ? ' (replay)' : ''}`;
  const tide = c.tide ? `tide ${c.tide.mode}` : 'no tide';
  const cur = c.current.mode === 'tidal' ? 'modelled tidal stream' : c.current.mode === 'uniform' ? `current ${c.current.rateKn} kn` : 'no current';
  const course = sc.course ? (sc.course.source === 'practice' ? ` · practice course (simulated)` : ' · course set') : '';
  const fleet = sc.course && sc.fleet?.aiCount ? ` · ${sc.fleet.aiCount} AI boat${sc.fleet.aiCount === 1 ? '' : 's'}` : '';
  const sky = c.sky?.source === 'preset' && c.sky.preset !== 'clear' ? ` · ${SKY_PRESETS[c.sky.preset].label.toLowerCase()}` : '';
  // "steady wind", "gusty", not "gusty gusts" (UX-7).
  const gusts = ({ steady: 'steady wind', moderate: 'moderate gusts', shifty: 'shifty', gusty: 'gusty' } as Record<string, string>)[c.gusts.preset] ?? c.gusts.preset;
  return `${wind} · ${gusts} · ${tide} · ${cur}${sky}${course}${fleet}`;
}

export function sessionSummary(ui: Pick<UiState, 'dart' | 'scenario'>): string {
  const where = ui.dart.status === 'loaded' ? 'River Dart (depths and stream provisional)' : ui.dart.status === 'loading' ? 'loading the River Dart…' : 'open water';
  return `${where} · ${conditionsText(ui.scenario)} · physics estimated · not for navigation`;
}
