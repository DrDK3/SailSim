import * as THREE from 'three';
import type { BoatParams } from '../sim/boat/params';
import { lerpAngle, nedToThree, orientBoat } from './frames';
import { makeLabel } from './labels';
import { SquibModel } from './squibModel';

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
  mainInverted: boolean;
  jibInverted: boolean;
  rudder: number;
  crewY: number;
}

interface Entry {
  root: THREE.Group;
  model: SquibModel;
  label: THREE.Sprite;
}

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
      const model = new SquibModel(this.params);
      model.setHullColour(b.colour);
      root.add(model.group);
      const label = makeLabel(b.label, '#ffe9a8');
      label.position.set(0, 10.5, 0);
      root.add(label);
      this.group.add(root);
      this.boats.set(b.id, { root, model, label });
    }
  }

  get count(): number {
    return this.boats.size;
  }

  update(prev: Map<string, FleetPose>, curr: Map<string, FleetPose>, alpha: number, time: number, waterHeight: (x: number, z: number) => number, showLabels: boolean): void {
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
      e.root.position.set(x, waterHeight(x, z) * 0.7, z);
      orientBoat(e.model.group, lerpAngle(a.heading, b.heading, alpha), a.heel + (b.heel - a.heel) * alpha);
      e.model.update({
        main: { angle: lerpAngle(a.boomMain, b.boomMain, alpha), luff: b.mainLuff, side: b.mainSide, inverted: b.mainInverted },
        jib: { angle: lerpAngle(a.boomJib, b.boomJib, alpha), luff: b.jibLuff, side: b.jibSide, inverted: b.jibInverted },
        rudder: b.rudder,
        crewY: b.crewY,
        time,
      });
      e.label.visible = showLabels;
    }
  }
}
