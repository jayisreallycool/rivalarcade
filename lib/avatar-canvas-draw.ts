import { AvatarConfig, CosmeticItem } from './avatar-types';
import { SKIN_TONES, HAIR_COLORS, COSMETICS_CATALOG, findItem, itemFinish, itemShape } from './cosmetics-catalog';
import { patternCanvas } from './item-patterns';

/** Fill for a garment: its print as a scaled repeating pattern, a moving foil for holo, else flat colour. */
const patternCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern | null>>();
function fabric(ctx: CanvasRenderingContext2D, item: CosmeticItem | undefined, fallback: string, frame: number): string | CanvasPattern | CanvasGradient {
  if (!item) return fallback;
  if (itemFinish(item) === 'holo' && item.palette?.length) {
    const shift = Math.sin(frame * 0.05) * 14;
    const g = ctx.createLinearGradient(-16 + shift, -16, 16 + shift, 16);
    item.palette.forEach((c, i) => g.addColorStop(i / Math.max(1, item.palette!.length - 1), c));
    return g;
  }
  const swatch = patternCanvas(item);
  if (!swatch) return item.color || fallback;
  let byId = patternCache.get(ctx);
  if (!byId) patternCache.set(ctx, (byId = new Map()));
  if (!byId.has(item.id)) {
    const pat = ctx.createPattern(swatch, 'repeat');
    if (pat && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scale(0.22));
    byId.set(item.id, pat);
  }
  return byId.get(item.id) ?? item.color ?? fallback;
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

  // 1. Shadow beneath character
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  const shadowY = action === 'jump' ? 56 : 52;
  const shadowScale = action === 'jump' ? 0.7 : 1;
  ctx.beginPath();
  ctx.ellipse(0, shadowY, 24 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 2. Trail effects if active
  if (showTrail && trail && trail.id !== 'none' && trail.color) {
    ctx.save();
    const trailColor = trail.color;
    ctx.fillStyle = trailColor;
    ctx.shadowColor = trailColor;
    ctx.shadowBlur = 12;
    for (let i = 0; i < 4; i++) {
      if (trail.palette?.length) {
        ctx.fillStyle = trail.palette[i % trail.palette.length];
        ctx.shadowColor = ctx.fillStyle;
      }
      const pOffset = (i + 1) * -8;
      const pY = Math.sin((frame + i * 10) * 0.2) * 6;
      ctx.globalAlpha = 0.4 - i * 0.08;
      ctx.beginPath();
      ctx.arc(pOffset, pY + 10, 4 - i * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 3. Back Equipment (Wings / Katana / Skateboard)
  const backShape = itemShape(back);
  if (back && back.id !== 'none') {
    ctx.save();
    if (backShape === 'back_cyber_wings') {
      const wingColor = back.color || '#00f0ff';
      const wingSpread = action === 'jump' ? 1.3 : 1.0 + Math.sin(frame * 0.1) * 0.1;
      ctx.strokeStyle = wingColor;
      ctx.fillStyle = wingColor;
      ctx.globalAlpha *= 0.85;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = wingColor;
      ctx.shadowBlur = 10;

      // Left wing
      ctx.beginPath();
      ctx.moveTo(-10, -5);
      ctx.lineTo(-38 * wingSpread, -30 * wingSpread);
      ctx.lineTo(-46 * wingSpread, -10 * wingSpread);
      ctx.lineTo(-24 * wingSpread, 4);
      ctx.closePath();
      ctx.save();
      ctx.globalAlpha *= 0.3;
      ctx.fill();
      ctx.restore();
      ctx.stroke();

      // Right wing
      ctx.beginPath();
      ctx.moveTo(10, -5);
      ctx.lineTo(38 * wingSpread, -30 * wingSpread);
      ctx.lineTo(46 * wingSpread, -10 * wingSpread);
      ctx.lineTo(24 * wingSpread, 4);
      ctx.closePath();
      ctx.save();
      ctx.globalAlpha *= 0.3;
      ctx.fill();
      ctx.restore();
      ctx.stroke();
    } else if (backShape === 'back_katana') {
      ctx.strokeStyle = back.color || '#09090b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-18, 20);
      ctx.lineTo(20, -32);
      ctx.stroke();

      // Hilt & wrap
      ctx.strokeStyle = back.accentColor || '#ff0055';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(12, -22);
      ctx.lineTo(22, -34);
      ctx.stroke();
    } else if (backShape === 'back_midnight_cape') {
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
    } else if (backShape === 'back_rocket_pack') {
      const flame = back.accentColor || '#38bdf8';
      [-9, 5].forEach((x) => {
        ctx.fillStyle = back.color || '#cbd5e1';
        ctx.fillRect(x - 1, -14, 8, 22);
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
    } else if (backShape === 'back_skateboard') {
      ctx.save();
      ctx.rotate(-0.3);
      ctx.fillStyle = back.color || '#8b5cf6';
      ctx.fillRect(-6, -20, 12, 38);
      ctx.fillStyle = '#18181b';
      ctx.fillRect(-8, -14, 16, 4);
      ctx.fillRect(-8, 8, 16, 4);
      ctx.restore();
    }
    ctx.restore();
  }

  // Vertical body offset based on animation
  let bodyY = -bobbing;
  if (action === 'slide') bodyY += 22;
  if (action === 'jump') bodyY -= 18;

  // 4. Legs and Pants
  const pantsColor = fabric(ctx, pants, '#1e293b', frame);
  const pantsAccent = pants?.accentColor || '#64748b';
  const shoesColor = shoes?.color || '#ffffff';
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

  // Left Leg (Behind)
  ctx.save();
  ctx.translate(-8, 14 + bodyY);
  ctx.rotate(leftLegAngle);
  // Thigh & Shin (Pants)
  ctx.fillStyle = pantsColor;
  ctx.fillRect(-4, 0, 8, 24);
  ctx.fillStyle = pantsAccent;
  ctx.fillRect(-4, 12, 2, 8);
  // Shoe
  ctx.fillStyle = shoesColor;
  ctx.fillRect(-5, 24, 12, 8);
  ctx.fillStyle = shoesAccent;
  ctx.fillRect(-5, 29, 12, 3);
  ctx.restore();

  // Right Leg (Front)
  ctx.save();
  ctx.translate(8, 14 + bodyY);
  ctx.rotate(rightLegAngle);
  // Thigh & Shin (Pants)
  ctx.fillStyle = pantsColor;
  ctx.fillRect(-4, 0, 8, 24);
  ctx.fillStyle = pantsAccent;
  ctx.fillRect(2, 12, 2, 8);
  // Shoe
  ctx.fillStyle = shoesColor;
  ctx.fillRect(-5, 24, 12, 8);
  ctx.fillStyle = shoesAccent;
  ctx.fillRect(-5, 29, 12, 3);
  ctx.restore();

  // 5. Torso & Shirt
  const shirtColor = fabric(ctx, shirt, '#1e293b', frame);
  const shirtAccent = shirt?.accentColor || '#00f0ff';

  ctx.save();
  ctx.translate(0, bodyY);

  // Neck (Skin tone)
  ctx.fillStyle = skin.shadow;
  ctx.fillRect(-5, -20, 10, 8);

  // Main Torso Block (Athletic tapered shape)
  ctx.fillStyle = shirtColor;
  ctx.beginPath();
  if (avatar.gender === 'female') {
    // Slightly more tapered waist
    ctx.moveTo(-13, -15);
    ctx.lineTo(13, -15);
    ctx.lineTo(10, 15);
    ctx.lineTo(-10, 15);
  } else {
    // Athletic straight / broad shoulders
    ctx.moveTo(-15, -15);
    ctx.lineTo(15, -15);
    ctx.lineTo(12, 15);
    ctx.lineTo(-12, 15);
  }
  ctx.closePath();
  ctx.fill();

  // Shirt Details / Accent Lines
  ctx.fillStyle = shirtAccent;
  ctx.fillRect(-2, -14, 4, 28);
  ctx.fillRect(-12, -14, 24, 3);

  // Left Arm (Back)
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

  // Draw Left Arm
  ctx.save();
  ctx.translate(-14, -12);
  ctx.rotate(leftArmAngle);
  ctx.fillStyle = shirtColor;
  ctx.fillRect(-4, 0, 7, 14); // sleeve
  ctx.fillStyle = skin.color;
  ctx.fillRect(-3, 14, 5, 12); // forearm & hand
  ctx.restore();

  // Draw Right Arm (Front)
  ctx.save();
  ctx.translate(14, -12);
  ctx.rotate(rightArmAngle);
  ctx.fillStyle = shirtColor;
  ctx.fillRect(-3, 0, 7, 14); // sleeve
  ctx.fillStyle = skin.color;
  ctx.fillRect(-2, 14, 5, 12); // forearm & hand
  if (action === 'peace') {
    // V sign: two splayed fingers past the hand.
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

  // 6. Head & Face
  ctx.translate(0, -32);

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
    // Big open smile
    ctx.beginPath();
    ctx.arc(0, 5, 4, 0, Math.PI);
    ctx.fill();
  } else {
    // Confident smirk
    ctx.fillRect(-3, 6, 7, 1.5);
  }

  // 7. Hair Styles
  ctx.fillStyle = hairColor.color;
  const hairStyle = findItem(avatar.hairStyleId)?.model ?? avatar.hairStyleId;

  if (hairStyle === 'hair_short_fade') {
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
    // Front fringe
    ctx.fillRect(-12, -14, 24, 7);
  } else if (hairStyle === 'hair_spiky_punk') {
    // Spikes pointing up/back
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
    // Swept bangs + high ponytail on back
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 0.8, Math.PI * 2.2);
    ctx.fill();
    // Ponytail plume
    ctx.beginPath();
    ctx.moveTo(-8, -14);
    ctx.quadraticCurveTo(-24, -20, -22, 4);
    ctx.quadraticCurveTo(-14, -6, -4, -10);
    ctx.fill();
  } else if (hairStyle === 'hair_waves') {
    // Longer flowing locks
    ctx.beginPath();
    ctx.arc(0, -6, 15, Math.PI * 0.85, Math.PI * 2.15);
    ctx.fill();
    ctx.fillRect(-15, -6, 6, 26);
    ctx.fillRect(9, -6, 6, 26);
  } else if (hairStyle === 'hair_afro_puff') {
    // Dual sculpted puffs
    ctx.beginPath();
    ctx.arc(-11, -12, 10, 0, Math.PI * 2);
    ctx.arc(11, -12, 10, 0, Math.PI * 2);
    ctx.fill();
  } else if (hairStyle === 'hair_neon_mohawk') {
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-5, -14);
    ctx.lineTo(-3, -30);
    ctx.lineTo(2, -24);
    ctx.lineTo(4, -33);
    ctx.lineTo(7, -22);
    ctx.lineTo(5, -14);
    ctx.closePath();
    ctx.fill();
  } else if (hairStyle === 'hair_space_buns') {
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-11, -18, 7, 0, Math.PI * 2);
    ctx.arc(11, -18, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-12, -14, 20, 6);
  } else if (hairStyle === 'hair_cyber_undercut') {
    ctx.beginPath();
    ctx.moveTo(-14, -4);
    ctx.lineTo(-8, -22);
    ctx.lineTo(12, -18);
    ctx.lineTo(14, -2);
    ctx.closePath();
    ctx.fill();
    // Glow streak
    ctx.fillStyle = hairColor.highlight;
    ctx.fillRect(-6, -20, 16, 3);
  } else {
    // Default neat crop
    ctx.beginPath();
    ctx.arc(0, -6, 14.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
  }

  // 8. Eyewear (Over eyes, before hat)
  const eyeShape = itemShape(eyewear);
  if (eyewear && eyewear.id !== 'none') {
    ctx.save();
    if (eyeShape === 'eyewear_pixel_shades') {
      ctx.fillStyle = eyewear.color && eyewear.id !== 'eyewear_pixel_shades' ? eyewear.color : '#09090b';
      ctx.fillRect(-10, -5, 20, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-8, -4, 2, 2);
      ctx.fillRect(2, -4, 2, 2);
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
    } else if (eyeShape === 'eyewear_speed_shades') {
      ctx.fillStyle = fabric(ctx, eyewear, eyewear.color || '#ffb800', frame);
      ctx.beginPath();
      ctx.moveTo(-11, -5);
      ctx.lineTo(11, -5);
      ctx.lineTo(9, 1);
      ctx.lineTo(-9, 1);
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
      const capColor = headwear.color || '#0f172a';
      const capAccent = headwear.accentColor || '#00f0ff';
      ctx.fillStyle = capColor;
      // Cap dome
      ctx.beginPath();
      ctx.arc(0, -10, 15, Math.PI, Math.PI * 2);
      ctx.fill();
      // Backwards brim
      ctx.fillStyle = capAccent;
      ctx.fillRect(-18, -12, 10, 4);
    } else if (hatShape === 'headwear_neon_band') {
      ctx.fillStyle = headwear.color || '#ff0055';
      ctx.fillRect(-14, -8, 28, 5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-6, -7, 12, 2);
    } else if (hatShape === 'headwear_beanie') {
      ctx.fillStyle = headwear.color || '#334155';
      ctx.beginPath();
      ctx.arc(0, -11, 15.5, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-15, -12, 30, 6);
      if (headwear.accentColor) {
        ctx.fillStyle = headwear.accentColor;
        ctx.beginPath();
        ctx.arc(0, -27, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (hatShape === 'headwear_cyber_visor') {
      ctx.fillStyle = headwear.color || '#09090b';
      ctx.fillRect(-15, -14, 30, 8);
      ctx.fillStyle = '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 8;
      ctx.fillRect(-13, -11, 26, 3);
    } else if (hatShape === 'headwear_crown') {
      ctx.fillStyle = headwear.color || '#ffb800';
      ctx.shadowColor = headwear.color === '#1e1b2e' ? headwear.accentColor || '#ef4444' : headwear.color || '#ffb800';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(-12, -14);
      ctx.lineTo(-14, -25);
      ctx.lineTo(-6, -18);
      ctx.lineTo(0, -28);
      ctx.lineTo(6, -18);
      ctx.lineTo(14, -25);
      ctx.lineTo(12, -14);
      ctx.closePath();
      ctx.fill();
      // Ruby jewel
      ctx.fillStyle = headwear.accentColor && headwear.accentColor !== '#ffffff' ? headwear.accentColor : '#ff0055';
      ctx.beginPath();
      ctx.arc(0, -17, 2.5, 0, Math.PI * 2);
      ctx.fill();
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
        ctx.fillStyle = headwear.accentColor || '#e879f9';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.fillRect(x - 1, -4, 2, 8);
        ctx.shadowBlur = 0;
      });
    }
    ctx.restore();
  }

  ctx.restore(); // restore torso & head
  ctx.restore(); // restore root scale & translate
}
