import * as THREE from 'three';

/**
 * A check of how this graphics card draws the simulator's painted surfaces (owner review, 4 Nov 2026).
 *
 * On the owner's graphics card some painted surfaces drew black: the marina boats' hulls (while their masts and
 * canvas covers in the same draw were right), the orange body and flag of the racing marks (while their textured
 * white sponsor band was right) and SAMARITAN. No software renderer reproduces it, so the app measures it where
 * it happens: small test spheres, painted as those surfaces are, are drawn in the real scene (its sun, sky light,
 * reflections and shadow set-up), high above it and out of the shadows, by a camera on their sunlit side; their
 * colours are read back and compared with unlit references.
 *
 * When the painted spheres come out far darker than they should, the scene tries, in turn, drawing without the
 * sky's reflections, then with simpler (Lambert) materials; the first that brings the colours back is kept and
 * remembered for this graphics card. Nothing here changes the physics.
 */

export interface ProbeColour {
  name: string;
  /** Mean colour read back, 0 … 1 (as drawn, before the screen's colour space). */
  rgb: [number, number, number];
}

export interface MaterialCheck {
  at: string;
  renderer: string;
  /** What the scene was drawn with when measured ('as built', 'no reflections', 'simple materials'). */
  mode: string;
  probes: ProbeColour[];
  /** Painted surfaces drew far darker than the references. */
  fault: boolean;
  /** Why, in words. */
  reason: string;
}

const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The test surfaces: painted as the marks, hulls and bands are, plus unlit and Lambert references. */
function probeMeshes(): THREE.Mesh[] {
  const sphere = () => new THREE.SphereGeometry(0.5, 24, 16);
  const vc = (v: number) => {
    const g = sphere();
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(v), 3));
    return g;
  };
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.colorSpace = THREE.SRGBColorSpace;
  white.needsUpdate = true;
  const list: [string, THREE.BufferGeometry, THREE.Material][] = [
    ['orange paint (as the marks)', sphere(), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 })],
    ['orange paint, red 254', sphere(), new THREE.MeshStandardMaterial({ color: 0xfe7a1a, roughness: 0.5 })],
    ['white vertex colour (as the hulls)', vc(1), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.04 })],
    ['white vertex colour 0.97', vc(0.97), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.04 })],
    ['white textured (as the band)', sphere(), new THREE.MeshStandardMaterial({ color: 0xffffff, map: white, roughness: 0.55 })],
    ['orange Lambert', sphere(), new THREE.MeshLambertMaterial({ color: 0xff7a1a })],
    ['orange unlit (reference)', sphere(), new THREE.MeshBasicMaterial({ color: 0xff7a1a })],
    ['white unlit (reference)', sphere(), new THREE.MeshBasicMaterial({ color: 0xffffff })],
  ];
  return list.map(([name, g, m]) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  });
}

/**
 * Draw each probe alone in `scene` (high above it, out of the shadow cascades) seen from the sun's side, and read
 * back its colour. `prepare` is called after the probes are added, so the scene can set up their materials as it
 * does its own (the shadow cascades), before they are drawn.
 */
