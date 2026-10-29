import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BoatSnapshot } from '../sim/simulation';
import type { BoatParams } from '../sim/boat/params';
import type { Puff } from '../sim/env/wind';
import { SunLight, rendererName, shadowQuality } from './sunlight';
import { cameraFloor, chaseHeight, clampHelmLook, easeRide, followHeave, helmLookDir, lerpAngle, nedToThree, orientBoat, rideWaves, scenicPose, type WaveRide } from './frames';
import { SquibModel, sailFill } from './squibModel';
import type { CrewBuild } from './crew';
import type { SquibTypeId } from '../sim/boat/squib';
import { Water, type SeaSample } from './water';
import { WakeTrail, HullFoam, BowSpray } from './boatWater';
import { SUN_THROUGH } from './materialFx';
import { DEFAULT_CAMERA_MOTION, loadGraphics, pixelRatioFor, saveGraphics, type GraphicsSettings } from './graphics';
import { ForceArrows } from './arrows';
import type { DartScene, DartUpdate } from './dart';
import { CourseScene } from './course';
import { FleetView, type FleetPose } from './fleet';
import type { ResolvedCourse } from '../sim/course/course';
import type { Course } from '../sim/course/types';
import type { SkyState } from '../sim/env/sky';
import { daylight } from '../sim/env/sun';
import { CloudDome, Rain } from './weather';

export type CameraMode = 'chase' | 'scenic' | 'helm' | 'orbit' | 'drone' | 'top' | 'free';

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
export const CAMERA_MODES: CameraMode[] = ['chase', 'scenic', 'helm', 'orbit', 'drone', 'top'];

/**
 * Helm view: how much of the boat's heel tilts the view at the usual camera motion (0 = horizon level, 1 = fixed
 * to the boat); none with the motion off, up to 0.8 with it full.
 */
const HELM_HEEL_FRACTION = 0.5;
/** Field of view (deg): the usual, the helm view's wider one (as the eye sees from a cockpit), its zoom range. */
const FOV = 55;
/** The scenic camera's narrower lens, and how long a change of camera takes to blend (s). */
const SCENIC_FOV = 38;
const BLEND_S = 0.7;
const HELM_FOV = 68;
const HELM_FOV_MIN = 20;
/** Drone: highest it flies (m from its target) and how far it starts behind and above the boat. */
const DRONE_MAX_DISTANCE = 6000;
const DRONE_START = { back: 140, up: 95 };
const SUN_ELEVATION = 38 * (Math.PI / 180);
/** How bright the sky is drawn (and reflected) relative to three.js's sky model (E, matched by eye). */
const SKY_GAIN = 0.45;
const SUN_AZIMUTH = 200 * (Math.PI / 180);
const FOG = new THREE.Color(0xc4d6e2);
const SUN_COLOUR = new THREE.Color();
const FOG_OVERCAST = new THREE.Color(0x8f989e);
const NIGHT = new THREE.Color(0x0b1016);

/** How far a sheet lets its sail out (0 hard in … 1 fully eased), from the angle it allows (rad). */
function sheetEase(limit: number): number {
  const x = Math.min(1, Math.max(0, (limit - 0.15) / (1.3 - 0.15)));
  return x * x * (3 - 2 * x);
}

/**
 * The sky's colour at the horizon (3° up) at 16 compass bearings, as it is displayed (tone-mapped, sRGB): read
 * once from the sky's light map whenever that is rebuilt (the sun has moved or the cloud changed).
 */
