import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BoatSnapshot } from '../sim/simulation';
import type { BoatParams } from '../sim/boat/params';
import type { Puff } from '../sim/env/wind';
import { lerpAngle, nedToThree, orientBoat } from './frames';
import { SquibModel } from './squibModel';
import type { SquibTypeId } from '../sim/boat/squib';
import { Water, type SeaSample } from './water';
import { Wake } from './wake';
import { ForceArrows } from './arrows';
import type { DartScene, DartUpdate } from './dart';
import { CourseScene } from './course';
import { FleetView, type FleetPose } from './fleet';
import type { ResolvedCourse } from '../sim/course/course';
import type { Course } from '../sim/course/types';
import type { SkyState } from '../sim/env/sky';
import { daylight } from '../sim/env/sun';
import { CloudDome, Rain } from './weather';

export type CameraMode = 'chase' | 'helm' | 'orbit' | 'top' | 'free';

/** Environment state the scene shows (read-only from the simulation). */
export interface SceneEnvironment {
  puffs: readonly Puff[];
  windAgainstTide: boolean;
  /** The modelled sea state (n, e → waves) at the current sim time: the water surface follows it. */
  sea?: (n: number, e: number) => SeaSample;
  /** River Dart state (when the geodata is loaded). */
  dart?: Omit<DartUpdate, 'camera' | 'time'>;
  course?: { nextLeg: number; phase: string; showLabels: boolean };
  /** The other boats of the fleet: poses at the last two physics states, interpolated like the user's boat. */
  fleet?: { prev: Map<string, FleetPose>; curr: Map<string, FleetPose>; showLabels: boolean };
}
export const CAMERA_MODES: CameraMode[] = ['chase', 'helm', 'orbit', 'top'];

/** Helm view: how much of the boat's heel tilts the view (0 = horizon level, 1 = fixed to the boat). */
const HELM_HEEL_FRACTION = 0.5;
const SUN_ELEVATION = 38 * (Math.PI / 180);
const SUN_AZIMUTH = 200 * (Math.PI / 180);
const FOG = new THREE.Color(0xc4d6e2);
const FOG_OVERCAST = new THREE.Color(0x8f989e);
const NIGHT = new THREE.Color(0x0b1016);

/** Unit vector to the sun in Three.js coordinates (x east, y up, z south) from compass azimuth and elevation. */
export function sunVector(elevationRad: number, azimuthRad: number, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(elevationRad);
  return out.set(Math.sin(azimuthRad) * c, Math.sin(elevationRad), -Math.cos(azimuthRad) * c);
}

/** What the scene shows of the weather and the time of day (visual only). */
export interface SceneWeather {
  sky: SkyState;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
}
const FOG_DENSITY = 0.0016;
/** With the River Dart loaded the hills should stay visible across the harbour. */
const FOG_DENSITY_DART = 0.00024;
const MAX_FLOATS = 400;

