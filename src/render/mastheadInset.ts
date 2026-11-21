import * as THREE from 'three';
import { Burgee, BURGEE_STICK } from './burgee';
import { MastheadVane } from './mastheadVane';
import type { IndicatorType } from '../app/windIndicator';

/**
 * The masthead in a small picture by the compass (review #2, 20 Nov 2026): the top of the player's own mast seen from
 * a little above and astern, bow up the picture, with what flies there (the RDYC burgee or the masthead vane). It is
 * driven by exactly what drives the 3D burgee at the masthead: the snapshot's apparent wind and the draw clock, so the
 * two never disagree.
 *
 * Its own small WebGL canvas (a few dozen triangles a frame) rather than a second pass of the whole scene: the main
 * view's camera, post-processing and panels are left alone. On the lowest graphics preset, or when this canvas cannot
 * get a WebGL context, the interface draws a 2D vector instead (src/ui/MastheadInset.tsx).
 */
export class MastheadInsetView {
  private readonly renderer?: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.05, 20);
  private readonly burgee = new Burgee();
  private readonly vane = new MastheadVane();
  private failed = false;
  private size = 0;
  private lastDraw = -Infinity;

  constructor(readonly canvas: HTMLCanvasElement) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch {
      this.failed = true;
    }
    canvas.addEventListener('webglcontextlost', this.onLost);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x334455, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.6, 2, 1);
    this.scene.add(sun);
    // The mast's head and the wires that leave it: forestay to the bow (up the picture), shrouds to either side, so the
    // picture reads as the top of the mast whichever way the flag flies.
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: 0.4, metalness: 0.6 });
    const wire = new THREE.LineBasicMaterial({ color: 0x9aa6b2 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.2, 10), metal);
    mast.position.y = -0.6;
    this.scene.add(mast);
    const lines = (pts: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.scene.add(new THREE.LineSegments(g, wire));
    };
    lines([0, -0.05, 0, 0, -1.4, -0.9, 0, -0.08, 0, 0.55, -1.4, 0.15, 0, -0.08, 0, -0.55, -1.4, 0.15]);
    // A faint outline of the hull below, bow up the picture (a sign, not to scale), as in the 2D drawing.
    const hull: number[] = [];
    const outline = (t: number): [number, number, number] => {
      // Half-beam along the length (t: 0 at the bow … 1 at the transom), the transom square.
      const x = 0.32 * Math.sin(Math.min(1, t * 1.6) * (Math.PI / 2)) * (t > 0.9 ? 0.92 : 1);
      return [x, -0.55, -1.1 + t * 1.4];
    };
    for (let i = 0; i < 24; i++) {
      const [ax, ay, az] = outline(i / 24);
      const [bx, by, bz] = outline((i + 1) / 24);
      hull.push(ax, ay, az, bx, by, bz, -ax, ay, az, -bx, by, bz);
    }
    const [tx, ty, tz] = outline(1);
    hull.push(tx, ty, tz, -tx, ty, tz);
    const hullGeo = new THREE.BufferGeometry();
    hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(hull, 3));
    this.scene.add(new THREE.LineSegments(hullGeo, new THREE.LineBasicMaterial({ color: 0x8fa3b5, transparent: true, opacity: 0.55 })));
    // The burgee's stick stands on the masthead, as on the boat (src/render/squibModel.ts).
    this.burgee.group.position.set(0, 0, 0);
    this.vane.group.position.set(0, 0, 0);
    this.scene.add(this.burgee.group, this.vane.group);
    this.setType('burgee');
    // From above and astern at about 40°, looking at the flag: a flag hangs upright, so straight down it would be an
    // edge. The bow is up the picture, the hull's outline below says so.
    this.camera.position.set(0, BURGEE_STICK + 0.62, 0.95);
    this.camera.lookAt(0, BURGEE_STICK * 0.62, -0.18);
    this.camera.fov = 52;
    this.camera.updateProjectionMatrix();
  }

  /** The small view can draw (it has a WebGL context and has not lost it). */
  get ok(): boolean {
    return !this.failed && !!this.renderer;
  }

  setType(type: IndicatorType, tabDeg?: number): void {
    this.burgee.group.visible = type === 'burgee';
    this.vane.group.visible = type === 'vane';
    if (tabDeg !== undefined) this.vane.setTabs(tabDeg);
    // The vane is small beside the burgee: lift it on the stick's height so both sit in the same place in the picture.
    this.vane.group.position.y = type === 'vane' ? BURGEE_STICK * 0.55 : 0;
  }

  /**
   * Draw the masthead in the apparent wind (`awa` rad, > 0 from starboard; `aws` m/s) at draw time `time` (s), at most
   * 30 times a second (`now`, ms).
   */
  render(awa: number, aws: number, time: number, now: number): void {
    if (!this.ok || now - this.lastDraw < 33) return;
    this.lastDraw = now;
    const r = this.renderer!;
    const css = this.canvas.clientWidth || 96;
    if (css !== this.size) {
      this.size = css;
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      r.setSize(css, css, false);
    }
    this.burgee.update(awa, aws, time);
    this.vane.update(awa);
    r.render(this.scene, this.camera);
  }

  private onLost = (e: Event): void => {
    e.preventDefault();
    this.failed = true;
  };

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
  }
}