export function measureMaterials(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sunDir: THREE.Vector3, rendererName: string, mode: string, prepare?: () => void): MaterialCheck {
  const probes = probeMeshes();
  const rig = new THREE.Group();
  rig.name = 'gpu-check';
  rig.position.set(0, 4000, 0);
  for (const p of probes) {
    p.visible = false;
    rig.add(p);
  }
  scene.add(rig);
  prepare?.();
  const rt = new THREE.WebGLRenderTarget(24, 24, { type: THREE.UnsignedByteType });
  const cam = new THREE.PerspectiveCamera(20, 1, 0.1, 50);
  const toSun = sunDir.clone().normalize();
  // Looking at the sunlit side, a little to one side of the sun so that no highlight sits at the centre.
  const side = new THREE.Vector3(0, 1, 0).cross(toSun).normalize();
  if (!Number.isFinite(side.x) || side.lengthSq() < 0.5) side.set(1, 0, 0);
  const at = rig.position.clone();
  cam.position.copy(at).addScaledVector(toSun.clone().addScaledVector(side, 0.35).normalize(), 3.2);
  cam.lookAt(at);
  cam.updateMatrixWorld();
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  // Draw only the probes, in the scene's own lights, reflections and shadow set-up (the shadow maps are reused,
  // not redrawn): the rest of the scene is hidden for the moment, so the check costs a few small draws.
  const hidden: THREE.Object3D[] = [];
  for (const o of scene.children) {
    if (o === rig || (o as THREE.Light).isLight || !o.visible) continue;
    let holdsLight = false;
    o.traverse((c) => {
      if ((c as THREE.Light).isLight) holdsLight = true;
    });
    if (holdsLight) continue;
    o.visible = false;
    hidden.push(o);
  }
  const prevShadowUpdate = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  const px = new Uint8Array(8 * 8 * 4);
  const out: ProbeColour[] = [];
  try {
    renderer.autoClear = true;
    for (const p of probes) {
      p.visible = true;
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 8, 8, 8, 8, px);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < 64; i++) {
        r += px[i * 4]!;
        g += px[i * 4 + 1]!;
        b += px[i * 4 + 2]!;
      }
      out.push({ name: p.name, rgb: [r / 64 / 255, g / 64 / 255, b / 64 / 255] });
      p.visible = false;
    }
  } finally {
    for (const o of hidden) o.visible = true;
    renderer.shadowMap.autoUpdate = prevShadowUpdate;
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    scene.remove(rig);
    for (const p of probes) {
      p.geometry.dispose();
      const m = p.material as THREE.MeshStandardMaterial;
      m.map?.dispose();
      m.dispose();
    }
    rt.dispose();
  }
  const verdict = judge(out);
  return { at: new Date().toISOString(), renderer: rendererName, mode, probes: out, ...verdict };
}

/** Whether the painted probes drew far darker than they should (pure, for tests). */
export function judge(probes: ProbeColour[]): { fault: boolean; reason: string } {
  const get = (prefix: string) => probes.find((p) => p.name.startsWith(prefix))?.rgb;
  const orange = get('orange paint (as');
  const hull = get('white vertex colour (as');
  const band = get('white textured');
  const refOrange = get('orange unlit');
  const refWhite = get('white unlit');
  if (!orange || !hull || !band || !refOrange || !refWhite) return { fault: false, reason: 'incomplete measurement' };
  // Sunlit painted surfaces are at least a third as bright as the unlit references in any daylight the check
  // runs in; the faults seen were near black (under a tenth). The textured band, which drew right on the
  // owner's card, is the in-scene control.
  const problems: string[] = [];
  if (orange[0] < 0.3 * refOrange[0] && orange[0] < 0.3 * band[0]) problems.push(`orange paint drew dark (red ${orange[0].toFixed(2)} against ${refOrange[0].toFixed(2)} unlit)`);
  if (lum(hull) < 0.3 * lum(refWhite) && lum(hull) < 0.3 * lum(band)) problems.push(`white vertex-coloured paint drew dark (${lum(hull).toFixed(2)} against ${lum(band).toFixed(2)} textured)`);
  return problems.length ? { fault: true, reason: problems.join('; ') } : { fault: false, reason: 'painted surfaces drew as expected' };
}

/** A copy of a lit material as the simpler Lambert model (colours, vertex colours, sides, emission, opacity kept). */
export function lambertOf(m: THREE.MeshStandardMaterial): THREE.MeshLambertMaterial {
  const l = new THREE.MeshLambertMaterial({
    color: m.color,
    vertexColors: m.vertexColors,
    side: m.side,
    transparent: m.transparent,
    opacity: m.opacity,
    emissive: m.emissive,
    emissiveIntensity: m.emissiveIntensity,
    map: m.map,
    alphaTest: m.alphaTest,
    depthWrite: m.depthWrite,
    fog: m.fog,
  });
  l.name = `${m.name}|lambert`;
  l.userData = { ...m.userData, lambertOf: m.uuid };
  return l;
}

const KEY = 'squib.gpucheck.v1';

export type MaterialFix = 'none' | 'no-reflections' | 'simple-materials';

/** The fix found for this graphics card on an earlier visit (or chosen in Settings). */
export function loadFix(rendererName: string): MaterialFix | undefined {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { renderer?: string; fix?: MaterialFix } | null;
    if (r && r.renderer === rendererName && (r.fix === 'none' || r.fix === 'no-reflections' || r.fix === 'simple-materials')) return r.fix;
  } catch {
    // storage unavailable
  }
  return undefined;
}

export function saveFix(rendererName: string, fix: MaterialFix): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ renderer: rendererName, fix }));
  } catch {
    // storage unavailable
  }
}
