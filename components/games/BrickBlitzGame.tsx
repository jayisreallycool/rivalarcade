'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import { useLatest, useThrottledHud } from '@/lib/engine/react';
import { GameProps } from '@/lib/game-types';
import { mulberry32, randomSeed } from '@/lib/rng';
import GameShell, { PopupApi, useSwipe, Swipe } from './GameShell';
import { Crosshair, Hand, CirclePlus } from 'lucide-react';

/**
 * Brick Blitz — aim-and-launch brick breaker (the classic skill-game format).
 * Drag to aim, release to fire a volley. Every brick shows the hits it needs; each turn the
 * wall drops one row. Grab "+1" rings for more balls. Seeded rows: same wall for every player.
 * Pure Canvas 2D, so it runs on every phone, with or without WebGL.
 */

const COLS = 7;
const ROWS = 10; // row ROWS-1 is the danger line
const ROUND_SECONDS = 90;
const CLUTCH_SECONDS = 10;
const START_BALLS = 3;
const FIRE_GAP = 0.065; // s between balls in a volley
const MIN_ANGLE = (10 * Math.PI) / 180;
const HIT_POINTS = 10;
const BREAK_POINTS = 40;
const CLEAR_BONUS = 1000;
const STAR_POINTS = 250;

type Cell = { kind: 'brick'; hp: number; max: number; flash: number } | { kind: 'ball' } | { kind: 'star' };

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  live: boolean;
  trail: { x: number; y: number }[];
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const hueFor = (hp: number, turn: number) => {
  const k = Math.min(1, hp / Math.max(4, turn * 1.3));
  // cyan → violet → hot pink as bricks get tougher
  return 190 + k * 150;
};

