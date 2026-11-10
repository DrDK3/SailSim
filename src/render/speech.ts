/**
 * Speech for the start countdown (src/app/countdown.ts), with the device's own voices only: a voice the browser
 * marks as local (`localService`), never one that sends the text to a speech service (Chrome's "Google" voices are
 * network voices). Without a local voice nothing is spoken, and Settings says so.
 */

export interface VoiceInfo {
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

/** The on-device voice to use: British English first, then any English, then the default local one. */
export function pickLocalVoice<V extends VoiceInfo>(voices: readonly V[]): V | undefined {
  const local = voices.filter((v) => v.localService);
  return (
    local.find((v) => /^en[-_]GB/i.test(v.lang)) ??
    local.find((v) => /^en\b|^en[-_]/i.test(v.lang)) ??
    local.find((v) => v.default) ??
    local[0]
  );
}

export class Speaker {
  private voice?: SpeechSynthesisVoice;
  private readonly synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined;

  constructor() {
    this.choose();
    this.synth?.addEventListener?.('voiceschanged', this.choose);
  }

  private choose = (): void => {
    this.voice = this.synth ? pickLocalVoice(this.synth.getVoices()) : undefined;
  };

  /** The on-device voice that will speak, if there is one. */
  get voiceName(): string | undefined {
    return this.voice?.name;
  }

  get available(): boolean {
    return !!this.synth && !!this.voice;
  }

  /** Say `text` now, cutting off anything still being said (a countdown call is out of date a second later). */
  say(text: string, volume = 1): void {
    if (!this.synth || !this.voice) return;
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.rate = 1.1;
    u.volume = Math.min(1, Math.max(0, volume));
    this.synth.speak(u);
  }

  stop(): void {
    this.synth?.cancel();
  }

  dispose(): void {
    this.synth?.removeEventListener?.('voiceschanged', this.choose);
    this.stop();
  }
}
