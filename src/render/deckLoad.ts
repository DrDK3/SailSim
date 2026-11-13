import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_TRIM, carParts, type CarType } from './carShape';
import { CAR_COLOURS, VMAT } from './vessels';
import { bakedPerson } from './crew';
import type { VesselState } from '../sim/env/traffic';

/**
 * The car ferries' loads coming and going (owner, 12 Nov 2026: "when the ferries dock, cars and passengers get off,
 * and new cars and passengers get on"). Two sets of cars and foot passengers take turns: the set that came across
 * drives and walks off over the ramp and up the slip once the ramp is down, lane by lane; then the other set comes
 * aboard, the cars to their places in the lanes and the passengers to the rails, all settled before the ramp lifts.
 * Under way the set she carries stands still. Timed from the traffic model's stop at the slip (VesselState.deck);
 * the numbers of cars and people, their speeds and spacing are estimates (E). Visual only.
 */

/** Where the cars and people go on a deck (the model's frame: x across, z along, the bow at -z). */
export interface DeckLayout {
  deckY: number;
  deckL: number;
  /** Car lanes: their x and the slots' z along them. */
  lanes: { x: number; z: number[] }[];
  /** Where foot passengers stand: x along each walkway (or deck edge) and the height of its floor above the deck. */
  walks: { x: number; y: number }[];
}

const TYPES: CarType[] = [0, 2];
const PERSON_SEEDS = [3, 8];

/** Seconds for the ramp to come down before anyone moves, between lanes, the walking speed (E). */
const RAMP_S = 8;
const LANE_GAP_S = 4;
const WALK = 1.4;
/** How far up the slip the cars go before they are out of sight (m), and how far the passengers walk (m) (E). */
const AWAY = 45;
const PEOPLE_AWAY = 30;
/** The cars' speed on and off (m/s) and how hard they speed up and slow down (m/s²) (E). */
const DRIVE = 3.5;
const ACCEL = 0.9;
/** The ramp's length from its hinge and its tilt down onto the slip (rad), as drawn (src/render/traffic.ts). */
const RAMP_LEN = 3.5;
const RAMP_DOWN = 0.12;
/** The steepest a car climbs or descends the slip (rise per metre): the ground smoothed under it (E). */
const SLIP_UP = 0.16;
const SLIP_DOWN = 0.08;

/** Distance driven `t` s after moving off from rest: speeding up, then at DRIVE. */
function drivenOff(t: number): number {
  if (t <= 0) return 0;
  const tA = DRIVE / ACCEL;
  return t < tA ? 0.5 * ACCEL * t * t : 0.5 * DRIVE * tA + DRIVE * (t - tA);
}

/** Distance covered `t` s into a run of `dist` m coming aboard at DRIVE and slowing to a stop at its end. */
function drivenOn(t: number, dist: number): number {
  if (t <= 0) return 0;
  const dDec = (DRIVE * DRIVE) / (2 * ACCEL);
  const t1 = Math.max(0, dist - dDec) / DRIVE;
  if (t < t1) return DRIVE * t;
  const tt = Math.min(DRIVE / ACCEL, t - t1);
  return Math.min(dist, DRIVE * t1 + DRIVE * tt - 0.5 * ACCEL * tt * tt);
}

/** Seconds to drive `dist` m off from rest, and to drive `dist` m on and stop. */
const offTime = (dist: number) => DRIVE / ACCEL + Math.max(0, dist - (DRIVE * DRIVE) / (2 * ACCEL)) / DRIVE;
const onTime = (dist: number) => Math.max(0, dist - (DRIVE * DRIVE) / (2 * ACCEL)) / DRIVE + DRIVE / ACCEL;

