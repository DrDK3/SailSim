/**
 * Sound, made in the browser from noise and oscillators (Web Audio): no recordings, so nothing to license or
 * download. Every sound follows the simulation's state as the renderer sees it, and none feeds back into it.
 *
 * - **Wind**: band-passed noise whose level and pitch rise with the apparent wind, panned to the side it comes
 *   from; a thin whistle in the rigging above about 9 m/s (18 kn).
 * - **Water**: a low rush that grows with the speed through the water, a hiss of bubbles at speed, and a slap
 *   when the bow drops onto a wave.
 * - **Sails**: a flutter at the flogging rate when a sail luffs (louder and faster in more wind).
 * - **Boom**: a thump and a creak when it crosses in a tack or gybe.
 * - **Harbour**: halyards clinking on masts when there are moored boats near (River Dart only).
 *
 * Levels are estimates for the ear (E). The browser only lets sound start after the user has pressed a key or
 * clicked: `resume()` is called then. Muting suspends the audio context, so it costs nothing.
 *
 * Where a sound comes from (review, 10 Nov 2026): the listener is the camera, and the horn (at the committee boat),
 * the ships' whistles (at each vessel), the halyards (at the moored boats) and the boat's own sails, boom and knocks
 * are placed round it: the horn and whistles with head-related (HRTF) panning, best heard on headphones; the boat's
 * own sounds and the halyards, which play often or all the time, with cheaper equal-power panning. Recordings listed in
 * public/audio/manifest.json, if any, take the place of the synthesised sound of the same kind (audioSamples.ts);
 * none ship with the simulator.
 */

import { LOOPED, parseManifest, type SampleEntry, type SampleKind } from './audioSamples';

/** A point in the scene's coordinates (m): x east, y up, z south (three.js's frame). */
export type Vec3 = readonly [number, number, number];

export interface AudioSettings {
  muted: boolean;
  /** 0 … 1 each. */
  master: number;
  wind: number;
  water: number;
  effects: number;
  ambience: number;
}

export const DEFAULT_AUDIO: AudioSettings = { muted: false, master: 0.5, wind: 0.8, water: 0.8, effects: 0.8, ambience: 0.6 };
const KEY = 'squib.audio.v1';

export function loadAudio(): AudioSettings {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AudioSettings> | null;
    if (!r || typeof r !== 'object') return { ...DEFAULT_AUDIO };
    const n = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
    return {
      muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_AUDIO.muted,
      master: n(r.master, DEFAULT_AUDIO.master),
      wind: n(r.wind, DEFAULT_AUDIO.wind),
      water: n(r.water, DEFAULT_AUDIO.water),
      effects: n(r.effects, DEFAULT_AUDIO.effects),
      ambience: n(r.ambience, DEFAULT_AUDIO.ambience),
    };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export function saveAudio(s: AudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: the settings last for this visit.
  }
}

