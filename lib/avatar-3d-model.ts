import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { AvatarConfig } from './avatar-types';
import { SKIN_TONES, HAIR_COLORS, COSMETICS_CATALOG, findItem, itemFinish, itemShape } from './cosmetics-catalog';
import type { CosmeticItem, ItemFinish } from './avatar-types';
import { patternCanvas } from './item-patterns';
import { topLook, bottomLook, shoeLook } from './item-looks';

/** Surface parameters for each finish (matte cotton … holographic foil). */
function finishParams(finish: ItemFinish, item?: CosmeticItem): THREE.MeshPhysicalMaterialParameters {
  switch (finish) {
    case 'gloss':
      return { roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15 };
    case 'metal':
      return { roughness: 0.32, metalness: 0.65, clearcoat: 0.4 };
    case 'chrome':
      return { roughness: 0.1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.05 };
    case 'neon':
      return { roughness: 0.35, emissive: new THREE.Color(item?.accentColor ?? item?.color ?? '#ffffff'), emissiveIntensity: 0.35 };
    case 'holo':
      return {
        roughness: 0.18,
        metalness: 0.55,
        iridescence: 1,
        iridescenceIOR: 1.8,
        iridescenceThicknessRange: [180, 820],
        clearcoat: 1,
        emissive: new THREE.Color(item?.palette?.[1] ?? item?.accentColor ?? '#ffffff'),
        emissiveIntensity: 0.12,
      };
    default:
      return {};
  }
}

export type AvatarAction = 'idle' | 'run' | 'jump' | 'slide' | 'shoot' | 'celebrate';

