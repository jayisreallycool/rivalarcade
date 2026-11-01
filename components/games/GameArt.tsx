'use client';

import React, { useId } from 'react';
import type { GameId } from '@/lib/game-types';

/**
 * Illustrated cover art for each game, drawn as inline SVG: crisp at any size, no downloads,
 * and every character is an original RivalArcade mascot.
 * Canvas is 300×430 (the tall card ratio of the lobby grid).
 */

const FONT = "'Lilita One', 'Arial Black', system-ui, sans-serif";

/** Chunky cartoon title: dark outline, gradient fill, drop shadow, slight tilt. */
function Title({ lines, y, fill, size = 62, tilt = -5, stroke = '#1b1030' }: { lines: string[]; y: number; fill: [string, string]; size?: number; tilt?: number; stroke?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <g transform={`rotate(${tilt} 150 ${y})`}>
      <defs>
        <linearGradient id={`tf${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={fill[0]} />
          <stop offset="1" stopColor={fill[1]} />
        </linearGradient>
      </defs>
      {lines.map((l, i) => {
        const ly = y + i * size * 0.92;
        const common = { x: 150, y: ly, textAnchor: 'middle' as const, fontFamily: FONT, fontSize: size, letterSpacing: 0.5 };
        return (
          <g key={i}>
            <text {...common} fill={stroke} stroke={stroke} strokeWidth={14} strokeLinejoin="round" transform="translate(0 7)">
              {l}
            </text>
            <text {...common} fill={`url(#tf${id})`} stroke={stroke} strokeWidth={10} strokeLinejoin="round" paintOrder="stroke">
              {l}
            </text>
            <text {...common} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2} transform="translate(0 -2)" style={{ mixBlendMode: 'overlay' }}>
              {l}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Cartoon eyes used by all mascots. */
function Eyes({ x, y, r = 13, gap = 30, look = [3, 1], blink = false }: { x: number; y: number; r?: number; gap?: number; look?: [number, number]; blink?: boolean }) {
  return (
    <g>
      {[-1, 1].map((s) => (
        <g key={s}>
          <ellipse cx={x + (s * gap) / 2} cy={y} rx={r} ry={blink ? r * 0.25 : r * 1.15} fill="#fff" stroke="#1b1030" strokeWidth={3.5} />
          {!blink && (
            <>
              <circle cx={x + (s * gap) / 2 + look[0]} cy={y + look[1]} r={r * 0.55} fill="#1b1030" />
              <circle cx={x + (s * gap) / 2 + look[0] - r * 0.2} cy={y + look[1] - r * 0.25} r={r * 0.18} fill="#fff" />
            </>
          )}
        </g>
      ))}
    </g>
  );
}

const Sparkle = ({ x, y, s = 1, c = '#fff' }: { x: number; y: number; s?: number; c?: string }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 -12 C2 -3 3 -2 12 0 C3 2 2 3 0 12 C-2 3 -3 2 -12 0 C-3 -2 -2 -3 0 -12Z" fill={c} />
);

/* ---------------------------------------------------------------- Dunk Rush */
function DunkArt() {
  return (
    <svg viewBox="0 0 300 430" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="dk-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b1f6e" />
          <stop offset="0.55" stopColor="#c2410c" />
          <stop offset="1" stopColor="#fb923c" />
        </linearGradient>
        <linearGradient id="dk-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9a35c" />
          <stop offset="1" stopColor="#b45f24" />
        </linearGradient>
        <radialGradient id="dk-ball" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffb36b" />
          <stop offset="0.6" stopColor="#f26a1b" />
          <stop offset="1" stopColor="#b8410b" />
        </radialGradient>
        <radialGradient id="dk-spot" cx="0.5" cy="0" r="1">
          <stop offset="0" stopColor="#fff7d6" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff7d6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="300" height="430" fill="url(#dk-bg)" />
      {/* spotlights */}
      <path d="M40 0 L120 0 L190 300 L-30 300Z" fill="url(#dk-spot)" />
      <path d="M220 0 L290 0 L320 300 L130 300Z" fill="url(#dk-spot)" opacity="0.7" />
      {/* crowd dots */}
      {Array.from({ length: 60 }, (_, i) => (
        <circle key={i} cx={(i * 53) % 300} cy={210 + ((i * 29) % 50)} r={6 + (i % 3)} fill={['#4c1d95', '#7c2d12', '#581c87', '#9a3412'][i % 4]} opacity="0.75" />
      ))}
      {/* floor */}
      <path d="M0 268 L300 250 L300 430 L0 430Z" fill="url(#dk-floor)" />
      {Array.from({ length: 9 }, (_, i) => (
        <path key={i} d={`M${i * 40 - 20} 430 L${i * 34 + 10} 262`} stroke="#9a4a17" strokeWidth="2" opacity="0.35" />
      ))}
      <ellipse cx="150" cy="330" rx="150" ry="34" fill="none" stroke="#fff" strokeWidth="5" opacity="0.7" />
      {/* hoop */}
      <g transform="translate(196 52)">
        <rect x="0" y="0" width="92" height="64" rx="6" fill="#ffffff" stroke="#1b1030" strokeWidth="4" />
        <rect x="30" y="24" width="32" height="24" fill="none" stroke="#ef4444" strokeWidth="4" />
        <rect x="40" y="64" width="12" height="16" fill="#334155" stroke="#1b1030" strokeWidth="3" />
        <path d="M14 98 L26 132 L38 104 L46 134 L54 104 L66 132 L78 98" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
        <path d="M18 112 L74 112 M24 124 L68 124" stroke="#fff" strokeWidth="2.5" />
        <ellipse cx="46" cy="96" rx="36" ry="9" fill="none" stroke="#1b1030" strokeWidth="9" />
        <ellipse cx="46" cy="96" rx="36" ry="9" fill="none" stroke="#f97316" strokeWidth="5" />
      </g>
      {/* motion trail */}
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M${40 - i * 14} ${300 - i * 22} Q ${70 - i * 10} ${200 - i * 18} ${110} ${170 - i * 12}`} stroke="#fff" strokeOpacity={0.5 - i * 0.12} strokeWidth={10 - i * 2} fill="none" strokeLinecap="round" />
      ))}
      {/* mascot: Bounce the basketball */}
      <g transform="translate(150 168) rotate(-12)">
        {/* arms */}
        <path d="M-58 -10 Q-92 -42 -86 -78" stroke="#1b1030" strokeWidth="18" fill="none" strokeLinecap="round" />
        <path d="M-58 -10 Q-92 -42 -86 -78" stroke="#f26a1b" strokeWidth="11" fill="none" strokeLinecap="round" />
        <circle cx="-86" cy="-84" r="13" fill="#fff" stroke="#1b1030" strokeWidth="4" />
        <path d="M58 -6 Q96 -30 108 -70" stroke="#1b1030" strokeWidth="18" fill="none" strokeLinecap="round" />
        <path d="M58 -6 Q96 -30 108 -70" stroke="#f26a1b" strokeWidth="11" fill="none" strokeLinecap="round" />
        <circle cx="110" cy="-76" r="13" fill="#fff" stroke="#1b1030" strokeWidth="4" />
        {/* legs + sneakers */}
        <path d="M-22 60 L-34 98" stroke="#1b1030" strokeWidth="14" strokeLinecap="round" />
        <path d="M24 60 L44 92" stroke="#1b1030" strokeWidth="14" strokeLinecap="round" />
        <path d="M-50 96 q16 -14 30 0 l2 10 h-36z" fill="#22d3ee" stroke="#1b1030" strokeWidth="4" strokeLinejoin="round" />
        <path d="M30 90 q16 -14 30 0 l2 10 h-36z" fill="#22d3ee" stroke="#1b1030" strokeWidth="4" strokeLinejoin="round" />
        {/* ball body */}
        <circle r="66" fill="url(#dk-ball)" stroke="#1b1030" strokeWidth="5" />
        <path d="M-66 0 Q0 18 66 0 M0 -66 Q-16 0 0 66 M-46 -48 Q-18 0 -46 48 M46 -48 Q18 0 46 48" stroke="#5a1d05" strokeWidth="4" fill="none" />
        <Eyes x={2} y={-14} r={14} gap={42} look={[5, -3]} />
        <path d="M-22 16 Q4 46 30 16 Z" fill="#7f1d1d" stroke="#1b1030" strokeWidth="4" strokeLinejoin="round" />
        <path d="M-10 30 Q4 38 18 30" fill="#fb7185" />
        <ellipse cx="-38" cy="10" rx="9" ry="5" fill="#ff8a8a" opacity="0.6" />
        <ellipse cx="44" cy="8" rx="9" ry="5" fill="#ff8a8a" opacity="0.6" />
        {/* headband */}
        <path d="M-58 -36 Q0 -58 58 -36" stroke="#1b1030" strokeWidth="14" fill="none" />
        <path d="M-58 -36 Q0 -58 58 -36" stroke="#22d3ee" strokeWidth="8" fill="none" />
      </g>
      <Sparkle x={60} y={70} s={1.1} />
      <Sparkle x={270} y={210} s={0.8} c="#fde68a" />
      <Title lines={['DUNK', 'RUSH']} y={330} fill={['#fff7c2', '#fb923c']} size={64} />
    </svg>
  );
}

/* ---------------------------------------------------------------- Neon Dash */
function DashArt() {
  return (
    <svg viewBox="0 0 300 430" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="nd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e0b4b" />
          <stop offset="0.5" stopColor="#7e22ce" />
          <stop offset="0.75" stopColor="#ec4899" />
          <stop offset="1" stopColor="#f97316" />
        </linearGradient>
        <linearGradient id="nd-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde047" />
          <stop offset="1" stopColor="#f43f5e" />
        </linearGradient>
        <linearGradient id="nd-road" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e1065" />
          <stop offset="1" stopColor="#0b0420" />
        </linearGradient>
        <linearGradient id="nd-bolt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fef08a" />
          <stop offset="1" stopColor="#facc15" />
        </linearGradient>
      </defs>
      <rect width="300" height="430" fill="url(#nd-sky)" />
      <circle cx="150" cy="190" r="86" fill="url(#nd-sun)" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x="60" y={196 + i * 15} width="180" height={3 + i * 1.6} fill="#7e22ce" />
      ))}
      {/* skyline */}
      <path d="M0 250 V170 h24 v-30 h20 v50 h18 v-70 h26 v100 h20 v-40 h16 v40 H0Z" fill="#170a34" />
      <path d="M300 250 V160 h-22 v-40 h-24 v70 h-18 v-50 h-22 v90 h-16 v-30 h-14 v50 H300Z" fill="#170a34" />
      {Array.from({ length: 22 }, (_, i) => (
        <rect key={i} x={i < 11 ? 6 + (i % 4) * 18 : 214 + (i % 4) * 18} y={160 + ((i * 17) % 70)} width="5" height="7" fill={i % 3 ? '#22d3ee' : '#f0abfc'} />
      ))}
      {/* road */}
      <path d="M118 250 L182 250 L330 430 L-30 430Z" fill="url(#nd-road)" />
      <path d="M118 250 L-30 430 M182 250 L330 430" stroke="#22d3ee" strokeWidth="5" />
      <path d="M140 250 L80 430 M160 250 L220 430" stroke="#22d3ee" strokeWidth="2" opacity="0.6" />
      {[262, 284, 316, 362, 420].map((y, i) => (
        <path key={y} d={`M${118 - (y - 250) * 0.82} ${y} L${182 + (y - 250) * 0.82} ${y}`} stroke="#22d3ee" strokeWidth={1 + i * 0.6} opacity="0.55" />
      ))}
      {/* speed lines */}
      {[[20, 120], [250, 100], [30, 300], [262, 320], [12, 210]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y} l${i % 2 ? -50 : 50} 0`} stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
      ))}
      {/* mascot: Zip the lightning bolt */}
      <g transform="translate(150 150) rotate(10)">
        <path d="M-20 -110 L10 -110 L-6 -42 L32 -42 L-20 70 L-8 -6 L-40 -6Z" fill="#1b1030" transform="translate(5 7)" />
        <path d="M-20 -110 L10 -110 L-6 -42 L32 -42 L-20 70 L-8 -6 L-40 -6Z" fill="url(#nd-bolt)" stroke="#1b1030" strokeWidth="5" strokeLinejoin="round" />
        <Eyes x={-8} y={-74} r={10} gap={26} look={[4, 0]} />
        <path d="M-18 -50 Q-4 -36 12 -52" stroke="#1b1030" strokeWidth="4" fill="#7f1d1d" strokeLinejoin="round" />
        {/* running legs */}
        <path d="M-14 40 l-22 34 l-16 -4" stroke="#1b1030" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M-6 40 l22 26 l18 -8" stroke="#1b1030" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M-60 66 q8 -12 22 -2 l2 8 h-26z" fill="#f43f5e" stroke="#1b1030" strokeWidth="3.5" />
        <path d="M30 54 q10 -10 22 0 l2 8 h-26z" fill="#f43f5e" stroke="#1b1030" strokeWidth="3.5" />
      </g>
      <Sparkle x={52} y={60} />
      <Sparkle x={250} y={70} s={0.7} c="#fde047" />
      <Title lines={['NEON', 'DASH']} y={340} fill={['#a5f3fc', '#22d3ee']} size={64} tilt={-6} />
    </svg>
  );
}