/** What the sounds follow, once a frame. */
export interface AudioInput {
  /** Apparent wind speed (m/s) and angle (rad, > 0 from starboard). */
  aws: number;
  awa: number;
  /** Speed through the water (m/s). */
  stw: number;
  /** 0 = flogging … 1 = drawing, each sail. */
  luffMain: number;
  luffJib: number;
  /** Vertical speed of the bow relative to the water (m/s, < 0 dropping onto it). */
  bowDrop: number;
  /** The boom crossed since the last frame. */
  boomCrossed: boolean;
  /** 0 … 1: how close moored boats are (halyards). */
  harbour: number;
  /** Simulation paused: the scene is still, so is the sound. */
  paused: boolean;
  /** The camera, where the sound is heard: its position and which way it looks and is up. */
  listener?: { at: Vec3; forward: Vec3; up: Vec3 };
  /** The boat (her sails, boom and hull sounds come from there). */
  boat?: Vec3;
  /** The nearest moored boat (the halyards' clinks come from about there). */
  harbourAt?: Vec3;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Wind loudness 0 … 1 and band centre (Hz) for an apparent wind speed (m/s). */
export function windVoice(aws: number): { level: number; freq: number; whistle: number } {
  return { level: 0.08 + 0.92 * smooth(0.5, 14, aws), freq: 350 + 70 * Math.min(aws, 20), whistle: smooth(9, 16, aws) };
}

/** Water rush and bubble hiss 0 … 1 for a speed through the water (m/s). */
export function waterVoice(stw: number): { rush: number; hiss: number } {
  return { rush: smooth(0.1, 3.2, stw), hiss: smooth(1.5, 3.5, stw) };
}

/** A luffing sail's flutter: level 0 … 1 and rate (Hz), from how much it flogs and the apparent wind. */
export function flutterVoice(luff: number, aws: number): { level: number; rate: number } {
  const flog = Math.max(0, 1 - luff);
  return { level: smooth(0.15, 0.7, flog) * smooth(1, 6, aws), rate: 3 + 0.9 * Math.min(aws, 16) };
}

export class SoundScape {
  settings: AudioSettings;
  private ctx?: AudioContext;
  private master?: GainNode;
  private buses?: { wind: GainNode; water: GainNode; effects: GainNode; ambience: GainNode };
  private wind?: { filter: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode; whistle: BiquadFilterNode; whistleGain: GainNode };
  private water?: { rush: GainNode; hiss: GainNode };
  private flutter?: { gain: GainNode; lfo: OscillatorNode; depth: GainNode }[];
  private noise?: AudioBuffer;
  private nextClink = 0;
  private lastSlap = 0;
  /** The boat's own sounds (sails, boom, knocks) come from her position. */
  private boatPan?: PannerNode;
  private harbourAt?: Vec3;
  /** Recordings that replace the synthesised sounds (audioSamples.ts), decoded; and their loops, playing. */
  private readonly samples = new Map<SampleKind, { entry: SampleEntry; buffers: AudioBuffer[] }>();
  private readonly loops = new Map<SampleKind, { gain: GainNode; source: AudioBufferSourceNode }>();
  /** What the recordings' manifest held: the kinds in use, and anything left out and why. */
  recorded: { kinds: SampleKind[]; problems: string[] } = { kinds: [], problems: [] };

  constructor(settings: AudioSettings = loadAudio()) {
    this.settings = settings;
  }

  /** Start (or wake) the sound after a user gesture; harmless to call often. */
  resume(): void {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return;
    if (!this.ctx) this.build();
    if (this.ctx && !this.settings.muted && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  setSettings(s: AudioSettings): void {
    this.settings = s;
    saveAudio(s);
    this.applyLevels();
    if (!this.ctx) return;
    if (s.muted) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    if (this.settings.muted) void ctx.suspend();
    // Two seconds of white noise, looped by every noise voice (each from its own offset).
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.master = master;
    const bus = () => {
      const g = ctx.createGain();
      g.connect(master);
      return g;
    };
    this.buses = { wind: bus(), water: bus(), effects: bus(), ambience: bus() };
    // The boat's own sounds play all the time and come from just by the camera: equal-power panning is enough, and
    // costs far less than head-related filtering running continuously (kept for the distant horn and whistles).
    this.boatPan = this.makePanner(this.buses.effects, [0, 1, 0], 'equalpower');
    const source = () => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(0, Math.random() * 2);
      return s;
    };
    // Wind: noise → band-pass → level → pan; the whistle a narrow band higher up.
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.Q.value = 0.7;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    const pan = ctx.createStereoPanner();
    source().connect(wf).connect(wg).connect(pan).connect(this.buses.wind);
    const whistle = ctx.createBiquadFilter();
    whistle.type = 'bandpass';
    whistle.Q.value = 14;
    whistle.frequency.value = 2200;
    const whistleGain = ctx.createGain();
    whistleGain.gain.value = 0;
    source().connect(whistle).connect(whistleGain).connect(pan);
    this.wind = { filter: wf, gain: wg, pan, whistle, whistleGain };
    // Water: a low rush and a hiss of bubbles.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const rush = ctx.createGain();
    rush.gain.value = 0;
    source().connect(lp).connect(rush).connect(this.buses.water);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    source().connect(hp).connect(hiss).connect(this.buses.water);
    this.water = { rush, hiss };
    // Flutter, one voice a sail: noise through a band-pass, chopped by a square wave at the flogging rate.
    this.flutter = [0, 1].map((i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = i ? 520 : 380;
      bp.Q.value = 1.2;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 6;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(chop.gain);
      lfo.start();
      source().connect(bp).connect(chop).connect(gain).connect(this.boatPan!);
      return { gain, lfo, depth };
    });
    this.applyLevels();
    void this.loadSamples();
  }

  /**
   * A panner placing a sound at `at` (scene coordinates) round the listener, head-related (HRTF). It sets only the
   * direction: each sound sets its own level for its distance (and its own dullness with it).
   */
  private makePanner(out: AudioNode, at: Vec3, model: PanningModelType = 'HRTF'): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = model;
    p.distanceModel = 'linear';
    p.rolloffFactor = 0;
    setPosition(p, at);
    p.connect(out);
    return p;
  }

