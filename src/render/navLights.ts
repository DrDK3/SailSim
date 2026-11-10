import * as THREE from 'three';

/**
 * Navigation lights after the COLREGs (owner, 10 Nov 2026: "shipping lights for night, aligned with COLREGS lighting
 * requirements"). The rules were checked against secondary sources (study texts and rule summaries; the IMO text
 * itself could not be fetched here: docs/SOURCES.md C1–C6), so this is a teaching aid, not an authority:
 *
 * - Rule 21 (arcs): masthead light 225° (dead ahead to 22.5° abaft the beam each side); sidelights 112.5° each (dead
 *   ahead to 22.5° abaft the beam on their own side), green to starboard, red to port; sternlight 135° (67.5° either
 *   side of dead astern); all-round light 360°.
 * - Rule 22 (least ranges, nautical miles): under 12 m masthead 2, sidelights 1, stern and all-round 2; 12–20 m
 *   masthead 3, others 2; 20–50 m masthead 5, others 2; 50 m and over masthead 6, others 3.
 * - Rule 23(a), (d): a power-driven vessel under way shows a masthead light, sidelights and a sternlight; under 12 m
 *   she may show an all-round white light and sidelights instead.
 * - Rule 24(c): pushing ahead or towing alongside, two masthead lights in a vertical line, sidelights and a sternlight.
 *   The vessel towed alongside shows a sternlight and, at her forward end, sidelights (Rule 24(f)).
 * - Rule 25: a sailing vessel shows sidelights and a sternlight (under 20 m they may be one lantern at the masthead);
 *   under 7 m, if she cannot, a torch shown in time to prevent collision.
 * - Rule 27(b): restricted in her ability to manoeuvre, three all-round lights in a vertical line, red, white, red; when
 *   making way also her masthead, side and stern lights. The harbour guide names the Lower Ferries (tug and float) and
 *   the Higher Ferry as restricted in their ability to manoeuvre (docs/CLUB_DOCUMENTS.md, p.33).
 * - Rule 30: at anchor an all-round white light (one is enough under 50 m).
 */

export type Arc = 'masthead' | 'port' | 'starboard' | 'stern' | 'all-round';
export type LightColour = 'white' | 'red' | 'green';

export interface NavLight {
  arc: Arc;
  colour: LightColour;
  /** Position in the vessel's frame (x starboard, y up from the waterline, z aft; bow towards −z). */
  x: number;
  y: number;
  z: number;
  /** The least range the rules require (nautical miles, Rule 22). */
  rangeNm: number;
}

/** How far a sidelight shows across the bow, the cut-off Annex I allows (1–3°): 1°, E. */
const BOW_SPILL_DEG = 1;

/** Is a viewer at `bearingDeg` from the bow (> 0 to starboard, −180 … 180) inside the light's arc (Rule 21)? */
export function inArc(arc: Arc, bearingDeg: number): boolean {
  let b = ((bearingDeg % 360) + 360) % 360;
  if (b > 180) b -= 360;
  switch (arc) {
    case 'all-round':
      return true;
    case 'masthead':
      return Math.abs(b) <= 112.5;
    case 'starboard':
      return b >= -BOW_SPILL_DEG && b <= 112.5;
    case 'port':
      return b <= BOW_SPILL_DEG && b >= -112.5;
    case 'stern':
      return Math.abs(b) >= 112.5;
  }
}

/** Rule 22's least ranges (nautical miles) by length (m). */
export function lightRanges(lengthM: number): { masthead: number; side: number; stern: number; allRound: number } {
  if (lengthM < 12) return { masthead: 2, side: 1, stern: 2, allRound: 2 };
  if (lengthM < 20) return { masthead: 3, side: 2, stern: 2, allRound: 2 };
  if (lengthM < 50) return { masthead: 5, side: 2, stern: 2, allRound: 2 };
  return { masthead: 6, side: 3, stern: 3, allRound: 3 };
}

/** What a vessel is, for her lights. */
export type LightRole =
  /** Rule 23(a): under way under power. */
  | 'power'
  /** Rule 23(d)(i): under 12 m, an all-round white and sidelights. */
  | 'power-small'
  /** Rule 24(c): pushing ahead or towing alongside (the Lower Ferry's tug). */
  | 'towing-alongside'
  /** Rule 24(f): towed alongside (the Lower Ferry's float). */
  | 'towed-alongside'
  /** Rule 25(a): under sail (not used for the Squibs, under 7 m: Rule 25(d)). */
  | 'sailing'
  /** Rule 30: at anchor. */
  | 'anchored';

export interface LightGeometry {
  length: number;
  beam: number;
  /** Height of the (upper) masthead light and where along she carries it (z, m). */
  mastY: number;
  mastZ?: number;
  /** Height of the sidelights. */
  sideY?: number;
}

/**
 * The lights a vessel shows for her role, placed on her (`ram`: also restricted in her ability to manoeuvre, Rule 27).
 */