const hash = (a: number, b: number, c: number) => {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

function bodyAndRest(type: CarType): { body: THREE.BufferGeometry; rest: THREE.BufferGeometry } {
  const colourise = (g: THREE.BufferGeometry, hex: number) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    ng.computeVertexNormals();
    const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
    const col = new Float32Array(ng.getAttribute('position').count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return ng;
  };
  const parts = carParts(type, true);
  const body = mergeGeometries(parts.filter((p) => p.role === 'body').map((p) => colourise(p.geo, 0xffffff)))!;
  const rest = mergeGeometries(parts.filter((p) => p.role !== 'body').map((p) => colourise(p.geo, CAR_TRIM[p.role as Exclude<typeof p.role, 'body'>])))!;
  return { body, rest };
}

let shared: { cars: { body: THREE.BufferGeometry; rest: THREE.BufferGeometry }[]; people: THREE.BufferGeometry[] } | undefined;
function geometries() {
  shared ??= { cars: TYPES.map(bodyAndRest), people: PERSON_SEEDS.map((s) => bakedPerson(s, false)) };
  return shared;
}

interface Car {
  set: 0 | 1;
  lane: number;
  x: number;
  z: number;
  type: number;
  index: number;
}
interface Person {
  set: 0 | 1;
  x: number;
  y: number;
  z: number;
  kind: number;
  index: number;
}


export class DeckLoad {
  readonly group = new THREE.Group();
  private readonly cars: Car[] = [];
  private readonly people: Person[] = [];
  private readonly carMeshes: { body: THREE.InstancedMesh; rest: THREE.InstancedMesh }[] = [];
  private readonly personMeshes: THREE.InstancedMesh[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly zero = new THREE.Vector3(0, 0, 0);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly layout: DeckLayout, seed: number, fill = 0.85) {
    this.group.name = 'deck-load';
    const g = geometries();
    const counts = TYPES.map(() => 0);
    const pcounts = PERSON_SEEDS.map(() => 0);
    for (const set of [0, 1] as const) {
      layout.lanes.forEach((ln, li) => {
        ln.z.forEach((z, si) => {
          if (hash(seed, set * 31 + li, si) > fill) return;
          const type = hash(seed + 7, set, li * 17 + si) < 0.7 ? 0 : 1;
          this.cars.push({ set, lane: li, x: ln.x, z, type, index: counts[type]!++ });
        });
      });
      const n = 2 + Math.floor(hash(seed + 3, set, 5) * 5);
      for (let k = 0; k < n; k++) {
        const w = layout.walks[k % layout.walks.length]!;
        const kind = k % PERSON_SEEDS.length;
        this.people.push({ set, x: w.x + (hash(seed, set, k) - 0.5) * 0.3, y: w.y, z: -layout.deckL / 2 + 3 + ((k * 2.3 + hash(seed + 1, set, k) * 2) % (layout.deckL - 6)), kind, index: pcounts[kind]!++ });
      }
    }
    TYPES.forEach((_, t) => {
      const body = new THREE.InstancedMesh(g.cars[t]!.body, VMAT.gloss, Math.max(1, counts[t]!));
      const rest = new THREE.InstancedMesh(g.cars[t]!.rest, VMAT.paint, Math.max(1, counts[t]!));
      body.name = `deck-cars-${t}`;
      rest.name = `deck-cars-trim-${t}`;
      for (const im of [body, rest]) {
        im.count = counts[t]!;
        im.frustumCulled = false;
        im.castShadow = true;
        this.group.add(im);
      }
      this.carMeshes.push({ body, rest });
    });
    for (const c of this.cars) this.carMeshes[c.type]!.body.setColorAt(c.index, new THREE.Color(CAR_COLOURS[Math.floor(hash(seed, c.set * 97 + c.lane, Math.round(c.z * 10)) * CAR_COLOURS.length)]!));
    PERSON_SEEDS.forEach((_, k) => {
      const im = new THREE.InstancedMesh(g.people[k]!, VMAT.paint, Math.max(1, pcounts[k]!));
      im.name = `deck-people-${k}`;
      im.count = pcounts[k]!;
      im.frustumCulled = false;
      this.personMeshes.push(im);
      this.group.add(im);
    });
  }

  /** Cars and people that set `set` has aboard (for tests). */
  count(set: 0 | 1): { cars: number; people: number } {
    return { cars: this.cars.filter((c) => c.set === set).length, people: this.people.filter((p) => p.set === set).length };
  }

  /**
   * Place them for this moment. `shore`: at a slip, +1 when the slip is off the model's +z end, -1 off its -z end;
   * `travel`: under way, -1 when she is heading the model's -z way, +1 the other; `flips`: the model turns end for end
   * as she leaves a slip (the Lower Ferry's float: its heading points at the slip while she lies there), so the cars
   * coming aboard take the mirrored places, where they will be once she turns. `ground`: the slip's height beyond the
   * ramp in the model's frame at (x, z) (else they stay at deck height).
   */
  update(deck: VesselState['deck'], berthed: boolean, shore: 1 | -1, travel: 1 | -1, flips: boolean, ground?: (x: number, z: number) => number | undefined): void {
    const L = this.layout;
    const half = L.deckL / 2;
    const lanes = L.lanes.length;
    const dist = L.deckL + AWAY;
    const idq = new THREE.Quaternion();
    const hide = (im: THREE.InstancedMesh, i: number) => im.setMatrixAt(i, this.m.compose(this.v.set(0, -50, 0), idq, this.zero));
    const set = deck?.set ?? 0;
    const since = berthed ? (deck?.since ?? Infinity) : Infinity;
    const left = berthed ? (deck?.left ?? Infinity) : Infinity;
    // The way off at a slip (w: metres along the deck towards the slip; the deck ends at w = half): the deck, the
    // ramp down onto the slip at its tilt, then up the slip on the ground smoothed and never steeper than SLIP_UP.
    const profile = berthed && since !== Infinity ? this.wayOff(half, shore, ground) : undefined;
    const yAt = (w: number) => {
      if (!profile || w <= half) return L.deckY;
      const k = (w - half) / 1;
      const i0 = Math.min(profile.length - 2, Math.floor(k));
      const f = Math.min(1, k - i0);
      return profile[i0]! + (profile[i0 + 1]! - profile[i0]!) * f;
    };
    const turn = (towardsMinusZ: boolean) => new THREE.Quaternion().setFromAxisAngle(this.up, towardsMinusZ ? 0 : Math.PI);
    const side = (x: number) => new THREE.Quaternion().setFromAxisAngle(this.up, x > 0 ? -Math.PI / 2 : Math.PI / 2);
    const xAxis = new THREE.Vector3(1, 0, 0);
    // A car on the slope: turned to face its way, then pitched to the slope under it (its nose is its -z).
    const onSlope = (yaw: THREE.Quaternion, w: number, facingShore: boolean) => {
      const rise = yAt(w + 0.8) - yAt(w - 0.8);
      const pitch = Math.atan2(rise, 1.6) * (facingShore ? 1 : -1);
      return yaw.clone().multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, pitch));
    };
    const offSet = set;
    const unloadEnd = RAMP_S + LANE_GAP_S * (lanes - 1) + offTime(dist);
    const loadSpan = LANE_GAP_S * (lanes - 1) + onTime(dist);
    const loadStart = Math.max(unloadEnd + 2, since + left - 7 - loadSpan);
    const departing = left < 6;
    // Under way: her set in its places facing her way; at a slip the set going ashore faces it, the one coming aboard away.
    const toShore = turn(shore < 0);
    const fromShore = turn(shore > 0);
    const ahead = turn(travel < 0);
    for (const c of this.cars) {
      const mesh = this.carMeshes[c.type]!;
      let x = c.x;
      let z = c.z;
      let q = ahead;
      let show: boolean;
      let y = L.deckY + 0.05;
      if (!berthed) show = c.set === set;
      else if (since === Infinity) show = false;
      else if (c.set === offSet) {
        // Driving off, lane by lane: away from rest, over the ramp and up the slip.
        const t = since - RAMP_S - LANE_GAP_S * c.lane;
        const w = shore * z + drivenOff(t);
        z = shore * w;
        y = yAt(w) + 0.05;
        q = onSlope(toShore, w, true);
        show = w - half < AWAY;
      } else {
        if (flips) {
          x = -x;
          z = -z;
        }
        // Coming aboard after them: down the slip, over the ramp, slowing to a stop in its place.
        const t = departing ? Infinity : since - loadStart - LANE_GAP_S * c.lane;
        const w = shore * z + dist - drivenOn(t, dist);
        z = shore * w;
        y = yAt(w) + 0.05;
        q = onSlope(fromShore, w, false);
        show = t > 0 && w - half < AWAY;
      }
      if (!show) {
        hide(mesh.body, c.index);
        hide(mesh.rest, c.index);
        continue;
      }
      this.m.compose(this.v.set(x, y, z), q, this.one);
      mesh.body.setMatrixAt(c.index, this.m);
      mesh.rest.setMatrixAt(c.index, this.m);
    }
    for (const p of this.people) {
      const mesh = this.personMeshes[p.kind]!;
      let x = p.x;
      let z = p.z;
      let q = side(x);
      let show: boolean;
      let y = L.deckY + p.y;
      if (!berthed) show = p.set === set;
      else if (since === Infinity) show = false;
      else if (p.set === offSet) {
        const t = since - RAMP_S - 1;
        const w = shore * z + Math.max(0, t) * WALK;
        z = shore * w;
        if (t > 0) q = toShore;
        y = (w > half ? yAt(w) : L.deckY + p.y);
        show = w - half < PEOPLE_AWAY;
      } else {
        if (flips) {
          x = -x;
          z = -z;
        }
        // Walking aboard once the last of the others are off (they start up the slip as these come down).
        const w0 = shore * z;
        const t = departing ? Infinity : since - RAMP_S - 12;
        const w = Math.max(w0, half + PEOPLE_AWAY - WALK * Math.max(0, t));
        z = shore * w;
        q = w > w0 + 0.01 ? fromShore : side(x);
        y = w > half ? yAt(w) : L.deckY + p.y;
        show = t > 0;
      }
      if (!show) {
        hide(mesh, p.index);
        continue;
      }
      this.m.compose(this.v.set(x, y, z), q, this.one);
      mesh.setMatrixAt(p.index, this.m);
    }
    for (const mm of this.carMeshes) {
      mm.body.instanceMatrix.needsUpdate = true;
      mm.rest.instanceMatrix.needsUpdate = true;
    }
    for (const im of this.personMeshes) im.instanceMatrix.needsUpdate = true;
  }

  /**
   * The height of the way off (the model's frame) every metre from the deck's end at w = half: down the ramp at its
   * tilt, then the slip's ground (along the middle of the ramp) smoothed over 7 m and followed no steeper than
   * SLIP_UP up or SLIP_DOWN down, and never below the water (0 in the model's frame). Without a ground, level with
   * the ramp's foot.
   */
  private wayOff(half: number, shore: 1 | -1, ground?: (x: number, z: number) => number | undefined): number[] {
    const n = Math.ceil(AWAY + 4);
    const tip = this.layout.deckY - RAMP_LEN * Math.sin(RAMP_DOWN);
    const raw: (number | undefined)[] = [];
    for (let k = 0; k <= n + 3; k++) raw.push(ground?.(0, shore * (half + k)));
    const out: number[] = [];
    for (let k = 0; k <= n; k++) {
      if (k <= RAMP_LEN) {
        out.push(this.layout.deckY + (tip - this.layout.deckY) * (k / RAMP_LEN));
        continue;
      }
      let sum = 0;
      let cnt = 0;
      for (let j = Math.max(0, k - 3); j <= Math.min(raw.length - 1, k + 3); j++) {
        const g = raw[j];
        if (g === undefined) continue;
        sum += g;
        cnt++;
      }
      const prev = out[k - 1]!;
      const target = cnt ? sum / cnt : prev;
      out.push(Math.max(0.15, Math.min(prev + SLIP_UP, Math.max(prev - SLIP_DOWN, target))));
    }
    return out;
  }
}
