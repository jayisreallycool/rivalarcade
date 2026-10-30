import * as THREE from 'three';
import { AvatarConfig } from './avatar-types';
import { SKIN_TONES, HAIR_COLORS, COSMETICS_CATALOG } from './cosmetics-catalog';

export type AvatarAction = 'idle' | 'run' | 'jump' | 'slide' | 'shoot' | 'celebrate';

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
  const skinMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(skin.color),
    roughness: 0.55,
    metalness: 0.05,
  });

  const hairMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hairColor.color),
    roughness: 0.65,
    metalness: 0.15,
  });

  const shirtMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(shirt?.color || '#1e293b'),
    roughness: 0.6,
    metalness: 0.1,
  });

  const shirtAccentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(shirt?.accentColor || '#00f0ff'),
    roughness: 0.4,
    metalness: 0.2,
    emissive: new THREE.Color(shirt?.accentColor || '#00f0ff'),
    emissiveIntensity: 0.35,
  });

  const pantsMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pants?.color || '#0f172a'),
    roughness: 0.7,
    metalness: 0.1,
  });

  const shoesMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(shoes?.color || '#ffffff'),
    roughness: 0.4,
    metalness: 0.2,
  });

  const shoesAccentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(shoes?.accentColor || '#00f0ff'),
    roughness: 0.3,
    emissive: new THREE.Color(shoes?.accentColor || '#00f0ff'),
    emissiveIntensity: 0.4,
  });

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
  const torsoGeo = new THREE.CylinderGeometry(frame.shoulder, frame.waist, 0.72, 10);
  const torso = new THREE.Mesh(torsoGeo, shirtMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  root.add(torso);
  disposables.push(torsoGeo);

  if (frame.hip) {
    const hips = mesh(new THREE.CylinderGeometry(frame.waist + 0.01, frame.hip, 0.22, 10), pantsMat);
    hips.position.y = -0.42;
    torso.add(hips);
  }

  // Torso accent stripe
  const stripeGeo = new THREE.BoxGeometry(0.12, 0.73, 0.54);
  const stripe = new THREE.Mesh(stripeGeo, shirtAccentMat);
  torso.add(stripe);
  disposables.push(stripeGeo);

  // 2. Head Group
  const head = new THREE.Group();
  head.position.y = 0.54; // pivot above torso
  torso.add(head);

  // Head sphere
  const headGeo = new THREE.SphereGeometry(0.24, 16, 16);
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

  // Hair 3D Geometry based on hairStyleId
  const hairGroup = new THREE.Group();
  head.add(hairGroup);

  const capGeo = (r: number, cover = 0.55) => new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI * cover);
  const hs = avatar.hairStyleId;
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
    const bun = mesh(new THREE.SphereGeometry(0.14, 10, 8), hairMat);
    bun.position.set(0, 0.16, -0.22);
    const tail = mesh(new THREE.ConeGeometry(0.08, 0.36, 8), hairMat);
    tail.position.set(0, -0.02, -0.3);
    tail.rotation.x = Math.PI + 0.35;
    const cap = mesh(capGeo(0.25, 0.5), hairMat);
    cap.position.y = 0.03;
    hairGroup.add(bun, tail, cap);
  } else if (hs === 'hair_waves') {
    const cap = mesh(capGeo(0.262, 0.52), hairMat);
    cap.position.y = 0.03;
    hairGroup.add(cap);
    const ridgeGeo = track(new THREE.TorusGeometry(0.2, 0.022, 6, 24, Math.PI));
    for (let i = 0; i < 3; i++) {
      const ridge = new THREE.Mesh(ridgeGeo, hairMat);
      ridge.rotation.y = Math.PI / 2;
      ridge.position.set(0, 0.08 + i * 0.045, 0);
      ridge.scale.setScalar(1.15 - i * 0.18);
      hairGroup.add(ridge);
    }
  } else if (hs === 'hair_afro_puff') {
    const puff = mesh(new THREE.IcosahedronGeometry(0.36, 2), hairMat);
    puff.position.set(0, 0.14, -0.04);
    puff.scale.set(1, 0.85, 0.95);
    hairGroup.add(puff);
  } else if (hs === 'hair_cyber_undercut') {
    // Shaved sides (skin-tight cap) + swept top slab
    const sides = mesh(capGeo(0.248, 0.5), hairMat);
    sides.position.y = 0.01;
    sides.scale.set(1, 0.6, 1);
    const top = mesh(new THREE.BoxGeometry(0.2, 0.1, 0.42), hairMat);
    top.position.set(0.03, 0.22, 0.02);
    top.rotation.z = -0.25;
    hairGroup.add(sides, top);
  } else if (hs === 'hair_dreadlocks') {
    const cap = mesh(capGeo(0.26, 0.55), hairMat);
    cap.position.y = 0.03;
    hairGroup.add(cap);
    const lockGeo = track(new THREE.CylinderGeometry(0.03, 0.025, 0.42, 6));
    for (let i = 0; i < 10; i++) {
      const ang = Math.PI * 0.15 + (i / 9) * Math.PI * 0.7; // around the back half
      const lock = new THREE.Mesh(lockGeo, hairMat);
      lock.position.set(Math.cos(ang) * 0.24, -0.1, -Math.sin(ang) * 0.24);
      lock.rotation.x = -Math.sin(ang) * 0.2;
      lock.rotation.z = Math.cos(ang) * 0.2;
      hairGroup.add(lock);
    }
  } else {
    // hair_short_fade (default): neat crop
    const crop = mesh(capGeo(0.26, 0.55), hairMat);
    crop.position.y = 0.03;
    hairGroup.add(crop);
  }

  // Headwear 3D
  if (headwear && headwear.id !== 'none') {
    const hw = headwear.id;
    if (hw === 'headwear_snapback') {
      const cap = mesh(new THREE.SphereGeometry(0.27, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), std(headwear.color || '#0f172a', { roughness: 0.6 }));
      cap.position.y = 0.04;
      const brim = mesh(new THREE.BoxGeometry(0.24, 0.03, 0.2), std(headwear.accentColor || '#00f0ff', { roughness: 0.4 }));
      brim.position.set(0, 0.06, -0.24); // worn backwards
      head.add(cap, brim);
    } else if (hw === 'headwear_beanie') {
      const knit = std(headwear.color || '#334155', { roughness: 0.9, metalness: 0 });
      const dome = mesh(new THREE.SphereGeometry(0.275, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), knit);
      dome.position.y = 0.05;
      dome.scale.set(1, 1.18, 1);
      const cuff = mesh(new THREE.TorusGeometry(0.255, 0.04, 8, 28), knit);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = 0.06;
      const pom = mesh(new THREE.SphereGeometry(0.06, 8, 6), knit);
      pom.position.y = 0.38;
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
      const gold = std(0xffb800, { metalness: 0.85, roughness: 0.2, emissive: new THREE.Color(0xffb800), emissiveIntensity: 0.25 });
      const crown = mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.12, 6, 1, true), gold);
      crown.position.y = 0.26;
      const pointGeo = track(new THREE.ConeGeometry(0.04, 0.1, 4));
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Mesh(pointGeo, gold);
        const ang = (i / 6) * Math.PI * 2;
        p.position.set(Math.cos(ang) * 0.25, 0.37, Math.sin(ang) * 0.25);
        head.add(p);
      }
      head.add(crown);
    }
  }

  // Eyewear 3D
  if (eyewear && eyewear.id !== 'none') {
    const ew = eyewear.id;
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
    } else {
      // eyewear_speed_shades: wraparound band
      const wrap = mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 0.07, 24, 1, true, -Math.PI * 0.35, Math.PI * 0.7),
        glow(eyewear.color || '#ffb800', 0.8),
      );
      (wrap.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      wrap.position.y = 0.04;
      head.add(wrap);
    }
  }

  // 3. Arms (Pivot at shoulders)
  const armGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.55, 6);
  disposables.push(armGeo);

  // Left Arm
  const leftArm = new THREE.Group();
  leftArm.position.set(-frame.arm, 0.26, 0);
  const leftArmMesh = new THREE.Mesh(armGeo, shirtMat);
  leftArmMesh.position.y = -0.25;
  leftArmMesh.castShadow = true;
  leftArm.add(leftArmMesh);
  torso.add(leftArm);

  // Right Arm
  const rightArm = new THREE.Group();
  rightArm.position.set(frame.arm, 0.26, 0);
  const rightArmMesh = new THREE.Mesh(armGeo, shirtMat);
  rightArmMesh.position.y = -0.25;
  rightArmMesh.castShadow = true;
  rightArm.add(rightArmMesh);
  torso.add(rightArm);

  // 4. Legs (Pivot at hips)
  const legGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.65, 6);
  const shoeGeo = new THREE.BoxGeometry(0.16, 0.12, 0.24);
  disposables.push(legGeo, shoeGeo);

  // Left Leg
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.16, 0.68, 0);
  const leftLegMesh = new THREE.Mesh(legGeo, pantsMat);
  leftLegMesh.position.y = -0.3;
  leftLegMesh.castShadow = true;
  const leftShoe = new THREE.Mesh(shoeGeo, shoesMat);
  leftShoe.position.set(0, -0.62, 0.04);
  leftShoe.castShadow = true;
  leftLeg.add(leftLegMesh, leftShoe);
  root.add(leftLeg);

  // Right Leg
  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.16, 0.68, 0);
  const rightLegMesh = new THREE.Mesh(legGeo, pantsMat);
  rightLegMesh.position.y = -0.3;
  rightLegMesh.castShadow = true;
  const rightShoe = new THREE.Mesh(shoeGeo, shoesMat);
  rightShoe.position.set(0, -0.62, 0.04);
  rightShoe.castShadow = true;
  rightLeg.add(rightLegMesh, rightShoe);
  root.add(rightLeg);

  // Shoe soles in the accent colour, and a side stripe on trims with an accent.
  const soleGeo = track(new THREE.BoxGeometry(0.17, 0.03, 0.25));
  const stripeLegGeo = track(new THREE.BoxGeometry(0.02, 0.5, 0.05));
  const pantsAccent = pants?.accentColor ? glow(pants.accentColor, 0.5) : null;
  [leftLeg, rightLeg].forEach((leg, i) => {
    const sole = new THREE.Mesh(soleGeo, shoesAccentMat);
    sole.position.set(0, -0.69, 0.04);
    leg.add(sole);
    if (pantsAccent) {
      const st = new THREE.Mesh(stripeLegGeo, pantsAccent);
      st.position.set(i === 0 ? -0.09 : 0.09, -0.3, 0);
      leg.add(st);
    }
  });

  // 5. Back Accessories (Wings, Katana, etc.)
  let wingsGroup: THREE.Group | undefined;
  if (back && back.id === 'back_cyber_wings') {
    wingsGroup = new THREE.Group();
    wingsGroup.position.set(0, 0.1, -0.2);

    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.5,
      side: THREE.DoubleSide,
    });
    disposables.push(wingMat);

    const wingGeo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      0, 0, 0,
      -0.9, 0.6, -0.1,
      -0.6, -0.3, -0.1,
      0, 0, 0,
      0.9, 0.6, -0.1,
      0.6, -0.3, -0.1,
    ]);
    wingGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    wingGeo.computeVertexNormals();
    disposables.push(wingGeo);

    const wingsMesh = new THREE.Mesh(wingGeo, wingMat);
    wingsGroup.add(wingsMesh);
    torso.add(wingsGroup);
  } else if (back && back.id === 'back_katana') {
    const katana = new THREE.Group();
    const blade = mesh(new THREE.BoxGeometry(0.055, 0.85, 0.016), std('#d1d5db', { metalness: 0.95, roughness: 0.15 }));
    blade.position.y = 0.1;
    const edge = mesh(new THREE.BoxGeometry(0.012, 0.85, 0.018), glow(back.accentColor || '#ff0055', 2));
    edge.position.set(0.032, 0.1, 0);
    const guard = mesh(new THREE.BoxGeometry(0.1, 0.02, 0.05), std('#111827', { metalness: 0.6 }));
    guard.position.y = -0.33;
    const grip = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), std(back.color || '#09090b', { roughness: 0.8 }));
    grip.position.y = -0.44;
    katana.add(blade, edge, guard, grip);
    katana.position.set(0, 0.05, -frame.shoulder + 0.02);
    katana.rotation.z = 0.7;
    torso.add(katana);
  } else if (back && back.id === 'back_skateboard') {
    const board = new THREE.Group();
    const deck = mesh(new THREE.BoxGeometry(0.22, 0.7, 0.03), std(back.color || '#8b5cf6', { roughness: 0.6 }));
    const wheelGeo = track(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10));
    const wheelMat = glow('#a3e635', 0.6);
    [-0.25, 0.25].forEach((y) =>
      [-0.08, 0.08].forEach((x) => {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(x, y, -0.04);
        board.add(w);
      }),
    );
    board.add(deck);
    board.position.set(0, 0, -frame.shoulder - 0.04);
    board.rotation.z = -0.2;
    torso.add(board);
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
    const pMat = new THREE.PointsMaterial({
      color: new THREE.Color(trailCosmetic.color || '#00f0ff'),
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