/** A flat label texture (shirt numbers). */
function labelTexture(text: string, fg: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d');
  if (!g) return null;
  g.font = '900 80px system-ui, Arial Black, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.strokeText(text, 64, 52);
  g.fillStyle = fg;
  g.fillText(text, 64, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Avatar3DInstance {
  group: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  head: THREE.Group;
  torso: THREE.Mesh;
  wings?: THREE.Group;
  trailParticles?: THREE.Points;
  /**
   * Pose the avatar for this frame. Pass `dt` (seconds) to get smooth blending between poses
   * and to let triggered one-shot actions play out; omit it for an instant snap (legacy).
   */
  updateAnimation: (time: number, action: AvatarAction, dt?: number) => void;
  /** Play a one-shot action (e.g. 'shoot', 'celebrate') over the base action for `seconds`. */
  trigger: (action: AvatarAction, seconds?: number) => void;
  dispose: () => void;
}

export function create3DAvatar(avatar: AvatarConfig): Avatar3DInstance {
  const root = new THREE.Group();

  const skin = SKIN_TONES.find((s) => s.id === avatar.skinToneId) || SKIN_TONES[0];
  const hairColor = HAIR_COLORS.find((h) => h.id === avatar.hairColorId) || HAIR_COLORS[0];
  const shirt = COSMETICS_CATALOG.find((c) => c.id === avatar.shirtId);
  const pants = COSMETICS_CATALOG.find((c) => c.id === avatar.pantsId);
  const shoes = COSMETICS_CATALOG.find((c) => c.id === avatar.shoesId);
  const headwear = COSMETICS_CATALOG.find((c) => c.id === avatar.headwearId);
  const eyewear = COSMETICS_CATALOG.find((c) => c.id === avatar.eyewearId);
  const back = COSMETICS_CATALOG.find((c) => c.id === avatar.backId);

  // Materials
  // Physical skin: soft sheen fakes the light-scatter of real skin without a subsurface pass.
  const skinMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(skin.color),
    roughness: 0.48,
    metalness: 0,
    sheen: 0.6,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(skin.color).lerp(new THREE.Color(0xff9a7a), 0.5),
    clearcoat: 0.08,
    clearcoatRoughness: 0.6,
  });

  const hairMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hairColor.color),
    roughness: 0.42,
    metalness: 0.05,
    sheen: 1,
    sheenRoughness: 0.3,
    sheenColor: new THREE.Color(hairColor.color).offsetHSL(0, 0, 0.25),
  });

  // Fabric: sheen gives cloth its soft rim instead of a plastic highlight.
  const shirtMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(shirt?.color || '#1e293b'),
    roughness: 0.72,
    metalness: 0,
    sheen: 0.8,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(shirt?.color || '#1e293b').offsetHSL(0, 0, 0.3),
  });

  const shirtAccentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(shirt?.accentColor || '#00f0ff'),
    roughness: 0.4,
    metalness: 0.2,
    emissive: new THREE.Color(shirt?.accentColor || '#00f0ff'),
    emissiveIntensity: 0.35,
  });

  const pantsMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(pants?.color || '#0f172a'),
    roughness: 0.8,
    metalness: 0,
    sheen: 0.7,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(pants?.color || '#0f172a').offsetHSL(0, 0, 0.25),
  });

  const shoesMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(shoes?.color || '#ffffff'),
    roughness: 0.35,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  });

  const shoesAccentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(shoes?.accentColor || '#00f0ff'),
    roughness: 0.3,
    emissive: new THREE.Color(shoes?.accentColor || '#00f0ff'),
    emissiveIntensity: 0.4,
  });

  // Prints (camo, flames, circuit…) and finishes (chrome, holo…) on clothing.
  const dress = (mat: THREE.MeshPhysicalMaterial, item: CosmeticItem | undefined, repeat: [number, number]) => {
    if (!item) return;
    const f = itemFinish(item);
    const swatch = patternCanvas(item);
    if (f !== 'matte') {
      mat.setValues(finishParams(f, item));
      if (f !== 'neon' && f !== 'holo') mat.sheen = 0.2;
      // Chrome reads as polished metal, not a dark mirror; printed chrome keeps its print legible.
      if (f === 'chrome') mat.setValues({ envMapIntensity: 2.4, metalness: swatch ? 0.55 : 0.85, roughness: swatch ? 0.25 : 0.14 });
    }
    if (swatch) {
      const tex = new THREE.CanvasTexture(swatch);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(...repeat);
      tex.anisotropy = 4;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.sheenColor.set(0x888888);
      // Neon prints glow in their own colours instead of a single wash over the garment.
      if (f === 'neon') mat.setValues({ emissive: new THREE.Color(0xffffff), emissiveMap: tex, emissiveIntensity: 0.3 });
      disposables.push(tex);
    }
    mat.needsUpdate = true;
  };

  // Track all disposables
  const disposables: { dispose: () => void }[] = [
    skinMat,
    hairMat,
    shirtMat,
    shirtAccentMat,
    pantsMat,
    shoesMat,
    shoesAccentMat,
  ];
  dress(shirtMat, shirt, [1.6, 1]);
  dress(pantsMat, pants, [0.8, 1.4]);
  if (shoes && itemFinish(shoes) !== 'matte') shoesMat.setValues(finishParams(itemFinish(shoes), shoes));
  // Printed uppers (magma cracks): the print glows through.
  const shoeSwatch = shoes ? patternCanvas(shoes) : null;
  if (shoeSwatch) {
    const tex = new THREE.CanvasTexture(shoeSwatch);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.2, 1.2);
    shoesMat.map = tex;
    shoesMat.emissiveMap = tex;
    shoesMat.emissive = new THREE.Color(0xffffff);
    shoesMat.emissiveIntensity = 0.6;
    shoesMat.color.set(0xffffff);
    disposables.push(tex);
  }

  // Small helpers so every new geometry/material is tracked for disposal.
  const track = <T extends { dispose: () => void }>(r: T): T => {
    disposables.push(r);
    return r;
  };
  const std = (color: string | number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    track(new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.5, metalness: 0.2, ...extra }));
  const glow = (color: string | number, intensity = 0.9) =>
    std(color, { emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 0.25 });
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    track(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  };

  // Body frame by character base: broader shoulders (male), narrower waist + hips (female).
  const frame =
    avatar.gender === 'male'
      ? { shoulder: 0.36, waist: 0.27, arm: 0.4, hip: 0 }
      : avatar.gender === 'female'
      ? { shoulder: 0.29, waist: 0.23, arm: 0.33, hip: 0.27 }
      : { shoulder: 0.32, waist: 0.26, arm: 0.36, hip: 0 };

  // 1. Torso
  const torsoGeo = new THREE.CylinderGeometry(frame.shoulder, frame.waist, 0.72, 28, 3);
  const torso = new THREE.Mesh(torsoGeo, shirtMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  root.add(torso);
  disposables.push(torsoGeo);

  if (frame.hip) {
    const hips = mesh(new THREE.CylinderGeometry(frame.waist + 0.01, frame.hip, 0.22, 28), pantsMat);
    hips.position.y = -0.42;
    torso.add(hips);
  }

  const top = topLook(shirt);
  const bottom = bottomLook(pants);
  const shoeL = shoeLook(shoes);
  // Torso surface: radius at height y (torso-local, -0.36 … 0.36) and the slope of its side.
  const TH = 0.36;
  const radiusAt = (y: number) => frame.waist + ((frame.shoulder - frame.waist) * (y + TH)) / (TH * 2);
  const tilt = Math.atan((frame.shoulder - frame.waist) / (TH * 2));
  /** Stick a detail flat onto the torso's front (or back) surface at height y, offset x. */
  const onTorso = (m: THREE.Object3D, y: number, x = 0, lift = 0.006, backSide = false) => {
    const r = radiusAt(y);
    const z = Math.sqrt(Math.max(0, r * r - x * x)) + lift;
    m.position.set(x, y, backSide ? -z : z);
    m.rotation.set(backSide ? -tilt : tilt, Math.atan2(x, Math.max(0.01, z)) * (backSide ? -1 : 1), 0);
    torso.add(m);
    return m;
  };
  const accentHex = shirt?.accentColor || '#00f0ff';

  // Torso accent stripe (only on tops that have one)
  if (top.stripe) {
    // A band that hugs the torso front and back (so chest prints can sit on top of it).
    [0, Math.PI].forEach((rot) => {
      const stripe = mesh(new THREE.CylinderGeometry(frame.shoulder + 0.004, frame.waist + 0.004, 0.72, 4, 1, true, -0.17, 0.34), shirtAccentMat);
      (stripe.material as THREE.Material).side = THREE.DoubleSide;
      stripe.rotation.y = rot;
      torso.add(stripe);
    });
  }

  // 2. Head Group
  const head = new THREE.Group();
  head.position.y = 0.54; // pivot above torso
  torso.add(head);

  // Head sphere
  const headGeo = new THREE.SphereGeometry(0.24, 40, 28);
  const headMesh = new THREE.Mesh(headGeo, skinMat);
  headMesh.castShadow = true;
  head.add(headMesh);
  disposables.push(headGeo);

  // Eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(avatar.eyeColor || '#00f0ff') });
  disposables.push(eyeMat, pupilMat);

  const eyeGeo = new THREE.BoxGeometry(0.06, 0.05, 0.04);
  const pupilGeo = new THREE.BoxGeometry(0.03, 0.03, 0.05);
  disposables.push(eyeGeo, pupilGeo);

  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.08, 0.04, 0.22);
  const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
  leftPupil.position.set(-0.08, 0.04, 0.23);
  head.add(leftEye, leftPupil);

  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.08, 0.04, 0.22);
  const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
  rightPupil.position.set(0.08, 0.04, 0.23);
  head.add(rightEye, rightPupil);

  // Mouth: a small smile so the face reads as a character, not a mannequin.
  const mouth = new THREE.Mesh(track(new THREE.TorusGeometry(0.04, 0.009, 6, 16, Math.PI)), track(new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.6 })));
  mouth.position.set(0, -0.075, 0.228);
  mouth.rotation.set(0.15, 0, Math.PI);
  head.add(mouth);

  // Hair 3D Geometry based on hairStyleId
  const hairGroup = new THREE.Group();
  head.add(hairGroup);

  const capGeo = (r: number, cover = 0.55) => new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI * cover);
  const hs = findItem(avatar.hairStyleId)?.model ?? avatar.hairStyleId;
  if (hs === 'hair_spiky_punk') {
    const coneGeo = track(new THREE.ConeGeometry(0.09, 0.26, 5));
    for (let i = 0; i < 7; i++) {
      const spike = new THREE.Mesh(coneGeo, hairMat);
      const angle = (i / 7) * Math.PI - Math.PI / 2;
      spike.position.set(Math.sin(angle) * 0.18, 0.16 + Math.cos(angle) * 0.06, Math.cos(angle) * 0.1);
      spike.rotation.z = -angle * 0.6;
      spike.rotation.x = -0.3;
      hairGroup.add(spike);
    }
  } else if (hs === 'hair_high_pony') {
    // High tie + a long plume swinging out behind, and swept bangs.
    const tie = mesh(new THREE.TorusGeometry(0.05, 0.018, 8, 16), glow('#f472b6', 0.6));
    tie.position.set(0, 0.25, -0.17);
    tie.rotation.x = 0.9;
    const knot = mesh(new THREE.SphereGeometry(0.075, 12, 10), hairMat);
    knot.position.set(0, 0.27, -0.2);
    const tail = mesh(new THREE.CapsuleGeometry(0.09, 0.34, 6, 12), hairMat);
    tail.position.set(0, 0.12, -0.42);
    tail.rotation.set(-1.0, 0, 0);
    const tip = mesh(new THREE.ConeGeometry(0.085, 0.26, 10), hairMat);
    tip.position.set(0, -0.08, -0.6);
    tip.rotation.set(Math.PI - 0.6, 0, 0);
    const cap = mesh(capGeo(0.25, 0.5), hairMat);
    cap.position.y = 0.085;
    const bangs = mesh(new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI, 0, Math.PI * 0.5), hairMat);
    bangs.position.set(-0.04, 0.17, 0.11);
    bangs.rotation.set(-0.9, -0.3, 0.5);
    bangs.scale.set(1, 0.5, 0.8);
    hairGroup.add(tie, knot, tail, tip, cap, bangs);
  } else if (hs === 'hair_waves') {
    const cap = mesh(capGeo(0.262, 0.5), hairMat);
    cap.position.y = 0.085;
    hairGroup.add(cap);
    // Shoulder-length curtains with a wavy edge, and a back panel.
    const curtainGeo = track(new THREE.CapsuleGeometry(0.075, 0.3, 6, 12));
    [-1, 1].forEach((side) => {
      for (let k = 0; k < 2; k++) {
        const c = new THREE.Mesh(curtainGeo, hairMat);
        c.position.set(side * (0.215 - k * 0.02), -0.08 - k * 0.04, -0.03 - k * 0.11);
        c.rotation.z = side * (0.12 + k * 0.08);
        c.scale.set(0.75, 1, 0.9);
        c.castShadow = true;
        hairGroup.add(c);
      }
    });
    const backPanel = mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.34, 18, 1, true, Math.PI * 0.6, Math.PI * 0.8), hairMat);
    (backPanel.material as THREE.Material).side = THREE.DoubleSide;
    backPanel.position.set(0, -0.08, 0);
    hairGroup.add(backPanel);
    const ridgeGeo = track(new THREE.TorusGeometry(0.2, 0.022, 6, 24, Math.PI));
    for (let i = 0; i < 3; i++) {
      const ridge = new THREE.Mesh(ridgeGeo, hairMat);
      ridge.rotation.y = Math.PI / 2;
      ridge.position.set(0, 0.08 + i * 0.045, 0);
      ridge.scale.setScalar(1.15 - i * 0.18);
      hairGroup.add(ridge);
    }
  } else if (hs === 'hair_afro_puff') {
    // Dual sculpted puffs on a tight base.
    const base = mesh(capGeo(0.255, 0.5), hairMat);
    base.position.y = 0.085;
    const puffGeo = track(new THREE.IcosahedronGeometry(0.17, 2));
    [-1, 1].forEach((side) => {
      const puff = new THREE.Mesh(puffGeo, hairMat);
      puff.position.set(side * 0.17, 0.27, -0.03);
      puff.castShadow = true;
      hairGroup.add(puff);
    });
    hairGroup.add(base);
  } else if (hs === 'hair_cyber_undercut') {
    // Shaved sides (skin-tight cap) + swept top slab
    const sides = mesh(capGeo(0.248, 0.5), hairMat);
    sides.position.y = 0.075;
    sides.scale.set(1, 0.6, 1);
    const crest = mesh(new THREE.BoxGeometry(0.2, 0.1, 0.42), hairMat);
    crest.position.set(0.03, 0.22, 0.02);
    crest.rotation.z = -0.25;
    hairGroup.add(sides, crest);
    // Neon circuitry shaved into the side.
    const circuit = glow(hairColor.highlight, 1.6);
    const lineGeo = track(new THREE.BoxGeometry(0.008, 0.008, 0.12));
    [[0.055, 0], [0.09, 0.05], [0.02, -0.06]].forEach(([y, z]) => {
      const l = new THREE.Mesh(lineGeo, circuit);
      l.position.set(-0.247, y, z);
      hairGroup.add(l);
    });
    const dot = mesh(new THREE.SphereGeometry(0.012, 6, 6), circuit);
    dot.position.set(-0.247, 0.09, 0.11);
    hairGroup.add(dot);
  } else if (hs === 'hair_neon_mohawk') {
    const sides = mesh(capGeo(0.25, 0.5), hairMat);
    sides.position.y = 0.08;
    sides.scale.set(1, 0.5, 1);
    const finGeo = track(new THREE.ConeGeometry(0.05, 0.22, 4));
    for (let i = 0; i < 6; i++) {
      const fin = new THREE.Mesh(finGeo, hairMat);
      const z = 0.16 - i * 0.075;
      fin.position.set(0, 0.27 - Math.abs(i - 2) * 0.015, z);
      fin.rotation.x = -0.25 - i * 0.12;
      fin.scale.set(0.7, 1.1 - Math.abs(i - 2) * 0.08, 1.6);
      hairGroup.add(fin);
    }
    hairGroup.add(sides);
  } else if (hs === 'hair_space_buns') {
    const cap = mesh(capGeo(0.258, 0.5), hairMat);
    cap.position.y = 0.085;
    const bunGeo = track(new THREE.SphereGeometry(0.115, 18, 12));
    const wrapGeo = track(new THREE.TorusGeometry(0.105, 0.018, 8, 24));
    [-1, 1].forEach((side) => {
      const bun = new THREE.Mesh(bunGeo, hairMat);
      bun.position.set(side * 0.15, 0.32, -0.03);
      const wrap = new THREE.Mesh(wrapGeo, hairMat);
      wrap.position.set(side * 0.145, 0.26, -0.03);
      wrap.rotation.set(Math.PI / 2, 0, side * 0.5);
      // orbit ring
      const ring = new THREE.Mesh(track(new THREE.TorusGeometry(0.15, 0.006, 6, 32)), glow(hairColor.highlight, 1.2));
      ring.position.copy(bun.position);
      ring.rotation.set(1.2, 0, side * 0.4);
      hairGroup.add(bun, wrap, ring);
    });
    const fringe = mesh(new THREE.BoxGeometry(0.3, 0.06, 0.06), hairMat);
    fringe.position.set(0, 0.17, 0.2);
    fringe.rotation.x = 0.4;
    hairGroup.add(cap, fringe);
  } else if (hs === 'hair_dreadlocks') {
    const cap = mesh(capGeo(0.26, 0.5), hairMat);
    cap.position.y = 0.085;
    hairGroup.add(cap);
    // Locs falling from the crown past the ears to the shoulders, tipped with alloy bands.
    // Locs: rope-textured strands (stacked beads) falling ear to ear round the back, each tipped
    // with a polished alloy band.
    const beadGeo = track(new THREE.SphereGeometry(0.036, 8, 6));
    const bandGeo = track(new THREE.CylinderGeometry(0.038, 0.038, 0.04, 12));
    const alloy = std('#fbbf24', { metalness: 1, roughness: 0.15 });
    for (let i = 0; i < 13; i++) {
      const ang = -Math.PI * 0.12 + (i / 12) * Math.PI * 1.24; // ear to ear, round the back
      const r = 0.262;
      const beads = 7 + (i % 3);
      const dx = Math.cos(ang);
      const dz = -Math.sin(ang);
      for (let k = 0; k < beads; k++) {
        const b = new THREE.Mesh(beadGeo, hairMat);
        const out = r + 0.012 * k;
        b.position.set(dx * out, 0.06 - k * 0.058, dz * out);
        b.scale.set(1, 1.25, 1);
        b.castShadow = true;
        hairGroup.add(b);
      }
      const band = new THREE.Mesh(bandGeo, alloy);
      const out = r + 0.012 * beads;
      band.position.set(dx * out, 0.06 - beads * 0.058 + 0.02, dz * out);
      hairGroup.add(band);
    }
    // a couple of locs tied up on top
    const topKnot = mesh(new THREE.SphereGeometry(0.1, 12, 10), hairMat);
    topKnot.position.set(0, 0.33, -0.08);
    hairGroup.add(topKnot);
  } else {
    // hair_short_fade (default): neat crop
    const crop = mesh(capGeo(0.26, 0.5), hairMat);
    crop.position.y = 0.085;
    hairGroup.add(crop);
  }

  // Headwear 3D
  if (headwear && headwear.id !== 'none') {
    const hw = itemShape(headwear);
    const hwFinish = finishParams(itemFinish(headwear), headwear);
    if (hw === 'headwear_snapback') {
      const crownMat = std(headwear.color || '#0f172a', { roughness: 0.6, metalness: 0 });
      const swatch = patternCanvas(headwear);
      if (swatch) {
        const tex = track(new THREE.CanvasTexture(swatch));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 1);
        crownMat.map = tex;
        crownMat.color.set(0xffffff);
        crownMat.emissive = new THREE.Color(headwear.accentColor || '#f97316');
        crownMat.emissiveMap = tex;
        crownMat.emissiveIntensity = 0.35;
      }
      const accentMat = std(headwear.accentColor || '#00f0ff', { roughness: 0.4, metalness: 0 });
      const cap = mesh(new THREE.SphereGeometry(0.272, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), crownMat);
      cap.position.y = 0.095;
      cap.scale.set(1, 0.92, 1.03);
      // Flat brim, worn backwards.
      const brimShape = new THREE.Shape();
      brimShape.absarc(0, 0, 0.2, 0, Math.PI, false);
      brimShape.lineTo(-0.2, 0);
      const brim = mesh(new THREE.ExtrudeGeometry(brimShape, { depth: 0.025, bevelEnabled: false }), accentMat);
      brim.rotation.x = -Math.PI / 2;
      brim.position.set(0, 0.11, -0.2);
      brim.scale.set(1.1, 1.35, 1);
      // Top button and panel seams.
      const button = mesh(new THREE.SphereGeometry(0.03, 10, 8), accentMat);
      button.position.y = 0.36;
      const seamGeo = track(new THREE.TorusGeometry(0.272, 0.005, 4, 24, Math.PI / 2));
      for (let k = 0; k < 3; k++) {
        const seam = new THREE.Mesh(seamGeo, accentMat);
        seam.rotation.set(0, (k * Math.PI) / 3, Math.PI / 2);
        seam.position.y = 0.095;
        seam.scale.set(0.92, 1, 1);
        head.add(seam);
      }
      // Snap strap arch over the forehead (it's on backwards) with the logo above it.
      const strap = mesh(new THREE.TorusGeometry(0.07, 0.016, 6, 16, Math.PI), accentMat);
      strap.position.set(0, 0.12, 0.262);
      strap.rotation.x = -0.2;
      head.add(cap, brim, button, strap);
    } else if (hw === 'headwear_beanie') {
      const knit = std(headwear.color || '#334155', { roughness: 0.9, metalness: 0 });
      const knitSwatch = patternCanvas(headwear);
      if (knitSwatch) {
        const tex = track(new THREE.CanvasTexture(knitSwatch));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 1);
        knit.map = tex;
        knit.color.set(0xffffff);
      }
      const dome = mesh(new THREE.SphereGeometry(0.275, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), knit);
      dome.position.y = 0.1;
      dome.scale.set(1, 1.18, 1);
      const cuff = mesh(new THREE.TorusGeometry(0.255, 0.04, 8, 28), knit);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = 0.11;
      const pom = mesh(new THREE.SphereGeometry(0.06, 8, 6), headwear.accentColor ? std(headwear.accentColor, { roughness: 0.95, metalness: 0 }) : knit);
      pom.position.y = 0.43;
      head.add(dome, cuff, pom);
    } else if (hw === 'headwear_neon_band') {
      const band = mesh(new THREE.TorusGeometry(0.255, 0.028, 8, 32), glow(headwear.color || '#ff0055', 1.4));
      band.rotation.x = Math.PI / 2 - 0.12;
      band.position.y = 0.11;
      head.add(band);
    } else if (hw === 'headwear_cyber_visor') {
      const visor = mesh(
        new THREE.CylinderGeometry(0.27, 0.27, 0.1, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
        std(headwear.color || '#09090b', { metalness: 0.8, roughness: 0.2, side: THREE.DoubleSide }),
      );
      visor.position.y = 0.06;
      const strip = mesh(new THREE.BoxGeometry(0.3, 0.02, 0.02), glow(headwear.accentColor || '#00f0ff', 1.6));
      strip.position.set(0, 0.06, 0.27);
      head.add(visor, strip);
    } else if (hw === 'headwear_crown') {
      const crownColor = headwear.color || '#ffb800';
      const gold = std(crownColor, { metalness: 0.85, roughness: 0.2, emissive: new THREE.Color(crownColor), emissiveIntensity: 0.25 });
      const gemMat = glow(headwear.accentColor || '#ffffff', 1.2);
      const gemGeo = track(new THREE.OctahedronGeometry(0.035, 0));
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const gem = new THREE.Mesh(gemGeo, gemMat);
        gem.position.set(Math.cos(ang) * 0.258, 0.26, Math.sin(ang) * 0.258);
        head.add(gem);
      }
      const crown = mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.12, 6, 1, true), gold);
      crown.position.y = 0.26;
      const pointGeo = track(new THREE.ConeGeometry(0.04, 0.1, 4));
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Mesh(pointGeo, gold);
        const ang = (i / 6) * Math.PI * 2;
        p.position.set(Math.cos(ang) * 0.25, 0.37, Math.sin(ang) * 0.25);
        head.add(p);
      }
      const crystal = mesh(new THREE.OctahedronGeometry(0.06, 0), glow(headwear.accentColor || '#ffffff', 1.4));
      crystal.scale.set(0.7, 1.3, 0.5);
      crystal.position.set(0, 0.33, 0.255);
      head.add(crown, crystal);
    } else if (hw === 'headwear_obsidian_crown') {
      // Jagged volcanic-glass shards of uneven height with blood-red gems.
      const glass = std(headwear.color || '#1e1b2e', { metalness: 0.9, roughness: 0.08 });
      const gemMat = glow(headwear.accentColor || '#ef4444', 1.8);
      const band = mesh(new THREE.CylinderGeometry(0.262, 0.25, 0.08, 9, 1, true), glass);
      (band.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      band.position.y = 0.23;
      head.add(band);
      const shardGeo = track(new THREE.ConeGeometry(0.05, 1, 4));
      const heights = [0.22, 0.12, 0.17, 0.1, 0.2, 0.11, 0.16, 0.09, 0.14];
      heights.forEach((h, k) => {
        const ang = (k / heights.length) * Math.PI * 2 + Math.PI / 2;
        const sh = new THREE.Mesh(shardGeo, glass);
        sh.scale.set(1, h, 0.7);
        sh.position.set(Math.cos(ang) * 0.255, 0.27 + h / 2, Math.sin(ang) * 0.255);
        sh.rotation.set(Math.sin(ang) * 0.25, 0, -Math.cos(ang) * 0.25);
        sh.castShadow = true;
        head.add(sh);
      });
      const gemGeo = track(new THREE.OctahedronGeometry(0.03, 0));
      [Math.PI / 2, Math.PI / 2 + 0.7, Math.PI / 2 - 0.7].forEach((ang, k) => {
        const gem = new THREE.Mesh(gemGeo, gemMat);
        gem.scale.setScalar(k ? 0.75 : 1.2);
        gem.position.set(Math.cos(ang) * 0.27, 0.235, Math.sin(ang) * 0.27);
        head.add(gem);
      });
    } else if (hw === 'headwear_seraph_halo') {
      const ring = mesh(new THREE.TorusGeometry(0.2, 0.025, 12, 48), glow(headwear.color || '#fde68a', 2.2));
      ring.rotation.x = Math.PI / 2 - 0.15;
      ring.position.y = 0.42;
      const inner = mesh(new THREE.TorusGeometry(0.2, 0.008, 6, 48), glow(headwear.accentColor || '#ffffff', 3));
      inner.rotation.x = Math.PI / 2 - 0.15;
      inner.position.y = 0.42;
      head.add(ring, inner);
    } else if (hw === 'headwear_bassline_cans') {
      const shell = std(headwear.color || '#18181b', { metalness: 0.5, roughness: 0.3 });
      const band = mesh(new THREE.TorusGeometry(0.27, 0.025, 8, 32, Math.PI), shell);
      band.position.y = 0.02;
      const cupGeo = track(new THREE.CylinderGeometry(0.095, 0.095, 0.07, 24));
      const ringGeo = track(new THREE.TorusGeometry(0.075, 0.014, 8, 24));
      const ringMat = glow(headwear.accentColor || '#e879f9', 1.8);
      [-1, 1].forEach((side) => {
        const cup = new THREE.Mesh(cupGeo, shell);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(side * 0.265, 0, 0);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(side * 0.302, 0, 0);
        head.add(cup, ring);
      });
      head.add(band);
    }
    // Chrome / holo finishes on hats and crowns.
    if (hwFinish.metalness || hwFinish.iridescence) {
      head.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && m !== skinMat && m !== hairMat && (m as THREE.Material & { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial && m.emissiveIntensity < 1) {
          m.metalness = Math.max(m.metalness, hwFinish.metalness ?? 0);
          m.roughness = Math.min(m.roughness, hwFinish.roughness ?? 1);
        }
      });
    }
  }

  // Eyewear 3D
  if (eyewear && eyewear.id !== 'none') {
    const ew = itemShape(eyewear);
    if (ew === 'eyewear_pixel_shades') {
      const black = std(eyewear.color || '#18181b', { roughness: 0.3, metalness: 0.4 });
      const lensGeo = track(new THREE.BoxGeometry(0.11, 0.07, 0.03));
      [-0.08, 0.08].forEach((x) => {
        const lens = new THREE.Mesh(lensGeo, black);
        lens.position.set(x, 0.04, 0.235);
        head.add(lens);
      });
      const bridge = mesh(new THREE.BoxGeometry(0.3, 0.025, 0.025), black);
      bridge.position.set(0, 0.065, 0.235);
      head.add(bridge);
    } else if (ew === 'eyewear_cyber_hud') {
      const hud = mesh(new THREE.BoxGeometry(0.13, 0.08, 0.015), glow(eyewear.color || '#00f0ff', 1.5));
      hud.position.set(0.08, 0.045, 0.25);
      const arm = mesh(new THREE.BoxGeometry(0.02, 0.02, 0.2), std('#1f2937', { metalness: 0.7 }));
      arm.position.set(0.18, 0.05, 0.15);
      head.add(hud, arm);
    } else if (ew === 'eyewear_round_specs') {
      const wire = std(eyewear.color || '#d4a017', { metalness: 0.9, roughness: 0.25 });
      const rimGeo = track(new THREE.TorusGeometry(0.05, 0.008, 8, 24));
      const glassMat = track(new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.9, roughness: 0.05, transparent: true, opacity: 0.25 }));
      const glassGeo = track(new THREE.CircleGeometry(0.048, 20));
      [-0.08, 0.08].forEach((x) => {
        const rim = new THREE.Mesh(rimGeo, wire);
        rim.position.set(x, 0.04, 0.245);
        const glass = new THREE.Mesh(glassGeo, glassMat);
        glass.position.set(x, 0.04, 0.244);
        head.add(rim, glass);
      });
      const bridge = mesh(new THREE.BoxGeometry(0.06, 0.008, 0.008), wire);
      bridge.position.set(0, 0.05, 0.25);
      head.add(bridge);
    } else if (ew === 'eyewear_ruby_shades') {
      // Chunky block frame, glowing ruby lenses, a white laser glint across each.
      const frameMat = std('#0a0a0a', { roughness: 0.35, metalness: 0.3 });
      const lensMat = glow(eyewear.color || '#dc2626', 1.1);
      const glintMat = glow('#ffffff', 2);
      const rimGeo = track(new RoundedBoxGeometry(0.13, 0.09, 0.03, 2, 0.01));
      const lensGeo = track(new THREE.BoxGeometry(0.1, 0.06, 0.012));
      const glintGeo = track(new THREE.BoxGeometry(0.075, 0.009, 0.004));
      [-0.085, 0.085].forEach((x) => {
        const rim = new THREE.Mesh(rimGeo, frameMat);
        rim.position.set(x, 0.04, 0.232);
        const lens = new THREE.Mesh(lensGeo, lensMat);
        lens.position.set(x, 0.04, 0.249);
        const glint = new THREE.Mesh(glintGeo, glintMat);
        glint.position.set(x, 0.045, 0.256);
        glint.rotation.z = 0.5;
        head.add(rim, lens, glint);
      });
      const bridge = mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), frameMat);
      bridge.position.set(0, 0.055, 0.236);
      head.add(bridge);
      [-1, 1].forEach((sx) => {
        const arm = mesh(new THREE.BoxGeometry(0.02, 0.025, 0.22), frameMat);
        arm.position.set(sx * 0.2, 0.05, 0.12);
        head.add(arm);
      });
    } else if (ew === 'eyewear_speed_shades') {
      // Aviators: teardrop mirror lenses in thin gold wire, double bridge.
      const wire = std('#d4a017', { metalness: 1, roughness: 0.2 });
      const mirror = track(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(eyewear.color || '#ffb800'), metalness: 1, roughness: 0.05, clearcoat: 1, emissive: new THREE.Color(eyewear.color || '#ffb800'), emissiveIntensity: 0.25 }));
      const drop = new THREE.Shape();
      drop.moveTo(-0.055, 0.03);
      drop.quadraticCurveTo(0, 0.045, 0.055, 0.03);
      drop.quadraticCurveTo(0.06, -0.04, 0.005, -0.05);
      drop.quadraticCurveTo(-0.06, -0.045, -0.055, 0.03);
      const lensGeo = track(new THREE.ExtrudeGeometry(drop, { depth: 0.01, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.004, bevelSegments: 2 }));
      [-1, 1].forEach((sx) => {
        const lens = new THREE.Mesh(lensGeo, mirror);
        lens.scale.set(sx, 1, 1);
        lens.position.set(sx * 0.082, 0.04, 0.235);
        head.add(lens);
        const arm = mesh(new THREE.BoxGeometry(0.008, 0.008, 0.22), wire);
        arm.position.set(sx * 0.17, 0.065, 0.13);
        head.add(arm);
      });
      [0.07, 0.05].forEach((y, k) => {
        const br = mesh(new THREE.BoxGeometry(k ? 0.05 : 0.06, 0.007, 0.007), wire);
        br.position.set(0, y, 0.25);
        head.add(br);
      });
    } else {
      // eyewear_prism_visor: wraparound band
      const fin = itemFinish(eyewear);
      const wrap = mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 0.07, 24, 1, true, -Math.PI * 0.35, Math.PI * 0.7),
        fin === 'holo'
          ? track(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(eyewear.color || '#c4b5fd'), ...finishParams('holo', eyewear), side: THREE.DoubleSide }))
          : glow(eyewear.color || '#ffb800', 0.8),
      );
      (wrap.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      wrap.position.y = 0.04;
      head.add(wrap);
    }
  }

  // 3. Arms (Pivot at shoulders)
  const armGeo = new THREE.CapsuleGeometry(0.075, 0.42, 6, 16); // rounded limbs, not hex prisms
  disposables.push(armGeo);

  const armMat = top.sleeves === 'long' ? shirtMat : skinMat;
  // Left Arm
  const leftArm = new THREE.Group();
  leftArm.position.set(-frame.arm, 0.26, 0);
  const leftArmMesh = new THREE.Mesh(armGeo, armMat);
  leftArmMesh.position.y = -0.25;
  leftArmMesh.castShadow = true;
  leftArm.add(leftArmMesh);
  torso.add(leftArm);

  // Right Arm
  const rightArm = new THREE.Group();
  rightArm.position.set(frame.arm, 0.26, 0);
  const rightArmMesh = new THREE.Mesh(armGeo, armMat);
  rightArmMesh.position.y = -0.25;
  rightArmMesh.castShadow = true;
  rightArm.add(rightArmMesh);
  torso.add(rightArm);

  // Hands
  const handGeo = track(new THREE.SphereGeometry(0.068, 16, 12));
  [leftArm, rightArm].forEach((arm) => {
    const hand = new THREE.Mesh(handGeo, skinMat);
    hand.position.y = -0.56;
    hand.scale.set(1, 1.15, 0.9);
    hand.castShadow = true;
    arm.add(hand);
  });

  // ---- Top: the details its name promises ----
  const accentGlow = glow(accentHex, 1.1);
  const trimMat = std(accentHex, { roughness: 0.7, metalness: 0 });
  if (top.sleeves === 'short') {
    const sleeveGeo = track(new THREE.CylinderGeometry(0.09, 0.098, 0.22, 18));
    [leftArm, rightArm].forEach((arm) => {
      const sl = new THREE.Mesh(sleeveGeo, shirtMat);
      sl.position.y = -0.07;
      sl.castShadow = true;
      const hem = new THREE.Mesh(track(new THREE.TorusGeometry(0.097, 0.012, 6, 20)), trimMat);
      hem.rotation.x = Math.PI / 2;
      hem.position.y = -0.18;
      arm.add(sl, hem);
    });
  } else if (top.sleeves === 'none') {
    // Sleeveless: a shoulder seam so the armhole reads.
    [-1, 1].forEach((sx) => {
      const seam = mesh(new THREE.TorusGeometry(0.085, 0.014, 6, 18), trimMat);
      seam.position.set(sx * (frame.arm - 0.02), 0.26, 0);
      seam.rotation.z = Math.PI / 2;
      torso.add(seam);
    });
  }
  if (top.bands) {
    const cuffGeo = track(new THREE.TorusGeometry(0.08, 0.022, 8, 20));
    [leftArm, rightArm].forEach((arm) => {
      const cuff = new THREE.Mesh(cuffGeo, trimMat);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.47;
      arm.add(cuff);
    });
    const hem = mesh(new THREE.TorusGeometry(frame.waist + 0.012, 0.03, 8, 32), trimMat);
    hem.rotation.x = Math.PI / 2;
    hem.position.y = -TH + 0.03;
    torso.add(hem);
  }
  if (top.collar === 'crew') {
    const c = mesh(new THREE.TorusGeometry(0.14, 0.022, 8, 28), trimMat);
    c.rotation.x = Math.PI / 2;
    c.position.y = TH;
    torso.add(c);
  } else if (top.collar === 'rib' || top.collar === 'varsity') {
    const c = mesh(new THREE.TorusGeometry(0.155, 0.045, 10, 28), trimMat);
    c.rotation.x = Math.PI / 2;
    c.position.y = TH + 0.01;
    torso.add(c);
    if (top.collar === 'varsity') {
      const st = mesh(new THREE.TorusGeometry(0.155, 0.047, 10, 28, Math.PI * 2), std(shirt?.color || '#cbd5e1', { roughness: 0.6 }));
      st.rotation.x = Math.PI / 2;
      st.position.y = TH + 0.01;
      st.scale.set(1.01, 1.01, 0.35);
      torso.add(st);
    }
  } else if (top.collar === 'high') {
    const c = mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.11, 24, 1, true), shirtMat);
    (c.material as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide;
    c.position.y = TH + 0.04;
    torso.add(c);
  }
  if (top.hood) {
    // Hood resting down around the neck and back.
    const roll = mesh(new THREE.TorusGeometry(0.17, 0.065, 10, 28), shirtMat);
    roll.rotation.x = Math.PI / 2;
    roll.position.set(0, TH + 0.02, -0.03);
    roll.scale.set(1.05, 1, 1);
    const bag = mesh(new THREE.SphereGeometry(0.19, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), shirtMat);
    bag.position.set(0, TH - 0.05, -0.17);
    bag.rotation.x = -2.2;
    bag.scale.set(1.05, 0.9, 0.75);
    const lining = mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 24), trimMat);
    lining.rotation.x = Math.PI / 2;
    lining.position.set(0, TH + 0.075, -0.04);
    torso.add(roll, bag, lining);
  }
  if (top.drawstrings) {
    const cord = std('#f8fafc', { roughness: 0.8, metalness: 0 });
    [-0.055, 0.055].forEach((x) => {
      const s1 = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), cord);
      onTorso(s1, TH - 0.12, x, 0.02);
      const tip = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.035, 6), trimMat);
      onTorso(tip, TH - 0.23, x, 0.022);
    });
  }
  if (top.zip) {
    const zip = mesh(new THREE.BoxGeometry(0.018, 0.68, 0.012), std('#e5e7eb', { metalness: 0.9, roughness: 0.25 }));
    onTorso(zip, 0, 0, 0.004);
    const pull = mesh(new THREE.BoxGeometry(0.03, 0.05, 0.012), std('#e5e7eb', { metalness: 0.9, roughness: 0.25 }));
    onTorso(pull, 0.22, 0, 0.012);
  }
  if (top.pocket) {
    const pk = mesh(new THREE.BoxGeometry(0.3, 0.15, 0.03), shirtMat);
    onTorso(pk, -0.2, 0, 0.004);
    const lip = mesh(new THREE.BoxGeometry(0.3, 0.012, 0.035), trimMat);
    onTorso(lip, -0.125, 0, 0.006);
  }
  if (top.chevron) {
    // handled by the colour-block print; add white piping between the blocks
  }
  if (top.seams) {
    const seamGeo = track(new THREE.BoxGeometry(0.014, 0.66, 0.01));
    [-0.12, 0.12].forEach((x) => onTorso(new THREE.Mesh(seamGeo, accentGlow), 0, x, 0.004));
    if (top.sleeves === 'long') {
      const armSeam = track(new THREE.BoxGeometry(0.012, 0.42, 0.012));
      [leftArm, rightArm].forEach((arm) => {
        const m = new THREE.Mesh(armSeam, accentGlow);
        m.position.set(0, -0.25, 0.078);
        arm.add(m);
      });
    }
  }
  if (top.coat) {
    const tail = mesh(new THREE.CylinderGeometry(frame.waist + 0.01, frame.waist + 0.13, 0.46, 28, 1, true), shirtMat);
    (tail.material as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide;
    tail.position.y = -TH - 0.22;
    torso.add(tail);
  }
  if (top.emblem) {
    const e = top.emblem;
    if (e.kind === 'number') {
      const tex = labelTexture(e.text, accentHex);
      if (tex) {
        disposables.push(tex);
        const mat = track(new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, emissive: new THREE.Color(accentHex), emissiveMap: tex, emissiveIntensity: 0.25 }));
        onTorso(new THREE.Mesh(track(new THREE.PlaneGeometry(0.28, 0.21)), mat), 0.06, 0, 0.012);
        onTorso(new THREE.Mesh(track(new THREE.PlaneGeometry(0.34, 0.25)), mat), 0.08, 0, 0.012, true).rotateY(Math.PI);
      }
    } else if (e.kind === 'crest') {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0.07);
      sh.lineTo(0.055, 0.05);
      sh.lineTo(0.045, -0.03);
      sh.lineTo(0, -0.07);
      sh.lineTo(-0.045, -0.03);
      sh.lineTo(-0.055, 0.05);
      sh.closePath();
      const crest = mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.004, bevelSegments: 1 }), std(accentHex, { metalness: 0.9, roughness: 0.2 }));
      onTorso(crest, 0.14, -0.1, 0.004);
    } else if (e.kind === 'diamond') {
      const d = mesh(new THREE.OctahedronGeometry(0.07, 0), glow(accentHex, 0.9));
      d.scale.set(0.8, 1.15, 0.25);
      onTorso(d, 0.08, 0, 0.012);
    } else if (e.kind === 'reactor') {
      const core = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 24), glow(accentHex, 2.2));
      core.rotation.x = Math.PI / 2;
      const ring = mesh(new THREE.TorusGeometry(0.095, 0.016, 8, 28), std('#cbd5e1', { metalness: 0.9, roughness: 0.2 }));
      const holder = new THREE.Group();
      holder.add(core, ring);
      onTorso(holder, 0.1, 0, 0.012);
    }
  }

  // 4. Legs (Pivot at hips)
  const legGeo = new THREE.CapsuleGeometry(0.085, 0.5, 6, 16);
  disposables.push(legGeo);
  const legMat = bottom.length === 'shorts' ? skinMat : pantsMat;
  const pantsAccentHex = pants?.accentColor || '#64748b';
  const makeLeg = (side: -1 | 1) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.16, 0.68, 0);
    const legMesh = new THREE.Mesh(legGeo, legMat);
    legMesh.position.y = -0.3;
    legMesh.castShadow = true;
    if (bottom.length === 'leggings') legMesh.scale.set(0.86, 1, 0.86);
    leg.add(legMesh);
    root.add(leg);
    return leg;
  };
  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  // ---- Bottoms ----
  const pantsTrim = std(pantsAccentHex, { roughness: 0.7, metalness: 0 });
  [leftLeg, rightLeg].forEach((leg, i) => {
    const out = i === 0 ? -1 : 1; // outer side of this leg
    if (bottom.length === 'shorts') {
      const short = mesh(new THREE.CylinderGeometry(0.11, 0.125, 0.3, 20), pantsMat);
      short.position.y = -0.1;
      const hem = mesh(new THREE.TorusGeometry(0.124, 0.012, 6, 20), pantsTrim);
      hem.rotation.x = Math.PI / 2;
      hem.position.y = -0.25;
      leg.add(short, hem);
      if (bottom.stripe) {
        const st = mesh(new THREE.BoxGeometry(0.02, 0.3, 0.05), glow(pantsAccentHex, 0.5));
        st.position.set(out * 0.118, -0.1, 0);
        leg.add(st);
      }
      return;
    }
    if (bottom.stripe) {
      const st = mesh(new THREE.BoxGeometry(0.02, 0.56, 0.05), glow(pantsAccentHex, 0.5));
      st.position.set(out * 0.088, -0.3, 0);
      leg.add(st);
    }
    if (bottom.cargo) {
      const pk = mesh(new RoundedBoxGeometry(0.05, 0.14, 0.12, 2, 0.015), pantsMat);
      pk.position.set(out * 0.095, -0.3, 0);
      const flap = mesh(new THREE.BoxGeometry(0.056, 0.03, 0.125), pantsTrim);
      flap.position.set(out * 0.097, -0.23, 0);
      leg.add(pk, flap);
    }
    if (bottom.cuffs) {
      const cuff = mesh(new THREE.TorusGeometry(0.088, 0.024, 8, 20), bottom.stitch ? std('#3b5bdb', { roughness: 0.9, metalness: 0 }) : pantsTrim);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.53;
      leg.add(cuff);
    }
    if (bottom.knees) {
      const plate = mesh(new RoundedBoxGeometry(0.13, 0.12, 0.05, 2, 0.02), std('#27272a', { metalness: 0.8, roughness: 0.25 }));
      plate.position.set(0, -0.32, 0.08);
      const light = mesh(new THREE.BoxGeometry(0.08, 0.014, 0.012), glow(pantsAccentHex, 1.8));
      light.position.set(0, -0.32, 0.108);
      leg.add(plate, light);
    }
    if (bottom.stitch) {
      const thread = glow(pantsAccentHex, 0.4);
      [out * 0.086, -out * 0.086].forEach((x) => {
        const st = mesh(new THREE.BoxGeometry(0.008, 0.5, 0.02), thread);
        st.position.set(x, -0.28, 0);
        leg.add(st);
      });
    }
    if (bottom.ankleGlow) {
      const ring = mesh(new THREE.TorusGeometry(0.09, 0.016, 8, 24), glow(pantsAccentHex, 2));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.52;
      leg.add(ring);
    }
  });

  // ---- Shoes ----
  const shoeAccentHex = shoes?.accentColor || '#00f0ff';
  if (shoeL.glowSole) {
    shoesAccentMat.emissiveIntensity = 1.1;
    shoesAccentMat.transparent = true;
    shoesAccentMat.opacity = 0.85;
  }
  const soleH = shoeL.chunky ? 0.07 : 0.035;
  const shoeGeo = track(new RoundedBoxGeometry(0.16, 0.12, 0.25, 3, 0.045));
  const soleGeo = track(new RoundedBoxGeometry(0.17, soleH, 0.26, 2, 0.015));
  [leftLeg, rightLeg].forEach((leg, i) => {
    const out = i === 0 ? -1 : 1;
    const lift = shoeL.chunky ? 0.03 : 0;
    const shoe = new THREE.Mesh(shoeGeo, shoesMat);
    shoe.position.set(0, -0.62 + lift, 0.04);
    shoe.castShadow = true;
    const sole = new THREE.Mesh(soleGeo, shoesAccentMat);
    sole.position.set(0, -0.69 + lift / 2 + (shoeL.chunky ? 0.005 : 0), 0.04);
    leg.add(shoe, sole);
    if (shoeL.height === 'high' || shoeL.height === 'boot') {
      const tall = shoeL.height === 'boot';
      const collar = mesh(new THREE.CylinderGeometry(tall ? 0.105 : 0.095, tall ? 0.1 : 0.09, tall ? 0.26 : 0.13, 20), shoesMat);
      collar.position.set(0, tall ? -0.46 + lift : -0.53, 0);
      leg.add(collar);
      const band = mesh(new THREE.TorusGeometry(tall ? 0.106 : 0.096, 0.014, 6, 22), shoeL.rings ? glow(shoeAccentHex, 2) : shoesAccentMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = tall ? -0.34 + lift : -0.47;
      leg.add(band);
      if (shoeL.rings) {
        const r2 = band.clone();
        r2.position.y = -0.46 + lift;
        leg.add(r2);
      }
    }
    if (shoeL.laces) {
      const lace = std(shoeL.laces, { roughness: 0.8, metalness: 0 });
      for (let k = 0; k < 3; k++) {
        const l = mesh(new THREE.BoxGeometry(0.1, 0.012, 0.016), lace);
        l.position.set(0, -0.555 + lift, 0.06 + k * 0.045);
        l.rotation.x = -0.5;
        leg.add(l);
      }
    }
    if (shoeL.toeCap) {
      const cap = mesh(new THREE.SphereGeometry(0.085, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(shoeL.toeCap, { roughness: 0.6, metalness: 0 }));
      cap.rotation.x = Math.PI / 2;
      cap.scale.set(1, 0.9, 0.75);
      cap.position.set(0, -0.63, 0.12);
      leg.add(cap);
    }
    if (shoeL.studs) {
      const studGeo = track(new THREE.ConeGeometry(0.016, 0.04, 6));
      const studMat = std('#fef3c7', { metalness: 1, roughness: 0.2 });
      for (const [x, z] of [[-0.05, -0.06], [0.05, -0.06], [-0.05, 0.06], [0.05, 0.06], [0, 0.14], [0, -0.04]]) {
        const st = new THREE.Mesh(studGeo, studMat);
        st.rotation.x = Math.PI;
        st.position.set(x, -0.725, 0.04 + z);
        leg.add(st);
      }
    }
    if (shoeL.swoosh) {
      const sw = mesh(new THREE.TorusGeometry(0.09, 0.009, 6, 20, Math.PI * 0.8), glow(shoeAccentHex, 1.8));
      sw.rotation.set(0, (out * Math.PI) / 2, Math.PI * 1.1);
      sw.position.set(out * 0.082, -0.6, 0.04);
      leg.add(sw);
    }
    if (shoeL.float) {
      const pad = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 28), track(new THREE.MeshBasicMaterial({ color: new THREE.Color(shoeAccentHex), transparent: true, opacity: 0.55, toneMapped: false })));
      pad.position.set(0, -0.78, 0.04);
      pad.scale.set(0.8, 1, 1.1);
      leg.add(pad);
      shoe.position.y += 0.04;
      sole.position.y += 0.04;
    }
  });

  // 5. Back Accessories (Wings, Katana, etc.)
  let wingsGroup: THREE.Group | undefined;
  const backShape = itemShape(back);
  if (back && (backShape === 'back_cyber_wings' || backShape === 'back_ember_wings')) {
    wingsGroup = new THREE.Group();
    wingsGroup.position.set(0, 0.1, -0.2);
    const hardLight = backShape === 'back_cyber_wings';
    const wingMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(back.color || '#00f0ff'),
      emissive: new THREE.Color(back.glowColor || back.color || '#00f0ff'),
      emissiveIntensity: hardLight ? 0.45 : 0.8,
      roughness: 0.2,
      metalness: 0.5,
      side: THREE.DoubleSide,
      transparent: hardLight,
      opacity: hardLight ? 0.55 : 1,
    });
    const tipMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(back.glowColor || back.color || '#ffffff'),
      emissive: new THREE.Color(back.glowColor || back.color || '#ffffff'),
      emissiveIntensity: 1.6,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    disposables.push(wingMat, tipMat);
    if (hardLight) {
      // Plasma Light Wings: three angular hard-light panels per side with bright edge struts.
      const panel = (pts: [number, number][]) => {
        const sh = new THREE.Shape();
        pts.forEach(([x, y], k) => (k ? sh.lineTo(x, y) : sh.moveTo(x, y)));
        sh.closePath();
        return track(new THREE.ShapeGeometry(sh));
      };
      const panels = [
        panel([[0, 0], [0.75, 0.62], [0.62, 0.18]]),
        panel([[0, -0.04], [0.68, 0.12], [0.5, -0.22]]),
        panel([[0, -0.08], [0.48, -0.3], [0.26, -0.4]]),
      ];
      const strutGeo = track(new THREE.BoxGeometry(0.02, 1, 0.02));
      [-1, 1].forEach((side) => {
        const wing = new THREE.Group();
        panels.forEach((g, k) => {
          const m = new THREE.Mesh(g, wingMat);
          m.position.z = -k * 0.012;
          wing.add(m);
        });
        // leading edges
        ([[0.75, 0.62], [0.68, 0.12], [0.48, -0.3]] as [number, number][]).forEach(([x, y]) => {
          const len = Math.hypot(x, y);
          const st = new THREE.Mesh(strutGeo, tipMat);
          st.scale.y = len;
          st.position.set(x / 2, y / 2, 0.005);
          st.rotation.z = Math.atan2(x, y) * -1;
          wing.add(st);
        });
        wing.scale.x = side;
        wing.position.x = side * 0.06;
        wing.rotation.y = side * 0.25;
        wingsGroup!.add(wing);
      });
    } else {
      // Ember Phoenix Wings: a fan of flame-tipped feathers, longest at the top.
      const feather = new THREE.Shape();
      feather.moveTo(0, 0);
      feather.quadraticCurveTo(0.16, 0.38, 0.02, 0.78);
      feather.quadraticCurveTo(-0.1, 0.4, 0, 0);
      const featherGeo = track(new THREE.ShapeGeometry(feather, 8));
      [-1, 1].forEach((side) => {
        const wing = new THREE.Group();
        for (let i = 0; i < 8; i++) {
          const blade = new THREE.Mesh(featherGeo, i % 3 === 0 ? tipMat : wingMat);
          const len = 1.35 - i * 0.11;
          blade.scale.set(1.2, len, 1);
          blade.rotation.z = side * -(0.55 + i * 0.2);
          blade.position.set(side * (0.04 + i * 0.035), 0.05 - i * 0.02, -i * 0.01);
          wing.add(blade);
        }
        wing.rotation.y = side * 0.25;
        wingsGroup!.add(wing);
      });
    }
    torso.add(wingsGroup);
  } else if (back && backShape === 'back_katana') {
    const katana = new THREE.Group();
    const blade = mesh(new THREE.BoxGeometry(0.055, 0.85, 0.016), std('#d1d5db', { metalness: 0.95, roughness: 0.15 }));
    blade.position.y = 0.1;
    const edge = mesh(new THREE.BoxGeometry(0.012, 0.85, 0.018), glow(back.accentColor || '#ff0055', 2));
    edge.position.set(0.032, 0.1, 0);
    const guard = mesh(new THREE.BoxGeometry(0.1, 0.02, 0.05), std('#111827', { metalness: 0.6 }));
    guard.position.y = -0.33;
    const grip = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), std(back.color || '#09090b', { roughness: 0.8 }));
    grip.position.y = -0.44;
    // Lacquered scabbard over the lower blade, red cord binding.
    const scabbard = mesh(new THREE.BoxGeometry(0.075, 0.6, 0.035), std('#0a0a0a', { roughness: 0.25, metalness: 0.3 }));
    scabbard.position.y = 0.23;
    const cord = mesh(new THREE.BoxGeometry(0.085, 0.02, 0.045), glow(back.accentColor || '#ff0055', 1.2));
    cord.position.y = -0.04;
    const strap = mesh(new THREE.BoxGeometry(0.03, 0.9, 0.02), std('#1f2937', { roughness: 0.8 }));
    strap.rotation.z = -1.4;
    strap.position.set(0, 0.05, 0.02);
    katana.add(blade, edge, guard, grip, scabbard, cord);
    katana.position.set(0, 0.05, -frame.shoulder + 0.02);
    katana.rotation.z = 0.7;
    torso.add(katana);
  } else if (back && backShape === 'back_jade_blade') {
    // Straight double-edged jian: jade disc guard, emerald energy edges, red tassel.
    const sword = new THREE.Group();
    const blade = mesh(new THREE.BoxGeometry(0.06, 0.8, 0.014), std('#a7f3d0', { metalness: 0.7, roughness: 0.15 }));
    blade.position.y = 0.12;
    const tip = mesh(new THREE.ConeGeometry(0.042, 0.1, 4), std('#a7f3d0', { metalness: 0.7, roughness: 0.15 }));
    tip.position.y = 0.57;
    tip.rotation.y = Math.PI / 4;
    tip.scale.set(1, 1, 0.33);
    const edgeMat = glow(back.accentColor || '#34d399', 2);
    [-1, 1].forEach((sx) => {
      const e = mesh(new THREE.BoxGeometry(0.008, 0.8, 0.016), edgeMat);
      e.position.set(sx * 0.032, 0.12, 0);
      sword.add(e);
    });
    const guard = mesh(new THREE.TorusGeometry(0.06, 0.022, 8, 20), std(back.color || '#064e3b', { metalness: 0.3, roughness: 0.15 }));
    guard.position.y = -0.3;
    const grip = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 8), std('#064e3b', { roughness: 0.6 }));
    grip.position.y = -0.4;
    const pommel = mesh(new THREE.SphereGeometry(0.035, 10, 8), std('#34d399', { metalness: 0.3, roughness: 0.15 }));
    pommel.position.y = -0.5;
    const tassel = mesh(new THREE.ConeGeometry(0.03, 0.16, 8), std('#dc2626', { roughness: 0.9 }));
    tassel.position.set(0.03, -0.6, 0);
    sword.add(blade, tip, guard, grip, pommel, tassel);
    sword.position.set(0, 0.05, -frame.shoulder + 0.02);
    sword.rotation.z = -0.7;
    torso.add(sword);
  } else if (back && backShape === 'back_skateboard') {
    const board = new THREE.Group();
    // Hoverboard: rounded deck, grip tape with a lightning graphic, glowing hover pads (no wheels).
    const deck = mesh(new RoundedBoxGeometry(0.24, 0.72, 0.035, 3, 0.017), std(back.color || '#8b5cf6', { roughness: 0.4, metalness: 0.3 }));
    const grip = mesh(new THREE.BoxGeometry(0.2, 0.62, 0.004), std('#18181b', { roughness: 1, metalness: 0 }));
    grip.position.z = 0.019;
    const bolt = new THREE.Shape();
    bolt.moveTo(0.02, 0.2);
    bolt.lineTo(-0.05, 0.0);
    bolt.lineTo(0.0, 0.0);
    bolt.lineTo(-0.02, -0.2);
    bolt.lineTo(0.05, 0.03);
    bolt.lineTo(0.0, 0.03);
    bolt.closePath();
    // The graphic is on the underside, which faces out.
    const art = mesh(new THREE.ShapeGeometry(bolt), glow('#facc15', 1));
    art.scale.setScalar(1.3);
    art.position.z = -0.02;
    art.rotation.y = Math.PI;
    const padGeo = track(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 20));
    const padMat = glow('#22d3ee', 2.2);
    [-0.22, 0.22].forEach((y) => {
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.rotation.x = Math.PI / 2;
      pad.position.set(0, y, -0.028);
      board.add(pad);
    });
    board.add(deck, grip, art);
    board.position.set(0, 0, -frame.shoulder - 0.04);
    board.rotation.z = -0.2;
    torso.add(board);
  } else if (back && backShape === 'back_midnight_cape') {
    const cape = new THREE.Group();
    const outer = std(back.color || '#1e1b4b', { roughness: 0.75, side: THREE.DoubleSide });
    const lining = std('#6d28d9', { roughness: 0.6, side: THREE.DoubleSide });
    const clothGeo = track(new THREE.CylinderGeometry(frame.shoulder + 0.03, frame.shoulder + 0.22, 1.05, 20, 4, true, Math.PI * 0.62, Math.PI * 0.76));
    const cloth = new THREE.Mesh(clothGeo, outer);
    cloth.castShadow = true;
    const inner = new THREE.Mesh(clothGeo, lining);
    inner.scale.setScalar(0.97);
    const clasp = mesh(new THREE.SphereGeometry(0.035, 10, 8), std(back.accentColor || '#facc15', { metalness: 0.9, roughness: 0.2 }));
    [-1, 1].forEach((sx) => {
      const c = clasp.clone();
      c.position.set(sx * (frame.shoulder - 0.05), 0.48, 0.05);
      cape.add(c);
    });
    cloth.position.y = -0.05;
    inner.position.y = -0.05;
    cape.add(cloth, inner);
    cape.position.set(0, 0, -0.02);
    torso.add(cape);
  } else if (back && backShape === 'back_rocket_pack') {
    const pack = new THREE.Group();
    const shell = track(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(back.color || '#cbd5e1'), ...finishParams(itemFinish(back), back) }));
    const tankGeo = track(new THREE.CapsuleGeometry(0.075, 0.32, 6, 16));
    const nozzleGeo = track(new THREE.ConeGeometry(0.06, 0.1, 16, 1, true));
    const flameGeo = track(new THREE.ConeGeometry(0.05, 0.22, 12));
    const flameMat = glow(back.accentColor || '#38bdf8', 2.4);
    [-1, 1].forEach((sx) => {
      const tank = new THREE.Mesh(tankGeo, shell);
      tank.position.set(sx * 0.09, 0.02, 0);
      tank.castShadow = true;
      const nozzle = new THREE.Mesh(nozzleGeo, std('#334155', { metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }));
      nozzle.position.set(sx * 0.09, -0.26, 0);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.rotation.x = Math.PI;
      flame.position.set(sx * 0.09, -0.4, 0);
      pack.add(tank, nozzle, flame);
    });
    const core = mesh(new RoundedBoxGeometry(0.12, 0.3, 0.1, 2, 0.03), shell);
    core.position.z = 0.04;
    const light = mesh(new THREE.BoxGeometry(0.06, 0.02, 0.01), glow(back.accentColor || '#38bdf8', 2));
    light.position.set(0, 0.08, -0.015);
    pack.add(core, light);
    pack.position.set(0, 0.02, -frame.shoulder - 0.06);
    torso.add(pack);
  }

  // 6. Particle Trail System
  let trailParticles: THREE.Points | undefined;
  const trailCosmetic = COSMETICS_CATALOG.find((c) => c.id === avatar.trailId);
  if (trailCosmetic && trailCosmetic.id !== 'none') {
    const pCount = 35;
    const pGeo = new THREE.BufferGeometry();
    const pPositions = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount * 3; i++) {
      pPositions[i] = (Math.random() - 0.5) * 0.4;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    if (trailCosmetic.palette?.length) {
      const cols = new Float32Array(pCount * 3);
      const c = new THREE.Color();
      for (let i = 0; i < pCount; i++) c.set(trailCosmetic.palette[i % trailCosmetic.palette.length]).toArray(cols, i * 3);
      pGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    }
    const pMat = new THREE.PointsMaterial({
      color: new THREE.Color(trailCosmetic.color || '#00f0ff'),
      vertexColors: Boolean(trailCosmetic.palette?.length),
      size: 0.12,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    disposables.push(pGeo, pMat);
    trailParticles = new THREE.Points(pGeo, pMat);
    trailParticles.position.set(0, 0.4, -0.3);
    root.add(trailParticles);
  }

  // ---- Animation: target pose per action, blended with frame-rate independent damping ----
  const REST_TORSO_Y = 1.05;
  const pose = { la: 0, ra: 0, ll: 0, rl: 0, ty: REST_TORSO_Y, trx: 0, hrx: 0, hry: 0 };
  const target = { ...pose };
  let oneShot: { action: AvatarAction; remaining: number } | null = null;

  const computeTarget = (time: number, action: AvatarAction) => {
    target.la = target.ra = target.ll = target.rl = 0;
    target.ty = REST_TORSO_Y;
    target.trx = target.hrx = target.hry = 0;

    if (action === 'run') {
      const cycle = Math.sin(time * 12);
      target.la = cycle * 0.7;
      target.ra = -cycle * 0.7;
      target.ll = -cycle * 0.85;
      target.rl = cycle * 0.85;
      target.ty = REST_TORSO_Y + Math.abs(cycle) * 0.08;
      target.hrx = 0.05;
      target.trx = 0.12;
    } else if (action === 'jump') {
      target.la = target.ra = -2.1;
      target.ll = -0.4;
      target.rl = 0.5;
      target.trx = -0.1;
    } else if (action === 'slide') {
      target.ty = 0.55;
      target.trx = 0.95;
      target.ll = 1.3;
      target.rl = 1.4;
      target.la = target.ra = 0.8;
    } else if (action === 'shoot') {
      target.la = -2.3;
      target.ra = -2.4;
      target.trx = -0.15;
      target.ty = REST_TORSO_Y + 0.06;
    } else if (action === 'celebrate') {
      const wave = Math.sin(time * 8) * 0.3;
      target.la = -2.4 + wave;
      target.ra = -2.4 - wave;
      target.ty = REST_TORSO_Y + Math.abs(Math.sin(time * 6)) * 0.1;
      target.hry = Math.sin(time * 4) * 0.2;
    } else {
      const breathe = Math.sin(time * 2.5) * 0.03;
      target.la = 0.05 + breathe;
      target.ra = -0.05 - breathe;
      target.ty = REST_TORSO_Y + breathe;
      target.hry = Math.sin(time * 1.5) * 0.05;
    }
  };

  const updateAnimation = (time: number, action: AvatarAction, dt?: number) => {
    let active = action;
    if (oneShot && dt !== undefined) {
      oneShot.remaining -= dt;
      if (oneShot.remaining <= 0) oneShot = null;
      else active = oneShot.action;
    }
    computeTarget(time, active);

    // Exponential damping: identical feel at 30, 60 or 120 fps.
    const k = dt === undefined ? 1 : 1 - Math.exp(-dt * 16);
    (Object.keys(pose) as (keyof typeof pose)[]).forEach((key) => {
      pose[key] += (target[key] - pose[key]) * k;
    });

    leftArm.rotation.x = pose.la;
    rightArm.rotation.x = pose.ra;
    leftLeg.rotation.x = pose.ll;
    rightLeg.rotation.x = pose.rl;
    torso.position.y = pose.ty;
    torso.rotation.x = pose.trx;
    head.rotation.x = pose.hrx;
    head.rotation.y = pose.hry;

    if (wingsGroup) {
      wingsGroup.rotation.y = Math.sin(time * 6) * 0.15;
    }
    if (trailParticles && dt !== undefined) {
      trailParticles.rotation.y += dt * 1.8;
      trailParticles.position.y = 0.4 + Math.sin(time * 5) * 0.05;
    }
  };

  const trigger = (action: AvatarAction, seconds = 0.6) => {
    oneShot = { action, remaining: seconds };
  };

  const dispose = () => {
    disposables.forEach((d) => d.dispose());
  };

  return {
    group: root,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    head,
    torso,
    wings: wingsGroup,
    trailParticles,
    updateAnimation,
    trigger,
    dispose,
  };
}
