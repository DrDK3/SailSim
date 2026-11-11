# Sound

Everything you hear is made in the browser from noise and oscillators (`src/render/audio.ts`), unless a recording has been added as described below. Nothing is downloaded from anywhere else, and no sound or speech leaves the device.

## Where sounds come from

The listener is the camera. These sounds are placed round it, so on headphones you can tell where they come from. The horn and the ships' whistles use head-related (HRTF) panning; the boat's own sounds and the halyards, which play all the time or often, use cheaper equal-power panning (HRTF filtering running continuously costs too much on a slow device):

| Sound | Comes from |
|---|---|
| Race committee horn (RRS 26, 29) | The committee boat (or the middle of the line); quieter and duller further away |
| Ships' whistles (COLREGs Rules 32–35) | Each vessel sounding |
| Halyards clinking | About the nearest moored boat |
| Sails flogging, boom crossing, knocks, scrapes, glassfibre breaking | Your own boat |

The wind (panned to the side it blows from) and the water stay as they were. Levels and pitches are estimates for the ear (E).

## Spoken start countdown

Settings → Sound → "Spoken start countdown in races". Off by default. In a race it calls five, four, three, two and one minute, thirty and twenty seconds, then every second from ten (`src/app/countdown.ts`). It only repeats what the race panel and the horn already say.

It speaks with a voice on the device only: one the browser marks as local (`SpeechSynthesisVoice.localService`). Network voices, such as Chrome's "Google" voices, which send the text to a speech service, are never used (`src/render/speech.ts`). Without a local voice nothing is spoken, and Settings says so. It is silent during replays, at faster than real time, when paused and when the sound is muted.

## Adding recordings (optional)

None are included. To use a recording in place of a synthesised sound:

1. Put the file in `public/audio/` (OGG, MP3, WAV, M4A/AAC, WebM, FLAC or Opus).
2. Add an entry to `public/audio/manifest.json`, saying where it came from and its licence. Entries without both are left out.

```json
{
  "samples": {
    "horn": { "files": ["horn-1.ogg"], "gain": 1, "source": "Owner, RDYC start box, July 2026", "licence": "owner's own recording" },
    "halyard": { "files": ["halyard-1.wav", "halyard-2.wav"], "source": "…", "licence": "CC0 1.0" }
  }
}
```

| Kind | Used for | Played |
|---|---|---|
| `wind` | The wind | Looped; level and pitch follow the apparent wind |
| `water` | The water past the hull | Looped; follows the speed through the water |
| `flutter` | Sails flogging | Looped; follows how much the sails luff |
| `halyard` | Halyards on masts near moorings | Once per clink, a file at random |
| `horn`, `horn-long` | The committee's short and long sounds | Once per sound |
| `whistle`, `whistle-long` | Ships' short and prolonged blasts | Once per blast, pitched by the vessel's size |
| `boom` | The boom crossing | Once |
| `knock` | Contact with a boat, mark or pontoon | Once |

`gain` (0 to 2, default 1) balances a recording against the rest. Files must be plain names in the folder, not paths or web addresses. A kind without a valid recording is synthesised as before. Settings → Sound lists the recordings in use.

Freely licensed recordings (for example CC0 ones) must have their licence checked before they are added; the simulator does not fetch or check them itself.
