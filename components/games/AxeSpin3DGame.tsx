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
import { Pointer, Ban, Apple } from 'lucide-react';

/**
 * AXE SPIN — tap to throw your axe into the spinning log. Every axe that sticks stays in, so the
 * log fills up: hit another axe and yours bounces off — run over. Throw every axe of a level to
 * smash the log and move on. Logs spin in seeded patterns that get nastier — steady, swinging back
 * and forth, surging, stop-and-go — and later logs come with axes already in them. Hit the golden
 * apples on the rim for a bonus. Every 5th log is a BOSS. Score (small numbers): axe 1 · apple +2 ·
 * log smashed +3 · boss log +5. Same logs for every player.
 */

const R = 1.45; // log radius
const LOG_Y = 2.1;
const THROW_Y = -2.6;
const THROW_SPEED = 34;
const AXE_GAP = 0.27; // radians: closer than this to another axe = clang
const APPLE_GAP = 0.3;

type Phase = 'ready' | 'playing' | 'over';
type Pattern = 'steady' | 'swing' | 'surge' | 'stutter' | 'chaos';
interface Level {
  throws: number;
  pre: number[];
  apples: number[];
  base: number;
  dir: number;
  pattern: Pattern;
  boss: boolean;
}

export default function AxeSpin3DGame({ onFinish, seed, rival, match, onExit }: GameProps) {
  const onFinishRef = useLatest(onFinish);
  const seedRef = useLatest(seed);
  const popups = useRef<PopupApi | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, level: 1, left: 6, boss: false });
  const api = useRef({ start: () => {}, throw: () => {} });

  const startGame = useCallback(() => {
    api.current.start();
    setPhase('playing');
  }, []);
  const surface = useSwipe({ onDrag: (_s, ph) => ph === 'start' && api.current.throw() });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp') {
        e.preventDefault();
        api.current.throw();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const { hostRef } = useGameEngine(
    {
      background: 0x1b1410,
      fog: { color: 0x1b1410, density: 0.03 },
      camera: { fov: 50, near: 0.1, far: 80, position: [0, 0.2, 9.5], lookAt: [0, 0.4, 0] },
      exposure: 1.15,
      bloom: { strength: 0.4, radius: 0.4, threshold: 0.85 },
      environment: 0.5,
      studio: { top: 0xffe2b0, left: 0xff8a3d, right: 0x7dd3fc },
      grade: { saturation: 1.1, vignette: 0.4 },
    },
    (engine) => {
      const { scene, camera, quality } = engine;
      const feel = new CameraFeel();
      engine.onResize((_w, _h, aspect) => {
        camera.fov = aspect < 0.7 ? 62 : 50;
        camera.updateProjectionMatrix();
      });
      scene.add(new THREE.HemisphereLight(0xffe7c4, 0x2a1a10, 1.2));
      const key = new THREE.SpotLight(0xffd9a0, 50, 30, 0.55, 0.5, 1.2);
      key.position.set(2, 8, 8);
      key.target.position.set(0, LOG_Y, 0);
      scene.add(key, key.target);
      // backdrop: a timber wall with a target painted on
      const wallC = document.createElement('canvas');
      wallC.width = 512;
      wallC.height = 512;
      {
        const g = wallC.getContext('2d')!;
        for (let i = 0; i < 8; i++) {
          g.fillStyle = i % 2 ? '#3a2416' : '#43291a';
          g.fillRect(i * 64, 0, 64, 512);
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(i * 64, 0, 3, 512);
        }
      }
      const wall = new THREE.Mesh(engine.own(new THREE.PlaneGeometry(30, 22)), engine.own(new THREE.MeshStandardMaterial({ map: engine.own(new THREE.CanvasTexture(wallC)), roughness: 0.95 })));
      wall.position.set(0, 2, -3);
      scene.add(wall);

      // the log: bark round the side, rings on the face
      const faceC = document.createElement('canvas');
      faceC.width = faceC.height = 512;
      {
        const g = faceC.getContext('2d')!;
        g.fillStyle = '#d8a46a';
        g.fillRect(0, 0, 512, 512);
        for (let r = 250; r > 0; r -= 18) {
          g.strokeStyle = `rgba(120,70,30,${0.25 + (r % 36 ? 0.1 : 0.2)})`;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(256, 256, r, 0, Math.PI * 2);
          g.stroke();
        }
        g.fillStyle = '#7c4a22';
        g.beginPath();
        g.arc(256, 256, 10, 0, Math.PI * 2);
        g.fill();
      }
      const faceTex = engine.own(new THREE.CanvasTexture(faceC));
      faceTex.colorSpace = THREE.SRGBColorSpace;
      const barkMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x5b3a1f, roughness: 0.95 }));
      const faceMat = engine.own(new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.8 }));
      const bossFace = engine.own(new THREE.MeshStandardMaterial({ map: faceTex, color: 0xff6b6b, roughness: 0.6, emissive: 0x400000 }));
      const logGeo = engine.own(new THREE.CylinderGeometry(R, R, 0.7, 48));
      const logGroup = new THREE.Group();
      logGroup.position.set(0, LOG_Y, 0);
      const log = new THREE.Mesh(logGeo, [barkMat, faceMat, faceMat]);
      log.rotation.x = Math.PI / 2;
      log.castShadow = quality.shadows;
      logGroup.add(log);
      scene.add(logGroup);

      // the axe: wooden handle, steel head (blade at the origin, handle along -y)
      const handleGeo = engine.own(new THREE.CylinderGeometry(0.045, 0.055, 1.1, 8));
      handleGeo.translate(0, -0.6, 0);
      const handleMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x9a5b2b, roughness: 0.7 }));
      const headGeo = engine.own(new THREE.BoxGeometry(0.42, 0.22, 0.08));
      const edgeGeo = engine.own(new THREE.BoxGeometry(0.44, 0.05, 0.09));
      edgeGeo.translate(0, 0.12, 0);
      const steelMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xb8c2d0, roughness: 0.3, metalness: 0.55 }));
      const edgeMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.4, emissive: 0x334155 }));
      const makeAxe = () => {
        const g = new THREE.Group();
        const h = new THREE.Mesh(handleGeo, handleMat);
        const head = new THREE.Mesh(headGeo, steelMat);
        head.position.set(0.12, -0.08, 0);
        const edge = new THREE.Mesh(edgeGeo, edgeMat);
        edge.position.set(0.12, -0.08, 0);
        g.add(h, head, edge);
        g.traverse((o) => ((o as THREE.Mesh).castShadow = quality.shadows));
        g.scale.setScalar(1.35);
        return g;
      };
      const appleGeo = engine.own(new THREE.SphereGeometry(0.17, 16, 12));
      const appleMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xffc83a, roughness: 0.25, metalness: 0.5, emissive: 0x6b4200, emissiveIntensity: 0.7 }));
      const particles = new ParticleBursts(engine);
      const chunkGeo = engine.own(new THREE.BoxGeometry(0.5, 0.3, 0.5));

      let rng = mulberry32(1);
      let lvl: Level | null = null;
      let levelNo = 1;
      let left = 0;
      let angle = 0;
      let lt = 0; // time on this log
      let stuck: { a: number; obj: THREE.Group }[] = [];
      let apples: { a: number; obj: THREE.Mesh }[] = [];
      let flying: { obj: THREE.Group; y: number } | null = null;
      const bounced: { obj: THREE.Group; vel: THREE.Vector3; spin: number; life: number }[] = [];
      const chunks: { obj: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }[] = [];
      let ready: THREE.Group | null = null;
      let playing = false;
      let between = 0; // pause after a log is smashed
      let book = new ScoreBook();
      const tmp = new THREE.Vector3();

      /** Seeded level design: more throws, more pre-stuck axes and wilder spin as you go. */
      const makeLevel = (n: number): Level => {
        const boss = n % 5 === 0;
        const throws = Math.min(10, 5 + Math.floor(n / 2)) + (boss ? 2 : 0);
        const preN = n < 2 ? 0 : Math.min(5, Math.floor((n - 1) / 2) + (boss ? 2 : 0));
        const taken: number[] = [];
        const freeAngle = () => {
          for (let k = 0; k < 40; k++) {
            const a = rng() * Math.PI * 2;
            if (taken.every((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > AXE_GAP * 2)) {
              taken.push(a);
              return a;
            }
          }
          return rng() * Math.PI * 2;
        };
        const pre = Array.from({ length: preN }, freeAngle);
        const apples = Array.from({ length: n === 1 ? 1 : 1 + Math.floor(rng() * 2) }, freeAngle);
        const patterns: Pattern[] = n < 3 ? ['steady'] : n < 6 ? ['steady', 'swing', 'surge'] : ['swing', 'surge', 'stutter', 'steady'];
        return { throws, pre, apples, base: Math.min(4.2, 1.6 + n * 0.17), dir: rng() < 0.5 ? 1 : -1, pattern: boss ? 'chaos' : patterns[Math.floor(rng() * patterns.length)], boss };
      };

      /** Spin speed (rad/s) at time t on this log. */
      const omega = (L: Level, t: number) => {
        const b = L.base * L.dir;
        switch (L.pattern) {
          case 'swing':
            return b * 1.5 * Math.sin(t * 1.1); // back and forth
          case 'surge':
            return b * (0.45 + 1.6 * Math.max(0, Math.sin(t * 1.9)) ** 2);
          case 'stutter':
            return Math.sin(t * 2.6) > -0.2 ? b * 1.3 : b * 0.05;
          case 'chaos':
            return b * (Math.sin(t * 0.9) * 1.4 + Math.sin(t * 2.3) * 0.7 + 0.2);
          default:
            return b;
        }
      };

      const clearLog = () => {
        stuck.forEach((s) => logGroup.remove(s.obj));
        apples.forEach((a) => logGroup.remove(a.obj));
        stuck = [];
        apples = [];
      };

      const placeOnLog = (obj: THREE.Object3D, a: number, r: number) => {
        obj.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.05);
        obj.rotation.set(0, 0, a + Math.PI / 2);
        logGroup.add(obj);
      };

      const newReady = () => {
        if (ready) scene.remove(ready);
        ready = left > 0 ? makeAxe() : null;
        if (ready) {
          ready.position.set(0, THROW_Y - 0.6, 0.3);
          scene.add(ready);
        }
      };

      const startLevel = () => {
        clearLog();
        lvl = makeLevel(levelNo);
        left = lvl.throws;
        lt = 0;
        angle = rng() * Math.PI * 2;
        log.material = [barkMat, lvl.boss ? bossFace : faceMat, lvl.boss ? bossFace : faceMat];
        for (const a of lvl.pre) {
          const ax = makeAxe();
          placeOnLog(ax, a, R - 0.08);
          stuck.push({ a, obj: ax });
        }
        for (const a of lvl.apples) {
          const ap = new THREE.Mesh(appleGeo, appleMat);
          placeOnLog(ap, a, R + 0.14);
          apples.push({ a, obj: ap });
        }
        logGroup.scale.setScalar(0.01);
        newReady();
        if (lvl.boss) popups.current?.banner(`BOSS LOG · ${levelNo}`, '#f87171');
        else if (levelNo > 1) popups.current?.banner(`LOG ${levelNo}`, '#fde68a');
        pushHud({ level: levelNo, left, boss: lvl.boss }, true);
      };

      const reset = () => {
        rng = mulberry32(seedRef.current ?? randomSeed());
        levelNo = 1;
        book = new ScoreBook();
        between = 0;
        bounced.forEach((b) => scene.remove(b.obj));
        bounced.length = 0;
        chunks.forEach((c) => scene.remove(c.obj));
        chunks.length = 0;
        if (flying) scene.remove(flying.obj);
        flying = null;
        particles.clear();
        startLevel();
      };
      reset();

      const finish = () => {
        playing = false;
        sound.playLose();
        haptic('fail');
        popups.current?.banner(`CLANG! · LOG ${levelNo}`, '#f87171');
        pushHud({ score: book.score }, true);
        setPhase('over');
        setTimeout(() => onFinishRef.current(book.score, { maxCombo: levelNo, breakdown: book.breakdown() }), 1500);
      };

      const points = (parts: Record<string, number>, at: THREE.Vector3, tone?: 'bonus' | 'gold' | 'jackpot') => {
        const raw = Object.values(parts).reduce((a, b) => a + b, 0);
        const a = award(raw, {});
        book.record(a, parts);
        const p = engine.toScreen(at);
        popups.current?.pop(`+${a.total}`, p.x, p.y, popStyle(a.total, tone));
        pushHud({ score: book.score }, true);
      };

      const smash = () => {
        // the log bursts into chunks and the stuck axes fly
        const bonus = lvl?.boss ? 5 : 3;
        points(lvl?.boss ? { 'Boss logs': bonus } : { 'Logs smashed': bonus }, tmp.set(0, LOG_Y + 0.4, 0), 'gold');
        sound.playCombo(2);
        haptic('big');
        engine.flash(0.4);
        feel.kick(0.5);
        for (let k = 0; k < 10; k++) {
          const c = new THREE.Mesh(chunkGeo, barkMat);
          c.scale.set(0.7 + Math.random() * 0.7, 1, 1);
          c.position.set(0, LOG_Y, 0);
          const a = (k / 10) * Math.PI * 2;
          scene.add(c);
          chunks.push({ obj: c, vel: new THREE.Vector3(Math.cos(a) * 5, Math.sin(a) * 5 + 2, 2), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, 0), life: 1.6 });
        }
        for (const s of stuck) {
          const w = s.obj.getWorldPosition(new THREE.Vector3());
          logGroup.remove(s.obj);
          s.obj.position.copy(w);
          scene.add(s.obj);
          bounced.push({ obj: s.obj, vel: new THREE.Vector3(w.x * 3, (w.y - LOG_Y) * 3 + 3, 3), spin: 8, life: 1.6 });
        }
        stuck = [];
        particles.emit(tmp.set(0, LOG_Y, 0), 0xd8a46a, { count: 40, speed: 6, life: 0.8, gravity: 8 });
        logGroup.visible = false;
        between = 1.1;
        levelNo += 1;
      };

      api.current.start = () => {
        reset();
        playing = true;
        sound.startMusic(0.18);
        pushHud({ score: 0 }, true);
      };
      api.current.throw = () => {
        if (!playing || flying || left <= 0 || between > 0 || !ready) return;
        flying = { obj: ready, y: ready.position.y };
        ready = null;
        left -= 1;
        sound.playWhiff();
        haptic('tap');
        pushHud({ left }, true);
      };

      engine.addUpdate((dt, t) => {
        // log spin
        if (lvl && playing && between <= 0) {
          lt += dt;
          angle += omega(lvl, lt) * dt;
        }
        logGroup.rotation.z = angle;
        if (logGroup.visible) logGroup.scale.setScalar(Math.min(1, logGroup.scale.x + dt * 6));
        // wobble the log a touch when hit
        logGroup.position.y += (LOG_Y - logGroup.position.y) * Math.min(1, dt * 12);

        if (between > 0) {
          between -= dt;
          if (between <= 0) {
            logGroup.visible = true;
            startLevel();
          }
        }

        // the axe in flight
        if (flying) {
          flying.y += THROW_SPEED * dt;
          flying.obj.position.set(0, flying.y, 0.3);
          flying.obj.rotation.z = 0;
          if (flying.y >= LOG_Y - R + 0.06) {
            // impact at the bottom of the log: which angle is that in the log's own frame?
            const a = -Math.PI / 2 - angle;
            const norm = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
            const clash = stuck.some((s) => Math.abs(norm(s.a - a)) < AXE_GAP);
            const obj = flying.obj;
            flying = null;
            if (clash) {
              scene.remove(obj);
              scene.add(obj);
              obj.position.set(0, LOG_Y - R - 0.2, 0.4);
              bounced.push({ obj, vel: new THREE.Vector3((Math.random() - 0.5) * 4, -3, 2), spin: 14, life: 1.8 });
              sound.playPunch(false, true);
              particles.emit(tmp.set(0, LOG_Y - R, 0.4), 0xffe08a, { count: 18, speed: 5, life: 0.4, gravity: 4 });
              feel.kick(0.8);
              engine.flash(0.5);
              finish();
            } else {
              scene.remove(obj);
              placeOnLog(obj, a, R - 0.08);
              stuck.push({ a, obj });
              logGroup.position.y += 0.08;
              sound.playThunk(1 + Math.random() * 0.1);
              haptic('light');
              feel.kick(0.08);
              particles.emit(tmp.set(0, LOG_Y - R, 0.4), 0xd8a46a, { count: 8, speed: 2.5, life: 0.35, gravity: 6 });
              const hitAt = tmp.set(0.4, LOG_Y - R, 0.4).clone();
              const ap = apples.findIndex((x) => Math.abs(norm(x.a - a)) < APPLE_GAP);
              if (ap >= 0) {
                const apple = apples[ap];
                const w = apple.obj.getWorldPosition(new THREE.Vector3());
                logGroup.remove(apple.obj);
                apples.splice(ap, 1);
                particles.emit(w, 0xffc83a, { count: 26, speed: 4, life: 0.6, gravity: 5 });
                sound.playPowerup();
                points({ Axes: 1, Apples: 2 }, hitAt, 'bonus');
              } else points({ Axes: 1 }, hitAt);
              if (left <= 0) smash();
              else newReady();
            }
          }
        }
        // ready axe slides up into place
        if (ready) ready.position.y += (THROW_Y - ready.position.y) * Math.min(1, dt * 14);
        for (let i = bounced.length - 1; i >= 0; i--) {
          const b = bounced[i];
          b.vel.y -= 16 * dt;
          b.obj.position.addScaledVector(b.vel, dt);
          b.obj.rotation.z += b.spin * dt;
          b.life -= dt;
          if (b.life <= 0) {
            scene.remove(b.obj);
            bounced.splice(i, 1);
          }
        }
        for (let i = chunks.length - 1; i >= 0; i--) {
          const c = chunks[i];
          c.vel.y -= 14 * dt;
          c.obj.position.addScaledVector(c.vel, dt);
          c.obj.rotation.x += c.spin.x * dt;
          c.obj.rotation.y += c.spin.y * dt;
          c.life -= dt;
          if (c.life <= 0) {
            scene.remove(c.obj);
            chunks.splice(i, 1);
          }
        }
        const off = feel.update(dt, t, 0);
        camera.position.set(off.x, 0.2 + off.y, 9.5);
        camera.lookAt(0, 0.4, 0);
      });

      return () => {
        api.current = { start: () => {}, throw: () => {} };
      };
    },
    [],
  );

  return (
    <GameShell
      title="AXE SPIN"
      accent="#f59e0b"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={startGame}
      score={hud.score}
      chips={
        <>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-black whitespace-nowrap ${hud.boss ? 'bg-rose-500 text-white' : 'bg-black/50 text-amber-200'}`} data-testid="axe-level">
            {hud.boss ? 'BOSS ' : 'LOG '}
            {hud.level}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-black/50 text-white text-[11px] font-black whitespace-nowrap" data-testid="axe-left">
            🪓 ×{hud.left}
          </span>
        </>
      }
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="Tap to throw · don’t hit another axe"
      guide={{
        goal: 'Throw every axe into the spinning log. Never hit another axe.',
        controls: [{ gesture: 'tap', label: 'Tap = throw' }],
        points: [
          { label: 'Axe', value: '1' },
          { label: 'Golden apple', value: '+2', tone: 'bonus' },
          { label: 'Log smashed', value: '+3', tone: 'gold' },
          { label: 'Boss log', value: '+5', tone: 'jackpot' },
        ],
        ends: 'One clang and it’s over',
      }}
      tutorial={[
        { icon: <Pointer className="w-6 h-6" />, label: 'Tap to throw' },
        { icon: <Ban className="w-6 h-6" />, label: 'Miss the axes' },
        { icon: <Apple className="w-6 h-6" />, label: 'Hit the apples' },
      ]}
      scoring="Tap anywhere to throw your axe into the spinning log. Every axe that sticks stays there, so gaps get tighter — hit another axe and yours bounces off: the run is over. Throw all of a log's axes to smash it and move to the next. Logs spin in patterns that get nastier (steady, swinging, surging, stop-and-go), later logs already have axes in them, and every 5th log is a BOSS. Axe 1 · golden apple +2 · log smashed +3 · boss log +5. Same logs for every player."
    />
  );
}