export default function BrickBlitzGame({ onFinish, seed, rival, match, onExit }: GameProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const popups = useRef<PopupApi | null>(null);
  const onFinishRef = useLatest(onFinish);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'over'>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, balls: START_BALLS, turn: 1, timeLeft: ROUND_SECONDS, clutch: false, combo: 0 });
  const api = useRef<{ start: () => void; drag: (s: Swipe, p: 'start' | 'move' | 'end') => void; tap: () => void }>({ start: () => {}, drag: () => {}, tap: () => {} });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    let dpr = 1;
    let W = 0;
    let H = 0;
    // board geometry (CSS px)
    let cell = 40;
    let bx = 0;
    let by = 0;
    let bw = 0;
    let bh = 0;
    let r = 5;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const top = Math.min(150, H * 0.2); // room for HUD + rival bar
      const bottom = Math.min(110, H * 0.14); // launcher zone
      cell = Math.floor(Math.min((W - 16) / COLS, (H - top - bottom) / ROWS));
      bw = cell * COLS;
      bh = cell * ROWS;
      bx = (W - bw) / 2;
      by = top + Math.max(0, (H - top - bottom - bh) / 2);
      r = Math.max(4, cell * 0.13);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // ---------------------------------------------------------- game state (board units: 1 = one cell)
    let rng = mulberry32(seed ?? randomSeed());
    let grid: (Cell | null)[][] = [];
    let balls: Ball[] = [];
    let sparks: Spark[] = [];
    let ballCount = START_BALLS;
    let launchX = COLS / 2; // in cells
    let nextLaunchX: number | null = null;
    let turn = 1;
    let state: 'idle' | 'aim' | 'volley' | 'drop' | 'over' = 'idle';
    let aim: { ang: number } | null = null;
    let toFire = 0;
    let fireTimer = 0;
    let fireAngle = 0;
    let volleyTime = 0;
    let volleyHits = 0;
    let dropAnim = 0;
    let pendingBalls = 0;
    let shake = 0;
    const s = { score: 0, timeLeft: ROUND_SECONDS, clutchAnnounced: false, playing: false, pHits: 0, pBreaks: 0, pClears: 0, pStars: 0, pClutch: 0, pCombo: 0, broken: 0, bestVolley: 0 };

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
      const tough = turn >= 6 && rng() < 0.3;
      let count = 2 + Math.floor(rng() * (turn < 8 ? 3 : 4)); // 2..4 early, 2..5 later
      if (turn > 12) count = Math.min(6, count + 1);
      const cols = [...Array(COLS).keys()].sort(() => rng() - 0.5);
      for (let i = 0; i < count; i++) {
        const hp = tough && rng() < 0.4 ? turn * 2 : turn;
        row[cols[i]] = { kind: 'brick', hp, max: hp, flash: 0 };
      }
      row[cols[count]] = { kind: 'ball' };
      if (turn % 4 === 0 && count + 1 < COLS) row[cols[count + 1]] = { kind: 'star' };
      return row;
    };

    const reset = () => {
      rng = mulberry32(seed ?? randomSeed());
      grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
      turn = 1;
      grid[1] = spawnRow();
      turn = 2;
      grid[0] = spawnRow();
      ballCount = START_BALLS;
      launchX = COLS / 2;
      balls = [];
      sparks = [];
      state = 'idle';
      Object.assign(s, { score: 0, timeLeft: ROUND_SECONDS, clutchAnnounced: false, playing: false, pHits: 0, pBreaks: 0, pClears: 0, pStars: 0, pClutch: 0, pCombo: 0, broken: 0, bestVolley: 0 });
    };
    reset();

    const finish = (reason: 'time' | 'wall') => {
      if (!s.playing) return;
      s.playing = false;
      state = 'over';
      if (reason === 'wall') {
        popups.current?.banner('WALL DOWN!', '#fb7185');
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

    // board helpers ------------------------------------------------
    const toPx = (cx: number, cy: number) => [bx + cx * cell, by + cy * cell] as const;
    const launchY = ROWS - 0.02; // just above the bottom edge of the board, in cells
    const ballR = () => r / cell;

    const aimFromPointer = (px: number, py: number) => {
      const [lx, ly] = toPx(launchX, launchY);
      let ang = Math.atan2(ly - py, px - lx); // 0 = right, PI/2 = straight up
      if (py > ly - 4) ang = px < lx ? Math.PI - MIN_ANGLE : MIN_ANGLE; // finger below the launcher: clamp flat
      return Math.min(Math.PI - MIN_ANGLE, Math.max(MIN_ANGLE, ang));
    };

    api.current.start = () => {
      reset();
      s.playing = true;
      state = 'idle';
      pushHud({ score: 0, balls: ballCount, turn: 1, timeLeft: ROUND_SECONDS, clutch: false, combo: 0 }, true);
      setPhase('playing');
    };

    api.current.drag = (sw, p) => {
      if (!s.playing) return;
      if (state !== 'idle' && state !== 'aim') return;
      if (p === 'start') {
        state = 'aim';
        aim = { ang: aimFromPointer(sw.endX, sw.endY) };
      } else if (p === 'move' && state === 'aim') {
        aim = { ang: aimFromPointer(sw.endX, sw.endY) };
      } else if (p === 'end' && state === 'aim') {
        const ang = aimFromPointer(sw.endX, sw.endY);
        aim = null;
        // A tiny tap-release right on the launcher is a cancel, not a shot.
        if (Math.hypot(sw.dx, sw.dy) < 6 && sw.durationMs < 200 && Math.abs(sw.endY - toPx(launchX, launchY)[1]) < 30) {
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
        sound.playLaser();
        haptic('tap');
      }
    };
    // Tap during a volley = fast-forward.
    api.current.tap = () => {
      if (state === 'volley') volleyTime = Math.max(volleyTime, 2.6);
    };

    // physics ------------------------------------------------------
    const hitBrick = (row: number, col: number, c: Extract<Cell, { kind: 'brick' }>, bxp: number, byp: number) => {
      c.hp -= 1;
      c.flash = 1;
      volleyHits += 1;
      const mult = 1 + Math.min(2, Math.floor(volleyHits / 12) * 0.25);
      award(HIT_POINTS, 'pHits', mult);
      if (volleyHits % 3 === 0) sound.playScore(1 + Math.min(1.2, volleyHits / 60));
      if (c.hp <= 0) {
        grid[row][col] = null;
        s.broken += 1;
        const pts = award(BREAK_POINTS + Math.min(160, c.max * 4), 'pBreaks', mult);
        const [px, py] = toPx(col + 0.5, row + 0.5);
        popups.current?.pop(`+${pts}`, px, py, { color: `hsl(${hueFor(c.max, turn)} 95% 70%)`, size: c.max >= turn * 2 ? 'md' : 'sm' });
        for (let i = 0; i < 12; i++) {
          const a = rng() * Math.PI * 2;
          const sp = 2 + rng() * 5;
          sparks.push({ x: col + 0.5, y: row + 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + rng() * 0.4, color: `hsl(${hueFor(c.max, turn)} 95% 65%)` });
        }
        haptic('light');
        shake = Math.min(1, shake + 0.25);
        // board clear
        if (!grid.some((rw) => rw.some((x) => x?.kind === 'brick'))) {
          const pts2 = award(CLEAR_BONUS, 'pClears');
          popups.current?.banner(`BOARD CLEAR +${pts2}`, '#34d399');
          sound.playPowerup();
          haptic('big');
        }
      }
      void bxp;
      void byp;
    };

    const stepBall = (b: Ball, dt: number) => {
      const R = ballR();
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
      // bricks / pickups in the 3×3 neighbourhood
      const cr = Math.floor(b.y);
      const cc = Math.floor(b.x);
      for (let row = cr - 1; row <= cr + 1; row++) {
        if (row < 0 || row >= ROWS) continue;
        for (let col = cc - 1; col <= cc + 1; col++) {
          if (col < 0 || col >= COLS) continue;
          const c = grid[row][col];
          if (!c) continue;
          if (c.kind !== 'brick') {
            if (Math.hypot(b.x - (col + 0.5), b.y - (row + 0.5)) < R + 0.22) {
              grid[row][col] = null;
              const [px, py] = toPx(col + 0.5, row + 0.5);
              if (c.kind === 'ball') {
                pendingBalls += 1;
                popups.current?.pop('+1 BALL', px, py, { color: '#ffffff', size: 'sm' });
                sound.playJump();
              } else {
                const pts = award(STAR_POINTS, 'pStars');
                popups.current?.pop(`★ +${pts}`, px, py, { color: '#facc15', size: 'md' });
                sound.playPowerup();
              }
              haptic('light');
            }
            continue;
          }
          const pad = 0.04; // visual gap between bricks
          const x0 = col + pad;
          const x1 = col + 1 - pad;
          const y0 = row + pad;
          const y1 = row + 1 - pad;
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
            // centre inside the brick: push out along the shallowest axis
            const pen = [b.x - x0, x1 - b.x, b.y - y0, y1 - b.y];
            const m = pen.indexOf(Math.min(...pen));
            if (m === 0) (b.x = x0 - R), (b.vx = -Math.abs(b.vx));
            else if (m === 1) (b.x = x1 + R), (b.vx = Math.abs(b.vx));
            else if (m === 2) (b.y = y0 - R), (b.vy = -Math.abs(b.vy));
            else (b.y = y1 + R), (b.vy = Math.abs(b.vy));
          }
          hitBrick(row, col, c, b.x, b.y);
          return; // one hit per substep
        }
      }
      // Avoid endless horizontal loops.
      if (Math.abs(b.vy) < 0.6) b.vy = b.vy < 0 ? -0.6 : 0.6;
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
      // drop the wall
      grid.pop();
      turn += 1;
      grid.unshift(spawnRow());
      dropAnim = 1;
      state = 'drop';
      pushHud({ balls: ballCount, turn: turn - 1, combo: 0 });
      // anything on the danger row → game over
      const last = grid[ROWS - 1];
      if (last.some((c) => c?.kind === 'brick')) {
        finish('wall');
        return;
      }
      // pickups that reach the floor are collected automatically
      last.forEach((c, i) => {
        if (c && c.kind === 'ball') {
          ballCount += 1;
          last[i] = null;
        } else if (c && c.kind === 'star') last[i] = null;
      });
    };

    // aim preview: march a virtual ball to its first contact, then show the reflected ray
    const previewPath = (ang: number) => {
      const R = ballR();
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
        const col = Math.floor(x);
        const c = row >= 0 && row < ROWS && col >= 0 && col < COLS ? grid[row][col] : null;
        if (!hit && c?.kind === 'brick') {
          // reflect off whichever face we entered through
          const px = x - vx * stepLen;
          const py = y - vy * stepLen;
          if (Math.floor(px) !== col) vx = -vx;
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

    // render -------------------------------------------------------
    const roundRect = (x: number, y: number, w: number, h: number, rad: number) => {
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + w, y, x + w, y + h, rad);
      ctx.arcTo(x + w, y + h, x, y + h, rad);
      ctx.arcTo(x, y + h, x, y, rad);
      ctx.arcTo(x, y, x + w, y, rad);
      ctx.closePath();
    };

    let last = performance.now();
    let raf = 0;
    let hudAcc = 0;
    let t = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;

      // ---- update
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
        const speed = 15 * speedMul; // cells / s
        fireTimer -= dt;
        while (toFire > 0 && fireTimer <= 0) {
          balls.push({ x: launchX, y: launchY - 0.01, vx: Math.cos(fireAngle) * 15, vy: -Math.sin(fireAngle) * 15, live: true, trail: [] });
          toFire -= 1;
          fireTimer += FIRE_GAP / speedMul;
        }
        const sub = Math.ceil((speed * dt) / (ballR() * 0.8));
        const h = (dt * speedMul) / sub;
        for (const b of balls) {
          if (!b.live) continue;
          for (let i = 0; i < sub && b.live; i++) stepBall(b, h);
          b.trail.push({ x: b.x, y: b.y });
          if (b.trail.length > 5) b.trail.shift();
        }
        if (toFire === 0 && balls.every((b) => !b.live)) endVolley();
      } else if (state === 'drop') {
        dropAnim -= dt * 5;
        if (dropAnim <= 0) {
          dropAnim = 0;
          if (s.playing) state = 'idle';
        }
      }

      for (const sp of sparks) {
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.vy += 9 * dt;
        sp.life -= dt;
      }
      sparks = sparks.filter((sp) => sp.life > 0);
      shake = Math.max(0, shake - dt * 3);
      for (const rw of grid) for (const c of rw) if (c?.kind === 'brick' && c.flash > 0) c.flash = Math.max(0, c.flash - dt * 6);

      hudAcc += dt;
      if (hudAcc > 0.1 && s.playing) {
        hudAcc = 0;
        pushHud({ score: s.score, timeLeft: s.timeLeft, clutch: s.timeLeft <= CLUTCH_SECONDS, combo: state === 'volley' ? volleyHits : 0, balls: ballCount + (state === 'volley' ? pendingBalls : 0) });
      }

      // ---- draw
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a0620');
      bg.addColorStop(1, '#03040a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const sx = shake > 0 ? (Math.random() - 0.5) * shake * 6 : 0;
      const sy = shake > 0 ? (Math.random() - 0.5) * shake * 6 : 0;
      ctx.translate(sx, sy);

      // board well
      roundRect(bx - 4, by - 4, bw + 8, bh + 8, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,140,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,140,255,0.06)';
      ctx.lineWidth = 1;
      for (let c = 1; c < COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(bx + c * cell, by);
        ctx.lineTo(bx + c * cell, by + bh);
        ctx.stroke();
      }

      // danger line
      const danger = grid[ROWS - 2].some((c) => c?.kind === 'brick');
      ctx.fillStyle = danger ? `rgba(251,113,133,${0.18 + 0.12 * Math.sin(t * 8)})` : 'rgba(251,113,133,0.06)';
      ctx.fillRect(bx, by + (ROWS - 1) * cell, bw, cell);
      ctx.strokeStyle = danger ? '#fb7185' : 'rgba(251,113,133,0.35)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(bx, by + (ROWS - 1) * cell);
      ctx.lineTo(bx + bw, by + (ROWS - 1) * cell);
      ctx.stroke();
      ctx.setLineDash([]);

      // cells
      const yOff = -dropAnim * cell;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const c = grid[row][col];
          if (!c) continue;
          const x = bx + col * cell;
          const y = by + row * cell + yOff;
          if (c.kind === 'brick') {
            const hue = hueFor(c.hp, turn);
            const g = 3;
            const grow = c.flash * 2;
            // glow
            roundRect(x + g - 3 - grow, y + g - 3 - grow, cell - g * 2 + 6 + grow * 2, cell - g * 2 + 6 + grow * 2, 10);
            ctx.fillStyle = `hsla(${hue} 95% 60% / ${0.16 + c.flash * 0.3})`;
            ctx.fill();
            roundRect(x + g - grow, y + g - grow, cell - g * 2 + grow * 2, cell - g * 2 + grow * 2, 8);
            const grad = ctx.createLinearGradient(x, y, x, y + cell);
            grad.addColorStop(0, `hsl(${hue} 90% ${62 + c.flash * 25}%)`);
            grad.addColorStop(1, `hsl(${hue} 85% ${42 + c.flash * 25}%)`);
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = `hsla(${hue} 100% 85% / 0.7)`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = '#0b0b18';
            ctx.font = `900 ${Math.round(cell * (c.hp >= 100 ? 0.34 : 0.42))}px ui-sans-serif, system-ui, sans-serif`;
            ctx.fillText(String(c.hp), x + cell / 2, y + cell / 2 + 1);
          } else if (c.kind === 'ball') {
            const pulse = 1 + Math.sin(t * 6 + col) * 0.08;
            ctx.beginPath();
            ctx.arc(x + cell / 2, y + cell / 2, cell * 0.24 * pulse, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x + cell / 2, y + cell / 2, r * 0.9, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
          } else {
            ctx.save();
            ctx.translate(x + cell / 2, y + cell / 2);
            ctx.rotate(t * 1.5);
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
              const rad = i % 2 ? cell * 0.12 : cell * 0.28;
              const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
              ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
            }
            ctx.closePath();
            ctx.fillStyle = '#facc15';
            ctx.shadowColor = '#facc15';
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();
          }
        }
      }

      // sparks
      for (const sp of sparks) {
        ctx.globalAlpha = Math.min(1, sp.life * 2);
        ctx.fillStyle = sp.color;
        const [px, py] = toPx(sp.x, sp.y);
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
      ctx.globalAlpha = 1;

      // aim guide
      if (aim && state === 'aim') {
        const pts = previewPath(aim.ang);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = toPx(pts[i][0], pts[i][1]);
          const [cx2, cy2] = toPx(pts[i + 1][0], pts[i + 1][1]);
          const len = Math.hypot(cx2 - ax, cy2 - ay);
          const n = Math.floor(len / 14);
          for (let k = 1; k <= n; k++) {
            const f = k / n;
            ctx.globalAlpha = i === 0 ? 0.9 : 0.45 * (1 - f);
            ctx.beginPath();
            ctx.arc(ax + (cx2 - ax) * f, ay + (cy2 - ay) * f, i === 0 ? 2.6 : 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }

      // balls
      for (const b of balls) {
        if (!b.live) continue;
        b.trail.forEach((p, i) => {
          const [px, py] = toPx(p.x, p.y);
          ctx.globalAlpha = (i + 1) / (b.trail.length + 2) * 0.5;
          ctx.beginPath();
          ctx.arc(px, py, r * 0.8, 0, Math.PI * 2);
          ctx.fillStyle = '#7dd3fc';
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        const [px, py] = toPx(b.x, b.y);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }

      // launcher
      const lx = state === 'volley' || state === 'drop' ? launchX : launchX;
      const [lpx, lpy] = toPx(lx, launchY);
      const waiting = state === 'volley' ? toFire : ballCount;
      if (state !== 'volley' || toFire > 0) {
        ctx.beginPath();
        ctx.arc(lpx, lpy - r, r * 1.25, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 14;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (nextLaunchX !== null && state === 'volley') {
        const [nx] = toPx(nextLaunchX, launchY);
        ctx.beginPath();
        ctx.arc(nx, lpy - r, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `800 ${Math.round(Math.max(12, cell * 0.3))}px ui-sans-serif, system-ui, sans-serif`;
      if (waiting > 0) ctx.fillText(`×${waiting}`, lpx, lpy + Math.max(16, cell * 0.42));

      // idle prompt
      if (s.playing && state === 'idle') {
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 4);
        ctx.fillStyle = '#a5f3fc';
        ctx.font = `700 13px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText('DRAG TO AIM · RELEASE TO FIRE', W / 2, Math.min(H - 14, lpy + Math.max(40, cell * 0.95)));
        ctx.globalAlpha = 1;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    raf = requestAnimationFrame(frame);

    const onVis = () => {
      last = performance.now();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.remove();
      api.current = { start: () => {}, drag: () => {}, tap: () => {} };
    };
    // Game world is built once per mount (rematches remount the component).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGame = useCallback(() => api.current.start(), []);
  const surface = useSwipe({
    onDrag: (sw, p) => api.current.drag(sw, p),
    onTap: () => api.current.tap(),
  });

  const chips = (
    <>
      <span className="px-2 py-0.5 rounded-full bg-white/90 text-black text-[11px] font-black">●×{hud.balls}</span>
      <span className="px-2 py-0.5 rounded-full bg-white/10 text-white/80 text-[11px] font-black">ROW {hud.turn}</span>
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
      tutorial={[
        { icon: <Crosshair className="w-6 h-6" />, label: 'Drag to aim' },
        { icon: <Hand className="w-6 h-6" />, label: 'Release to fire' },
        { icon: <CirclePlus className="w-6 h-6" />, label: 'Grab +1 balls' },
      ]}
      scoring="10 per hit · Break bonus grows with brick toughness · Long volleys multiply · Clear the board +1000 · Last 10s ×2. Tap during a volley to fast-forward. Don't let the wall reach the red line. Same wall for every player."
    />
  );
}
