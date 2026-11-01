'use client';

import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import {
  CameraFeel,
  ParticleBursts,
  addArenaLights,
  createFirstPersonRig,
  createNeonGridFloor,
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
import { Crosshair, Hand, CirclePlus } from 'lucide-react';

/**
 * BRICK BLITZ 3D — aim-and-launch brick breaker in first person.
 *
 * You stand behind the launcher looking down the brick lane. Point where to fire (drag), release
 * to launch the volley. Every brick shows the hits it needs; each turn the wall moves one row
 * closer. Grab "+1" rings for more balls. Seeded rows: same wall for every player.
 *
 * Rules and scoring are identical to the original canvas edition; the simulation runs in board
 * units (1 = one cell, x 0…COLS left→right, y 0…ROWS far→near) and is drawn on the 3D floor.
 */

const COLS = 7;
const ROWS = 10; // row ROWS-1 is the danger line
const ROUND_SECONDS = 90;
const CLUTCH_SECONDS = 10;
const START_BALLS = 5;
/** One free save: the first time the wall reaches the line, the bottom rows are blasted away. */
const SAVES = 1;
const FIRE_GAP = 0.065; // s between balls in a volley
const MIN_ANGLE = (10 * Math.PI) / 180;
const HIT_POINTS = 10;
const BREAK_POINTS = 40;
const CLEAR_BONUS = 1000;
const STAR_POINTS = 250;
const BALL_R = 0.13;
const MAX_BRICKS = COLS * ROWS;
const MAX_BALLS = 300;
const BRICK_H = 0.62;

type Brick = { kind: 'brick'; hp: number; max: number; flash: number };
type Cell = Brick | { kind: 'ball' } | { kind: 'star' };

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  live: boolean;
}

/** Brick colour by toughness: cyan → violet → hot pink. */
const hueFor = (hp: number, turn: number) => {
  const k = Math.min(1, hp / Math.max(4, turn * 1.3));
  return (190 + k * 150) % 360;
};

/** Board units → world (floor at y = 0, launcher row at z = 0, far wall at z = -ROWS). */
const wx = (x: number) => x - COLS / 2;
const wz = (y: number) => y - ROWS;

