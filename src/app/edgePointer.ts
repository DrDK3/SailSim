/**
 * Where to draw the arrow that points at the next mark (or the start line) when it is off the screen (owner, 18 Nov
 * 2026: "Show the next mark as an arrow at the screen edge with its distance"). Screen geometry only.
 */

export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface PointerPlace {
  /** The target is in view (inside the clear part of the screen): no arrow is needed. */
  onScreen: boolean;
  /** Where the arrow goes (CSS px from the top left), or where the target is when it is on screen. */
  x: number;
  y: number;
  /** Which way the arrow points: degrees clockwise from straight up. */
  angleDeg: number;
}

/**
 * `ndc`: the target in the camera's normalised view (x right, y up, each −1…1 across the screen; `behind` when it is
 * behind the camera). `view`: the screen in CSS px. `safe`: the part of the screen clear of the fixed bars (toolbar,
 * controls). `avoid`: panels the arrow must not sit on (instruments, minimap). The arrow sits `margin` px inside the
 * safe box, on the ray from its centre towards the target; `half` is half the size of what is drawn there (the arrow
 * with its label), so that the whole of it stays inside the box and off the panels.
 */
export function edgePointer(
  ndc: { x: number; y: number; behind: boolean },
  view: { w: number; h: number },
  safe: Box,
  avoid: readonly Box[] = [],
  margin = 30,
  half: { x: number; y: number } = { x: 0, y: 0 },
): PointerPlace {
  const cx = (safe.l + safe.r) / 2;
  const cy = (safe.t + safe.b) / 2;
  let sx = ((ndc.x + 1) / 2) * view.w;
  let sy = ((1 - ndc.y) / 2) * view.h;
  if (ndc.behind) {
    // A point behind the camera projects mirrored through the centre: turn it back, and it is never "in view".
    sx = view.w - sx;
    sy = view.h - sy;
  }
  let dx = sx - cx;
  let dy = sy - cy;
  if (Math.hypot(dx, dy) < 1e-6) {
    // Dead astern of the view: point down.
    dx = 0;
    dy = 1;
  }
  const inside = (x: number, y: number, b: Box, px = 0, py = px) => x >= b.l - px && x <= b.r + px && y >= b.t - py && y <= b.b + py;
  const angleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (!ndc.behind && inside(sx, sy, safe) && !avoid.some((b) => inside(sx, sy, b))) return { onScreen: true, x: sx, y: sy, angleDeg };
  // Where the ray from the centre leaves the safe box, inset by the margin.
  const box: Box = { l: safe.l + margin + half.x, t: safe.t + margin + half.y, r: safe.r - margin - half.x, b: safe.b - margin - half.y };
  if (box.r < box.l) box.l = box.r = (safe.l + safe.r) / 2;
  if (box.b < box.t) box.t = box.b = (safe.t + safe.b) / 2;
  const tx = dx > 0 ? (box.r - cx) / dx : dx < 0 ? (box.l - cx) / dx : Infinity;
  const ty = dy > 0 ? (box.b - cy) / dy : dy < 0 ? (box.t - cy) / dy : Infinity;
  const t = Math.min(tx, ty);
  let x = cx + dx * t;
  let y = cy + dy * t;
  const onSide = tx <= ty;
  // Off any panel in the way: slide along the edge to the nearer clear side (kept inside the box).
  for (const b of avoid) {
    if (!inside(x, y, b, margin * 0.6 + half.x, margin * 0.6 + half.y)) continue;
    if (onSide) {
      const up = b.t - margin - half.y;
      const down = b.b + margin + half.y;
      const fits = (v: number) => v >= box.t && v <= box.b;
      y = fits(up) && (!fits(down) || Math.abs(up - y) <= Math.abs(down - y)) ? up : fits(down) ? down : y;
    } else {
      const left = b.l - margin - half.x;
      const right = b.r + margin + half.x;
      const fits = (v: number) => v >= box.l && v <= box.r;
      x = fits(left) && (!fits(right) || Math.abs(left - x) <= Math.abs(right - x)) ? left : fits(right) ? right : x;
    }
  }
  return { onScreen: false, x, y, angleDeg };
}
