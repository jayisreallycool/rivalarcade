import type { CosmeticItem, ItemPattern } from './avatar-types';
import { mulberry32, hashSeed } from './rng';

/**
 * Fabric prints shared by the 2D menu avatar (as a repeating CanvasPattern) and the 3D avatar
 * (as a CanvasTexture), so an item looks the same everywhere — including its product image.
 * Every print is seeded by the item id, so two camo items never share the same blotches.
 */

const SIZE = 128;
const cache = new Map<string, HTMLCanvasElement>();

export function hasPrint(item?: CosmeticItem | null): item is CosmeticItem & { pattern: ItemPattern } {
  return Boolean(item?.pattern && item.pattern !== 'solid');
}

/** A 128×128 tileable swatch of the item's print (cached). */
export function patternCanvas(item: CosmeticItem): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !hasPrint(item)) return null;
  const hit = cache.get(item.id);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) return null;
  paint(g, item);
  cache.set(item.id, c);
  return c;
}

function paint(g: CanvasRenderingContext2D, item: CosmeticItem) {
  const pal = item.palette?.length ? item.palette : [item.color ?? '#1e293b', item.accentColor ?? '#00f0ff'];
  const base = pal[0];
  const accent = item.accentColor ?? pal[1] ?? '#ffffff';
  const rng = mulberry32(hashSeed(item.id));
  const S = SIZE;
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);

  // Draw a shape at x,y and its wrapped copies so the tile repeats seamlessly.
  const wrap = (x: number, y: number, r: number, fn: (x: number, y: number) => void) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) if (x + dx > -r && x + dx < S + r && y + dy > -r && y + dy < S + r) fn(x + dx, y + dy);
  };

  switch (item.pattern) {
    case 'stripes': {
      g.fillStyle = accent;
      for (let x = 0; x < S; x += 32) g.fillRect(x + 12, 0, 6, S);
      g.globalAlpha = 0.35;
      g.fillStyle = '#ffffff';
      for (let x = 0; x < S; x += 32) g.fillRect(x + 20, 0, 2, S);
      g.globalAlpha = 1;
      break;
    }
    case 'checker': {
      const n = 8;
      const cell = S / n;
      g.fillStyle = pal[1] ?? '#111827';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x + y) % 2) g.fillRect(x * cell, y * cell, cell, cell);
      break;
    }
    case 'camo': {
      const cols = pal.slice(1).length ? pal.slice(1) : [accent];
      for (let i = 0; i < 26; i++) {
        g.fillStyle = cols[i % cols.length];
        const x = rng() * S;
        const y = rng() * S;
        const r = 10 + rng() * 16;
        const pts = Array.from({ length: 7 }, (_, k) => {
          const a = (k / 7) * Math.PI * 2;
          const rr = r * (0.6 + rng() * 0.6);
          return [Math.cos(a) * rr, Math.sin(a) * rr * 0.8];
        });
        wrap(x, y, r * 1.3, (cx, cy) => {
          g.beginPath();
          pts.forEach(([px, py], k) => (k ? g.lineTo(cx + px, cy + py) : g.moveTo(cx + px, cy + py)));
          g.closePath();
          g.fill();
        });
      }
      break;
    }
    case 'circuit': {
      g.strokeStyle = accent;
      g.fillStyle = accent;
      g.lineWidth = 2;
      g.lineCap = 'round';
      const grid = 16;
      for (let i = 0; i < 14; i++) {
        let x = Math.floor(rng() * 8) * grid + grid / 2;
        let y = Math.floor(rng() * 8) * grid + grid / 2;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          const dir = Math.floor(rng() * 4);
          const len = grid * (1 + Math.floor(rng() * 2));
          x += dir === 0 ? len : dir === 1 ? -len : 0;
          y += dir === 2 ? len : dir === 3 ? -len : 0;
          x = Math.max(4, Math.min(S - 4, x));
          y = Math.max(4, Math.min(S - 4, y));
          g.lineTo(x, y);
        }
        g.stroke();
        g.beginPath();
        g.arc(x, y, 3, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'flames': {
      const cols = [pal[3] ?? '#dc2626', pal[1] ?? accent, pal[2] ?? '#facc15'];
      cols.forEach((col, layer) => {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(0, S);
        const peaks = 5;
        for (let p = 0; p <= peaks; p++) {
          const x0 = (p / peaks) * S;
          const h = S * (0.75 - layer * 0.18) * (0.7 + 0.3 * Math.sin(p * 2.1 + layer));
          g.quadraticCurveTo(x0 + S / peaks / 2, S - h * 1.15, x0 + S / peaks, S - h * 0.35);
        }
        g.lineTo(S, S);
        g.closePath();
        g.fill();
      });
      break;
    }
    case 'stars': {
      for (let i = 0; i < 40; i++) {
        const x = rng() * S;
        const y = rng() * S;
        const r = rng() < 0.15 ? 2.2 : 0.9 + rng() * 0.8;
        g.fillStyle = rng() < 0.3 ? pal[2] ?? accent : pal[1] ?? '#ffffff';
        wrap(x, y, r * 3, (cx, cy) => {
          g.beginPath();
          g.arc(cx, cy, r, 0, Math.PI * 2);
          g.fill();
          if (r > 2) {
            g.fillRect(cx - r * 3, cy - 0.5, r * 6, 1);
            g.fillRect(cx - 0.5, cy - r * 3, 1, r * 6);
          }
        });
      }
      break;
    }
    case 'gradient': {
      const grd = g.createLinearGradient(0, 0, S, S);
      pal.forEach((col, i) => grd.addColorStop(i / Math.max(1, pal.length - 1), col));
      // Mirror the ramp so it tiles without a seam.
      const grd2 = g.createLinearGradient(0, 0, S, 0);
      pal.concat(pal.slice(0, -1).reverse()).forEach((col, i, arr) => grd2.addColorStop(i / Math.max(1, arr.length - 1), col));
      g.fillStyle = grd2;
      g.fillRect(0, 0, S, S);
      g.globalAlpha = 0.25;
      g.fillStyle = '#ffffff';
      for (let x = -S; x < S * 2; x += 18) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 6, 0);
        g.lineTo(x + 6 + S * 0.4, S);
        g.lineTo(x + S * 0.4, S);
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
      void grd;
      break;
    }
    case 'carbon': {
      // Woven carbon twill: alternating light/dark diagonal cells.
      const n = 16;
      const cell = S / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const on = (x + Math.floor(y / 2)) % 2 === 0;
          const grd = g.createLinearGradient(x * cell, y * cell, (x + 1) * cell, (y + 1) * cell);
          grd.addColorStop(0, on ? '#3f3f46' : '#09090b');
          grd.addColorStop(1, on ? '#18181b' : '#27272a');
          g.fillStyle = grd;
          g.fillRect(x * cell, y * cell, cell, cell);
        }
      break;
    }
    case 'hex': {
      // Nanomesh: thin glowing hex cells.
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.globalAlpha = 0.75;
      const R = S / 8 / Math.sqrt(3);
      const w = R * Math.sqrt(3);
      for (let row = -1; row < S / (R * 1.5) + 1; row++)
        for (let col = -1; col < S / w + 1; col++) {
          const cx = col * w + (row % 2 ? w / 2 : 0);
          const cy = row * R * 1.5;
          g.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
            const px = cx + Math.cos(a) * R;
            const py = cy + Math.sin(a) * R;
            k ? g.lineTo(px, py) : g.moveTo(px, py);
          }
          g.closePath();
          g.stroke();
        }
      g.globalAlpha = 1;
      break;
    }
    case 'colorblock': {
      // 1989 windbreaker: bold diagonal colour blocks.
      g.fillStyle = pal[1] ?? accent;
      g.beginPath();
      g.moveTo(0, S * 0.18);
      g.lineTo(S, S * 0.52);
      g.lineTo(S, S * 0.78);
      g.lineTo(0, S * 0.44);
      g.closePath();
      g.fill();
      g.fillStyle = pal[2] ?? '#f472b6';
      g.beginPath();
      g.moveTo(0, S * 0.44);
      g.lineTo(S, S * 0.78);
      g.lineTo(S, S * 0.9);
      g.lineTo(0, S * 0.56);
      g.closePath();
      g.fill();
      break;
    }
    case 'knit': {
      // Ribbed cable knit: vertical ribs with braided cables.
      const dark = pal[1] ?? '#00000033';
      for (let x = 0; x < S; x += 16) {
        g.fillStyle = dark;
        g.globalAlpha = 0.35;
        g.fillRect(x, 0, 4, S);
        g.globalAlpha = 0.25;
        g.fillStyle = '#ffffff';
        for (let y = 0; y < S; y += 12) {
          g.beginPath();
          g.ellipse(x + 10, y + 6, 3, 5, 0.5, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 1;
      break;
    }
    case 'cracks': {
      // Obsidian crust split by molten cracks (bright core, orange glow).
      const lines: [number, number][][] = [];
      for (let i = 0; i < 7; i++) {
        let x = rng() * S;
        let y = rng() * S;
        const pts: [number, number][] = [[x, y]];
        const dir = rng() * Math.PI * 2;
        for (let k = 0; k < 6; k++) {
          x += Math.cos(dir + (rng() - 0.5) * 1.6) * 14;
          y += Math.sin(dir + (rng() - 0.5) * 1.6) * 14;
          pts.push([x, y]);
        }
        lines.push(pts);
      }
      const stroke = (w: number, col: string) => {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.lineJoin = 'round';
        for (const pts of lines)
          for (const dx of [-S, 0, S])
            for (const dy of [-S, 0, S]) {
              g.beginPath();
              pts.forEach(([px, py], k) => (k ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
              g.stroke();
            }
      };
      stroke(7, accent + '55');
      stroke(3.5, accent);
      stroke(1.2, pal[2] ?? '#fde68a');
      break;
    }
    case 'denim': {
      g.strokeStyle = pal[1] ?? '#1e40af';
      g.lineWidth = 1;
      g.globalAlpha = 0.6;
      for (let i = -S; i < S * 2; i += 3) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + S, S);
        g.stroke();
      }
      g.globalAlpha = 0.12;
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 300; i++) g.fillRect(rng() * S, rng() * S, 1, 1);
      g.globalAlpha = 1;
      break;
    }
  }
}
