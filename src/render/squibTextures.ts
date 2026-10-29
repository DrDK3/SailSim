import * as THREE from 'three';

/**
 * Canvas-drawn detail for the Squib model: transom lettering, sail cloth (seams, battens, telltales, windows,
 * draft stripes) and the non-slip deck. Drawn once per kind and shared by every boat.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t;
}

export interface TransomLayout {
  /** Height of the transom above the waterline at its top (m) and its depth below (m). */
  top: number;
  bottom: number;
  /** Sheer stripe and boot-top stripe heights above the waterline (m). */
  stripe: [number, number];
  boot: [number, number];
  colours: { topsides: string; stripe: string; boot: string; bottom: string };
}

/**
 * The transom: hull colours in bands (as the hull's vertex colours) and "RDYC" in gilt-edged navy capitals.
 * u runs port → starboard as seen from astern, v bottom → top.
 */
export function transomTexture(l: TransomLayout, text = 'RDYC'): THREE.Texture {
  return cached(`transom:${text}:${JSON.stringify(l)}`, () => {
    const [c, g] = canvas(1024, 512);
    const y = (h: number) => c.height * (1 - (h - l.bottom) / (l.top - l.bottom));
    g.fillStyle = l.colours.topsides;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = l.colours.bottom;
    g.fillRect(0, y(l.boot[0]), c.width, c.height - y(l.boot[0]));
    g.fillStyle = l.colours.boot;
    g.fillRect(0, y(l.boot[1]), c.width, y(l.boot[0]) - y(l.boot[1]));
    g.fillStyle = l.colours.stripe;
    g.fillRect(0, y(l.stripe[1]), c.width, y(l.stripe[0]) - y(l.stripe[1]));
    // Lettering between the boot top and the sheer stripe.
    const top = y(l.stripe[0]) + 16;
    const bottom = y(l.boot[1]) - 16;
    const size = Math.min(bottom - top, 150);
    g.font = `700 ${size}px Georgia, 'Times New Roman', serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const x = c.width / 2;
    const yc = (top + bottom) / 2 + size * 0.04;
    g.letterSpacing = `${Math.round(size * 0.12)}px`;
    g.lineJoin = 'round';
    g.lineWidth = size * 0.07;
    g.strokeStyle = '#c9a646';
    g.strokeText(text, x, yc);
    g.fillStyle = '#16233f';
    g.fillText(text, x, yc);
    return toTexture(c);
  });
}

export interface SailArt {
  kind: 'main' | 'jib';
  /** Cut and finish of the sail package (data/boats/squib/variants.json). */
  package: 'standard' | 'new';
}

/**
 * Sail cloth in sail coordinates: u = luff (0) … leech (1), v = foot (0) … head (1). Cross-cut panel seams,
 * luff tape, head board; battens and leech telltales on the main; luff telltales on the jib. The new package
 * adds what its maker lists (docs/SOURCES.md C11): three telltale windows and a collision window on the jib,
 * a collision window on the main, and draft stripes.
 */
export function sailTexture(a: SailArt): THREE.Texture {
  return cached(`sail:${a.kind}:${a.package}`, () => {
    const [c, g] = canvas(512, 1024);
    const X = (u: number) => u * c.width;
    const Y = (v: number) => (1 - v) * c.height;
    g.fillStyle = '#f6f4ee';
    g.fillRect(0, 0, c.width, c.height);
    // The cloth: a faint mottle of the weave and resin finish (seen up close and against the light).
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '120, 118, 110' : '255, 255, 250'}, ${0.025 + 0.03 * rnd()})`;
      g.fillRect(rnd() * c.width, rnd() * c.height, 2 + rnd() * 10, 1 + rnd() * 3);
    }
    // Panel seams, square to the leech (cross cut: roughly horizontal): the panels overlap a few centimetres,
    // stitched twice along the overlap (the doubled cloth shows darker against the light).
    for (let v = 0.07; v < 1; v += 0.075) {
      g.fillStyle = 'rgba(150, 148, 138, 0.16)';
      g.beginPath();
      g.moveTo(0, Y(v - 0.015) - 3);
      g.lineTo(c.width, Y(v + 0.015) - 3);
      g.lineTo(c.width, Y(v + 0.015) + 3);
      g.lineTo(0, Y(v - 0.015) + 3);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(110, 110, 100, 0.4)';
      g.lineWidth = 1;
      for (const d of [-2.5, 2.5]) {
        g.beginPath();
        g.moveTo(0, Y(v - 0.015) + d);
        g.lineTo(c.width, Y(v + 0.015) + d);
        g.stroke();
      }
    }
    // Luff tape and reinforcement patches.
    g.fillStyle = 'rgba(170, 170, 160, 0.7)';
    g.fillRect(0, 0, X(0.025), c.height);
    g.fillStyle = 'rgba(225, 222, 212, 1)';
    for (const [u, v, r] of [[0, 0, 0.12], [1, 0, 0.12], [0, 1, 0.06]] as const) {
      g.beginPath();
      g.arc(X(u), Y(v), r * c.width, 0, Math.PI * 2);
      g.fill();
    }
    if (a.kind === 'main') {
      // Head board.
      g.fillStyle = '#c4c6c8';
      g.fillRect(0, 0, X(0.6), Y(0.985));
      // Four batten pockets on the leech, the top one longest (an estimate of the layout).
      for (const [v, len] of [[0.2, 0.22], [0.4, 0.24], [0.6, 0.27], [0.8, 0.45]] as const) {
        g.fillStyle = 'rgba(205, 203, 195, 1)';
        g.fillRect(X(1 - len), Y(v) - 9, X(len), 18);
        g.strokeStyle = 'rgba(110, 110, 100, 0.6)';
        g.strokeRect(X(1 - len), Y(v) - 9, X(len), 18);
        // Leech telltale at the batten end.
        g.fillStyle = v === 0.8 ? '#d32f2f' : '#2e7d32';
        g.fillRect(X(0.985), Y(v) - 4, X(0.015), 8);
      }
    } else {
      // Luff telltales: windward (green) and leeward (red) pairs at three heights.
      for (const v of [0.25, 0.5, 0.75]) {
        g.fillStyle = '#2e7d32';
        g.fillRect(X(0.11), Y(v) - 3, X(0.07), 6);
        g.fillStyle = '#d32f2f';
        g.fillRect(X(0.11), Y(v) + 5, X(0.07), 6);
      }
    }
    if (a.package === 'new') {
      // Draft stripes: mark the depth and draft position for trimming.
      g.strokeStyle = '#1d3f72';
      g.lineWidth = 6;
      for (const v of [0.25, 0.5, 0.75]) {
        g.beginPath();
        g.moveTo(X(0.04), Y(v));
        g.lineTo(X(a.kind === 'main' ? 0.75 : 0.92), Y(v + 0.01));
        g.stroke();
      }
      // Windows of clear film: they show the grey-blue of the sky and water behind, with a stitched edge.
      const win = (u0: number, v0: number, u1: number, v1: number) => {
        const grad = g.createLinearGradient(0, Y(v1), 0, Y(v0));
        grad.addColorStop(0, '#b9c8d3');
        grad.addColorStop(1, '#8fa3b1');
        g.fillStyle = grad;
        g.fillRect(X(u0), Y(v1), X(u1 - u0), Y(v0) - Y(v1));
        g.strokeStyle = 'rgba(90, 95, 100, 0.8)';
        g.lineWidth = 3;
        g.strokeRect(X(u0), Y(v1), X(u1 - u0), Y(v0) - Y(v1));
      };
      if (a.kind === 'jib') {
        for (const v of [0.25, 0.5, 0.75]) win(0.07, v - 0.04, 0.22, v + 0.05);
        win(0.3, 0.06, 0.58, 0.2);
      } else win(0.15, 0.05, 0.38, 0.17);
      // The luff telltales show through their windows.
      if (a.kind === 'jib') {
        for (const v of [0.25, 0.5, 0.75]) {
          g.fillStyle = '#2e7d32';
          g.fillRect(X(0.11), Y(v) - 3, X(0.07), 6);
          g.fillStyle = '#d32f2f';
          g.fillRect(X(0.11), Y(v) + 5, X(0.07), 6);
        }
      }
    }
    return toTexture(c);
  });
}

/** Moulded non-slip deck: a fine diamond pattern for the bump map (linear data). */
export function nonSlipTexture(): THREE.Texture {
  return cached('nonslip', () => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#b0b0b0';
    const step = 16;
    for (let y = 0; y < 256; y += step) {
      for (let x = (y / step) % 2 ? step / 2 : 0; x < 256; x += step) {
        g.beginPath();
        g.moveTo(x, y - 5);
        g.lineTo(x + 5, y);
        g.lineTo(x, y + 5);
        g.lineTo(x - 5, y);
        g.closePath();
        g.fill();
      }
    }
    const t = toTexture(c, false);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

/** Wood grain for varnished trim and floorboards (colour map). */
export function woodTexture(): THREE.Texture {
  return cached('wood', () => {
    const [c, g] = canvas(256, 64);
    g.fillStyle = '#8a5a2e';
    g.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 40; i++) {
      const y = (i * 37) % 64;
      g.strokeStyle = `rgba(${90 + (i % 3) * 12}, ${55 + (i % 4) * 6}, 25, 0.35)`;
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2.5);
      g.stroke();
    }
    const t = toTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}
