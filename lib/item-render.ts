import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { AvatarConfig, CosmeticItem } from './avatar-types';
import { RARITY, getStarterAvatar, hairColorFor } from './cosmetics-catalog';
import { trailStyle } from './item-looks';
import { create3DAvatar } from './avatar-3d-model';
import { mulberry32, hashSeed } from './rng';

/**
 * Product-shot generator for cosmetic items.
 *
 * Every image is the item's REAL 3D model (the same one built for avatars), framed on the item,
 * over a background composed from the item's own name (seeded motif) and rarity (palette, rays,
 * foil). Used by /item-lab and scripts/render-items.cjs to write public/items/<id>.webp.
 */

type Rng = () => number;

const hex = (c: string, a = 1) => {
  const v = new THREE.Color(c);
  return `rgba(${Math.round(v.r * 255)},${Math.round(v.g * 255)},${Math.round(v.b * 255)},${a})`;
};

/** The mannequin wearing the item (neutral look so the item is the star). */
function modelFor(item: CosmeticItem): AvatarConfig {
  const a: AvatarConfig = { ...getStarterAvatar('neutral'), skinToneId: 'golden', hairStyleId: 'hair_short_fade', hairColorId: 'jet_black', eyeColor: '#38bdf8', headwearId: 'none', eyewearId: 'none', backId: 'none', trailId: 'none' };
  switch (item.category) {
    case 'hair':
      a.hairStyleId = item.id;
      a.hairColorId = hairColorFor(item);
      break;
    case 'shirt':
      a.shirtId = item.id;
      break;
    case 'pants':
      a.pantsId = item.id;
      a.shirtId = 'shirt_street_hoodie';
      break;
    case 'shoes':
      a.shoesId = item.id;
      break;
    case 'headwear':
      a.headwearId = item.id;
      break;
    case 'eyewear':
      a.eyewearId = item.id;
      break;
    case 'back':
      a.backId = item.id;
      break;
    case 'pose':
      a.shirtId = 'shirt_retro_tracksuit';
      a.hairStyleId = 'hair_spiky_punk';
      a.hairColorId = 'cyber_cyan';
      break;
  }
  return a;
}

/** Where to aim and how much to fit, per category. */
const FRAMING: Record<string, { target: [number, number, number]; fit: number; dir: [number, number, number]; turn?: number }> = {
  hair: { target: [0, 1.62, 0], fit: 0.92, dir: [0.6, 0.06, 1] },
  headwear: { target: [0, 1.67, 0], fit: 0.95, dir: [0.5, 0.08, 1] },
  eyewear: { target: [0, 1.61, 0.05], fit: 0.62, dir: [0.42, 0.02, 1] },
  shirt: { target: [0, 1.17, 0], fit: 1.15, dir: [0.45, 0.12, 1] },
  pants: { target: [0, 0.52, 0], fit: 1.15, dir: [0.45, 0.15, 1] },
  shoes: { target: [0, 0.1, 0.05], fit: 0.5, dir: [0.9, 0.55, 1] },
  back: { target: [0, 1.28, 0], fit: 1.7, dir: [0.25, 0.15, 1], turn: Math.PI * 0.88 },
  pose: { target: [0, 0.98, 0], fit: 2.15, dir: [0.35, 0.1, 1] },
};

// ------------------------------------------------------------------ background art

