'use client';

import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import {
  CameraFeel,
  ParticleBursts,
  createBlobShadow,
  createFirstPersonRig,
  createStarfield,
  neonMaterial,
  useGameEngine,
  useLatest,
  useStructuralMemo,
  useThrottledHud,
} from '@/lib/engine';
import { GameProps } from '@/lib/game-types';
import { mulberry32, randomSeed } from '@/lib/rng';
import { ROUND_SECONDS, CLUTCH_SECONDS, award, popStyle, ScoreBook } from '@/lib/scoring';
import GameShell, { PopupApi, useSwipe, Swipe } from './GameShell';
import { ArrowUp, MoveHorizontal, Flame } from 'lucide-react';

/**
 * DUNK RUSH — drag-and-release basketball built for a thumb on a phone screen:
 * touch anywhere, DRAG UP to set power and slide SIDEWAYS to aim; an aim arc and a power meter
 * show your shot live, and LETTING GO shoots. Pull back down to cancel.
 * Scoring: SWISH (nothing but net) 2 · BANK SHOT or RIM SHOT 1 · three swishes in a row light the
 * FLAME BALL — a flaming swish is worth 6; anything but a swish puts the flame out.
 * An arena shot clock and scoreboard (red LED) run the 60 s round and the buzzer ends it;
 * fireworks go up on every make. Shot spots change range, the aim help fades as you level up,
 * and the hoop glides side to side (always in view — lead it yourself).
 */

const GRAVITY = 12;
const BALL_R = 0.16;
const RIM_R = 0.36; // generous vs ball (real rim/ball ≈ 1.9×, here 2.25×)
const RIM_TUBE = 0.028;
const RIM_Y = 3.05;
const HOOP_Z = -2.6; // rim centre depth
const BOARD_OFFSET = 0.52; // backboard sits this far behind rim centre
// The ball is held in your hands just below eye level (first person).
const SPAWN = new THREE.Vector3(0, 1.36, HOOP_Z + 3.3); // first spot: close range, straight on
const EYE = { y: 1.74, back: 1.0 };
const MAX_BALLS = 4;
const RELOAD = 0.38; // seconds before the next ball is ready
/** Points: nothing-but-net, off the glass or the rim, and a swish with the flame ball. */
const PTS_SWISH = 2;
const PTS_OTHER = 1;
const PTS_FLAME_SWISH = 6;
/** Swishes in a row that light the flame ball. */
const FLAME_AFTER = 3;

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
  flame: boolean;
  perfect: boolean;
  zone: ZoneId;
  age: number;
  bounces: number;
}

/**
 * Difficulty ladder, unlocked by baskets made. Early levels are deliberately easy: a still hoop,
 * a strong aim assist (pull = how far a shot is nudged toward the rim, range = how wrong it may be)
 * and compressed power (comp = how much of your power error survives). Later levels move the hoop,
 * shift your shot spot and hand more of the shot back to your own skill.
 */
type ZoneId = 'close' | 'mid' | 'three' | 'deep';
/** Shot ranges: distance to the rim (m), how far round the arc the spot can be (rad), bonus. */
const ZONES: Record<ZoneId, { dist: number; spread: number; label: string; bonus: number }> = {
  close: { dist: 3.3, spread: 0.35, label: 'CLOSE', bonus: 0 },
  mid: { dist: 4.6, spread: 0.55, label: 'MID-RANGE', bonus: 0 },
  three: { dist: 6.3, spread: 0.6, label: '3-POINT', bonus: 1 },
  deep: { dist: 7.6, spread: 0.45, label: 'DEEP 3', bonus: 1 },
};
/** assist: share of a near-miss corrected (only within `window` metres); preview: share of the arc shown. */
const LEVELS: { makes: number; amp: number; speed: number; assist: number; window: number; preview: number; zones: ZoneId[] }[] = [
  { makes: 0, amp: 0, speed: 0, assist: 0.45, window: 0.8, preview: 0.5, zones: ['close', 'mid'] },
  { makes: 3, amp: 0, speed: 0, assist: 0.35, window: 0.7, preview: 0.42, zones: ['mid', 'close', 'three'] },
  { makes: 7, amp: 0.5, speed: 0.6, assist: 0.25, window: 0.6, preview: 0.34, zones: ['mid', 'three'] },
  { makes: 12, amp: 1.0, speed: 0.9, assist: 0.18, window: 0.5, preview: 0.27, zones: ['three', 'mid', 'deep'] },
  { makes: 18, amp: 1.5, speed: 1.2, assist: 0.12, window: 0.45, preview: 0.21, zones: ['three', 'deep'] },
  { makes: 25, amp: 2.0, speed: 1.6, assist: 0.08, window: 0.4, preview: 0.16, zones: ['deep', 'three'] },
];
/** Metres of carry per unit of power. */
const CARRY = 6.0;
/** Share of the screen height you drag for 1 unit of power (a deep 3 ≈ 28%: an easy thumb pull). */
const POWER_SPAN = 0.22;
const MAX_POWER = 1.45;
/** Sideways drag (share of screen height) for a full lean of the aim. */
const AIM_SPAN = 0.3;

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

/**
 * Seams of a real 8-panel ball in the sphere's (equirectangular) texture space: the equator, one
 * great circle through both poles, and two curved seams (small circles round the equator's front
 * and back). Returns polylines in pixel coordinates.
 */
function ballSeams(W: number, H: number) {
  const X = (lon: number) => (((lon / (Math.PI * 2) + 0.5) % 1) + 1) % 1 * W;
  const Y = (lat: number) => (0.5 - lat / Math.PI) * H;
  const lines: { x: number; y: number }[][] = [];
  lines.push([{ x: 0, y: H / 2 }, { x: W, y: H / 2 }]); // equator
  lines.push([{ x: W / 4, y: 0 }, { x: W / 4, y: H }], [{ x: (3 * W) / 4, y: 0 }, { x: (3 * W) / 4, y: H }]); // pole-to-pole
  const A = THREE.MathUtils.degToRad(62);
  for (const c of [0, Math.PI]) {
    for (const side of [-1, 1]) {
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k <= 80; k++) {
        const lat = -A + (2 * A * k) / 80;
        const dl = Math.acos(THREE.MathUtils.clamp(Math.cos(A) / Math.cos(lat), -1, 1));
        pts.push({ x: X(c + side * dl), y: Y(lat) });
      }
      lines.push(pts);
    }
  }
  return lines;
}

