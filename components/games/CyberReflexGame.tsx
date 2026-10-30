'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AvatarConfig } from '@/lib/avatar-types';
import { drawAvatar } from '@/lib/avatar-canvas-draw';
import { sound, useMuted } from '@/lib/sound';
import { Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

interface CyberReflexProps {
  avatar: AvatarConfig;
  onFinish: (score: number) => void;
  modeName?: string;
}

interface TargetNode {
  id: number;
  x: number;
  y: number;
  radius: number;
  ringRadius: number;
  maxRingRadius: number;
  type: 'target' | 'hazard' | 'bonus';
  active: boolean;
  spawnTime: number;
}

export default function CyberReflexGame({ avatar, onFinish, modeName = 'Match' }: CyberReflexProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [timeLeft, setTimeLeft] = useState(40);
  const isMuted = useMuted();

  const stateRef = useRef({
    frame: 0,
    score: 0,
    combo: 0,
    timeLeft: 40,
    gameOver: false,
    nodes: [] as TargetNode[],
    avatarReaction: 'idle' as 'idle' | 'shoot' | 'celebrate',
    reactionTimer: 0,
    pulseRings: [] as { x: number; y: number; r: number; alpha: number; color: string }[],
  });

  const triggerReaction = (type: 'perfect' | 'hazard') => {
    const s = stateRef.current;
    s.avatarReaction = type === 'perfect' ? 'shoot' : 'idle';
    s.reactionTimer = 20;

    // Pulse effect
    s.pulseRings.push({
      x: 320,
      y: 180,
      r: 10,
      alpha: 1,
      color: type === 'perfect' ? '#00f0ff' : '#ff0055',
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !isPlaying || stateRef.current.gameOver) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const clickY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const s = stateRef.current;
    let hitAny = false;

    for (let i = s.nodes.length - 1; i >= 0; i--) {
      const node = s.nodes[i];
      if (!node.active) continue;

      const dist = Math.hypot(clickX - node.x, clickY - node.y);
      if (dist <= node.radius + 15) {
        hitAny = true;
        node.active = false;

        if (node.type === 'hazard') {
          // Hit hazard!
          s.score = Math.max(0, s.score - 150);
          s.combo = 0;
          sound.playLose();
          triggerReaction('hazard');
        } else {
          // Timing accuracy check: ringRadius close to node.radius
          const accuracy = Math.abs(node.ringRadius - node.radius);
          let pts = 100;
          if (accuracy < 12) {
            pts = 250; // PERFECT
          } else if (accuracy < 25) {
            pts = 160; // GREAT
          }

          if (node.type === 'bonus') pts *= 2;

          s.combo += 1;
          s.score += pts * Math.min(5, 1 + Math.floor(s.combo / 5));
          sound.playScore(1 + (s.combo % 8) * 0.1);
          triggerReaction('perfect');
        }

        setScore(s.score);
        setCombo(s.combo);
        s.nodes.splice(i, 1);
        break;
      }
    }

    if (!hitAny) {
      // Missed tap
      s.combo = 0;
      setCombo(0);
    }
  };

  const startGame = useCallback(() => {
    stateRef.current = {
      frame: 0,
      score: 0,
      combo: 0,
      timeLeft: 40,
      gameOver: false,
      nodes: [],
      avatarReaction: 'idle',
      reactionTimer: 0,
      pulseRings: [],
    };

    setScore(0);
    setCombo(0);
    setTimeLeft(40);
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
        sound.playWin();
        onFinish(stateRef.current.score);
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, isGameOver, onFinish]);

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

      if (s.reactionTimer > 0) {
        s.reactionTimer--;
        if (s.reactionTimer === 0) s.avatarReaction = 'idle';
      }

      // Spawn target nodes around central avatar
      // 8 possible orbital angle slots around center (320, 180)
      if (s.frame % 32 === 0 && s.nodes.length < 5) {
        const angle = Math.random() * Math.PI * 2;
        const radiusDist = Math.random() * 85 + 130;
        const x = 320 + Math.cos(angle) * radiusDist;
        const y = 180 + Math.sin(angle) * radiusDist;

        const isHazard = Math.random() < 0.22;
        const isBonus = !isHazard && Math.random() < 0.25;

        s.nodes.push({
          id: Math.random(),
          x,
          y,
          radius: 22,
          ringRadius: 55,
          maxRingRadius: 55,
          type: isHazard ? 'hazard' : isBonus ? 'bonus' : 'target',
          active: true,
          spawnTime: s.frame,
        });
      }

      // Update nodes
      for (let i = s.nodes.length - 1; i >= 0; i--) {
        const node = s.nodes[i];
        node.ringRadius -= 0.65; // Ring shrinks

        // If ring shrank past node without tap
        if (node.ringRadius <= node.radius - 8) {
          if (node.type !== 'hazard') {
            s.combo = 0;
            setCombo(0);
          }
          s.nodes.splice(i, 1);
        }
      }

      // Update pulse rings
      for (let i = s.pulseRings.length - 1; i >= 0; i--) {
        const ring = s.pulseRings[i];
        ring.r += 4;
        ring.alpha -= 0.04;
        if (ring.alpha <= 0) s.pulseRings.splice(i, 1);
      }

      // --- RENDERING ---
      ctx.clearRect(0, 0, width, height);

      // Cyber Matrix Background
      ctx.fillStyle = '#080911';
      ctx.fillRect(0, 0, width, height);

      // Radar Concentric Circles
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
      ctx.lineWidth = 1;
      for (let r = 60; r <= 240; r += 60) {
        ctx.beginPath();
        ctx.arc(320, 180, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Rotating Radar Beam
      const radarAngle = s.frame * 0.03;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
      ctx.beginPath();
      ctx.moveTo(320, 180);
      ctx.lineTo(320 + Math.cos(radarAngle) * 260, 180 + Math.sin(radarAngle) * 260);
      ctx.stroke();

      // Central Command Platform
      ctx.fillStyle = '#121422';
      ctx.beginPath();
      ctx.arc(320, 180, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#272b3f';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Central Pulse Rings
      for (const ring of s.pulseRings) {
        ctx.save();
        ctx.globalAlpha = ring.alpha;
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = ring.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // DRAW PLAYABLE CUSTOM AVATAR in Center Control Station!
      drawAvatar(ctx, avatar, 320, 192, 80, {
        frame: s.frame,
        action: s.avatarReaction,
        facingRight: true,
        showTrail: true,
      });

      // Target Nodes
      for (const node of s.nodes) {
        ctx.save();
        const color =
          node.type === 'hazard'
            ? '#ff0055'
            : node.type === 'bonus'
            ? '#ffb800'
            : '#00f0ff';

        // Shrinking timing ring
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(node.radius, node.ringRadius), 0, Math.PI * 2);
        ctx.stroke();

        // Node Core Circle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();

        // Node Inner Icon / text
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = node.type === 'hazard' ? '✕' : node.type === 'bonus' ? '★' : '◉';
        ctx.fillText(label, node.x, node.y);

        ctx.restore();
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, avatar]);

  return (
    <div className="relative flex flex-col items-center w-full max-w-2xl mx-auto select-none">
      {/* Top HUD */}
      <div className="w-full flex items-center justify-between px-4 py-2 bg-[#12131d] border-b border-[#242738] rounded-t-xl text-sm">
        <div className="flex items-center gap-4">
          <span className="font-bold tracking-wider text-cyan-400">CYBER REFLEX</span>
          <span className="text-xs text-slate-400">· {modeName}</span>
        </div>
        <div className="flex items-center gap-5 font-mono">
          <div className="text-slate-300">
            SCORE: <span className="text-white font-bold text-base">{score}</span>
          </div>
          <div className="text-cyan-400 font-bold">
            {combo}x <span className="text-xs font-normal">STREAK</span>
          </div>
          <div className="text-amber-400 font-bold">{timeLeft}s</div>
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
          className="w-full h-full block cursor-pointer touch-none"
        />

        {/* Start Overlay */}
        {!isPlaying && !isGameOver && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <h2 className="text-2xl font-black italic tracking-wide text-cyan-400 mb-2">CYBER REFLEX</h2>
            <p className="text-sm text-slate-300 max-w-md mb-6">
              Precision target deflection! Tap cyan nodes when the shrinking ring touches the core. Hit gold stars for double points, and avoid red hazard mines!
            </p>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-extrabold text-sm rounded-lg shadow-lg shadow-cyan-500/30 transition-transform active:scale-95"
            >
              <Play className="w-4 h-4 fill-black" /> START SEQUENCE
            </button>
          </div>
        )}

        {/* Game Over Overlay */}
        {isGameOver && (
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-cyan-500 mb-1">SEQUENCE COMPLETE</span>
            <div className="text-4xl font-black text-white mb-2">{score}</div>
            <div className="text-xs text-slate-400 mb-6">
              Max Reflex Streak: {combo}
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

      {/* Control Help Tip */}
      <div className="w-full p-2.5 bg-[#12131d] border-t border-[#242738] rounded-b-xl text-center text-xs text-slate-400">
        Tap or click targets with precision timing. Never tap red ✕ hazard nodes!
      </div>
    </div>
  );
}