function makeNumberTexture(n: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = `900 ${n >= 100 ? 56 : 74}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(8,8,20,0.85)';
  g.strokeText(String(n), 64, 68);
  g.fillStyle = '#ffffff';
  g.fillText(String(n), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export default function BrickBlitz3DGame({ avatar, onFinish, seed, rival, match, onExit }: GameProps) {
  const stableAvatar = useStructuralMemo(avatar);
  const seedRef = useLatest(seed);
  const onFinishRef = useLatest(onFinish);
  const popups = useRef<PopupApi | null>(null);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'over'>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, balls: START_BALLS, turn: 1, timeLeft: ROUND_SECONDS, clutch: false, combo: 0, saves: SAVES });
  const api = useRef<{ start: () => void; drag: (s: Swipe, p: 'start' | 'move' | 'end') => void; tap: () => void }>({ start: () => {}, drag: () => {}, tap: () => {} });

  const { hostRef } = useGameEngine(
    {
      background: 0x07061a,
      fog: { density: 0.018 },
      camera: { fov: 70, near: 0.03, far: 120, position: [0, 7.6, 4.6], lookAt: [0, 0, -4.3] },
      exposure: 1.15,
      bloom: { strength: 0.55, radius: 0.3, threshold: 0.86 },
      environment: 0.65,
      studio: { top: 0x1c1440, left: 0x22d3ee, right: 0xf472b6 },
    },
    (engine) => {
      const { scene, camera, quality } = engine;
      let rng = mulberry32(seedRef.current ?? randomSeed());

      // ------------------------------------------------------------- camera (first person)
      // You stand behind the launcher and look down the lane. The lens is fitted so the whole
      // 7-wide lane (including the nearest row) stays on screen on any phone.
      const view = { y: 7.6, z: 4.6, fov: 70 };
      engine.onResize((_w, _h, aspect) => {
        if (aspect < 0.62) Object.assign(view, { y: 7.6, z: 4.6, fov: 74 });
        else if (aspect < 0.85) Object.assign(view, { y: 7.2, z: 4.6, fov: 66 });
        else Object.assign(view, { y: 6.6, z: 4.8, fov: 54 });
        camera.fov = view.fov;
        camera.updateProjectionMatrix();
      });
      const feel = new CameraFeel();
      let camX = 0;

      // ------------------------------------------------------------- arena
      addArenaLights(engine, { sky: 0xa5b4fc, ground: 0x160f2e, hemi: 1.0, key: 2.0, keyPos: [4, 14, 6], rim: 0xf472b6, shadowFrustum: 8 });
      scene.add(createStarfield(engine, { count: 500, radius: 60, yMin: 4 }));

      const lane = createNeonGridFloor(engine, { width: COLS, length: ROWS, cells: [COLS, ROWS], color: '#6d7cff', lineWidth: 2, glow: 0.35, gloss: 1 });
      lane.mesh.position.set(0, 0, -ROWS / 2);
      scene.add(lane.mesh);
      const outer = createNeonGridFloor(engine, { width: 40, length: 40, cells: [20, 20], color: '#2b1f5c', lineWidth: 1, glow: 0.2 });
      outer.mesh.position.set(0, -0.02, -6);
      scene.add(outer.mesh);

      // Walls: side rails + back wall, glowing edges.
      const wallMat = new THREE.MeshPhysicalMaterial({ color: 0x15132e, roughness: 0.3, metalness: 0.6, clearcoat: 0.8, clearcoatRoughness: 0.12 });
      [-1, 1].forEach((side) => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, ROWS + 0.25), wallMat);
        wall.position.set(side * (COLS / 2 + 0.125), 0.35, -ROWS / 2);
        wall.receiveShadow = quality.shadows;
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, ROWS + 0.25), neonMaterial(side < 0 ? 0x22d3ee : 0xf472b6, 1.8));
        edge.position.set(side * (COLS / 2 + 0.125), 0.72, -ROWS / 2);
        scene.add(wall, edge);
      });
      const back = new THREE.Mesh(new THREE.BoxGeometry(COLS + 0.5, 0.7, 0.25), wallMat);
      back.position.set(0, 0.35, -ROWS - 0.125);
      const backEdge = new THREE.Mesh(new THREE.BoxGeometry(COLS + 0.5, 0.06, 0.06), neonMaterial(0xa78bfa, 1.8));
      backEdge.position.set(0, 0.72, -ROWS - 0.125);
      scene.add(back, backEdge);

      // Danger zone (last row) — pulses when the wall is one row away.
      const dangerMat = new THREE.MeshBasicMaterial({ color: 0xff3366, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false });
      const danger = new THREE.Mesh(new THREE.PlaneGeometry(COLS, 1), dangerMat);
      danger.rotation.x = -Math.PI / 2;
      danger.position.set(0, 0.012, wz(ROWS - 0.5));
      const dangerLine = new THREE.Mesh(new THREE.BoxGeometry(COLS, 0.03, 0.05), neonMaterial(0xff3366, 1.6));
      dangerLine.position.set(0, 0.02, wz(ROWS - 1));
      scene.add(danger, dangerLine);

      // ------------------------------------------------------------- bricks (1 instanced draw)
      const brickGeo = engine.own(new RoundedBoxGeometry(0.9, BRICK_H, 0.9, 3, 0.1));
      const brickMat = engine.own(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.6 }));
      const bricks = new THREE.InstancedMesh(brickGeo, brickMat, MAX_BRICKS);
      bricks.castShadow = quality.shadows;
      bricks.receiveShadow = quality.shadows;
      bricks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      bricks.frustumCulled = false;
      // Create the per-instance colour buffer up front so the shader is compiled with it.
      for (let i = 0; i < MAX_BRICKS; i++) bricks.setColorAt(i, new THREE.Color(0xffffff));
      bricks.count = 0;
      scene.add(bricks);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      const col = new THREE.Color();

      // Hit-count labels on top of each brick (shared texture per number).
      const labelGeo = engine.own(new THREE.PlaneGeometry(0.95, 0.95));
      // Tilted up toward the player so numbers stay readable from the launcher.
      labelGeo.rotateX(-Math.PI / 2 + 0.55);
      const labelMats = new Map<number, THREE.MeshBasicMaterial>();
      const labelMat = (n: number) => {
        let m = labelMats.get(n);
        if (!m) {
          m = engine.own(new THREE.MeshBasicMaterial({ map: engine.own(makeNumberTexture(n)), transparent: true, depthWrite: false, toneMapped: false, fog: false }));
          labelMats.set(n, m);
        }
        return m;
      };
      const labels: THREE.Mesh[] = Array.from({ length: MAX_BRICKS }, () => {
        const m = new THREE.Mesh(labelGeo);
        m.visible = false;
        m.renderOrder = 2;
        scene.add(m);
        return m;
      });

      // Pickups: +1 ball rings and stars.
      const ringGeo = engine.own(new THREE.TorusGeometry(0.26, 0.035, 10, 40));
      const ringMat = engine.own(neonMaterial(0xffffff, 1.6));
      const dotGeo = engine.own(new THREE.SphereGeometry(0.1, 16, 12));
      const starShape = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.13 : 0.3;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const starGeo = engine.own(new THREE.ExtrudeGeometry(starShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }));
      starGeo.center();
      const starMat = engine.own(new THREE.MeshPhysicalMaterial({ color: 0xfacc15, emissive: 0xf59e0b, emissiveIntensity: 0.7, metalness: 0.8, roughness: 0.2, clearcoat: 1 }));
      const pickupPool: THREE.Group[] = [];
      const pickupsInUse: THREE.Group[] = [];
      const takePickup = (kind: 'ball' | 'star') => {
        let g = pickupPool.find((p) => p.userData.kind === kind);
        if (g) pickupPool.splice(pickupPool.indexOf(g), 1);
        else {
          g = new THREE.Group();
          g.userData.kind = kind;
          if (kind === 'ball') {
            const ring = new THREE.Mesh(ringGeo, ringMat);
            const dot = new THREE.Mesh(dotGeo, ringMat);
            g.add(ring, dot);
          } else {
            g.add(new THREE.Mesh(starGeo, starMat));
          }
        }
        g.visible = true;
        scene.add(g);
        pickupsInUse.push(g);
        return g;
      };

      // Balls (1 instanced draw).
      const ballGeo = engine.own(new THREE.SphereGeometry(BALL_R, 16, 12));
      const ballMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9ff3ff, emissiveIntensity: 1.1, roughness: 0.2, metalness: 0.1 }));
      const ballMesh = new THREE.InstancedMesh(ballGeo, ballMat, MAX_BALLS);
      ballMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      ballMesh.frustumCulled = false;
      ballMesh.count = 0;
      scene.add(ballMesh);

      // Launcher pad + the ball waiting on it + ball count label.
      const launcher = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.12, 32), new THREE.MeshPhysicalMaterial({ color: 0x1b1b34, metalness: 0.8, roughness: 0.25, clearcoat: 1 }));
      pad.position.y = 0.06;
      const padRing = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.03, 8, 48), neonMaterial(0x22d3ee, 2));
      padRing.rotation.x = Math.PI / 2;
      padRing.position.y = 0.13;
      const readyBall = new THREE.Mesh(ballGeo, ballMat);
      readyBall.scale.setScalar(1.35);
      readyBall.position.y = 0.32;
      launcher.add(pad, padRing, readyBall);
      scene.add(launcher);
      const ghost = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
      ghost.visible = false;
      scene.add(ghost);
      const countCanvas = document.createElement('canvas');
      countCanvas.width = 256;
      countCanvas.height = 96;
      const countTex = engine.own(new THREE.CanvasTexture(countCanvas));
      countTex.colorSpace = THREE.SRGBColorSpace;
      const countSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: countTex, transparent: true, depthTest: false, toneMapped: false }));
      countSprite.scale.set(1.3, 0.49, 1);
      countSprite.renderOrder = 5;
      scene.add(countSprite);
      let shownCount = -1;
      const drawCount = (n: number) => {
        if (n === shownCount) return;
        shownCount = n;
        const g = countCanvas.getContext('2d')!;
        g.clearRect(0, 0, 256, 96);
        if (n > 0) {
          g.font = '900 64px system-ui, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.lineWidth = 10;
          g.strokeStyle = 'rgba(0,0,0,0.75)';
          g.strokeText(`×${n}`, 128, 50);
          g.fillStyle = '#ffffff';
          g.fillText(`×${n}`, 128, 50);
        }
        countTex.needsUpdate = true;
      };

      // Aim guide (dotted path to the first bounces).
      const AIM_DOTS = 90;
      const aimPos = new Float32Array(AIM_DOTS * 3);
      const aimGeo = new THREE.BufferGeometry();
      aimGeo.setAttribute('position', new THREE.BufferAttribute(aimPos, 3));
      const aimDots = new THREE.Points(aimGeo, new THREE.PointsMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(1.5), size: 0.09, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
      aimDots.frustumCulled = false;
      aimDots.visible = false;
      scene.add(aimDots);

      const particles = new ParticleBursts(engine);

      // Your arms: the right hand points where you aim.
      const arms = createFirstPersonRig(engine, stableAvatar, { spread: 0.31, drop: 0.5, depth: 0.5 });
      let push = 0;

      // ------------------------------------------------------------- game state
      let grid: (Cell | null)[][] = [];
      let balls: Ball[] = [];
      let ballCount = START_BALLS;
      let launchX = COLS / 2;
      let nextLaunchX: number | null = null;
      let turn = 1;
      let state: 'idle' | 'aim' | 'volley' | 'drop' | 'over' = 'idle';
      let aimAng: number | null = null;
      let toFire = 0;
      let fireTimer = 0;
      let fireAngle = 0;
      let volleyTime = 0;
      let volleyHits = 0;
      let dropAnim = 0;
      let pendingBalls = 0;
      let saves = SAVES;
      let hudAcc = 0;
      const s = { score: 0, timeLeft: ROUND_SECONDS, clutchAnnounced: false, playing: false, pHits: 0, pBreaks: 0, pClears: 0, pStars: 0, pClutch: 0, pCombo: 0, broken: 0, bestVolley: 0 };
      const launchY = ROWS - 0.02;
      const tmp = new THREE.Vector3();

      const award = (base: number, cat: 'pHits' | 'pBreaks' | 'pClears' | 'pStars', mult = 1) => {
        const clutchOn = s.timeLeft <= CLUTCH_SECONDS;
        const withCombo = Math.round(base * mult);
        const total = clutchOn ? withCombo * 2 : withCombo;
        s[cat] += base;
        s.pCombo += withCombo - base;
        s.pClutch += total - withCombo;
        s.score += total;
        return total;
      };

      const spawnRow = () => {
        const row: (Cell | null)[] = new Array(COLS).fill(null);
        // Difficulty curve: soft bricks and sparse rows early, full-strength walls from row ~14.
        const tough = turn >= 8 && rng() < 0.3;
        let count = turn < 5 ? 1 + Math.floor(rng() * 3) : turn < 10 ? 2 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 4);
        if (turn > 14) count = Math.min(6, count + 1);
        const base = Math.max(1, Math.round(turn * Math.min(1, 0.45 + turn * 0.04)));
        const cols = [...Array(COLS).keys()].sort(() => rng() - 0.5);
        for (let i = 0; i < count; i++) {
          const hp = tough && rng() < 0.4 ? base * 2 : base;
          row[cols[i]] = { kind: 'brick', hp, max: hp, flash: 0 };
        }
        row[cols[count]] = { kind: 'ball' };
        if (turn % 4 === 0 && count + 1 < COLS) row[cols[count + 1]] = { kind: 'star' };
        return row;
      };

      const reset = () => {
        rng = mulberry32(seedRef.current ?? randomSeed());
        grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
        turn = 1;
        grid[1] = spawnRow();
        turn = 2;
        grid[0] = spawnRow();
        ballCount = START_BALLS;
        saves = SAVES;
        launchX = COLS / 2;
        balls = [];
        state = 'idle';
        aimAng = null;
        particles.clear();
        Object.assign(s, { score: 0, timeLeft: ROUND_SECONDS, clutchAnnounced: false, playing: false, pHits: 0, pBreaks: 0, pClears: 0, pStars: 0, pClutch: 0, pCombo: 0, broken: 0, bestVolley: 0 });
      };
      reset();

      const finish = (reason: 'time' | 'wall') => {
        if (!s.playing) return;
        s.playing = false;
        state = 'over';
        aimDots.visible = false;
        if (reason === 'wall') {
          popups.current?.banner('WALL DOWN!', '#fb7185');
          feel.kick(1);
          sound.playLose();
          haptic('fail');
        } else {
          sound.playWin();
          haptic('big');
        }
        const breakdown = [
          { label: `Brick hits`, points: s.pHits },
          { label: `Bricks broken (${s.broken})`, points: s.pBreaks },
          { label: `Volley combo (best ${s.bestVolley} hits)`, points: s.pCombo },
          { label: 'Board clears', points: s.pClears },
          { label: 'Stars', points: s.pStars },
          { label: 'Clutch time ×2', points: s.pClutch },
        ].filter((b) => b.points > 0);
        pushHud({ score: s.score, timeLeft: Math.max(0, s.timeLeft), clutch: false }, true);
        setPhase('over');
        setTimeout(() => onFinishRef.current(s.score, { maxCombo: s.bestVolley, breakdown }), reason === 'wall' ? 900 : 300);
      };

      const popAt = (x: number, y: number, text: string, color: string, size: 'sm' | 'md' | 'lg' = 'sm') => {
        const p = engine.toScreen(tmp.set(wx(x), BRICK_H + 0.2, wz(y)));
        popups.current?.pop(text, p.x, p.y, { color, size });
      };

      // ------------------------------------------------------------- input: point at the floor to aim
      const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const hitPoint = new THREE.Vector3();
      const aimFromPointer = (px: number, py: number) => {
        const r = engine.renderer.domElement.getBoundingClientRect();
        ndc.set((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        if (!ray.ray.intersectPlane(floorPlane, hitPoint)) return Math.PI / 2;
        const bx = hitPoint.x + COLS / 2;
        const by = hitPoint.z + ROWS;
        let ang = Math.atan2(launchY - by, bx - launchX); // 0 = right, PI/2 = straight up the lane
        if (by > launchY - 0.15) ang = bx < launchX ? Math.PI - MIN_ANGLE : MIN_ANGLE; // pointing behind the launcher: clamp flat
        return Math.min(Math.PI - MIN_ANGLE, Math.max(MIN_ANGLE, ang));
      };

      api.current.start = () => {
        reset();
        s.playing = true;
        state = 'idle';
        pushHud({ score: 0, balls: ballCount, turn: 1, timeLeft: ROUND_SECONDS, clutch: false, combo: 0, saves: SAVES }, true);
        setPhase('playing');
      };

      api.current.drag = (sw, p) => {
        if (!s.playing) return;
        if (state !== 'idle' && state !== 'aim') return;
        if (p === 'start') {
          state = 'aim';
          aimAng = aimFromPointer(sw.endX, sw.endY);
        } else if (p === 'move' && state === 'aim') {
          aimAng = aimFromPointer(sw.endX, sw.endY);
        } else if (p === 'end' && state === 'aim') {
          const ang = aimFromPointer(sw.endX, sw.endY);
          aimAng = null;
          // A tiny tap right on the launcher is a cancel, not a shot (a tap anywhere else fires there).
          const lp = engine.toScreen(tmp.set(wx(launchX), 0.3, wz(launchY)));
          if (Math.hypot(sw.dx, sw.dy) < 6 && sw.durationMs < 200 && Math.hypot(sw.endX - lp.x, sw.endY - lp.y) < 40) {
            state = 'idle';
            return;
          }
          state = 'volley';
          fireAngle = ang;
          toFire = ballCount;
          fireTimer = 0;
          volleyTime = 0;
          volleyHits = 0;
          nextLaunchX = null;
          pendingBalls = 0;
          balls = [];
          push = 1;
          feel.kick(0.2);
          sound.playLaser();
          haptic('tap');
        }
      };
      // Tap during a volley = fast-forward.
      api.current.tap = () => {
        if (state === 'volley') volleyTime = Math.max(volleyTime, 2.6);
      };

      // ------------------------------------------------------------- physics (board units)
      const hitBrick = (row: number, colIdx: number, c: Brick) => {
        c.hp -= 1;
        c.flash = 1;
        volleyHits += 1;
        const mult = 1 + Math.min(2, Math.floor(volleyHits / 12) * 0.25);
        award(HIT_POINTS, 'pHits', mult);
        if (volleyHits % 3 === 0) sound.playScore(1 + Math.min(1.2, volleyHits / 60));
        if (c.hp <= 0) {
          grid[row][colIdx] = null;
          s.broken += 1;
          const pts = award(BREAK_POINTS + Math.min(160, c.max * 4), 'pBreaks', mult);
          const hue = hueFor(c.max, turn);
          popAt(colIdx + 0.5, row + 0.5, `+${pts}`, `hsl(${hue} 95% 70%)`, c.max >= turn * 2 ? 'md' : 'sm');
          particles.emit(tmp.set(wx(colIdx + 0.5), BRICK_H / 2, wz(row + 0.5)), col.setHSL(hue / 360, 0.95, 0.6).getHex(), { count: 16, speed: 4, life: 0.6 });
          engine.flash(0.15);
          haptic('light');
          feel.kick(0.25);
          if (!grid.some((rw) => rw.some((x) => x?.kind === 'brick'))) {
            const pts2 = award(CLEAR_BONUS, 'pClears');
            popups.current?.banner(`BOARD CLEAR +${pts2}`, '#34d399');
            engine.flash(0.8);
            sound.playPowerup();
            haptic('big');
          }
        }
      };

      const stepBall = (b: Ball, dt: number) => {
        const R = BALL_R;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < R) {
          b.x = R;
          b.vx = Math.abs(b.vx);
        } else if (b.x > COLS - R) {
          b.x = COLS - R;
          b.vx = -Math.abs(b.vx);
        }
        if (b.y < R) {
          b.y = R;
          b.vy = Math.abs(b.vy);
        }
        const cr = Math.floor(b.y);
        const cc = Math.floor(b.x);
        for (let row = cr - 1; row <= cr + 1; row++) {
          if (row < 0 || row >= ROWS) continue;
          for (let c2 = cc - 1; c2 <= cc + 1; c2++) {
            if (c2 < 0 || c2 >= COLS) continue;
            const c = grid[row][c2];
            if (!c) continue;
            if (c.kind !== 'brick') {
              if (Math.hypot(b.x - (c2 + 0.5), b.y - (row + 0.5)) < R + 0.22) {
                grid[row][c2] = null;
                if (c.kind === 'ball') {
                  pendingBalls += 1;
                  popAt(c2 + 0.5, row + 0.5, '+1 BALL', '#ffffff');
                  sound.playJump();
                } else {
                  const pts = award(STAR_POINTS, 'pStars');
                  popAt(c2 + 0.5, row + 0.5, `★ +${pts}`, '#facc15', 'md');
                  particles.emit(tmp.set(wx(c2 + 0.5), 0.4, wz(row + 0.5)), 0xfacc15, { count: 18, speed: 4 });
                  sound.playPowerup();
                }
                haptic('light');
              }
              continue;
            }
            const padding = 0.05;
            const x0 = c2 + padding;
            const x1 = c2 + 1 - padding;
            const y0 = row + padding;
            const y1 = row + 1 - padding;
            const nx = Math.max(x0, Math.min(b.x, x1));
            const ny = Math.max(y0, Math.min(b.y, y1));
            const dx = b.x - nx;
            const dy = b.y - ny;
            const d2 = dx * dx + dy * dy;
            if (d2 >= R * R) continue;
            if (d2 > 1e-9) {
              const d = Math.sqrt(d2);
              const ux = dx / d;
              const uy = dy / d;
              const vn = b.vx * ux + b.vy * uy;
              if (vn < 0) {
                b.vx -= 2 * vn * ux;
                b.vy -= 2 * vn * uy;
              }
              b.x = nx + ux * R;
              b.y = ny + uy * R;
            } else {
              const pen = [b.x - x0, x1 - b.x, b.y - y0, y1 - b.y];
              const m = pen.indexOf(Math.min(...pen));
              if (m === 0) (b.x = x0 - R), (b.vx = -Math.abs(b.vx));
              else if (m === 1) (b.x = x1 + R), (b.vx = Math.abs(b.vx));
              else if (m === 2) (b.y = y0 - R), (b.vy = -Math.abs(b.vy));
              else (b.y = y1 + R), (b.vy = Math.abs(b.vy));
            }
            hitBrick(row, c2, c);
            return; // one hit per substep
          }
        }
        if (Math.abs(b.vy) < 0.6) b.vy = b.vy < 0 ? -0.6 : 0.6; // no endless horizontal loops
        if (b.y >= launchY && b.vy > 0) {
          b.live = false;
          if (nextLaunchX === null) nextLaunchX = Math.min(COLS - 0.3, Math.max(0.3, b.x));
        }
      };

      const endVolley = () => {
        ballCount += pendingBalls;
        pendingBalls = 0;
        launchX = nextLaunchX ?? launchX;
        s.bestVolley = Math.max(s.bestVolley, volleyHits);
        if (volleyHits >= 25) popups.current?.banner(volleyHits >= 60 ? `MEGA VOLLEY ${volleyHits}` : `${volleyHits} HIT VOLLEY`, '#22d3ee');
        grid.pop();
        turn += 1;
        grid.unshift(spawnRow());
        dropAnim = 1;
        state = 'drop';
        pushHud({ balls: ballCount, turn: turn - 1, combo: 0 });
        const last = grid[ROWS - 1];
        if (last.some((c) => c?.kind === 'brick')) {
          if (saves > 0) {
            saves -= 1;
            for (let r = ROWS - 3; r < ROWS; r++)
              for (let c = 0; c < COLS; c++) {
                if (grid[r][c]?.kind === 'brick') particles.emit(tmp.set(wx(c + 0.5), BRICK_H / 2, wz(r + 0.5)), 0xfb7185, { count: 10, speed: 5 });
                grid[r][c] = null;
              }
            feel.kick(1);
            engine.flash(1);
            popups.current?.banner('SHIELD SAVE!', '#fb7185');
            sound.playPowerup();
            haptic('big');
            pushHud({ saves });
          } else {
            finish('wall');
            return;
          }
        }
        last.forEach((c, i) => {
          if (c && c.kind === 'ball') {
            ballCount += 1;
            last[i] = null;
          } else if (c && c.kind === 'star') last[i] = null;
        });
      };

      /** March a virtual ball to its first contacts for the dotted aim guide. */
      const previewPath = (ang: number) => {
        const R = BALL_R;
        let x = launchX;
        let y = launchY;
        let vx = Math.cos(ang);
        let vy = -Math.sin(ang);
        const pts: [number, number][] = [[x, y]];
        let bounced = 0;
        let travelled = 0;
        const stepLen = 0.05;
        for (let i = 0; i < 600 && bounced < 2; i++) {
          x += vx * stepLen;
          y += vy * stepLen;
          travelled += stepLen;
          if (bounced === 1 && travelled > 2.2) break;
          let hit = false;
          if (x < R || x > COLS - R) {
            vx = -vx;
            hit = true;
          }
          if (y < R) {
            vy = -vy;
            hit = true;
          }
          const row = Math.floor(y);
          const c = Math.floor(x);
          const cell = row >= 0 && row < ROWS && c >= 0 && c < COLS ? grid[row][c] : null;
          if (!hit && cell?.kind === 'brick') {
            const px = x - vx * stepLen;
            const py = y - vy * stepLen;
            if (Math.floor(px) !== c) vx = -vx;
            if (Math.floor(py) !== row) vy = -vy;
            x = px;
            y = py;
            hit = true;
          }
          if (hit) {
            pts.push([x, y]);
            bounced += 1;
            travelled = 0;
          }
          if (y > launchY) break;
        }
        pts.push([x, y]);
        return pts;
      };

      const layoutAim = (ang: number) => {
        const pts = previewPath(ang);
        let n = 0;
        for (let i = 0; i < pts.length - 1 && n < AIM_DOTS; i++) {
          const [ax, ay] = pts[i];
          const [bx, by] = pts[i + 1];
          const len = Math.hypot(bx - ax, by - ay);
          const steps = Math.max(1, Math.floor(len / 0.32));
          for (let k = 1; k <= steps && n < AIM_DOTS; k++) {
            const f = k / steps;
            aimPos[n * 3] = wx(ax + (bx - ax) * f);
            aimPos[n * 3 + 1] = 0.15;
            aimPos[n * 3 + 2] = wz(ay + (by - ay) * f);
            n++;
          }
        }
        aimGeo.setDrawRange(0, n);
        aimGeo.attributes.position.needsUpdate = true;
      };

      // ------------------------------------------------------------- per frame
      engine.addUpdate((dt, t) => {
        if (s.playing) {
          s.timeLeft -= dt;
          if (!s.clutchAnnounced && s.timeLeft <= CLUTCH_SECONDS) {
            s.clutchAnnounced = true;
            popups.current?.banner('CLUTCH TIME ×2', '#fbbf24');
            haptic('big');
          }
          if (s.timeLeft <= 0) finish('time');
        }

        if (state === 'volley') {
          volleyTime += dt;
          const speedMul = volleyTime > 2.5 ? 2.2 : 1; // auto fast-forward long volleys
          const speed = 15 * speedMul;
          fireTimer -= dt;
          while (toFire > 0 && fireTimer <= 0) {
            balls.push({ x: launchX, y: launchY - 0.01, vx: Math.cos(fireAngle) * 15, vy: -Math.sin(fireAngle) * 15, live: true });
            toFire -= 1;
            fireTimer += FIRE_GAP / speedMul;
          }
          const sub = Math.ceil((speed * dt) / (BALL_R * 0.8));
          const h = (dt * speedMul) / sub;
          for (const b of balls) {
            if (!b.live) continue;
            for (let i = 0; i < sub && b.live; i++) stepBall(b, h);
          }
          if (toFire === 0 && balls.every((b) => !b.live)) endVolley();
        } else if (state === 'drop') {
          dropAnim -= dt * 5;
          if (dropAnim <= 0) {
            dropAnim = 0;
            if (s.playing) state = 'idle';
          }
        }

        hudAcc += dt;
        if (hudAcc > 0.1 && s.playing) {
          hudAcc = 0;
          pushHud({ score: s.score, timeLeft: s.timeLeft, clutch: s.timeLeft <= CLUTCH_SECONDS, combo: state === 'volley' ? volleyHits : 0, balls: ballCount + (state === 'volley' ? pendingBalls : 0) });
        }

        // ---- draw: bricks, labels, pickups
        let bi = 0;
        pickupsInUse.forEach((g) => {
          g.visible = false;
          scene.remove(g);
          pickupPool.push(g);
        });
        pickupsInUse.length = 0;
        const zOff = -dropAnim; // rows slide in from one cell further away
        for (let row = 0; row < ROWS; row++) {
          for (let c = 0; c < COLS; c++) {
            const cell = grid[row][c];
            if (!cell) continue;
            const x = wx(c + 0.5);
            const z = wz(row + 0.5) + zOff;
            if (cell.kind === 'brick') {
              if (cell.flash > 0) cell.flash = Math.max(0, cell.flash - dt * 6);
              const grow = 1 + cell.flash * 0.08;
              pos.set(x, BRICK_H / 2 + cell.flash * 0.05, z);
              scl.set(grow, 1 + cell.flash * 0.15, grow);
              m4.compose(pos, q, scl);
              bricks.setMatrixAt(bi, m4);
              const hue = hueFor(cell.hp, turn);
              col.setHSL(hue / 360, 1, 0.5 + cell.flash * 0.3);
              bricks.setColorAt(bi, col);
              const label = labels[bi];
              label.material = labelMat(cell.hp);
              label.position.set(x, BRICK_H + 0.2 + cell.flash * 0.1, z + 0.12);
              label.visible = true;
              bi++;
            } else {
              const g = takePickup(cell.kind);
              g.position.set(x, cell.kind === 'ball' ? 0.35 + Math.sin(t * 4 + c) * 0.05 : 0.4, z);
              if (cell.kind === 'ball') {
                g.children[0].rotation.set(-0.95, 0, 0);
                g.scale.setScalar(1 + Math.sin(t * 6 + c) * 0.08);
              } else {
                g.rotation.set(-0.6, t * 1.8, 0);
              }
            }
          }
        }
        bricks.count = bi;
        bricks.instanceMatrix.needsUpdate = true;
        if (bricks.instanceColor) bricks.instanceColor.needsUpdate = true;
        for (let i = bi; i < labels.length; i++) labels[i].visible = false;

        // Danger row pulses when bricks are one row away.
        const near = grid[ROWS - 2].some((c) => c?.kind === 'brick');
        dangerMat.opacity = near ? 0.22 + 0.14 * Math.sin(t * 8) : 0.07;

        // Balls
        let n = 0;
        for (const b of balls) {
          if (!b.live || n >= MAX_BALLS) continue;
          m4.makeTranslation(wx(b.x), BALL_R + 0.02, wz(b.y));
          ballMesh.setMatrixAt(n++, m4);
        }
        ballMesh.count = n;
        ballMesh.instanceMatrix.needsUpdate = true;

        // Launcher, waiting count, landing ghost
        launcher.position.set(wx(launchX), 0, wz(launchY) + 0.15);
        readyBall.visible = state !== 'volley' || toFire > 0;
        readyBall.position.y = 0.32 + Math.sin(t * 4) * 0.03;
        padRing.scale.setScalar(1 + Math.sin(t * 3) * 0.05);
        drawCount(state === 'volley' ? toFire : ballCount);
        countSprite.position.set(wx(launchX), 0.9, wz(launchY) + 0.5);
        ghost.visible = nextLaunchX !== null && state === 'volley';
        if (ghost.visible) ghost.position.set(wx(nextLaunchX!), BALL_R, wz(launchY) + 0.15);

        // Aim guide
        aimDots.visible = state === 'aim' && aimAng !== null;
        if (aimDots.visible) layoutAim(aimAng!);

        // ---- first-person camera: behind the launcher, sliding with it, recoil on each volley
        camX += (wx(launchX) * 0.7 - camX) * (1 - Math.exp(-3 * dt));
        const off = feel.update(dt, t, 0);
        camera.position.set(camX + off.x, view.y + Math.sin(t * 1.1) * 0.02 + off.y, view.z);
        camera.lookAt(camX * 0.6, 0, -4.3);

        // Arms: right hand points along the aim; both push on fire.
        arms.ready(t);
        const pointAng = state === 'aim' && aimAng !== null ? aimAng : Math.PI / 2;
        arms.right.pivot.rotation.y = (pointAng - Math.PI / 2) * -0.45;
        arms.right.pivot.position.y += state === 'aim' ? 0.05 : 0;
        if (push > 0) {
          push = Math.max(0, push - dt * 4);
          const k = Math.sin(push * Math.PI);
          arms.left.pivot.position.z -= k * 0.1;
          arms.right.pivot.position.z -= k * 0.1;
        }
        arms.setGlow(Math.min(1.5, volleyHits / 30));
      });

      return () => {
        api.current = { start: () => {}, drag: () => {}, tap: () => {} };
      };
    },
    [stableAvatar],
  );

  const startGame = useCallback(() => api.current.start(), []);
  const surface = useSwipe({
    onDrag: (sw, p) => api.current.drag(sw, p),
    onTap: () => api.current.tap(),
  });

  const chips = (
    <>
      <span className="px-2 py-0.5 rounded-full bg-white/90 text-black text-[11px] font-black">●×{hud.balls}</span>
      <span className="px-2 py-0.5 rounded-full bg-black/50 text-white/80 text-[11px] font-black">ROW {hud.turn}</span>
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${hud.saves > 0 ? 'bg-rose-500 text-white' : 'bg-white/10 text-white/30'}`} title="Shield save">
        ◆ {hud.saves}
      </span>
      {hud.combo >= 12 && <span className="px-2 py-0.5 rounded-full bg-cyan-400 text-black text-[11px] font-black">{hud.combo} HITS</span>}
    </>
  );

  return (
    <GameShell
      title="BRICK BLITZ"
      accent="#22d3ee"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={startGame}
      score={hud.score}
      timeLeft={phase === 'ready' ? ROUND_SECONDS : hud.timeLeft}
      roundSeconds={ROUND_SECONDS}
      clutch={hud.clutch}
      chips={chips}
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="Drag to aim down the lane · release to fire"
      tutorial={[
        { icon: <Crosshair className="w-6 h-6" />, label: 'Drag to aim' },
        { icon: <Hand className="w-6 h-6" />, label: 'Release to fire' },
        { icon: <CirclePlus className="w-6 h-6" />, label: 'Grab +1 balls' },
      ]}
      scoring="First-person 3D lane. 10 per hit · Break bonus grows with brick toughness · Long volleys multiply · Clear the board +1000 · Last 10s ×2. Starts with soft bricks; the wall toughens each row. One shield save if the wall hits the red line. Tap during a volley to fast-forward. Same wall for every player."
    />
  );
}
