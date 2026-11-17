# Device check: a procedure for volunteers

The simulator was developed and measured on a machine with **no graphics card** (software rendering). Nobody yet
knows how smooth it is on the devices juniors actually use. The device check measures that on a real device in about
a minute. Results from real devices are what decides the next round of performance work
([JUNIORS_REPORT.md §2](JUNIORS_REPORT.md#2-device-and-performance-evidence)).

## What it does

**Settings → Display → Check this device** sails a fixed route (Start Bay, 12 kn from the south-west, gusts on a fixed
seed) for about 50 seconds, pressing the steering and trim keys itself, then puts back whatever you were sailing. It
reports:

- **Smooth**, **Mostly smooth** or **Struggling**, with the reasons in plain words;
- frame times (median, 95th and 99th percentile, the longest, how many over 33 ms) and frames per second;
- the main-thread work per frame (physics, scene update and drawing commands, not the graphics card's own work);
- start-up: time to the first frame, time until the boat could be sailed, and any freezes over 100 ms while loading
  (with "shader compile" where the app knows that was the cause);
- how long a key press takes to show on the helm (from the key event to the end of the frame that first draws it);
- the graphics card's name, the screen size, the pixel ratio, the processor count and memory class where the browser
  says, the browser engine family (Chromium, Gecko or WebKit: not the full browser string), the preset at the start and
  end, and whether the quality was lowered automatically.

It records **no personal details**: no name, location, account or address. The result stays on the device until you
press **Copy the result** or **Save as a file**.

## The procedure (about 5 minutes a device)

1. Use the device as a junior would: plugged in or not, the usual browser, other tabs closed. Note in a message what
   the device is (for example "school Chromebook, about 2021", "iPad 9th generation", "family Android phone"): this
   is the only thing the check cannot find out itself.
2. Open the published site. Wait until the boat is on the water (the first visit may ask "Have you sailed before?").
3. Open **Settings** (the gear, or **Menu → Settings** on a phone), then **Display → Check this device**. Do not touch
   the device for about a minute; the boat steers itself.
4. When the result appears, press **Copy the result** and paste it into a message (or **Save as a file** and attach
   it), with the note from step 1.
5. Optional, and useful: run it once more after choosing **Smooth** under Graphics quality, and say so in the message.

Send the messages to the person collecting them for the owner. Nothing is uploaded by the check itself.

## Devices most worth checking

| Kind | Why |
|---|---|
| School Chromebooks | Many juniors' only computer; often low-power graphics |
| Older Windows laptops (5+ years) | Integrated graphics, slow disks |
| iPads (any) | WebKit (Safari) is the only engine on iPads: also tells us how WebKit draws the sim |
| Android tablets and phones | Small screens, high pixel ratios, battery saving |
| A recent laptop with a graphics card | A "good case" for comparison |

## Reading a result

- **Smooth**: 95% of frames under 33 ms (30 frames a second or better), no hitches over 100 ms, the helm shows a key
  press within 100 ms. Thresholds are estimates (E) from the brief, not measured preferences of juniors.
- **Mostly smooth**: playable, with the reasons listed (for example "1 frame in 20 took longer than 33 ms").
- **Struggling**: most frames take longer than 33 ms, or more than 2% are hitches. On such a device, try **Smooth** and
  leave **Automatic quality** on.

The check runs in the browser only; it uses no service and costs nothing.
