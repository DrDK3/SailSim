# Review diagnostics, November 2026

These are the isolated experiments behind [docs/COMPREHENSIVE_REVIEW.md](../../docs/COMPREHENSIVE_REVIEW.md). They are **not production code**:

- They are not imported by the app, not built, not type-checked by `tsconfig.json` (which covers `src` only), and not linted (`research/` is in the ESLint ignore list).
- They read the simulator through its public modules and change nothing.

| File | What it measures | Output | How to run |
|---|---|---|---|
| `physics.ts` | Port/starboard symmetry, force balance, drift in a current, coast-down, acceleration, tacks and gybes (6, 10, 15, 18 kn), turning circle, close-hauled heel by wind speed, downwind speeds, circular-random average, ±20% sensitivity | `physics-out.json` | `npx tsx research/review-2026-11/physics.ts > physics-out.json` (about 3 min) |
| `physics2.ts` | Residuary-resistance sensitivity; the 22 kn close-hauled run with the max-drive helper versus auto-trim with flatten | `physics2-out.txt` | `npx tsx research/review-2026-11/physics2.ts` |
| `contact.ts` | Boat–boat (head-on 3+3 and 6+6 kn, a 4 kn T-bone, a glancing hit) and boat–jetty contacts (8 kn square, 5 kn at 20°, pinned by 18 kn wind): energy, tunnelling, rebound, damage | `contact-out.json` | `npx tsx research/review-2026-11/contact.ts` |
| `contact2.ts` | A glancing jetty contact traced each second, a boat pinned against a jetty, and grounding with release on the rising tide (Dart geodata) | `contact2-out.json` | `npx tsx research/review-2026-11/contact2.ts` |
| `ui/walk.mjs` | The user journey in a browser: first visit, free sailing, tutorial, quick race, start, finish, phone and laptop sizes | screenshots (five copied to `docs/img/review/`) | Start `npm run dev`, then `node research/review-2026-11/ui/walk.mjs` from a scratch folder |
| `ui/mem.mjs` | JS heap, GPU resource counts, physics cost per step with 10 AI boats | console | as above |
| `ui/leak.mjs` | GPU geometries and textures over repeated race restarts | console | as above |

The browser scripts use the Chromium build that this environment provides (`/opt/pw-browsers/chromium`) with SwiftShader, a software renderer. Their timings and pictures are **not** representative of a real GPU.
