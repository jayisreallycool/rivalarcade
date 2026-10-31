'use client';

import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { create3DAvatar } from '@/lib/avatar-3d-model';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import {
  ParticleBursts,
  createBlobShadow,
  createStarfield,
  neonMaterial,
  useGameEngine,
  useLatest,
  useStructuralMemo,
  useThrottledHud,
} from '@/lib/engine';
import { GameProps } from '@/lib/game-types';
import { mulberry32, randomSeed } from '@/lib/rng';
import GameShell, { PopupApi, useSwipe, Swipe } from './GameShell';
import { ArrowUp, MoveHorizontal, Flame } from 'lucide-react';

/**
 * DUNK RUSH — flick-to-shoot basketball, tuned like the skill-game apps:
 * easy to pick up (swipe up from the ball, aim assist, forgiving rim), hard to master
 * (perfect-swish window, bank shots, a hoop that starts moving, shifting shot spots, streaks).
 */

const ROUND_SECONDS = 45;
const CLUTCH_SECONDS = 10;
const GRAVITY = 12;
const BALL_R = 0.16;
const RIM_R = 0.36; // generous vs ball (real rim/ball ≈ 1.9×, here 2.25×)
const RIM_TUBE = 0.028;
const RIM_Y = 3.05;
const HOOP_Z = -2.6; // rim centre depth
const BOARD_OFFSET = 0.52; // backboard sits this far behind rim centre
const SPAWN = new THREE.Vector3(0, 1.05, 3.4);
const MAX_BALLS = 4;
const RELOAD = 0.38; // seconds before the next ball is ready

type Phase = 'ready' | 'playing' | 'over';

interface Ball {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  active: boolean;
  resolved: boolean;
  rimHits: number;
  bank: boolean;
  perfect: boolean;
  age: number;
  bounces: number;
}

/**
 * Difficulty ladder, unlocked by baskets made. Early levels are deliberately easy: a still hoop,
 * a strong aim assist (pull = how far a shot is nudged toward the rim, range = how wrong it may be)
 * and compressed power (comp = how much of your power error survives). Later levels move the hoop,
 * shift your shot spot and hand more of the shot back to your own skill.
 */
const LEVELS = [
  { makes: 0, amp: 0, speed: 0, pull: 0.85, range: 2.6, comp: 0.3, perfect: 0.16, shift: 0 },
  { makes: 4, amp: 0.5, speed: 0.55, pull: 0.78, range: 2.2, comp: 0.36, perfect: 0.13, shift: 0 },
  { makes: 9, amp: 1.0, speed: 0.85, pull: 0.68, range: 1.9, comp: 0.42, perfect: 0.11, shift: 1.6 },
  { makes: 15, amp: 1.5, speed: 1.15, pull: 0.58, range: 1.6, comp: 0.48, perfect: 0.095, shift: 2.2 },
  { makes: 22, amp: 1.9, speed: 1.5, pull: 0.5, range: 1.3, comp: 0.52, perfect: 0.085, shift: 2.6 },
];

function makeCourtTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 32; i++) {
    const shade = 30 + Math.floor(Math.random() * 12);
    ctx.fillStyle = `rgb(${shade + 26},${shade + 14},${shade + 4})`;
    ctx.fillRect(i * 16, 0, 16, 1024);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(i * 16, 0, 1, 1024);
  }
  // paint
  ctx.fillStyle = 'rgba(0,140,180,0.35)';
  ctx.fillRect(176, 0, 160, 300);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.strokeRect(176, 0, 160, 300);
  ctx.beginPath();
  ctx.arc(256, 300, 80, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(256, 40, 330, 0.08 * Math.PI, 0.92 * Math.PI);
  ctx.stroke();
  ctx.strokeRect(8, 0, 496, 1016);
  return c;
}

