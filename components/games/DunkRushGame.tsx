'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AvatarConfig } from '@/lib/avatar-types';
import { drawAvatar } from '@/lib/avatar-canvas-draw';
import { sound, useMuted } from '@/lib/sound';
import { Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

interface DunkRushProps {
  avatar: AvatarConfig;
  onFinish: (score: number) => void;
  modeName?: string;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  inAir: boolean;
  isFireball: boolean;
  scored: boolean;
}

export default function DunkRushGame({ avatar, onFinish, modeName = 'Match' }: DunkRushProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(45);
  const isMuted = useMuted();
  const [isAiming, setIsAiming] = useState(false);

  const stateRef = useRef({
    frame: 0,
    score: 0,
    streak: 0,
    timeLeft: 45,
    gameOver: false,
    hoopX: 520,
    hoopY: 130,
    hoopSpeed: 1.8,
    hoopDir: 1,
    ball: {
      x: 100,
      y: 240,
      vx: 0,
      vy: 0,
      radius: 12,
      inAir: false,
      isFireball: false,
      scored: false,
    } as Ball,
    aimAngle: -55, // degrees
    aimPower: 16,
    avatarAction: 'idle' as 'idle' | 'shoot' | 'celebrate',
    avatarActionTimer: 0,
    netSway: 0,
    flashText: '',
    flashTimer: 0,
  });

  const shootBall = useCallback((power: number, angleDeg: number) => {
    const s = stateRef.current;
    if (s.gameOver || s.ball.inAir) return;

    const rad = (angleDeg * Math.PI) / 180;
    s.ball.x = 110;
    s.ball.y = 210;
    s.ball.vx = Math.cos(rad) * power;
    s.ball.vy = Math.sin(rad) * power;
    s.ball.inAir = true;
    s.ball.scored = false;
    s.ball.isFireball = s.streak >= 2;

    s.avatarAction = 'shoot';
    s.avatarActionTimer = 30;
    sound.playJump();
  }, []);

  const startGame = useCallback(() => {
    stateRef.current = {
      frame: 0,
      score: 0,
      streak: 0,
      timeLeft: 45,
      gameOver: false,
      hoopX: 510,
      hoopY: 130,
      hoopSpeed: 1.8,
      hoopDir: 1,
      ball: {
        x: 95,
        y: 235,
        vx: 0,
        vy: 0,
        radius: 12,
        inAir: false,
        isFireball: false,
        scored: false,
      },
      aimAngle: -54,
      aimPower: 16.5,
      avatarAction: 'idle',
      avatarActionTimer: 0,
      netSway: 0,
      flashText: '',
      flashTimer: 0,
    };

    setScore(0);
    setStreak(0);
    setTimeLeft(45);
    setIsGameOver(false);
    setIsPlaying(true);
  }, []);

  // Timer countdown
  useEffect(() => {
    if (!isPlaying || isGameOver) return;
    const interval = setInterval(() => {
      stateRef.current.timeLeft -= 1;
      setTimeLeft(stateRef.current.timeLeft);

      if (stateRef.current.timeLeft <= 0) {
        stateRef.current.gameOver = true;
        setIsGameOver(true);
        setIsPlaying(false);
        sound.playLose();
        onFinish(stateRef.current.score);
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, isGameOver, onFinish]);

  // Canvas Mouse / Touch Aiming
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPlaying || stateRef.current.ball.inAir) return;
    setIsAiming(true);
    updateAim(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isAiming || stateRef.current.ball.inAir) return;
    updateAim(e);
  };

  const handlePointerUp = () => {
    if (!isAiming) return;
    setIsAiming(false);
    shootBall(stateRef.current.aimPower, stateRef.current.aimAngle);
  };

  const updateAim = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    // Calculate angle from ball origin (95, 235)
    const dx = x - 95;
    const dy = y - 235;
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    // Clamp angle to reasonable forward-upward arc (-80 to -30 degrees)
    angleDeg = Math.min(-30, Math.max(-80, angleDeg));
    const dist = Math.hypot(dx, dy);
    const power = Math.min(22, Math.max(12, dist / 16));

    stateRef.current.aimAngle = angleDeg;
    stateRef.current.aimPower = power;
  };

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
      s.frame++;

      // Move Hoop
      s.hoopY += s.hoopSpeed * s.hoopDir;
      if (s.hoopY > 175) s.hoopDir = -1;
      if (s.hoopY < 95) s.hoopDir = 1;

      // Reset avatar action timer
      if (s.avatarActionTimer > 0) {
        s.avatarActionTimer--;
        if (s.avatarActionTimer === 0) {
          s.avatarAction = 'idle';
        }
      }

      // Ball Physics
      if (s.ball.inAir) {
        s.ball.vy += 0.52; // gravity
        s.ball.x += s.ball.vx;
        s.ball.y += s.ball.vy;

        // Hoop Target detection
        const hoopRimLeft = s.hoopX - 24;
        const hoopRimRight = s.hoopX + 24;
        const hoopRimY = s.hoopY;

        // Check if ball passes through rim
        if (
          !s.ball.scored &&
          s.ball.vy > 0 &&
          s.ball.x > hoopRimLeft &&
          s.ball.x < hoopRimRight &&
          Math.abs(s.ball.y - hoopRimY) < 14
        ) {
          s.ball.scored = true;
          const isCleanSwish = Math.abs(s.ball.x - s.hoopX) < 12;
          const points = isCleanSwish ? (s.ball.isFireball ? 6 : 3) : (s.ball.isFireball ? 4 : 2);

          s.score += points;
          s.streak += 1;
          s.netSway = 15;
          s.avatarAction = 'celebrate';
          s.avatarActionTimer = 45;
          s.flashText = isCleanSwish ? (s.streak >= 2 ? '🔥 ON FIRE! +6' : '⚡ SWISH! +3') : '+2 BUCKET!';
          s.flashTimer = 40;

          sound.playSwish();
          setScore(s.score);
          setStreak(s.streak);
        }

        // Check Backboard bounce
        const boardX = s.hoopX + 32;
        if (
          s.ball.x + s.ball.radius > boardX &&
          s.ball.x < boardX + 10 &&
          s.ball.y > s.hoopY - 50 &&
          s.ball.y < s.hoopY + 25
        ) {
          s.ball.vx = -s.ball.vx * 0.55;
          s.ball.x = boardX - s.ball.radius;
        }

        // Out of bounds / floor hit
        if (s.ball.y > height - 40 || s.ball.x > width + 20) {
          if (!s.ball.scored) {
            s.streak = 0;
            setStreak(0);
          }
          // Reset ball to player hands
          s.ball.inAir = false;
          s.ball.x = 95;
          s.ball.y = 235;
          s.ball.vx = 0;
          s.ball.vy = 0;
        }
      }

      // --- RENDERING ---
      ctx.clearRect(0, 0, width, height);

      // Court Background
      ctx.fillStyle = '#0f111a';
      ctx.fillRect(0, 0, width, height);

      // Floor Wood Lines
      const floorY = height - 55;
      ctx.fillStyle = '#161926';
      ctx.fillRect(0, floorY, width, height - floorY);
      ctx.strokeStyle = '#272b3f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, floorY);
      ctx.lineTo(width, floorY);
      ctx.stroke();

      // Free throw arc
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
      ctx.beginPath();
      ctx.arc(380, floorY, 140, Math.PI, Math.PI * 1.5);
      ctx.stroke();

      // Draw Basketball Hoop Post & Backboard
      const boardX = s.hoopX + 32;
      // Post
      ctx.fillStyle = '#334155';
      ctx.fillRect(boardX + 6, s.hoopY - 10, 10, height - s.hoopY);
      // Backboard
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.strokeStyle = '#ff0055';
      ctx.lineWidth = 3;
      ctx.fillRect(boardX, s.hoopY - 60, 6, 75);
      ctx.strokeRect(boardX, s.hoopY - 60, 6, 75);

      // Rim
      ctx.fillStyle = '#f97316';
      ctx.fillRect(s.hoopX - 24, s.hoopY, 52, 6);

      // Net
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      const netOffset = Math.sin(s.frame * 0.2) * (s.netSway * 0.2);
      ctx.beginPath();
      ctx.moveTo(s.hoopX - 22, s.hoopY + 6);
      ctx.lineTo(s.hoopX - 12 + netOffset, s.hoopY + 34);
      ctx.lineTo(s.hoopX + 12 + netOffset, s.hoopY + 34);
      ctx.lineTo(s.hoopX + 22, s.hoopY + 6);
      ctx.stroke();
      if (s.netSway > 0) s.netSway -= 0.5;

      // Trajectory Guide when aiming
      if (isAiming && !s.ball.inAir) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        let simX = 100;
        let simY = 220;
        const rad = (s.aimAngle * Math.PI) / 180;
        let simVx = Math.cos(rad) * s.aimPower;
        let simVy = Math.sin(rad) * s.aimPower;

        ctx.moveTo(simX, simY);
        for (let i = 0; i < 18; i++) {
          simVy += 0.52;
          simX += simVx;
          simY += simVy;
          ctx.lineTo(simX, simY);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Draw Basketball
      ctx.save();
      ctx.translate(s.ball.x, s.ball.y);
      if (s.ball.isFireball) {
        // Flaming Ball Glow
        ctx.shadowColor = '#ff0055';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#ff0055';
        ctx.beginPath();
        ctx.arc(0, 0, s.ball.radius + 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.arc(0, 0, s.ball.radius, 0, Math.PI * 2);
      ctx.fill();
      // Seams
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, s.ball.radius, -0.4, 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s.ball.radius, 0);
      ctx.lineTo(s.ball.radius, 0);
      ctx.stroke();
      ctx.restore();

      // DRAW PLAYABLE CUSTOM AVATAR!
      // Avatar stands at (95, floorY)
      drawAvatar(ctx, avatar, 95, floorY, 82, {
        frame: s.frame,
        action: s.avatarAction,
        facingRight: true,
        showTrail: true,
      });

      // Score Combo Flash Text
      if (s.flashTimer > 0) {
        s.flashTimer--;
        ctx.save();
        ctx.fillStyle = s.streak >= 2 ? '#ff0055' : '#00f0ff';
        ctx.font = 'bold 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.fillText(s.flashText, s.hoopX, s.hoopY - 45);
        ctx.restore();
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, isAiming, avatar, onFinish]);

  return (
    <div className="relative flex flex-col items-center w-full max-w-2xl mx-auto select-none">
      {/* Top HUD */}
      <div className="w-full flex items-center justify-between px-4 py-2 bg-[#12131d] border-b border-[#242738] rounded-t-xl text-sm">
        <div className="flex items-center gap-4">
          <span className="font-bold tracking-wider text-orange-400">DUNK RUSH</span>
          <span className="text-xs text-slate-400">· {modeName}</span>
        </div>
        <div className="flex items-center gap-5 font-mono">
          <div className="text-slate-300">
            SCORE: <span className="text-white font-bold text-base">{score}</span>
          </div>
          <div className="text-orange-400 font-bold">
            {streak > 1 ? `🔥 ${streak}x STREAK` : `${streak} STREAK`}
          </div>
          <div className="text-cyan-400 font-bold">
            {timeLeft}s
          </div>
          <button
            onClick={() => sound.toggleMute()}
            className="p-1 hover:text-cyan-400 text-slate-400 transition-colors"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Game Canvas */}
      <div className="relative w-full aspect-[16/9] bg-[#0a0b12] overflow-hidden border-x border-[#242738]">
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="w-full h-full block cursor-crosshair touch-none"
        />

        {/* Start Overlay */}
        {!isPlaying && !isGameOver && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <h2 className="text-2xl font-black italic tracking-wide text-orange-400 mb-2">DUNK RUSH</h2>
            <p className="text-sm text-slate-300 max-w-md mb-6">
              Timed basketball shootout! Drag and release to arc your shot into the moving hoop. Sink clean swishes for ON FIRE bonus points!
            </p>
            <div className="text-xs text-slate-400 mb-6">
              Drag on screen / court to aim trajectory · Release to shoot
            </div>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-extrabold text-sm rounded-lg shadow-lg shadow-orange-500/30 transition-transform active:scale-95"
            >
              <Play className="w-4 h-4 fill-black" /> START SHOOTOUT
            </button>
          </div>
        )}

        {/* Game Over Overlay */}
        {isGameOver && (
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-orange-500 mb-1">BUZZER BEATER</span>
            <div className="text-4xl font-black text-white mb-2">{score} PTS</div>
            <div className="text-xs text-slate-400 mb-6">
              Best Swish Streak: {streak} in a row
            </div>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-6 py-2.5 bg-orange-500 hover:bg-orange-400 text-black font-bold text-sm rounded-lg shadow-md transition-transform active:scale-95"
            >
              <RotateCcw className="w-4 h-4" /> PLAY AGAIN
            </button>
          </div>
        )}
      </div>

      {/* Control Help Tip */}
      <div className="w-full p-2.5 bg-[#12131d] border-t border-[#242738] rounded-b-xl text-center text-xs text-slate-400">
        Aim by dragging anywhere on the court. Release when power arc lines up with the moving basket!
      </div>
    </div>
  );
}
