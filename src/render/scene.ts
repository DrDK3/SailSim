import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BoatSnapshot } from '../sim/simulation';
import type { BoatParams } from '../sim/boat/params';
import { lerpAngle, nedToThree, orientBoat } from './frames';
import { SquibModel } from './squibModel';
import { Water } from './water';
import { Wake } from './wake';
import { ForceArrows } from './arrows';

export type CameraMode = 'chase' | 'helm' | 'orbit' | 'top';
export const CAMERA_MODES: CameraMode[] = ['chase', 'helm', 'orbit', 'top'];

const SUN_ELEVATION = 38 * (Math.PI / 180);
const SUN_AZIMUTH = 200 * (Math.PI / 180);
const FOG = new THREE.Color(0xc4d6e2);
const FOG_DENSITY = 0.0016;
const MAX_FLOATS = 400;

/** Owns the Three.js renderer, scene and cameras. Reads simulation snapshots; never writes to the sim. */
export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly water: Water;
  private readonly boat: SquibModel;
  private readonly boatRoot = new THREE.Group();
  private readonly wake: Wake;
  private readonly arrows: ForceArrows;
  private readonly floats: THREE.InstancedMesh;
  private readonly sun: THREE.DirectionalLight;
  private mode: CameraMode = 'chase';
  private chaseHeading = 0;
  private lastWind = { tws: -1, twd: -1 };
  private crewSide = 1;
  showForces = false;

  constructor(container: HTMLElement, params: BoatParams) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 6000);
    this.camera.position.set(0, 6, 16);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = false;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 400;

    // Sky and lighting
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - SUN_ELEVATION, SUN_AZIMUTH);
    const sky = new Sky();
    sky.scale.setScalar(5000);
    const u = sky.material.uniforms;
    u['turbidity']!.value = 4;
    u['rayleigh']!.value = 1.2;
    u['mieCoefficient']!.value = 0.004;
    u['mieDirectionalG']!.value = 0.8;
    u['sunPosition']!.value.copy(sunDir);
    this.scene.add(sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const skyScene = new THREE.Scene();
    skyScene.add(sky.clone());
    this.scene.environment = pmrem.fromScene(skyScene, 0.02).texture;
    this.scene.fog = new THREE.FogExp2(FOG, FOG_DENSITY);

    this.scene.add(new THREE.HemisphereLight(0xcfe3f5, 0x31505a, 0.6));
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    this.sun.position.copy(sunDir).multiplyScalar(60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -10; sc.right = 10; sc.top = 12; sc.bottom = -4; sc.near = 1; sc.far = 150;
    this.scene.add(this.sun, this.sun.target);

    this.water = new Water(sunDir, FOG, FOG_DENSITY);
    this.scene.add(this.water.mesh);

    this.boat = new SquibModel(params);
    this.boatRoot.add(this.boat.group);
    this.scene.add(this.boatRoot);

    this.wake = new Wake();
    this.scene.add(this.wake.mesh);

    this.arrows = new ForceArrows();
    this.boat.group.add(this.arrows.bodyGroup);
    this.scene.add(this.arrows.worldGroup);

    // Reference floats (lobster-pot buoys) on a jittered grid around the boat: visual motion cues only.
    const floatGeo = new THREE.SphereGeometry(0.22, 12, 8);
    floatGeo.scale(1, 0.8, 1);
    this.floats = new THREE.InstancedMesh(floatGeo, new THREE.MeshStandardMaterial({ color: 0xf2a516, roughness: 0.5 }), MAX_FLOATS);
    this.floats.frustumCulled = false;
    this.scene.add(this.floats);
  }

  setCameraMode(mode: CameraMode): void {
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      this.controls.target.copy(this.boatRoot.position).add(new THREE.Vector3(0, 2, 0));
      this.camera.position.copy(this.boatRoot.position).add(new THREE.Vector3(10, 7, 12));
    }
  }

  get cameraMode(): CameraMode {
    return this.mode;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Draw one frame, interpolating between the last two physics states (alpha in [0, 1]). */
  render(prev: BoatSnapshot, curr: BoatSnapshot, alpha: number, time: number, frameDt: number): void {
    const n = prev.n + (curr.n - prev.n) * alpha;
    const e = prev.e + (curr.e - prev.e) * alpha;
    const heading = lerpAngle(prev.heading, curr.heading, alpha);
    const heel = prev.heel + (curr.heel - prev.heel) * alpha;
    const [x, , z] = nedToThree(n, e);

    if (Math.abs(curr.twsGround - this.lastWind.tws) > 0.05 || Math.abs(curr.twdGround - this.lastWind.twd) > 0.01) {
      this.water.setWind(curr.twsGround, curr.twdGround);
      this.lastWind = { tws: curr.twsGround, twd: curr.twdGround };
    }

    // Visual-only wave response: the hull rides the surface; pitch from the local slope.
    const h0 = this.water.heightAt(x, z, time);
    const fwd = new THREE.Vector2(Math.sin(heading), -Math.cos(heading));
    const hF = this.water.heightAt(x + fwd.x * 2, z + fwd.y * 2, time);
    const hA = this.water.heightAt(x - fwd.x * 2, z - fwd.y * 2, time);
    const pitch = Math.atan2(hF - hA, 4) * 0.6;
    const prevPos = this.boatRoot.position.clone();
    this.boatRoot.position.set(x, h0 * 0.7, z);
    orientBoat(this.boatRoot, heading, heel, pitch);
    const moved = prevPos.distanceTo(this.boatRoot.position);

    const f = curr.forces;
    this.boat.update({
      main: { angle: lerpAngle(prev.boomMain, curr.boomMain, alpha), luff: f.main.luff, side: curr.mainSide, inverted: Math.abs(f.main.incidence) > Math.PI / 2 },
      jib: { angle: lerpAngle(prev.boomJib, curr.boomJib, alpha), luff: f.jib.luff, side: curr.jibSide, inverted: Math.abs(f.jib.incidence) > Math.PI / 2 },
      rudder: curr.rudder,
      crewY: curr.crewY,
      time,
      hideHelm: this.mode === 'helm',
    });
    this.crewSide = curr.crewY >= 0 ? 1 : -1;

    this.wake.update(this.boatRoot, curr.stw, time);
    this.arrows.visible = this.showForces;
    if (this.showForces) this.arrows.update(curr, this.boat.anchors, this.boatRoot.position);
    this.updateFloats(x, z, time);
    this.updateCamera(heading, frameDt, moved);

    this.sun.target.position.copy(this.boatRoot.position);
    this.sun.position.copy(this.boatRoot.position).add(new THREE.Vector3().setFromSphericalCoords(60, Math.PI / 2 - SUN_ELEVATION, SUN_AZIMUTH));
    this.water.update(time, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(heading: number, dt: number, moved: number): void {
    const b = this.boatRoot.position;
    const k = 1 - Math.exp(-dt * 2.5);
    this.chaseHeading = lerpAngle(this.chaseHeading, heading, k);
    if (this.mode === 'chase') {
      const back = new THREE.Vector3(-Math.sin(this.chaseHeading), 0, Math.cos(this.chaseHeading));
      this.camera.position.copy(b).addScaledVector(back, 15).add(new THREE.Vector3(0, 5.5, 0));
      this.camera.lookAt(b.x, b.y + 2.5, b.z);
    } else if (this.mode === 'helm') {
      // The helmsman's eye, sitting on the windward side deck aft (that figure is hidden in this view).
      const side = this.crewSide;
      const eye = new THREE.Vector3(side * 0.8, 1.5, 2.15).applyQuaternion(this.boatRoot.quaternion).add(b);
      this.camera.position.copy(eye);
      const ahead = new THREE.Vector3(side * 0.2, 0.9, -25).applyQuaternion(this.boatRoot.quaternion).add(b);
      this.camera.lookAt(ahead);
    } else if (this.mode === 'top') {
      this.camera.position.set(b.x, 48, b.z + 0.01);
      this.camera.up.set(0, 0, -1);
      this.camera.lookAt(b.x, 0, b.z);
      this.camera.up.set(0, 1, 0);
    } else {
      // Orbit: keep the user's viewpoint relative to the boat while it sails.
      const delta = new THREE.Vector3().subVectors(b, this.controls.target).add(new THREE.Vector3(0, 2, 0));
      if (moved < 50) {
        this.camera.position.add(delta);
        this.controls.target.add(delta);
      }
      this.controls.update();
    }
  }

  private updateFloats(bx: number, bz: number, time: number): void {
    const cell = 70;
    const r = 9;
    const cx = Math.round(bx / cell);
    const cz = Math.round(bz / cell);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gz = cz - r; gz <= cz + r; gz++) {
        if (i >= MAX_FLOATS) break;
        const hash = Math.sin(gx * 127.1 + gz * 311.7) * 43758.5453;
        const fr = hash - Math.floor(hash);
        if (fr > 0.55) continue;
        const jx = (fr * 7.3 % 1 - 0.5) * cell * 0.8;
        const jz = (fr * 3.1 % 1 - 0.5) * cell * 0.8;
        const x = gx * cell + jx;
        const z = gz * cell + jz;
        m.makeTranslation(x, this.water.heightAt(x, z, time) + 0.05, z);
        this.floats.setMatrixAt(i++, m);
      }
    }
    this.floats.count = i;
    this.floats.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
