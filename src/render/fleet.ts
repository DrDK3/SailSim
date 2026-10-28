import * as THREE from 'three';
import type { BoatParams } from '../sim/boat/params';
import { easeRide, lerpAngle, nedToThree, orientBoat, rideWaves, type WaveRide } from './frames';
import { makeLabel } from './labels';
import { SquibModel, sailFill } from './squibModel';

/** The state of one fleet boat the renderer needs (two of these are interpolated per frame). */
export interface FleetPose {
  id: string;
  n: number;
  e: number;
  heading: number;
  heel: number;
  boomMain: number;
  boomJib: number;
  mainSide: number;
  jibSide: number;
  mainLuff: number;
  jibLuff: number;
  /** Each sail's own apparent wind angle (rad, > 0 from starboard): which way it fills. */
  mainAwa: number;
  jibAwa: number;
  rudder: number;
  crewY: number;
  crewTo: number;
  /** The rig has failed (the sails are down). */
  sailsDown?: boolean;
  awa: number;
  aws: number;
  water: number;
}

interface Entry {
  root: THREE.Group;
  model: SquibModel;
  label: THREE.Sprite;
  ride: WaveRide;
  rideStarted: boolean;
}

const RIDE_SCRATCH: WaveRide = { heave: 0, pitch: 0, roll: 0 };

/**
 * The other boats of the fleet (AI Squibs): one procedural Squib each, tinted with the boat's colour, with a
 * sail-number label. Pure view: reads poses, never touches the simulation.
 */
export class FleetView {
  readonly group = new THREE.Group();
  private readonly boats = new Map<string, Entry>();

  constructor(private readonly params: BoatParams) {
    this.group.name = 'fleet';
  }

  /** (Re)build the boats shown: id, label and hull colour. */
  setBoats(list: { id: string; label: string; colour: number }[]): void {
    for (const [id, e] of this.boats) {
      if (!list.some((b) => b.id === id)) {
        this.group.remove(e.root);
        this.boats.delete(id);
      }
    }
    for (const b of list) {
      if (this.boats.has(b.id)) continue;
      const root = new THREE.Group();
      root.name = `fleet-boat-${b.id}`;
      // Helms and crews of both builds across the fleet (picked from the boat's id; illustrative).
      const h = [...b.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 11);
      const model = new SquibModel(this.params, { helm: h % 3 === 0 ? 'female' : 'male', crew: h % 5 < 2 ? 'female' : 'male' });
      model.setHullColour(b.colour);
      root.add(model.group);
      const label = makeLabel(b.label, '#ffe9a8');
      label.position.set(0, 10.5, 0);
      root.add(label);
      this.group.add(root);
      this.boats.set(b.id, { root, model, label, ride: { heave: 0, pitch: 0, roll: 0 }, rideStarted: false });
    }
  }

  get count(): number {
    return this.boats.size;
  }

  update(
    prev: Map<string, FleetPose>,
    curr: Map<string, FleetPose>,
    alpha: number,
    time: number,
    frameDt: number,
    waterHeight: (x: number, z: number) => number,
    showLabels: boolean,
  ): void {
    for (const [id, e] of this.boats) {
      const b = curr.get(id);
      const a = prev.get(id) ?? b;
      if (!a || !b) {
        e.root.visible = false;
        continue;
      }
      e.root.visible = true;
      const n = a.n + (b.n - a.n) * alpha;
      const ee = a.e + (b.e - a.e) * alpha;
      const [x, , z] = nedToThree(n, ee);
      const heading = lerpAngle(a.heading, b.heading, alpha);
      const heel = a.heel + (b.heel - a.heel) * alpha;
      // Each boat floats on the drawn sea as the user's does (frames.ts).
      easeRide(e.ride, rideWaves(waterHeight, x, z, heading, RIDE_SCRATCH), frameDt, !e.rideStarted);
      e.rideStarted = true;
      e.root.position.set(x, e.ride.heave, z);
      orientBoat(e.model.group, heading, heel + e.ride.roll, e.ride.pitch);
      const mainAngle = lerpAngle(a.boomMain, b.boomMain, alpha);
      const jibAngle = lerpAngle(a.boomJib, b.boomJib, alpha);
      e.model.update({
        main: { angle: mainAngle, luff: b.mainLuff, fill: sailFill(b.mainAwa, mainAngle) },
        jib: { angle: jibAngle, luff: b.jibLuff, fill: sailFill(b.jibAwa, jibAngle) },
        rudder: b.rudder,
        crewY: b.crewY,
        crewTo: b.crewTo,
        time,
        awa: b.awa,
        aws: b.aws,
        heel,
        water: b.water,
        sailsDown: b.sailsDown,
      });
      e.label.visible = showLabels;
    }
  }
}