/** Grey-scale pebble grain + recessed seams, used as the ball's bump map. */
function makeBallBump() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 16000; i++) {
    const v = 110 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 256, 1.2 + Math.random() * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#202020';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(512, 128);
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.moveTo(384, 0);
  ctx.lineTo(384, 256);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(256, 128, 84, 128, 0, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

function makeBallTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e8650d';
  ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 2200; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.14})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 128, 1.5, 1.5);
  }
  ctx.strokeStyle = '#1a0800';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(0, 64);
  ctx.lineTo(256, 64);
  ctx.moveTo(64, 0);
  ctx.lineTo(64, 128);
  ctx.moveTo(192, 0);
  ctx.lineTo(192, 128);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(128, 64, 42, 64, 0, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

export default function DunkRush3DGame({ avatar, onFinish, seed, rival, match, onExit }: GameProps) {
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const seedRef = useLatest(seed);
  const popups = useRef<PopupApi | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, streak: 0, level: 0, timeLeft: ROUND_SECONDS, clutch: false });
  const resetRef = useRef<() => void>(() => {});
  const shootRef = useRef<(s: Swipe, w: number, h: number) => void>(() => {});
  const aimRef = useRef<(s: Swipe | null, w: number, h: number) => void>(() => {});
  const surfaceRef = useRef<{ w: number; h: number }>({ w: 390, h: 844 });

  const sim = useRef({
    playing: false,
    timeLeft: ROUND_SECONDS,
    score: 0,
    streak: 0,
    bestStreak: 0,
    makes: 0,
    shots: 0,
    swishes: 0,
    banks: 0,
    level: 0,
    reload: 0,
    clutchAnnounced: false,
    // breakdown accumulators
    bBase: 0,
    bSwish: 0,
    bBank: 0,
    bLevel: 0,
    bStreak: 0,
    bClutch: 0,
  });

  const start = useCallback(() => {
    Object.assign(sim.current, {
      playing: true,
      timeLeft: ROUND_SECONDS,
      score: 0,
      streak: 0,
      bestStreak: 0,
      makes: 0,
      shots: 0,
      swishes: 0,
      banks: 0,
      level: 0,
      reload: 0,
      clutchAnnounced: false,
      bBase: 0,
      bSwish: 0,
      bBank: 0,
      bLevel: 0,
      bStreak: 0,
      bClutch: 0,
    });
    resetRef.current();
    pushHud({ score: 0, streak: 0, level: 0, timeLeft: ROUND_SECONDS, clutch: false }, true);
    setPhase('playing');
  }, [pushHud]);

  const swipe = useSwipe({
    onSwipe: (s) => shootRef.current(s, surfaceRef.current.w, surfaceRef.current.h),
    onDrag: (s, ph) => aimRef.current(ph === 'end' ? null : s, surfaceRef.current.w, surfaceRef.current.h),
  });
  const surface = {
    ...swipe,
    onPointerDown: (e: React.PointerEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      surfaceRef.current = { w: r.width, h: r.height };
      swipe.onPointerDown(e);
    },
  };

  const { hostRef } = useGameEngine(
    {
      background: 0x07080f,
      fog: { density: 0.022 },
      camera: { fov: 60, far: 120, position: [0, 2.0, 7.6], lookAt: [0, 2.55, -2.2] },
      exposure: 1.1,
      bloom: { strength: 0.5, radius: 0.32, threshold: 0.88 },
      environment: 0.55,
      studio: { top: 0x3a2c22, bottom: 0x120c08, left: 0x3fd8ff, right: 0xff7a2a, back: 0xffc58a, key: 1.4 },
      grade: { contrast: 1.1, saturation: 1.1, vignette: 0.38 },
    },
    (engine) => {
      const { scene, camera, quality } = engine;
      const rng = { next: mulberry32(1) };

      // Camera sits behind the shot spot (it follows when the spot shifts), framed per screen shape.
      const view = { y: 2.0, z: 7.7, camX: 0 };
      engine.onResize((_w, _h, aspect) => {
        if (aspect < 0.8) Object.assign(view, { y: 2.0, z: 7.7 });
        else Object.assign(view, { y: 2.25, z: 8.2 });
        camera.fov = aspect < 0.8 ? 64 : 44;
        camera.updateProjectionMatrix();
      });

      // ---------------- lighting: arena key + rim lights + soft fill
      scene.add(new THREE.HemisphereLight(0xffe6c8, 0x2a1a10, 0.9));
      const key = new THREE.SpotLight(0xfff1dc, 320, 40, Math.PI / 5.5, 0.5, 2);
      key.position.set(-3, 11, 6);
      key.target.position.set(0, 1.5, -1);
      engine.configureShadows(key);
      const back = new THREE.SpotLight(0x58e6ff, 160, 40, Math.PI / 5, 0.6, 2);
      back.position.set(4, 9, -8);
      back.target.position.set(0, 3, -2.5);
      scene.add(key, key.target, back, back.target);

      // ---------------- court & arena
      const courtTex = engine.own(new THREE.CanvasTexture(makeCourtTexture()));
      courtTex.colorSpace = THREE.SRGBColorSpace;
      courtTex.anisotropy = Math.min(8, engine.renderer.capabilities.getMaxAnisotropy());
      const court = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 28),
        // Varnished hardwood: a clear-coat layer reflects the arena lights over the wood grain.
        new THREE.MeshPhysicalMaterial({ map: courtTex, roughness: 0.55, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, bumpMap: courtTex, bumpScale: 0.6 }),
      );
      court.rotation.x = -Math.PI / 2;
      court.position.set(0, 0, -1);
      court.receiveShadow = quality.shadows;
      scene.add(court);

      // Crowd stands: rows of instanced "fans" with phone-light sparkles (1 draw call)
      const fanGeo = new THREE.CapsuleGeometry(0.17, 0.26, 3, 8);
      const fanMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
      const fanCount = Math.round(260 * quality.propDensity);
      const fans = new THREE.InstancedMesh(fanGeo, fanMat, fanCount);
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      const palette = [0x3b4466, 0x5a3550, 0x2f4d5c, 0x6a3a2c, 0x4a4a52, 0x2d5a44];
      for (let i = 0; i < fanCount; i++) {
        const row = i % 7;
        const side = Math.random();
        const x = (Math.random() - 0.5) * 22;
        const z = -10 - row * 0.9;
        m4.makeTranslation(side < 0.15 ? -8 - row * 0.8 : side > 0.85 ? 8 + row * 0.8 : x, 0.3 + row * 0.55, side < 0.15 || side > 0.85 ? -2 - Math.random() * 10 : z);
        fans.setMatrixAt(i, m4);
        fans.setColorAt(i, col.setHex(palette[i % palette.length]));
      }
      scene.add(fans);

      // Arena back wall: LED ribbon board + team banners, emissive so it lights the far court.
      const wallCanvas = document.createElement('canvas');
      wallCanvas.width = 1024;
      wallCanvas.height = 256;
      {
        const g = wallCanvas.getContext('2d')!;
        const bg = g.createLinearGradient(0, 0, 0, 256);
        bg.addColorStop(0, '#07070c');
        bg.addColorStop(1, '#15100c');
        g.fillStyle = bg;
        g.fillRect(0, 0, 1024, 256);
        // LED ribbon
        const rib = g.createLinearGradient(0, 0, 1024, 0);
        rib.addColorStop(0, '#ff6a00');
        rib.addColorStop(0.5, '#ffb15c');
        rib.addColorStop(1, '#ff6a00');
        g.fillStyle = rib;
        g.fillRect(0, 150, 1024, 34);
        g.fillStyle = '#120800';
        g.font = '900 30px system-ui, sans-serif';
        g.textAlign = 'center';
        for (let x = 128; x < 1024; x += 256) g.fillText('RIVAL ARCADE', x, 178);
        // banners
        ['#00c2ff', '#ff2d7a', '#ffd23f', '#22d3a6', '#a78bfa'].forEach((c, i) => {
          g.fillStyle = c;
          g.globalAlpha = 0.85;
          g.fillRect(70 + i * 200, 18, 70, 110);
          g.globalAlpha = 1;
          g.fillStyle = '#0b0b10';
          g.fillRect(84 + i * 200, 30, 42, 6);
        });
        // tiny LED dots
        for (let i = 0; i < 700; i++) {
          g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(255,170,90,0.4)';
          g.fillRect(Math.random() * 1024, 196 + Math.random() * 60, 2, 2);
        }
      }
      const wallTex = engine.own(new THREE.CanvasTexture(wallCanvas));
      wallTex.colorSpace = THREE.SRGBColorSpace;
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 7.5),
        new THREE.MeshStandardMaterial({ color: 0x0c0c12, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.9, roughness: 0.6 }),
      );
      wall.position.set(0, 8.4, -19); // ribbon sits above the backboard, not behind the rim
      scene.add(wall);
      scene.add(createStarfield(engine, { count: 300, radius: 30, color: '#ffffff', size: 0.12, yMin: 1 }));

      // Light cones
      const coneMat = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      [-5, 5].forEach((x) => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(2.8, 12, 24, 1, true), coneMat);
        cone.position.set(x, 6, -6);
        cone.rotation.z = x > 0 ? 0.35 : -0.35;
        scene.add(cone);
      });

      // Neon court trim
      const trim = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.03, 6, 96), neonMaterial(0xff7a1a, 1.4));
      trim.rotation.x = -Math.PI / 2;
      trim.scale.set(1, 1.6, 1);
      trim.position.set(0, 0.02, -2);
      scene.add(trim);

      // ---------------- hoop assembly (moves as one group)
      const hoop = new THREE.Group();
      scene.add(hoop);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, RIM_Y + 1.1, 16), new THREE.MeshPhysicalMaterial({ color: 0x2a2e40, metalness: 0.9, roughness: 0.3, clearcoat: 0.5 }));
      pole.position.set(0, (RIM_Y + 1.1) / 2, HOOP_Z - BOARD_OFFSET - 0.9);
      pole.castShadow = quality.shadows;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.9), pole.material);
      arm.position.set(0, RIM_Y + 0.75, HOOP_Z - BOARD_OFFSET - 0.45);
      const boardGeo = new THREE.BoxGeometry(1.8, 1.15, 0.05);
      const board = new THREE.Mesh(
        boardGeo,
        new THREE.MeshPhysicalMaterial({ color: 0xd8e8ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 2.2 }),
      );
      board.position.set(0, RIM_Y + 0.45, HOOP_Z - BOARD_OFFSET);
      const boardEdge = new THREE.LineSegments(new THREE.EdgesGeometry(boardGeo), new THREE.LineBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(1.3), toneMapped: false }));
      boardEdge.position.copy(board.position);
      const square = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.6, 0.45)),
        new THREE.LineBasicMaterial({ color: new THREE.Color(0xff5a1f).multiplyScalar(2.4), toneMapped: false }),
      );
      square.position.set(0, RIM_Y + 0.2, HOOP_Z - BOARD_OFFSET + 0.03);
      const rimMat = new THREE.MeshPhysicalMaterial({ color: 0xff5500, emissive: 0xff3a00, emissiveIntensity: 0.35, metalness: 0.85, roughness: 0.22, clearcoat: 0.6 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, RIM_TUBE, 12, 48), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(0, RIM_Y, HOOP_Z);
      rim.castShadow = quality.shadows;
      // Net: line mesh that stretches on a make
      const netGeo = new THREE.CylinderGeometry(RIM_R, RIM_R * 0.55, 0.5, 14, 4, true);
      const net = new THREE.LineSegments(new THREE.WireframeGeometry(netGeo), new THREE.LineBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 0.85 }));
      netGeo.dispose();
      net.position.set(0, RIM_Y - 0.25, HOOP_Z);
      hoop.add(pole, arm, board, boardEdge, square, rim, net);
      const hoopShadow = createBlobShadow(engine, 0.6, 0.35);
      hoopShadow.position.set(0, 0.02, HOOP_Z);
      hoop.add(hoopShadow);

      // ---------------- shooter avatar (beside the ball)
      const avatar3D = create3DAvatar(stableAvatar);
      engine.own(avatar3D);
      avatar3D.group.scale.setScalar(0.85);
      scene.add(avatar3D.group);
      const avatarShadow = createBlobShadow(engine, 0.5);
      scene.add(avatarShadow);

      // ---------------- balls
      const ballTex = engine.own(new THREE.CanvasTexture(makeBallTexture()));
      ballTex.colorSpace = THREE.SRGBColorSpace;
      const ballGeo = engine.own(new THREE.SphereGeometry(BALL_R, 32, 20));
      const ballBump = engine.own(new THREE.CanvasTexture(makeBallBump()));
      // Pebbled leather: bump grain + soft sheen, rough enough to catch the arena lights gently.
      const ballMat = engine.own(
        new THREE.MeshPhysicalMaterial({ map: ballTex, bumpMap: ballBump, bumpScale: 1.2, roughness: 0.68, metalness: 0, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffa060), emissive: 0xff4400, emissiveIntensity: 0 }),
      );
      const balls: Ball[] = Array.from({ length: MAX_BALLS }, () => {
        const mesh = new THREE.Mesh(ballGeo, ballMat);
        mesh.castShadow = quality.shadows;
        mesh.visible = false;
        scene.add(mesh);
        return { mesh, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), active: false, resolved: true, rimHits: 0, bank: false, perfect: false, age: 0, bounces: 0 };
      });
      const readyBall = new THREE.Mesh(ballGeo, ballMat);
      readyBall.castShadow = quality.shadows;
      scene.add(readyBall);
      const readyShadow = createBlobShadow(engine, 0.22, 0.5);
      scene.add(readyShadow);

      // Aim preview dots (short arc only: helps without solving the shot for you)
      const AIM_DOTS = 9;
      const aimPos = new Float32Array(AIM_DOTS * 3);
      const aimGeo = new THREE.BufferGeometry();
      aimGeo.setAttribute('position', new THREE.BufferAttribute(aimPos, 3));
      const aim = new THREE.Points(aimGeo, new THREE.PointsMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(1.6), size: 0.07, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }));
      aim.frustumCulled = false;
      aim.visible = false;
      scene.add(aim);

      const particles = new ParticleBursts(engine);

      // ---------------- state that lives with the scene
      const spawn = SPAWN.clone();
      let hoopPhase = 0;
      let hoopX = 0;
      let netKick = 0;
      const rimCenter = new THREE.Vector3();
      const tmp = new THREE.Vector3();
      const tmp2 = new THREE.Vector3();

      const placeShooter = () => {
        // Stand off to the side and slightly ahead so the shooter frames the shot, not blocks it.
        avatar3D.group.position.set(spawn.x - 1.9, 0, spawn.z - 1.4);
        avatar3D.group.rotation.y = 0.55;
        avatarShadow.position.set(spawn.x - 1.9, 0.02, spawn.z - 1.4);
      };
      placeShooter();

      resetRef.current = () => {
        rng.next = mulberry32(seedRef.current ?? randomSeed());
        hoopPhase = rng.next() * Math.PI * 2;
        hoopX = 0;
        spawn.copy(SPAWN);
        balls.forEach((b) => {
          b.active = false;
          b.resolved = true;
          b.mesh.visible = false;
        });
        particles.clear();
        placeShooter();
      };

      /** Velocity that lands exactly on `target` after `t` seconds. */
      const solve = (from: THREE.Vector3, target: THREE.Vector3, t: number, out: THREE.Vector3) =>
        out.set((target.x - from.x) / t, (target.y - from.y + 0.5 * GRAVITY * t * t) / t, (target.z - from.z) / t);

      /** Swipe → launch velocity with aim assist. Returns null if the gesture isn't a shot. */
      const shotFromSwipe = (s: Swipe, w: number, h: number, out: THREE.Vector3) => {
        if (s.dy > -30) return null; // must flick upward
        const up = -s.dy;
        // Power: 1.0 = a swipe of ~36% screen height (forgiving band, length not speed)
        const rawPower = up / (h * 0.36);
        // Direction: horizontal lean of the flick, measured as dx per dy
        const lean = THREE.MathUtils.clamp(s.dx / up, -1.2, 1.2);
        const dz = spawn.z - HOOP_Z;
        let aimX = spawn.x + lean * dz * 0.42;
        // Aim assist (strong at first, easing off as levels rise): pull lateral aim toward the rim
        // and compress power error, so a roughly-right flick goes in.
        const L = LEVELS[sim.current.level];
        const err = hoopX - aimX;
        if (Math.abs(err) < L.range) aimX += err * L.pull;
        let power = 1 + (rawPower - 1) * L.comp;
        power = THREE.MathUtils.clamp(power, 0.6, 1.5);
        const perfect = Math.abs(hoopX - aimX) < L.perfect && Math.abs(power - 1) < L.perfect * 0.5;
        if (perfect) {
          aimX = hoopX;
          power = 1;
        }
        // Lead the moving hoop: aim where it will be at arrival
        // Longer flight = higher, steeper arc that drops cleanly through the rim.
        const flight = 1.2;
        const lead = LEVELS[sim.current.level].speed * LEVELS[sim.current.level].amp * Math.cos(hoopPhase) * flight;
        // Power error moves the landing point short/long (linear, forgiving) rather than scaling
        // the whole launch: ±~15% power still swishes, ±25% rattles, big overshoots can bank in.
        const depth = HOOP_Z + 0.05 - (power - 1) * 1.2;
        const target = tmp2.set(aimX + (perfect ? lead : lead * (0.4 + 0.6 * L.pull)), RIM_Y + 0.05, depth);
        solve(spawn, target, flight, out);
        void w;
        return { perfect };
      };

      aimRef.current = (s, w, h) => {
        if (!s || !sim.current.playing || sim.current.reload > 0) {
          aim.visible = false;
          return;
        }
        const v = tmp.set(0, 0, 0);
        if (!shotFromSwipe(s, w, h, v)) {
          aim.visible = false;
          return;
        }
        // Only the first ~35% of the arc
        for (let i = 0; i < AIM_DOTS; i++) {
          const t = (i + 1) * 0.04;
          aimPos[i * 3] = spawn.x + v.x * t;
          aimPos[i * 3 + 1] = spawn.y + v.y * t - 0.5 * GRAVITY * t * t;
          aimPos[i * 3 + 2] = spawn.z + v.z * t;
        }
        aimGeo.attributes.position.needsUpdate = true;
        aim.visible = true;
      };

      shootRef.current = (s, w, h) => {
        const st = sim.current;
        if (!st.playing || st.reload > 0) return;
        const ball = balls.find((b) => !b.active);
        if (!ball) return;
        const res = shotFromSwipe(s, w, h, ball.vel);
        aim.visible = false;
        if (!res) return;
        ball.pos.copy(spawn);
        ball.prev.copy(spawn);
        ball.active = true;
        ball.resolved = false;
        ball.rimHits = 0;
        ball.bank = false;
        ball.perfect = res.perfect;
        ball.age = 0;
        ball.bounces = 0;
        ball.mesh.visible = true;
        ball.mesh.position.copy(spawn);
        st.shots += 1;
        st.reload = RELOAD;
        sound.playJump();
        haptic('light');
        avatar3D.trigger('shoot', 0.4);
      };

      const score = (ball: Ball) => {
        const st = sim.current;
        st.makes += 1;
        st.streak += 1;
        st.bestStreak = Math.max(st.bestStreak, st.streak);
        const swish = ball.rimHits === 0 && !ball.bank;
        const base = 100;
        const swishB = swish ? 50 : 0;
        const bankB = ball.bank ? 25 : 0;
        const levelB = st.level * 20;
        const pre = base + swishB + bankB + levelB;
        const streakMult = st.streak >= 6 ? 3 : st.streak >= 3 ? 2 : 1;
        const clutchMult = st.timeLeft <= CLUTCH_SECONDS ? 2 : 1;
        const pts = pre * streakMult * clutchMult;
        st.bBase += base;
        st.bSwish += swishB;
        st.bBank += bankB;
        st.bLevel += levelB;
        st.bStreak += pre * (streakMult - 1);
        st.bClutch += pre * streakMult * (clutchMult - 1);
        st.score += pts;
        if (swish) st.swishes += 1;
        if (ball.bank) st.banks += 1;

        // Feedback
        netKick = 1;
        sound.playSwish();
        haptic(swish ? 'big' : 'score');
        engine.flash(swish ? 0.7 : 0.35);
        rimCenter.set(hoopX, RIM_Y, HOOP_Z);
        particles.emit(rimCenter, swish ? 0xffd34d : 0x5fe8ff, { count: swish ? 34 : 18, speed: 4.5, life: 0.7 });
        const p = engine.toScreen(rimCenter);
        popups.current?.pop(`+${pts}`, p.x, p.y - 30, { color: clutchMult > 1 ? '#fbbf24' : swish ? '#fde047' : '#ffffff', size: pts >= 300 ? 'lg' : 'md' });
        if (ball.perfect) popups.current?.banner('PERFECT!', '#fde047');
        else if (swish) popups.current?.pop('SWISH', p.x, p.y + 10, { color: '#7dd3fc', size: 'sm' });
        else if (ball.bank) popups.current?.pop('BANK!', p.x, p.y + 10, { color: '#c4b5fd', size: 'sm' });
        if (st.streak === 3) popups.current?.banner('HEATING UP ×2', '#fb923c');
        if (st.streak === 6) popups.current?.banner('ON FIRE ×3', '#f43f5e');
        avatar3D.trigger('celebrate', swish ? 1.1 : 0.6);

        // Level up → hoop starts moving; shot spot shifts (seeded, same for every player)
        const nextLevel = LEVELS.reduce((lv, l, i) => (st.makes >= l.makes ? i : lv), 0);
        if (nextLevel > st.level) {
          st.level = nextLevel;
          popups.current?.banner(`LEVEL ${nextLevel + 1}`, '#5fe8ff');
        }
        const shift = LEVELS[st.level].shift;
        if (shift > 0) {
          spawn.x = (rng.next() - 0.5) * shift;
          spawn.z = SPAWN.z + (rng.next() - 0.5) * 0.3 * shift;
          placeShooter();
        }
        pushHud({ score: st.score, streak: st.streak, level: st.level }, true);
      };

      const miss = () => {
        const st = sim.current;
        if (st.streak >= 3) popups.current?.banner('STREAK LOST', '#94a3b8');
        st.streak = 0;
        pushHud({ streak: 0 }, true);
      };

      const finish = () => {
        const st = sim.current;
        st.playing = false;
        aim.visible = false;
        sound.playLose();
        haptic('fail');
        const breakdown = [
          { label: `Baskets (${st.makes}/${st.shots})`, points: st.bBase },
          { label: `Swish bonus (${st.swishes})`, points: st.bSwish },
          { label: `Bank bonus (${st.banks})`, points: st.bBank },
          { label: 'Moving hoop bonus', points: st.bLevel },
          { label: `Streak multiplier (best ${st.bestStreak})`, points: st.bStreak },
          { label: 'Clutch time ×2', points: st.bClutch },
        ].filter((b) => b.points > 0);
        pushHud({ timeLeft: 0, score: st.score, clutch: false }, true);
        setPhase('over');
        onFinishRef.current(st.score, { baskets: st.makes, maxCombo: st.bestStreak, breakdown });
      };

      // ---------------- per-frame
      engine.addUpdate((dt, t) => {
        const st = sim.current;

        if (st.playing) {
          st.timeLeft -= dt;
          st.reload = Math.max(0, st.reload - dt);
          if (!st.clutchAnnounced && st.timeLeft <= CLUTCH_SECONDS) {
            st.clutchAnnounced = true;
            popups.current?.banner('CLUTCH TIME ×2', '#fbbf24');
            haptic('big');
          }
          pushHud({ timeLeft: Math.max(0, st.timeLeft), clutch: st.timeLeft <= CLUTCH_SECONDS });
          if (st.timeLeft <= 0) finish();
        }

        // Hoop sway (deterministic per seed)
        const lv = LEVELS[st.level];
        hoopPhase += lv.speed * dt;
        const targetX = lv.amp * Math.sin(hoopPhase);
        hoopX += (targetX - hoopX) * Math.min(1, dt * 4);
        hoop.position.x = hoopX;

        // Ready ball bob
        readyBall.visible = st.playing ? st.reload === 0 : true;
        readyBall.position.set(spawn.x, spawn.y + Math.sin(t * 3) * 0.03, spawn.z);
        readyBall.rotation.y += dt;
        readyShadow.position.set(spawn.x, 0.02, spawn.z);
        ballMat.emissiveIntensity = st.streak >= 6 ? 0.9 + Math.sin(t * 20) * 0.2 : st.streak >= 3 ? 0.35 : 0;

        // Ball physics (sub-stepped for reliable rim contacts)
        rimCenter.set(hoopX, RIM_Y, HOOP_Z);
        const boardZ = HOOP_Z - BOARD_OFFSET + 0.025;
        // Fixed ~240Hz physics regardless of frame rate, so a shot plays identically on every phone.
        const steps = Math.max(1, Math.ceil(dt * 240));
        const h = dt / steps;
        for (const b of balls) {
          if (!b.active) continue;
          for (let k = 0; k < steps; k++) {
            b.prev.copy(b.pos);
            b.vel.y -= GRAVITY * h;
            b.pos.addScaledVector(b.vel, h);

            // Rim (torus) collision
            tmp.set(b.pos.x - rimCenter.x, 0, b.pos.z - rimCenter.z);
            const horiz = tmp.length() || 1e-5;
            tmp.multiplyScalar(RIM_R / horiz).add(rimCenter); // nearest point on rim circle
            tmp2.copy(b.pos).sub(tmp);
            const dist = tmp2.length();
            if (dist < BALL_R + RIM_TUBE && dist > 1e-5) {
              tmp2.divideScalar(dist);
              b.pos.copy(tmp).addScaledVector(tmp2, BALL_R + RIM_TUBE + 0.001);
              const vn = b.vel.dot(tmp2);
              if (vn < 0) b.vel.addScaledVector(tmp2, -1.55 * vn);
              b.vel.multiplyScalar(0.92);
              if (b.rimHits === 0) sound.playTap();
              b.rimHits += 1;
            }

            // Backboard
            if (b.vel.z < 0 && b.pos.z - BALL_R < boardZ && b.prev.z - BALL_R >= boardZ && Math.abs(b.pos.x - hoopX) < 0.9 && b.pos.y > RIM_Y - 0.15 && b.pos.y < RIM_Y + 1.05) {
              b.pos.z = boardZ + BALL_R;
              b.vel.z *= -0.55;
              b.vel.x *= 0.8;
              b.bank = true;
              sound.playTap();
            }

            // Make: crossing the rim plane downward inside the hoop
            if (!b.resolved && b.prev.y >= RIM_Y && b.pos.y < RIM_Y && Math.hypot(b.pos.x - hoopX, b.pos.z - HOOP_Z) < RIM_R - BALL_R * 0.35) {
              b.resolved = true;
              b.vel.x *= 0.3;
              b.vel.z *= 0.3;
              if (st.playing) score(b);
            }

            // Floor
            if (b.pos.y < BALL_R) {
              b.pos.y = BALL_R;
              b.vel.y = Math.abs(b.vel.y) * 0.55;
              b.vel.x *= 0.8;
              b.vel.z *= 0.8;
              b.bounces += 1;
              if (!b.resolved) {
                b.resolved = true;
                if (st.playing) miss();
              }
            }
          }
          b.age += dt;
          b.mesh.position.copy(b.pos);
          b.mesh.rotation.x -= b.vel.z * dt * 3;
          b.mesh.rotation.z += b.vel.x * dt * 3;
          if (st.streak >= 6 && !b.resolved) particles.emit(b.pos, 0xff5a1f, { count: 1, speed: 0.6, life: 0.35, size: 1.4, gravity: -2 });
          if (b.bounces >= 3 || b.age > 4 || b.pos.z > 9 || Math.abs(b.pos.x) > 9) {
            if (!b.resolved && st.playing) miss();
            b.active = false;
            b.resolved = true;
            b.mesh.visible = false;
          }
        }

        // Net swish animation
        if (netKick > 0) {
          netKick = Math.max(0, netKick - dt * 2.4);
          const s = Math.sin(netKick * 18) * netKick;
          net.scale.set(1 - s * 0.12, 1 + s * 0.45, 1 - s * 0.12);
        }
        rimMat.emissiveIntensity = 0.5 + netKick * 2.5;

        avatar3D.updateAnimation(t, 'idle', dt);

        // Follow the shooting spot so the ball always sits bottom-centre, hoop in view.
        view.camX += (spawn.x * 0.8 - view.camX) * Math.min(1, dt * 3);
        camera.position.set(view.camX, view.y, view.z);
        camera.lookAt(view.camX * 0.45 + hoopX * 0.2, 2.55, -2.2);

      });

      return () => {
        resetRef.current = () => {};
        shootRef.current = () => {};
        aimRef.current = () => {};
      };
    },
    [stableAvatar],
  );

  const chips = (
    <>
      {hud.streak >= 3 && (
        <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-orange-500 text-black text-[11px] font-black">
          <Flame className="w-3 h-3" /> ×{hud.streak >= 6 ? 3 : 2}
        </span>
      )}
      {hud.streak > 0 && <span className="px-2 py-0.5 rounded-full bg-black/50 text-white text-[11px] font-bold">{hud.streak} in a row</span>}
      {hud.level > 0 && <span className="px-2 py-0.5 rounded-full bg-cyan-400/90 text-black text-[11px] font-black">LVL {hud.level + 1}</span>}
    </>
  );

  return (
    <GameShell
      title="DUNK RUSH"
      accent="#fb923c"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={start}
      score={hud.score}
      timeLeft={phase === 'ready' ? ROUND_SECONDS : hud.timeLeft}
      roundSeconds={ROUND_SECONDS}
      clutch={hud.clutch}
      chips={chips}
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="Flick UP from the ball to shoot"
      tutorial={[
        { icon: <ArrowUp className="w-6 h-6" />, label: 'Flick up to shoot' },
        { icon: <MoveHorizontal className="w-6 h-6" />, label: 'Lean to aim' },
        { icon: <Flame className="w-6 h-6" />, label: '3 in a row = ×2' },
      ]}
      scoring="Starts easy: still hoop and strong aim help. Every few baskets the hoop moves faster and the help eases off. Basket 100 · Swish +50 · Bank +25 · Streaks ×2/×3 · Last 10s ×2."
    />
  );
}
