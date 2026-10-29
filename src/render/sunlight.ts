import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

/**
 * The sun: its direct light and shadows. On a real graphics card, cascaded shadow maps (three cascades out to
 * about 1 km) give the boat a crisp shadow and the town and woods theirs (houses on the streets, trees on the
 * hillsides). Under software rendering (CI, or a machine without a GPU) or when asked (?quality=low), one
 * shadow map follows the boat, as before. Visual only.
 *
 * Cascades replace the lighting code of every lit material (three.js's CSM), so each one must be set up before
 * it is first drawn: `prepare` walks the scene each frame and sets up any new material, keeping its own shader
 * changes (the buildings', terrain's and trees') and giving it its own program cache key.
 */

export type ShadowQuality = 'high' | 'low';

/** The graphics renderer's name (e.g. "ANGLE (Apple, M2)", "SwiftShader"). */
export function rendererName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

/**
 * The URL's choice (?quality=high|low) if any, else the graphics settings' (`preferred`), else high unless the
 * renderer is a software one.
 */
export function shadowQuality(renderer: THREE.WebGLRenderer, preferred?: ShadowQuality): ShadowQuality {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('quality') : null;
  if (q === 'high' || q === 'low') return q;
  if (preferred) return preferred;
  return /swiftshader|llvmpipe|software|basic render/i.test(rendererName(renderer)) ? 'low' : 'high';
}

const MAX_FAR = 1100;

type Hook = THREE.Material['onBeforeCompile'];

export class SunLight {
  readonly quality: ShadowQuality;
  private readonly single?: THREE.DirectionalLight;
  private readonly csm?: CSM;
  private readonly done = new WeakSet<THREE.Material>();
  private readonly bases = new WeakMap<Hook, Hook>();
  /** Shared by every set-up material's shader: updated once a frame. */
  private readonly uniforms = { CSM_cascades: { value: [] as THREE.Vector2[] }, cameraNear: { value: 0.1 }, shadowFar: { value: MAX_FAR } };
  private readonly direction = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    quality: ShadowQuality,
    /** Shadow map size (pixels a side): 2048, or 4096 for the Ultra preset's finer shadows. */
    mapSize = 2048,
  ) {
    this.quality = quality;
    if (quality === 'high') {
      this.csm = new CSM({ camera, parent: scene, cascades: 3, maxFar: MAX_FAR, mode: 'practical', shadowMapSize: mapSize, lightIntensity: 3, lightNear: 1, lightFar: 4000, lightMargin: 400 });
      this.csm.fade = true;
      for (const l of this.csm.lights) {
        l.shadow.bias = -0.0002;
        l.shadow.normalBias = 0.04;
      }
    } else {
      const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
      sun.castShadow = true;
      sun.shadow.mapSize.set(mapSize, mapSize);
      sun.shadow.normalBias = 0.02;
      const sc = sun.shadow.camera;
      sc.left = -10;
      sc.right = 10;
      sc.top = 12;
      sc.bottom = -4;
      sc.near = 1;
      sc.far = 150;
      scene.add(sun, sun.target);
      this.single = sun;
    }
  }

  private get lights(): THREE.DirectionalLight[] {
    return this.csm ? this.csm.lights : [this.single!];
  }

  /** Direction towards the sun (unit), its intensity and colour; shadows only when it is bright enough. */
  set(dir: THREE.Vector3, intensity: number, colour: THREE.Color): void {
    this.direction.copy(dir).normalize();
    if (this.csm) this.csm.lightDirection.copy(this.direction).negate();
    for (const l of this.lights) {
      l.intensity = intensity;
      l.color.copy(colour);
      l.castShadow = intensity > 0.3;
    }
  }

  /** Each frame, before drawing: move the shadows with the view (and the boat). */
  update(focus: THREE.Vector3): void {
    if (this.single) {
      this.single.target.position.copy(focus);
      this.single.position.copy(focus).addScaledVector(this.direction, 60);
      return;
    }
    this.camera.updateMatrixWorld();
    this.csm!.update();
    (this.csm as unknown as { _getExtendedBreaks(t: THREE.Vector2[]): void })._getExtendedBreaks(this.uniforms.CSM_cascades.value);
    this.uniforms.cameraNear.value = this.camera.near;
    this.uniforms.shadowFar.value = Math.min(this.camera.far, MAX_FAR);
    this.prepare(this.scene);
  }

  /** The camera's projection changed (resize): re-split the cascades. */
  resize(): void {
    this.csm?.updateFrustums();
  }

  /** Set up every lit material in the scene for the cascades (once each). */
  private prepare(root: THREE.Object3D): void {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => this.setup(x));
      else this.setup(m);
    });
  }

  private setup(m: THREE.Material): void {
    if (this.done.has(m)) return;
    this.done.add(m);
    if (!(m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshPhongMaterial)) return;
    // A clone of a set-up material carries our hook: start again from the original shader changes.
    const current = m.onBeforeCompile;
    const base = this.bases.get(current) ?? current;
    const key = `${base.toString()}|csm`;
    m.defines = { ...(m.defines ?? {}), USE_CSM: 1, CSM_CASCADES: this.csm!.cascades, CSM_FADE: '' };
    const uniforms = this.uniforms;
    const hook: Hook = function (this: THREE.Material, shader, renderer) {
      shader.uniforms.CSM_cascades = uniforms.CSM_cascades;
      shader.uniforms.cameraNear = uniforms.cameraNear;
      shader.uniforms.shadowFar = uniforms.shadowFar;
      base.call(this, shader, renderer);
    };
    this.bases.set(hook, base);
    m.onBeforeCompile = hook;
    m.customProgramCacheKey = () => key;
    m.needsUpdate = true;
  }
}