export function colregsLights(role: LightRole, g: LightGeometry, ram = false): NavLight[] {
  const r = lightRanges(g.length);
  const mz = g.mastZ ?? -g.length * 0.1;
  const sy = g.sideY ?? g.mastY * 0.55;
  const half = Math.max(0.2, g.beam / 2 - 0.15);
  const out: NavLight[] = [];
  const sides = (z: number) => {
    out.push({ arc: 'port', colour: 'red', x: -half, y: sy, z, rangeNm: r.side });
    out.push({ arc: 'starboard', colour: 'green', x: half, y: sy, z, rangeNm: r.side });
  };
  const stern = () => out.push({ arc: 'stern', colour: 'white', x: 0, y: Math.max(0.6, sy * 0.8), z: g.length / 2 - 0.15, rangeNm: r.stern });
  switch (role) {
    case 'power':
      out.push({ arc: 'masthead', colour: 'white', x: 0, y: g.mastY, z: mz, rangeNm: r.masthead });
      sides(mz + 0.4);
      stern();
      break;
    case 'power-small':
      out.push({ arc: 'all-round', colour: 'white', x: 0, y: g.mastY, z: mz, rangeNm: r.allRound });
      sides(mz + 0.4);
      break;
    case 'towing-alongside':
      out.push({ arc: 'masthead', colour: 'white', x: 0, y: g.mastY, z: mz, rangeNm: r.masthead });
      out.push({ arc: 'masthead', colour: 'white', x: 0, y: g.mastY - 1, z: mz, rangeNm: r.masthead });
      sides(mz + 0.4);
      stern();
      break;
    case 'towed-alongside':
      sides(-g.length / 2 + 0.6);
      stern();
      break;
    case 'sailing':
      sides(-g.length * 0.3);
      stern();
      break;
    case 'anchored':
      out.push({ arc: 'all-round', colour: 'white', x: 0, y: g.mastY, z: mz, rangeNm: r.allRound });
      break;
  }
  if (ram) {
    // Red, white, red, in a vertical line above the rest (where best seen).
    const top = Math.max(...out.map((l) => l.y), g.mastY) + 0.5;
    (['red', 'white', 'red'] as const).forEach((colour, i) => out.push({ arc: 'all-round', colour, x: 0, y: top + 1 - i * 0.5, z: mz, rangeNm: r.allRound }));
  }
  return out;
}

// ------------------------------------------------------------------ drawing

const HEX: Record<LightColour, number> = { white: 0xfff6e0, red: 0xff2a1a, green: 0x2aff6a };
const NM = 1852;
/** A light's size on the screen (share of the view's height, about 8 px at 800 px; E). */
const SPRITE_SCALE = 0.016;

let glow: THREE.Texture | undefined;
function glowTexture(): THREE.Texture | undefined {
  if (glow || typeof document === 'undefined') return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  if (!x) return undefined;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c);
  return glow;
}

const MATERIALS = new Map<LightColour, THREE.SpriteMaterial>();
function materialFor(colour: LightColour): THREE.SpriteMaterial {
  let m = MATERIALS.get(colour);
  if (!m) {
    m = new THREE.SpriteMaterial({ color: HEX[colour], map: glowTexture() ?? null, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    MATERIALS.set(colour, m);
  }
  return m;
}

/** The letter for a sidelight, for players who cannot tell red from green (P port, S starboard). */
const LABEL_MATERIALS = new Map<string, THREE.SpriteMaterial>();
function labelMaterial(letter: 'P' | 'S'): THREE.SpriteMaterial | undefined {
  if (typeof document === 'undefined') return undefined;
  let m = LABEL_MATERIALS.get(letter);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    if (!x) return undefined;
    x.font = 'bold 44px sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineWidth = 8;
    x.strokeStyle = 'rgba(0,0,0,0.85)';
    x.strokeText(letter, 32, 34);
    x.fillStyle = '#ffffff';
    x.fillText(letter, 32, 34);
    m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
    LABEL_MATERIALS.set(letter, m);
  }
  return m;
}

/** A group of light sprites for the lights given; each knows its arc and range (userData). */
export function buildLights(lights: readonly NavLight[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lights';
  for (const l of lights) {
    const s = new THREE.Sprite(materialFor(l.colour));
    s.name = `light-${l.arc}-${l.colour}`;
    s.position.set(l.x, l.y, l.z);
    s.scale.setScalar(SPRITE_SCALE);
    s.userData = { arc: l.arc, rangeM: l.rangeNm * NM };
    group.add(s);
    if (l.arc === 'port' || l.arc === 'starboard') {
      const lm = labelMaterial(l.arc === 'port' ? 'P' : 'S');
      if (lm) {
        const t = new THREE.Sprite(lm);
        t.name = 'light-label';
        t.position.set(l.x + (l.arc === 'port' ? -0.4 : 0.4), l.y + 0.5, l.z);
        t.scale.setScalar(SPRITE_SCALE * 1.6);
        t.userData = { labelFor: s };
        t.visible = false;
        group.add(t);
      }
    }
  }
  return group;
}

const v = new THREE.Vector3();
const local = new THREE.Vector3();

/**
 * Show each light only inside its arc and range, seen from `camera` (`lit` false: all off). The group's parent is the
 * vessel, posed in the world; `labels` adds the sidelights' letters.
 */
export function updateLights(group: THREE.Object3D, camera: THREE.Camera, lit: boolean, labels = false): void {
  const parent = group.parent;
  if (!lit || !parent) {
    for (const c of group.children) c.visible = false;
    return;
  }
  parent.updateWorldMatrix(true, false);
  local.copy(camera.position);
  parent.worldToLocal(local);
  for (const c of group.children) {
    const ud = c.userData as { arc?: Arc; rangeM?: number; labelFor?: THREE.Object3D };
    if (ud.labelFor) continue;
    if (!ud.arc) continue;
    v.copy(local).sub(c.position);
    // Bearing of the viewer from the bow (−z), > 0 to starboard (+x).
    const bearing = (Math.atan2(v.x, -v.z) * 180) / Math.PI;
    const d = v.length();
    const range = ud.rangeM ?? 2 * NM;
    const shown = inArc(ud.arc, bearing) && d < range;
    c.visible = shown;
    // Dimmer (smaller) over the last fifth of its range.
    c.scale.setScalar(SPRITE_SCALE * Math.min(1, Math.max(0.35, (range - d) / (0.2 * range))));
  }
  for (const c of group.children) {
    const ud = c.userData as { labelFor?: THREE.Object3D };
    if (ud.labelFor) c.visible = labels && ud.labelFor.visible;
  }
}
