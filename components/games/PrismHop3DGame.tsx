'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import { CameraFeel, ParticleBursts, useGameEngine, useLatest, useThrottledHud } from '@/lib/engine';
import { GameProps } from '@/lib/game-types';
import { mulberry32, randomSeed } from '@/lib/rng';
import { award, popStyle, ScoreBook } from '@/lib/scoring';
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { Pointer, Palette, Star } from 'lucide-react';

/**
 * PRISM HOP — tap to hop your glowing ball upward. Spinning rings and sliding bars of four colours
 * block the way: you can only pass through the part that matches YOUR colour. Touch any other
 * colour, or drop off the bottom of the screen, and it shatters. Rainbow orbs switch your colour.
 * Grab the star in the middle of each obstacle. Rings spin faster, bars slide quicker, and double
 * rings show up as you climb. Score (small numbers): star 1 · 5 stars without a pause = ON FIRE ×2.
 * Same climb for every player.
 */

const CAM_Z = 16;
const FOV = 45;
const VIEW_H = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const COLORS = [0x22d3ee, 0xf43f5e, 0xfacc15, 0xa855f7];
const CSS = ['#22d3ee', '#f43f5e', '#facc15', '#a855f7'];
const BALL_R = 0.26;
const GRAV = 19;
const HOP = 7.4;
const TUBE = 0.22;
const SEG = 1.6; // bar segment width

type Phase = 'ready' | 'playing' | 'over';
type Kind = 'ring' | 'double' | 'bar';
interface Obstacle {
  kind: Kind;
  y: number;
  group: THREE.Group;
  rings: { obj: THREE.Group; r: number; w: number; colors: number[] }[];
  bar?: { obj: THREE.Group; v: number; colors: number[]; shift: number };
  star: THREE.Mesh | null;
  switcher: THREE.Group | null;
  switchY: number;
  passed: boolean;
}

