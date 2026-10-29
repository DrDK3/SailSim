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
 */

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
      source().connect(bp).connect(chop).connect(gain).connect(this.buses!.effects);
      return { gain, lfo, depth };
    });
    this.applyLevels();
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
    const w = windVoice(a.aws);
    this.wind.gain.gain.setTargetAtTime(0.22 * w.level * still, t, 0.25);
    this.wind.filter.frequency.setTargetAtTime(w.freq, t, 0.4);
    // Wind from starboard is heard on the right.
    this.wind.pan.pan.setTargetAtTime(0.6 * Math.sin(a.awa), t, 0.3);
    this.wind.whistleGain.gain.setTargetAtTime(0.05 * w.whistle * still, t, 0.4);
    this.wind.whistle.frequency.setTargetAtTime(1900 + 40 * a.aws, t, 0.5);
    const v = waterVoice(a.stw);
    this.water.rush.gain.setTargetAtTime(0.32 * v.rush * still, t, 0.3);
    this.water.hiss.gain.setTargetAtTime(0.05 * v.hiss * still, t, 0.3);
    [a.luffMain, a.luffJib].forEach((luff, i) => {
      const f = flutterVoice(luff, a.aws);
      const voice = this.flutter![i]!;
      voice.gain.gain.setTargetAtTime(0.18 * f.level * still, t, 0.08);
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
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.buses!.effects);
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
    c.connect(cf).connect(cg).connect(this.buses!.effects);
    c.start(t + 0.05);
    c.stop(t + 0.35);
  }

  /** A halyard against an alloy mast: three inharmonic partials ringing down, somewhere to one side. */
  private clink(near: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const base = 900 + Math.random() * 700;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.buses!.ambience);
    const level = 0.03 + 0.05 * near * Math.random();
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
