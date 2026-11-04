import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stoneTex } from './rdyc';

/**
 * Bayard's Cove Fort, Dartmouth (owner review, 4 Nov 2026, with the owner's photographs of Bayard's Cove).
 *
 * A small Tudor artillery blockhouse at the south end of the Bayard's Cove quay, built to protect the town quay:
 * a round stone tower, open to the sky, with eleven gunports for heavy guns round its ground floor close to the
 * water (English Heritage; Historic England; Wikipedia, via search, 4 Nov 2026). Position 50.34789 N, 3.57749 W
 * (Wikipedia; Sygic). Its diameter, height and wall thickness are not published in the sources found: they are
 * judged from the photographs (E): about 13 m across, walls 1.5 m thick, standing from the foreshore to about
 * 8 m above datum, the quay's level about 3 m.
 */
export const BAYARDS_FORT = {
  /** Centre (local e, n), on the waterline: the river face to the east. */
  centre: [-290, -13] as [number, number],
  radius: 6.5,
  thickness: 1.5,
  /** Foot (on the foreshore) and top of the wall, m ODN (E). */
  footM: -1.2,
  topM: 8.0,
  /** Gunports: their sill and head (m ODN, E) and the arc they cover (the river side). */
  portSillM: 3.7,
  portHeadM: 4.9,
  ports: 11,
};

/** Bearing (rad, from north, clockwise) of each gunport, spread round the river-facing side (E). */
export function fortPortBearings(): number[] {
  const n = BAYARDS_FORT.ports;
  const from = (-40 * Math.PI) / 180;
  const to = (220 * Math.PI) / 180;
  return Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 0.5)) / n);
}

export function buildBayardsCoveFort(): THREE.Group {
  const f = BAYARDS_FORT;
  const g = new THREE.Group();
  g.name = 'bayards-cove-fort';
  // Its own copy of the rubble texture (shared with the quays), tiled for the tower: about 2.4 by 1.2 m a stone course.
  const base = stoneTex();
  const tex = base?.clone();
  if (tex) {
    tex.repeat.set(Math.round((2 * Math.PI * BAYARDS_FORT.radius) / 2.4), Math.round((BAYARDS_FORT.topM - BAYARDS_FORT.footM) / 1.2));
    tex.needsUpdate = true;
  }
  const stone = new THREE.MeshStandardMaterial({ map: tex ?? null, color: tex ? 0xb8ac98 : 0x8a8170, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 1 });
  const turf = new THREE.MeshStandardMaterial({ color: 0x5c6e3a, roughness: 1 });
  const [ce, cn] = f.centre;
  const h = f.topM - f.footM;
  // One mesh per material, so a few draws: the wall's outer face and wall-head; its inner face; the grass on the
  // wall-head and the floor inside (the photographs show it green on top); the dark gunports and doorway.
  const at = (y: number) => new THREE.Matrix4().makeTranslation(ce, y, -cn);
  const outerGeo = new THREE.CylinderGeometry(f.radius, f.radius * 1.04, h, 48, 1, true).toNonIndexed().applyMatrix4(at(f.footM + h / 2));
  const headGeo = new THREE.RingGeometry(f.radius - f.thickness, f.radius, 48).rotateX(-Math.PI / 2).toNonIndexed().applyMatrix4(at(f.topM));
  const outer = new THREE.Mesh(mergeGeometries([outerGeo, headGeo]), stone);
  outer.castShadow = outer.receiveShadow = true;
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(f.radius - f.thickness, f.radius - f.thickness, h, 40, 1, true).applyMatrix4(at(f.footM + h / 2)),
    new THREE.MeshStandardMaterial({ map: tex ?? null, color: tex ? 0x9c917f : 0x7a7264, roughness: 0.95, side: THREE.BackSide }),
  );
  const tuftsGeo = new THREE.RingGeometry(f.radius - f.thickness + 0.2, f.radius - 0.25, 40).rotateX(-Math.PI / 2).toNonIndexed().applyMatrix4(at(f.topM + 0.04));
  const floorGeo = new THREE.CircleGeometry(f.radius - f.thickness, 32).rotateX(-Math.PI / 2).toNonIndexed().applyMatrix4(at(3.2));
  const grass = new THREE.Mesh(mergeGeometries([tuftsGeo, floorGeo]), turf);
  g.add(outer, inner, grass);
  // The gunports: round-headed openings, dark inside, round the river side at the quay's level.
  const portW = 0.95;
  const portH = f.portHeadM - f.portSillM;
  const shape = new THREE.Shape();
  shape.moveTo(-portW / 2, 0);
  shape.lineTo(portW / 2, 0);
  shape.lineTo(portW / 2, portH - portW / 2);
  shape.absarc(0, portH - portW / 2, portW / 2, 0, Math.PI, false);
  shape.lineTo(-portW / 2, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const openings: THREE.BufferGeometry[] = [];
  for (const b of fortPortBearings()) {
    // On the outer face, facing out along the bearing (three.js: e = x, n = -z).
    const ox = Math.sin(b);
    const on = Math.cos(b);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(ce + ox * (f.radius + 0.03), f.portSillM, -(cn + on * (f.radius + 0.03))), new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(ox, -on)), one);
    openings.push(new THREE.ShapeGeometry(shape, 8).toNonIndexed().applyMatrix4(m));
  }
  // The doorway on the landward (west) side, from the quay.
  const doorM = new THREE.Matrix4().compose(new THREE.Vector3(ce - f.radius - 0.03, 3.2 + 1.15, -cn), new THREE.Quaternion().setFromAxisAngle(UP, -Math.PI / 2), one);
  openings.push(new THREE.PlaneGeometry(1.3, 2.3).toNonIndexed().applyMatrix4(doorM));
  const ports = new THREE.Mesh(mergeGeometries(openings), dark);
  ports.name = 'bayards-gunports';
  g.add(ports);
  return g;
}

/** The fort's outline (local e, n) as a footprint, so that boats meet its wall where it stands in the water. */
export function bayardsFortFootprint(): [number, number][] {
  const [ce, cn] = BAYARDS_FORT.centre;
  return Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2;
    return [Math.round((ce + Math.sin(a) * BAYARDS_FORT.radius) * 10) / 10, Math.round((cn + Math.cos(a) * BAYARDS_FORT.radius) * 10) / 10] as [number, number];
  });
}

/** The features with the fort's footprint added (it is not in the building data): solid where it stands in the water. */
export function withBayardsFort<T extends { buildings: readonly unknown[] }>(f: T): T {
  const fort = { r: bayardsFortFootprint(), b: BAYARDS_FORT.footM, t: BAYARDS_FORT.topM, n: "Bayard's Cove Fort", c: 'fort', s: 'f' };
  return { ...f, buildings: [...f.buildings, fort] };
}