  /** Where a one-off sound goes: through a panner at `at`, or straight to `out`. */
  private placed(out: AudioNode, at?: Vec3): AudioNode {
    return at ? this.makePanner(out, at) : out;
  }

  /** Recordings listed in public/audio/manifest.json (none ship): decoded, and the loops started silent. */
  private async loadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || typeof fetch === 'undefined') return;
    let raw: unknown;
    try {
      const r = await fetch('audio/manifest.json', { cache: 'no-cache' });
      if (!r.ok) return;
      raw = await r.json();
    } catch {
      return; // no manifest: every sound is synthesised
    }
    const { samples, problems } = parseManifest(raw);
    const kinds: SampleKind[] = [];
    for (const [kind, entry] of Object.entries(samples) as [SampleKind, SampleEntry][]) {
      const buffers: AudioBuffer[] = [];
      for (const f of entry.files) {
        try {
          const r = await fetch(`audio/${f}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          buffers.push(await ctx.decodeAudioData(await r.arrayBuffer()));
        } catch (e) {
          problems.push(`${kind}: ${f} could not be loaded (${e instanceof Error ? e.message : String(e)})`);
        }
      }
      if (!buffers.length) continue;
      this.samples.set(kind, { entry, buffers });
      kinds.push(kind);
      if (LOOPED.includes(kind)) {
        const source = ctx.createBufferSource();
        source.buffer = buffers[0]!;
        source.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const out = kind === 'wind' ? this.wind!.pan : kind === 'water' ? this.buses!.water : this.boatPan!;
        source.connect(gain).connect(out);
        source.start(0, Math.random() * buffers[0]!.duration);
        this.loops.set(kind, { gain, source });
      }
    }
    this.recorded = { kinds, problems };
  }

  /** Play a recording of `kind` once, if there is one (true), at `level` and `rate`, starting at `t`. */
  private playSample(kind: SampleKind, out: AudioNode, level: number, t: number, rate = 1): number | undefined {
    const s = this.samples.get(kind);
    if (!s || !this.ctx) return undefined;
    const buf = s.buffers[Math.min(s.buffers.length - 1, Math.floor(Math.random() * s.buffers.length))]!;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = level * s.entry.gain;
    src.connect(g).connect(out);
    src.start(t);
    return buf.duration / rate;
  }

  private applyLevels(): void {
    if (!this.ctx || !this.master || !this.buses) return;
    const t = this.ctx.currentTime;
    const s = this.settings;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    this.buses.wind.gain.setTargetAtTime(s.wind, t, 0.05);
    this.buses.water.gain.setTargetAtTime(s.water, t, 0.05);
    this.buses.effects.gain.setTargetAtTime(s.effects, t, 0.05);
    this.buses.ambience.gain.setTargetAtTime(s.ambience, t, 0.05);
  }

  /** Follow the boat (once a frame). */
  update(a: AudioInput): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.wind || !this.water || !this.flutter) return;
    const t = ctx.currentTime;
    const still = a.paused ? 0 : 1;
    if (a.listener) setListener(ctx.listener, a.listener.at, a.listener.forward, a.listener.up);
    if (a.boat && this.boatPan) setPosition(this.boatPan, a.boat);
    this.harbourAt = a.harbourAt;
    const w = windVoice(a.aws);
    // A recording replaces the synthesised sound of its kind (the same level rule; E for the balance).
    const loop = (kind: SampleKind, level: number, rate: number) => {
      const l = this.loops.get(kind);
      if (!l) return false;
      l.gain.gain.setTargetAtTime(level * this.samples.get(kind)!.entry.gain, t, 0.25);
      l.source.playbackRate.setTargetAtTime(rate, t, 0.5);
      return true;
    };
    const windRec = loop('wind', 0.5 * w.level * still, 0.85 + 0.02 * Math.min(a.aws, 15));
    this.wind.gain.gain.setTargetAtTime(windRec ? 0 : 0.22 * w.level * still, t, 0.25);
    this.wind.filter.frequency.setTargetAtTime(w.freq, t, 0.4);
    // Wind from starboard is heard on the right.
    this.wind.pan.pan.setTargetAtTime(0.6 * Math.sin(a.awa), t, 0.3);
    this.wind.whistleGain.gain.setTargetAtTime(0.05 * w.whistle * still, t, 0.4);
    this.wind.whistle.frequency.setTargetAtTime(1900 + 40 * a.aws, t, 0.5);
    const v = waterVoice(a.stw);
    const waterRec = loop('water', 0.6 * Math.max(v.rush, v.hiss) * still, 0.8 + 0.08 * Math.min(a.stw, 4));
    this.water.rush.gain.setTargetAtTime(waterRec ? 0 : 0.32 * v.rush * still, t, 0.3);
    this.water.hiss.gain.setTargetAtTime(waterRec ? 0 : 0.05 * v.hiss * still, t, 0.3);
    const flaps = [a.luffMain, a.luffJib].map((luff) => flutterVoice(luff, a.aws));
    const flapRec = loop('flutter', 0.4 * Math.max(flaps[0]!.level, flaps[1]!.level) * still, Math.min(2, Math.max(0.6, flaps[0]!.rate / 8)));
    flaps.forEach((f, i) => {
      const voice = this.flutter![i]!;
      voice.gain.gain.setTargetAtTime(flapRec ? 0 : 0.18 * f.level * still, t, 0.08);
      voice.lfo.frequency.setTargetAtTime(f.rate * (i ? 1.13 : 1), t, 0.2);
    });
    if (a.paused) return;
    // A slap when the bow drops onto a wave (at most a few a second).
    if (a.bowDrop < -0.6 && t - this.lastSlap > 0.35) {
      this.lastSlap = t;
      this.burst(this.buses!.water, Math.min(1, (-a.bowDrop - 0.6) / 1.2) * 0.35, 260, 0.18);
    }
    if (a.boomCrossed) this.boom();
    // Halyards: random clinks, more the more moored boats are about.
    if (a.harbour > 0.05 && t > this.nextClink) {
      this.nextClink = t + (0.6 + Math.random() * 3) / Math.max(0.1, a.harbour);
      if (this.nextClink - t < 30) this.clink(a.harbour);
    }
  }

  /** A short burst of filtered noise (a slap of water). */
  private burst(out: AudioNode, level: number, freq: number, decay: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 1.5);
    s.stop(t + decay + 0.05);
  }

  /** The boom crossing: a dull thump and a short creak of the gooseneck. */
  private boom(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    if (this.playSample('boom', this.boatPan ?? this.buses!.effects, 0.6, t) !== undefined) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.boatPan ?? this.buses!.effects);
    o.start(t);
    o.stop(t + 0.35);
    const c = ctx.createOscillator();
    c.type = 'sawtooth';
    c.frequency.setValueAtTime(170, t + 0.05);
    c.frequency.linearRampToValueAtTime(120, t + 0.3);
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 700;
    cf.Q.value = 6;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t + 0.05);
    cg.gain.exponentialRampToValueAtTime(0.05, t + 0.08);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    c.connect(cf).connect(cg).connect(this.boatPan ?? this.buses!.effects);
    c.start(t + 0.05);
    c.stop(t + 0.35);
  }

  /** A halyard against an alloy mast: three inharmonic partials ringing down, somewhere to one side. */
  private clink(near: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const base = 900 + Math.random() * 700;
    // About the nearest moored boat (one of the masts round it), or somewhere to one side.
    let pan: AudioNode;
    if (this.harbourAt) {
      const [x, y, z] = this.harbourAt;
      pan = this.makePanner(this.buses!.ambience, [x + (Math.random() - 0.5) * 40, y + 6, z + (Math.random() - 0.5) * 40], 'equalpower');
    } else {
      const sp = ctx.createStereoPanner();
      sp.pan.value = Math.random() * 1.6 - 0.8;
      sp.connect(this.buses!.ambience);
      pan = sp;
    }
    const level = 0.03 + 0.05 * near * Math.random();
    if (this.playSample('halyard', pan, level * 6, t, 0.9 + Math.random() * 0.2) !== undefined) return;
    for (const [ratio, share] of [[1, 1], [2.76, 0.5], [5.4, 0.25]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level * share, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5 / Math.sqrt(ratio));
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.6);
    }
  }

  /**
   * The race committee's sound signals (RRS 26 and 29; review GR-6): `count` short blasts of a horn, or one long
   * one (the one-minute signal). A short sound is about 0.7 s, a long one 2 s (the lengths are not set by the
   * rules: E). Made in the browser like the rest; nothing is downloaded.
   */
  horn(count: number, long = false, at?: Vec3, distanceM = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.buses || count < 1) return;
    const out = this.placed(this.buses.effects, at);
    // Quieter further from the committee boat (E: for the ear, as the whistles).
    const far = 1 / (1 + distanceM / 300);
    const rec = this.samples.has(long ? 'horn-long' : 'horn') ? (long ? 'horn-long' : 'horn') : undefined;
    if (rec) {
      let t = ctx.currentTime + 0.05;
      for (let i = 0; i < count; i++) t += (this.playSample(rec, out, 0.8 * far, t) ?? 0.7) + 0.35;
      return;
    }
    const len = long ? 2 : 0.7;
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + 0.05 + i * (len + 0.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22 * far, t + 0.04);
      g.gain.setValueAtTime(0.22 * far, t + len - 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 400 + 1000 / (1 + distanceM / 400);
      f.connect(g).connect(out);
      // An air horn's reedy tone: two detuned saw waves a little apart.
      for (const hz of [262, 266.5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz;
        o.connect(f);
        o.start(t);
        o.stop(t + len + 0.02);
      }
    }
  }

  /**
   * A vessel's whistle (COLREGs Rules 32, 34, 35; src/app/soundSignals.ts): short blasts 1 s, prolonged 5 s. Bigger
   * vessels sound lower (the pitches are estimates, E); further away is quieter and duller.
   */
  whistle(blasts: readonly ('short' | 'prolonged')[], distanceM: number, lengthM: number, at?: Vec3): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.buses || !blasts.length) return;
    const rapid = blasts.length >= 5 && blasts.every((b) => b === 'short');
    const gap = rapid ? 0.4 : 1;
    const hz = lengthM >= 75 ? 180 : lengthM >= 20 ? 260 : 400;
    const level = 0.3 / (1 + distanceM / 150);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400 + 2600 / (1 + distanceM / 300);
    f.connect(this.placed(this.buses.effects, at));
    let t = ctx.currentTime + 0.05;
    // Recordings of a short blast and a prolonged one, if there are: pitched by the vessel's size like the synthesis.
    const rate = lengthM >= 75 ? 0.8 : lengthM >= 20 ? 1 : 1.3;
    if (blasts.every((b) => this.samples.has(b === 'short' ? 'whistle' : 'whistle-long'))) {
      for (const b of blasts) t += (this.playSample(b === 'short' ? 'whistle' : 'whistle-long', f, level * 2.5, t, rate) ?? (b === 'short' ? 1 : 5)) + gap;
      return;
    }
    for (const b of blasts) {
      const len = b === 'short' ? 1 : 5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + 0.06);
      g.gain.setValueAtTime(level, t + len - 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      g.connect(f);
      // A ship's whistle: a fundamental with a fifth above it, slightly detuned.
      for (const [mult, share] of [[1, 1], [1.5, 0.45], [1.004, 0.6]] as const) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz * mult;
        const og = ctx.createGain();
        og.gain.value = share * 0.5;
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + len + 0.02);
      }
      t += len + gap;
    }
  }

  /** A knock on the hull (contact with a boat, mark or pontoon): a dull thump, louder the harder. */
  knock(severity: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.buses) return;
    const level = 0.15 + 0.35 * Math.min(1, Math.max(0, severity));
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    const out = this.boatPan ?? this.buses.effects;
    if (this.playSample('knock', out, level * 1.5, t) !== undefined) return;
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.3);
    this.burst(out, level * 0.6, 900, 0.12);
  }

  /** The keel on the bottom: a low grinding scrape of filtered noise for the length of the grounding. */
  scrape(severity: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.buses || !this.noise) return;
    const t = ctx.currentTime;
    const len = 0.5 + 0.6 * Math.min(1, severity);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(320, t);
    f.frequency.linearRampToValueAtTime(140, t + len);
    f.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + 0.25 * Math.min(1, severity), t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f).connect(g).connect(this.boatPan ?? this.buses.effects);
    s.start(t, Math.random() * 1.5);
    s.stop(t + len + 0.05);
  }

  /**
   * Glassfibre breaking (a crack or a hole, the rig coming down): a sharp crackle of high noise over a heavy
   * thud, the crackle longer the worse it is (E: for the ear).
   */
  crunch(severity: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.buses || !this.noise) return;
    const sev = Math.min(1, Math.max(0, severity));
    this.knock(0.6 + 0.4 * sev);
    const t = ctx.currentTime;
    const len = 0.25 + 0.6 * sev;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(700, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    // Crackle: the gain stutters as the laminate gives way.
    for (let i = 0; i < 8; i++) g.gain.setValueAtTime((0.15 + 0.3 * sev) * (i % 2 ? 0.3 : 1), t + (len * i) / 8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f).connect(g).connect(this.buses.effects);
    s.start(t, Math.random() * 1.5);
    s.stop(t + len + 0.05);
  }

  /** The page was hidden or shown again: hidden, the frames stop, so the sound pauses too. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else if (!this.settings.muted) void this.ctx.resume();
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = undefined;
  }
}

/** Place a panner (Web Audio's AudioParam positions where the browser has them, the older setter otherwise). */
function setPosition(p: PannerNode, [x, y, z]: Vec3): void {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
}

/** Put the listener at the camera, facing as it faces. */
function setListener(l: AudioListener, [x, y, z]: Vec3, [fx, fy, fz]: Vec3, [ux, uy, uz]: Vec3): void {
  if (l.positionX) {
    l.positionX.value = x;
    l.positionY.value = y;
    l.positionZ.value = z;
    l.forwardX.value = fx;
    l.forwardY.value = fy;
    l.forwardZ.value = fz;
    l.upX.value = ux;
    l.upY.value = uy;
    l.upZ.value = uz;
  } else {
    const o = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
    o.setPosition(x, y, z);
    o.setOrientation(fx, fy, fz, ux, uy, uz);
  }
}
