/** Sound (review, 10 Nov 2026): the spoken countdown, on-device voices only, and the recorded-sound manifest. */
import { describe, expect, it } from 'vitest';
import { COUNTDOWN_CALLS, countdownCall } from '../../src/app/countdown';
import { pickLocalVoice } from '../../src/render/speech';
import { parseManifest } from '../../src/render/audioSamples';
import manifest from '../../public/audio/manifest.json';

describe('the spoken start countdown', () => {
  it('calls the minutes, thirty and twenty seconds, then every second from ten', () => {
    const said: string[] = [];
    let before = 330;
    for (let t = 329.9; t >= -2; t = Math.round((t - 0.1) * 10) / 10) {
      const c = countdownCall(before, t);
      if (c) said.push(c.text);
      before = t;
    }
    expect(said).toEqual(['Five minutes', 'Four minutes', 'Three minutes', 'Two minutes', 'One minute', 'Thirty seconds', 'Twenty seconds', 'Ten', 'Nine', 'Eight', 'Seven', 'Six', 'Five', 'Four', 'Three', 'Two', 'One']);
    expect(COUNTDOWN_CALLS).toHaveLength(17);
  });

  it('after a jump only the latest call, and only if it is less than a second late', () => {
    expect(countdownCall(70, 59.5)?.text).toBe('One minute');
    expect(countdownCall(70, 58)).toBeUndefined();
    expect(countdownCall(12, 8.5)?.text).toBe('Nine');
    // The clock going back (a general recall) says nothing.
    expect(countdownCall(5, 240)).toBeUndefined();
  });
});

describe('on-device voices only', () => {
  const voices = [
    { name: 'Google UK English Female', lang: 'en-GB', localService: false },
    { name: 'Google US English', lang: 'en-US', localService: false, default: true },
    { name: 'Daniel', lang: 'en-GB', localService: true },
    { name: 'Samantha', lang: 'en-US', localService: true },
    { name: 'Amélie', lang: 'fr-CA', localService: true },
  ];
  it('never a network voice: British English first, then any English, then any local one', () => {
    expect(pickLocalVoice(voices)?.name).toBe('Daniel');
    expect(pickLocalVoice(voices.filter((v) => v.name !== 'Daniel'))?.name).toBe('Samantha');
    expect(pickLocalVoice(voices.filter((v) => v.lang.startsWith('fr') || !v.localService))?.name).toBe('Amélie');
    expect(pickLocalVoice(voices.filter((v) => !v.localService))).toBeUndefined();
  });
});

describe('recorded sounds', () => {
  it('none ship: the manifest is empty', () => {
    expect(parseManifest(manifest)).toEqual({ samples: {}, problems: [] });
  });

  it('an entry needs plain files in the folder, a source and a licence; others are left out with the reason', () => {
    const { samples, problems } = parseManifest({
      samples: {
        horn: { files: ['horn-1.ogg', 'horn-2.ogg'], gain: 3, source: 'Owner, RDYC start box, 2026', licence: "owner's own recording" },
        wind: { files: ['https://example.com/wind.mp3'], source: 'x', licence: 'CC0 1.0' },
        water: { files: ['../secret.wav'], source: 'x', licence: 'CC0 1.0' },
        halyard: { file: 'halyard.wav', source: 'Owner', licence: '' },
        foghorn: { files: ['a.ogg'], source: 'x', licence: 'y' },
        boom: { file: 'boom.wav', source: 'Owner, 2026', licence: "owner's own recording" },
      },
    });
    expect(Object.keys(samples).sort()).toEqual(['boom', 'horn']);
    expect(samples.horn!.gain).toBe(2);
    expect(samples.boom!.files).toEqual(['boom.wav']);
    expect(problems).toHaveLength(4);
    expect(problems.join(' ')).toMatch(/wind: not a plain audio file name/);
    expect(problems.join(' ')).toMatch(/halyard: say where the recording came from/);
    expect(problems.join(' ')).toMatch(/foghorn: not a sound the simulator plays/);
  });
});
