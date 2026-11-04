import { AvatarConfig, CosmeticItem } from './avatar-types';
import { SKIN_TONES, HAIR_COLORS, COSMETICS_CATALOG, findItem, itemFinish, itemShape } from './cosmetics-catalog';
import { patternCanvas } from './item-patterns';
import { topLook, bottomLook, shoeLook, trailStyle } from './item-looks';

/** Fill for a garment: its print as a scaled repeating pattern, a moving foil for holo, else flat colour. */
const patternCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern | null>>();
function fabric(ctx: CanvasRenderingContext2D, item: CosmeticItem | undefined, fallback: string, frame: number, scale = 0.22): string | CanvasPattern | CanvasGradient {
  if (!item) return fallback;
  if (itemFinish(item) === 'holo' && item.palette?.length) {
    const shift = Math.sin(frame * 0.05) * 14;
    const g = ctx.createLinearGradient(-16 + shift, -16, 16 + shift, 16);
    item.palette.forEach((c, i) => g.addColorStop(i / Math.max(1, item.palette!.length - 1), c));
    return g;
  }
  if (itemFinish(item) === 'chrome' && !patternCanvas(item)) {
    const g = ctx.createLinearGradient(-14, -16, 14, 16);
    const c = item.color || fallback;
    g.addColorStop(0, c);
    g.addColorStop(0.45, '#ffffff');
    g.addColorStop(0.55, c);
    g.addColorStop(1, shade(c, -0.35));
    return g;
  }
  const swatch = patternCanvas(item);
  if (!swatch) return item.color || fallback;
  let byId = patternCache.get(ctx);
  if (!byId) patternCache.set(ctx, (byId = new Map()));
  const key = `${item.id}@${scale}`;
  if (!byId.has(key)) {
    const pat = ctx.createPattern(swatch, 'repeat');
    if (pat && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scale(scale));
    byId.set(key, pat);
  }
  return byId.get(key) ?? item.color ?? fallback;
}

