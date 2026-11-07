'use client';

import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import { CameraFeel, ParticleBursts, useGameEngine, useLatest, useThrottledHud } from '@/lib/engine';
import { GameProps } from '@/lib/game-types';
import { mulberry32, randomSeed } from '@/lib/rng';
import { award, popStyle, ScoreBook } from '@/lib/scoring';
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { Hand, Bomb, Sparkles } from 'lucide-react';

/**
 * SLICE STORM — fruit is tossed up from below: swipe through it to slice it in two. Slice three or
 * more in ONE swipe for a COMBO. Let fruit fall back down unsliced and you lose a life (3 lives);
 * slice a BOMB and it's over. Waves get bigger and quicker, and bombs mix in. Rare golden STAR fruit
 * is worth 5. Score (small numbers): fruit 1 · star fruit 5 · combo +1 a fruit (3+ in one swipe).
 * Same waves for every player.
 */

const CAM_Z = 14;
const FOV = 50;
const VIEW_H = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const G = 9.5;
const LIVES = 3;

type Phase = 'ready' | 'playing' | 'over';
type Kind = 'melon' | 'orange' | 'lime' | 'plum' | 'peach' | 'star' | 'bomb';
const KINDS: Record<Kind, { skin: number; flesh: number; r: number; pts: number }> = {
  melon: { skin: 0x1f9d55, flesh: 0xff3b5c, r: 0.62, pts: 1 },
  orange: { skin: 0xff8a1f, flesh: 0xffc04d, r: 0.45, pts: 1 },
  lime: { skin: 0x7ed957, flesh: 0xd9ff8a, r: 0.38, pts: 1 },
  plum: { skin: 0x7c3aed, flesh: 0xfcd34d, r: 0.4, pts: 1 },
  peach: { skin: 0xff9e8a, flesh: 0xffd6a5, r: 0.44, pts: 1 },
  star: { skin: 0xffd400, flesh: 0xfff3a3, r: 0.42, pts: 5 },
  bomb: { skin: 0x1f2937, flesh: 0x000000, r: 0.42, pts: 0 },
};
const FRUITS: Kind[] = ['melon', 'orange', 'lime', 'plum', 'peach'];

