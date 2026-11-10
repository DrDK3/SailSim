import * as THREE from 'three';

/**
 * Reflections of the shore, the boats and the sky in calm water (review, 10 Nov 2026): the scene drawn again from a
 * camera mirrored in the water's mean surface (y = 0), into a smaller picture the water's shader samples, shifted
 * by the waves' slope so the reflection wobbles and breaks up as the surface does. The water fades it out as the
 * wind roughens the surface (water.ts), and the pass is skipped altogether when nothing would show.
 *
 * The mirror camera follows the method of three.js's Reflector (examples/jsm/objects/Reflector.js): the view
 * reflected in the plane, and the projection's near plane made oblique so it lies in the water, cutting off what
 * is below it (E. Lengyel, "Oblique View Frustum Depth Projection and Clipping", 2005). It costs a second drawing
 * of the scene at a fraction of the screen's resolution, so the graphics presets choose it: off for Performance,
 * a third of the resolution for Balanced, half for Ultra. Visual only.
 */
export type ReflectionQuality = 'off' | 'low' | 'high';

/** Share of the drawing buffer's width and height the reflection is drawn at. */
export const REFLECTION_SCALE: Record<Exclude<ReflectionQuality, 'off'>, number> = { low: 1 / 3, high: 0.5 };

export class PlanarReflection {
  readonly target: THREE.WebGLRenderTarget;
  /** World position on the water → the reflection picture's projective texture coordinates. */
  readonly matrix = new THREE.Matrix4();
  quality: ReflectionQuality = 'off';
  /** Drawn this frame (false when skipped): the water shows it only then. */
  drawn = false;
  private readonly cam = new THREE.PerspectiveCamera();
  private readonly normal = new THREE.Vector3(0, 1, 0);
  private readonly plane = new THREE.Plane();
  private readonly clip = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly v = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly tgt = new THREE.Vector3();
  private readonly rot = new THREE.Matrix4();
  private readonly size = new THREE.Vector2();
  private readonly clear = new THREE.Color();

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false });
    this.target.texture.name = 'water-reflection';
    this.target.texture.generateMipmaps = false;
    this.target.texture.minFilter = THREE.LinearFilter;
    this.target.texture.magFilter = THREE.LinearFilter;
  }

  /**
   * Draw the mirrored scene. `hide` are drawn only in the main view (the water itself, foam, spray, rain). Returns
   * false when nothing was drawn (off, or the camera at or below the water).
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: readonly THREE.Object3D[], clearColour: THREE.Color): boolean {
    this.drawn = false;
    if (this.quality === 'off') return false;
    const cameraPos = this.v.setFromMatrixPosition(camera.matrixWorld);
    if (cameraPos.y <= 0.05) return false;
    const scale = REFLECTION_SCALE[this.quality];
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(64, Math.round(this.size.x * scale));
    const h = Math.max(64, Math.round(this.size.y * scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    // The camera's position and where it looks, reflected in the plane y = 0.
    const cam = this.cam;
    cam.position.set(cameraPos.x, -cameraPos.y, cameraPos.z);
    this.rot.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(cameraPos);
    this.tgt.set(this.look.x, -this.look.y, this.look.z);
    cam.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal);
    cam.lookAt(this.tgt);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.layers.mask = camera.layers.mask;

    // World → texture: bias and scale [-1, 1] to [0, 1] after the mirror camera's projection.
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.matrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // The oblique near plane in the water: nothing below the surface is reflected.
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.tgt.set(0, 0, 0)).applyMatrix4(cam.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const p = cam.projectionMatrix.elements;
    this.q.set((Math.sign(this.clip.x) + p[8]!) / p[0]!, (Math.sign(this.clip.y) + p[9]!) / p[5]!, -1, (1 + p[10]!) / p[14]!);
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    p[2] = this.clip.x;
    p[6] = this.clip.y;
    p[10] = this.clip.z + 1;
    p[14] = this.clip.w;

    const was = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const target = renderer.getRenderTarget();
    const shadows = renderer.shadowMap.autoUpdate;
    const oldClear = renderer.getClearColor(this.clear.clone());
    const oldAlpha = renderer.getClearAlpha();
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    // Anything the oblique frustum loses far off reads as haze, not black.
    renderer.setClearColor(clearColour, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    renderer.setRenderTarget(target);
    renderer.setClearColor(oldClear, oldAlpha);
    renderer.shadowMap.autoUpdate = shadows;
    hide.forEach((o, i) => (o.visible = was[i]!));
    this.drawn = true;
    return true;
  }

  dispose(): void {
    this.target.dispose();
  }
}
