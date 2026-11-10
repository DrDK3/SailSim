/**
 * Walkers keep out of the river (owner, 6 Nov 2026: people walking through the river to reach the foot ferry). An
 * OSM footway ran along the Kingswear passenger pier's old fixed jetty, which the picture now draws as a gangway to
 * a floating landing stage, so walkers crossed the water beside the gangway. They now stop where the picture can
 * draw the river and the ground is below high water springs, unless on a fixed jetty's deck, where they stand on
 * the deck rather than on the bed beneath it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WALK_DRY_ODN, fixedDeckAt, maskSampler, walkKeepOut } from '../../src/render/dart';
import { MASK_MARGIN_M } from '../../src/render/water';
import { PONTOON } from '../../src/render/pontoons';
import { KINGSWEAR_PASSENGER_PIER } from '../../src/render/royalDart';
import { rdycKeepOut } from '../../src/render/rdyc';
import { splitWalkable } from '../../src/render/population';
import { gridGround } from '../../src/sim/env/quays';
import { physicsGround } from '../../src/app/geoLoader';
import { loadDartApp, readGreyPng } from '../sim/helpers';

const app = loadDartApp();
const drawn = { spec: app.town.spec, values: physicsGround(app.town, app.quays).values };
const standAt = (e: number, n: number) => gridGround(drawn, e, n) ?? app.geo.bedElevation(n, e);
const manifest = JSON.parse(readFileSync(new URL('../../public/geo/manifest.json', import.meta.url), 'utf8'));
const png = readGreyPng(readFileSync(new URL(`../../public/geo/${manifest.waterMask.file}`, import.meta.url)));
const maskDistance = maskSampler(manifest.waterMask, (i) => png.px[i]!);
const deckAt = fixedDeckAt(app.features);
const club = rdycKeepOut(app.features.buildings.find((b) => b.n === 'Royal Dart Yacht Club')?.r ?? []);
const keepOut = walkKeepOut({ club, standAt, deckAt, tidal: (e, n) => maskDistance(e, n) > -MASK_MARGIN_M });

describe('walkers and the river', () => {
  it('reads the water mask as the water shader does: in the river, out of it inland', () => {
    expect(maskDistance(-150, 300)).toBeGreaterThan(20);
    expect(maskDistance(-560, 380)).toBeLessThan(-MASK_MARGIN_M);
  });

  it("walk the old passenger jetty's footway only as far as the water: none walks out to the landing stage", () => {
    const { shore, river } = KINGSWEAR_PASSENGER_PIER;
    const pieces = splitWalkable([shore, river], keepOut, 0.3);
    const reach = Math.max(0, ...pieces.flatMap((p) => p.map(([e, n]) => Math.hypot(e - shore[0], n - shore[1]))));
    const length = Math.hypot(river[0] - shore[0], river[1] - shore[1]);
    // The jetty runs 35 m out from the shore: the walking stops within its first quarter.
    expect(length).toBeGreaterThan(30);
    expect(reach).toBeLessThan(length / 4);
    // Out over the water, the ground under the old jetty is well below high water.
    const mid = [(shore[0] + river[0]) / 2, (shore[1] + river[1]) / 2] as const;
    expect(standAt(mid[0], mid[1])).toBeLessThan(WALK_DRY_ODN - 2);
    expect(keepOut(mid[0], mid[1])).toBe(true);
  });

  it("stand on a fixed jetty's deck, not on the bed beneath it: Dartmouth's Town Jetty", () => {
    expect(standAt(-247, 330)).toBeLessThan(0);
    expect(deckAt(-247, 330)).toBe(PONTOON.fixedDeck);
    expect(keepOut(-247, 330)).toBe(false);
  });

  it("walk Dartmouth's low town centre as before: below high water, but the tide does not reach it", () => {
    expect(standAt(-548, 365)).toBeLessThan(WALK_DRY_ODN);
    expect(keepOut(-548, 365)).toBe(false);
    // Without the water mask the rule can only go by height, and would keep them off it.
    expect(walkKeepOut({ club, standAt, deckAt })(-548, 365)).toBe(true);
  });

  it('keep off the river side of the yacht club and out of its clubhouse, as before', () => {
    expect(keepOut(-30, 0)).toBe(true);
  });
});