interface Thing {
  kind: Kind;
  obj: THREE.Group;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  alive: boolean;
}
interface Half {
  obj: THREE.Group;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

export default function SliceStorm3DGame({ onFinish, seed, rival, match, onExit }: GameProps) {
  const onFinishRef = useLatest(onFinish);
  const seedRef = useLatest(seed);
  const popups = useRef<PopupApi | null>(null);
  const trailRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, lives: LIVES, sliced: 0 });
  const api = useRef({ start: () => {}, stroke: (_x: number, _y: number, _ph: 'start' | 'move' | 'end') => {} });

  const startGame = useCallback(() => {
    api.current.start();
    setPhase('playing');
  }, []);
  const surface = useSwipe({
    onDrag: (s, ph) => api.current.stroke(ph === 'start' ? s.startX : s.endX, ph === 'start' ? s.startY : s.endY, ph),
    onCancel: () => api.current.stroke(0, 0, 'end'),
  });

  const { hostRef } = useGameEngine(
    {
      background: 0x120a06,
      camera: { fov: FOV, near: 0.5, far: 80, position: [0, 0, CAM_Z], lookAt: [0, 0, 0] },
      exposure: 1.15,
      bloom: { strength: 0.45, radius: 0.4, threshold: 0.8 },
      environment: 0.7,
      studio: { top: 0xfff1d6, left: 0xffb26b, right: 0x7dd3fc },
      grade: { saturation: 1.2, vignette: 0.4 },
    },
    (engine) => {
      const { scene, camera, quality } = engine;
      const feel = new CameraFeel();
      let viewW = 7;
      let pxPerUnit = 60;
      scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2010, 1.5));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(3, 6, 8);
      scene.add(key);
      // backdrop: a big wooden board
      const boardC = document.createElement('canvas');
      boardC.width = 512;
      boardC.height = 1024;
      {
        const g = boardC.getContext('2d')!;
        for (let i = 0; i < 8; i++) {
          g.fillStyle = i % 2 ? '#5a3418' : '#64391b';
          g.fillRect(0, i * 128, 512, 128);
          g.fillStyle = 'rgba(0,0,0,0.3)';
          g.fillRect(0, i * 128, 512, 4);
          for (let k = 0; k < 30; k++) {
            g.strokeStyle = 'rgba(0,0,0,0.12)';
            g.beginPath();
            const y = i * 128 + Math.random() * 128;
            g.moveTo(0, y);
            g.bezierCurveTo(170, y + 8, 340, y - 8, 512, y);
            g.stroke();
          }
        }
      }
      const board = new THREE.Mesh(engine.own(new THREE.PlaneGeometry(30, 30)), engine.own(new THREE.MeshStandardMaterial({ map: engine.own(new THREE.CanvasTexture(boardC)), roughness: 0.9 })));
      board.position.z = -2;
      scene.add(board);

      const particles = new ParticleBursts(engine);
      const sphere = engine.own(new THREE.SphereGeometry(1, 24, 18));
      const hemi = engine.own(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2));
      const disc = engine.own(new THREE.CircleGeometry(1, 24));
      disc.rotateX(Math.PI / 2);
      const leafGeo = engine.own(new THREE.ConeGeometry(0.12, 0.3, 5));
      const leafMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x2f9e44, roughness: 0.6 }));
      const skins = {} as Record<Kind, THREE.Material>;
      const fleshes = {} as Record<Kind, THREE.Material>;
      for (const k of Object.keys(KINDS) as Kind[]) {
        skins[k] = engine.own(
          new THREE.MeshPhysicalMaterial({ color: KINDS[k].skin, roughness: k === 'bomb' ? 0.3 : 0.35, clearcoat: 0.6, metalness: k === 'star' ? 0.6 : 0, emissive: k === 'star' ? 0x6b5200 : k === 'bomb' ? 0x200000 : 0x000000 }),
        );
        fleshes[k] = engine.own(new THREE.MeshStandardMaterial({ color: KINDS[k].flesh, roughness: 0.55, side: THREE.DoubleSide }));
      }
      const fuseMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a1f).multiplyScalar(3), toneMapped: false }));

      const things: Thing[] = [];
      const halves: Half[] = [];
      let rng = mulberry32(1);
      let elapsed = 0;
      let nextWave = 0.8;
      let lives = LIVES;
      let sliced = 0;
      let playing = false;
      let book = new ScoreBook();
      const tmp = new THREE.Vector3();
      // swipe trail (screen px) and this stroke's slices (for combos)
      let trail: { x: number; y: number; t: number }[] = [];
      let last: { x: number; y: number } | null = null;
      let strokeHits = 0;
      let strokeAt = new THREE.Vector3();

      engine.onResize((_w, h, aspect) => {
        viewW = VIEW_H * aspect;
        pxPerUnit = h / VIEW_H;
        const c = trailRef.current;
        if (c) {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          c.width = c.clientWidth * dpr;
          c.height = c.clientHeight * dpr;
        }
      });

      const build = (kind: Kind) => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(sphere, skins[kind]);
        body.scale.setScalar(KINDS[kind].r);
        body.castShadow = quality.shadows;
        g.add(body);
        if (kind === 'bomb') {
          const fuse = new THREE.Mesh(leafGeo, fuseMat);
          fuse.position.y = KINDS.bomb.r + 0.08;
          g.add(fuse);
        } else if (kind !== 'star') {
          const leaf = new THREE.Mesh(leafGeo, leafMat);
          leaf.position.y = KINDS[kind].r + 0.05;
          leaf.rotation.z = 0.5;
          g.add(leaf);
        }
        scene.add(g);
        return g;
      };

      /** A seeded wave: bigger and faster as the run goes on, with bombs mixed in after the start. */
      const wave = () => {
        const k = Math.min(1, elapsed / 70);
        const n = 1 + Math.floor(rng() * (1.5 + k * 4));
        for (let i = 0; i < n; i++) {
          let kind: Kind = FRUITS[Math.floor(rng() * FRUITS.length)];
          if (elapsed > 8 && rng() < 0.1 + k * 0.18) kind = 'bomb';
          else if (rng() < 0.04) kind = 'star';
          const x = (rng() - 0.5) * viewW * 0.8;
          const peak = VIEW_H * (0.55 + rng() * 0.3); // how high above the bottom it flies
          const vy = Math.sqrt(2 * G * peak);
          const flight = (2 * vy) / G;
          const toX = (rng() - 0.5) * viewW * 0.5;
          const obj = build(kind);
          obj.position.set(x, -VIEW_H / 2 - 1, 0);
          things.push({ kind, obj, vel: new THREE.Vector3((toX - x) / flight, vy, 0), spin: new THREE.Vector3(rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2), alive: true });
        }
        sound.playWhiff();
        nextWave = Math.max(0.75, 1.7 - k * 1.0) + rng() * 0.5;
      };

      const reset = () => {
        things.forEach((t) => scene.remove(t.obj));
        halves.forEach((h) => scene.remove(h.obj));
        things.length = 0;
        halves.length = 0;
        rng = mulberry32(seedRef.current ?? randomSeed());
        elapsed = 0;
        nextWave = 0.8;
        lives = LIVES;
        sliced = 0;
        book = new ScoreBook();
        trail = [];
        last = null;
        particles.clear();
      };
      reset();

      const finish = (why: string) => {
        if (!playing) return;
        playing = false;
        sound.playLose();
        haptic('fail');
        popups.current?.banner(`${why} · ${sliced} SLICED`, '#f87171');
        pushHud({ score: book.score, lives, sliced }, true);
        setPhase('over');
        setTimeout(() => onFinishRef.current(book.score, { maxCombo: sliced, breakdown: book.breakdown() }), 1500);
      };

      const sliceThing = (th: Thing, dirX: number, dirY: number) => {
        th.alive = false;
        const pos = th.obj.position.clone();
        scene.remove(th.obj);
        if (th.kind === 'bomb') {
          particles.emit(pos, 0xff7a1a, { count: 60, speed: 9, life: 0.9, gravity: 2 });
          particles.emit(pos, 0xffffff, { count: 20, speed: 5, life: 0.5, gravity: 0 });
          engine.flash(1);
          feel.kick(1.2);
          sound.playFirework();
          finish('BOOM');
          return;
        }
        // two halves fly apart, across the cut
        const r = KINDS[th.kind].r;
        const nx = -dirY;
        const ny = dirX;
        for (const side of [1, -1]) {
          const g = new THREE.Group();
          const shell = new THREE.Mesh(hemi, skins[th.kind]);
          const face = new THREE.Mesh(disc, fleshes[th.kind]);
          shell.scale.setScalar(r);
          face.scale.setScalar(r * 0.95);
          if (side < 0) g.rotation.z = Math.PI;
          g.add(shell, face);
          const holder = new THREE.Group();
          holder.add(g);
          holder.position.copy(pos);
          holder.rotation.z = Math.atan2(ny, nx) - Math.PI / 2;
          scene.add(holder);
          halves.push({ obj: holder, vel: new THREE.Vector3(th.vel.x * 0.5 + nx * side * 2.2, Math.max(0, th.vel.y * 0.3) + ny * side * 2.2, 0), spin: new THREE.Vector3(0, 0, side * 3), life: 1.6 });
        }
        particles.emit(pos, KINDS[th.kind].flesh, { count: th.kind === 'melon' ? 22 : 14, speed: 4.5, life: 0.6, gravity: 9 });
        sliced += 1;
        strokeHits += 1;
        strokeAt = pos;
        const pts = KINDS[th.kind].pts;
        const a = award(pts, {});
        book.record(a, th.kind === 'star' ? { 'Star fruit': a.total } : { Fruit: a.total });
        const p = engine.toScreen(pos);
        popups.current?.pop(`+${a.total}`, p.x, p.y, popStyle(a.total, th.kind === 'star' ? 'gold' : undefined));
        sound.playNote(67 + Math.min(strokeHits, 8) * 2, 0.18, 0.08);
        sound.playSwish();
        haptic('light');
        pushHud({ score: book.score, sliced }, true);
      };

      api.current.start = () => {
        reset();
        playing = true;
        pushHud({ score: 0, lives, sliced: 0 }, true);
      };
      api.current.stroke = (x, y, ph) => {
        if (ph === 'start') {
          trail = [{ x, y, t: performance.now() }];
          last = { x, y };
          strokeHits = 0;
          return;
        }
        if (ph === 'end') {
          // a COMBO: three or more in one swipe
          if (strokeHits >= 3 && playing) {
            const a = award(strokeHits, {});
            book.record(a, { Combos: a.total });
            const p = engine.toScreen(strokeAt);
            popups.current?.pop(`${strokeHits} FRUIT COMBO +${a.total}`, p.x, p.y - 34, { color: '#fde047', size: 'md' });
            sound.playCombo(Math.min(4, strokeHits - 1));
            haptic('big');
            pushHud({ score: book.score }, true);
          }
          strokeHits = 0;
          last = null;
          return;
        }
        if (!last) return;
        const seg = { ax: last.x, ay: last.y, bx: x, by: y };
        const len = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
        trail.push({ x, y, t: performance.now() });
        last = { x, y };
        if (!playing || len < 3) return;
        for (const th of things) {
          if (!th.alive) continue;
          const p = engine.toScreen(th.obj.position);
          // distance from the fruit's centre to this bit of the swipe
          const t = Math.max(0, Math.min(1, ((p.x - seg.ax) * (seg.bx - seg.ax) + (p.y - seg.ay) * (seg.by - seg.ay)) / (len * len)));
          const d = Math.hypot(seg.ax + t * (seg.bx - seg.ax) - p.x, seg.ay + t * (seg.by - seg.ay) - p.y);
          if (d < KINDS[th.kind].r * pxPerUnit + 10) sliceThing(th, (seg.bx - seg.ax) / len, -(seg.by - seg.ay) / len);
          if (!playing) return;
        }
      };

      engine.addUpdate((dt, t) => {
        if (playing) {
          elapsed += dt;
          nextWave -= dt;
          if (nextWave <= 0) wave();
        }
        for (let i = things.length - 1; i >= 0; i--) {
          const th = things[i];
          if (!th.alive) {
            things.splice(i, 1);
            continue;
          }
          th.vel.y -= G * dt;
          th.obj.position.addScaledVector(th.vel, dt);
          th.obj.rotation.x += th.spin.x * dt;
          th.obj.rotation.y += th.spin.y * dt;
          if (th.kind === 'bomb' && Math.random() < dt * 30) particles.emit(tmp.copy(th.obj.position).setY(th.obj.position.y + 0.5), 0xffb02e, { count: 1, speed: 1, life: 0.25, gravity: -2 });
          // fell back below the screen
          if (th.vel.y < 0 && th.obj.position.y < -VIEW_H / 2 - 1.2) {
            scene.remove(th.obj);
            things.splice(i, 1);
            if (playing && th.kind !== 'bomb') {
              lives -= 1;
              haptic('fail');
              popups.current?.pop('✕ MISSED', engine.toScreen(tmp.set(th.obj.position.x, -VIEW_H / 2 + 0.8, 0)).x, engine.toScreen(tmp.set(0, -VIEW_H / 2 + 0.8, 0)).y, { color: '#f87171', size: 'sm' });
              sound.playPunch(false, true);
              pushHud({ lives }, true);
              if (lives <= 0) finish('OUT OF LIVES');
            }
          }
        }
        for (let i = halves.length - 1; i >= 0; i--) {
          const h = halves[i];
          h.vel.y -= G * dt;
          h.obj.position.addScaledVector(h.vel, dt);
          h.obj.rotation.z += h.spin.z * dt;
          h.life -= dt;
          if (h.life <= 0) {
            scene.remove(h.obj);
            halves.splice(i, 1);
          }
        }
        const off = feel.update(dt, t, 0);
        camera.position.set(off.x, off.y, CAM_Z);

        // draw the blade trail (fades over ~0.18 s)
        const c = trailRef.current;
        const g = c?.getContext('2d');
        if (c && g) {
          const dpr = c.width / Math.max(1, c.clientWidth);
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.clearRect(0, 0, c.clientWidth, c.clientHeight);
          const now = performance.now();
          trail = trail.filter((p) => now - p.t < 180);
          if (trail.length > 1) {
            g.lineCap = 'round';
            g.lineJoin = 'round';
            for (let k = 1; k < trail.length; k++) {
              const a = trail[k - 1];
              const b = trail[k];
              const life = 1 - (now - b.t) / 180;
              g.strokeStyle = `rgba(190,240,255,${0.9 * life})`;
              g.shadowColor = '#67e8f9';
              g.shadowBlur = 12;
              g.lineWidth = 2 + life * 9;
              g.beginPath();
              g.moveTo(a.x, a.y);
              g.lineTo(b.x, b.y);
              g.stroke();
            }
          }
        }
      });

      return () => {
        api.current = { start: () => {}, stroke: () => {} };
      };
    },
    [],
  );

  return (
    <GameShell
      title="SLICE STORM"
      accent="#fb923c"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={startGame}
      score={hud.score}
      chips={
        <span className="px-2 py-0.5 rounded-full bg-black/50 text-[12px] font-black whitespace-nowrap tracking-widest" data-testid="slice-lives">
          {Array.from({ length: LIVES }, (_, i) => (
            <span key={i} className={i < hud.lives ? 'text-rose-400' : 'text-white/25'}>
              ♥
            </span>
          ))}
        </span>
      }
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="Swipe through the fruit · never the bombs"
      guide={{
        goal: 'Swipe to slice every fruit. Never slice a bomb.',
        controls: [{ gesture: 'swipe-x', label: 'Swipe to slice' }],
        points: [
          { label: 'Fruit', value: '1' },
          { label: '3+ in one swipe', value: '+1 each', tone: 'bonus' },
          { label: 'Star fruit', value: '5', tone: 'gold' },
        ],
        ends: '3 missed fruit or 1 bomb',
      }}
      tutorial={[
        { icon: <Hand className="w-6 h-6" />, label: 'Swipe = slice' },
        { icon: <Sparkles className="w-6 h-6" />, label: '3+ = combo' },
        { icon: <Bomb className="w-6 h-6" />, label: 'Not the bombs' },
      ]}
      scoring="Fruit is tossed up from below — swipe through it to slice it. Slice 3 or more in a single swipe for a COMBO worth +1 a fruit. Rare golden star fruit is worth 5. Let a fruit fall back down unsliced and you lose a life (3 lives); slice a bomb and the run is over. Waves get bigger and faster. Fruit 1. Same waves for every player."
    >
      <canvas ref={trailRef} className="absolute inset-0 w-full h-full z-10 pointer-events-none" />
    </GameShell>
  );
}
