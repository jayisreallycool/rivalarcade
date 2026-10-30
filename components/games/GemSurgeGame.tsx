'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AvatarConfig } from '@/lib/avatar-types';
import { drawAvatar } from '@/lib/avatar-canvas-draw';
import { sound, useMuted } from '@/lib/sound';
import { Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

interface GemSurgeProps {
  avatar: AvatarConfig;
  onFinish: (score: number) => void;
  modeName?: string;
}

const ROWS = 7;
const COLS = 7;
const GEM_COLORS = ['#00f0ff', '#ff0055', '#ffb800', '#10b981', '#a855f7'];

interface Gem {
  colorIndex: number;
  special?: 'laser' | 'nova';
  yOffset: number; // for smooth fall animation
}

export default function GemSurgeGame({ avatar, onFinish, modeName = 'Match' }: GemSurgeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [timeLeft, setTimeLeft] = useState(60);
  const isMuted = useMuted();

  const stateRef = useRef({
    board: [] as (Gem | null)[][],
    selectedCell: null as { r: number; c: number } | null,
    score: 0,
    combo: 1,
    timeLeft: 60,
    gameOver: false,
    frame: 0,
    particles: [] as { x: number; y: number; vx: number; vy: number; color: string; life: number }[],
    avatarAction: 'idle' as 'idle' | 'shoot' | 'celebrate',
    actionTimer: 0,
  });

  const createInitialBoard = (): (Gem | null)[][] => {
    const board: (Gem | null)[][] = [];
    for (let r = 0; r < ROWS; r++) {
      board[r] = [];
      for (let c = 0; c < COLS; c++) {
        let colorIdx = Math.floor(Math.random() * GEM_COLORS.length);
        // Avoid initial 3 in a row
        while (
          (r >= 2 && board[r - 1][c]?.colorIndex === colorIdx && board[r - 2][c]?.colorIndex === colorIdx) ||
          (c >= 2 && board[r][c - 1]?.colorIndex === colorIdx && board[r][c - 2]?.colorIndex === colorIdx)
        ) {
          colorIdx = (colorIdx + 1) % GEM_COLORS.length;
        }
        board[r][c] = { colorIndex: colorIdx, yOffset: 0 };
      }
    }
    return board;
  };

  const checkAndClearMatches = useCallback((): boolean => {
    const s = stateRef.current;
    const b = s.board;
    const matches: { r: number; c: number }[] = [];

    // Horizontal matches
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS - 2; c++) {
        const gem = b[r][c];
        if (!gem) continue;
        if (b[r][c + 1]?.colorIndex === gem.colorIndex && b[r][c + 2]?.colorIndex === gem.colorIndex) {
          matches.push({ r, c }, { r, c: c + 1 }, { r, c: c + 2 });
        }
      }
    }

    // Vertical matches
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS - 2; r++) {
        const gem = b[r][c];
        if (!gem) continue;
        if (b[r + 1][c]?.colorIndex === gem.colorIndex && b[r + 2][c]?.colorIndex === gem.colorIndex) {
          matches.push({ r, c }, { r: r + 1, c }, { r: r + 2, c });
        }
      }
    }

    if (matches.length === 0) return false;

    // Deduplicate matches
    const uniqueMatches = new Map<string, { r: number; c: number }>();
    matches.forEach((m) => uniqueMatches.set(`${m.r}-${m.c}`, m));

    // Clear matched cells & spawn particles
    uniqueMatches.forEach(({ r, c }) => {
      const g = b[r][c];
      if (g) {
        const gemX = 250 + c * 48 + 24;
        const gemY = 16 + r * 48 + 24;
        const color = GEM_COLORS[g.colorIndex];

        for (let p = 0; p < 6; p++) {
          s.particles.push({
            x: gemX,
            y: gemY,
            vx: (Math.random() - 0.5) * 5,
            vy: (Math.random() - 0.5) * 5,
            color,
            life: 1,
          });
        }
      }
      b[r][c] = null;
    });

    // Score based on count & cascade combo
    const points = uniqueMatches.size * 60 * s.combo;
    s.score += points;
    s.combo += 1;
    s.avatarAction = 'celebrate';
    s.actionTimer = 35;
    sound.playScore(1 + Math.min(s.combo * 0.12, 1.5));

    setScore(s.score);
    setCombo(s.combo);

    // Gravity: drop gems down
    for (let c = 0; c < COLS; c++) {
      let emptyRow = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (b[r][c] !== null) {
          if (emptyRow !== r) {
            b[emptyRow][c] = b[r][c];
            b[r][c] = null;
          }
          emptyRow--;
        }
      }
      // Fill empty top cells with new gems
      while (emptyRow >= 0) {
        b[emptyRow][c] = {
          colorIndex: Math.floor(Math.random() * GEM_COLORS.length),
          yOffset: -20,
        };
        emptyRow--;
      }
    }

    return true;
  }, []);

  const handleCellClick = (r: number, c: number) => {
    const s = stateRef.current;
    if (!isPlaying || s.gameOver) return;

    if (!s.selectedCell) {
      s.selectedCell = { r, c };
      sound.playTap();
      return;
    }

    const { r: r1, c: c1 } = s.selectedCell;
    const isAdjacent = Math.abs(r - r1) + Math.abs(c - c1) === 1;

    if (!isAdjacent) {
      // Select new cell
      s.selectedCell = { r, c };
      sound.playTap();
      return;
    }

    // Swap gems
    const temp = s.board[r][c];
    s.board[r][c] = s.board[r1][c1];
    s.board[r1][c1] = temp;
    s.selectedCell = null;

    // Check if swap made a match
    const hadMatch = checkAndClearMatches();
    if (!hadMatch) {
      // Revert swap
      const revert = s.board[r][c];
      s.board[r][c] = s.board[r1][c1];
      s.board[r1][c1] = revert;
      s.combo = 1;
      setCombo(1);
    } else {
      // Check cascading matches up to 4 times
      setTimeout(() => checkAndClearMatches(), 200);
      setTimeout(() => checkAndClearMatches(), 400);
    }
  };

  const startGame = useCallback(() => {
    stateRef.current = {
      board: createInitialBoard(),
      selectedCell: null,
      score: 0,
      combo: 1,
      timeLeft: 60,
      gameOver: false,
      frame: 0,
      particles: [],
      avatarAction: 'idle',
      actionTimer: 0,
    };

    setScore(0);
    setCombo(1);
    setTimeLeft(60);
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

      if (s.actionTimer > 0) {
        s.actionTimer--;
        if (s.actionTimer === 0) s.avatarAction = 'idle';
      }

      // Update particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.04;
        if (p.life <= 0) s.particles.splice(i, 1);
      }

      // --- RENDERING ---
      ctx.clearRect(0, 0, width, height);

      // Cyber Arcade Background
      ctx.fillStyle = '#0a0b12';
      ctx.fillRect(0, 0, width, height);

      // Left Arena - Player Avatar Stage
      ctx.fillStyle = '#12131d';
      ctx.fillRect(10, 10, 210, height - 20);
      ctx.strokeStyle = '#242738';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, 10, 210, height - 20);

      // Avatar Stage Pedestal
      ctx.fillStyle = '#1e2133';
      ctx.beginPath();
      ctx.ellipse(115, height - 55, 60, 14, 0, 0, Math.PI * 2);
      ctx.fill();

      // DRAW PLAYABLE CUSTOM AVATAR on Left Stage!
      drawAvatar(ctx, avatar, 115, height - 70, 95, {
        frame: s.frame,
        action: s.avatarAction,
        facingRight: true,
        showTrail: true,
      });

      // Player Nameplate on Stage
      ctx.fillStyle = '#00f0ff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('COMBO CHEER', 115, 45);

      // Board Background on Right
      const boardX = 245;
      const boardY = 12;
      const cellSize = 48;

      ctx.fillStyle = '#121422';
      ctx.fillRect(boardX - 4, boardY - 4, COLS * cellSize + 8, ROWS * cellSize + 8);
      ctx.strokeStyle = '#272b3f';
      ctx.strokeRect(boardX - 4, boardY - 4, COLS * cellSize + 8, ROWS * cellSize + 8);

      // Draw Grid Cells & Gems
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const gem = s.board[r]?.[c];
          const cellX = boardX + c * cellSize;
          const cellY = boardY + r * cellSize;

          // Cell slot
          ctx.fillStyle = '#0b0c16';
          ctx.fillRect(cellX + 2, cellY + 2, cellSize - 4, cellSize - 4);

          // Selected cell highlight
          if (s.selectedCell && s.selectedCell.r === r && s.selectedCell.c === c) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.strokeRect(cellX + 1, cellY + 1, cellSize - 2, cellSize - 2);
          }

          // Draw Gem
          if (gem) {
            const color = GEM_COLORS[gem.colorIndex];
            const centerX = cellX + cellSize / 2;
            const centerY = cellY + cellSize / 2;

            ctx.save();
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 8;

            // Gem Diamond / Hex Shape
            ctx.beginPath();
            ctx.moveTo(centerX, centerY - 14);
            ctx.lineTo(centerX + 14, centerY);
            ctx.lineTo(centerX, centerY + 14);
            ctx.lineTo(centerX - 14, centerY);
            ctx.closePath();
            ctx.fill();

            // Gem Facet Shine
            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.beginPath();
            ctx.moveTo(centerX, centerY - 14);
            ctx.lineTo(centerX + 6, centerY - 6);
            ctx.lineTo(centerX, centerY);
            ctx.lineTo(centerX - 6, centerY - 6);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
          }
        }
      }

      // Render Particles
      for (const p of s.particles) {
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, avatar]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const boardX = 245;
    const boardY = 12;
    const cellSize = 48;

    if (x >= boardX && x < boardX + COLS * cellSize && y >= boardY && y < boardY + ROWS * cellSize) {
      const c = Math.floor((x - boardX) / cellSize);
      const r = Math.floor((y - boardY) / cellSize);
      handleCellClick(r, c);
    }
  };

  return (
    <div className="relative flex flex-col items-center w-full max-w-2xl mx-auto select-none">
      {/* Top HUD */}
      <div className="w-full flex items-center justify-between px-4 py-2 bg-[#12131d] border-b border-[#242738] rounded-t-xl text-sm">
        <div className="flex items-center gap-4">
          <span className="font-bold tracking-wider text-purple-400">GEM SURGE</span>
          <span className="text-xs text-slate-400">· {modeName}</span>
        </div>
        <div className="flex items-center gap-5 font-mono">
          <div className="text-slate-300">
            SCORE: <span className="text-white font-bold text-base">{score}</span>
          </div>
          <div className="text-purple-400 font-bold">
            {combo > 1 ? `${combo}x CASCADE` : ''}
          </div>
          <div className="text-cyan-400 font-bold">{timeLeft}s</div>
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
          onClick={handleCanvasClick}
          className="w-full h-full block cursor-pointer"
        />

        {/* Start Overlay */}
        {!isPlaying && !isGameOver && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <h2 className="text-2xl font-black italic tracking-wide text-purple-400 mb-2">GEM SURGE</h2>
            <p className="text-sm text-slate-300 max-w-md mb-6">
              Cascading puzzle score-attack! Click any gem then an adjacent gem to swap and create 3-in-a-row matches. Trigger cascade chains for huge multipliers!
            </p>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-extrabold text-sm rounded-lg shadow-lg shadow-purple-500/30 transition-transform active:scale-95"
            >
              <Play className="w-4 h-4 fill-white" /> START PUZZLE
            </button>
          </div>
        )}

        {/* Game Over Overlay */}
        {isGameOver && (
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-purple-400 mb-1">TIME EXPIRED</span>
            <div className="text-4xl font-black text-white mb-2">{score}</div>
            <div className="text-xs text-slate-400 mb-6">
              Cascade Multipliers Earned: {combo}x
            </div>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-6 py-2.5 bg-purple-500 hover:bg-purple-400 text-white font-bold text-sm rounded-lg shadow-md transition-transform active:scale-95"
            >
              <RotateCcw className="w-4 h-4" /> PLAY AGAIN
            </button>
          </div>
        )}
      </div>

      {/* Control Help Tip */}
      <div className="w-full p-2.5 bg-[#12131d] border-t border-[#242738] rounded-b-xl text-center text-xs text-slate-400">
        Swap adjacent gems to match 3 or more. Your customized avatar cheers combo streaks!
      </div>
    </div>
  );
}
