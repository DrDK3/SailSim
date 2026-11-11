import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Finishing effects (review, 11 Nov 2026, step 2): ambient occlusion, the soft darkening where surfaces meet (under
 * eaves, between houses, round the crew in the cockpit, a hull at the water), from three.js's GTAO pass (ground-truth
 * ambient occlusion, Jimenez et al. 2016, as three.js implements it). The scene is drawn into a 4× multisampled
 * picture first, so the edge smoothing and the thin-wire coverage (materialFx.ts) are kept, then the occlusion is
 * computed at half resolution and blended in, and the last pass applies the tone mapping and colour space the
 * renderer would otherwise apply itself. It costs a second drawing of the scene (normals and depth) and two
 * full-screen passes: Ultra turns it on, Settings for the others. Visual only.
 */
export class PostPipeline {
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly size = new THREE.Vector2();

  constructor(private readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    renderer.getDrawingBufferSize(this.size);
    // Stencil: the boats mark their decks so the sea is not drawn inside the hulls (squibModel.ts, water.ts).
    const target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 4 });
    target.texture.name = 'post-scene';
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, Math.max(1, this.size.x >> 1), Math.max(1, this.size.y >> 1));
    // Sized for buildings, boats and the crew: occlusion within about 2 m (E, for the eye).
    this.gtao.updateGtaoMaterial({ radius: 2, distanceExponent: 1.5, thickness: 2, scale: 1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.blendIntensity = 0.85;
    // The occlusion's own drawing of the scene (normals and depth) leaves out what lies on or over the water (wake,
    // foam, spray, cloud, the ghost) and anything without normals: the stock material it uses would read a missing
    // normal as fully occluded and darken whatever is behind.
    const pass = this.gtao as unknown as { _overrideVisibility(): void; _visibilityCache: THREE.Object3D[] };
    const hideBase = pass._overrideVisibility.bind(this.gtao);
    pass._overrideVisibility = () => {
      hideBase();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        if (o.userData.noAO || !m.geometry.getAttribute('normal') || mats.some((x) => x.transparent)) {
          m.visible = false;
          pass._visibilityCache.push(m);
        }
      });
    };
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  /** The drawing buffer changed (window size or pixel ratio). */
  resize(): void {
    this.renderer.getDrawingBufferSize(this.size);
    this.composer.setPixelRatio(1);
    this.composer.setSize(this.size.x, this.size.y);
    // The occlusion at half resolution: soft by nature, and a quarter of the cost.
    this.gtao.setSize(Math.max(1, this.size.x >> 1), Math.max(1, this.size.y >> 1));
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.gtao.dispose();
    this.composer.dispose();
  }
}
