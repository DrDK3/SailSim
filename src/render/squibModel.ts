import * as THREE from 'three';
import type { BoatParams } from '../sim/boat/params';

/**
 * Procedural Squib. Principal dimensions come from the class data (LOA, beam, draft, mast, boom, sail
 * areas); the hull lines, keel and rudder shapes are ESTIMATED (no lines plan available) and will be
 * replaced by a modelled glTF when references arrive.
 * Model frame: x = starboard, y = up (0 = waterline), z = aft. Origin at the centre of gravity.
 */

export interface SailShapeInput {
  /** Sail angle (rad, > 0 = to port). */
  angle: number;
  /** 0 = flogging … 1 = drawing. */
  luff: number;
  /** +1 if the wind fills the sail from starboard (sail bellies to port), -1 otherwise. */
  side: number;
  /** Leech-first flow (by the lee): sail inverts. */
  inverted: boolean;
}

const BOW_Z = -2.95;
const MAST_Z = -0.55;
const GOOSENECK_Y = 1.3;
const HOUNDS_Y = 6.3;

export class SquibModel {
  readonly group = new THREE.Group();
  private readonly boom = new THREE.Group();
  private readonly rudder = new THREE.Group();
  private readonly crew: THREE.Group[] = [];
  private readonly mainGeo: THREE.BufferGeometry;
  private readonly jibGeo: THREE.BufferGeometry;
  private readonly jibSheetLine: THREE.Line;
  private readonly p: BoatParams;
  private readonly mastTopY: number;
  private readonly sternZ: number;
  private readonly sheerAt: (t: number) => number;
  readonly anchors: { mainCE: THREE.Vector3; jibCE: THREE.Vector3; keel: THREE.Vector3; rudder: THREE.Vector3; bow: THREE.Vector3; masthead: THREE.Vector3 };

  private static readonly MAIN_U = 10;
  private static readonly MAIN_V = 16;
  private static readonly JIB_U = 8;
  private static readonly JIB_V = 14;

