'use client';

import React, { useEffect, useState } from 'react';
import { userStore, useUserStore, tierForRating } from '@/lib/user-store';
import AvatarView from '@/components/avatar/AvatarView';
import { Trophy, Loader2 } from 'lucide-react';

/** Global skill-rating table of real players (from the server; banned players never appear). */
export default function LeaderboardView() {
  const s = useUserStore();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void userStore.refreshLeaderboard().then(() => setLoaded(true));
  }, []);
  const rows = s.leaderboard;
  const me = s.session?.uid;
  const mine = rows.find((r) => r.uid === me);
  const total = s.stats.wins + s.stats.losses;

  return (
    <div className="w-full max-w-3xl mx-auto p-4 space-y-4" data-testid="rankings">
      <div className="rounded-2xl bg-gradient-to-r from-[#181a29] to-[#12131d] border border-[#242738] p-4 flex items-center gap-4">
        <AvatarView avatar={s.avatar} size={56} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-cyan-400">
            <Trophy className="w-4 h-4" /> Your rank
          </div>
          <div className="text-white font-black text-lg truncate">{s.username}</div>
          <div className="text-xs text-slate-400">
            {s.stats.rating} SR · {s.stats.tier} · {total > 0 ? `${Math.round((s.stats.wins / total) * 100)}% wins` : 'no ranked matches yet'}
          </div>
        </div>
        <div className="text-3xl font-black text-amber-300 tabular-nums" data-testid="my-place">
          {mine ? `#${mine.place}` : '—'}
        </div>
      </div>

      <div className="rounded-2xl bg-[#12131d] border border-[#242738] overflow-hidden">
        <div className="grid grid-cols-[2.5rem_1fr_4rem_4rem] px-3 py-2 text-[10px] font-black tracking-widest text-slate-500 border-b border-white/5">
          <span>#</span>
          <span>PLAYER</span>
          <span className="text-right">SR</span>
          <span className="text-right">W–L</span>
        </div>
        {!loaded && rows.length === 0 ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 text-cyan-300 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-10">No ranked players yet. Win a 1v1 to be the first on the board.</p>
        ) : (
          rows.map((r) => (
            <div key={r.uid} className={`grid grid-cols-[2.5rem_1fr_4rem_4rem] items-center px-3 py-2 text-sm border-b border-white/5 last:border-0 ${r.uid === me ? 'bg-cyan-500/10' : ''}`} data-testid="rank-row">
              <span className={`font-black ${r.place <= 3 ? 'text-amber-400' : 'text-slate-500'}`}>{r.place}</span>
              <span className="flex items-center gap-2 min-w-0">
                {r.avatar && <AvatarView avatar={r.avatar} size={28} animate={false} />}
                <span className={`truncate font-bold ${r.uid === me ? 'text-cyan-200' : 'text-white'}`}>
                  {r.username}
                  {r.uid === me ? ' (you)' : ''}
                </span>
                <span className="hidden sm:inline text-[10px] text-slate-500">{tierForRating(r.rating)}</span>
              </span>
              <span className="text-right font-mono font-black text-white tabular-nums">{r.rating}</span>
              <span className="text-right text-xs text-slate-400 tabular-nums">
                {r.wins}–{r.losses}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
