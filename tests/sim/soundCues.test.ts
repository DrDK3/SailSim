/**
 * Sound follows the simulation (training slice §9). Asserted on the Web Audio settings the sound scape makes (a fake
 * AudioContext records every parameter target), not on what can be heard: no listening test was done.
 *  - more apparent wind: a louder wind voice; a luffing sail: a flutter voice; faster through the water: more rush;
 *  - no cue when the value is zero (a drawing sail makes no flutter); paused: silence;
 *  - and it fails gracefully: no Web Audio, or an AudioContext that cannot be made, never stops the controls.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SoundScape, type AudioInput } from '../../src/render/audio';
import { SimController } from '../../src/app/controller';

/** A fake Web Audio graph: every AudioParam remembers its last target. */
class Param {
  value = 0;
  target?: number;
  setTargetAtTime(v: number) {
    this.target = v;
  }
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.target = v;
  }
  exponentialRampToValueAtTime(v: number) {
    this.target = v;
  }
}
class Node {
  gain = new Param();
  frequency = new Param();
  Q = new Param();
  pan = new Param();
  playbackRate = new Param();
  positionX = new Param();
  positionY = new Param();
  positionZ = new Param();
  type = '';
  panningModel = '';
  distanceModel = '';
  rolloffFactor = 1;
  buffer: unknown;
  loop = false;
  connect<T>(n: T): T {
    return n;
  }
  start() {}
  stop() {}
}
class FakeContext {
  state = 'running';
  currentTime = 1;
  sampleRate = 8000;
  destination = new Node();
  listener = { positionX: new Param(), positionY: new Param(), positionZ: new Param(), forwardX: new Param(), forwardY: new Param(), forwardZ: new Param(), upX: new Param(), upY: new Param(), upZ: new Param() };
  readonly gains: Node[] = [];
  createGain() {
    const n = new Node();
    this.gains.push(n);
    return n;
  }
  createBiquadFilter() {
    return new Node();
  }
  createStereoPanner() {
    return new Node();
  }
  createOscillator() {
    return new Node();
  }
  createBufferSource() {
    return new Node();
  }
  createPanner() {
    return new Node();
  }
  createBuffer(_c: number, len: number) {
    return { getChannelData: () => new Float32Array(len) };
  }
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
}

const g = globalThis as unknown as { window?: unknown; AudioContext?: unknown; localStorage?: unknown };
const memory = new Map<string, string>();
g.localStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };
afterEach(() => {
  delete g.window;
  delete g.AudioContext;
});

let last: FakeContext | undefined;
function scape(): SoundScape {
  g.AudioContext = class extends FakeContext {
    constructor() {
      super();
      last = this as FakeContext;
    }
  };
  g.window = { AudioContext: g.AudioContext };
  const s = new SoundScape({ muted: false, master: 1, wind: 1, water: 1, effects: 1, ambience: 1 } as never);
  s.resume();
  return s;
}

const base: AudioInput = { aws: 0, awa: 0.5, stw: 0, luffMain: 1, luffJib: 1, bowDrop: 0, boomCrossed: false, harbour: 0, paused: false };
/** The private voices, to read their targets. */
const voices = (s: SoundScape) => s as unknown as { wind: { gain: Node; whistleGain: Node }; water: { rush: Node; hiss: Node }; flutter: { gain: Node; lfo: Node }[] };

describe('sound follows the simulation (Web Audio settings asserted; no listening test)', () => {
  it('more apparent wind: a louder wind voice', () => {
    const s = scape();
    const levels = [1, 4, 8, 12].map((aws) => {
      s.update({ ...base, aws });
      return voices(s).wind.gain.gain.target!;
    });
    for (let i = 1; i < levels.length; i++) expect(levels[i]!).toBeGreaterThan(levels[i - 1]!);
  });

  it('a luffing sail flutters, faster in more wind; a drawing sail makes no flutter', () => {
    const s = scape();
    s.update({ ...base, aws: 6, luffMain: 1, luffJib: 1 });
    expect(voices(s).flutter[0]!.gain.gain.target).toBe(0);
    expect(voices(s).flutter[1]!.gain.gain.target).toBe(0);
    s.update({ ...base, aws: 6, luffMain: 0.1, luffJib: 1 });
    const flog6 = voices(s).flutter[0]!.gain.gain.target!;
    const rate6 = voices(s).flutter[0]!.lfo.frequency.target!;
    expect(flog6).toBeGreaterThan(0);
    expect(voices(s).flutter[1]!.gain.gain.target).toBe(0);
    s.update({ ...base, aws: 10, luffMain: 0.1, luffJib: 1 });
    expect(voices(s).flutter[0]!.lfo.frequency.target!).toBeGreaterThan(rate6);
  });

  it('faster through the water: more rush; stopped: none', () => {
    const s = scape();
    s.update({ ...base, aws: 5, stw: 0 });
    expect(voices(s).water.rush.gain.target).toBe(0);
    s.update({ ...base, aws: 5, stw: 1 });
    const slow = voices(s).water.rush.gain.target!;
    s.update({ ...base, aws: 5, stw: 3 });
    expect(voices(s).water.rush.gain.target!).toBeGreaterThan(slow);
  });

  it('paused: every continuous voice goes quiet', () => {
    const s = scape();
    s.update({ ...base, aws: 10, stw: 3, luffMain: 0.1, paused: true });
    const v = voices(s);
    expect([v.wind.gain.gain.target, v.water.rush.gain.target, v.water.hiss.gain.target, v.flutter[0]!.gain.gain.target]).toEqual([0, 0, 0, 0]);
    expect(last).toBeDefined();
  });
});

describe('sound fails gracefully (issue 203)', () => {
  it('no Web Audio at all: resume and update do nothing', () => {
    const s = new SoundScape({ muted: false, master: 1, wind: 1, water: 1, effects: 1, ambience: 1 } as never);
    expect(() => s.resume()).not.toThrow();
    expect(() => s.update(base)).not.toThrow();
    expect(s.running).toBe(false);
  });

  it('an AudioContext that cannot be made (blocked, or too many): resume does not throw, and stays silent', () => {
    g.AudioContext = class {
      constructor() {
        throw new Error('NotSupportedError: audio is not allowed here');
      }
    };
    g.window = { AudioContext: g.AudioContext };
    const s = new SoundScape({ muted: false, master: 1, wind: 1, water: 1, effects: 1, ambience: 1 } as never);
    expect(() => s.resume()).not.toThrow();
    expect(() => s.resume()).not.toThrow();
    expect(() => s.update(base)).not.toThrow();
    expect(s.running).toBe(false);
  });

  it('and the keys still steer: a key press reaches the helm when sound cannot start', () => {
    g.AudioContext = class {
      constructor() {
        throw new Error('NotSupportedError: audio is not allowed here');
      }
    };
    g.window = { AudioContext: g.AudioContext };
    const c = new SimController();
    const key = (code: string, down: boolean) =>
      (c as unknown as { onKeyDown(e: unknown): void; onKeyUp(e: unknown): void })[down ? 'onKeyDown' : 'onKeyUp']({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, preventDefault: () => {} });
    expect(() => key('KeyD', true)).not.toThrow();
    c.advance(0.5);
    expect(c.sim.input.helm).toBeGreaterThan(0.2);
    key('KeyD', false);
  });
});