  constructor(p: BoatParams) {
    this.p = p;
    this.sternZ = BOW_Z + p.loa;
    // Sheer line (deck edge height above the waterline): estimated, rising slightly to the transom.
    this.sheerAt = (t: number) => 0.74 - 0.2 * Math.sin((Math.PI / 2) * Math.min(t / 0.8, 1)) + 0.05 * Math.max(0, (t - 0.8) / 0.2);
    // Deck-stepped mast; class mast length (S(p), datum unconfirmed) measured from the deck.
    this.mastTopY = this.sheerAt(0.4) + p.mastLength;
    this.group.name = 'squib';

    this.group.add(this.buildHull());
    this.group.add(this.buildDeck());
    this.group.add(this.buildKeel());
    this.buildRudder();
    this.group.add(this.rudder);
    this.buildRig();

    const sailMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.85, side: THREE.DoubleSide, flatShading: false });
    this.mainGeo = this.gridGeometry(SquibModel.MAIN_U, SquibModel.MAIN_V);
    this.jibGeo = this.gridGeometry(SquibModel.JIB_U, SquibModel.JIB_V);
    const main = new THREE.Mesh(this.mainGeo, sailMat);
    main.castShadow = true;
    main.name = 'mainsail';
    const jib = new THREE.Mesh(this.jibGeo, sailMat);
    jib.castShadow = true;
    jib.name = 'jib';
    this.group.add(main, jib);

    const sheetMat = new THREE.LineBasicMaterial({ color: 0x334455 });
    this.jibSheetLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), sheetMat);
    this.group.add(this.jibSheetLine);

    for (let i = 0; i < 2; i++) {
      const c = this.buildCrewMember(i === 0 ? 0xc0392b : 0x2c3e50);
      this.crew.push(c);
      this.group.add(c);
    }

    this.anchors = {
      mainCE: new THREE.Vector3(),
      jibCE: new THREE.Vector3(),
      keel: new THREE.Vector3(0, -p.clrDepth, -p.lateral.x),
      rudder: new THREE.Vector3(0, -0.3, -p.rudder.x),
      bow: new THREE.Vector3(0, 0.3, BOW_Z),
      masthead: new THREE.Vector3(0, this.mastTopY + 0.4, MAST_Z),
    };
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  // ------------------------------------------------------------------ hull

  /** Half-breadth at the sheer, depth of the canoe body, and sheer height along t = 0 (bow) … 1 (stern). */
  private hullStation(t: number): { b: number; d: number; h: number } {
    const B = this.p.beam / 2;
    const f = t < 0.55 ? Math.pow(Math.sin((Math.PI / 2) * (t / 0.55)), 0.75) : 1 - 0.36 * Math.pow((t - 0.55) / 0.45, 2);
    const b = Math.max(0.004, B * f);
    const d = 0.3 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.8))), 0.8) + 0.02;
    return { b, d: t > 0.97 ? Math.max(0.02, d) : d, h: this.sheerAt(t) };
  }

  private buildHull(): THREE.Mesh {
    const N = 44;
    const M = 14;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const white = new THREE.Color(0xf5f5f2);
    const stripe = new THREE.Color(0x1f4e79);
    const anti = new THREE.Color(0x7a1d1d);
    const colorFor = (y: number, h: number) => (y < 0.04 ? anti : y > h - 0.09 && y < h - 0.03 ? stripe : white);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const z = BOW_Z + t * this.p.loa;
      const { b, d, h } = this.hullStation(t);
      for (let side = -1; side <= 1; side += 2) {
        for (let j = 0; j <= M; j++) {
          const th = (j / M) * (Math.PI / 2);
          const x = side * b * Math.pow(Math.sin(th), 0.65);
          const y = -d * Math.cos(th) + h * Math.pow(1 - Math.cos(th), 0.9);
          pos.push(x, y, z);
          const c = colorFor(y, h);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    const rowLen = (M + 1) * 2;
    for (let i = 0; i < N; i++) {
      for (let s = 0; s < 2; s++) {
        for (let j = 0; j < M; j++) {
          const a = i * rowLen + s * (M + 1) + j;
          const b = a + rowLen;
          if (s === 1) idx.push(a, b, a + 1, b, b + 1, a + 1);
          else idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    }
    // Transom: fan from its centre.
    const last = N * rowLen;
    const centre = pos.length / 3;
    const { h: hT } = this.hullStation(1);
    pos.push(0, hT * 0.5, this.sternZ);
    col.push(white.r, white.g, white.b);
    for (let j = 0; j < M; j++) {
      idx.push(centre, last + (M + 1) + j, last + (M + 1) + j + 1);
      idx.push(centre, last + j + 1, last + j);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.0, side: THREE.DoubleSide }));
    mesh.name = 'hull';
    return mesh;
  }

  private buildDeck(): THREE.Group {
    const g = new THREE.Group();
    const N = 44;
    const pos: number[] = [];
    const idx: number[] = [];
    // Two side strips from the sheer inwards; they meet on the centreline except over the cockpit opening.
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const z = BOW_Z + t * this.p.loa;
      const { b, h } = this.hullStation(t);
      const inner = z > -0.2 && z < 2.3 ? Math.min(0.53, b * 0.8) : 0;
      const y = h + 0.004;
      pos.push(-b, y, z, -inner, y, z, inner, y, z, b, y, z);
      if (i < N) {
        const a = i * 4;
        const n = a + 4;
        idx.push(a, n, a + 1, a + 1, n, n + 1);
        idx.push(a + 2, n + 2, a + 3, a + 3, n + 2, n + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.8, side: THREE.DoubleSide })));

    // Cockpit well with a varnished sole, and a low cuddy forward of the mast: estimated layout.
    const deckY = this.sheerAt(0.7);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.02, 2.5), new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.6 }));
    sole.position.set(0, deckY - 0.33, 1.05);
    const wellMat = new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.8 });
    const wellL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, 2.5), wellMat);
    wellL.position.set(-0.53, deckY - 0.16, 1.05);
    const wellR = wellL.clone();
    wellR.position.x = 0.53;
    const cuddy = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 1.15), new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.7 }));
    cuddy.position.set(0, this.sheerAt(0.3) + 0.08, -1.15);
    g.add(sole, wellL, wellR, cuddy);
    return g;
  }

  private buildKeel(): THREE.Mesh {
    // Fin keel profile in (z, y); estimated planform from draft 0.99 m (class data) and a ~1 m root chord.
    const shape = new THREE.Shape();
    const root = -0.27;
    const tip = -this.p.draft;
    shape.moveTo(-0.55, root);
    shape.lineTo(0.5, root);
    shape.lineTo(0.42, tip + 0.05);
    shape.quadraticCurveTo(0.38, tip, 0.25, tip);
    shape.lineTo(-0.2, tip);
    shape.quadraticCurveTo(-0.32, tip, -0.3, tip + 0.06);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 3, steps: 1 });
    geo.translate(0, 0, -0.03);
    geo.rotateY(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a1a1a, roughness: 0.6 }));
    mesh.name = 'keel';
    return mesh;
  }

  private buildRudder(): void {
    const z = -this.p.rudder.x;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.3);
    shape.lineTo(0.3, 0.28);
    shape.lineTo(0.3, -0.55);
    shape.quadraticCurveTo(0.28, -0.68, 0.12, -0.68);
    shape.lineTo(0, -0.62);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2 });
    geo.translate(0, 0, -0.0125);
    geo.rotateY(Math.PI / 2);
    // After rotation the blade extends along +z (aft) from the pivot.
    const blade = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xe9e6dd, roughness: 0.5 }));
    const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.05, 8), new THREE.MeshStandardMaterial({ color: 0x9b6b3a, roughness: 0.5 }));
    tiller.rotation.x = Math.PI / 2 + 0.12;
    tiller.position.set(0, 0.62, -0.48);
    this.rudder.add(blade, tiller);
    this.rudder.position.set(0, 0, z);
    this.rudder.name = 'rudder';
  }

  private buildRig(): void {
    const spar = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.6, roughness: 0.35 });
    const deckY = this.sheerAt(0.4);
    const mastLen = this.mastTopY - deckY;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, mastLen, 10), spar);
    mast.position.set(0, deckY + mastLen / 2, MAST_Z);
    mast.name = 'mast';
    this.group.add(mast);

    const boomLen = this.p.main.foot;
    const boomMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, boomLen, 8), spar);
    boomMesh.rotation.x = Math.PI / 2;
    boomMesh.position.set(0, 0, boomLen / 2);
    this.boom.add(boomMesh);
    this.boom.position.set(0, GOOSENECK_Y, MAST_Z);
    this.boom.name = 'boom';
    this.group.add(this.boom);

    const wire = new THREE.LineBasicMaterial({ color: 0x5c6670 });
    const hounds = new THREE.Vector3(0, HOUNDS_Y, MAST_Z);
    const lines = [
      [new THREE.Vector3(0, this.sheerAt(0) + 0.02, BOW_Z + 0.08), hounds],
      [new THREE.Vector3(0.84, this.sheerAt(0.42), MAST_Z + 0.15), hounds],
      [new THREE.Vector3(-0.84, this.sheerAt(0.42), MAST_Z + 0.15), hounds],
      [new THREE.Vector3(0.84, this.sheerAt(0.42), MAST_Z + 0.15), new THREE.Vector3(0.38, 3.6, MAST_Z), new THREE.Vector3(0, this.mastTopY - 0.15, MAST_Z)],
      [new THREE.Vector3(-0.84, this.sheerAt(0.42), MAST_Z + 0.15), new THREE.Vector3(-0.38, 3.6, MAST_Z), new THREE.Vector3(0, this.mastTopY - 0.15, MAST_Z)],
    ];
    for (const pts of lines) this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
    const spreader = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.02, 0.03), spar);
    spreader.position.set(0, 3.6, MAST_Z);
    this.group.add(spreader);
  }

  private buildCrewMember(color: number): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    body.position.y = 0.35;
    body.rotation.x = -0.25;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe0b08a, roughness: 0.7 }));
    head.position.set(0, 0.78, -0.08);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x22313f }));
    hat.position.copy(head.position).add(new THREE.Vector3(0, 0.02, 0));
    g.add(body, head, hat);
    return g;
  }

  private gridGeometry(nu: number, nv: number): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((nu + 1) * (nv + 1) * 3), 3));
    const idx: number[] = [];
    for (let v = 0; v < nv; v++) {
      for (let u = 0; u < nu; u++) {
        const a = v * (nu + 1) + u;
        idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
      }
    }
    geo.setIndex(idx);
    return geo;
  }

  // --------------------------------------------------------------- update

  /**
   * Shape a sail between its luff curve and leech curve: chord rotated to the sail angle (plus twist
   * aloft), camber bellied away from the wind, and a travelling flutter when luffing.
   */
  private shapeSail(
    geo: THREE.BufferGeometry,
    nu: number,
    nv: number,
    luffAt: (v: number) => THREE.Vector3,
    chordAt: (v: number) => number,
    s: SailShapeInput,
    twistDeg: number,
    time: number,
    ce: THREE.Vector3,
  ): void {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const flog = 1 - s.luff;
    let k = 0;
    ce.set(0, 0, 0);
    let wsum = 0;
    for (let v = 0; v <= nv; v++) {
      const fv = v / nv;
      const luff = luffAt(fv);
      const chord = chordAt(fv);
      const ang = s.angle + Math.sign(s.angle || 1) * (twistDeg * Math.PI / 180) * fv * s.luff;
      // Chord direction in model xz: aft (+z) at 0, to port (-x) for positive angles.
      const cx = -Math.sin(ang);
      const cz = Math.cos(ang);
      // Leeward normal (horizontal, perpendicular to chord).
      const belly = (s.inverted ? -1 : 1) * s.side;
      const nx = -cz * belly;
      const nz = cx * belly;
      for (let u = 0; u <= nu; u++) {
        const fu = u / nu;
        const depth = chord * (0.11 * s.luff + 0.03) * 4 * fu * (1 - fu) * (1 - 0.3 * fv);
        const wave = flog * chord * 0.06 * Math.sin(fu * 9 - time * 14 + fv * 5) * (0.3 + fu);
        const off = depth + wave;
        const x = luff.x + cx * chord * fu + nx * off;
        const y = luff.y;
        const z = luff.z + cz * chord * fu + nz * off;
        pos.setXYZ(k++, x, y, z);
        if (u === Math.round(nu * 0.4)) {
          const w = chord;
          ce.x += x * w;
          ce.y += y * w;
          ce.z += z * w;
          wsum += w;
        }
      }
    }
    ce.divideScalar(wsum || 1);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  update(params: {
    main: SailShapeInput;
    jib: SailShapeInput;
    rudder: number;
    crewY: number;
    time: number;
    hideHelm?: boolean;
  }): void {
    const { main, jib, time } = params;
    const footMain = this.p.main.foot;
    const headMainY = this.mastTopY - 0.1;
    this.boom.rotation.y = -main.angle;
    this.shapeSail(
      this.mainGeo,
      SquibModel.MAIN_U,
      SquibModel.MAIN_V,
      (v) => new THREE.Vector3(0, GOOSENECK_Y + 0.05 + v * (headMainY - GOOSENECK_Y - 0.05), MAST_Z + 0.04),
      (v) => Math.max(0.12, footMain * (1 - v) + 0.12 * v + 0.35 * Math.sin(Math.PI * v) * (1 - v)),
      main,
      9,
      time,
      this.anchors.mainCE,
    );

    // Jib: luff along the forestay from tack to hounds; clew height ~0.85 m.
    const tack = new THREE.Vector3(0, this.sheerAt(0) + 0.08, BOW_Z + 0.1);
    const head = new THREE.Vector3(0, HOUNDS_Y - 0.1, MAST_Z - 0.05);
    const footJib = this.p.jib.foot;
    this.shapeSail(
      this.jibGeo,
      SquibModel.JIB_U,
      SquibModel.JIB_V,
      (v) => tack.clone().lerp(head, v),
      (v) => Math.max(0.05, footJib * (1 - v) + 0.05 * v),
      jib,
      7,
      time,
      this.anchors.jibCE,
    );
    const pos = this.jibGeo.getAttribute('position') as THREE.BufferAttribute;
    const clew = new THREE.Vector3(pos.getX(SquibModel.JIB_U), pos.getY(SquibModel.JIB_U), pos.getZ(SquibModel.JIB_U));
    const lead = new THREE.Vector3(Math.sign(clew.x || 1) * 0.55, this.sheerAt(0.45) + 0.02, MAST_Z + 0.9);
    (this.jibSheetLine.geometry as THREE.BufferGeometry).setFromPoints([clew, lead]);

    this.rudder.rotation.y = params.rudder;

    // Crew: helm aft, crew forward of them, both at the lateral position from the physics.
    const deckY = this.sheerAt(0.72);
    const out = Math.abs(params.crewY);
    const side = params.crewY >= 0 ? 1 : -1;
    this.crew.forEach((c, i) => {
      const lateral = side * Math.min(0.85, out + (out > 0.5 ? 0.0 : 0.05));
      c.position.set(lateral, deckY - (out > 0.55 ? 0.05 : 0.25), i === 0 ? 1.75 : 0.55);
      c.rotation.z = -side * Math.min(0.5, out * 0.45);
      c.visible = !(i === 0 && params.hideHelm);
    });
  }
}
