'use client';

import React, { useEffect, useState } from 'react';
import { timeAgo, useUserStore, userStore, usd, type ServerMatch } from '@/lib/user-store';
import GameModal from '@/components/games/GameModal';
import { MODE_LABEL } from '@/lib/game-types';
import GameArt from '@/components/games/GameArt';
import { Coins, Trophy } from 'lucide-react';

type Filter = 'all' | 'wins' | 'paid';

/** Every finished match, newest first, with the outcome and net coins at a glance. */
export default function ResultsView({ onPlay }: { onPlay: () => void }) {
  const userState = useUserStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [now, setNow] = useState(() => Date.now());
  const [resume, setResume] = useState<ServerMatch | null>(null);
  const waiting = userState.serverMatches.some((m) => m.status !== 'settled' && m.status !== 'cancelled' && m.kind !== 'practice');
  useEffect(() => {
    void userStore.refreshHistory();
  }, []);
  // While results are pending, keep checking (settlement happens on the server).
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      setNow(Date.now());
      void userStore.refreshHistory();
    }, 10_000);
    return () => clearInterval(t);
  }, [waiting]);
  const unplayed = (id: string) => userState.serverMatches.find((m) => m.id === id && m.status === 'joined' && m.kind !== 'cup' && (m.closesAt ?? 0) > now);
  const s = userState.stats;
  const rows = userState.matchHistory.filter((m) => (filter === 'wins' ? m.result === 'win' : filter === 'paid' ? (m.entry ?? 0) > 0 : true));
  const winRate = s.totalMatches ? Math.round((s.wins / s.totalMatches) * 100) : 0;

  return (
    <div className="px-4 pb-6 max-w-2xl mx-auto" data-testid="results-view">
      <h1 className="text-3xl text-white mb-3" style={{ fontFamily: "'Lilita One', system-ui" }}>
        Results
      </h1>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Wins', value: s.wins },
          { label: 'Win rate', value: `${winRate}%` },
          { label: 'Best streak', value: s.bestStreak },
        ].map((x) => (
          <div key={x.label} className="rounded-2xl bg-white/[0.06] p-3 text-center">
            <div className="text-xl font-black text-white tabular-nums" suppressHydrationWarning>
              {x.value}
            </div>
            <div className="text-[11px] font-bold text-white/45">{x.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-3">
        {(['all', 'wins', 'paid'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`h-9 px-4 rounded-full text-sm font-bold ${filter === f ? 'bg-[#141420] text-white ring-2 ring-white/85' : 'bg-white/[0.07] text-white/60'}`}
          >
            {f === 'all' ? 'All' : f === 'wins' ? 'Wins' : 'Paid entry'}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl bg-white/[0.04] p-8 text-center">
          <Trophy className="w-10 h-10 text-white/20 mx-auto mb-2" />
          <p className="text-white/60 font-bold mb-3">No matches here yet</p>
          <button onClick={onPlay} className="px-5 h-11 rounded-full bg-emerald-400 text-black font-black">
            Play a game
          </button>
        </div>
      ) : (
        <div className="space-y-2.5" data-testid="results-list">
          {rows.map((m) => {
            const usdMatch = m.currency === 'usd';
            const net = m.result === 'pending' ? 0 : m.result === 'cancelled' ? 0 : usdMatch ? (m.payout ?? 0) - (m.entry ?? 0) : m.entry ? m.coinsEarned - m.entry : m.coinsEarned;
            const open = unplayed(m.id);
            const tone =
              m.result === 'pending'
                ? { label: open ? 'PLAY NOW' : 'PENDING', cls: 'bg-cyan-400 text-black' }
                : m.result === 'cancelled'
                  ? { label: 'REFUNDED', cls: 'bg-slate-500 text-white' }
                  : m.result === 'win' ? { label: 'WON', cls: 'bg-emerald-400 text-black' } : m.result === 'loss' ? { label: 'LOST', cls: 'bg-rose-500 text-white' } : m.result === 'tie' ? { label: 'TIE', cls: 'bg-slate-500 text-white' } : m.mode === 'tournament' ? { label: 'CUP', cls: 'bg-amber-400 text-black' } : { label: 'PRACTICE', cls: 'bg-white/15 text-white/80' };
            const sub = m.detail ?? (m.mode === 'duel' ? `vs ${m.opponentName}` : m.mode === 'tournament' ? m.opponentName.replace(/ #\d+$/, '') : MODE_LABEL[m.mode]);
            return (
              <div
                key={m.id}
                onClick={() => open && setResume(open)}
                role={open ? 'button' : undefined}
                className={`flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.05] ring-1 ${open ? 'ring-cyan-400/50 cursor-pointer' : 'ring-white/5'}`}
                data-testid="result-row"
                data-result={m.result}
              >
                <div className="w-14 h-[72px] shrink-0 rounded-xl overflow-hidden ring-1 ring-white/10">
                  <GameArt id={m.gameId} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${tone.cls}`}>{tone.label}</span>
                    <span className="text-[11px] font-bold text-white/45">{MODE_LABEL[m.mode]}</span>
                  </div>
                  <div className="text-white font-bold truncate">{m.gameName}</div>
                  <div className="text-[11px] text-white/45 truncate" suppressHydrationWarning>
                    {sub} · {m.at ? timeAgo(m.at, now) : m.date}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-black text-white tabular-nums">
                    {m.playerScore.toLocaleString()}
                    {m.mode === 'duel' && m.result !== 'pending' && m.result !== 'cancelled' && <span className="text-white/40 text-xs font-bold"> / {m.opponentScore.toLocaleString()}</span>}
                  </div>
                  {m.result === 'pending' ? (
                    <div className="text-xs font-black text-cyan-300">{open ? 'Tap to play' : '…'}</div>
                  ) : usdMatch ? (
                    <div className={`text-xs font-black ${net < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>{`${net >= 0 ? '+' : '−'}${usd(Math.abs(net))}`}</div>
                  ) : (
                    <div className={`flex items-center justify-end gap-1 text-xs font-black ${net < 0 ? 'text-rose-400' : 'text-amber-300'}`}>
                      <Coins className="w-3.5 h-3.5" />
                      {net >= 0 ? `+${net}` : net}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {resume && (
        <GameModal
          gameId={resume.gameId}
          mode={resume.kind === 'h2h' ? 'duel' : 'arena'}
          entry={resume.entry}
          currency={resume.currency}
          contestId={resume.contestId ?? undefined}
          onClose={() => {
            setResume(null);
            void userStore.refreshHistory();
          }}
        />
      )}
    </div>
  );
}