function paintBackground(g: CanvasRenderingContext2D, item: CosmeticItem, S: number, rng: Rng) {
  const r = RARITY[item.rarity];
  const tint = item.color ?? r.color;
  const accent = item.accentColor ?? item.palette?.[1] ?? r.color;

  // Base: rarity vignette with the item's own colour bleeding in.
  const bg = g.createRadialGradient(S * 0.5, S * 0.45, S * 0.05, S * 0.5, S * 0.5, S * 0.75);
  bg.addColorStop(0, hex(r.from, 1));
  bg.addColorStop(0.55, hex(r.to, 1));
  bg.addColorStop(1, '#05060c');
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  const wash = g.createRadialGradient(S * 0.5, S * 0.42, 0, S * 0.5, S * 0.42, S * 0.55);
  wash.addColorStop(0, hex(tint, 0.35));
  wash.addColorStop(1, hex(tint, 0));
  g.fillStyle = wash;
  g.fillRect(0, 0, S, S);

  // Name-seeded motif: every item gets its own composition.
  const motif = Math.floor(rng() * 6);
  g.save();
  g.globalAlpha = 0.16 + r.rank * 0.03;
  g.strokeStyle = hex(accent, 1);
  g.fillStyle = hex(accent, 1);
  g.lineWidth = 2;
  if (motif === 0) {
    // hex grid
    const R = 18 + rng() * 14;
    for (let y = -R; y < S + R; y += R * 1.5)
      for (let x = -R; x < S + R; x += R * Math.sqrt(3)) {
        const ox = (Math.round(y / (R * 1.5)) % 2) * (R * Math.sqrt(3)) * 0.5;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const px = x + ox + Math.cos(a) * R;
          const py = y + Math.sin(a) * R;
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
        g.stroke();
      }
  } else if (motif === 1) {
    // concentric rings from an off-centre point
    const cx = S * (0.3 + rng() * 0.4);
    const cy = S * (0.3 + rng() * 0.3);
    for (let rr = 20; rr < S; rr += 18 + rng() * 10) {
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (motif === 2) {
    // diagonal speed lines
    g.lineWidth = 3;
    const ang = (rng() - 0.5) * 0.8;
    g.translate(S / 2, S / 2);
    g.rotate(ang - Math.PI / 4);
    for (let i = 0; i < 26; i++) {
      const y = (rng() - 0.5) * S * 1.4;
      const x = (rng() - 0.5) * S;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 60 + rng() * 160, y);
      g.stroke();
    }
  } else if (motif === 3) {
    // circuit traces
    for (let i = 0; i < 16; i++) {
      let x = Math.round((rng() * S) / 24) * 24;
      let y = Math.round((rng() * S) / 24) * 24;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        if (rng() < 0.5) x += (rng() < 0.5 ? -1 : 1) * 48;
        else y += (rng() < 0.5 ? -1 : 1) * 48;
        g.lineTo(x, y);
      }
      g.stroke();
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
  } else if (motif === 4) {
    // dot halftone
    const step = 14 + rng() * 6;
    for (let y = 0; y < S; y += step)
      for (let x = 0; x < S; x += step) {
        const d = Math.hypot(x - S / 2, y - S * 0.45) / (S * 0.7);
        const rr = Math.max(0, 1 - d) * step * 0.32;
        if (rr > 0.3) {
          g.beginPath();
          g.arc(x, y, rr, 0, Math.PI * 2);
          g.fill();
        }
      }
  } else {
    // shards
    for (let i = 0; i < 12; i++) {
      const cx = rng() * S;
      const cy = rng() * S;
      const rr = 20 + rng() * 60;
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = rng() * Math.PI * 2;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (k) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.closePath();
      g.stroke();
    }
  }
  g.restore();

  // Rarity flourishes behind the item.
  if (r.rank >= 3) {
    // god rays
    g.save();
    g.translate(S / 2, S * 0.46);
    const rays = 14 + Math.floor(rng() * 8);
    for (let i = 0; i < rays; i++) {
      g.rotate((Math.PI * 2) / rays);
      const grd = g.createLinearGradient(0, 0, S * 0.7, 0);
      grd.addColorStop(0, hex(r.color, item.rarity === 'mythic' ? 0.22 : 0.3));
      grd.addColorStop(1, hex(r.color, 0));
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(S * 0.7, -S * 0.05);
      g.lineTo(S * 0.7, S * 0.05);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
  if (item.rarity === 'mythic') {
    // holographic foil sweep
    g.save();
    g.globalCompositeOperation = 'screen';
    const foil = g.createLinearGradient(0, 0, S, S);
    ['#22d3ee', '#a78bfa', '#f472b6', '#facc15', '#22d3ee'].forEach((c, i, a) => foil.addColorStop(i / (a.length - 1), hex(c, 0.22)));
    g.fillStyle = foil;
    g.fillRect(0, 0, S, S);
    g.restore();
  }

  // Pedestal glow.
  const ped = g.createRadialGradient(S / 2, S * 0.86, 0, S / 2, S * 0.86, S * 0.36);
  ped.addColorStop(0, hex(r.color, 0.55));
  ped.addColorStop(1, hex(r.color, 0));
  g.fillStyle = ped;
  g.save();
  g.translate(S / 2, S * 0.86);
  g.scale(1, 0.28);
  g.translate(-S / 2, -S * 0.86);
  g.fillRect(0, S * 0.5, S, S * 0.72);
  g.restore();
}

function paintSparkles(g: CanvasRenderingContext2D, item: CosmeticItem, S: number, rng: Rng) {
  const r = RARITY[item.rarity];
  const n = [0, 4, 8, 14, 22][r.rank];
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const x = S * (0.08 + rng() * 0.84);
    const y = S * (0.06 + rng() * 0.7);
    const len = 4 + rng() * (r.rank >= 3 ? 14 : 8);
    const col = item.rarity === 'mythic' ? ['#a5f3fc', '#f5d0fe', '#fef08a'][i % 3] : r.color;
    const grd = g.createRadialGradient(x, y, 0, x, y, len);
    grd.addColorStop(0, hex('#ffffff', 0.95));
    grd.addColorStop(0.3, hex(col, 0.6));
    grd.addColorStop(1, hex(col, 0));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x - len, y);
    g.lineTo(x - len * 0.15, y - len * 0.15);
    g.lineTo(x, y - len);
    g.lineTo(x + len * 0.15, y - len * 0.15);
    g.lineTo(x + len, y);
    g.lineTo(x + len * 0.15, y + len * 0.15);
    g.lineTo(x, y + len);
    g.lineTo(x - len * 0.15, y + len * 0.15);
    g.closePath();
    g.fill();
  }
  g.restore();
}

// ------------------------------------------------------------------ banners (flat art)

function paintBanner(g: CanvasRenderingContext2D, item: CosmeticItem, S: number, rng: Rng) {
  const w = S * 0.78;
  const h = S * 0.44;
  const x = (S - w) / 2;
  const y = S * 0.28;
  g.save();
  g.translate(S / 2, y + h / 2);
  g.rotate(-0.06);
  g.translate(-S / 2, -(y + h / 2));
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 30;
  g.shadowOffsetY = 14;
  g.fillStyle = item.color ?? '#1e293b';
  g.beginPath();
  g.roundRect(x, y, w, h, 18);
  g.fill();
  g.shadowColor = 'transparent';
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, 18);
  g.clip();
  if (item.id === 'banner_neon_city') {
    const sky = g.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, '#2e1065');
    sky.addColorStop(0.6, '#db2777');
    sky.addColorStop(1, '#f59e0b');
    g.fillStyle = sky;
    g.fillRect(x, y, w, h);
    g.fillStyle = '#fde68a';
    g.beginPath();
    g.arc(S / 2, y + h * 0.7, h * 0.28, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0f0524';
    let bx = x;
    while (bx < x + w) {
      const bw = 18 + rng() * 34;
      const bh = h * (0.25 + rng() * 0.5);
      g.fillRect(bx, y + h - bh, bw - 3, bh);
      g.fillStyle = '#22d3ee';
      for (let wy = y + h - bh + 8; wy < y + h - 6; wy += 10) if (rng() < 0.5) g.fillRect(bx + 4 + rng() * (bw - 12), wy, 3, 3);
      g.fillStyle = '#0f0524';
      bx += bw;
    }
  } else if (item.id === 'banner_grandmaster') {
    const gold = g.createLinearGradient(x, y, x + w, y + h);
    gold.addColorStop(0, '#78350f');
    gold.addColorStop(0.5, '#fbbf24');
    gold.addColorStop(1, '#92400e');
    g.fillStyle = gold;
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    const R = 16;
    for (let yy = y - R; yy < y + h + R; yy += R * 1.5)
      for (let xx = x - R; xx < x + w + R; xx += R * Math.sqrt(3)) {
        const ox = (Math.round((yy - y) / (R * 1.5)) % 2) * R * Math.sqrt(3) * 0.5;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const px = xx + ox + Math.cos(a) * R;
          const py = yy + Math.sin(a) * R;
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
        g.stroke();
      }
    // shield
    g.fillStyle = '#fff7ed';
    g.beginPath();
    const cx = S / 2;
    const cy = y + h / 2;
    g.moveTo(cx, cy - h * 0.32);
    g.lineTo(cx + h * 0.26, cy - h * 0.2);
    g.lineTo(cx + h * 0.2, cy + h * 0.18);
    g.lineTo(cx, cy + h * 0.34);
    g.lineTo(cx - h * 0.2, cy + h * 0.18);
    g.lineTo(cx - h * 0.26, cy - h * 0.2);
    g.closePath();
    g.fill();
    g.fillStyle = '#b45309';
    g.font = `900 ${Math.round(h * 0.24)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('GM', cx, cy + 2);
  } else {
    g.fillStyle = '#0f172a';
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(56,189,248,0.55)';
    g.lineWidth = 1.5;
    for (let gx = x; gx < x + w; gx += 22) {
      g.beginPath();
      g.moveTo(gx, y);
      g.lineTo(gx, y + h);
      g.stroke();
    }
    for (let gy = y; gy < y + h; gy += 22) {
      g.beginPath();
      g.moveTo(x, gy);
      g.lineTo(x + w, gy);
      g.stroke();
    }
  }
  g.restore();
  g.lineWidth = 5;
  g.strokeStyle = RARITY[item.rarity].color;
  g.beginPath();
  g.roundRect(x, y, w, h, 18);
  g.stroke();
  g.restore();
}

// ------------------------------------------------------------------ trails (one look per trail)

const basic = (color: THREE.ColorRepresentation, extra: THREE.MeshBasicMaterialParameters = {}) =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(color), toneMapped: false, ...extra });

/** The swooping path every trail follows (the player's motion). */
function trailPath(rng: Rng) {
  const pts: THREE.Vector3[] = [];
  const turns = 1.1 + rng() * 0.4;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const a = t * Math.PI * 2 * turns;
    pts.push(new THREE.Vector3(Math.cos(a) * (0.95 - t * 0.5), -0.9 + t * 1.65, Math.sin(a) * (0.95 - t * 0.5)));
  }
  return new THREE.CatmullRomCurve3(pts);
}

function glyphTexture(color: string) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64 * 8;
  const g = c.getContext('2d')!;
  g.font = '900 58px monospace';
  g.shadowColor = color;
  g.shadowBlur = 10;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const chars = 'ｱｶｻﾀﾅ01ﾊﾏﾔﾗ10ﾜ';
  for (let k = 0; k < 8; k++) {
    g.globalAlpha = 0.25 + (k / 7) * 0.75;
    g.fillStyle = k === 7 ? '#ecfccb' : color;
    g.fillText(chars[(k * 5) % chars.length], 32, 32 + k * 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function trailScene(item: CosmeticItem, rng: Rng) {
  const group = new THREE.Group();
  const pal = item.palette?.length ? item.palette : [item.color ?? '#00f0ff'];
  const main = item.color ?? pal[0];
  const curve = trailPath(rng);
  const style = trailStyle(item);
  const add = (o: THREE.Object3D) => (group.add(o), o);

  if (style === 'bolt') {
    // Cyan Ion: forked lightning bolts crackling along the path.
    for (let b = 0; b < 3; b++) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 16; k++) {
        const p = curve.getPoint(Math.min(1, b * 0.06 + k / 16 * 0.9));
        p.add(new THREE.Vector3((rng() - 0.5) * 0.28, (rng() - 0.5) * 0.28, (rng() - 0.5) * 0.28));
        pts.push(p);
      }
      const line = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0);
      add(new THREE.Mesh(new THREE.TubeGeometry(line, 120, b ? 0.018 : 0.035, 6), basic(b ? main : '#e0ffff')));
      add(new THREE.Mesh(new THREE.TubeGeometry(line, 120, 0.09, 6), basic(main, { transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending })));
    }
    for (let k = 0; k < 6; k++) {
      // side forks
      const p0 = curve.getPoint(rng());
      const pts = [p0];
      for (let q = 0; q < 3; q++) pts.push(pts[pts.length - 1].clone().add(new THREE.Vector3((rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4)));
      add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0), 20, 0.012, 4), basic(main)));
    }
  } else if (style === 'flame') {
    // Phoenix Crimson: licks of fire growing along the path, embers rising off them.
    const fl = new THREE.ConeGeometry(0.1, 0.42, 12);
    const cols = ['#7f1d1d', main, '#f97316', '#facc15'];
    for (let k = 0; k < 26; k++) {
      const t = k / 25;
      const p = curve.getPoint(t);
      const size = 0.45 + t * 1.1;
      cols.forEach((c, layer) => {
        const m = new THREE.Mesh(fl, basic(c, { transparent: true, opacity: 0.85 - layer * 0.12, blending: THREE.AdditiveBlending }));
        m.scale.set(size * (1 - layer * 0.2), size * (1 - layer * 0.15) * (0.8 + rng() * 0.5), size * (1 - layer * 0.2));
        m.position.copy(p).add(new THREE.Vector3(0, 0.12 * size, 0));
        m.rotation.z = (rng() - 0.5) * 0.5;
        add(m);
      });
    }
    for (let k = 0; k < 40; k++) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.018 + rng() * 0.02, 6, 4), basic(rng() < 0.5 ? '#facc15' : '#fb923c'));
      e.position.copy(curve.getPoint(rng())).add(new THREE.Vector3((rng() - 0.5) * 0.4, 0.2 + rng() * 0.5, (rng() - 0.5) * 0.4));
      add(e);
    }
  } else if (style === 'glitter') {
    // Stardust Aureum: a vortex of four-point golden glints.
    const star = new THREE.Shape();
    star.moveTo(0, 1);
    star.quadraticCurveTo(0.1, 0.1, 1, 0);
    star.quadraticCurveTo(0.1, -0.1, 0, -1);
    star.quadraticCurveTo(-0.1, -0.1, -1, 0);
    star.quadraticCurveTo(-0.1, 0.1, 0, 1);
    const starGeo = new THREE.ShapeGeometry(star, 4);
    for (let k = 0; k < 120; k++) {
      const t = rng();
      const p = curve.getPoint(t);
      const spin = rng() * Math.PI * 2;
      const r = 0.05 + rng() * 0.25;
      p.add(new THREE.Vector3(Math.cos(spin) * r, (rng() - 0.5) * 0.15, Math.sin(spin) * r));
      const m = new THREE.Mesh(starGeo, basic(['#fde68a', main, '#fff7ed'][k % 3], { transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
      m.scale.setScalar(0.025 + rng() * 0.07 * (0.5 + t));
      m.position.copy(p);
      m.lookAt(0, 0, 10);
      add(m);
    }
    add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.03, 6), basic(main, { transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending })));
  } else if (style === 'bubble') {
    // Bubblepop: glossy translucent bubbles, a few mid-pop.
    const sph = new THREE.SphereGeometry(1, 28, 18);
    for (let k = 0; k < 22; k++) {
      const t = k / 21;
      const p = curve.getPoint(t);
      p.add(new THREE.Vector3((rng() - 0.5) * 0.2, (rng() - 0.5) * 0.2, (rng() - 0.5) * 0.2));
      const r = 0.06 + t * 0.16 + rng() * 0.05;
      if (k % 6 === 5) {
        // popping: a burst ring of droplets
        for (let q = 0; q < 8; q++) {
          const a = (q / 8) * Math.PI * 2;
          const d = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), basic(pal[1] ?? '#fbcfe8'));
          d.position.copy(p).add(new THREE.Vector3(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3, 0));
          add(d);
        }
        continue;
      }
      const b = new THREE.Mesh(sph, new THREE.MeshPhysicalMaterial({ color: new THREE.Color(main), roughness: 0.05, metalness: 0, transmission: 0.6, transparent: true, opacity: 0.55, iridescence: 1, iridescenceIOR: 1.4, clearcoat: 1, emissive: new THREE.Color(main), emissiveIntensity: 0.15 }));
      b.scale.setScalar(r);
      b.position.copy(p);
      add(b);
      const hl = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), basic('#ffffff'));
      hl.scale.setScalar(r * 0.2);
      hl.position.copy(p).add(new THREE.Vector3(-r * 0.4, r * 0.45, r * 0.7));
      add(hl);
    }
  } else if (style === 'glyph') {
    // Matrix Rain: columns of falling green glyphs streaming off the path.
    const tex = glyphTexture(main);
    const mat2 = basic('#bbf7d0', { map: tex, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
    const mat = basic('#ffffff', { map: tex, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
    const plane = new THREE.PlaneGeometry(0.2, 1.6);
    add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.05, 6), basic(main, { transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending })));
    for (let k = 0; k < 30; k++) {
      const p = curve.getPoint(k / 29);
      const m = new THREE.Mesh(plane, k % 2 ? mat : mat2);
      const sc = 0.6 + rng() * 0.8;
      m.scale.set(sc, sc, 1);
      m.position.copy(p).add(new THREE.Vector3((rng() - 0.5) * 0.3, -0.3 * sc, (rng() - 0.5) * 0.3));
      m.lookAt(0, m.position.y, 10);
      add(m);
    }
  } else if (style === 'ribbon') {
    // Rainbow Rush: one wide ribbon of six stacked colour bands.
    pal.forEach((c, k) => {
      const off = (k - (pal.length - 1) / 2) * 0.055;
      const pts = curve.getPoints(80).map((p) => p.clone().add(new THREE.Vector3(0, off, 0)));
      add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.032, 6), basic(c)));
    });
    add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.2, 8), basic('#ffffff', { transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending })));
  } else {
    // Void Rift: a jagged tear of darkness with crackling violet edges, shards floating out.
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 14; k++) {
      const p = curve.getPoint(k / 14);
      p.add(new THREE.Vector3((rng() - 0.5) * 0.18, (rng() - 0.5) * 0.18, 0));
      pts.push(p);
    }
    const jag = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0);
    add(new THREE.Mesh(new THREE.TubeGeometry(jag, 140, 0.11, 8), basic(pal[2] ?? '#0f0524')));
    add(new THREE.Mesh(new THREE.TubeGeometry(jag, 140, 0.15, 8), basic(main, { transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending })));
    add(new THREE.Mesh(new THREE.TubeGeometry(jag, 140, 0.24, 8), basic(pal[1] ?? '#c026d3', { transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending })));
    const shard = new THREE.TetrahedronGeometry(0.06, 0);
    for (let k = 0; k < 26; k++) {
      const m = new THREE.Mesh(shard, basic(k % 2 ? main : '#e9d5ff'));
      m.position.copy(curve.getPoint(rng())).add(new THREE.Vector3((rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6));
      m.rotation.set(rng() * 6, rng() * 6, rng() * 6);
      m.scale.setScalar(0.5 + rng());
      add(m);
    }
  }
  group.rotation.set(0.25, 0.4, -0.15);
  return group;
}

// ------------------------------------------------------------------ renderer

export class ItemRenderer {
  readonly size: number;
  private renderer: THREE.WebGLRenderer;
  private env: THREE.Texture;
  private out: HTMLCanvasElement;

  constructor(size = 512) {
    this.size = size;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(0x000000, 0);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.out = document.createElement('canvas');
    this.out.width = this.out.height = size;
  }

  /** Render one item; returns the composited canvas (valid until the next call). */
  render(item: CosmeticItem): HTMLCanvasElement {
    const S = this.size;
    const rng = mulberry32(hashSeed(`${item.id}:${item.name}`));
    const g = this.out.getContext('2d')!;
    g.clearRect(0, 0, S, S);
    paintBackground(g, item, S, rng);

    if (item.category === 'banner') {
      paintBanner(g, item, S, rng);
      paintSparkles(g, item, S, rng);
      return this.out;
    }

    const scene = new THREE.Scene();
    scene.environment = this.env;
    scene.environmentIntensity = 0.55;
    const rc = new THREE.Color(RARITY[item.rarity].color);
    scene.add(new THREE.HemisphereLight(0xdbe7ff, 0x1a1030, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 4, 3);
    const rim = new THREE.DirectionalLight(rc, 2.2);
    rim.position.set(-3, 2, -2.5);
    const fill = new THREE.DirectionalLight(new THREE.Color(item.accentColor ?? item.color ?? '#88aaff'), 0.7);
    fill.position.set(3, 0.5, -1);
    scene.add(key, rim, fill);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    let dispose = () => {};

    if (item.category === 'trail') {
      const t = trailScene(item, rng);
      scene.add(t);
      camera.position.set(0, 0.1, 6.2);
      camera.lookAt(0, -0.05, 0);
      dispose = () => t.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.MeshBasicMaterial | undefined;
        mat?.map?.dispose();
        mat?.dispose?.();
      });
    } else {
      const av = create3DAvatar(modelFor(item));
      const f = FRAMING[item.category] ?? FRAMING.pose;
      const action = item.id === 'pose_victory_flex' ? 'celebrate' : item.id === 'pose_peace_sign' ? 'peace' : 'idle';
      av.updateAnimation(1.2, action);
      if (item.id === 'pose_victory_flex') {
        av.leftArm.rotation.x = -2.9;
        av.rightArm.rotation.x = -1.2;
      }
      if (f.turn) av.group.rotation.y = f.turn;
      // Some signatures live on the side or back: the ponytail, the backwards brim, the locs.
      const SIDE_VIEW: Record<string, number> = { hair_high_pony: 1.35, hair_dreadlocks: 0.9, hair_waves: 0.5, headwear_snapback: 1.3, hair_cyber_undercut: -0.8 };
      av.group.rotation.y += SIDE_VIEW[item.model ?? item.id] ?? 0;
      // Turn the mannequin slightly differently per item so a row of shots doesn't look cloned.
      av.group.rotation.y += (rng() - 0.5) * 0.35;
      scene.add(av.group);
      const target = new THREE.Vector3(...f.target);
      const dir = new THREE.Vector3(...f.dir).normalize();
      const dist = (f.fit / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.12;
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      dispose = () => av.dispose();
    }

    this.renderer.render(scene, camera);
    g.drawImage(this.renderer.domElement, 0, 0, S, S);
    dispose();
    paintSparkles(g, item, S, rng);
    return this.out;
  }

  dispose() {
    this.env.dispose();
    this.renderer.dispose();
  }
}