/** Owns the Three.js renderer, scene and cameras. Reads simulation snapshots; never writes to the sim. */
export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly water: Water;
  private boat: SquibModel;
  private readonly boatRoot = new THREE.Group();
  private readonly wake: Wake;
  private readonly arrows: ForceArrows;
  private readonly floats: THREE.InstancedMesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly skyMesh: Sky;
  private readonly pmrem: THREE.PMREMGenerator;
  private envMap?: THREE.Texture;
  private readonly sunDir = sunVector(SUN_ELEVATION, SUN_AZIMUTH);
  private readonly clouds = new CloudDome();
  private readonly rain = new Rain();
  private baseFogDensity = FOG_DENSITY;
  private weather?: SceneWeather;
  private envFor = { el: NaN, cloud: NaN };
  private mode: CameraMode = 'chase';
  private chaseHeading = 0;
  private lastWind = { tws: -1, twd: -1, wat: false };
  private crewSide = 1;
  private dart?: DartScene;
  private course?: CourseScene;
  private depthAt?: (n: number, e: number) => number;
  private readonly fleet: FleetView;
  showForces = false;

  constructor(container: HTMLElement, params: BoatParams) {
    // Stencil: boats mark their decks so the sea is not drawn inside the hulls (squibModel.ts, water.ts).
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 25000);
    this.camera.position.set(0, 6, 16);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = false;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 400;

    // Sky and lighting (setWeather moves the sun and changes them with the weather)
    const sunDir = this.sunDir;
    const sky = new Sky();
    sky.scale.setScalar(20000);
    const u = sky.material.uniforms;
    u['turbidity']!.value = 4;
    u['rayleigh']!.value = 1.2;
    u['mieCoefficient']!.value = 0.004;
    u['mieDirectionalG']!.value = 0.8;
    u['sunPosition']!.value.copy(sunDir);
    this.scene.add(sky);
    this.skyMesh = sky;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.rebuildEnvironment();
    this.scene.fog = new THREE.FogExp2(FOG.clone(), FOG_DENSITY);
    this.scene.add(this.clouds.mesh, this.rain.lines);

    this.hemi = new THREE.HemisphereLight(0xcfe3f5, 0x31505a, 0.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    this.sun.position.copy(sunDir).multiplyScalar(60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -10; sc.right = 10; sc.top = 12; sc.bottom = -4; sc.near = 1; sc.far = 150;
    this.scene.add(this.sun, this.sun.target);

    this.water = new Water(sunDir, FOG, FOG_DENSITY);
    this.scene.add(this.water.mesh, this.water.farMesh);

    this.boat = new SquibModel(params);
    this.boatRoot.add(this.boat.group);
    this.scene.add(this.boatRoot);

    this.wake = new Wake();
    this.scene.add(this.wake.mesh);

    this.fleet = new FleetView(params);
    this.scene.add(this.fleet.group);

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

  /** Build the user's boat as another Squib type (data/boats/squib/variants.json). */
  setBoatType(type: SquibTypeId, params: BoatParams): void {
    if (this.boat.type === type) return;
    this.boat.group.remove(this.arrows.bodyGroup);
    this.boatRoot.remove(this.boat.group);
    this.boat = new SquibModel(params, { type });
    this.boatRoot.add(this.boat.group);
    this.boat.group.add(this.arrows.bodyGroup);
  }

  /** Show the River Dart (or remove it with undefined). `depthAt` keeps the motion-cue floats in the water. */
  setDart(dart: DartScene | undefined, depthAt?: (n: number, e: number) => number): void {
    if (this.dart) this.scene.remove(this.dart.fixed, this.dart.floating, this.dart.labels);
    this.dart = dart;
    this.depthAt = dart ? depthAt : undefined;
    if (dart) this.scene.add(dart.fixed, dart.floating, dart.labels);
    this.baseFogDensity = dart ? FOG_DENSITY_DART : FOG_DENSITY;
    this.applyWeather();
  }

  /** Sky, light, fog and rain for the weather and the time of day (visual only; call about once a second). */
  setWeather(w: SceneWeather): void {
    this.weather = w;
    this.applyWeather();
  }

  private rebuildEnvironment(): void {
    const skyScene = new THREE.Scene();
    skyScene.add(this.skyMesh.clone());
    const old = this.envMap;
    this.envMap = this.pmrem.fromScene(skyScene, 0.02).texture;
    this.scene.environment = this.envMap;
    old?.dispose();
  }

  private applyWeather(): void {
    const fog = this.scene.fog as THREE.FogExp2;
    const w = this.weather;
    if (!w) {
      fog.density = this.baseFogDensity;
      this.water.setFog(this.baseFogDensity);
      return;
    }
    const DEG = Math.PI / 180;
    const { cloud, lowCloud, visibilityM, rainMmH } = w.sky;
    const day = daylight(w.sunElevationDeg);
    this.dart?.setDaylight(day);
    sunVector(w.sunElevationDeg * DEG, w.sunAzimuthDeg * DEG, this.sunDir);
    const u = this.skyMesh.material.uniforms;
    u['sunPosition']!.value.copy(this.sunDir);
    // Haze thickens the sky's scattering; cloud is drawn by the dome.
    u['turbidity']!.value = 3 + 7 * Math.min(1, 6000 / Math.max(visibilityM, 500)) + 4 * cloud;
    u['rayleigh']!.value = 1.2 - 0.6 * cloud;
    // Direct sun: dimmed by cloud (low cloud most), warmer near the horizon; diffuse sky light grows under cloud.
    const sunVis = day * (1 - 0.75 * cloud - 0.2 * lowCloud) * Math.min(1, Math.max(0, w.sunElevationDeg / 4));
    this.sun.intensity = 2.4 * Math.max(0, sunVis);
    this.sun.castShadow = this.sun.intensity > 0.3;
    const warm = Math.min(1, Math.max(0, (12 - w.sunElevationDeg) / 12));
    this.sun.color.setRGB(1, 0.95 - 0.25 * warm, 0.88 - 0.45 * warm);
    this.hemi.intensity = (0.04 + 0.66 * day) * (1 + 0.4 * cloud);
    this.hemi.color.setRGB(0.81 - 0.25 * cloud, 0.89 - 0.3 * cloud, 0.96 - 0.32 * cloud);
    this.scene.environmentIntensity = (0.04 + 0.96 * day) * (1 - 0.55 * cloud);
    // Fog: the visibility (σ = 3.912 / V; exp² fog reaches 98% at V when d = 1.978 / V), never thinner than
    // the scene's own haze; grey under cloud, dark at night.
    const density = Math.max(this.baseFogDensity, 1.978 / Math.max(visibilityM, 50));
    fog.density = density;
    fog.color.copy(FOG).lerp(FOG_OVERCAST, Math.min(1, cloud * 0.9 + (visibilityM < 3000 ? 0.3 : 0))).lerp(NIGHT, 1 - (0.03 + 0.97 * day));
    this.water.setSky({ sunDir: this.sunDir, fogColor: fog.color, fogDensity: density, cloud, day, glint: Math.max(0, sunVis) });
    this.clouds.set(cloud, lowCloud, day, this.sunDir, fog.color, Math.min(1, Math.max(0, (6000 - visibilityM) / 5000)));
    this.rain.setRate(rainMmH);
    this.renderer.toneMappingExposure = 0.9 * (0.75 + 0.25 * day);
    // The environment (reflections, image lighting) follows the sky; rebuilding it costs a few ms, so only
    // when the sun has moved or the cloud changed noticeably.
    if (!(Math.abs(w.sunElevationDeg - this.envFor.el) < 3) || !(Math.abs(cloud - this.envFor.cloud) < 0.15)) {
      this.rebuildEnvironment();
      this.envFor = { el: w.sunElevationDeg, cloud };
    }
  }

  /** Show a course (marks, lines), replacing any previous one; undefined removes it. */
  setCourse(r: ResolvedCourse | undefined, course: Course | undefined): void {
    if (this.course) this.scene.remove(this.course.group);
    this.course = r && course ? new CourseScene(r, course) : undefined;
    if (this.course) this.scene.add(this.course.group);
  }

  /** The other boats to draw (id, sail-number label, hull colour); an empty list removes them. */
  setFleet(list: { id: string; label: string; colour: number }[]): void {
    this.fleet.setBoats(list);
  }

  setCameraMode(mode: CameraMode): void {
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      this.controls.target.copy(this.boatRoot.position).add(new THREE.Vector3(0, 2, 0));
      this.camera.position.copy(this.boatRoot.position).add(new THREE.Vector3(10, 7, 12));
    }
  }

  /** Debug and screenshot aid: a fixed viewpoint (three.js coordinates) that does not follow the boat. */
  freeCamera(position: [number, number, number], target: [number, number, number]): void {
    this.mode = 'free';
    this.controls.enabled = true;
    this.camera.position.set(...position);
    this.controls.target.set(...target);
    this.controls.update();
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
  render(prev: BoatSnapshot, curr: BoatSnapshot, alpha: number, time: number, frameDt: number, env?: SceneEnvironment): void {
    const n = prev.n + (curr.n - prev.n) * alpha;
    const e = prev.e + (curr.e - prev.e) * alpha;
    const heading = lerpAngle(prev.heading, curr.heading, alpha);
    const heel = prev.heel + (curr.heel - prev.heel) * alpha;
    const [x, , z] = nedToThree(n, e);

    const wat = env?.windAgainstTide ?? false;
    if (Math.abs(curr.twsGround - this.lastWind.tws) > 0.3 || Math.abs(curr.twdGround - this.lastWind.twd) > 0.05 || wat !== this.lastWind.wat) {
      this.water.setWind(curr.twsGround, curr.twdGround);
      this.lastWind = { tws: curr.twsGround, twd: curr.twdGround, wat };
    }
    if (env?.sea) this.water.updateField(env.sea, this.camera.position.x, this.camera.position.z, time, env.sea(n, e), curr.current);
    if (env) this.updatePuffs(env.puffs, x, z);

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
      awa: curr.awa,
      aws: curr.aws,
      heel,
      water: curr.cockpitWater,
    });
    this.crewSide = curr.crewY >= 0 ? 1 : -1;

    this.wake.update(this.boatRoot, curr.stw, time);
    this.arrows.visible = this.showForces;
    if (this.showForces) this.arrows.update(curr, this.boat.anchors, this.boatRoot.position);
    this.updateFloats(x, z, time);
    this.updateCamera(heading, frameDt, moved);

    this.sun.target.position.copy(this.boatRoot.position);
    this.sun.position.copy(this.boatRoot.position).addScaledVector(this.sunDir, 60);
    this.water.update(time, this.camera);
    // Clouds and rain drift with the wind (Three.js xz direction the air moves to).
    const windTo = curr.twdGround + Math.PI;
    const wx = Math.sin(windTo) * curr.twsGround;
    const wz = -Math.cos(windTo) * curr.twsGround;
    this.clouds.update(this.camera, frameDt, wx, wz);
    this.rain.update(this.camera, frameDt, wx, wz);
    if (this.dart && env?.dart) this.dart.update({ ...env.dart, camera: this.camera, time });
    if (this.course && env?.course) this.course.update(env.course.nextLeg, env.course.phase, env.course.showLabels, time);
    if (env?.fleet && this.fleet.count) this.fleet.update(env.fleet.prev, env.fleet.curr, alpha, time, (fx, fz) => this.water.heightAt(fx, fz, time), env.fleet.showLabels);
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
      // The horizon tilts with part of the heel, as it does on board: a sailor's head stays nearer upright
      // than the boat (the fraction is a visual choice, E).
      const boatUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.boatRoot.quaternion);
      this.camera.up.set(0, 1, 0).lerp(boatUp, HELM_HEEL_FRACTION).normalize();
      this.camera.lookAt(ahead);
      this.camera.up.set(0, 1, 0);
    } else if (this.mode === 'top') {
      this.camera.position.set(b.x, 48, b.z + 0.01);
      this.camera.up.set(0, 0, -1);
      this.camera.lookAt(b.x, 0, b.z);
      this.camera.up.set(0, 1, 0);
    } else if (this.mode === 'free') {
      this.controls.update();
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

  /** The 16 puffs nearest the boat, with their life envelope, as water-shader uniforms. */
  private updatePuffs(puffs: readonly Puff[], bx: number, bz: number): void {
    const list = puffs
      .map((p) => {
        const [x, , z] = nedToThree(p.n, p.e);
        const life = Math.min(1, p.age / (0.2 * p.life)) * Math.min(1, Math.max(0, (p.life - p.age) / (0.3 * p.life)));
        return { x, z, radius: p.radius, strength: p.strength * life, d: (x - bx) ** 2 + (z - bz) ** 2 };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, 16);
    this.water.setPuffs(list);
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
        if (this.depthAt && this.depthAt(-z, x) < 2) continue;
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