/** Lighten (+) or darken (−) a #rrggbb colour. */
function shade(hex: string, amt: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(Math.max(0, Math.min(255, amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch(n >> 16);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export interface DrawAvatarOptions {
  frame?: number;           // Animation frame (0..60)
  action?: 'idle' | 'run' | 'jump' | 'slide' | 'shoot' | 'celebrate' | 'hit' | 'peace';
  facingRight?: boolean;
  scale?: number;
  highlightColor?: string;
  showTrail?: boolean;
  opacity?: number;
}

/** The equipped trail, drawn behind the avatar in its own style (bolts, flames, bubbles…). */
function drawTrail(ctx: CanvasRenderingContext2D, trail: CosmeticItem, frame: number) {
  const style = trailStyle(trail);
  const pal = trail.palette?.length ? trail.palette : [trail.color || '#00f0ff'];
  const main = trail.color || pal[0];
  const t = frame * 0.08;
  ctx.save();
  ctx.shadowColor = main;
  ctx.shadowBlur = 10;
  if (style === 'bolt') {
    ctx.strokeStyle = main;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'miter';
    for (let b = 0; b < 2; b++) {
      ctx.globalAlpha = b ? 0.5 : 0.9;
      ctx.beginPath();
      let y = 6 + b * 10;
      ctx.moveTo(-10, y);
      for (let k = 1; k <= 5; k++) {
        y = 6 + b * 10 + ((k * 7 + Math.floor(t * 3) * 3 + b * 5) % 9) - 4;
        ctx.lineTo(-10 - k * 7, y);
      }
      ctx.stroke();
    }
  } else if (style === 'flame') {
    for (let k = 0; k < 5; k++) {
      const x = -12 - k * 7;
      const h = (12 - k * 1.6) * (0.8 + 0.25 * Math.sin(t * 3 + k));
      const w = 5 - k * 0.6;
      [['#7f1d1d', 1], [main, 0.8], ['#f97316', 0.6], ['#facc15', 0.35]].forEach(([c, f]) => {
        ctx.fillStyle = c as string;
        ctx.globalAlpha = 0.85 - k * 0.12;
        ctx.beginPath();
        ctx.moveTo(x - w * (f as number), 26);
        ctx.quadraticCurveTo(x - w, 26 - h * 0.6 * (f as number), x + 2, 26 - h * (f as number));
        ctx.quadraticCurveTo(x + w * 0.6, 26 - h * 0.4 * (f as number), x + w * (f as number), 26);
        ctx.closePath();
        ctx.fill();
      });
    }
  } else if (style === 'glitter') {
    for (let k = 0; k < 10; k++) {
      const a = t * 2 + k * 0.9;
      const x = -12 - k * 4;
      const y = 10 + Math.sin(a) * (4 + k * 0.6);
      const r = (k % 3 === 0 ? 3.2 : 1.8) * (0.7 + 0.3 * Math.sin(a * 2));
      ctx.fillStyle = k % 2 ? '#fde68a' : main;
      ctx.globalAlpha = 1 - k * 0.07;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.quadraticCurveTo(x + r * 0.15, y - r * 0.15, x + r, y);
      ctx.quadraticCurveTo(x + r * 0.15, y + r * 0.15, x, y + r);
      ctx.quadraticCurveTo(x - r * 0.15, y + r * 0.15, x - r, y);
      ctx.quadraticCurveTo(x - r * 0.15, y - r * 0.15, x, y - r);
      ctx.fill();
    }
  } else if (style === 'bubble') {
    ctx.shadowBlur = 4;
    for (let k = 0; k < 5; k++) {
      const x = -13 - k * 8;
      const y = 8 + Math.sin(t * 1.5 + k) * 5 - k;
      const r = 4.5 - k * 0.5;
      ctx.globalAlpha = 0.85 - k * 0.1;
      ctx.fillStyle = `${main}55`;
      ctx.strokeStyle = main;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (style === 'glyph') {
    ctx.font = '900 6px monospace';
    ctx.textAlign = 'center';
    const chars = 'ｱｶ01ﾊﾏ10ﾗ';
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        const y = ((frame * 0.6 + row * 7 + col * 5) % 30) - 6;
        ctx.globalAlpha = (row + 1) / 5 - col * 0.12;
        ctx.fillStyle = row === 3 ? '#ecfccb' : main;
        ctx.fillText(chars[(col * 3 + row + Math.floor(frame / 8)) % chars.length], -13 - col * 7, y);
      }
    }
  } else if (style === 'ribbon') {
    ctx.shadowBlur = 6;
    pal.forEach((c, k) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let x = 0; x <= 36; x += 3) {
        const y = 2 + k * 2 + Math.sin(t * 2 - x * 0.12) * 4;
        x ? ctx.lineTo(-10 - x, y) : ctx.moveTo(-10, y);
      }
      ctx.stroke();
    });
  } else {
    // rift: a jagged dark tear with glowing violet edges and floating shards
    ctx.beginPath();
    const pts: [number, number][] = [[-10, 4], [-16, 10], [-22, 6], [-28, 14], [-34, 9], [-42, 16]];
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y + Math.sin(t + k) * 1.2) : ctx.moveTo(x, y)));
    ctx.strokeStyle = pal[1] ?? '#c026d3';
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    ctx.strokeStyle = main;
    ctx.lineWidth = 3.5;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.strokeStyle = pal[2] ?? '#0f0524';
    ctx.lineWidth = 1.6;
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.fillStyle = '#e9d5ff';
    for (let k = 0; k < 4; k++) {
      const x = -16 - k * 8;
      const y = 2 + ((k * 7 + frame * 0.3) % 18);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y - 2);
      ctx.lineTo(x + 1.5, y + 1);
      ctx.lineTo(x - 1.5, y + 1.5);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Back gear, drawn behind the body. */
function drawBack(ctx: CanvasRenderingContext2D, back: CosmeticItem, frame: number, action: string) {
  const shape = itemShape(back);
  ctx.save();
  if (shape === 'back_cyber_wings') {
    // Plasma Light Wings: angular translucent hard-light panels with bright struts.
    const col = back.color || '#00f0ff';
    const spread = action === 'jump' ? 1.3 : 1.0 + Math.sin(frame * 0.1) * 0.08;
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    [-1, 1].forEach((side) => {
      const panels: [number, number][][] = [
        [[side * 8, -8], [side * 44 * spread, -38 * spread], [side * 38 * spread, -12 * spread]],
        [[side * 8, -6], [side * 40 * spread, -6 * spread], [side * 30 * spread, 6 * spread]],
        [[side * 8, -4], [side * 28 * spread, 14 * spread], [side * 16 * spread, 18 * spread]],
      ];
      panels.forEach((pts) => {
        ctx.beginPath();
        pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = '#e0ffff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(pts[1][0], pts[1][1]);
        ctx.stroke();
      });
    });
  } else if (shape === 'back_ember_wings') {
    // Ember Phoenix Wings: a fan of flame-coloured feathers.
    const spread = action === 'jump' ? 1.25 : 1.0 + Math.sin(frame * 0.1) * 0.08;
    ctx.shadowColor = back.glowColor || '#facc15';
    ctx.shadowBlur = 10;
    [-1, 1].forEach((side) => {
      for (let i = 0; i < 6; i++) {
        const len = (40 - i * 4) * spread;
        ctx.save();
        ctx.translate(side * 7, -6);
        ctx.scale(side, 1);
        ctx.rotate(-1.05 + i * 0.3);
        ctx.fillStyle = i % 2 ? back.color || '#f97316' : back.glowColor || '#facc15';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(len * 0.5, -5, len, 0);
        ctx.quadraticCurveTo(len * 0.5, 4, 0, 0);
        ctx.fill();
        ctx.restore();
      }
    });
  } else if (shape === 'back_katana') {
    // Black lacquered scabbard, red cord, hilt over the shoulder.
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(-18, 22);
    ctx.lineTo(13, -20);
    ctx.stroke();
    ctx.strokeStyle = back.accentColor || '#ff0055';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, 4);
    ctx.lineTo(-3, 7);
    ctx.stroke();
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(12, -19);
    ctx.lineTo(15, -22);
    ctx.stroke();
    ctx.strokeStyle = back.color || '#09090b';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(15, -22);
    ctx.lineTo(22, -32);
    ctx.stroke();
    ctx.fillStyle = back.accentColor || '#ff0055';
    ctx.fillRect(18, -29, 2, 2);
  } else if (shape === 'back_jade_blade') {
    // Straight jade-green blade with glowing edges, disc guard and red tassel.
    ctx.save();
    ctx.rotate(-0.75);
    ctx.shadowColor = back.accentColor || '#34d399';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#a7f3d0';
    ctx.beginPath();
    ctx.moveTo(-2, 12);
    ctx.lineTo(-2, -26);
    ctx.lineTo(0, -31);
    ctx.lineTo(2, -26);
    ctx.lineTo(2, 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = back.accentColor || '#34d399';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = back.color || '#064e3b';
    ctx.beginPath();
    ctx.ellipse(0, 13, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-1.3, 14, 2.6, 8);
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.moveTo(0, 22);
    ctx.lineTo(3, 30);
    ctx.lineTo(-1, 30);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else if (shape === 'back_midnight_cape') {
    const sway = Math.sin(frame * 0.12) * 2 + (action === 'run' ? -6 : 0);
    ctx.fillStyle = '#6d28d9';
    ctx.beginPath();
    ctx.moveTo(-14, -14);
    ctx.lineTo(14, -14);
    ctx.lineTo(20 + sway, 34);
    ctx.lineTo(-20 + sway, 34);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = back.color || '#1e1b4b';
    ctx.beginPath();
    ctx.moveTo(-13, -14);
    ctx.lineTo(13, -14);
    ctx.lineTo(17 + sway, 34);
    ctx.lineTo(-17 + sway, 34);
    ctx.closePath();
    ctx.fill();
  } else if (shape === 'back_rocket_pack') {
    const flame = back.accentColor || '#38bdf8';
    // Twin tanks stick out past the shoulders so the pack reads from the front.
    [-21, 14].forEach((x) => {
      const g = ctx.createLinearGradient(x - 1, 0, x + 7, 0);
      g.addColorStop(0, '#94a3b8');
      g.addColorStop(0.5, '#ffffff');
      g.addColorStop(1, back.color || '#cbd5e1');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x - 1, -14, 8, 22, 3);
      ctx.fill();
      ctx.fillStyle = '#334155';
      ctx.fillRect(x, 8, 6, 4);
      ctx.fillStyle = flame;
      ctx.shadowColor = flame;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x + 6, 12);
      ctx.lineTo(x + 3, 22 + Math.sin(frame * 0.6 + x) * 3);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  } else if (shape === 'back_skateboard') {
    // Hoverboard: deck with a bolt graphic and glowing hover pads instead of wheels.
    ctx.translate(-6, 0);
    ctx.rotate(-0.55);
    ctx.fillStyle = back.color || '#8b5cf6';
    ctx.beginPath();
    ctx.roundRect(-7, -28, 14, 54, 7);
    ctx.fill();
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(1, -8);
    ctx.lineTo(-3, 1);
    ctx.lineTo(0, 1);
    ctx.lineTo(-1, 9);
    ctx.lineTo(3, -1);
    ctx.lineTo(0, -1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#22d3ee';
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 8;
    [-22, 20].forEach((y) => {
      ctx.beginPath();
      ctx.ellipse(0, y, 5, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();
}

// Unified Canvas Avatar Drawer: used both in 60fps HTML5 games and UI preview renderers
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  avatar: AvatarConfig,
  cx: number,
  cy: number,
  size: number = 100,
  options: DrawAvatarOptions = {}
) {
  const {
    frame = 0,
    action = 'idle',
    facingRight = true,
    scale = 1,
    showTrail = true,
    opacity = 1,
  } = options;

  ctx.save();
  ctx.globalAlpha = opacity;

  // Resolve equipped cosmetic records
  const skin = SKIN_TONES.find((s) => s.id === avatar.skinToneId) || SKIN_TONES[0];
  const hairColor = HAIR_COLORS.find((h) => h.id === avatar.hairColorId) || HAIR_COLORS[0];
  const shirt = COSMETICS_CATALOG.find((c) => c.id === avatar.shirtId);
  const pants = COSMETICS_CATALOG.find((c) => c.id === avatar.pantsId);
  const shoes = COSMETICS_CATALOG.find((c) => c.id === avatar.shoesId);
  const headwear = COSMETICS_CATALOG.find((c) => c.id === avatar.headwearId);
  const eyewear = COSMETICS_CATALOG.find((c) => c.id === avatar.eyewearId);
  const back = COSMETICS_CATALOG.find((c) => c.id === avatar.backId);
  const trail = COSMETICS_CATALOG.find((c) => c.id === avatar.trailId);
  const top = topLook(shirt);
  const bottom = bottomLook(pants);
  const shoe = shoeLook(shoes);

  // Position transform
  ctx.translate(cx, cy);
  if (!facingRight) {
    ctx.scale(-1, 1);
  }
  const s = (size / 120) * scale;
  ctx.scale(s, s);

  // Animation phase calculations
  const animTime = (frame % 60) / 60;
  const runCycle = Math.sin(animTime * Math.PI * 4); // 2 steps per sec
  const bobbing = action === 'run' ? Math.abs(Math.sin(animTime * Math.PI * 4)) * 4 : Math.sin(animTime * Math.PI * 2) * 2;

  // 1. Shadow beneath character (or the hover pad glow for floating shoes)
  ctx.save();
  const shadowY = action === 'jump' ? 56 : 52;
  const shadowScale = action === 'jump' ? 0.7 : 1;
  if (shoe.float && shoes) {
    ctx.fillStyle = shoes.accentColor || '#22d3ee';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 12;
    ctx.globalAlpha *= 0.55;
  } else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  }
  ctx.beginPath();
  ctx.ellipse(0, shadowY, 24 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 2. Trail effects if active
  if (showTrail && trail && trail.id !== 'none') drawTrail(ctx, trail, frame);

  // Vertical body offset based on animation
  let bodyY = -bobbing;
  if (action === 'slide') bodyY += 22;
  if (action === 'jump') bodyY -= 18;

  // 3. Back Equipment (Wings / Blades / Board / Cape / Jetpack)
  if (back && back.id !== 'none') {
    ctx.save();
    ctx.translate(0, bodyY);
    drawBack(ctx, back, frame, action);
    ctx.restore();
  }

  // 4. Legs, Pants and Shoes
  const pantsFill = fabric(ctx, pants, '#1e293b', frame);
  const pantsAccent = pants?.accentColor || '#64748b';
  const shoesFill = fabric(ctx, shoes, shoes?.color || '#ffffff', frame, 0.14);
  const shoesAccent = shoes?.accentColor || '#00f0ff';

  let leftLegAngle = 0;
  let rightLegAngle = 0;
  if (action === 'run') {
    leftLegAngle = runCycle * 0.65;
    rightLegAngle = -runCycle * 0.65;
  } else if (action === 'jump') {
    leftLegAngle = -0.4;
    rightLegAngle = 0.5;
  } else if (action === 'slide') {
    leftLegAngle = 1.2;
    rightLegAngle = 1.4;
  }

  const drawLeg = (x: number, angle: number, outer: -1 | 1) => {
    ctx.save();
    ctx.translate(x, 14 + bodyY);
    ctx.rotate(angle);
    const w = bottom.length === 'leggings' ? 7 : 8;
    const lx = -w / 2;
    if (bottom.length === 'shorts') {
      ctx.fillStyle = skin.color;
      ctx.fillRect(-3.5, 10, 7, 15);
      ctx.fillStyle = pantsFill;
      ctx.fillRect(-4.5, 0, 9, 12);
      ctx.fillStyle = pantsAccent;
      ctx.fillRect(-4.5, 11, 9, 1.2);
      if (bottom.stripe) ctx.fillRect(outer > 0 ? 3 : -4.5, 0, 1.5, 12);
    } else {
      ctx.fillStyle = pantsFill;
      ctx.fillRect(lx, 0, w, 24);
      if (bottom.stripe) {
        ctx.fillStyle = pantsAccent;
        ctx.shadowColor = pantsAccent;
        ctx.shadowBlur = 4;
        ctx.fillRect(outer > 0 ? w / 2 - 2 : lx, 0, 2, 24);
        ctx.shadowBlur = 0;
      }
      if (bottom.cargo) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(outer > 0 ? 0 : lx, 8, 4, 6);
        ctx.fillStyle = pantsAccent;
        ctx.fillRect(outer > 0 ? 0 : lx, 8, 4, 1.4);
      }
      if (bottom.knees) {
        ctx.fillStyle = '#27272a';
        ctx.fillRect(lx - 0.5, 9, w + 1, 5);
        ctx.fillStyle = pantsAccent;
        ctx.shadowColor = pantsAccent;
        ctx.shadowBlur = 5;
        ctx.fillRect(lx + 1.5, 11, w - 3, 1.2);
        ctx.shadowBlur = 0;
      }
      if (bottom.stitch) {
        ctx.strokeStyle = pantsAccent;
        ctx.lineWidth = 0.7;
        ctx.setLineDash([1.5, 1.5]);
        ctx.beginPath();
        ctx.moveTo(lx + 1, 0);
        ctx.lineTo(lx + 1, 21);
        ctx.moveTo(-lx - 1, 0);
        ctx.lineTo(-lx - 1, 21);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (bottom.cuffs) {
        ctx.fillStyle = bottom.stitch ? '#3b5bdb' : pantsAccent;
        ctx.fillRect(lx - 0.5, 20, w + 1, 3.5);
      }
      if (bottom.ankleGlow) {
        ctx.fillStyle = pantsAccent;
        ctx.shadowColor = pantsAccent;
        ctx.shadowBlur = 8;
        ctx.fillRect(lx, 21.5, w, 2);
        ctx.shadowBlur = 0;
      }
    }

    // Shoe (toe points +x)
    const sole = shoe.chunky ? 4.5 : 3;
    const lift = shoe.float ? -3 : 0;
    const topY = shoe.height === 'boot' ? 17 : shoe.height === 'high' ? 20 : 24.5;
    ctx.fillStyle = shoesFill;
    ctx.beginPath();
    ctx.roundRect(-5, topY + lift, 12.5, 32 - sole - topY + 0.5, [2, 3.5, 1, 1]);
    ctx.fill();
    if (shoe.height !== 'low') {
      ctx.fillStyle = shoe.rings ? shoesAccent : 'rgba(0,0,0,0.25)';
      if (shoe.rings) {
        ctx.shadowColor = shoesAccent;
        ctx.shadowBlur = 6;
        ctx.fillRect(-5, topY + 2 + lift, 8, 1.5);
        ctx.fillRect(-5, topY + 6 + lift, 8, 1.5);
        ctx.shadowBlur = 0;
      } else ctx.fillRect(-5, topY + lift, 7.5, 1.8);
    }
    if (shoe.toeCap) {
      ctx.fillStyle = shoe.toeCap;
      ctx.beginPath();
      ctx.roundRect(3, 26.5 + lift, 4.5, 32 - sole - 26.5, [2, 3, 0, 0]);
      ctx.fill();
    }
    if (shoe.laces) {
      ctx.strokeStyle = shoe.laces;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const ly = (shoe.height === 'low' ? 25.5 : topY + 1.5) + k * 1.8 + lift;
        ctx.moveTo(0.5 + k * 0.8, ly);
        ctx.lineTo(3 + k * 0.8, ly + 0.8);
      }
      ctx.stroke();
    }
    if (shoe.swoosh) {
      ctx.strokeStyle = shoesAccent;
      ctx.shadowColor = shoesAccent;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-4, 26 + lift);
      ctx.quadraticCurveTo(0, 29.5 + lift, 6, 26 + lift);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // Sole
    ctx.fillStyle = shoesAccent;
    if (shoe.glowSole) {
      ctx.shadowColor = shoesAccent;
      ctx.shadowBlur = 8;
    }
    ctx.fillRect(-5.5, 32 - sole + lift, 13.5, sole);
    ctx.shadowBlur = 0;
    if (shoe.studs) {
      ctx.fillStyle = '#fef3c7';
      [-3.5, 0, 3.5, 6].forEach((sx) => {
        ctx.beginPath();
        ctx.moveTo(sx - 1, 32 + lift);
        ctx.lineTo(sx + 1, 32 + lift);
        ctx.lineTo(sx, 34 + lift);
        ctx.closePath();
        ctx.fill();
      });
    }
    ctx.restore();
  };

  drawLeg(-8, leftLegAngle, -1); // behind
  drawLeg(8, rightLegAngle, 1); // front

  // 5. Torso & Shirt
  const shirtFill = fabric(ctx, shirt, '#1e293b', frame);
  const shirtAccent = shirt?.accentColor || '#00f0ff';
  const shirtBase = shirt?.color || '#1e293b';

  ctx.save();
  ctx.translate(0, bodyY);

  // Hood (resting down) sits behind the neck and shoulders.
  if (top.hood) {
    ctx.fillStyle = shade(shirtBase, -0.25);
    ctx.beginPath();
    ctx.ellipse(0, -16, 13, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Neck (Skin tone)
  ctx.fillStyle = skin.shadow;
  ctx.fillRect(-5, -20, 10, 8);

  // Main Torso Block (Athletic tapered shape) — a coat continues below the waist.
  const female = avatar.gender === 'female';
  const sw = female ? 13 : 15;
  const ww = female ? 10 : 12;
  ctx.fillStyle = shirtFill;
  ctx.beginPath();
  ctx.moveTo(-sw, -15);
  ctx.lineTo(sw, -15);
  if (top.coat) {
    ctx.lineTo(ww, 15);
    ctx.lineTo(ww + 4, 31);
    ctx.lineTo(-ww - 4, 31);
    ctx.lineTo(-ww, 15);
  } else {
    ctx.lineTo(ww, 15);
    ctx.lineTo(-ww, 15);
  }
  ctx.closePath();
  ctx.fill();
  if (top.coat) {
    // front opening
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(0, 31);
    ctx.stroke();
  }

  // Shirt details — every one comes from the item's look.
  if (top.stripe) {
    ctx.fillStyle = shirtAccent;
    ctx.fillRect(-2, -14, 4, 28);
  }
  if (top.seams) {
    ctx.fillStyle = shirtAccent;
    ctx.shadowColor = shirtAccent;
    ctx.shadowBlur = 5;
    ctx.fillRect(-8, -13, 1.2, 27);
    ctx.fillRect(6.8, -13, 1.2, 27);
    ctx.shadowBlur = 0;
  }
  if (top.zip) {
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(-0.6, -14, 1.2, top.coat ? 44 : 29);
    ctx.fillRect(-1.3, -9, 2.6, 3);
  }
  if (top.pocket) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-8, 4, 16, 8);
    ctx.fillStyle = shirtAccent;
    ctx.fillRect(-8, 4, 16, 1);
  }
  if (top.drawstrings) {
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-3, -14);
    ctx.lineTo(-3.5, -5);
    ctx.moveTo(3, -14);
    ctx.lineTo(3.5, -5);
    ctx.stroke();
    ctx.fillStyle = shirtAccent;
    ctx.fillRect(-4.3, -5, 1.6, 2);
    ctx.fillRect(2.7, -5, 1.6, 2);
  }
  if (top.bands) {
    ctx.fillStyle = shirtAccent;
    ctx.fillRect(-ww, 12, ww * 2, 3);
  }
  if (top.emblem) {
    const e = top.emblem;
    ctx.save();
    if (e.kind === 'number') {
      ctx.font = '900 10px system-ui, Arial Black, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(e.text, 0, 0);
      ctx.fillStyle = shirtAccent;
      ctx.fillText(e.text, 0, 0);
    } else if (e.kind === 'crest') {
      ctx.fillStyle = shirtAccent;
      ctx.beginPath();
      ctx.moveTo(-6, -10);
      ctx.lineTo(-2, -11);
      ctx.lineTo(-2.5, -6);
      ctx.lineTo(-4, -4);
      ctx.lineTo(-5.5, -6);
      ctx.closePath();
      ctx.fill();
    } else if (e.kind === 'diamond') {
      ctx.fillStyle = shirtAccent;
      ctx.shadowColor = shirtAccent;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(4, -2);
      ctx.lineTo(0, 4);
      ctx.lineTo(-4, -2);
      ctx.closePath();
      ctx.fill();
    } else if (e.kind === 'reactor') {
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.arc(0, -4, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shirtAccent;
      ctx.shadowColor = shirtAccent;
      ctx.shadowBlur = 10 + Math.sin(frame * 0.2) * 4;
      ctx.beginPath();
      ctx.arc(0, -4, 3.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  // Collar
  if (top.collar === 'crew') {
    ctx.fillStyle = shirtAccent;
    ctx.fillRect(-6, -15, 12, 2);
  } else if (top.collar === 'rib' || top.collar === 'varsity') {
    ctx.fillStyle = shirtAccent;
    ctx.fillRect(-7, -17, 14, 4);
    if (top.collar === 'varsity') {
      ctx.fillStyle = shirtBase;
      ctx.fillRect(-7, -15.5, 14, 1);
    }
  } else if (top.collar === 'high') {
    ctx.fillStyle = shirtFill;
    ctx.fillRect(-6.5, -20, 13, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-6.5, -20, 13, 1);
  }
  if (top.hood) {
    // the hood's rim drapes over the shoulders in front
    ctx.strokeStyle = shade(shirtBase, 0.15);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-9, -15);
    ctx.quadraticCurveTo(0, -9, 9, -15);
    ctx.stroke();
  }

  // Arms
  let leftArmAngle = action === 'run' ? -runCycle * 0.6 : 0.1;
  let rightArmAngle = action === 'run' ? runCycle * 0.6 : -0.1;
  if (action === 'shoot') {
    leftArmAngle = -1.8;
    rightArmAngle = -2.1;
  } else if (action === 'celebrate') {
    leftArmAngle = -2.4 + Math.sin(frame * 0.2) * 0.2;
    rightArmAngle = -2.4 - Math.sin(frame * 0.2) * 0.2;
  } else if (action === 'peace') {
    leftArmAngle = 0.1;
    rightArmAngle = -2.75 + Math.sin(frame * 0.15) * 0.06;
  }

  const drawArm = (x: number, angle: number, front: boolean) => {
    ctx.save();
    ctx.translate(x, -12);
    ctx.rotate(angle);
    const ox = front ? -3 : -4;
    // Sleeve length from the item: long covers to the wrist, short to mid upper-arm, none = bare.
    const sleeve = top.sleeves === 'long' ? 20 : top.sleeves === 'short' ? 7 : 0;
    ctx.fillStyle = skin.color;
    ctx.fillRect(ox + 1, 0, 5, 26);
    if (sleeve) {
      ctx.fillStyle = shirtFill;
      ctx.fillRect(ox, 0, 7, sleeve);
      if (top.bands && sleeve > 10) {
        ctx.fillStyle = shirtAccent;
        ctx.fillRect(ox, sleeve - 2.5, 7, 2.5);
      } else if (sleeve < 10) {
        ctx.fillStyle = shirtAccent;
        ctx.fillRect(ox, sleeve - 1, 7, 1);
      }
      if (top.seams && sleeve > 10) {
        ctx.fillStyle = shirtAccent;
        ctx.fillRect(ox + 3, 1, 1, sleeve - 2);
      }
    } else {
      ctx.fillStyle = shade(skin.color, -0.12);
      ctx.fillRect(ox + 1, 0, 5, 2);
    }
    if (front && action === 'peace') {
      // V sign: two splayed fingers past the hand.
      ctx.fillStyle = skin.color;
      ctx.save();
      ctx.translate(0.5, 26);
      [-0.32, 0.32].forEach((a) => {
        ctx.save();
        ctx.rotate(a);
        ctx.fillRect(-1, 0, 2, 7);
        ctx.restore();
      });
      ctx.restore();
    }
    ctx.restore();
  };
  drawArm(-14, leftArmAngle, false);
  drawArm(14, rightArmAngle, true);

  // 6. Head & Face
  ctx.translate(0, -32);

  const hairStyle = findItem(avatar.hairStyleId)?.model ?? avatar.hairStyleId;

  // Hair that falls behind the head is drawn first.
  ctx.fillStyle = hairColor.color;
  if (hairStyle === 'hair_waves') {
    ctx.beginPath();
    ctx.roundRect(-16, -8, 32, 30, [4, 4, 8, 8]);
    ctx.fill();
  } else if (hairStyle === 'hair_dreadlocks') {
    for (let k = 0; k < 9; k++) {
      const x = -15 + k * 3.75;
      const len = 22 + (k % 3) * 4;
      ctx.fillStyle = k % 2 ? hairColor.color : shade(hairColor.color, -0.18);
      ctx.beginPath();
      ctx.roundRect(x - 1.7, -8, 3.4, len, 1.7);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x - 1.9, -8 + len - 4, 3.8, 2);
    }
  } else if (hairStyle === 'hair_high_pony') {
    const swing = Math.sin(frame * 0.12) * 0.12;
    ctx.save();
    ctx.translate(-7, -16);
    ctx.rotate(swing);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-20, -6, -18, 18);
    ctx.quadraticCurveTo(-10, 4, 4, 3);
    ctx.fill();
    ctx.restore();
  }

  // Head Base (Rounded chin/jaw)
  ctx.fillStyle = skin.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.fillStyle = skin.shadow;
  ctx.beginPath();
  ctx.arc(-14, 0, 3.5, 0, Math.PI * 2);
  ctx.arc(14, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-8, -4, 5, 5);
  ctx.fillRect(3, -4, 5, 5);

  // Pupils with customizable iris
  ctx.fillStyle = avatar.eyeColor || '#00f0ff';
  const lookX = facingRight ? 1 : -1;
  ctx.fillRect(-7 + lookX, -3, 3, 3);
  ctx.fillRect(4 + lookX, -3, 3, 3);

  // Eyebrows
  ctx.fillStyle = hairColor.color;
  if (avatar.expression === 'fierce') {
    ctx.fillRect(-9, -7, 6, 2);
    ctx.fillRect(3, -7, 6, 2);
  } else {
    ctx.fillRect(-8, -6, 5, 1.5);
    ctx.fillRect(3, -6, 5, 1.5);
  }

  // Mouth
  ctx.fillStyle = '#991b1b';
  if (action === 'celebrate' || action === 'peace' || avatar.expression === 'victory') {
    ctx.beginPath();
    ctx.arc(0, 5, 4, 0, Math.PI);
    ctx.fill();
  } else {
    ctx.fillRect(-3, 6, 7, 1.5);
  }

  // 7. Hair Styles
  ctx.fillStyle = hairColor.color;
  if (hairStyle === 'hair_short_fade') {
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    ctx.fillRect(-12, -14, 24, 6);
    // faded sides + crisp edge-up line
    ctx.fillStyle = shade(hairColor.color, 0.25);
    ctx.globalAlpha *= 0.5;
    ctx.fillRect(-14.5, -8, 3, 6);
    ctx.fillRect(11.5, -8, 3, 6);
    ctx.globalAlpha /= 0.5;
  } else if (hairStyle === 'hair_spiky_punk') {
    ctx.beginPath();
    ctx.moveTo(-14, -6);
    ctx.lineTo(-12, -22);
    ctx.lineTo(-6, -14);
    ctx.lineTo(0, -26);
    ctx.lineTo(6, -14);
    ctx.lineTo(12, -22);
    ctx.lineTo(14, -6);
    ctx.closePath();
    ctx.fill();
  } else if (hairStyle === 'hair_high_pony') {
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 0.8, Math.PI * 2.2);
    ctx.fill();
    // swept bangs
    ctx.beginPath();
    ctx.moveTo(-12, -12);
    ctx.quadraticCurveTo(2, -16, 10, -6);
    ctx.quadraticCurveTo(0, -10, -12, -7);
    ctx.fill();
    // hair tie
    ctx.fillStyle = '#f472b6';
    ctx.fillRect(-9, -19, 4, 3);
  } else if (hairStyle === 'hair_waves') {
    ctx.beginPath();
    ctx.arc(0, -6, 15, Math.PI * 0.85, Math.PI * 2.15);
    ctx.fill();
    // wavy curtains past the ears
    [-1, 1].forEach((sd) => {
      ctx.beginPath();
      ctx.moveTo(sd * 15, -8);
      for (let k = 0; k <= 4; k++) ctx.lineTo(sd * (15 + (k % 2 ? 2 : -1)), -6 + k * 6.5);
      ctx.lineTo(sd * 9, 20);
      ctx.lineTo(sd * 10, -6);
      ctx.closePath();
      ctx.fill();
    });
  } else if (hairStyle === 'hair_afro_puff') {
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-12, -17, 10, 0, Math.PI * 2);
    ctx.arc(12, -17, 10, 0, Math.PI * 2);
    ctx.fill();
  } else if (hairStyle === 'hair_neon_mohawk') {
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.shadowColor = hairColor.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(-5, -14);
    ctx.lineTo(-3, -30);
    ctx.lineTo(2, -24);
    ctx.lineTo(4, -33);
    ctx.lineTo(7, -22);
    ctx.lineTo(5, -14);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  } else if (hairStyle === 'hair_space_buns') {
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-10, -21, 7.5, 0, Math.PI * 2);
    ctx.arc(10, -21, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-12, -14, 20, 6);
    // orbit rings
    ctx.strokeStyle = hairColor.highlight;
    ctx.lineWidth = 0.8;
    [-10, 10].forEach((bx) => {
      ctx.beginPath();
      ctx.ellipse(bx, -21, 10, 3, bx < 0 ? -0.4 : 0.4, 0, Math.PI * 2);
      ctx.stroke();
    });
  } else if (hairStyle === 'hair_cyber_undercut') {
    // shaved sides
    ctx.globalAlpha *= 0.45;
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    ctx.globalAlpha /= 0.45;
    ctx.beginPath();
    ctx.moveTo(-12, -10);
    ctx.lineTo(-8, -22);
    ctx.lineTo(12, -18);
    ctx.lineTo(14, -6);
    ctx.lineTo(4, -12);
    ctx.closePath();
    ctx.fill();
    // neon circuitry shaved into the side
    ctx.strokeStyle = hairColor.highlight;
    ctx.shadowColor = hairColor.highlight;
    ctx.shadowBlur = 6;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-13, -4);
    ctx.lineTo(-10, -4);
    ctx.lineTo(-10, -9);
    ctx.lineTo(-7, -9);
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (hairStyle === 'hair_dreadlocks') {
    ctx.beginPath();
    ctx.arc(0, -6, 14.8, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    // rope texture on the crown
    ctx.strokeStyle = shade(hairColor.color, -0.25);
    ctx.lineWidth = 0.8;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(k * 4, -20);
      ctx.lineTo(k * 6, -8);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, -21, 5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
  }

  // 8. Eyewear (Over eyes, before hat)
  const eyeShape = itemShape(eyewear);
  if (eyewear && eyewear.id !== 'none') {
    ctx.save();
    if (eyeShape === 'eyewear_pixel_shades') {
      // stepped 8-bit lenses
      ctx.fillStyle = eyewear.color || '#09090b';
      ctx.fillRect(-10, -5, 20, 2);
      ctx.fillRect(-9, -3, 7, 2);
      ctx.fillRect(2, -3, 7, 2);
      ctx.fillRect(-8, -1, 5, 2);
      ctx.fillRect(3, -1, 5, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-8, -4, 1.5, 1.5);
      ctx.fillRect(3, -4, 1.5, 1.5);
    } else if (eyeShape === 'eyewear_ruby_shades') {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(-11, -6, 22, 8);
      ctx.fillStyle = eyewear.color || '#dc2626';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 6;
      ctx.fillRect(-9.5, -4.5, 7.5, 5);
      ctx.fillRect(2, -4.5, 7.5, 5);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-8.5, -0.5);
      ctx.lineTo(-4.5, -4);
      ctx.moveTo(3, -0.5);
      ctx.lineTo(7, -4);
      ctx.stroke();
    } else if (eyeShape === 'eyewear_round_specs') {
      ctx.strokeStyle = eyewear.color || '#d4a017';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(-5.5, -1.5, 4.2, 0, Math.PI * 2);
      ctx.moveTo(9.7, -1.5);
      ctx.arc(5.5, -1.5, 4.2, 0, Math.PI * 2);
      ctx.moveTo(-1.3, -2);
      ctx.lineTo(1.3, -2);
      ctx.stroke();
    } else if (eyeShape === 'eyewear_cyber_hud') {
      ctx.strokeStyle = eyewear.color || '#00f0ff';
      ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(1, -6, 9, 8);
      ctx.strokeRect(1, -6, 9, 8);
      ctx.fillStyle = eyewear.color || '#00f0ff';
      ctx.fillRect(4.5, -2.5, 2, 1);
      ctx.fillRect(5, -3, 1, 2);
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(10, -3, 5, 1.5);
    } else if (eyeShape === 'eyewear_speed_shades') {
      // aviators: teardrop mirror lenses in gold wire
      const lens = ctx.createLinearGradient(0, -6, 0, 3);
      lens.addColorStop(0, eyewear.color || '#ffb800');
      lens.addColorStop(1, shade(eyewear.color || '#ffb800', -0.5));
      [-1, 1].forEach((sd) => {
        ctx.fillStyle = lens;
        ctx.strokeStyle = '#d4a017';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        const x0 = sd * 5.5;
        ctx.moveTo(x0 - 4.5, -5);
        ctx.quadraticCurveTo(x0, -6, x0 + 4.5, -5);
        ctx.quadraticCurveTo(x0 + 5, 1, x0 + sd * 0.5, 2.5);
        ctx.quadraticCurveTo(x0 - 5, 1.5, x0 - 4.5, -5);
        ctx.fill();
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(-1, -5);
      ctx.lineTo(1, -5);
      ctx.stroke();
    } else {
      // prism wrap visor
      ctx.fillStyle = fabric(ctx, eyewear, eyewear.color || '#c4b5fd', frame);
      ctx.beginPath();
      ctx.moveTo(-14, -5);
      ctx.lineTo(14, -5);
      ctx.lineTo(12, 1.5);
      ctx.lineTo(-12, 1.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 9. Headwear (On top of head)
  const hatShape = itemShape(headwear);
  if (headwear && headwear.id !== 'none') {
    ctx.save();
    if (hatShape === 'headwear_snapback') {
      const capAccent = headwear.accentColor || '#00f0ff';
      ctx.fillStyle = fabric(ctx, headwear, headwear.color || '#0f172a', frame, 0.18);
      ctx.beginPath();
      ctx.arc(0, -9, 15, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-15, -10, 30, 3);
      // panel seams + top button
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.lineTo(0, -9);
      ctx.moveTo(0, -24);
      ctx.quadraticCurveTo(-8, -20, -10, -9);
      ctx.moveTo(0, -24);
      ctx.quadraticCurveTo(8, -20, 10, -9);
      ctx.stroke();
      ctx.fillStyle = capAccent;
      ctx.beginPath();
      ctx.arc(0, -24.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
      // backwards flat brim (sticks out behind) + snap strap arch on the forehead
      ctx.fillRect(-23, -11, 10, 3);
      ctx.strokeStyle = capAccent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(3, -9, 3, Math.PI, Math.PI * 2);
      ctx.stroke();
    } else if (hatShape === 'headwear_neon_band') {
      ctx.fillStyle = headwear.color || '#ff0055';
      ctx.fillRect(-14.5, -9, 29, 5);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = headwear.color || '#ff0055';
      ctx.shadowBlur = 8;
      ctx.fillRect(-8, -7.5, 16, 1.5);
    } else if (hatShape === 'headwear_beanie') {
      ctx.fillStyle = fabric(ctx, headwear, headwear.color || '#334155', frame, 0.16);
      ctx.beginPath();
      ctx.ellipse(0, -11, 15.5, 18, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(headwear.color || '#334155', -0.15);
      ctx.fillRect(-15.5, -13, 31, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (let k = -14; k < 15; k += 3) ctx.fillRect(k, -13, 1, 6);
      if (headwear.accentColor) {
        ctx.fillStyle = headwear.accentColor;
        ctx.beginPath();
        ctx.arc(0, -30, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (hatShape === 'headwear_cyber_visor') {
      ctx.fillStyle = headwear.color || '#09090b';
      ctx.fillRect(-15, -14, 30, 8);
      ctx.fillStyle = headwear.accentColor || '#00f0ff';
      ctx.shadowColor = headwear.accentColor || '#00f0ff';
      ctx.shadowBlur = 8;
      ctx.fillRect(-13, -11, 26, 3);
    } else if (hatShape === 'headwear_crown') {
      ctx.fillStyle = headwear.color || '#ffb800';
      ctx.shadowColor = headwear.color || '#ffb800';
      ctx.shadowBlur = 10;
      const lift = Math.sin(frame * 0.1) * 1;
      ctx.beginPath();
      ctx.moveTo(-12, -14 + lift);
      ctx.lineTo(-14, -25 + lift);
      ctx.lineTo(-6, -18 + lift);
      ctx.lineTo(0, -28 + lift);
      ctx.lineTo(6, -18 + lift);
      ctx.lineTo(14, -25 + lift);
      ctx.lineTo(12, -14 + lift);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = headwear.accentColor || '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -22 + lift);
      ctx.lineTo(2, -18.5 + lift);
      ctx.lineTo(0, -15 + lift);
      ctx.lineTo(-2, -18.5 + lift);
      ctx.closePath();
      ctx.fill();
    } else if (hatShape === 'headwear_obsidian_crown') {
      // jagged volcanic-glass shards of uneven height, red gems
      ctx.fillStyle = headwear.color || '#1e1b2e';
      ctx.shadowColor = headwear.accentColor || '#ef4444';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(-13, -13);
      [[-14, -24], [-10, -17], [-6, -30], [-3, -18], [1, -26], [4, -17], [8, -32], [11, -18], [14, -23]].forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(13, -13);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.fillStyle = headwear.accentColor || '#ef4444';
      [[-7, -16, 2], [0, -16, 2.6], [7, -16, 2]].forEach(([x, y, r]) => {
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.8, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r * 0.8, y);
        ctx.closePath();
        ctx.fill();
      });
    } else if (hatShape === 'headwear_seraph_halo') {
      const bob = Math.sin(frame * 0.1) * 1.5;
      ctx.strokeStyle = headwear.color || '#fde68a';
      ctx.shadowColor = headwear.color || '#fde68a';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.ellipse(0, -27 + bob, 12, 3.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (hatShape === 'headwear_bassline_cans') {
      ctx.strokeStyle = headwear.color || '#18181b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -2, 16, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      [-15, 15].forEach((x) => {
        ctx.fillStyle = headwear.color || '#18181b';
        ctx.beginPath();
        ctx.ellipse(x, 0, 4.5, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = headwear.accentColor || '#e879f9';
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 8 + Math.sin(frame * 0.3) * 3;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.ellipse(x, 0, 3, 5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      });
    }
    ctx.restore();
  }

  ctx.restore(); // restore torso & head
  ctx.restore(); // restore root scale & translate
}
