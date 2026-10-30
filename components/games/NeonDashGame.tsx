'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AvatarConfig } from '@/lib/avatar-types';
import { drawAvatar } from '@/lib/avatar-canvas-draw';
import { sound, useMuted } from '@/lib/sound';
import { Play, RotateCcw, Volume2, VolumeX, ArrowUp, ArrowDown } from 'lucide-react';

interface NeonDashProps {
  avatar: AvatarConfig;
  onFinish: (score: number) => void;
  modeName?: string;
}

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'ground_spike' | 'high_laser';
}

interface Crystal {
  x: number;
  y: number;
  collected: boolean;
  pulse: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

export default function NeonDashGame({ avatar, onFinish, modeName = 'Match' }: NeonDashProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [distance, setDistance] = useState(0);
  const isMuted = useMuted();

  // References for requestAnimationFrame loop
  const stateRef = useRef({
    playerY: 0,
    playerVy: 0,
    isGrounded: true,
    isJumping: false,
    canDoubleJump: true,
    isSliding: false,
    slideTimer: 0,
    speed: 7.0,
    frame: 0,
    obstacles: [] as Obstacle[],
    crystals: [] as Crystal[],
    particles: [] as Particle[],
    score: 0,
    combo: 1,
    distance: 0,
    gameOver: false,
    nextObstacleDist: 90,
  });

  const jump = useCallback(() => {
    const s = stateRef.current;
    if (s.gameOver) return;
    if (s.isGrounded) {
      s.playerVy = -13.5;
      s.isGrounded = false;
      s.isJumping = true;
      s.isSliding = false;
      s.canDoubleJump = true;
      sound.playJump();
    } else if (s.canDoubleJump) {
      s.playerVy = -11.5;
      s.canDoubleJump = false;
      sound.playJump();
      // Double jump burst
      for (let i = 0; i < 8; i++) {
        s.particles.push({
          x: 120,
          y: s.playerY + 20,
          vx: (Math.random() - 0.5) * 6,
          vy: Math.random() * 3 + 1,
          life: 1,
          color: '#00f0ff',
          size: 4,
        });
      }
    }
  }, []);

  const slide = useCallback(() => {
    const s = stateRef.current;
    if (s.gameOver || !s.isGrounded || s.isSliding) return;
    s.isSliding = true;
    s.slideTimer = 28; // ~0.45 seconds
    sound.playLaser();
  }, []);

  const startGame = useCallback(() => {
    const canvas = canvasRef.current;
    const groundY = canvas ? canvas.height * 0.76 : 280;

    stateRef.current = {
      playerY: groundY,
      playerVy: 0,
      isGrounded: true,
      isJumping: false,
      canDoubleJump: true,
      isSliding: false,
      slideTimer: 0,
      speed: 7.2,
      frame: 0,
      obstacles: [],
      crystals: [],
      particles: [],
      score: 0,
      combo: 1,
      distance: 0,
      gameOver: false,
      nextObstacleDist: 80,
    };

    setScore(0);
    setCombo(1);
    setDistance(0);
    setIsGameOver(false);
    setIsPlaying(true);
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        if (!isPlaying && !isGameOver) startGame();
        else jump();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        slide();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, isGameOver, jump, slide, startGame]);

  // Main 60FPS Game Loop
  useEffect(() => {
    if (!isPlaying) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const loop = () => {
      const s = stateRef.current;
      const width = canvas.width;
      const height = canvas.height;
      const groundY = height * 0.76;

      s.frame++;
      s.distance += Math.floor(s.speed / 2);
      s.speed = Math.min(13.5, 7.2 + s.distance / 1200); // Progressive speed ramp

      // Gravity & Physics
      if (!s.isGrounded) {
        s.playerVy += 0.78; // gravity
        s.playerY += s.playerVy;
        if (s.playerY >= groundY) {
          s.playerY = groundY;
          s.playerVy = 0;
          s.isGrounded = true;
          s.isJumping = false;
        }
      }

      // Slide countdown
      if (s.isSliding) {
        s.slideTimer--;
        if (s.slideTimer <= 0) {
          s.isSliding = false;
        }
      }

      // Spawn Obstacles & Crystals
      s.nextObstacleDist -= s.speed;
      if (s.nextObstacleDist <= 0) {
        const type: Obstacle['type'] = Math.random() > 0.45 ? 'ground_spike' : 'high_laser';
        const obsW = type === 'ground_spike' ? 36 : 48;
        const obsH = type === 'ground_spike' ? 44 : 32;
        const obsY = type === 'ground_spike' ? groundY - obsH : groundY - 68;

        s.obstacles.push({
          x: width + 20,
          y: obsY,
          w: obsW,
          h: obsH,
          type,
        });

        // Spawn bonus crystals in air or near obstacle
        if (Math.random() > 0.35) {
          s.crystals.push({
            x: width + (type === 'ground_spike' ? 30 : -40),
            y: groundY - (type === 'ground_spike' ? 75 : 20),
            collected: false,
            pulse: 0,
          });
        }

        s.nextObstacleDist = Math.floor(Math.random() * 80 + 110) * (s.speed / 7.2);
      }

      // Update & move obstacles
      for (let i = s.obstacles.length - 1; i >= 0; i--) {
        const obs = s.obstacles[i];
        obs.x -= s.speed;

        // Player hitbox check
        const playerX = 120;
        const playerW = 28;
        let playerH = 56;
        let playerBoxY = s.playerY - 56;

        if (s.isSliding) {
          playerH = 26;
          playerBoxY = s.playerY - 26;
        }

        const isColliding =
          playerX + playerW / 2 > obs.x &&
          playerX - playerW / 2 < obs.x + obs.w &&
          playerBoxY + playerH > obs.y &&
          playerBoxY < obs.y + obs.h;

        if (isColliding && !s.gameOver) {
          s.gameOver = true;
          setIsGameOver(true);
          setIsPlaying(false);
          sound.playLose();
          onFinish(s.score);
          return;
        }

        if (obs.x + obs.w < -50) {
          s.obstacles.splice(i, 1);
          // Passed obstacle bonus
          s.score += 50 * s.combo;
          s.combo = Math.min(8, s.combo + 1);
        }
      }

      // Update crystals
      for (let i = s.crystals.length - 1; i >= 0; i--) {
        const c = s.crystals[i];
        c.x -= s.speed;
        c.pulse += 0.1;

        const dist = Math.hypot(120 - c.x, s.playerY - 28 - c.y);
        if (dist < 38 && !c.collected) {
          c.collected = true;
          s.score += 150 * s.combo;
          sound.playScore(1 + s.combo * 0.1);

          // Particle burst
          for (let p = 0; p < 8; p++) {
            s.particles.push({
              x: c.x,
              y: c.y,
              vx: (Math.random() - 0.5) * 6,
              vy: (Math.random() - 0.5) * 6,
              life: 1,
              color: '#ffb800',
              size: 3,
            });
          }
          s.crystals.splice(i, 1);
        } else if (c.x < -20) {
          s.crystals.splice(i, 1);
        }
      }

      // Update particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.04;
        if (p.life <= 0) s.particles.splice(i, 1);
      }

      // Sync state to UI every 6 frames
      if (s.frame % 6 === 0) {
        setScore(s.score + Math.floor(s.distance / 10));
        setCombo(s.combo);
        setDistance(s.distance);
      }

      // --- RENDERING ---
      ctx.clearRect(0, 0, width, height);

      // Background Cyber Sky & Buildings
      const bgOffset = (s.frame * (s.speed * 0.2)) % 400;
      ctx.fillStyle = '#0a0b12';
      ctx.fillRect(0, 0, width, height);

      // Distant Neon Grid Horizon
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
      ctx.lineWidth = 1;
      for (let x = -bgOffset; x < width + 400; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, groundY);
        ctx.lineTo(x + (x - width / 2) * 0.4, 0);
        ctx.stroke();
      }

      // Rooftop Track Platform
      ctx.fillStyle = '#121422';
      ctx.fillRect(0, groundY, width, height - groundY);

      // Platform Neon Trim
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();
      ctx.shadowBlur = 0; // reset

      // Obstacles
      for (const obs of s.obstacles) {
        if (obs.type === 'ground_spike') {
          // Cyber Barrier Spike
          ctx.fillStyle = '#ff0055';
          ctx.shadowColor = '#ff0055';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(obs.x, groundY);
          ctx.lineTo(obs.x + obs.w / 2, obs.y);
          ctx.lineTo(obs.x + obs.w, groundY);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          // Floating Laser Beam (must slide under!)
          ctx.fillStyle = 'rgba(255, 184, 0, 0.85)';
          ctx.shadowColor = '#ffb800';
          ctx.shadowBlur = 14;
          ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
          // Hazard Warning stripes
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(obs.x, obs.y);
          ctx.lineTo(obs.x + obs.w, obs.y + obs.h);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // Energy Crystals
      for (const c of s.crystals) {
        ctx.save();
        ctx.translate(c.x, c.y + Math.sin(c.pulse) * 4);
        ctx.rotate(c.pulse);
        ctx.fillStyle = '#ffb800';
        ctx.shadowColor = '#ffb800';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(8, 0);
        ctx.lineTo(0, 9);
        ctx.lineTo(-8, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Particles
      for (const p of s.particles) {
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // DRAW PLAYABLE CUSTOM AVATAR!
      // Avatar position is exactly at (120, s.playerY)
      const currentAction = s.isSliding ? 'slide' : !s.isGrounded ? 'jump' : 'run';
      drawAvatar(ctx, avatar, 120, s.playerY, 78, {
        frame: s.frame,
        action: currentAction,
        facingRight: true,
        showTrail: true,
      });

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, avatar, onFinish]);

  return (
    <div className="relative flex flex-col items-center w-full max-w-2xl mx-auto select-none">
      {/* Top HUD */}
      <div className="w-full flex items-center justify-between px-4 py-2 bg-[#12131d] border-b border-[#242738] rounded-t-xl text-sm">
        <div className="flex items-center gap-4">
          <span className="font-bold tracking-wider text-cyan-400">NEON DASH</span>
          <span className="text-xs text-slate-400">· {modeName}</span>
        </div>
        <div className="flex items-center gap-5 font-mono">
          <div className="text-slate-300">
            SCORE: <span className="text-white font-bold text-base">{score}</span>
          </div>
          <div className="text-amber-400 font-bold">
            {combo}x <span className="text-xs text-amber-500 font-normal">COMBO</span>
          </div>
          <button
            onClick={() => sound.toggleMute()}
            className="p-1 hover:text-cyan-400 text-slate-400 transition-colors"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Game Canvas Container */}
      <div className="relative w-full aspect-[16/9] bg-[#0a0b12] overflow-hidden border-x border-[#242738]">
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          className="w-full h-full block"
        />

        {/* Start Overlay */}
        {!isPlaying && !isGameOver && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <h2 className="text-2xl font-black italic tracking-wide text-cyan-400 mb-2">NEON DASH</h2>
            <p className="text-sm text-slate-300 max-w-md mb-6">
              Rooftop speed challenge! Jump over red spikes, slide under yellow laser grids, and collect gold energy crystals.
            </p>
            <div className="flex items-center gap-6 text-xs text-slate-400 mb-6">
              <span className="flex items-center gap-1.5"><kbd className="bg-slate-800 px-2 py-1 rounded text-cyan-300">Space</kbd> / <kbd className="bg-slate-800 px-2 py-1 rounded text-cyan-300">↑</kbd> Jump & Double Jump</span>
              <span className="flex items-center gap-1.5"><kbd className="bg-slate-800 px-2 py-1 rounded text-cyan-300">↓</kbd> Slide Under</span>
            </div>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-extrabold text-sm rounded-lg shadow-lg shadow-cyan-500/30 transition-transform active:scale-95"
            >
              <Play className="w-4 h-4 fill-black" /> START RUN
            </button>
          </div>
        )}

        {/* Game Over Overlay */}
        {isGameOver && (
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-red-500 mb-1">RUN FINISHED</span>
            <div className="text-4xl font-black text-white mb-2">{score}</div>
            <div className="text-xs text-slate-400 mb-6">
              Distance: {distance}m · Max Multiplier: {combo}x
            </div>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-sm rounded-lg shadow-md transition-transform active:scale-95"
            >
              <RotateCcw className="w-4 h-4" /> PLAY AGAIN
            </button>
          </div>
        )}
      </div>

      {/* Mobile Touch Action Controls */}
      <div className="w-full flex items-center justify-between p-3 bg-[#12131d] border-t border-[#242738] rounded-b-xl gap-4">
        <button
          onClick={slide}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-amber-400 font-bold rounded-lg border border-slate-700 transition-colors"
        >
          <ArrowDown className="w-5 h-5" /> SLIDE
        </button>
        <button
          onClick={jump}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-300 text-black font-extrabold rounded-lg shadow-md shadow-cyan-500/20 transition-transform active:scale-95"
        >
          <ArrowUp className="w-5 h-5" /> JUMP
        </button>
      </div>
    </div>
  );
}