export default function PrismHop3DGame({ onFinish, seed, rival, match, onExit }: GameProps) {
  const onFinishRef = useLatest(onFinish);
  const seedRef = useLatest(seed);
  const popups = useRef<PopupApi | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, color: 0, height: 0 });
  const api = useRef({ start: () => {}, hop: () => {} });

  const startGame = useCallback(() => {
    api.current.start();
    setPhase('playing');
  }, []);
  const surface = useSwipe({ onDrag: (_s, ph) => ph === 'start' && api.current.hop() });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') {
        e.preventDefault();
        api.current.hop();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const { hostRef } = useGameEngine(
    {
      background: 0x0b0718,
      camera: { fov: FOV, near: 1, far: 80, position: [0, 3, CAM_Z], lookAt: [0, 3, 0] },
      exposure: 1.1,
      bloom: { strength: 0.9, radius: 0.5, threshold: 0.45 },
      environment: 0.3,
      grade: { saturation: 1.2, vignette: 0.4 },
    },
    (engine) => {
      const { scene, camera } = engine;
      const feel = new CameraFeel();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x221133, 0.9));
      // background sparkles
      const dustGeo = engine.own(new THREE.BufferGeometry());
      const dust = new Float32Array(600 * 3);
      for (let i = 0; i < 600; i++) {
        dust[i * 3] = (Math.random() - 0.5) * 24;
        dust[i * 3 + 1] = Math.random() * 40;
        dust[i * 3 + 2] = -4 - Math.random() * 8;
      }
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
      const dustPts = new THREE.Points(dustGeo, engine.own(new THREE.PointsMaterial({ color: 0xc4b5fd, size: 0.06, transparent: true, opacity: 0.6 })));
      scene.add(dustPts);

      const glow = (c: number, k = 1.8) => engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false }));
      const segMats = COLORS.map((c) => glow(c));
      const arcGeoFor = (r: number) => engine.own(new THREE.TorusGeometry(r, TUBE, 10, 40, Math.PI / 2));
      const arcGeos = new Map<number, THREE.BufferGeometry>();
      const arc = (r: number) => {
        if (!arcGeos.has(r)) arcGeos.set(r, arcGeoFor(r));
        return arcGeos.get(r)!;
      };
      const barGeo = engine.own(new THREE.BoxGeometry(SEG - 0.04, 0.3, 0.3));
      const starGeo = engine.own(new THREE.OctahedronGeometry(0.28, 0));
      const starMat = glow(0xffffff, 2.2);
      const orbGeo = engine.own(new THREE.SphereGeometry(0.22, 16, 12, 0, Math.PI / 2));
      const ballMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS[0]).multiplyScalar(2), toneMapped: false }));
      const ball = new THREE.Mesh(engine.own(new THREE.SphereGeometry(BALL_R, 20, 16)), ballMat);
      scene.add(ball);
      const particles = new ParticleBursts(engine);

      let obstacles: Obstacle[] = [];
      let rng = mulberry32(1);
      let made = 0;
      let nextY = 6;
      let by = 0;
      let vy = 0;
      let color = 0;
      let started = false; // the ball waits on the start pad until your first hop
      let playing = false;
      let dead = false;
      let camY = 3;
      let stars = 0;
      let streak = 0;
      let lastStar = 0;
      let book = new ScoreBook();
      let clock = 0;
      const tmp = new THREE.Vector3();

      const shuffled = () => {
        const a = [0, 1, 2, 3];
        for (let i = 3; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      };
      const makeRing = (r: number, w: number) => {
        const obj = new THREE.Group();
        const colors = shuffled();
        colors.forEach((ci, k) => {
          const m = new THREE.Mesh(arc(r), segMats[ci]);
          m.rotation.z = (k * Math.PI) / 2;
          obj.add(m);
        });
        return { obj, r, w, colors };
      };

      /** Seeded obstacle: rings to start, then bars and double rings, all spinning faster as you go. */
      const spawn = () => {
        const n = made;
        const k = Math.min(1, n / 30);
        const kind: Kind = n < 3 ? 'ring' : rng() < 0.3 ? 'bar' : n > 7 && rng() < 0.35 ? 'double' : 'ring';
        const group = new THREE.Group();
        group.position.y = nextY;
        const o: Obstacle = { kind, y: nextY, group, rings: [], star: null, switcher: null, switchY: 0, passed: false };
        const w = (1.2 + k * 1.8 + rng() * 0.4) * (rng() < 0.5 ? 1 : -1);
        if (kind === 'ring') {
          o.rings.push(makeRing(2.0, w));
        } else if (kind === 'double') {
          o.rings.push(makeRing(2.0, w), makeRing(2.75, -w * 0.85));
        } else {
          const colors = shuffled();
          const obj = new THREE.Group();
          for (let j = 0; j < 16; j++) {
            const m = new THREE.Mesh(barGeo, segMats[colors[j % 4]]);
            m.position.x = j * SEG + SEG / 2;
            obj.add(m);
          }
          o.bar = { obj, v: (2.2 + k * 2.6) * (rng() < 0.5 ? 1 : -1), colors, shift: rng() * SEG * 4 };
          group.add(obj);
        }
        o.rings.forEach((r) => group.add(r.obj));
        // the star in the middle
        const star = new THREE.Mesh(starGeo, starMat);
        if (kind !== 'bar') group.add(star);
        else {
          star.position.y = 1.2;
          group.add(star);
        }
        o.star = star;
        // a rainbow orb that switches your colour, between this obstacle and the next
        const gap = 7.2 - k * 1.2;
        const sw = new THREE.Group();
        for (let q = 0; q < 4; q++) {
          const m = new THREE.Mesh(orbGeo, segMats[q]);
          m.rotation.y = (q * Math.PI) / 2;
          sw.add(m);
        }
        o.switchY = nextY + gap / 2 + (kind === 'double' ? 0.4 : 0);
        sw.position.y = o.switchY - nextY;
        group.add(sw);
        o.switcher = sw;
        scene.add(group);
        obstacles.push(o);
        made += 1;
        nextY += gap;
      };

      const reset = () => {
        obstacles.forEach((o) => scene.remove(o.group));
        obstacles = [];
        rng = mulberry32(seedRef.current ?? randomSeed());
        made = 0;
        nextY = 6;
        by = 0;
        vy = 0;
        color = Math.floor(rng() * 4);
        ballMat.color.setHex(COLORS[color]).multiplyScalar(2);
        started = false;
        dead = false;
        camY = 3;
        stars = 0;
        streak = 0;
        lastStar = 0;
        clock = 0;
        book = new ScoreBook();
        ball.visible = true;
        particles.clear();
        for (let i = 0; i < 5; i++) spawn();
      };
      reset();

      const die = () => {
        if (dead) return;
        dead = true;
        playing = false;
        ball.visible = false;
        for (let q = 0; q < 4; q++) particles.emit(tmp.set(0, by, 0), COLORS[q], { count: 14, speed: 6, life: 0.9, gravity: 6 });
        sound.playLose();
        haptic('fail');
        feel.kick(0.6);
        engine.flash(0.4);
        popups.current?.banner(`SHATTERED · ${stars} ★`, '#f0abfc');
        pushHud({ score: book.score }, true);
        setPhase('over');
        setTimeout(() => onFinishRef.current(book.score, { maxCombo: streak, breakdown: book.breakdown() }), 1500);
      };

      api.current.start = () => {
        reset();
        playing = true;
        pushHud({ score: 0, color, height: 0 }, true);
      };
      api.current.hop = () => {
        if (!playing || dead) return;
        started = true;
        vy = HOP;
        sound.playNote(72 + color * 2, 0.12, 0.05);
        haptic('tap');
      };

      const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

      engine.addUpdate((dt, t) => {
        clock += dt;
        if (playing && started) {
          vy -= GRAV * dt;
          by += vy * dt;
        }
        ball.position.set(0, by, 0);
        ball.scale.set(1 - Math.min(0.15, Math.abs(vy) * 0.01), 1 + Math.min(0.2, Math.abs(vy) * 0.015), 1);

        for (const o of obstacles) {
          for (const r of o.rings) r.obj.rotation.z += r.w * dt;
          if (o.bar) {
            o.bar.shift = (((o.bar.shift + o.bar.v * dt) % (SEG * 4)) + SEG * 4) % (SEG * 4);
            o.bar.obj.position.x = -SEG * 8 + o.bar.shift;
          }
          if (o.star) o.star.rotation.y += dt * 2.5;
          if (o.switcher) o.switcher.rotation.y += dt * 3;
          if (!playing || dead) continue;
          // ---- colour checks where the ball crosses each obstacle
          for (const r of o.rings) {
            const d = Math.abs(by - o.y);
            if (d > r.r - TUBE - BALL_R && d < r.r + TUBE + BALL_R) {
              const a = norm((by > o.y ? Math.PI / 2 : -Math.PI / 2) - r.obj.rotation.z);
              const seg = Math.floor(a / (Math.PI / 2)) % 4;
              if (r.colors[seg] !== color) {
                die();
                break;
              }
            }
          }
          if (o.bar && Math.abs(by - o.y) < 0.15 + BALL_R) {
            const local = (((0 - o.bar.obj.position.x) % (SEG * 4)) + SEG * 4) % (SEG * 4);
            if (o.bar.colors[Math.floor(local / SEG) % 4] !== color) die();
          }
          if (dead) break;
          // ---- the star
          const starY = o.y + (o.kind === 'bar' ? 1.2 : 0);
          if (o.star && Math.abs(by - starY) < 0.45) {
            o.group.remove(o.star);
            particles.emit(tmp.set(0, starY, 0), 0xffffff, { count: 16, speed: 3, life: 0.5, gravity: 0 });
            stars += 1;
            streak = clock - lastStar < 2.6 ? streak + 1 : 1;
            lastStar = clock;
            const a = award(1, { streak });
            book.record(a, { Stars: a.total });
            const p = engine.toScreen(tmp.set(0, starY, 0));
            popups.current?.pop(`+${a.total}`, p.x + 40, p.y, popStyle(a.total, streak >= 5 ? 'bonus' : undefined));
            sound.playNote(79 + Math.min(streak, 8), 0.25, 0.09);
            haptic('score');
            o.star = null;
            pushHud({ score: book.score, height: stars }, true);
          }
          // ---- the colour switcher
          if (o.switcher && Math.abs(by - o.switchY) < 0.4) {
            o.group.remove(o.switcher);
            o.switcher = null;
            let c = Math.floor(rng() * 3);
            if (c >= color) c += 1; // always a different colour
            color = c;
            ballMat.color.setHex(COLORS[color]).multiplyScalar(2);
            particles.emit(tmp.set(0, by, 0), COLORS[color], { count: 20, speed: 3.5, life: 0.5, gravity: 0 });
            sound.playPowerup();
            pushHud({ color }, true);
          }
        }

        // camera only ever climbs; drop off the bottom and you're out
        if (by - 1 > camY) camY += (by - 1 - camY) * Math.min(1, dt * 8);
        if (playing && started && by < camY - VIEW_H / 2 - 0.5) die();
        const off = feel.update(dt, t, 0);
        camera.position.set(off.x, camY + off.y, CAM_Z);
        camera.lookAt(0, camY, 0);
        dustPts.position.y = Math.floor(camY / 40) * 40 - 10;

        // keep building above, clean up below
        while (nextY < camY + VIEW_H) spawn();
        while (obstacles.length && obstacles[0].y < camY - VIEW_H) scene.remove(obstacles.shift()!.group);
      });

      return () => {
        api.current = { start: () => {}, hop: () => {} };
      };
    },
    [],
  );

  return (
    <GameShell
      title="PRISM HOP"
      accent="#a855f7"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={startGame}
      score={hud.score}
      chips={
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/50 text-white text-[11px] font-black whitespace-nowrap" data-testid="prism-color">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: CSS[hud.color], boxShadow: `0 0 8px ${CSS[hud.color]}` }} />
          ★ {hud.height}
        </span>
      }
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="Tap to hop · pass through your colour only"
      guide={{
        goal: 'Tap to hop up. Only pass through your own colour.',
        controls: [{ gesture: 'tap', label: 'Tap = hop' }],
        points: [
          { label: 'Star', value: '1' },
          { label: 'Rainbow orb', value: 'new colour', tone: 'bonus' },
          { label: '5 stars, no pause', value: '×2', tone: 'fire' },
        ],
        ends: 'Wrong colour or falling off ends it',
      }}
      tutorial={[
        { icon: <Pointer className="w-6 h-6" />, label: 'Tap to hop' },
        { icon: <Palette className="w-6 h-6" />, label: 'Match your colour' },
        { icon: <Star className="w-6 h-6" />, label: 'Grab the stars' },
      ]}
      scoring="Tap to hop your ball upward. Spinning rings and sliding bars are made of four colours — you can only pass through the part that matches your ball. Touch another colour, or fall off the bottom of the screen, and it shatters. Rainbow orbs switch your colour. Grab the star inside each obstacle: star 1 · 5 stars without a pause = ON FIRE ×2. Rings spin faster, bars slide quicker and double rings appear as you climb. Same climb for every player."
    />
  );
}
