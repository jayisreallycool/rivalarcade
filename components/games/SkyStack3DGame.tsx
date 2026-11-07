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
import { Pointer, Crosshair, Layers } from 'lucide-react';

/**
 * SKY STACK — tap to drop the sliding slab onto the tower. Whatever hangs over the edge is sliced
 * off and falls away, so the slab you build on gets smaller. Land within a hair of the slab below
 * for a PERFECT (it snaps in place); three perfects in a row and the slab grows back a little.
 * Slabs slide faster the higher you go, sometimes from a surprise side. Miss completely and the run
 * is over. Score (small numbers): 1 a slab · PERFECT +1 · 5 perfects in a row = ON FIRE ×2.
 * Same tower (speeds and sides) for every player.
 */

const BLOCK_H = 0.36;
const START = 3; // slab size (x and z)
const PERFECT = 0.1; // world units of slop that still count as perfect
const GROW = 0.15;
const TRAVEL = 5.2; // how far a slab slides from the centre

type Phase = 'ready' | 'playing' | 'over';
interface Slab {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  w: number;
  d: number;
}
interface Falling {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

export default function SkyStack3DGame({ onFinish, seed, rival, match, onExit }: GameProps) {
  const onFinishRef = useLatest(onFinish);
  const seedRef = useLatest(seed);
  const popups = useRef<PopupApi | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, height: 0, perfect: 0 });
  const api = useRef({ start: () => {}, drop: () => {} });

  const startGame = useCallback(() => {
    api.current.start();
    setPhase('playing');
  }, []);
  // React on touch DOWN (not release): timing games need every millisecond.
  const surface = useSwipe({ onDrag: (_s, ph) => ph === 'start' && api.current.drop() });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        api.current.drop();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const { hostRef } = useGameEngine(
    {
      background: 0x1a1040,
      camera: { fov: 40, near: 0.1, far: 200, position: [12.5, 10.5, 12.5], lookAt: [0, 0, 0] },
      exposure: 1.1,
      bloom: { strength: 0.3, radius: 0.4, threshold: 0.9 },
      environment: 0.7,
      studio: { top: 0xffffff, left: 0xff9ad5, right: 0x8be9ff },
      grade: { saturation: 1.1, vignette: 0.25 },
    },
    (engine) => {
      const { scene, camera, quality } = engine;
      const feel = new CameraFeel();
      engine.onResize((_w, _h, aspect) => {
        camera.fov = aspect < 0.7 ? 52 : 40;
        camera.updateProjectionMatrix();
      });
      scene.add(new THREE.HemisphereLight(0xffffff, 0x404070, 1.4));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(6, 14, 4);
      engine.configureShadows(sun, 8);
      scene.add(sun, sun.target);
      // sky gradient that shifts as you climb
      const skyGeo = engine.own(new THREE.SphereGeometry(90, 24, 16));
      const skyMat = engine.own(
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          depthWrite: false,
          uniforms: { top: { value: new THREE.Color(0x2a1b6e) }, bottom: { value: new THREE.Color(0xff9ad5) } },
          vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float k = smoothstep(-0.85, 0.6, vP.y); gl_FragColor = vec4(mix(bottom, top, k), 1.0); }',
        }),
      );
      const sky = new THREE.Mesh(skyGeo, skyMat);
      scene.add(sky);
      // drifting clouds
      const cloudMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 }));
      const cloudGeo = engine.own(new THREE.SphereGeometry(1, 12, 8));
      const clouds: THREE.Group[] = [];
      const cr = mulberry32(3);
      for (let i = 0; i < 14; i++) {
        const c = new THREE.Group();
        for (let k = 0; k < 4; k++) {
          const p = new THREE.Mesh(cloudGeo, cloudMat);
          p.position.set(k * 0.9 - 1.3, cr() * 0.3, cr() * 0.5);
          p.scale.setScalar(0.6 + cr() * 0.5);
          c.add(p);
        }
        c.position.set(-14 + cr() * 28, cr() * 40, -10 - cr() * 12);
        clouds.push(c);
        scene.add(c);
      }

      const geo = engine.own(new THREE.BoxGeometry(1, BLOCK_H, 1));
      const mats: THREE.Material[] = [];
      const colorAt = (i: number) => new THREE.Color().setHSL(((i * 0.03 + 0.55) % 1 + 1) % 1, 0.9, 0.52);
      const matFor = (i: number) => {
        const m = new THREE.MeshStandardMaterial({ color: colorAt(i), roughness: 0.45, metalness: 0.05 });
        mats.push(m);
        return m;
      };
      const particles = new ParticleBursts(engine);

      const slabs: Slab[] = [];
      const base: THREE.Mesh[] = []; // the pillar under the first slab
      const falling: Falling[] = [];
      let moving: Slab | null = null;
      let axis: 'x' | 'z' = 'x';
      let dir = 1;
      let speed = 4;
      let pos = -TRAVEL;
      let rng = mulberry32(1);
      let streak = 0;
      let playing = false;
      let over = false;
      let overT = 0;
      let book = new ScoreBook();
      const camTarget = new THREE.Vector3();
      const tmp = new THREE.Vector3();

      const makeSlab = (x: number, z: number, w: number, d: number, level: number) => {
        const mesh = new THREE.Mesh(geo, matFor(level));
        mesh.scale.set(w, 1, d);
        mesh.position.set(x, level * BLOCK_H, z);
        mesh.castShadow = mesh.receiveShadow = quality.shadows;
        scene.add(mesh);
        return { mesh, x, z, w, d };
      };

      const clear = () => {
        for (const s of slabs) scene.remove(s.mesh);
        for (const b of base) scene.remove(b);
        base.length = 0;
        for (const f of falling) scene.remove(f.mesh);
        if (moving) scene.remove(moving.mesh);
        slabs.length = 0;
        falling.length = 0;
        moving = null;
        mats.forEach((m) => m.dispose());
        mats.length = 0;
      };

      /** Next slab: speed creeps up with height; the side it comes from is seeded (sometimes a surprise). */
      const spawnNext = () => {
        const top = slabs[slabs.length - 1];
        const level = slabs.length;
        axis = level % 2 ? 'z' : 'x';
        if (level > 12 && rng() < 0.22) axis = axis === 'x' ? 'z' : 'x'; // surprise side
        dir = rng() < 0.5 ? 1 : -1;
        pos = -TRAVEL * dir;
        speed = Math.min(11, 3.6 + level * 0.11) * (0.92 + rng() * 0.16);
        moving = makeSlab(axis === 'x' ? pos : top.x, axis === 'z' ? pos : top.z, top.w, top.d, level);
      };

      const reset = () => {
        clear();
        rng = mulberry32(seedRef.current ?? randomSeed());
        streak = 0;
        over = false;
        overT = 0;
        book = new ScoreBook();
        for (let i = -6; i <= 0; i++) {
          // the base pillar
          const s = makeSlab(0, 0, START, START, i);
          if (i === 0) slabs.push(s);
          else base.push(s.mesh);
        }
        camTarget.set(0, 0, 0);
        particles.clear();
      };
      reset();

      const chop = (keepX: number, keepZ: number, keepW: number, keepD: number, cutX: number, cutZ: number, cutW: number, cutD: number, level: number) => {
        if (cutW <= 0.001 || cutD <= 0.001) return;
        const m = new THREE.Mesh(geo, mats[mats.length - 1]);
        m.scale.set(cutW, 1, cutD);
        m.position.set(cutX, level * BLOCK_H, cutZ);
        m.castShadow = quality.shadows;
        scene.add(m);
        const out = new THREE.Vector3(cutX - keepX, 0, cutZ - keepZ).normalize();
        falling.push({ mesh: m, vel: new THREE.Vector3(out.x * 1.2, 0.5, out.z * 1.2), spin: new THREE.Vector3(out.z * 3, 0, -out.x * 3), life: 3 });
        void keepW;
        void keepD;
      };

      const finish = () => {
        playing = false;
        over = true;
        overT = 0;
        sound.playLose();
        haptic('fail');
        popups.current?.banner(`TOWER · ${slabs.length - 1} HIGH`, '#f9a8d4');
        pushHud({ score: book.score, height: slabs.length - 1, perfect: 0 }, true);
        setPhase('over');
        setTimeout(() => onFinishRef.current(book.score, { maxCombo: streak, breakdown: book.breakdown() }), 1600);
      };

      api.current.start = () => {
        reset();
        playing = true;
        spawnNext();
        pushHud({ score: 0, height: 0, perfect: 0 }, true);
      };

      api.current.drop = () => {
        if (!playing || !moving) return;
        const top = slabs[slabs.length - 1];
        const level = slabs.length;
        const m = moving;
        const off = axis === 'x' ? m.x - top.x : m.z - top.z;
        const size = axis === 'x' ? top.w : top.d;
        const overlap = size - Math.abs(off);
        if (overlap <= 0) {
          // missed the tower completely: the slab tumbles away
          falling.push({ mesh: m.mesh, vel: new THREE.Vector3(axis === 'x' ? Math.sign(off) * 2 : 0, 0, axis === 'z' ? Math.sign(off) * 2 : 0), spin: new THREE.Vector3(1, 0, 2), life: 4 });
          moving = null;
          finish();
          return;
        }
        let perfect = Math.abs(off) <= PERFECT;
        let placed: Slab;
        if (perfect) {
          streak += 1;
          // three perfects in a row: the slab grows back a little (never past the start size)
          let w = top.w;
          let d = top.d;
          if (streak >= 3) {
            if (axis === 'x') w = Math.min(START, w + GROW);
            else d = Math.min(START, d + GROW);
          }
          m.x = top.x;
          m.z = top.z;
          m.w = w;
          m.d = d;
          m.mesh.scale.set(w, 1, d);
          m.mesh.position.set(m.x, level * BLOCK_H, m.z);
          placed = m;
          sound.playNote(64 + Math.min(streak, 12) * 2, 0.4);
          haptic('score');
          const p = engine.toScreen(tmp.set(m.x, level * BLOCK_H, m.z));
          popups.current?.pop(streak >= 3 ? `PERFECT ×${streak}` : 'PERFECT', p.x, p.y - 40, { color: '#fde68a', size: 'md' });
          // a ring of light round the slab
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            particles.emit(tmp.set(m.x + Math.cos(a) * (w / 2), level * BLOCK_H, m.z + Math.sin(a) * (d / 2)), 0xffffff, { count: 1, speed: 1.2, life: 0.5, gravity: 0 });
          }
        } else {
          streak = 0;
          perfect = false;
          // slice: keep the overlap, drop the overhang
          if (axis === 'x') {
            const keepX = top.x + off / 2;
            const cutW = Math.abs(off);
            const cutX = keepX + Math.sign(off) * (overlap / 2 + cutW / 2);
            m.x = keepX;
            m.w = overlap;
            chop(keepX, m.z, overlap, m.d, cutX, m.z, cutW, m.d, level);
          } else {
            const keepZ = top.z + off / 2;
            const cutD = Math.abs(off);
            const cutZ = keepZ + Math.sign(off) * (overlap / 2 + cutD / 2);
            m.z = keepZ;
            m.d = overlap;
            chop(m.x, keepZ, m.w, overlap, m.x, cutZ, m.w, cutD, level);
          }
          m.mesh.scale.set(m.w, 1, m.d);
          m.mesh.position.set(m.x, level * BLOCK_H, m.z);
          placed = m;
          sound.playThunk(1.4);
          haptic('light');
        }
        slabs.push(placed);
        moving = null;
        const a = award(perfect ? 2 : 1, { streak });
        book.record(a, perfect ? { Slabs: 1, Perfects: a.total - 1 } : { Slabs: a.total });
        const p = engine.toScreen(tmp.set(placed.x, level * BLOCK_H + 0.4, placed.z));
        popups.current?.pop(`+${a.total}`, p.x + 40, p.y, popStyle(a.total, perfect ? 'bonus' : undefined));
        feel.kick(perfect ? 0.12 : 0.05);
        if (level % 25 === 0) popups.current?.banner(`${level} HIGH!`, '#a5f3fc');
        pushHud({ score: book.score, height: level, perfect: streak }, true);
        spawnNext();
      };

      engine.addUpdate((dt, t) => {
        if (moving && playing) {
          pos += dir * speed * dt;
          if (pos > TRAVEL) {
            pos = TRAVEL;
            dir = -1;
          } else if (pos < -TRAVEL) {
            pos = -TRAVEL;
            dir = 1;
          }
          if (axis === 'x') moving.x = pos;
          else moving.z = pos;
          moving.mesh.position.set(moving.x, slabs.length * BLOCK_H, moving.z);
        }
        for (let i = falling.length - 1; i >= 0; i--) {
          const f = falling[i];
          f.vel.y -= 14 * dt;
          f.mesh.position.addScaledVector(f.vel, dt);
          f.mesh.rotation.x += f.spin.x * dt;
          f.mesh.rotation.z += f.spin.z * dt;
          f.life -= dt;
          if (f.life <= 0) {
            scene.remove(f.mesh);
            falling.splice(i, 1);
          }
        }
        // camera: follow the top; on game over pull back to show the whole tower
        const h = slabs.length * BLOCK_H;
        if (over) {
          overT = Math.min(1, overT + dt * 0.6);
          const span = Math.max(4, h * 0.75);
          camTarget.lerp(tmp.set(0, h / 2, 0), Math.min(1, dt * 2));
          camera.position.lerp(tmp.set(span * 1.35, h / 2 + span * 0.6, span * 1.35), Math.min(1, dt * 1.5));
        } else {
          camTarget.lerp(tmp.set(0, h - 1.4, 0), Math.min(1, dt * 4));
          camera.position.lerp(tmp.set(12.5, h + 10.5, 12.5), Math.min(1, dt * 4));
        }
        const off = feel.update(dt, t, 0);
        camera.lookAt(camTarget.x + off.x * 0.3, camTarget.y + off.y * 0.3, camTarget.z);
        sun.position.set(6, h + 14, 4);
        sun.target.position.set(0, h, 0);
        sky.position.y = camera.position.y;
        // the sky darkens to space as you climb
        const k = Math.min(1, h / 40);
        skyMat.uniforms.top.value.setHSL(0.72, 0.7, 0.42 - k * 0.32);
        skyMat.uniforms.bottom.value.setHSL(0.92 - k * 0.3, 0.75, 0.62 - k * 0.4);
        clouds.forEach((c, i) => {
          c.position.x += dt * (0.2 + (i % 3) * 0.1);
          if (c.position.x > 16) c.position.x = -16;
        });
      });

      return () => {
        clear();
        api.current = { start: () => {}, drop: () => {} };
      };
    },
    [],
  );

  return (
    <GameShell
      title="SKY STACK"
      accent="#f472b6"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={startGame}
      score={hud.score}
      chips={
        <>
          <span className="px-2 py-0.5 rounded-full bg-black/45 text-white text-[11px] font-black whitespace-nowrap" data-testid="stack-height">
            ▲ {hud.height}
          </span>
          {hud.perfect >= 2 && <span className="px-2 py-0.5 rounded-full bg-amber-300 text-black text-[11px] font-black whitespace-nowrap">PERFECT ×{hud.perfect}</span>}
        </>
      }
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="Tap to drop the slab"
      guide={{
        goal: 'Tap to drop each slab on the tower. Overhang gets sliced off.',
        controls: [{ gesture: 'tap', label: 'Tap = drop' }],
        points: [
          { label: 'Slab', value: '1' },
          { label: 'Perfect', value: '+1', tone: 'bonus' },
          { label: '3 perfects', value: 'grows back', tone: 'gold' },
          { label: '5 perfects', value: '×2', tone: 'fire' },
        ],
        ends: 'Miss the tower and it’s over',
      }}
      tutorial={[
        { icon: <Pointer className="w-6 h-6" />, label: 'Tap to drop' },
        { icon: <Crosshair className="w-6 h-6" />, label: 'Line it up' },
        { icon: <Layers className="w-6 h-6" />, label: 'Stack high' },
      ]}
      scoring="Tap anywhere to drop the sliding slab onto the tower. Whatever hangs over the edge is sliced off, so the next slab is smaller. Land it almost exactly on the slab below for a PERFECT (+1) — three perfects in a row grow the slab back a little, five in a row is ON FIRE ×2. Slabs slide faster as the tower grows, and sometimes come from a surprise side. Miss the tower completely and the run is over. 1 point a slab. Same tower for every player."
    />
  );
}
