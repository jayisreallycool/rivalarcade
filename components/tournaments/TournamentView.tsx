'use client';

import React, { useEffect, useState } from 'react';
import { userStore, useUserStore, timeLeft, usd, type Cup } from '@/lib/user-store';
import { GAME_NAMES } from '@/lib/game-types';
import { findItem } from '@/lib/cosmetics-catalog';
import { sound } from '@/lib/sound';
import AvatarView from '@/components/avatar/AvatarView';
import GameModal from '@/components/games/GameModal';
import { Trophy, Clock, Users, Coins, CheckCircle2, Gift, Loader2 } from 'lucide-react';

/** Scheduled cups against every real player in the field: same seed, one run, best scores paid. */
export default function TournamentView() {
  const userState = useUserStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Cup | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void userStore.refreshCups().then(() => setLoaded(true));
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    const r = setInterval(() => void userStore.refreshCups(), 30_000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, []);

  const cups = userState.cups;
  const selected = cups.find((c) => c.id === selectedId) ?? cups[0];
  const fmt = (c: Cup, n: number) => (c.currency === 'usd' ? usd(n) : `${n.toLocaleString()}`);

  if (!loaded && cups.length === 0) {
    return (
      <div className="flex justify-center py-16" data-testid="cups-loading">
        <Loader2 className="w-7 h-7 text-cyan-300 animate-spin" />
      </div>
    );
  }

  const canAfford = selected ? (selected.currency === 'usd' ? userState.cashCents : userState.stats.coins) >= selected.entry : false;

  return (
    <div className="w-full max-w-5xl mx-auto p-4 space-y-5" data-testid="cups">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#181a29] to-[#12131d] border border-[#242738] p-5">
        <div className="flex items-center gap-2 mb-2 text-xs font-black uppercase tracking-widest text-amber-400">
          <Trophy className="w-4 h-4" /> LIVE CUPS
        </div>
        <p className="text-xs md:text-sm text-slate-300">Every real player in a cup plays the same seed, once. When the cup closes, the top 7 split the pool and 1st takes the exclusive item.</p>
        <div className="mt-3 flex gap-4 text-xs">
          <span className="text-slate-400">
            Cups won <span className="font-black text-cyan-300" data-testid="tournaments-won">{userState.stats.tournamentsWon}</span>
          </span>
          <span className="text-slate-400">
            Crowns <span className="font-black text-amber-300">{userState.stats.crowns}</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          {cups.map((c) => {
            const on = selected?.id === c.id;
            return (
              <button
                key={c.id}
                data-testid={`cup-${c.id.split('-').slice(1, -1).join('-')}`}
                onClick={() => {
                  sound.playTap();
                  setSelectedId(c.id);
                }}
                className={`relative w-full text-left p-4 rounded-xl border transition-all ${on ? 'border-cyan-400 bg-[#161928]' : 'border-[#242738] bg-[#12131d]'}`}
              >
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[10px] font-black">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
                    </span>
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-[#1a1c2b] text-slate-300 border border-[#2b2e45] hidden sm:inline">{c.badge}</span>
                    <span className="text-xs text-slate-400 truncate">{GAME_NAMES[c.gameId]}</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs text-amber-400 font-mono shrink-0">
                    <Clock className="w-3.5 h-3.5" /> {timeLeft(c.closesAt, now)}
                  </span>
                </div>
                <h3 className="font-bold text-base text-white mb-2">{c.title}</h3>
                <div className="flex items-center justify-between text-xs pt-2 border-t border-[#1e202f]">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1 text-slate-400">
                      <Users className="w-3.5 h-3.5" /> {c.count}/{c.size}
                    </span>
                    <span className="flex items-center gap-1 text-amber-400 font-bold">
                      <Coins className="w-3.5 h-3.5" /> {fmt(c, c.pool)} pool
                    </span>
                  </div>
                  {c.mine?.played ? (
                    <span className="flex items-center gap-1 text-emerald-400 font-extrabold text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" /> SCORE {c.mine.score ?? 0}
                    </span>
                  ) : c.mine?.joined ? (
                    <span className="text-[11px] font-extrabold text-cyan-300">ENTERED · PLAY NOW</span>
                  ) : (
                    <span className="text-[11px] font-bold text-slate-300">{c.entry === 0 ? 'FREE ENTRY' : `${fmt(c, c.entry)} ENTRY`}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="rounded-xl border border-[#242738] bg-[#12131d] p-4 space-y-4 h-fit" data-testid="cup-detail">
            <div>
              <h3 className="font-black text-white text-lg">{selected.title}</h3>
              <p className="text-xs text-slate-400 mt-1">{selected.description}</p>
            </div>
            {selected.prizeItem && (
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <Gift className="w-4 h-4" /> 1st place: {findItem(selected.prizeItem)?.name ?? selected.prizeItem}
              </div>
            )}
            <div className="text-[11px] text-slate-400">
              Pays {selected.payoutBps.map((b, i) => `${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'} ${b / 100}%`).join(' · ')}
            </div>
            <div>
              <div className="text-[10px] font-black tracking-widest text-slate-500 mb-1.5">STANDINGS</div>
              {selected.top.filter((r) => r.score !== null).length === 0 ? (
                <p className="text-xs text-slate-500">No scores yet — be the first.</p>
              ) : (
                selected.top
                  .filter((r) => r.score !== null)
                  .map((r, i) => (
                    <div key={r.uid} className={`flex items-center gap-2 py-1 text-sm ${r.uid === userState.session?.uid ? 'text-cyan-200 font-black' : 'text-slate-300'}`}>
                      <span className={`w-5 text-center font-black ${i < 3 ? 'text-amber-400' : 'text-slate-600'}`}>{i + 1}</span>
                      {r.avatar && <AvatarView avatar={r.avatar} size={24} animate={false} />}
                      <span className="flex-1 truncate">{r.username}</span>
                      <span className="font-mono tabular-nums">{r.score}</span>
                    </div>
                  ))
              )}
            </div>
            <button
              disabled={!!selected.mine?.played || (!selected.mine?.joined && !canAfford)}
              onClick={() => {
                sound.playTap();
                setPlaying(selected);
              }}
              className="w-full h-12 rounded-xl bg-amber-400 text-black font-black disabled:opacity-40"
              data-testid="cup-action"
            >
              {selected.mine?.played ? 'RUN SUBMITTED · RESULTS AT CLOSE' : selected.mine?.joined ? 'PLAY YOUR RUN' : `ENTER & PLAY · ${selected.entry === 0 ? 'FREE' : `${fmt(selected, selected.entry)}${selected.currency === 'coins' ? ' COINS' : ''}`}`}
            </button>
          </div>
        )}
      </div>

      {playing && (
        <GameModal
          gameId={playing.gameId}
          mode="tournament"
          contestId={playing.id}
          onClose={() => {
            setPlaying(null);
            void userStore.refreshCups();
          }}
        />
      )}
    </div>
  );
}
