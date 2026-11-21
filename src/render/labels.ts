import * as THREE from 'three';

/**
 * Every label made, so that the view can keep the masthead clear of them (review #3, 20 Nov 2026: a place name drawn
 * over the burgee hides the wind). Labels taken out of the scene are dropped from the set when next seen.
 */
export const LABEL_SPRITES = new Set<THREE.Sprite>();

/**
 * A label's box on the screen (CSS px: left, top, right, bottom), or undefined behind the camera. Labels are drawn at
 * a fixed screen size (sizeAttenuation off): `scale` is a fraction of the view's height through the projection.
 */
export function labelScreenBox(s: THREE.Sprite, camera: THREE.PerspectiveCamera, w: number, h: number, scratch = new THREE.Vector3()): { l: number; t: number; r: number; b: number } | undefined {
  s.getWorldPosition(scratch).applyMatrix4(camera.matrixWorldInverse);
  if (scratch.z >= 0) return undefined;
  scratch.applyMatrix4(camera.projectionMatrix);
  const cx = ((scratch.x + 1) / 2) * w;
  const cy = ((1 - scratch.y) / 2) * h;
  const k = (camera.projectionMatrix.elements[5] * h) / 2;
  const sw = s.scale.x * k;
  const sh = s.scale.y * k;
  return { l: cx - s.center.x * sw, r: cx + (1 - s.center.x) * sw, t: cy - (1 - s.center.y) * sh, b: cy + s.center.y * sh };
}

/** Screen-size text label (sprite), drawn on top of the scene. */
export function makeLabel(text: string, color: string): THREE.Sprite {
  const pad = 8;
  const font = '600 24px Inter, system-ui, sans-serif';
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.width = w;
  c.height = 40;
  ctx.font = font;
  ctx.fillStyle = 'rgba(8, 18, 26, 0.62)';
  ctx.fillRect(0, 0, w, 40);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, 21);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set((w / 40) * 0.03, 0.03, 1);
  s.renderOrder = 10;
  s.userData.label = true;
  s.userData.text = text;
  LABEL_SPRITES.add(s);
  return s;
}
