/**
 * Tide HEIGHT sources (water level above chart datum). Kept separate from tidal STREAMS (current.ts):
 * a tide-height prediction says nothing directly about current speed or direction.
 *
 * Between successive high and low waters the height follows the standard cosine curve. This is an
 * approximation; real Dart tides are not exactly sinusoidal.
 */

/** Principal lunar semi-diurnal (M2) period, 12.4206012 h. */
export const M2_PERIOD_S = 12.4206012 * 3600;

export interface TideEvent {
  epochMs: number;
  type: 'HW' | 'LW';
  /** Height above chart datum (m). */
  height: number;
}

export interface TideState {
  /** Height above chart datum (m). */
  height: number;
  rising: boolean;
  /** Hours since the previous high water (0 … ~12.4). */
  hoursSinceHW: number;
  nextHW?: TideEvent;
  nextLW?: TideEvent;
  /** Rate of change (m/h). */
  rateMPerH: number;
  /**
   * Normalised rate of change in [-1, 1]: +1 at the fastest rise (mid-flood), -1 at the fastest fall
   * (mid-ebb), 0 at high and low water. Drives the provisional tidal-stream model.
   */
  phase: number;
}

export interface TideSource {
  readonly kind: 'manual' | 'live' | 'replay';
  readonly label: string;
  readonly notes: string[];
  at(epochMs: number): TideState;
}

/** Cosine interpolation through a sequence of alternating HW/LW events. */
export function eventTide(events: TideEvent[], kind: TideSource['kind'], label: string, notes: string[] = []): TideSource {
  const ev = [...events].sort((a, b) => a.epochMs - b.epochMs);
  if (ev.length < 2) throw new Error('need at least two tide events');
  for (let i = 1; i < ev.length; i++) {
    if (ev[i]!.type === ev[i - 1]!.type) throw new Error('tide events must alternate between HW and LW');
  }
  const halfMs = (M2_PERIOD_S * 1000) / 2;
  return {
    kind,
    label,
    notes,
    at(t: number): TideState {
      // Outside the event list, repeat with the M2 half-period so the curve stays defined (flagged in notes).
      let i = 0;
      while (i < ev.length - 2 && t > ev[i + 1]!.epochMs) i++;
      let a = ev[i]!;
      let b = ev[i + 1]!;
      if (t < a.epochMs) {
        const k = Math.ceil((a.epochMs - t) / halfMs);
        const pa = k % 2 === 0 ? a : b;
        const pb = k % 2 === 0 ? b : a;
        a = { ...pa, epochMs: ev[0]!.epochMs - k * halfMs };
        b = { ...pb, epochMs: a.epochMs + halfMs };
      } else if (t > b.epochMs) {
        const last = ev[ev.length - 1]!;
        const prev = ev[ev.length - 2]!;
        const k = Math.floor((t - last.epochMs) / halfMs);
        a = { ...(k % 2 === 0 ? last : prev), epochMs: last.epochMs + k * halfMs };
        b = { ...(k % 2 === 0 ? prev : last), epochMs: a.epochMs + halfMs };
      }
      const span = b.epochMs - a.epochMs;
      const x = Math.min(1, Math.max(0, (t - a.epochMs) / span));
      const height = a.height + ((b.height - a.height) * (1 - Math.cos(Math.PI * x))) / 2;
      const dhdtPerMs = ((b.height - a.height) * Math.PI * Math.sin(Math.PI * x)) / (2 * span);
      const rising = b.type === 'HW';
      const lastHW = a.type === 'HW' ? a.epochMs : a.epochMs - halfMs;
      const nextHW = b.type === 'HW' ? b : { type: 'HW' as const, epochMs: b.epochMs + halfMs, height: a.height };
      const nextLW = b.type === 'LW' ? b : { type: 'LW' as const, epochMs: b.epochMs + halfMs, height: a.height };
      return {
        height,
        rising,
        hoursSinceHW: (t - lastHW) / 3.6e6,
        nextHW,
        nextLW,
        rateMPerH: dhdtPerMs * 3.6e6,
        phase: (rising ? 1 : -1) * Math.sin(Math.PI * x),
      };
    },
  };
}

/**
 * Manual tide: the user enters one high water (time and height) and the low-water height, as read from
 * tide tables or EasyTide. Successive events repeat at the M2 half-period.
 */