function readHorizon(renderer: THREE.WebGLRenderer, env: THREE.Texture): Float32Array | null {
  const hgt = (env.image as { height?: number } | undefined)?.height;
  if (!hgt) return null;
  const maxMip = Math.log2(hgt) - 2;
  const rt = new THREE.WebGLRenderTarget(16, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
  const mat = new THREE.ShaderMaterial({
    defines: { ENVMAP_TYPE_CUBE_UV: 1, CUBEUV_TEXEL_WIDTH: 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16)), CUBEUV_TEXEL_HEIGHT: 1 / hgt, CUBEUV_MAX_MIP: `${maxMip}.0` },
    uniforms: { envMap: { value: env }, uExposure: { value: renderer.toneMappingExposure } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D envMap;
      uniform float uExposure;
      varying vec2 vUv;
      #include <cube_uv_reflection_fragment>
      vec3 aces(vec3 color) {
        // three.js's ACES filmic fit (the renderer's tone mapping), with the renderer's exposure.
        const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        color *= uExposure / 0.6;
        color = ACESInputMat * color;
        vec3 a = color * (color + 0.0245786) - 0.000090537;
        vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
        color = ACESOutputMat * (a / b);
        return clamp(color, 0.0, 1.0);
      }
      void main() {
        float az = (floor(vUv.x * 16.0) + 0.5) / 16.0 * 6.2831853;
        vec3 c = textureCubeUV(envMap, normalize(vec3(sin(az), 0.05, -cos(az))), 0.3).rgb;
        gl_FragColor = sRGBTransferOETF(vec4(aces(c), 1.0));
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.Camera();
  const prev = renderer.getRenderTarget();
  const px = new Uint8Array(16 * 4);
  try {
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, 16, 1, px);
  } finally {
    renderer.setRenderTarget(prev);
    rt.dispose();
    mat.dispose();
    quad.geometry.dispose();
  }
  const out = new Float32Array(16 * 3);
  for (let i = 0; i < 16; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = px[i * 4 + c]! / 255;
  return out;
}

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
  private readonly wake: WakeTrail;
  private readonly hullFoam: HullFoam;
  private readonly spray: BowSpray;
  /** The bow's height last frame (m) and how fast it is moving (m/s, < 0 falling): spray and the slap's sound. */
  private bowY = NaN;
  bowDrop = 0;
  graphics: GraphicsSettings;
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
  /** The sky's colour at the horizon (as displayed, sRGB 0 … 1) at 16 compass bearings, read from its map. */
  private horizon: Float32Array | null = null;
  /** How the haze's colour is made from the horizon's: shares of overcast grey and of night (set with the weather). */
  private fogMix = { overcast: 0, night: 0 };
  private sunIntensity = 2.2;
  private sunCheck = { t: -Infinity, lit: 1, eased: 1, last: 0 };
  private waterLevel = 0;
  private mode: CameraMode = 'chase';
  private chaseHeading = 0;
  /** Chase camera distance behind the boat (m; the wheel zooms), the heave it follows, and a view blend in progress. */
  private chaseDist = 15;
  private camHeave = 0;
  private scenicT = 0;
  private blend?: { p: THREE.Vector3; q: THREE.Quaternion; t: number };
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
    this.graphics = loadGraphics(rendererName(this.renderer));
    this.renderer.setPixelRatio(pixelRatioFor(this.graphics, window.devicePixelRatio));
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
    // The sky's brightness before tone mapping: three.js's sky model is bright enough that the lower sky reads
    // white; scaled down, it keeps its blue (the image lighting is compensated in applyWeather; E).
    u['uSkyGain'] = { value: SKY_GAIN };
    sky.material.onBeforeCompile = (shader) => {
      shader.uniforms.uSkyGain = u['uSkyGain']!;
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uSkyGain;\nvoid main() {')
        .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb *= uSkyGain;\n#include <tonemapping_fragment>');
    };
    this.scene.add(sky);
    this.skyMesh = sky;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.rebuildEnvironment();
    this.scene.fog = new THREE.FogExp2(FOG.clone(), FOG_DENSITY);
    this.scene.add(this.clouds.mesh, this.rain.lines);

    this.hemi = new THREE.HemisphereLight(0xcfe3f5, 0x31505a, 0.6);
    this.scene.add(this.hemi);
    this.sun = new SunLight(this.scene, this.camera, shadowQuality(this.renderer, this.graphics.scenery), this.graphics.shadows === 'fine' ? 4096 : 2048);
    this.shadowsBuilt = this.graphics.shadows;
    this.sun.set(sunDir, 2.2, new THREE.Color(0xfff3e0));

    this.water = new Water(sunDir, FOG, FOG_DENSITY);
    this.scene.add(this.water.mesh, this.water.farMesh);
    this.water.setDetail(this.graphics.water);
    this.water.setEnv(this.envMap ?? null);

    this.boat = new SquibModel(params);
    this.boatRoot.add(this.boat.group);
    this.scene.add(this.boatRoot);

    this.wake = new WakeTrail(this.water.seaUniforms);
    this.hullFoam = new HullFoam(this.water.seaUniforms);
    this.spray = new BowSpray();
    this.scene.add(this.wake.mesh, this.hullFoam.mesh, this.spray.points);

    this.fleet = new FleetView(params);
    this.fleet.sea = this.water.seaUniforms;
    this.scene.add(this.fleet.group);
    this.applyGraphics(this.graphics);

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
    this.water.setBed(dart?.bed);
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
    // The water reflects the same sky (so a golden or grey sky shows in it); set before the old map goes.
    this.water?.setEnv(this.envMap);
    old?.dispose();
    this.horizon = readHorizon(this.renderer, this.envMap);
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
    // A clear day's sky is a deeper blue overhead than the old hazy setting gave (graphics round; E).
    u['turbidity']!.value = 2.2 + 6 * Math.min(1, 6000 / Math.max(visibilityM, 500)) + 4 * cloud;
    u['rayleigh']!.value = 1.7 - 0.9 * cloud;
    // Direct sun: dimmed by cloud (low cloud most), warmer near the horizon; diffuse sky light grows under cloud.
    const sunVis = day * (1 - 0.75 * cloud - 0.2 * lowCloud) * Math.min(1, Math.max(0, w.sunElevationDeg / 4));
    const warm = Math.min(1, Math.max(0, (12 - w.sunElevationDeg) / 12));
    this.sunIntensity = 3.5 * Math.max(0, sunVis);
    this.sun.set(this.sunDir, this.sunIntensity, SUN_COLOUR.setRGB(1, 0.95 - 0.25 * warm, 0.88 - 0.45 * warm));
    // The sky's light comes partly from the environment map (reflections, a little fill) and partly from the
    // hemisphere light, nearly neutral above and olive below (light thrown back by the woods and fields).
    // Matched by eye to the owner's photographs of the harbour (photo round): with the blue sky dome as most
    // of the fill, white render read blue-grey and slate read navy; in the photographs whites are neutral.
    this.hemi.intensity = (0.03 + 0.35 * day) * (1 + 0.6 * cloud);
    this.hemi.color.setRGB(0.97 - 0.3 * cloud, 0.96 - 0.3 * cloud, 0.93 - 0.26 * cloud);
    this.hemi.groundColor.setRGB(0.3, 0.29, 0.2);
    // The sky's share through the environment map: on a clear day about a tenth of the sun's on open ground.
    this.scene.environmentIntensity = ((0.02 + 0.18 * day) * (1 - 0.3 * cloud) + 0.12 * cloud * day) / SKY_GAIN;
    // Fog: the visibility (σ = 3.912 / V; exp² fog reaches 98% at V when d = 1.978 / V), never thinner than
    // the scene's own haze; grey under cloud, dark at night.
    const density = Math.max(this.baseFogDensity, 1.978 / Math.max(visibilityM, 50));
    fog.density = density;
    this.fogMix = { overcast: Math.min(1, cloud * 0.9 + (visibilityM < 3000 ? 0.3 : 0)), night: 1 - (0.03 + 0.97 * day) };
    this.updateFogColour();
    this.water.setSky({ sunDir: this.sunDir, fogColor: fog.color, fogDensity: density, cloud, day, glint: Math.max(0, sunVis), sunColor: SUN_COLOUR });
    const light = this.water.light;
    this.wake.setLight(light);
    this.hullFoam.setLight(light);
    this.spray.setLight(light);
    this.fleet.setLight(light);
    this.clouds.set(cloud, lowCloud, day, this.sunDir, fog.color, Math.min(1, Math.max(0, (6000 - visibilityM) / 5000)), SUN_COLOUR, warm);
    this.rain.setRate(rainMmH);
    this.renderer.toneMappingExposure = 0.9 * (0.75 + 0.25 * day);
    // The environment (reflections, image lighting) follows the sky; rebuilding it costs a few ms, so only
    // when the sun has moved or the cloud changed noticeably.
    if (!(Math.abs(w.sunElevationDeg - this.envFor.el) < 3) || !(Math.abs(cloud - this.envFor.cloud) < 0.15)) {
      this.rebuildEnvironment();
      this.envFor = { el: w.sunElevationDeg, cloud };
    }
  }

  /**
   * The haze's colour: with the atmosphere on, the sky's own colour at the horizon in the direction the camera
   * looks (warm towards a low sun, blue-grey away from it), so distant hills fade into the sky behind them;
   * otherwise a fixed pale blue-grey. Then greyed under cloud and in mist, and darkened at night.
   */
  private updateFogColour(): void {
    const fog = this.scene.fog as THREE.FogExp2;
    const h = this.graphics.atmosphere ? this.horizon : null;
    if (h) {
      const d = new THREE.Vector3();
      this.camera.getWorldDirection(d);
      const az = Math.atan2(d.x, -d.z);
      // Average over the view (±30°), as the haze across the picture.
      let r = 0;
      let g = 0;
      let b = 0;
      let wsum = 0;
      for (let k = -2; k <= 2; k++) {
        const a = az + (k * 15 * Math.PI) / 180;
        const f = (((a / (2 * Math.PI)) % 1) + 1) % 1 * 16;
        const i0 = Math.floor(f) % 16;
        const i1 = (i0 + 1) % 16;
        const t = f - Math.floor(f);
        const w = 1 - Math.abs(k) * 0.2;
        r += w * (h[i0 * 3]! * (1 - t) + h[i1 * 3]! * t);
        g += w * (h[i0 * 3 + 1]! * (1 - t) + h[i1 * 3 + 1]! * t);
        b += w * (h[i0 * 3 + 2]! * (1 - t) + h[i1 * 3 + 2]! * t);
        wsum += w;
      }
      fog.color.setRGB(r / wsum, g / wsum, b / wsum, THREE.SRGBColorSpace);
    } else fog.color.copy(FOG);
    fog.color.lerp(FOG_OVERCAST, this.fogMix.overcast).lerp(NIGHT, this.fogMix.night);
    this.water.setFogColour(fog.color);
    this.clouds.setFogColour(fog.color);
  }

  /**
   * The sun as translucent sails see it (materialFx.ts): its direction in view space, and its light, faded out
   * while the hills stand between the boat and the sun (a ray over the terrain, four times a second).
   */
  private updateSunThrough(time: number): void {
    const b = this.boatRoot.position;
    if (this.dart && time - this.sunCheck.t > 0.25) {
      this.sunCheck.t = time;
      const s = this.sunDir;
      let lit = s.y > 0 ? 1 : 0;
      for (let d = 20; lit && d < 2500; d += d < 200 ? 20 : 60) {
        const x = b.x + s.x * d;
        const z = b.z + s.z * d;
        if (this.dart.groundAt(x, -z) - this.waterLevel > b.y + 3 + s.y * d) lit = 0;
      }
      this.sunCheck.lit = lit;
    } else if (!this.dart) this.sunCheck.lit = this.sunDir.y > 0 ? 1 : 0;
    // Ease over a second, as a shadow edge passes.
    this.sunCheck.eased += (this.sunCheck.lit - this.sunCheck.eased) * Math.min(1, 4 * Math.max(0, time - this.sunCheck.last));
    this.sunCheck.last = time;
    SUN_THROUGH.uSunDirView.value.copy(this.sunDir).transformDirection(this.camera.matrixWorldInverse);
    SUN_THROUGH.uSunLight.value.copy(SUN_COLOUR).multiplyScalar(this.sunIntensity * this.sunCheck.eased);
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
    // Blend from the old view to the new one (not into the orbit and drone views, which the mouse flies).
    this.blend = was !== mode && mode !== 'orbit' && mode !== 'drone' && was !== 'free' ? { p: this.camera.position.clone(), q: this.camera.quaternion.clone(), t: 0 } : undefined;
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
    this.setFov(mode === 'helm' ? this.helmFov : mode === 'scenic' ? SCENIC_FOV : FOV);
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
        if (this.mode === 'chase' || this.mode === 'scenic') {
          // Chase and scenic: the wheel moves the camera in or out (7 … 45 m behind).
          ev.preventDefault();
          this.chaseDist = Math.max(7, Math.min(45, this.chaseDist * Math.exp(ev.deltaY * 0.001)));
          return;
        }
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
    this.blend = undefined;
    this.controls.enabled = true;
    this.camera.position.set(...position);
    this.controls.target.set(...target);
    this.controls.update();
  }

  get cameraMode(): CameraMode {
    return this.mode;
  }

  /** Apply graphics settings (the scenery detail and shadow technique take effect on the next load). */
  applyGraphics(g: GraphicsSettings, persist = false): void {
    this.graphics = g;
    if (persist) saveGraphics(g);
    this.renderer.setPixelRatio(pixelRatioFor(g, window.devicePixelRatio));
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setSize(size.x, size.y, false);
    this.water.setDetail(g.water);
    this.spray.enabled = g.spray;
    this.fleet.foamOn = g.hullFoam;
    this.spray.setViewport(size.y * this.renderer.getPixelRatio(), this.camera.fov);
    this.applyWeather();
  }

  /** The scenery detail and shadow resolution actually drawn (chosen when the view was built). */
  get sceneryBuilt(): 'high' | 'low' {
    return this.sun.quality;
  }
  readonly shadowsBuilt: GraphicsSettings['shadows'];

  resize(w: number, h: number): void {
    this.spray.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
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
      // The sails' set follows the physics' controls: flattening, and how far each sheet lets the sail out.
      flatten: curr.input.flatten ?? 0,
      mainEase: sheetEase(curr.mainSheetLimit),
      jibEase: sheetEase(curr.jibSheetLimit),
    });
    this.crewSide = curr.crewY >= 0 ? 1 : -1;

    this.wake.update(this.boatRoot, curr.stw, curr.rudder, time);
    this.hullFoam.mesh.visible = this.graphics.hullFoam;
    if (this.graphics.hullFoam) this.hullFoam.update(x, z, heading, curr.stw, heel);
    // The bow's vertical speed over the waves (pitch and heave of the visual ride).
    const bowY = this.ride.heave + Math.sin(this.ride.pitch) * 2.4;
    this.bowDrop = Number.isFinite(this.bowY) && frameDt > 0 ? (bowY - this.bowY) / frameDt : 0;
    this.bowY = bowY;
    {
      const to = curr.twdGround + Math.PI;
      this.spray.update(this.boatRoot, curr.stw, this.bowDrop, Math.sin(to) * curr.twsGround, -Math.cos(to) * curr.twsGround, frameDt);
    }
    this.arrows.visible = this.showForces;
    if (this.showForces) this.arrows.update(curr, this.boat.anchors, this.boatRoot.position);
    this.updateFloats(x, z, time);
    this.updateCamera(heading, frameDt, moved, heel);

    if (this.graphics.atmosphere && this.horizon) this.updateFogColour();
    this.updateSunThrough(time);
    this.sun.update(this.boatRoot.position);
    this.water.update(time, this.camera);
    // Clouds and rain drift with the wind (Three.js xz direction the air moves to).
    const windTo = curr.twdGround + Math.PI;
    const wx = Math.sin(windTo) * curr.twsGround;
    const wz = -Math.cos(windTo) * curr.twsGround;
    this.clouds.update(this.camera, frameDt, wx, wz);
    this.rain.update(this.camera, frameDt, wx, wz);
    if (this.dart && env?.dart) {
      this.dart.update({ ...env.dart, camera: this.camera, time });
      this.water.setWaterLevel(env.dart.waterLevel);
      this.waterLevel = env.dart.waterLevel;
    }
    if (this.course && env?.course) {
      this.course.setWind(curr.twdGround);
      this.course.update(env.course.nextLeg, env.course.phase, env.course.showLabels, time);
    }
    if (env?.fleet && this.fleet.count) this.fleet.update(env.fleet.prev, env.fleet.curr, alpha, time, frameDt, (fx, fz) => this.water.heightAt(fx, fz, time), env.fleet.showLabels);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(heading: number, dt: number, moved: number, heel = 0): void {
    const b = this.boatRoot.position;
    const k = 1 - Math.exp(-dt * 2.5);
    this.chaseHeading = lerpAngle(this.chaseHeading, heading, k);
    // The heave the camera follows: a slow average (about 1.5 s) with part of each wave, by the motion setting.
    this.camHeave += (b.y - this.camHeave) * (1 - Math.exp(-dt / 1.5));
    if (moved > 50) this.camHeave = b.y;
    const motion = this.graphics.cameraMotion;
    const y = followHeave(this.camHeave, b.y, motion);
    if (this.mode === 'chase') {
      const back = new THREE.Vector3(-Math.sin(this.chaseHeading), 0, Math.cos(this.chaseHeading));
      this.camera.position.set(b.x, y, b.z).addScaledVector(back, this.chaseDist).add(new THREE.Vector3(0, chaseHeight(this.chaseDist), 0));
      // A little of the heel in the horizon with more camera motion (none at 0: a level horizon).
      const fwd = new THREE.Vector3(Math.sin(this.chaseHeading), 0, -Math.cos(this.chaseHeading));
      this.camera.up.set(0, 1, 0).applyAxisAngle(fwd, -heel * 0.12 * motion);
      this.camera.lookAt(b.x, y + 2.5, b.z);
      this.camera.up.set(0, 1, 0);
    } else if (this.mode === 'scenic') {
      // Low and well off, circling slowly: the boat in her setting. Never below the hills' or the water's floor.
      this.scenicT += dt;
      const sp = scenicPose(this.scenicT);
      const dist = sp.distance * (this.chaseDist / 15);
      let cx = b.x + Math.sin(sp.bearing) * dist;
      let cz = b.z - Math.cos(sp.bearing) * dist;
      let cy = y + sp.height;
      if (this.dart) {
        // Over land: come in closer until over the water, and stay above the ground (heights from the water's
        // surface, which is the scene's zero: the land lies at its height above datum less the tide).
        const ground = (gx: number, gz: number) => this.dart!.groundAt(gx, -gz) - this.waterLevel;
        for (let i = 0; i < 6 && ground(cx, cz) > -0.5; i++) {
          cx = b.x + (cx - b.x) * 0.7;
          cz = b.z + (cz - b.z) * 0.7;
        }
        cy = Math.max(cy, ground(cx, cz) + 2);
      }
      this.camera.position.set(cx, cy, cz);
      this.camera.lookAt(b.x, y + 2.8, b.z);
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
      this.camera.up.set(0, 1, 0).lerp(boatUp, Math.min(0.8, (HELM_HEEL_FRACTION * motion) / DEFAULT_CAMERA_MOTION)).normalize();
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
    // A change of camera blends over a moment rather than jumping.
    if (this.blend && this.mode !== 'free' && this.mode !== 'orbit' && this.mode !== 'drone') {
      this.blend.t += dt;
      const t = Math.min(1, Math.max(0, this.blend.t / BLEND_S));
      const e = t * t * (3 - 2 * t);
      // (The targets are copied first: the camera's own pose is what it blends towards.)
      this.camera.position.lerpVectors(this.blend.p, this.camera.position.clone(), e);
      this.camera.quaternion.slerpQuaternions(this.blend.q, this.camera.quaternion.clone(), e);
      if (t >= 1) this.blend = undefined;
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
