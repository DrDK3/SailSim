/**
 * The Kingswear light (owner, 17 Nov 2026: chart position 50°20.81'N 003°34.09'W, a 4 m round tower with a conical
 * lantern on a large rock at the water's edge, focal height 9 m above high water, Iso WRG 3s; its charted sectors,
 * Admiralty A0236: green 318°–325°, white 325°–331°, and 331°–340°, red as the third colour of WRG). These tests hold
 * it at that position, at the water's edge, at that height, showing each sector's colour only there, and its rock
 * solid to the boats.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { raceStructures } from '../../src/sim/race/setup';
import { BAYARDS_COVE_LIGHT, KINGSWEAR_LIGHT, SECTOR_LIGHTS, inWhiteSector, lightBearing, lightColour, lightLocal, lightOn, kingswearLightBearing, kingswearLightLocal, kingswearRockTop, sectorColour, shoreLightStructures } from '../../src/sim/env/shoreLights';
import { BayardsLightView, KingswearLightView } from '../../src/render/kingswearLight';
import { DART_PROJECTION } from '../../src/sim/geo/projection';
import { loadDartApp } from './helpers';

const app = loadDartApp();
const c = kingswearLightLocal();
/** A viewer `d` m from the light, seeing it on bearing `brg` (deg true). */
const viewer = (brg: number, d: number) => {
  const r = (brg * Math.PI) / 180;
  return { e: c.e - Math.sin(r) * d, n: c.n - Math.cos(r) * d };
};

describe('the Kingswear light', () => {
  it("stands at its chart position, 50°20.81'N 003°34.09'W", () => {
    expect(KINGSWEAR_LIGHT.lat).toBeCloseTo(50.346833, 5);
    expect(KINGSWEAR_LIGHT.lon).toBeCloseTo(-3.568167, 5);
    const p = DART_PROJECTION.toLocal(50.346833, -3.568167);
    expect(Math.hypot(p.e - c.e, p.n - c.n)).toBeLessThan(1);
  });

  it("is at the water's edge on the eastern shore: foreshore under it, the channel just south, higher ground behind", () => {
    const at = app.geo.bedElevation(c.n, c.e);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(3);
    expect(app.geo.bedElevation(c.n - 30, c.e)).toBeLessThan(-2);
    expect(app.geo.bedElevation(c.n + 20, c.e - 20)).toBeGreaterThan(5);
    // East of Dartmouth's waterfront at the narrows: on the Kingswear side.
    expect(c.e).toBeGreaterThan(200);
  });

  it('its light is 9 m above high water: the rock top plus the tower to the lantern', () => {
    const focal = kingswearRockTop() + KINGSWEAR_LIGHT.tower.height - 0.6;
    expect(focal - KINGSWEAR_LIGHT.mhwOdn).toBeCloseTo(9, 6);
    expect(KINGSWEAR_LIGHT.tower.height).toBe(4);
  });

  it('shows white only to a viewer who sees it between 325° and 331°', () => {
    for (const b of [325.5, 328, 330.5]) for (const d of [300, 900, 1600]) expect(inWhiteSector(viewer(b, d).e, viewer(b, d).n)).toBe(true);
    for (const b of [310, 323, 333, 350, 20, 180]) expect(inWhiteSector(viewer(b, 800).e, viewer(b, 800).n)).toBe(false);
  });

  it('has its charted sectors: green 318°–325°, white 325°–331°, red 331°–340°, edge to edge', () => {
    expect(KINGSWEAR_LIGHT.sectors.map((x) => [x.colour, x.from, x.to])).toEqual([
      ['green', 318, 325],
      ['white', 325, 331],
      ['red', 331, 340],
    ]);
    expect(KINGSWEAR_LIGHT.white).toEqual([325, 331]);
    const at = (b: number) => sectorColour(viewer(b, 900).e, viewer(b, 900).n);
    for (const b of [318.5, 321, 324.5]) expect(at(b)).toBe('green');
    for (const b of [325.5, 328, 330.5]) expect(at(b)).toBe('white');
    for (const b of [331.5, 335, 339.5]) expect(at(b)).toBe('red');
    for (const b of [300, 317, 341, 360, 180]) expect(at(b)).toBeUndefined();
    // The bearing is the light's from the viewer.
    expect(kingswearLightBearing(viewer(328, 500).e, viewer(328, 500).n)).toBeCloseTo(328, 6);
  });

  it('red is to port coming in (west of the line), green to starboard (east)', () => {
    // Heading in up the white line, a boat west of it sees the light bear more than 331°.
    const on = viewer(328, 1200);
    const west = { e: on.e - 150, n: on.n };
    const east = { e: on.e + 150, n: on.n };
    expect(sectorColour(west.e, west.n)).toBe('red');
    expect(sectorColour(east.e, east.n)).toBe('green');
  });

  it('the view shows each sector its own colour at night, and G or R beside it when the letters are on', () => {
    const v = new KingswearLightView();
    const cam = new THREE.PerspectiveCamera();
    for (const [b, c] of [[321, 'green'], [328, 'white'], [335, 'red']] as const) {
      const p = viewer(b, 800);
      cam.position.set(p.e, 5, -p.n);
      v.update(cam, 0.5, true, true);
      expect(v.showingColour).toBe(c);
      const glows = ['green', 'white', 'red'].map((k) => v.group.getObjectByName(`kingswear-light-${k}`)!);
      expect(glows.filter((g) => g.visible).map((g) => g.name)).toEqual([`kingswear-light-${c}`]);
      v.update(cam, 2, true, true);
      expect(v.showing).toBe(false);
    }
    const p = viewer(300, 800);
    cam.position.set(p.e, 5, -p.n);
    v.update(cam, 0.5, true, true);
    expect(v.showing).toBe(false);
  });

  it('the view lights it only at night, in the white sector, for half of every 3 s', () => {
    const v = new KingswearLightView();
    const cam = new THREE.PerspectiveCamera();
    const inSector = viewer(328, 800);
    cam.position.set(inSector.e, 5, -inSector.n);
    v.update(cam, 0.5, true);
    expect(v.showing).toBe(true);
    v.update(cam, 2.0, true);
    expect(v.showing).toBe(false);
    v.update(cam, 3.4, true);
    expect(v.showing).toBe(true);
    v.update(cam, 0.5, false);
    expect(v.showing).toBe(false);
    const out = viewer(300, 800);
    cam.position.set(out.e, 5, -out.n);
    v.update(cam, 0.5, true);
    expect(v.showing).toBe(false);
    // The tower stands on the rock, its lantern's window towards the south-west.
    expect(v.group.getObjectByName('kingswear-light-tower')!.position.y).toBeCloseTo(kingswearRockTop(), 6);
  });

  it('its rock is solid to the boats on the river data', () => {
    const solid = raceStructures(app.features as never, app.geo);
    const rock = solid.find((s) => s.name === shoreLightStructures()[0]!.name);
    expect(rock).toBeDefined();
    expect(rock!.floating).toBe(false);
    expect(raceStructures(app.features as never, undefined).some((s) => s.name === rock!.name)).toBe(false);
  });
});