function strokeSeams(ctx: CanvasRenderingContext2D, W: number, H: number, width: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const line of ballSeams(W, H)) {
    ctx.beginPath();
    line.forEach((p, i) => {
      // (curved seams near x = 0/W wrap round: break the path rather than streak across)
      if (i > 0 && Math.abs(p.x - line[i - 1].x) > W / 2) ctx.moveTo(p.x, p.y);
      else if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }
}

/** League-style composite leather: deep orange with tonal variation, pebbles, black channels, a logo. */
function makeBallTexture() {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c85a1e';
  ctx.fillRect(0, 0, W, H);
  // tonal blotches so it isn't flat plastic
  for (let i = 0; i < 90; i++) {
    const g = ctx.createRadialGradient(Math.random() * W, Math.random() * H, 0, Math.random() * W, Math.random() * H, 60 + Math.random() * 120);
    g.addColorStop(0, Math.random() < 0.5 ? 'rgba(150,55,15,0.18)' : 'rgba(230,120,50,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // pebbles: a dark pit and a light top on each
  for (let i = 0; i < 38000; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.fillStyle = 'rgba(90,30,5,0.28)';
    ctx.fillRect(x + 0.8, y + 0.8, 2, 2);
    ctx.fillStyle = 'rgba(255,170,110,0.22)';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  // channels: a soft dark groove with a black core
  strokeSeams(ctx, W, H, 16, 'rgba(60,20,5,0.55)');
  strokeSeams(ctx, W, H, 9, '#140a06');
  // our own logo stamp on a panel (black ink, slightly worn)
  ctx.save();
  ctx.translate(W * 0.5, H * 0.37);
  ctx.fillStyle = 'rgba(15,8,4,0.85)';
  ctx.font = 'italic 900 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('RIVAL', 0, 0);
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.fillText('★  OFFICIAL GAME BALL  ★', 0, 32);
  ctx.restore();
  ctx.save();
  ctx.translate(W * 0.5, H * 0.63);
  ctx.fillStyle = 'rgba(15,8,4,0.8)';
  ctx.font = '800 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SIZE 7 · 29.5"  ·  INDOOR / OUTDOOR', 0, 0);
  ctx.restore();
  return c;
}

/** Bump map to match: raised pebbles, deep channels. */
function makeBallBump() {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#7a7a7a';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 30000; i++) {
    const v = 150 + Math.floor(Math.random() * 70);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, 1.4 + Math.random() * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  strokeSeams(ctx, W, H, 14, '#303030');
  strokeSeams(ctx, W, H, 8, '#000000');
  return c;
}

/** 7-segment LED digits (arena scoreboard style): unlit segments faintly visible, lit ones glow. */
const SEGS: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };
function drawSeg(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number, on: string, off: string) {
  const t = w * 0.18; // segment thickness
  const seg = (k: string) => {
    const half = h / 2;
    switch (k) {
      case 'a': return [x + t * 0.6, y, w - t * 1.2, t];
      case 'd': return [x + t * 0.6, y + h - t, w - t * 1.2, t];
      case 'g': return [x + t * 0.6, y + half - t / 2, w - t * 1.2, t];
      case 'f': return [x, y + t * 0.6, t, half - t * 0.9];
      case 'b': return [x + w - t, y + t * 0.6, t, half - t * 0.9];
      case 'e': return [x, y + half + t * 0.3, t, half - t * 0.9];
      default: return [x + w - t, y + half + t * 0.3, t, half - t * 0.9]; // c
    }
  };
  const lit = SEGS[ch] ?? '';
  for (const k of 'abcdefg') {
    const [sx, sy, sw, sh] = seg(k);
    const isOn = lit.includes(k);
    ctx.fillStyle = isOn ? on : off;
    ctx.shadowColor = isOn ? on : 'transparent';
    ctx.shadowBlur = isOn ? w * 0.25 : 0;
    ctx.beginPath();
    ctx.roundRect(sx, sy, sw, sh, t * 0.45);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

export default function DunkRush3DGame({ avatar, onFinish, seed, rival, match, onExit }: GameProps) {
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const seedRef = useLatest(seed);
  const popups = useRef<PopupApi | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, streak: 0, level: 0, timeLeft: ROUND_SECONDS, clutch: false, zone: 'close' as ZoneId, swishRun: 0, flame: false });
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
    swishRun: 0,
    flame: false,
    flames: 0,
    lastBeep: 99,
    zone: 'close' as ZoneId,
    book: new ScoreBook(),
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
      swishRun: 0,
      flame: false,
      flames: 0,
      lastBeep: 99,
      zone: 'close',
      book: new ScoreBook(),
    });
    resetRef.current();
    pushHud({ score: 0, streak: 0, level: 0, timeLeft: ROUND_SECONDS, clutch: false, zone: 'close', swishRun: 0, flame: false }, true);
    setPhase('playing');
  }, [pushHud]);

  // Drag to aim (live preview), lift your finger to shoot.
  const swipe = useSwipe({
    onDrag: (s, ph) => {
      if (ph === 'end') {
        aimRef.current(null, surfaceRef.current.w, surfaceRef.current.h);
        shootRef.current(s, surfaceRef.current.w, surfaceRef.current.h);
      } else aimRef.current(s, surfaceRef.current.w, surfaceRef.current.h);
    },
    onCancel: () => aimRef.current(null, surfaceRef.current.w, surfaceRef.current.h),
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
      camera: { fov: 66, near: 0.03, far: 120, position: [0, EYE.y, SPAWN.z + EYE.back], lookAt: [0, 1.1, HOOP_Z] },
      exposure: 1.1,
      bloom: { strength: 0.5, radius: 0.32, threshold: 0.88 },
      environment: 0.55,
      studio: { top: 0x3a2c22, bottom: 0x120c08, left: 0x3fd8ff, right: 0xff7a2a, back: 0xffc58a, key: 1.4 },
      grade: { contrast: 1.1, saturation: 1.1, vignette: 0.38 },
    },
    (engine) => {
      const { scene, camera, quality } = engine;
      const rng = { next: mulberry32(1) };

      // First person: you hold the ball at the free-throw spot and look up at the rim.
      // The camera follows when the shot spot shifts; the lens widens on tall phone screens.
      const view = { camX: 0, camZ: SPAWN.z, lookY: 1.1, baseLook: 1.1, look: 0 };
      engine.onResize((_w, _h, aspect) => {
        camera.fov = aspect < 0.6 ? 70 : aspect < 0.8 ? 64 : 50;
        view.baseLook = aspect < 0.8 ? 1.1 : 1.45;
        camera.updateProjectionMatrix();
      });
      const feel = new CameraFeel();

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

      // ---------------- arena scoreboards (red LED): game clock on the left, score on the right
      const RED = '#ff2a2a';
      const RED_OFF = 'rgba(255,40,40,0.08)';
      const ledBoard = (w: number, h: number) => {
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const tex = engine.own(new THREE.CanvasTexture(cv));
        tex.colorSpace = THREE.SRGBColorSpace;
        return { cv, g: cv.getContext('2d')!, tex };
      };
      const frameMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.5, metalness: 0.6 }));
      const makeWallBoard = (x: number) => {
        const led = ledBoard(512, 256);
        const grp = new THREE.Group();
        const frame = new THREE.Mesh(engine.own(new THREE.BoxGeometry(3.5, 1.9, 0.25)), frameMat);
        const face = new THREE.Mesh(engine.own(new THREE.PlaneGeometry(3.3, 1.65)), engine.own(new THREE.MeshBasicMaterial({ map: led.tex, toneMapped: false })));
        face.position.z = 0.13;
        grp.add(frame, face);
        grp.position.set(x, 6.6, -18.6);
        scene.add(grp);
        return led;
      };
      const clockBoard = makeWallBoard(-3.7);
      const scoreBoard = makeWallBoard(3.7);
      const paintWall = (led: ReturnType<typeof ledBoard>, label: string, text: string, colon: boolean) => {
        const { g, cv, tex } = led;
        g.fillStyle = '#050506';
        g.fillRect(0, 0, cv.width, cv.height);
        g.fillStyle = '#d8d8e0';
        g.font = '900 34px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText(label, cv.width / 2, 42);
        const n = text.length;
        const dw = 74;
        const gap = colon ? 40 : 18;
        const total = n * dw + (n - 1) * 18 + (colon ? gap : 0);
        let x = (cv.width - total) / 2;
        for (let i = 0; i < n; i++) {
          drawSeg(g, text[i], x, 70, dw, 150, RED, RED_OFF);
          x += dw + 18;
          if (colon && i === n - 3) {
            g.fillStyle = RED;
            g.shadowColor = RED;
            g.shadowBlur = 14;
            g.fillRect(x - 6, 110, 14, 14);
            g.fillRect(x - 6, 168, 14, 14);
            g.shadowBlur = 0;
            x += gap - 18;
          }
        }
        tex.needsUpdate = true;
      };
      let shownClock = '';
      let shownScore = '';
      const paintBoards = (secs: number, score: number) => {
        const sTotal = Math.max(0, Math.ceil(secs));
        const clock = `${Math.floor(sTotal / 60)}${String(sTotal % 60).padStart(2, '0')}`;
        if (clock !== shownClock) {
          shownClock = clock;
          paintWall(clockBoard, 'TIME', clock, true);
          paintShotClock(sTotal);
        }
        const sc = String(Math.min(999, score)).padStart(3, ' ');
        if (sc !== shownScore) {
          shownScore = sc;
          paintWall(scoreBoard, 'SCORE', sc, false);
        }
      };
      // shot clock box on top of the backboard (moves with the hoop) — defined with the hoop below
      const shotLed = ledBoard(256, 160);
      const paintShotClock = (secs: number) => {
        const { g, cv, tex } = shotLed;
        g.fillStyle = '#050506';
        g.fillRect(0, 0, cv.width, cv.height);
        const txt = String(Math.min(99, secs)).padStart(2, ' ');
        drawSeg(g, txt[0], 38, 22, 76, 116, RED, RED_OFF);
        drawSeg(g, txt[1], 142, 22, 76, 116, RED, RED_OFF);
        tex.needsUpdate = true;
      };

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
      const shotClock = new THREE.Group();
      const scBox = new THREE.Mesh(engine.own(new THREE.BoxGeometry(0.62, 0.42, 0.22)), frameMat);
      const scFace = new THREE.Mesh(engine.own(new THREE.PlaneGeometry(0.56, 0.35)), engine.own(new THREE.MeshBasicMaterial({ map: shotLed.tex, toneMapped: false })));
      scFace.position.z = 0.115;
      shotClock.add(scBox, scFace);
      shotClock.position.set(0, RIM_Y + 0.45 + 0.575 + 0.24, HOOP_Z - BOARD_OFFSET);
      // a red buzzer light along the top of the glass: flashes when time runs out
      const buzzMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(0.25), toneMapped: false }));
      const buzzLight = new THREE.Mesh(engine.own(new THREE.BoxGeometry(1.8, 0.05, 0.06)), buzzMat);
      buzzLight.position.set(0, RIM_Y + 0.45 + 0.6, HOOP_Z - BOARD_OFFSET);
      hoop.add(pole, arm, board, boardEdge, square, rim, net, shotClock, buzzLight);
      let buzzT = 0;
      const hoopShadow = createBlobShadow(engine, 0.6, 0.35);
      hoopShadow.position.set(0, 0.02, HOOP_Z);
      hoop.add(hoopShadow);

      // ---------------- your arms, holding the ball
      const arms = createFirstPersonRig(engine, stableAvatar, { spread: 0.2, drop: 0.47, depth: 0.62 });
      let throwT = 0; // >0 while the follow-through plays

      // ---------------- balls
      const ballTex = engine.own(new THREE.CanvasTexture(makeBallTexture()));
      ballTex.colorSpace = THREE.SRGBColorSpace;
      ballTex.anisotropy = Math.min(8, engine.renderer.capabilities.getMaxAnisotropy());
      const ballGeo = engine.own(new THREE.SphereGeometry(BALL_R, 48, 32));
      const ballBump = engine.own(new THREE.CanvasTexture(makeBallBump()));
      // Composite leather: pebble bump, deep channels, a soft satin sheen.
      const ballMat = engine.own(
        new THREE.MeshPhysicalMaterial({ map: ballTex, bumpMap: ballBump, bumpScale: 2.2, roughness: 0.6, metalness: 0, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xff9a5a), clearcoat: 0.08, clearcoatRoughness: 0.6 }),
      );
      // Flame ball: the same ball, glowing from inside like an ember.
      const flameMat = engine.own(
        new THREE.MeshPhysicalMaterial({ map: ballTex, bumpMap: ballBump, bumpScale: 2.2, roughness: 0.5, metalness: 0, emissive: 0xff4a00, emissiveMap: ballTex, emissiveIntensity: 1.6 }),
      );
      // flames and fireworks get their own particle pools
      const flames = new ParticleBursts(engine, engine.own(new THREE.TetrahedronGeometry(0.07, 0)));
      const fireworks = new ParticleBursts(engine, engine.own(new THREE.OctahedronGeometry(0.06, 0)));
      const flameLight = new THREE.PointLight(0xff6a1a, 0, 4, 2);
      scene.add(flameLight);
      // flame aura: two flickering teardrop glows (outer orange, inner yellow) wrapped round the ball
      const flameTex = (() => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 128;
        const g = c.getContext('2d')!;
        const grd = g.createRadialGradient(32, 92, 4, 32, 80, 60);
        grd.addColorStop(0, 'rgba(255,255,255,1)');
        grd.addColorStop(0.35, 'rgba(255,255,255,0.75)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(32, 2);
        g.bezierCurveTo(52, 40, 64, 70, 60, 96);
        g.bezierCurveTo(56, 124, 8, 124, 4, 96);
        g.bezierCurveTo(0, 70, 12, 40, 32, 2);
        g.fill();
        return engine.own(new THREE.CanvasTexture(c));
      })();
      const auraOuter = new THREE.Sprite(engine.own(new THREE.SpriteMaterial({ map: flameTex, color: new THREE.Color(0xff4a00).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
      const auraInner = new THREE.Sprite(engine.own(new THREE.SpriteMaterial({ map: flameTex, color: new THREE.Color(0xffc040).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
      auraOuter.visible = auraInner.visible = false;
      scene.add(auraOuter, auraInner);
      type Shell = { pos: THREE.Vector3; vel: THREE.Vector3; fuse: number; color: number };
      const shells: Shell[] = [];
      const FW_COLORS = [0xff3b3b, 0xffd23f, 0x3fd8ff, 0x9b6bff, 0x4ade80, 0xff7ad9];
      /** Launch `n` firework shells from behind the stands, bursting high over the hoop. */
      const launchFireworks = (n: number) => {
        for (let i = 0; i < n; i++) {
          const x = (i % 2 ? 1 : -1) * (2 + Math.random() * 4);
          shells.push({
            pos: new THREE.Vector3(x, 1.5, -11 - Math.random() * 4),
            vel: new THREE.Vector3(-x * 0.12 + (Math.random() - 0.5), 10 + Math.random() * 2.5, 1 + Math.random()),
            fuse: 0.65 + Math.random() * 0.35 + i * 0.12,
            color: FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)],
          });
          sound.playFirework(0.65 + i * 0.12);
        }
      };
      const balls: Ball[] = Array.from({ length: MAX_BALLS }, () => {
        const mesh = new THREE.Mesh(ballGeo, ballMat);
        mesh.castShadow = quality.shadows;
        mesh.visible = false;
        scene.add(mesh);
        return { mesh, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), active: false, resolved: true, rimHits: 0, bank: false, flame: false, perfect: false, zone: 'close' as ZoneId, age: 0, bounces: 0 };
      });
      const readyBall = new THREE.Mesh(ballGeo, ballMat);
      readyBall.castShadow = quality.shadows;
      scene.add(readyBall);
      const readyShadow = createBlobShadow(engine, 0.22, 0.5);
      scene.add(readyShadow);

      // Aim arc: a trail of round dots along the start of the real flight (bigger near the ball,
      // fading out), drifting forward so it reads as motion. The shown share shrinks each level.
      const AIM_DOTS = 14;
      const dotC = document.createElement('canvas');
      dotC.width = dotC.height = 64;
      const dg = dotC.getContext('2d')!;
      const dgr = dg.createRadialGradient(32, 32, 0, 32, 32, 30);
      dgr.addColorStop(0, 'rgba(255,255,255,1)');
      dgr.addColorStop(0.6, 'rgba(255,255,255,0.95)');
      dgr.addColorStop(1, 'rgba(255,255,255,0)');
      dg.fillStyle = dgr;
      dg.beginPath();
      dg.arc(32, 32, 30, 0, Math.PI * 2);
      dg.fill();
      const dotTex = engine.own(new THREE.CanvasTexture(dotC));
      const aimDots: THREE.Sprite[] = [];
      const aimMats: THREE.SpriteMaterial[] = [];
      for (let i = 0; i < AIM_DOTS; i++) {
        const m = engine.own(new THREE.SpriteMaterial({ map: dotTex, color: 0xffffff, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
        const d = new THREE.Sprite(m);
        d.visible = false;
        d.renderOrder = 10;
        scene.add(d);
        aimDots.push(d);
        aimMats.push(m);
      }
      const aim = { visible: false }; // (kept for the hide calls below)
      const hideAim = () => {
        aim.visible = false;
        aimDots.forEach((d) => (d.visible = false));
        meter.style.opacity = '0';
      };
      // landing marker at rim height (first levels only): where this shot would come down
      const landMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5fe8ff).multiplyScalar(1.6), transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }));
      const land = new THREE.Mesh(engine.own(new THREE.RingGeometry(0.1, 0.15, 28)), landMat);
      land.rotation.x = -Math.PI / 2;
      land.visible = false;
      scene.add(land);

      // Power meter: a slim bar at the right edge that fills as you pull. On the first levels a
      // bracket marks the right power for this spot.
      const meter = document.createElement('div');
      meter.setAttribute('data-testid', 'dunk-power');
      meter.style.cssText = 'position:absolute;right:14px;bottom:24%;width:12px;height:34%;border-radius:8px;background:rgba(0,0,0,.45);border:1.5px solid rgba(255,255,255,.35);opacity:0;transition:opacity .15s;pointer-events:none;overflow:visible;z-index:5';
      const fill = document.createElement('div');
      fill.style.cssText = 'position:absolute;left:1px;right:1px;bottom:1px;border-radius:6px;background:linear-gradient(to top,#22d3ee,#a3e635 55%,#facc15 80%,#f97316);height:0%';
      const band = document.createElement('div');
      band.style.cssText = 'position:absolute;left:-5px;right:-5px;height:7%;border:2px solid #fff;border-radius:4px;box-shadow:0 0 8px rgba(255,255,255,.7);display:none';
      const meterLabel = document.createElement('div');
      meterLabel.style.cssText = 'position:absolute;right:18px;transform:translateY(50%);font:900 11px system-ui;color:#fff;text-shadow:0 1px 3px #000;white-space:nowrap';
      meter.append(fill, band, meterLabel);
      engine.renderer.domElement.parentElement?.appendChild(meter);

      const particles = new ParticleBursts(engine);

      // ---------------- state that lives with the scene
      const spawn = SPAWN.clone();
      let hoopPhase = 0;
      let hoopX = 0;
      let netKick = 0;
      const rimCenter = new THREE.Vector3();
      const tmp = new THREE.Vector3();
      const tmp2 = new THREE.Vector3();

      resetRef.current = () => {
        rng.next = mulberry32(seedRef.current ?? randomSeed());
        hoopPhase = rng.next() * Math.PI * 2;
        hoopX = 0;
        spawn.copy(SPAWN);
        view.camX = 0;
        view.camZ = SPAWN.z;
        view.look = 0;
        shells.length = 0;
        flames.clear();
        fireworks.clear();
        buzzT = 0;
        sim.current.lastBeep = 99;
        balls.forEach((b) => {
          b.active = false;
          b.resolved = true;
          b.mesh.visible = false;
        });
        particles.clear();
      };

      /** Velocity that lands exactly on `target` after `t` seconds. */
      const solve = (from: THREE.Vector3, target: THREE.Vector3, t: number, out: THREE.Vector3) =>
        out.set((target.x - from.x) / t, (target.y - from.y + 0.5 * GRAVITY * t * t) / t, (target.z - from.z) / t);

      let lastShot: Record<string, number> = {};
      let lastTick = -1;
      /**
       * Drag → launch velocity. Upward pull = power (carry distance), sideways = aim. The arc is a
       * clean set shot (steeper up close, a touch flatter from deep), so it's the same every time.
       * Light aim help on the first levels only. Returns null if it isn't a shot (pull too short).
       */
      const shotFromSwipe = (s: Swipe, w: number, h: number, out: THREE.Vector3) => {
        const up = -s.dy;
        if (up < h * 0.04) return null; // not pulled far enough (or pulled back down): no shot
        const L = LEVELS[sim.current.level];
        const power = THREE.MathUtils.clamp(up / (h * POWER_SPAN), 0.25, MAX_POWER);
        const side = Math.abs(s.dx) < 6 ? 0 : s.dx - Math.sign(s.dx) * 6; // small dead zone: straight is easy
        const lean = THREE.MathUtils.clamp(side / (h * AIM_SPAN), -1, 1);
        // "Straight up the screen" points at the basket's home spot; a full lean turns ±29°.
        const baseYaw = Math.atan2(0 - spawn.x, spawn.z - HOOP_Z);
        let yaw = baseYaw + lean * 0.5;
        let dist = power * CARRY;
        const wantYaw = Math.atan2(hoopX - spawn.x, spawn.z - HOOP_Z);
        const need = Math.hypot(hoopX - spawn.x, HOOP_Z - spawn.z);
        if (L.assist > 0) {
          if (Math.abs(wantYaw - yaw) < 0.1) yaw += (wantYaw - yaw) * L.assist;
          if (Math.abs(need - dist) < L.window) dist += (need - dist) * L.assist;
        }
        const rise = RIM_Y + 0.12 - spawn.y;
        dist += 0.05; // aim a touch past the rim centre so short and long misses are even
        const entry = THREE.MathUtils.clamp(50 - ((dist - 3.3) / 4.3) * 5, 44, 51);
        const theta = Math.atan((2 * rise) / dist + Math.tan(THREE.MathUtils.degToRad(entry)));
        const c = Math.cos(theta);
        const v = Math.sqrt((GRAVITY * dist * dist) / (2 * c * c * (dist * Math.tan(theta) - rise)));
        out.set(v * c * Math.sin(yaw), v * Math.sin(theta), -v * c * Math.cos(yaw));
        const perfect = Math.abs(dist - 0.05 - need) < 0.12 && Math.abs(yaw - wantYaw) < 0.025;
        void w;
        lastShot = { dist: +dist.toFixed(2), need: +need.toFixed(2), yaw: +(yaw - wantYaw).toFixed(3), power: +power.toFixed(2), h, up };
        return { perfect, flight: dist / (v * c), power, need, onLine: Math.abs(dist - 0.05 - need) < 0.25 && Math.abs(yaw - wantYaw) < 0.05 };
      };

      aimRef.current = (s, w, h) => {
        if (!s || !sim.current.playing || sim.current.reload > 0) {
          hideAim();
          land.visible = false;
          lastTick = -1;
          return;
        }
        const v = tmp.set(0, 0, 0);
        const r = shotFromSwipe(s, w, h, v);
        if (!r) {
          hideAim();
          land.visible = false;
          return;
        }
        const lvl = sim.current.level;
        // power meter (+ the right-power bracket on the first levels)
        meter.style.opacity = '1';
        fill.style.height = `${(r.power / MAX_POWER) * 100}%`;
        const want = r.need / CARRY / MAX_POWER;
        band.style.display = lvl <= 2 ? 'block' : 'none';
        band.style.bottom = `calc(${want * 100}% - 3.5%)`;
        meterLabel.textContent = `${(r.power * CARRY).toFixed(1)}m`;
        meterLabel.style.bottom = `${(r.power / MAX_POWER) * 100}%`;
        // a light tick every half metre of power, so you can feel it on the phone
        const tick = Math.floor(r.power * CARRY * 2);
        if (tick !== lastTick) {
          if (lastTick >= 0) haptic('tap');
          lastTick = tick;
        }
        // arc dots along the start of the real flight, drifting forward
        const T = r.flight * LEVELS[lvl].preview;
        const drift = (performance.now() / 1000) * 1.6;
        const col = lvl <= 1 && r.onLine ? 0x86efac : 0xffffff;
        for (let i = 0; i < AIM_DOTS; i++) {
          const u = (i + (drift % 1)) / AIM_DOTS;
          const t = u * T;
          const d = aimDots[i];
          d.position.set(spawn.x + v.x * t, spawn.y + v.y * t - 0.5 * GRAVITY * t * t, spawn.z + v.z * t);
          d.scale.setScalar(0.085 * (1 - u * 0.55));
          aimMats[i].opacity = 0.95 * (1 - u) ** 0.8 * Math.min(1, u * 6);
          aimMats[i].color.setHex(col);
          d.visible = true;
        }
        aim.visible = true;
        const lt = r.flight;
        land.position.set(spawn.x + v.x * lt, RIM_Y + 0.02, spawn.z + v.z * lt);
        land.visible = lvl <= 2;
      };

      /** Move to a new seeded shot spot for this level's ranges. */
      const newSpot = () => {
        const st = sim.current;
        const zones = LEVELS[st.level].zones;
        const z = zones[Math.floor(rng.next() * zones.length)];
        const Z = ZONES[z];
        const ang = (rng.next() - 0.5) * 2 * Z.spread;
        spawn.set(Math.sin(ang) * Z.dist, SPAWN.y, HOOP_Z + Math.cos(ang) * Z.dist);
        if (z !== st.zone) popups.current?.banner(`${Z.label} · ${Z.dist.toFixed(1)}m`, z === 'deep' ? '#f472b6' : z === 'three' ? '#fbbf24' : '#5fe8ff');
        st.zone = z;
        pushHud({ zone: z }, true);
      };

      shootRef.current = (s, w, h) => {
        const st = sim.current;
        if (!st.playing || st.reload > 0) return;
        const ball = balls.find((b) => !b.active);
        if (!ball) return;
        const res = shotFromSwipe(s, w, h, ball.vel);
        land.visible = false;
        ball.zone = st.zone;
        engine.renderer.domElement.dataset.lastShot = JSON.stringify(lastShot); // (read by automated play-tests)
        hideAim();
        if (!res) return;
        ball.pos.copy(spawn);
        ball.prev.copy(spawn);
        ball.active = true;
        ball.resolved = false;
        ball.rimHits = 0;
        ball.bank = false;
        ball.flame = st.flame;
        ball.mesh.material = ball.flame ? flameMat : ballMat;
        ball.perfect = res.perfect;
        ball.age = 0;
        ball.bounces = 0;
        ball.mesh.visible = true;
        ball.mesh.position.copy(spawn);
        st.shots += 1;
        st.reload = RELOAD;
        sound.playJump();
        haptic('light');
        throwT = 0.45;
        feel.kick(0.25);
      };

      const flameOut = () => {
        const st = sim.current;
        if (st.flame) popups.current?.banner('FLAME OUT', '#94a3b8');
        st.flame = false;
        st.swishRun = 0;
      };

      const score = (ball: Ball) => {
        const st = sim.current;
        st.makes += 1;
        st.streak += 1;
        st.bestStreak = Math.max(st.bestStreak, st.streak);
        const swish = ball.rimHits === 0 && !ball.bank;
        // Swish 2 · bank shot or rim shot 1 · flame-ball swish 6.
        const kind = swish ? (ball.flame ? 'flame' : 'swish') : ball.bank ? 'bank' : 'rim';
        const value = kind === 'flame' ? PTS_FLAME_SWISH : kind === 'swish' ? PTS_SWISH : PTS_OTHER;
        const label = kind === 'flame' ? 'Flame swishes' : kind === 'swish' ? 'Swishes' : kind === 'bank' ? 'Bank shots' : 'Rim shots';
        const a = award(value, {});
        st.book.record(a, { [label]: value });
        st.score = st.book.score;
        if (swish) st.swishes += 1;
        if (ball.bank) st.banks += 1;
        if (kind === 'flame') st.flames += 1;

        // Feedback
        netKick = 1;
        sound.playSwish();
        haptic(swish ? 'big' : 'score');
        engine.flash(kind === 'flame' ? 1 : swish ? 0.6 : 0.3);
        rimCenter.set(hoopX, RIM_Y, HOOP_Z);
        particles.emit(rimCenter, kind === 'flame' ? 0xff6a1a : swish ? 0xffd34d : 0x5fe8ff, { count: kind === 'flame' ? 50 : swish ? 30 : 16, speed: 4.5, life: 0.7 });
        if (kind === 'flame') flames.emit(rimCenter, 0xff5a1f, { count: 40, speed: 3.5, life: 0.8, gravity: -4, size: 1.6 });
        launchFireworks(kind === 'flame' ? 6 : swish ? 3 : 2);
        const p = engine.toScreen(rimCenter);
        popups.current?.pop(`+${value}`, p.x, p.y - 30, popStyle(value, kind === 'flame' ? 'jackpot' : swish ? 'bonus' : undefined));
        popups.current?.pop(kind === 'flame' ? '🔥 FLAME SWISH' : kind === 'swish' ? 'SWISH!' : kind === 'bank' ? 'BANK SHOT' : 'RIM SHOT', p.x, p.y + 10, {
          color: kind === 'flame' ? '#fb923c' : kind === 'swish' ? '#7dd3fc' : kind === 'bank' ? '#c4b5fd' : '#fde68a',
          size: kind === 'flame' ? 'md' : 'sm',
        });
        if (swish) feel.kick(kind === 'flame' ? 0.6 : 0.35);

        // Flame ball: three swishes in a row light it; anything but a swish puts it out.
        if (swish) {
          st.swishRun += 1;
          if (!st.flame && st.swishRun >= FLAME_AFTER) {
            st.flame = true;
            popups.current?.banner('🔥 FLAME BALL — SWISH FOR 6', '#f97316');
            sound.playCombo(3);
            haptic('big');
          }
        } else flameOut();

        // Level up → hoop starts moving; shot spot shifts (seeded, same for every player)
        const nextLevel = LEVELS.reduce((lv, l, i) => (st.makes >= l.makes ? i : lv), 0);
        if (nextLevel > st.level) {
          st.level = nextLevel;
          popups.current?.banner(`LEVEL ${nextLevel + 1}`, '#5fe8ff');
        }
        newSpot();
        pushHud({ score: st.score, streak: st.streak, level: st.level, swishRun: st.swishRun, flame: st.flame }, true);
      };

      const miss = () => {
        const st = sim.current;
        st.streak = 0;
        flameOut();
        pushHud({ streak: 0, swishRun: 0, flame: false }, true);
      };

      const finish = () => {
        const st = sim.current;
        st.playing = false;
        hideAim();
        land.visible = false;
        sound.playBuzzer();
        buzzT = 1.4;
        paintBoards(0, st.score);
        haptic('fail');
        const breakdown = st.book.breakdown();
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
            popups.current?.banner('FINAL 10 SECONDS', '#ef4444');
            haptic('big');
          }
          // shot-clock beeps through the last five seconds
          const whole = Math.ceil(st.timeLeft);
          if (whole <= 5 && whole >= 1 && whole < st.lastBeep) {
            st.lastBeep = whole;
            sound.playBeep(whole === 1);
          }
          pushHud({ timeLeft: Math.max(0, st.timeLeft), clutch: st.timeLeft <= CLUTCH_SECONDS });
          if (st.timeLeft <= 0) finish();
        }

        paintBoards(Math.max(0, st.timeLeft), st.score);
        if (buzzT > 0) {
          buzzT = Math.max(0, buzzT - dt);
          buzzMat.color.setHex(0xff2020).multiplyScalar(Math.floor(buzzT * 8) % 2 ? 3 : 0.4);
        }

        // Hoop glide (deterministic per seed): a smooth side-to-side ease with brief holds at each
        // end. Its reach is capped by your distance so the net always stays in view.
        const lv = LEVELS[st.level];
        hoopPhase += lv.speed * dt;
        const spotD = Math.hypot(spawn.x - hoopX, spawn.z - HOOP_Z);
        const amp = Math.min(lv.amp, spotD * Math.tan(THREE.MathUtils.degToRad(17)));
        const sw = Math.sin(hoopPhase);
        const targetX = amp * Math.sign(sw) * Math.pow(Math.abs(sw), 0.7);
        hoopX += (targetX - hoopX) * Math.min(1, dt * 3);
        hoop.position.x = hoopX;

        // Ready ball bob
        readyBall.visible = st.playing ? st.reload === 0 : true;
        readyBall.position.set(spawn.x, spawn.y + Math.sin(t * 3) * 0.03, spawn.z);
        readyBall.rotation.y += dt;
        readyShadow.position.set(spawn.x, 0.02, spawn.z);
        readyBall.material = st.flame ? flameMat : ballMat;
        flameMat.emissiveIntensity = 1.4 + Math.sin(t * 23) * 0.3;
        // flames lick up off the ball in your hands while the flame ball is lit
        if (st.flame && readyBall.visible && Math.random() < dt * 30) flames.emit(readyBall.position, Math.random() < 0.5 ? 0xff5a1f : 0xffb02e, { count: 1, speed: 0.5, life: 0.4, gravity: -3, size: 0.5 });

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
              b.vel.z *= -0.72; // lively glass: slight overshoots bank in, big ones bounce out
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
          if (b.flame && !b.resolved) flames.emit(b.pos, Math.random() < 0.5 ? 0xff4a00 : 0xffb02e, { count: 3, speed: 0.6, life: 0.35, size: 0.6, gravity: -2 });
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

        // First-person camera at the shot spot (follows it when it shifts), gentle breathing sway.
        view.camX += (spawn.x - view.camX) * Math.min(1, dt * 3);
        view.camZ += (spawn.z - view.camZ) * Math.min(1, dt * 3);
        const off = feel.update(dt, t, 0);
        const breathe = Math.sin(t * 1.3) * 0.006;
        camera.position.set(view.camX * 1.12 + off.x, EYE.y + breathe + off.y, view.camZ + EYE.back);
        // Closer spots tilt the view up so the rim sits comfortably in frame, not under the HUD.
        const spotDist = Math.hypot(view.camX, view.camZ - HOOP_Z);
        view.lookY += (view.baseLook + THREE.MathUtils.clamp((7.6 - spotDist) / 4.3, 0, 1) * 0.85 - view.lookY) * Math.min(1, dt * 3);
        // look toward the hoop (not just straight ahead) so the net never slides out of frame
        view.look += (THREE.MathUtils.lerp(view.camX, hoopX, 0.65) - view.look) * Math.min(1, dt * 4);
        camera.lookAt(view.look, view.lookY, HOOP_Z);

        // Arms: cradle the ball, then push up and through on the shot.
        arms.ready(t);
        if (throwT > 0) {
          throwT = Math.max(0, throwT - dt);
          const k = Math.sin((1 - throwT / 0.45) * Math.PI); // 0 → 1 → 0
          for (const a of [arms.left, arms.right]) {
            a.pivot.position.y += k * 0.16;
            a.pivot.position.z -= k * 0.18;
            a.pivot.rotation.x = k * 0.9;
          }
        } else if (!readyBall.visible) {
          // Reloading: hands drop to catch the next ball.
          arms.left.pivot.position.y -= 0.05;
          arms.right.pivot.position.y -= 0.05;
        }
        arms.setGlow(st.flame ? 1.5 : 0);

        // flame light rides the flame ball (in flight, or in your hands)
        const flying = balls.find((bb) => bb.active && bb.flame && !bb.resolved);
        if (flying) flameLight.position.copy(flying.pos);
        else flameLight.position.copy(readyBall.position);
        flameLight.intensity = st.flame || flying ? 3 + Math.sin(t * 30) * 0.8 : 0;
        const auraAt = flying ? flying.pos : st.flame && readyBall.visible ? readyBall.position : null;
        auraOuter.visible = auraInner.visible = !!auraAt;
        if (auraAt) {
          const fl = 1 + Math.sin(t * 31) * 0.08 + Math.sin(t * 13) * 0.06;
          // flames stream back from a flying ball; straight up from the one in your hands
          const trail = flying ? tmp.copy(flying.vel).normalize().multiplyScalar(-0.12) : tmp.set(0, 0, 0);
          auraOuter.position.set(auraAt.x + trail.x, auraAt.y + 0.1 + trail.y * 0.5, auraAt.z + trail.z);
          auraOuter.scale.set(0.56 * fl, 0.95 * fl, 1);
          auraInner.position.set(auraAt.x, auraAt.y + 0.05, auraAt.z);
          auraInner.scale.set(0.36 * fl, 0.6 * fl, 1);
        }

        // fireworks: shells rise trailing sparks, then burst
        for (let i = shells.length - 1; i >= 0; i--) {
          const sh = shells[i];
          sh.fuse -= dt;
          sh.vel.y -= 6 * dt;
          sh.pos.addScaledVector(sh.vel, dt);
          if (Math.random() < 0.6) fireworks.emit(sh.pos, 0xffe2b0, { count: 1, speed: 0.3, life: 0.3, gravity: 2, size: 0.8 });
          if (sh.fuse <= 0) {
            fireworks.emit(sh.pos, sh.color, { count: 60, speed: 6, life: 1.3, gravity: 2, size: 2.4 });
            fireworks.emit(sh.pos, 0xffffff, { count: 12, speed: 3, life: 0.6, gravity: 2, size: 1 });
            shells.splice(i, 1);
          }
        }
      });

      return () => {
        meter.remove();
        resetRef.current = () => {};
        shootRef.current = () => {};
        aimRef.current = () => {};
      };
    },
    [stableAvatar],
  );

  const chips = (
    <>
      {hud.flame ? (
        <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-orange-500 text-black text-[11px] font-black whitespace-nowrap animate-pulse" data-testid="dunk-flame">
          <Flame className="w-3 h-3" /> FLAME ×6
        </span>
      ) : (
        hud.swishRun > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-black/50 text-sky-200 text-[11px] font-black whitespace-nowrap" data-testid="dunk-swish-run">
            SWISH {hud.swishRun}/{FLAME_AFTER}
          </span>
        )
      )}
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-black whitespace-nowrap ${ZONES[hud.zone].bonus ? 'bg-amber-400 text-black' : 'bg-black/50 text-white'}`} data-testid="dunk-zone">
        {ZONES[hud.zone].label} · {ZONES[hud.zone].dist.toFixed(1)}m
      </span>
      {hud.level > 0 && <span className="px-2 py-0.5 rounded-full bg-cyan-400/90 text-black text-[11px] font-black whitespace-nowrap">LVL {hud.level + 1}</span>}
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
      hint="Drag up for power · slide to aim · let go to shoot"
      guide={{
        goal: 'Sink as many baskets as you can before the clock runs out.',
        controls: [
          { gesture: 'drag', label: 'Touch anywhere and drag up — longer pull = farther shot (watch the meter)' },
          { gesture: 'swipe-x', label: 'Slide left / right while you pull to aim' },
          { gesture: 'release', label: 'Let go to shoot · pull back down to cancel' },
        ],
        points: [
          { label: 'Swish (nothing but net)', value: '2', tone: 'bonus' },
          { label: 'Bank shot / rim shot', value: '1' },
          { label: '3 swishes in a row', value: '🔥 flame ball', tone: 'fire' },
          { label: 'Flame-ball swish', value: '6', tone: 'gold' },
        ],
        ends: '60-second round on the shot clock · the buzzer ends it · the hoop starts moving',
      }}
      tutorial={[
        { icon: <ArrowUp className="w-6 h-6" />, label: 'Drag up, let go' },
        { icon: <MoveHorizontal className="w-6 h-6" />, label: 'Slide to aim' },
        { icon: <Flame className="w-6 h-6" />, label: '3 swishes = flame ball' },
      ]}
      scoring="Swish (nothing but net) 2 · Bank shot or rim shot 1 · Three swishes in a row light the FLAME BALL: a flaming swish is worth 6, and anything but a swish puts the flame out. Touch anywhere and drag up: the longer the pull the farther the shot — the meter on the right shows your power. Slide sideways to aim, and let go to shoot (pull back down to cancel). Shot spots move between close, mid-range, 3-point and deep, the aim help and arc preview fade, and the hoop starts gliding side to side as you score. The arena shot clock runs 60 seconds; the buzzer ends the round."
    />
  );
}
