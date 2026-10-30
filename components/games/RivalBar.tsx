'use client';

import React from 'react';
import type { RivalInfo } from '@/lib/game-types';

/**
 * Live head-to-head strip under the game HUD.
 * For timed games pass `progress` (0–1 of the round elapsed) and the rival's score climbs
 * at an even pace toward their final; for endless games the full target is shown.
 */
export default function RivalBar({ rival, score, progress }: { rival: RivalInfo; score: number; progress?: number | null }) {
  const rivalNow = progress == null ? rival.score : Math.round(rival.score * Math.min(1, Math.max(0, progress)));
  const max = Math.max(1, score, rivalNow, progress == null ? rival.score : 0);
  const ahead = score > rivalNow;
  const tied = score === rivalNow;

  return (
    <div className="w-full px-4 py-1.5 bg-[#0e1018] border-b border-[#242738] flex items-center gap-3 text-[11px] font-mono" data-testid="rival-bar">
      <span className={`font-bold tabular-nums w-14 ${ahead ? 'text-emerald-400' : 'text-slate-300'}`}>{score}</span>
      <div className="relative flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-emerald-400 transition-[width] duration-200" style={{ width: `${(score / max) * 100}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-rose-400 shadow-[0_0_6px_#fb7185] transition-[left] duration-200" style={{ left: `calc(${(rivalNow / max) * 100}% - 1px)` }} />
      </div>
      <span className="text-rose-300 font-bold tabular-nums text-right">
        {rivalNow}
        <span className="text-slate-500 font-normal ml-1.5 hidden sm:inline">
          {rival.label ?? 'RIVAL'} {rival.name}
        </span>
      </span>
      <span className={`text-[10px] font-black uppercase w-12 text-right ${ahead ? 'text-emerald-400' : tied ? 'text-slate-400' : 'text-rose-400'}`}>
        {ahead ? 'AHEAD' : tied ? 'EVEN' : 'BEHIND'}
      </span>
    </div>
  );
}