describe("Bayard's Cove light (position and sector limits estimated, at the owner's choice)", () => {
  const b = lightLocal(BAYARDS_COVE_LIGHT);
  const from = (brg: number, d: number) => {
    const r = (brg * Math.PI) / 180;
    return { e: b.e - Math.sin(r) * d, n: b.n - Math.cos(r) * d };
  };

  it('has its charted character, Fl WRG 2s 5m 6M, flashing 0.5 s in every 2 s, 5 m above high water', () => {
    expect(BAYARDS_COVE_LIGHT.character).toBe('Fl WRG 2s 5m 6M');
    expect(BAYARDS_COVE_LIGHT.period).toBe(2);
    expect(BAYARDS_COVE_LIGHT.focalAboveMHW).toBe(5);
    expect(lightOn(BAYARDS_COVE_LIGHT, 0.2)).toBe(true);
    expect(lightOn(BAYARDS_COVE_LIGHT, 1.2)).toBe(false);
    expect(lightOn(BAYARDS_COVE_LIGHT, 4.3)).toBe(true);
    expect(SECTOR_LIGHTS).toContain(BAYARDS_COVE_LIGHT);
  });

  it('stands at the water\'s edge on the Dartmouth shore, west of the Kingswear light', () => {
    expect(app.geo.bedElevation(b.n, b.e)).toBeGreaterThan(0.5);
    expect(app.geo.bedElevation(b.n, b.e + 15)).toBeLessThan(-2);
    expect(b.e).toBeLessThan(kingswearLightLocal().e - 400);
  });

  it('its white sector holds the 293° lead, with green and red edge to edge either side (red to port coming in)', () => {
    const ss = BAYARDS_COVE_LIGHT.sectors;
    expect(ss.map((x) => x.colour)).toEqual(['green', 'white', 'red']);
    for (let i = 1; i < ss.length; i++) expect(ss[i]!.from).toBe(ss[i - 1]!.to);
    expect(ss[1]!.from).toBeLessThan(293);
    expect(ss[1]!.to).toBeGreaterThan(293);
    const on = from(293, 700);
    expect(lightColour(BAYARDS_COVE_LIGHT, on.e, on.n)).toBe('white');
    expect(lightBearing(BAYARDS_COVE_LIGHT, on.e, on.n)).toBeCloseTo(293, 6);
    // South of the line (to port heading in, 293°) the light bears more: red; north of it, green.
    expect(lightColour(BAYARDS_COVE_LIGHT, on.e, on.n - 90)).toBe('red');
    expect(lightColour(BAYARDS_COVE_LIGHT, on.e, on.n + 90)).toBe('green');
    expect(lightColour(BAYARDS_COVE_LIGHT, from(320, 700).e, from(320, 700).n)).toBeUndefined();
  });

  it('the 293° lead runs over water from the narrows up to the light', () => {
    for (let d = 60; d <= 900; d += 30) {
      const p = from(293, d);
      expect(app.geo.bedElevation(p.n, p.e)).toBeLessThan(0);
    }
  });

  it('the view flashes the colour of the camera\'s sector at night', () => {
    const v = new BayardsLightView(app.geo.bedElevation(b.n, b.e));
    const cam = new THREE.PerspectiveCamera();
    for (const [brg, c] of [[286, 'green'], [293, 'white'], [300, 'red']] as const) {
      const p = from(brg, 600);
      cam.position.set(p.e, 4, -p.n);
      v.update(cam, 0.2, true);
      expect(v.showingColour).toBe(c);
      v.update(cam, 1.0, true);
      expect(v.showing).toBe(false);
      v.update(cam, 0.2, false);
      expect(v.showing).toBe(false);
    }
  });
});

