import type { TrailStyle } from './item-looks';

/**
 * Particle sprites for 3D trails (one look per trail style), drawn once into a small canvas and
 * cached. White-ish sprites are tinted per particle by vertex colour.
 */
const cache = new Map<string, HTMLCanvasElement>();

export function trailSprite(style: TrailStyle): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const hit = cache.get(style);
  if (hit) return hit;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  if (!g) return null;
  const glow = (r: number, a = 1) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, r);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  };
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'miter';
  switch (style) {
    case 'bolt':
      glow(26, 0.35);
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(38, 4);
      g.lineTo(22, 30);
      g.lineTo(36, 32);
      g.lineTo(24, 60);
      g.stroke();
      break;
    case 'flame': {
      glow(30, 0.4);
      const grd = g.createLinearGradient(0, 60, 0, 6);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(1, 'rgba(255,255,255,0.2)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(32, 4);
      g.quadraticCurveTo(52, 34, 44, 50);
      g.quadraticCurveTo(32, 64, 20, 50);
      g.quadraticCurveTo(12, 34, 32, 4);
      g.fill();
      break;
    }
    case 'glitter':
      glow(14, 0.9);
      g.beginPath();
      g.moveTo(32, 2);
      g.quadraticCurveTo(35, 29, 62, 32);
      g.quadraticCurveTo(35, 35, 32, 62);
      g.quadraticCurveTo(29, 35, 2, 32);
      g.quadraticCurveTo(29, 29, 32, 2);
      g.fill();
      break;
    case 'bubble':
      g.globalAlpha = 0.35;
      g.beginPath();
      g.arc(32, 32, 26, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(32, 32, 26, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(22, 22, 6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'glyph':
      glow(26, 0.3);
      g.font = '900 46px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('ｱ', 32, 34);
      break;
    case 'ribbon':
      glow(30, 1);
      break;
    case 'rift':
      glow(28, 0.45);
      g.beginPath();
      g.moveTo(32, 4);
      g.lineTo(44, 30);
      g.lineTo(34, 60);
      g.lineTo(20, 34);
      g.closePath();
      g.fill();
      break;
  }
  cache.set(style, c);
  return c;
}
