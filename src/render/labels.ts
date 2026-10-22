import * as THREE from 'three';

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
  return s;
}
