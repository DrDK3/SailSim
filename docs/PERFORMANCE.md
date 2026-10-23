# Performance

This page covers two things:
- the cost of the simulation per frame (acceptance criterion 12);
- what the browser downloads and does when the app loads.

Measurements were taken in the development container: Chromium with **software WebGL** (SwiftShader), no GPU. Times there are much slower than on a laptop with a graphics card, so compare builds on the same machine, not with these numbers.

## 1. Simulation cost per frame (criterion 12)

`npm run perf` (`tools/perf.ts`) measures the physics of 21 boats on the River Dart, and a full race with 20 AI boats. Phase 5 results are in [PHASE5_REPORT.md](PHASE5_REPORT.md) §3: physics 0.80 ms mean and 1.98 ms p99 per 60 Hz frame (pass). A run at the end of Phase 6 (23 Oct 2026) measured:
- physics, 21 boats: 0.43 ms mean, 1.07 ms p99;
- full race with 20 AI boats: 0.96–1.01 ms mean, 2.83–3.02 ms p99.

Phase 6 did not change the physics or the AI, so the difference from Phase 5 is run-to-run variation on this shared machine. The determinism hash of a 7-boat, 400 s race on the River Dart is unchanged after the Phase 6 changes, including the packed grids (§2).

## 2. Loading: what changed in Phase 6

### Download size

Measured with `tools/load-timing.mjs`. The site was served by `tools/pages-server.mjs` with `GZIP=1`, which gzips text files the way GitHub Pages does.

| | Before (commit 5204dd3) | After |
|---|---|---|
| **Total transferred** | **4.92 MB** | **1.43 MB** (−71 %) |
| Elevation grid | 2,026 kB (`elevation.bin`) | 570 kB (`elevation.i16z`) |
| Stream grid | 2,026 kB (`current.bin`) | 90 kB (`current.i16z`) |
| JavaScript at start | 304 kB (one file) | 289 kB (`three` 150, `index` 81, `react` 58) |
| Features, drape, minimap | 185 + 136 + 108 kB | unchanged |

What made the difference:

1. **Packed grids.** The two River Dart grids are packed losslessly (gradient prediction, zigzag, byte planes, gzip: [GEODATA.md](GEODATA.md#files-publicgeo)). Together they shrink from 4.1 MB to 0.68 MB.
   - **Not a single value changes.** `tests/sim/pack.test.ts` checks the unpacked bytes against the SHA-256 of the original grids.
   - **Why pack them ourselves:** GitHub Pages compresses text files, but the grids are binary files and were sent uncompressed.
2. **Code split.** The nine panels that open on demand load their code when first opened: Scenario, Library, Dashboard, Polar, Debug, Layers, Courses, Results and Help. That is 69 kB (24 kB gzipped) no longer loaded at start.
   - **Separate chunks for three.js and React.** They change only when their versions change, so a new deploy of the app re-downloads about 81 kB instead of about 300 kB.
3. **Earlier download.** The River Dart download now starts before the 3D view is built. Building the view compiles shaders for a second or more, so the two now overlap.

### Load time: measured, and why it did not move here

| Build | 10 Mbit/s | Unthrottled |
|---|---|---|
| Before | 8.9 s | 8.3 s |
| After | 8.7 s | 8.4 s |

These are the times until the River Dart is in the scene: the median of 5 runs, in this container.

**What dominates here is not the network. It is software rendering.** A load profile (Chrome DevTools protocol, unminified build) shows two causes:
- **Shader compilation:** about 2–3 s in total, for the first frames of the open-water scene and then for the River Dart scene.
- **A one-off stall of 5–7 s:** this happens at the first drawing on a 2D canvas during loading.
  - It first appeared in the River Dart labels. When the labels were deferred as an experiment, the stall moved to the minimap. That experiment is not kept.
  - In a profile run with Chromium's `--disable-accelerated-2d-canvas`, it disappeared: the river loaded in 4.0 s. Timed runs with that flag still took about 8 s, so the cause is not fully pinned down.
  - The most likely explanation is that the 2D canvas waits for the GPU process, which software WebGL keeps busy.

Neither cause can be measured on real graphics hardware from this environment (OUTSTANDING_ISSUES 43).

**Expected effect on a real device (an estimate, not measured):** 3.5 MB less to download is about 2.8 s less at 10 Mbit/s, and about 0.6 s less at 50 Mbit/s.

## 3. How to measure

```bash
npm run build
GZIP=1 node tools/pages-server.mjs 4175 squib-dart-sim dist &
node tools/load-timing.mjs http://localhost:4175/squib-dart-sim/ 10 5   # Mbit/s, runs
npm run perf                                                         # simulation cost per frame
```

`tools/load-timing.mjs` prints:
- the time until the instruments are live;
- the time until the River Dart has loaded;
- the bytes per file.

Set `CHROMIUM_FLAGS` to pass extra browser flags.

## 4. Browser support for the packed grids

Unpacking uses the browser's `DecompressionStream`, which current Chrome, Edge, Firefox and Safari provide.

**In a browser without it:**
- the River Dart data is reported as unavailable, with the reason;
- the app sails on open water;
- nothing else is affected.

## 5. Possible next steps (not done)

- **`features.json`** is 703 kB (185 kB gzipped), mostly building outlines. Rounding coordinates further, or a binary format, could halve it.
- **Shader compilation:** compiling shaders in parallel (`renderer.compileAsync`) would stop it blocking the first frames, where the browser supports it.
- **Real hardware:** measure loading on a laptop and a phone with real GPUs.