/* ---------------------------------------------------------------- Brick Blitz */
function BrickArt() {
  const bricks = [
    ['#f43f5e', 12], ['#f97316', 7], ['#facc15', 3], ['#22c55e', 9], ['#06b6d4', 5],
    ['#8b5cf6', 14], ['#ec4899', 6], ['#3b82f6', 2], ['#f97316', 11], ['#22c55e', 4],
  ] as const;
  return (
    <svg viewBox="0 0 300 430" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="bb-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
        <radialGradient id="bb-ball" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c7d2fe" />
        </radialGradient>
      </defs>
      <rect width="300" height="430" fill="url(#bb-bg)" />
      {/* clouds */}
      <g fill="#fff" opacity="0.35">
        <ellipse cx="60" cy="40" rx="50" ry="16" />
        <ellipse cx="250" cy="70" rx="44" ry="14" />
      </g>
      {/* brick wall */}
      {bricks.map(([c, n], i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const x = 12 + col * 56;
        const y = 34 + row * 52;
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${(i % 3) - 1} 25 22)`}>
            <rect width="50" height="44" rx="9" fill="#1b1030" transform="translate(0 5)" />
            <rect width="50" height="44" rx="9" fill={c} stroke="#1b1030" strokeWidth="4" />
            <rect x="6" y="5" width="38" height="8" rx="4" fill="#fff" opacity="0.35" />
            <text x="25" y="34" textAnchor="middle" fontFamily={FONT} fontSize="24" fill="#fff" stroke="#1b1030" strokeWidth="4" paintOrder="stroke">
              {n}
            </text>
          </g>
        );
      })}
      {/* shattered brick */}
      {[[236, 146, 20], [256, 160, -30], [220, 170, 45]].map(([x, y, r], i) => (
        <rect key={i} x={x} y={y} width="16" height="12" rx="3" fill="#facc15" stroke="#1b1030" strokeWidth="3" transform={`rotate(${r} ${x} ${y})`} />
      ))}
      {/* aim dots + volley */}
      {Array.from({ length: 8 }, (_, i) => (
        <circle key={i} cx={128 + i * 11} cy={250 - i * 16} r="4" fill="#fff" opacity={0.9 - i * 0.09} />
      ))}
      {[[206, 166], [186, 204], [228, 196], [168, 236]].map(([x, y], i) => (
        <g key={i}>
          <path d={`M${x} ${y} l-10 22`} stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity="0.4" />
          <circle cx={x} cy={y} r="9" fill="url(#bb-ball)" stroke="#1b1030" strokeWidth="3" />
        </g>
      ))}
      {/* mascot: Bolt the launcher ball */}
      <g transform="translate(92 270) scale(0.85)">
        <ellipse cx="0" cy="52" rx="46" ry="9" fill="#1b1030" opacity="0.35" />
        <circle r="46" fill="url(#bb-ball)" stroke="#1b1030" strokeWidth="5" />
        <Eyes x={6} y={-8} r={11} gap={32} look={[4, -4]} />
        <path d="M-12 14 Q8 32 26 12" stroke="#1b1030" strokeWidth="5" fill="#7f1d1d" strokeLinejoin="round" />
        <path d="M-40 -30 Q-20 -60 20 -52" stroke="#f43f5e" strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d="M30 -10 q22 -30 36 -54" stroke="#1b1030" strokeWidth="12" fill="none" strokeLinecap="round" />
        <circle cx="68" cy="-68" r="11" fill="#fff" stroke="#1b1030" strokeWidth="4" />
      </g>
      <Sparkle x={36} y={176} s={0.9} />
      <Sparkle x={272} y={236} s={0.6} c="#fde047" />
      <Title lines={['BRICK', 'BLITZ']} y={348} fill={['#fef9c3', '#facc15']} size={62} tilt={-5} />
    </svg>
  );
}

/* ---------------------------------------------------------------- Cyber Reflex */
function ReflexArt() {
  return (
    <svg viewBox="0 0 300 430" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="cr-bg" cx="0.5" cy="0.38" r="0.8">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="0.6" stopColor="#065f46" />
          <stop offset="1" stopColor="#042f2e" />
        </radialGradient>
        <linearGradient id="cr-bot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="1" stopColor="#94a3b8" />
        </linearGradient>
      </defs>
      <rect width="300" height="430" fill="url(#cr-bg)" />
      {/* grid floor */}
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} d={`M0 ${300 + i * i * 2.6} H300`} stroke="#5eead4" strokeWidth="1.5" opacity={0.15 + i * 0.05} />
      ))}
      {Array.from({ length: 11 }, (_, i) => (
        <path key={i} d={`M150 290 L${-150 + i * 60} 430`} stroke="#5eead4" strokeWidth="1.5" opacity="0.25" />
      ))}
      {/* targets */}
      {[[62, 110, 26, '#22d3ee'], [244, 150, 22, '#fbbf24'], [56, 250, 18, '#f43f5e'], [250, 262, 20, '#22d3ee']].map(([x, y, r, c], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={Number(r) * 1.9} fill="none" stroke={String(c)} strokeWidth="3" opacity="0.5" />
          <circle cx={x} cy={y} r={r} fill={String(c)} stroke="#1b1030" strokeWidth="4" />
          <circle cx={Number(x) - Number(r) * 0.3} cy={Number(y) - Number(r) * 0.3} r={Number(r) * 0.3} fill="#fff" opacity="0.6" />
        </g>
      ))}
      {/* tap burst */}
      <g transform="translate(244 150)">
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} d="M0 -34 L0 -48" stroke="#fde68a" strokeWidth="5" strokeLinecap="round" transform={`rotate(${i * 45})`} />
        ))}
      </g>
      {/* mascot: Pix the robot */}
      <g transform="translate(150 195)">
        <path d="M0 -92 V-70" stroke="#1b1030" strokeWidth="6" />
        <circle cy="-98" r="10" fill="#f43f5e" stroke="#1b1030" strokeWidth="4" />
        <rect x="-78" y="-70" width="156" height="120" rx="34" fill="url(#cr-bot)" stroke="#1b1030" strokeWidth="5" />
        <rect x="-60" y="-50" width="120" height="66" rx="22" fill="#0f172a" stroke="#1b1030" strokeWidth="4" />
        <g>
          <ellipse cx="-24" cy="-18" rx="14" ry="16" fill="#5eead4" />
          <ellipse cx="24" cy="-18" rx="14" ry="16" fill="#5eead4" />
          <circle cx="-20" cy="-22" r="5" fill="#fff" />
          <circle cx="28" cy="-22" r="5" fill="#fff" />
        </g>
        <path d="M-22 30 Q0 44 22 30" stroke="#1b1030" strokeWidth="5" fill="none" strokeLinecap="round" />
        <rect x="-92" y="-24" width="16" height="40" rx="6" fill="#64748b" stroke="#1b1030" strokeWidth="4" />
        <rect x="76" y="-24" width="16" height="40" rx="6" fill="#64748b" stroke="#1b1030" strokeWidth="4" />
        {/* pointing arm */}
        <path d="M70 30 Q110 20 128 -14" stroke="#1b1030" strokeWidth="16" fill="none" strokeLinecap="round" />
        <path d="M70 30 Q110 20 128 -14" stroke="#cbd5e1" strokeWidth="9" fill="none" strokeLinecap="round" />
        <circle cx="132" cy="-22" r="11" fill="#e2e8f0" stroke="#1b1030" strokeWidth="4" />
      </g>
      <Sparkle x={150} y={60} s={0.8} c="#a7f3d0" />
      <Title lines={['CYBER', 'REFLEX']} y={330} fill={['#d9f99d', '#4ade80']} size={58} tilt={-4} />
    </svg>
  );
}

/* ---------------------------------------------------------------- Gem Surge */
function GemArt() {
  const gem = (x: number, y: number, s: number, c1: string, c2: string, r = 0) => (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
      <path d="M-30 -12 L-16 -30 L16 -30 L30 -12 L0 30Z" fill="#1b1030" transform="translate(0 5)" />
      <path d="M-30 -12 L-16 -30 L16 -30 L30 -12 L0 30Z" fill={c1} stroke="#1b1030" strokeWidth="4" strokeLinejoin="round" />
      <path d="M-30 -12 H30 M-16 -30 L-8 -12 L0 30 M16 -30 L8 -12 L0 30 M-8 -12 L0 -30 L8 -12" stroke={c2} strokeWidth="2.5" fill="none" />
      <path d="M-20 -24 L-10 -24 L-16 -16Z" fill="#fff" opacity="0.7" />
    </g>
  );
  return (
    <svg viewBox="0 0 300 430" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="gs-bg" cx="0.5" cy="0.45" r="0.85">
          <stop offset="0" stopColor="#c084fc" />
          <stop offset="0.55" stopColor="#6b21a8" />
          <stop offset="1" stopColor="#2e1065" />
        </radialGradient>
        <linearGradient id="gs-big" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="1" stopColor="#0891b2" />
        </linearGradient>
      </defs>
      <rect width="300" height="430" fill="url(#gs-bg)" />
      {/* light rays */}
      {Array.from({ length: 10 }, (_, i) => (
        <path key={i} d="M150 190 L140 -40 L160 -40Z" fill="#fff" opacity="0.07" transform={`rotate(${i * 36} 150 190)`} />
      ))}
      {/* treasure pile */}
      <ellipse cx="150" cy="300" rx="150" ry="40" fill="#3b0764" />
      {gem(40, 270, 0.9, '#f43f5e', '#fecdd3', -12)}
      {gem(262, 262, 1, '#22c55e', '#bbf7d0', 14)}
      {gem(86, 300, 0.7, '#facc15', '#fef9c3', 8)}
      {gem(214, 302, 0.75, '#a855f7', '#e9d5ff', -8)}
      {gem(60, 120, 0.6, '#22c55e', '#bbf7d0', 20)}
      {gem(244, 110, 0.7, '#f43f5e', '#fecdd3', -18)}
      {/* mascot: Glint the big gem */}
      <g transform="translate(150 196)">
        <path d="M-82 -30 L-46 -80 L46 -80 L82 -30 L0 86Z" fill="#1b1030" transform="translate(0 8)" />
        <path d="M-82 -30 L-46 -80 L46 -80 L82 -30 L0 86Z" fill="url(#gs-big)" stroke="#1b1030" strokeWidth="5" strokeLinejoin="round" />
        <path d="M-82 -30 H82 M-46 -80 L-22 -30 L0 86 M46 -80 L22 -30 L0 86 M-22 -30 L0 -80 L22 -30" stroke="#cffafe" strokeWidth="3" fill="none" opacity="0.8" />
        <path d="M-60 -66 L-36 -66 L-50 -44Z" fill="#fff" opacity="0.8" />
        <Eyes x={0} y={-2} r={13} gap={46} look={[2, 2]} />
        <path d="M-18 26 Q0 44 18 26 Z" fill="#7f1d1d" stroke="#1b1030" strokeWidth="4" strokeLinejoin="round" />
        {/* crown */}
        <path d="M-34 -84 L-30 -112 L-14 -96 L0 -118 L14 -96 L30 -112 L34 -84Z" fill="#facc15" stroke="#1b1030" strokeWidth="4" strokeLinejoin="round" />
      </g>
      <Sparkle x={150} y={52} s={1.2} c="#fde68a" />
      <Sparkle x={34} y={190} s={0.7} />
      <Sparkle x={270} y={190} s={0.8} />
      <Title lines={['GEM', 'SURGE']} y={346} fill={['#fbcfe8', '#ec4899']} size={62} tilt={-5} />
    </svg>
  );
}

const ART: Record<GameId, () => React.ReactElement> = {
  'dunk-rush': DunkArt,
  'neon-dash': DashArt,
  'brick-blitz': BrickArt,
  'cyber-reflex': ReflexArt,
  'gem-surge': GemArt,
};

export default function GameArt({ id }: { id: GameId }) {
  const Art = ART[id];
  return <Art />;
}
