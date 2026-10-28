import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BoatSnapshot } from '../sim/simulation';
import type { BoatParams } from '../sim/boat/params';
import type { Puff } from '../sim/env/wind';
import { SunLight, shadowQuality } from './sunlight';
import { cameraFloor, clampHelmLook, easeRide, helmLookDir, lerpAngle, nedToThree, orientBoat, rideWaves, type WaveRide } from './frames';
import { SquibModel, sailFill } from './squibModel';
import type { CrewBuild } from './crew';
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

export type CameraMode = 'chase' | 'helm' | 'orbit' | 'drone' | 'top' | 'free';

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
export const CAMERA_MODES: CameraMode[] = ['chase', 'helm', 'orbit', 'drone', 'top'];

/** Helm view: how much of the boat's heel tilts the view (0 = horizon level, 1 = fixed to the boat). */
const HELM_HEEL_FRACTION = 0.5;
/** Field of view (deg): the usual, the helm view's wider one (as the eye sees from a cockpit), its zoom range. */
const FOV = 55;
const HELM_FOV = 68;
const HELM_FOV_MIN = 20;
/** Drone: highest it flies (m from its target) and how far it starts behind and above the boat. */
const DRONE_MAX_DISTANCE = 6000;
const DRONE_START = { back: 140, up: 95 };
const SUN_ELEVATION = 38 * (Math.PI / 180);
const SUN_AZIMUTH = 200 * (Math.PI / 180);
const FOG = new THREE.Color(0xc4d6e2);
const SUN_COLOUR = new THREE.Color();
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
  private readonly sun: SunLight;

  /** Drawing detail: 'low' on a software renderer (or ?quality=low), for the scenery's heavier parts too. */
  get quality(): 'high' | 'low' {
    return this.sun.quality;
  }
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
  private readonly ride: WaveRide = { heave: 0, pitch: 0, roll: 0 };
  private readonly rideTarget: WaveRide = { heave: 0, pitch: 0, roll: 0 };
  private rideStarted = false;
  private lastWind = { tws: -1, twd: -1, wat: false };
  private crewSide = 1;
  private dart?: DartScene;
  /** Helm view: where the head is turned (rad, yaw > 0 to starboard, pitch > 0 up) and the zoom. */
  private helmLook = { yaw: 0, pitch: 0 };
  private helmFov = HELM_FOV;
  private dragLook?: { x: number; y: number };
  /** Drone: carry the view along with the boat (otherwise it stays where it was flown). */
  droneFollow = false;
  private lastBoat = new THREE.Vector3();
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
    // Drone panning moves across the map (not the screen), as a map does.
    this.controls.screenSpacePanning = false;
    this.listenForHelmLook(this.renderer.domElement);

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
    this.sun = new SunLight(this.scene, this.camera, shadowQuality(this.renderer));
    this.sun.set(sunDir, 2.2, new THREE.Color(0xfff3e0));

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
  /** The user's Squib type, and who helms her (drawn as a man or a woman; visual only). */
  setBoatType(type: SquibTypeId, params: BoatParams, helm: CrewBuild = 'male'): void {
    if (this.boat.type === type && this.boat.helmBuild === helm) return;
    this.boat.group.remove(this.arrows.bodyGroup);
    this.boatRoot.remove(this.boat.group);
    this.boat = new SquibModel(params, { type, helm });
    this.boatRoot.add(this.boat.group);
    this.boat.group.add(this.arrows.bodyGroup);
  }

  /** Show the River Dart (or remove it with undefined). `depthAt` keeps the motion-cue floats in the water. */
  setDart(dart: DartScene | undefined, depthAt?: (n: number, e: number) => number): void {
    if (this.dart) this.scene.remove(this.dart.fixed, this.dart.floating, this.dart.labels);
    this.dart = dart;
    this.depthAt = dart ? depthAt : undefined;
    if (dart) this.scene.add(dart.fixed, dart.floating, dart.labels);
    this.water.setMask(dart?.waterMask);
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
    // The sky's light without the sun's disc: the sun is the directional light. With the disc in it, the image
    // lighting counted the sun a second time, many times over, and washed every colour out to pastel.
    const disc = this.skyMesh.material.uniforms['showSunDisc'];
    const shown = disc?.value;
    if (disc) disc.value = 0;
    const old = this.envMap;
    this.envMap = this.pmrem.fromScene(skyScene, 0.02).texture;
    if (disc) disc.value = shown;
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
    const warm = Math.min(1, Math.max(0, (12 - w.sunElevationDeg) / 12));
    this.sun.set(this.sunDir, 3.5 * Math.max(0, sunVis), SUN_COLOUR.setRGB(1, 0.95 - 0.25 * warm, 0.88 - 0.45 * warm));
    // The sky's light comes partly from the environment map (reflections, a little fill) and partly from the
    // hemisphere light, nearly neutral above and olive below (light thrown back by the woods and fields).
    // Matched by eye to the owner's photographs of the harbour (photo round): with the blue sky dome as most
    // of the fill, white render read blue-grey and slate read navy; in the photographs whites are neutral.
    this.hemi.intensity = (0.03 + 0.35 * day) * (1 + 0.6 * cloud);
    this.hemi.color.setRGB(0.97 - 0.3 * cloud, 0.96 - 0.3 * cloud, 0.93 - 0.26 * cloud);
    this.hemi.groundColor.setRGB(0.3, 0.29, 0.2);
    // The sky's share through the environment map: on a clear day about a tenth of the sun's on open ground.
    this.scene.environmentIntensity = (0.02 + 0.18 * day) * (1 - 0.3 * cloud) + 0.12 * cloud * day;
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
    const was = this.mode;
    this.mode = mode;
    this.controls.enabled = mode === 'orbit' || mode === 'drone';
    this.controls.enablePan = mode === 'drone';
    this.controls.minDistance = mode === 'drone' ? 10 : 4;
    this.controls.maxDistance = mode === 'drone' ? DRONE_MAX_DISTANCE : 400;
    this.controls.maxPolarAngle = mode === 'drone' ? Math.PI * 0.495 : Math.PI * 0.49;
    if (mode === 'orbit') {
      this.controls.target.copy(this.boatRoot.position).add(new THREE.Vector3(0, 2, 0));
      this.camera.position.copy(this.boatRoot.position).add(new THREE.Vector3(10, 7, 12));
    } else if (mode === 'drone' && was !== 'drone') {
      // Take off behind the boat, looking down at it.
      const back = new THREE.Vector3(-Math.sin(this.chaseHeading), 0, Math.cos(this.chaseHeading));
      this.controls.target.copy(this.boatRoot.position);
      this.camera.position.copy(this.boatRoot.position).addScaledVector(back, DRONE_START.back).add(new THREE.Vector3(0, DRONE_START.up, 0));
    }
    if (mode !== 'helm') {
      this.helmLook = { yaw: 0, pitch: 0 };
      this.helmFov = HELM_FOV;
    }
    this.lastBoat.copy(this.boatRoot.position);
    this.setFov(mode === 'helm' ? this.helmFov : FOV);
  }

  /** Drone: fly back to the boat, keeping the height and angle the view had. */
  centreDrone(): void {
    if (this.mode !== 'drone') return;
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    this.controls.target.copy(this.boatRoot.position);
    this.camera.position.copy(this.boatRoot.position).add(offset);
    this.controls.update();
  }

  /** Helm view: look straight ahead again (also a double-click on the view). */
  resetHelmLook(): void {
    this.helmLook = { yaw: 0, pitch: 0 };
    this.helmFov = HELM_FOV;
    if (this.mode === 'helm') this.setFov(this.helmFov);
  }

  /** Helm view: turn the head by (yaw, pitch) radians, as a drag does. */
  turnHelmLook(dYaw: number, dPitch: number): void {
    this.helmLook = clampHelmLook(this.helmLook.yaw + dYaw, this.helmLook.pitch + dPitch);
  }

  /** Where the helm is looking (rad) and the field of view (deg). */
  get helmView(): { yaw: number; pitch: number; fov: number } {
    return { ...this.helmLook, fov: this.helmFov };
  }

  /** The camera's position and target in Three.js coordinates (for tests and screenshots). */
  cameraPose(): { position: [number, number, number]; target: [number, number, number] } {
    const p = this.camera.position;
    const t = this.controls.target;
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  private setFov(fov: number): void {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Helm view: drag to turn the head, double-click to look ahead, the wheel zooms (binoculars). */
  private listenForHelmLook(el: HTMLElement): void {
    el.addEventListener('pointerdown', (ev) => {
      if (this.mode !== 'helm' || ev.button !== 0) return;
      this.dragLook = { x: ev.clientX, y: ev.clientY };
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        // Synthetic pointers cannot be captured; dragging still works.
      }
    });
    el.addEventListener('pointermove', (ev) => {
      if (!this.dragLook || this.mode !== 'helm') return;
      // A drag across the whole view turns the head by about the field of view.
      const k = ((this.helmFov * Math.PI) / 180) / Math.max(1, el.clientHeight);
      this.turnHelmLook((ev.clientX - this.dragLook.x) * k, -(ev.clientY - this.dragLook.y) * k);
      this.dragLook = { x: ev.clientX, y: ev.clientY };
    });
    const end = () => (this.dragLook = undefined);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => this.mode === 'helm' && this.resetHelmLook());
    el.addEventListener(
      'wheel',
      (ev) => {
        if (this.mode !== 'helm') return;
        ev.preventDefault();
        this.helmFov = Math.max(HELM_FOV_MIN, Math.min(HELM_FOV, this.helmFov * Math.exp(ev.deltaY * 0.001)));
        this.setFov(this.helmFov);
      },
      { passive: false },
    );
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
    this.sun.resize();
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

    // Visual-only wave response: the hull floats on the surface over its waterplane (heave, pitch, roll).
    rideWaves((wx, wz) => this.water.heightAt(wx, wz, time), x, z, heading, this.rideTarget);
    easeRide(this.ride, this.rideTarget, frameDt, !this.rideStarted);
    this.rideStarted = true;
    const prevPos = this.boatRoot.position.clone();
    this.boatRoot.position.set(x, this.ride.heave, z);
    orientBoat(this.boatRoot, heading, heel + this.ride.roll, this.ride.pitch);
    const moved = prevPos.distanceTo(this.boatRoot.position);

    const mainAngle = lerpAngle(prev.boomMain, curr.boomMain, alpha);
    const jibAngle = lerpAngle(prev.boomJib, curr.boomJib, alpha);
    const f = curr.forces;
    this.boat.update({
      main: { angle: mainAngle, luff: f.main.luff, fill: sailFill(f.main.aws > 0 ? f.main.awa : curr.awa, mainAngle) },
      jib: { angle: jibAngle, luff: f.jib.luff, fill: sailFill(f.jib.aws > 0 ? f.jib.awa : curr.awa, jibAngle) },
      rudder: curr.rudder,
      crewY: curr.crewY,
      crewTo: curr.crewTo,
      time,
      hideHelm: this.mode === 'helm',
      awa: curr.awa,
      aws: curr.aws,
      heel,
      water: curr.cockpitWater,
      sailsDown: (curr.damage?.rig ?? 0) >= 1,
    });
    this.crewSide = curr.crewY >= 0 ? 1 : -1;

    this.wake.update(this.boatRoot, curr.stw, time);
    this.arrows.visible = this.showForces;
    if (this.showForces) this.arrows.update(curr, this.boat.anchors, this.boatRoot.position);
    this.updateFloats(x, z, time);
    this.updateCamera(heading, frameDt, moved);

    this.sun.update(this.boatRoot.position);
    this.water.update(time, this.camera);
    // Clouds and rain drift with the wind (Three.js xz direction the air moves to).
    const windTo = curr.twdGround + Math.PI;
    const wx = Math.sin(windTo) * curr.twsGround;
    const wz = -Math.cos(windTo) * curr.twsGround;
    this.clouds.update(this.camera, frameDt, wx, wz);
    this.rain.update(this.camera, frameDt, wx, wz);
    if (this.dart && env?.dart) this.dart.update({ ...env.dart, camera: this.camera, time });
    if (this.course && env?.course) {
      this.course.setWind(curr.twdGround);
      this.course.update(env.course.nextLeg, env.course.phase, env.course.showLabels, time);
    }
    if (env?.fleet && this.fleet.count) this.fleet.update(env.fleet.prev, env.fleet.curr, alpha, time, frameDt, (fx, fz) => this.water.heightAt(fx, fz, time), env.fleet.showLabels);
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
      // Looking where the head is turned (ahead by default), from the boat's frame.
      const [lx, ly, lz] = helmLookDir(this.helmLook.yaw, this.helmLook.pitch);
      const ahead = new THREE.Vector3(side * 0.2 + lx * 25, 0.9 + ly * 25, lz * 25).applyQuaternion(this.boatRoot.quaternion).add(b);
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
    } else if (this.mode === 'drone') {
      // Free flight; following carries the view along with the boat.
      if (this.droneFollow && moved < 50) {
        const delta = new THREE.Vector3().subVectors(b, this.lastBoat);
        this.camera.position.add(delta);
        this.controls.target.add(delta);
      }
      this.controls.update();
      // Never into the hills or the water.
      const t = this.controls.target;
      const floor = cameraFloor(this.dart ? this.dart.groundAt(this.camera.position.x, -this.camera.position.z) : 0);
      if (this.camera.position.y < floor) this.camera.position.y = floor;
      if (this.dart) t.y = Math.max(0, Math.min(t.y, this.dart.groundAt(t.x, -t.z) + 30));
    } else {
      // Orbit: keep the user's viewpoint relative to the boat while it sails.
      const delta = new THREE.Vector3().subVectors(b, this.controls.target).add(new THREE.Vector3(0, 2, 0));
      if (moved < 50) {
        this.camera.position.add(delta);
        this.controls.target.add(delta);
      }
      this.controls.update();
    }
    this.lastBoat.copy(b);
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