export function manualTide(hwEpochMs: number, hwHeight: number, lwHeight: number): TideSource {
  const half = (M2_PERIOD_S * 1000) / 2;
  const events: TideEvent[] = [];
  for (let k = -6; k <= 6; k++) {
    events.push({ epochMs: hwEpochMs + k * 2 * half, type: 'HW', height: hwHeight });
    events.push({ epochMs: hwEpochMs + (2 * k + 1) * half, type: 'LW', height: lwHeight });
  }
  return eventTide(events, 'manual', `Manual tide: HW ${hwHeight.toFixed(1)} m, LW ${lwHeight.toFixed(1)} m above CD`, [
    'Heights entered by the user; cosine curve between high and low water (approximation).',
  ]);
}

/**
 * Snapshot format written by the planned tide ingest (docs/LIVE_TIDES.md). Field names are ours, not an
 * upstream API's.
 */
export interface TideSnapshot {
  kind: 'live' | 'replay';
  generated: string;
  predictions: { source: string; events: { time: string; type: 'HW' | 'LW'; heightCD: number }[] };
  gauge?: { source: string; station: string; cdOffsetM: number; readings: { time: string; mAOD: number }[] };
  attribution?: string;
}

export function parseTideSnapshot(json: unknown): TideSnapshot {
  const j = json as Partial<TideSnapshot>;
  if (!j || typeof j !== 'object') throw new Error('tide snapshot: not an object');
  if (j.kind !== 'live' && j.kind !== 'replay') throw new Error('tide snapshot: kind must be live or replay');
  if (typeof j.generated !== 'string') throw new Error('tide snapshot: missing generated time');
  const events = j.predictions?.events;
  if (!Array.isArray(events) || events.length < 2) throw new Error('tide snapshot: need at least two predicted events');
  for (const e of events) {
    if (typeof e.time !== 'string' || Number.isNaN(Date.parse(e.time))) throw new Error('tide snapshot: bad event time');
    if (e.type !== 'HW' && e.type !== 'LW') throw new Error('tide snapshot: bad event type');
    if (typeof e.heightCD !== 'number') throw new Error('tide snapshot: bad event height');
  }
  return j as TideSnapshot;
}

/**
 * Tide from a snapshot: predicted events (cosine curve) plus, when gauge readings are present, the latest
 * measured-minus-predicted residual (surge, river effects) added as a constant offset.
 */
export function snapshotTide(snap: TideSnapshot): TideSource & { residual: number } {
  const events: TideEvent[] = snap.predictions.events.map((e) => ({ epochMs: Date.parse(e.time), type: e.type, height: e.heightCD }));
  const predicted = eventTide(events, snap.kind, '');
  let residual = 0;
  const notes = [`Predictions: ${snap.predictions.source}. Cosine curve between events.`];
  const last = snap.gauge?.readings[snap.gauge.readings.length - 1];
  if (snap.gauge && last) {
    const measuredCD = last.mAOD + snap.gauge.cdOffsetM;
    residual = measuredCD - predicted.at(Date.parse(last.time)).height;
    notes.push(`Gauge ${snap.gauge.station} (${snap.gauge.source}) at ${last.time}: residual ${residual.toFixed(2)} m applied.`);
    notes.push(`Chart-datum offset ${snap.gauge.cdOffsetM} m (to be confirmed, docs/MISSING_INFORMATION.md C8).`);
  }
  const label = `${snap.kind === 'live' ? 'Live' : 'Replay'} tide (${snap.generated})`;
  return {
    kind: snap.kind,
    label,
    notes,
    residual,
    at(t: number) {
      const s = predicted.at(t);
      return { ...s, height: s.height + residual };
    },
  };
}

/**
 * A tide source that remembers its last few results. The tide is a pure function of time and is evaluated
 * many times per step (water level, stream, every boat): the values are exactly the same, just not recomputed.
 */
export function memoTide(src: TideSource): TideSource {
  const keys: number[] = [];
  const vals: TideState[] = [];
  return {
    kind: src.kind,
    label: src.label,
    notes: src.notes,
    at(t: number): TideState {
      const i = keys.indexOf(t);
      if (i >= 0) return vals[i]!;
      const v = src.at(t);
      keys.push(t);
      vals.push(v);
      if (keys.length > 6) {
        keys.shift();
        vals.shift();
      }
      return v;
    },
  };
}
