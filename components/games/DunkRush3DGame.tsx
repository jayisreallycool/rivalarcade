'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { create3DAvatar } from '@/lib/avatar-3d-model';
import { sound, useMuted } from '@/lib/sound';
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
import RivalBar from './RivalBar';
import { Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

type DunkRush3DProps = GameProps;

const ROUND_SECONDS = 45;
const BALL_START = new THREE.Vector3(0, 1.5, 6.0);
const RIM_HEIGHT = 3.6;
const RIM_Z = -7.7;
const AIM_POINTS = 22;

type Phase = 'ready' | 'playing' | 'over';

/** Same launch math for the real shot and the aim preview, so the guide never lies. */
function launchVelocity(dx: number, dy: number, power: number, out: THREE.Vector3) {
  const vx = -dx * 0.055;
  const vy = Math.min(18, Math.max(9, dy * 0.065 + power * 0.25));
  const vz = -Math.min(26, Math.max(14, power * 0.35 + 15));
  return out.set(vx, vy, vz);
}

function makeCourtTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  // Wood planks
  for (let i = 0; i < 32; i++) {
    const shade = 22 + Math.floor(Math.random() * 10);
    ctx.fillStyle = `rgb(${shade + 8},${shade + 10},${shade + 26})`;
    ctx.fillRect(i * 16, 0, 16, 1024);
  }
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 1008);
  // Key + free throw circle (hoop end is top of texture)
  ctx.strokeStyle = '#ff5500';
  ctx.strokeRect(176, 8, 160, 300);
  ctx.beginPath();
  ctx.arc(256, 308, 80, 0, Math.PI * 2);
  ctx.stroke();
  // Three-point arc
  ctx.strokeStyle = '#00f0ff';
  ctx.beginPath();
  ctx.arc(256, 60, 330, 0.12 * Math.PI, 0.88 * Math.PI);
  ctx.stroke();
  // Centre circle
  ctx.beginPath();
  ctx.arc(256, 1016, 90, Math.PI, 2 * Math.PI);
  ctx.stroke();
  return c;
}

function makeBallTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e65c00';
  ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 128, 2, 2);
  }
  ctx.strokeStyle = '#1a0a00';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 64);
  ctx.lineTo(256, 64);
  ctx.moveTo(64, 0);
  ctx.lineTo(64, 128);
  ctx.moveTo(192, 0);
  ctx.lineTo(192, 128);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(128, 64, 40, 64, 0, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

export default function DunkRush3DGame({ avatar, onFinish, modeName = 'Match', rival }: DunkRush3DProps) {
  // Dunk Rush has no random gameplay elements (hoop motion is fixed), so every seed plays the same.
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, streak: 0, bestStreak: 0, timeLeft: ROUND_SECONDS });
  const isMuted = useMuted();
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dragRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const sim = useRef({
    playing: false,
    score: 0,
    streak: 0,
    bestStreak: 0,
    baskets: 0,
    timeLeft: ROUND_SECONDS,
    hoopX: 0,
    hoopSpeed: 2.2,
    hoopDir: 1,
    ballInAir: false,
    ballScored: false,
    ballPos: BALL_START.clone(),
    ballVel: new THREE.Vector3(),
    aim: null as null | { dx: number; dy: number },
    shotRequest: null as null | { dx: number; dy: number; power: number },
  });

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const showFlash = useCallback((msg: string) => {
    setFlashMessage(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMessage(null), 1400);
  }, []);

  const startGame = useCallback(() => {
    Object.assign(sim.current, {
      playing: true,
      score: 0,
      streak: 0,
      bestStreak: 0,
      baskets: 0,
      timeLeft: ROUND_SECONDS,
      hoopX: 0,
      hoopDir: 1,
      ballInAir: false,
      ballScored: false,
      aim: null,
      shotRequest: null,
    });
    sim.current.ballPos.copy(BALL_START);
    pushHud({ score: 0, streak: 0, bestStreak: 0, timeLeft: ROUND_SECONDS }, true);
    setPhase('playing');
  }, [pushHud]);

  // Input only records intent; the engine loop applies it (single source of truth).
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = sim.current;
    if (!s.playing || s.ballInAir) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY };
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    d.currentX = e.clientX;
    d.currentY = e.clientY;
    sim.current.aim = { dx: d.currentX - d.startX, dy: d.currentY - d.startY };
  };
  const handlePointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    sim.current.aim = null;
    if (!d) return;
    const dx = d.currentX - d.startX;
    const dy = d.currentY - d.startY;
    const power = Math.hypot(dx, dy);
    if (power > 20) sim.current.shotRequest = { dx, dy, power };
  };

  const { hostRef } = useGameEngine(
    {
      background: 0x0a0c16,
      fog: { density: 0.018 },
      camera: { fov: 54, far: 120, position: [0, 4.4, 12.5], lookAt: [0, 2.0, -3] },
      exposure: 1.2,
      bloom: { strength: 0.6, radius: 0.25, threshold: 0.85 },
    },
    (engine) => {
      const { scene, quality } = engine;

      // Lights: warm key spot (shadows by tier) + cyan fill spot + hemi
      scene.add(new THREE.HemisphereLight(0xffffff, 0x181a28, 0.9));
      const key = new THREE.SpotLight(0xffeedd, 260, 60, Math.PI / 5, 0.45, 2);
      key.position.set(-6, 16, 8);
      key.target.position.set(0, 0, -2);
      engine.configureShadows(key);
      const fill = new THREE.SpotLight(0x00f0ff, 80, 60, Math.PI / 4, 0.5, 2);
      fill.position.set(8, 14, -6);
      fill.target.position.set(0, 2, -6);
      scene.add(key, key.target, fill, fill.target);

      // Court
      const courtTex = engine.own(new THREE.CanvasTexture(makeCourtTexture()));
      courtTex.colorSpace = THREE.SRGBColorSpace;
      courtTex.anisotropy = Math.min(8, engine.renderer.capabilities.getMaxAnisotropy());
      const court = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 30),
        new THREE.MeshStandardMaterial({ map: courtTex, roughness: 0.35, metalness: 0.15, emissive: 0xffffff, emissiveMap: courtTex, emissiveIntensity: 0.25 }),
      );
      court.rotation.x = -Math.PI / 2;
      court.position.z = -5;
      court.receiveShadow = quality.shadows;
      scene.add(court);

      // Arena ring + crowd lights
      const trim = new THREE.Mesh(new THREE.TorusGeometry(15, 0.05, 6, 96), neonMaterial(0xff5500, 1.4));
      trim.rotation.x = -Math.PI / 2;
      trim.scale.set(0.62, 1.15, 1);
      trim.position.set(0, 0.03, -5);
      scene.add(trim);
      scene.add(createStarfield(engine, { count: 400, radius: 45, color: '#ffd9a0', size: 0.25, yMin: 4 }));

      // Hoop
      const hoopGroup = new THREE.Group();
      hoopGroup.position.set(0, 0, -8.5);
      scene.add(hoopGroup);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 6.5, 12), new THREE.MeshStandardMaterial({ color: 0x222638, roughness: 0.5, metalness: 0.6 }));
      post.position.set(0, 3.25, -1.2);
      post.castShadow = quality.shadows;
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(3.6, 2.4, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      board.position.set(0, 4.4, 0);
      const boardEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.6, 2.4, 0.12)), new THREE.LineBasicMaterial({ color: new THREE.Color(0x00f0ff).multiplyScalar(2), toneMapped: false }));
      boardEdge.position.copy(board.position);
      const target = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), neonMaterial(0xff0055, 1.6));
      target.position.set(0, 4.0, 0.07);
      const rimMat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xff5500, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.6 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 10, 32), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(0, RIM_HEIGHT, 0.8);
      const net = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.42, 1.1, 16, 4, true), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, wireframe: true, transparent: true, opacity: 0.7 }));
      net.position.set(0, RIM_HEIGHT - 0.55, 0.8);
      hoopGroup.add(post, board, boardEdge, target, rim, net);

      // Ball
      const ballTex = engine.own(new THREE.CanvasTexture(makeBallTexture()));
      ballTex.colorSpace = THREE.SRGBColorSpace;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.38, 32, 20), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.55, metalness: 0.05 }));
      ball.castShadow = quality.shadows;
      ball.position.copy(BALL_START);
      scene.add(ball);
      const ballShadow = createBlobShadow(engine, 0.45, 0.5);
      ballShadow.position.y = 0.02;
      scene.add(ballShadow);

      // Aim guide: dotted arc as Points (renders at any line width, unlike WebGL lines)
      const aimPositions = new Float32Array(AIM_POINTS * 3);
      const aimGeo = new THREE.BufferGeometry();
      aimGeo.setAttribute('position', new THREE.BufferAttribute(aimPositions, 3));
      const aim = new THREE.Points(aimGeo, new THREE.PointsMaterial({ color: new THREE.Color(0x00f0ff).multiplyScalar(2), size: 0.16, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
      aim.visible = false;
      aim.frustumCulled = false;
      scene.add(aim);

      // Player
      const avatar3D = create3DAvatar(stableAvatar);
      engine.own(avatar3D);
      avatar3D.group.position.set(-0.8, 0, 6.0);
      avatar3D.group.rotation.y = 0.25;
      scene.add(avatar3D.group);
      const playerShadow = createBlobShadow(engine, 0.55);
      playerShadow.position.set(-0.8, 0.02, 6.0);
      scene.add(playerShadow);

      const particles = new ParticleBursts(engine);
      const rimWorld = new THREE.Vector3();
      const vel = new THREE.Vector3();
      let netKick = 0;
      let trailTimer = 0;

      const finishRound = () => {
        const s = sim.current;
        s.playing = false;
        s.aim = null;
        sound.playLose();
        pushHud({ timeLeft: 0, score: s.score }, true);
        setPhase('over');
        onFinishRef.current(s.score, { baskets: s.baskets, maxCombo: s.bestStreak });
      };

      engine.addUpdate((dt, t) => {
        const s = sim.current;

        if (s.playing) {
          // Round clock lives in the loop: it pauses with the engine (hidden tab, off-screen).
          s.timeLeft -= dt;
          if (s.timeLeft <= 0) finishRound();
          else pushHud({ timeLeft: Math.ceil(s.timeLeft) });

          s.hoopX += s.hoopSpeed * s.hoopDir * dt;
          if (s.hoopX > 3.6) s.hoopDir = -1;
          if (s.hoopX < -3.6) s.hoopDir = 1;
          hoopGroup.position.x = s.hoopX;

          if (s.shotRequest && !s.ballInAir) {
            const { dx, dy, power } = s.shotRequest;
            launchVelocity(dx, dy, power, s.ballVel);
            s.ballPos.copy(BALL_START);
            s.ballInAir = true;
            s.ballScored = false;
            sound.playJump();
            avatar3D.trigger('shoot', 0.45);
          }
        }
        s.shotRequest = null;

        // Aim preview
        if (s.aim && s.playing && !s.ballInAir) {
          launchVelocity(s.aim.dx, s.aim.dy, Math.hypot(s.aim.dx, s.aim.dy), vel);
          let x = BALL_START.x;
          let y = BALL_START.y;
          let z = BALL_START.z;
          let vy = vel.y;
          const step = 0.045;
          for (let i = 0; i < AIM_POINTS; i++) {
            aimPositions[i * 3] = x;
            aimPositions[i * 3 + 1] = y;
            aimPositions[i * 3 + 2] = z;
            x += vel.x * step;
            vy -= 28 * step;
            y += vy * step;
            z += vel.z * step;
          }
          aimGeo.attributes.position.needsUpdate = true;
          aim.visible = true;
        } else {
          aim.visible = false;
        }

        // Ball physics
        if (s.ballInAir) {
          s.ballVel.y -= 28 * dt;
          s.ballPos.addScaledVector(s.ballVel, dt);
          ball.rotation.x -= 9 * dt;

          trailTimer += dt;
          if (trailTimer > 0.03) {
            trailTimer = 0;
            particles.emit(s.ballPos, 0xff7a1a, { count: 1, speed: 0.4, life: 0.35, size: 0.9, gravity: 0 });
          }

          rimWorld.set(s.hoopX, RIM_HEIGHT, RIM_Z);
          const dist = s.ballPos.distanceTo(rimWorld);
          if (!s.ballScored && dist < 0.8 && s.ballVel.y < 0) {
            s.ballScored = true;
            const clean = dist < 0.45;
            const pts = clean ? (s.streak >= 2 ? 6 : 3) : s.streak >= 2 ? 4 : 2;
            s.score += pts;
            s.streak += 1;
            s.bestStreak = Math.max(s.bestStreak, s.streak);
            s.baskets += 1;
            sound.playSwish();
            netKick = 1;
            engine.flash(clean ? 0.8 : 0.4);
            particles.emit(rimWorld, clean ? 0xffb800 : 0x00f0ff, { count: clean ? 36 : 20, speed: 5, life: 0.8 });
            avatar3D.trigger('celebrate', 1.2);
            pushHud({ score: s.score, streak: s.streak, bestStreak: s.bestStreak }, true);
            showFlash(clean ? (s.streak >= 3 ? '🔥 ON FIRE! +6' : '⚡ CLEAN SWISH! +3') : '+2 BUCKET!');
          }

          if (s.ballPos.y < 0.4 || s.ballPos.z < -14) {
            if (!s.ballScored) {
              s.streak = 0;
              pushHud({ streak: 0 }, true);
            }
            s.ballInAir = false;
            s.ballPos.copy(BALL_START);
          }
        } else {
          // Idle dribble bob in the player's hands
          s.ballPos.set(BALL_START.x, BALL_START.y + Math.abs(Math.sin(t * 3)) * 0.08, BALL_START.z);
        }
        ball.position.copy(s.ballPos);
        ballShadow.position.set(s.ballPos.x, 0.02, s.ballPos.z);
        const h = Math.min(1, s.ballPos.y / 6);
        ballShadow.scale.setScalar(1 + h);
        (ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - h * 0.8);

        // Net swish
        if (netKick > 0) {
          netKick = Math.max(0, netKick - dt * 2.5);
          const wobble = Math.sin(netKick * 20) * netKick * 0.25;
          net.scale.set(1 - wobble * 0.3, 1 + wobble, 1 - wobble * 0.3);
        }
        rimMat.emissiveIntensity = 0.9 + netKick * 2;

        avatar3D.updateAnimation(t, 'idle', dt);
      });
    },
    [stableAvatar],
  );

  return (
    <div className="relative flex flex-col items-center w-full max-w-3xl mx-auto select-none">
      {/* Top HUD */}
      <div className="w-full flex items-center justify-between px-4 py-2.5 bg-[#12131d] border-b border-[#242738] rounded-t-xl text-sm gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-extrabold tracking-wider text-orange-400 text-xs sm:text-sm whitespace-nowrap">DUNK RUSH 3D</span>
          <span className="text-xs text-slate-400 hidden sm:inline">· {modeName}</span>
        </div>
        <div className="flex items-center gap-2.5 sm:gap-5 font-mono text-xs sm:text-sm">
          <div className="text-slate-300">
            <span className="hidden sm:inline">SCORE: </span><span className="text-white font-bold text-sm sm:text-base tabular-nums">{hud.score}</span>
          </div>
          <div className="text-orange-400 font-bold">{hud.streak > 1 ? `🔥 ${hud.streak}x STREAK` : `${hud.streak} STREAK`}</div>
          <div className="text-cyan-400 font-bold tabular-nums">{hud.timeLeft}s</div>
          <button onClick={() => sound.toggleMute()} className="p-1 hover:text-cyan-400 text-slate-400 transition-colors">
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
          </button>
        </div>
      </div>

      {rival && <RivalBar rival={rival} score={hud.score} progress={phase === 'ready' ? 0 : 1 - hud.timeLeft / ROUND_SECONDS} />}

      {/* 3D viewport with drag-and-release shooting */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative w-full aspect-[16/9] bg-[#0a0c16] overflow-hidden border-x border-[#242738] touch-none cursor-crosshair"
      >
        <div ref={hostRef} className="absolute inset-0" />

        {flashMessage && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-black/80 px-4 py-2 rounded-xl border border-amber-400/50 text-amber-300 font-black text-lg shadow-lg shadow-amber-500/20 animate-bounce pointer-events-none z-20">
            {flashMessage}
          </div>
        )}

        {phase === 'ready' && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-6 text-center z-10">
            <h2 className="text-3xl font-black italic tracking-wide text-orange-400 mb-2">DUNK RUSH 3D</h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-md mb-6">
              Full 3D Basketball Shootout! Touch & drag backwards to aim trajectory arc towards the moving hoop, then release to shoot swishes in full 3D!
            </p>
            <div className="text-xs text-slate-400 mb-6 font-mono">Drag backward to charge arc · Steer left/right · Release to shoot</div>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-extrabold text-sm rounded-xl shadow-lg shadow-orange-500/30 transition-transform active:scale-95"
            >
              <Play className="w-4 h-4 fill-black" /> START 3D SHOOTOUT
            </button>
          </div>
        )}

        {phase === 'over' && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-10">
            <span className="text-xs font-semibold uppercase tracking-widest text-orange-500 mb-1">BUZZER BEATER</span>
            <div className="text-4xl font-black text-white mb-2">{hud.score} PTS</div>
            <div className="text-xs text-slate-400 mb-6">Best Swish Streak: {hud.bestStreak} in a row</div>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-6 py-2.5 bg-orange-500 hover:bg-orange-400 text-black font-bold text-sm rounded-lg shadow-md transition-transform active:scale-95"
            >
              <RotateCcw className="w-4 h-4" /> PLAY AGAIN
            </button>
          </div>
        )}
      </div>

      <div className="w-full p-3 bg-[#12131d] border-t border-[#242738] rounded-b-xl text-center text-xs text-slate-400">
        Mobile Drag & Slide Controls: Touch and drag backwards on screen to reveal the 3D trajectory guide, then release!
      </div>
    </div>
  );
}
