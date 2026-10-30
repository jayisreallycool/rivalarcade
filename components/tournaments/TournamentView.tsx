'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { userStore, useUserStore } from '@/lib/user-store';
import { botRowAvatar, formatTimeLeft, gameNameOf, participantsCount, standings, Tournament, tournamentStatus } from '@/lib/tournaments-data';
import { COSMETICS_CATALOG } from '@/lib/cosmetics-catalog';
import AvatarView from '@/components/avatar/AvatarView';
import GameModal from '@/components/games/GameModal';
import { sound } from '@/lib/sound';
import { Trophy, Clock, Users, Coins, Sparkles, CheckCircle2, Gift, AlertCircle } from 'lucide-react';

const cosmeticName = (id?: string) => COSMETICS_CATALOG.find((c) => c.id === id)?.name ?? 'Exclusive Cosmetic';

function StatusPill({ t, now }: { t: Tournament; now: number }) {
  const st = tournamentStatus(t, now);
  const cls =
    st === 'live' ? 'bg-rose-500/20 text-rose-300 border-rose-500/50' : st === 'registering' ? 'bg-cyan-950/80 text-cyan-300 border-cyan-800' : 'bg-slate-800 text-slate-400 border-slate-700';
  return (
    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border flex items-center gap-1 ${cls}`}>
      {st === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />}
      {st === 'live' ? 'Live' : st === 'registering' ? 'Registering' : 'Ended'}
    </span>
  );
}

function timeLabel(t: Tournament, now: number) {
  const st = tournamentStatus(t, now);
  if (st === 'registering') return `Starts in ${formatTimeLeft(t.startsAt - now)}`;
  if (st === 'live') return `Ends in ${formatTimeLeft(t.endsAt - now)}`;
  return 'Ended';
}

export default function TournamentView() {
  const userState = useUserStore();
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeGame, setActiveGame] = useState<Tournament | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  // Clock tick: drives countdowns, live bracket fills, settlement and rotation.
  useEffect(() => {
    userStore.syncTournaments();
    const id = setInterval(() => {
      setNow(Date.now());
      userStore.syncTournaments();
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(id);
  }, [notice]);

  const tournaments = userState.tournaments;
  const selected = tournaments.find((t) => t.id === selectedId) ?? tournaments.find((t) => tournamentStatus(t, now) === 'live') ?? tournaments[0];
  const user = { name: userState.username, avatar: userState.avatar };
  const table = useMemo(() => (selected ? standings(selected, now, user) : []), [selected, now, user.name, user.avatar]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selected) {
    return <div className="w-full max-w-5xl mx-auto p-4 text-slate-400 text-sm">Loading tournaments…</div>;
  }

  const status = tournamentStatus(selected, now);
  const myRow = table.find((r) => r.isUser);
  const visibleRows = table.slice(0, 10);
  if (myRow && myRow.rank > 10) visibleRows.push(myRow);

  const handleAction = () => {
    sound.playTap();
    if (!selected.entered) {
      const res = userStore.enterTournament(selected.id);
      if (!res.ok) {
        sound.playLose();
        setNotice({ kind: 'error', text: res.reason });
        return;
      }
      sound.playPowerup();
      setNotice({ kind: 'success', text: selected.entryFee ? `Entered! ${selected.entryFee} coins paid.` : 'Entered — good luck!' });
      if (status !== 'live') return;
    }
    if (status === 'live') setActiveGame(selected);
  };

  const handleClaim = () => {
    const r = userStore.claimTournament(selected.id);
    if (!r) return;
    sound.playWin();
    const extra = r.cosmetic ? ` + ${cosmeticName(r.cosmetic)}` : r.cosmeticAsCoins ? ` + ${r.cosmeticAsCoins} (duplicate prize)` : '';
    setNotice({ kind: 'success', text: `Claimed ${r.coins + (r.cosmeticAsCoins ?? 0)} coins${extra}!` });
    setSelectedId(null);
  };

  let actionLabel = '';
  let actionDisabled = false;
  if (status === 'completed') {
    actionLabel = 'CUP ENDED';
    actionDisabled = true;
  } else if (!selected.entered) {
    actionLabel = `${status === 'live' ? 'ENTER & PLAY' : 'REGISTER'} · ${selected.entryFee === 0 ? 'FREE' : `${selected.entryFee} COINS`}`;
  } else if (status === 'registering') {
    actionLabel = `REGISTERED · STARTS IN ${formatTimeLeft(selected.startsAt - now)}`;
    actionDisabled = true;
  } else {
    actionLabel = selected.attempts ? `PLAY ANOTHER RUN (${selected.attempts} so far)` : 'PLAY TOURNAMENT SEED';
  }

  return (
    <div className="w-full max-w-5xl mx-auto p-4 space-y-6">
      {notice && (
        <div
          role="status"
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-xl font-bold text-sm flex items-center gap-2 ${
            notice.kind === 'error' ? 'bg-rose-500 text-white' : 'bg-emerald-400 text-black'
          }`}
        >
          {notice.kind === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />} {notice.text}
        </div>
      )}

      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#181a29] to-[#12131d] border border-[#242738] p-6 shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2 text-xs font-black uppercase tracking-widest text-amber-400">
              <Trophy className="w-4 h-4" /> AUTOMATED COMPETITIONS
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white italic">ARENA TOURNAMENTS</h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-xl mt-1">
              Everyone plays the same seed. Submit as many runs as you like while a cup is live — your best counts. Top 3 split the prize pool; 1st takes the exclusive cosmetic.
            </p>
          </div>
          <div className="flex items-center gap-4 bg-[#0a0b12] px-4 py-3 rounded-xl border border-[#242738]">
            <div className="text-center">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Trophies</span>
              <div className="text-base font-black text-amber-400">{userState.stats.trophies}</div>
            </div>
            <div className="h-6 w-px bg-slate-800" />
            <div className="text-center">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Tournaments Won</span>
              <div className="text-base font-black text-cyan-400" data-testid="tournaments-won">{userState.stats.tournamentsWon}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">ACTIVE & SCHEDULED CUPS</span>
          {tournaments.map((t) => {
            const isSelected = selected.id === t.id;
            const unclaimed = t.result && !t.result.claimed;
            return (
              <button
                key={t.id}
                data-testid={`cup-${t.templateId}`}
                onClick={() => {
                  sound.playTap();
                  setSelectedId(t.id);
                }}
                className={`relative w-full text-left p-4 rounded-xl border transition-all ${
                  isSelected ? 'border-cyan-400 bg-[#161928] shadow-lg shadow-cyan-500/10' : 'border-[#242738] bg-[#12131d] hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusPill t={t} now={now} />
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-[#1a1c2b] text-slate-300 border border-[#2b2e45] hidden sm:inline">{t.badge}</span>
                    <span className="text-xs text-slate-400 truncate">{gameNameOf(t)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-amber-400 font-mono shrink-0">
                    <Clock className="w-3.5 h-3.5" /> {timeLabel(t, now)}
                  </div>
                </div>
                <h3 className="font-bold text-base text-white mb-2">{t.title}</h3>
                <div className="flex items-center justify-between text-xs pt-2 border-t border-[#1e202f]">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1 text-slate-400">
                      <Users className="w-3.5 h-3.5" /> {participantsCount(t)}/{t.maxParticipants}
                    </span>
                    <span className="flex items-center gap-1 text-amber-400 font-bold">
                      <Coins className="w-3.5 h-3.5" /> {t.prizePoolCoins.toLocaleString()} Pool
                    </span>
                  </div>
                  {unclaimed ? (
                    <span className="flex items-center gap-1 text-amber-300 font-extrabold text-[11px] animate-pulse">
                      <Gift className="w-3.5 h-3.5" /> PRIZE READY
                    </span>
                  ) : t.entered ? (
                    <span className="flex items-center gap-1 text-emerald-400 font-extrabold text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {t.userBest !== null ? `BEST ${t.userBest}` : 'REGISTERED'}
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold text-slate-300">{t.entryFee === 0 ? 'FREE ENTRY' : `${t.entryFee} COINS`}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col bg-[#12131d] border border-[#242738] rounded-2xl p-5 shadow-xl" data-testid="cup-details">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">STANDINGS & REWARDS</span>
            <span className="text-xs text-slate-400 font-mono">{timeLabel(selected, now)}</span>
          </div>
          <h2 className="text-lg font-black text-white mb-1">{selected.title}</h2>
          <p className="text-xs text-slate-400 mb-4">{selected.description}</p>

          <div className="p-3 bg-[#0a0b12] rounded-xl border border-[#1e202f] mb-4 space-y-1.5 text-xs">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">PRIZES</span>
            <div className="flex items-center justify-between">
              <span className="text-amber-400 font-black flex items-center gap-1.5">🥇 {Math.round(selected.prizePoolCoins * 0.5).toLocaleString()} coins</span>
              {selected.prizeCosmetic && (
                <span className="font-bold text-cyan-400 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" /> {cosmeticName(selected.prizeCosmetic)}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span>🥈 {Math.round(selected.prizePoolCoins * 0.25).toLocaleString()}</span>
              <span>🥉 {Math.round(selected.prizePoolCoins * 0.12).toLocaleString()}</span>
              <span className="text-slate-500">Top half: {Math.max(40, Math.round(selected.entryFee * 1.5))}</span>
            </div>
          </div>

          {selected.result && !selected.result.claimed && (
            <div className="p-3 mb-4 rounded-xl border border-amber-500/50 bg-amber-950/30 text-center" data-testid="cup-result">
              <div className="text-xs uppercase font-bold text-amber-300 mb-1">Final placement</div>
              <div className="text-2xl font-black text-white mb-1">
                #{selected.result.rank} <span className="text-sm text-slate-400">of {selected.result.total}</span>
              </div>
              <div className="text-xs text-slate-300 mb-3">
                +{selected.result.coins + (selected.result.cosmeticAsCoins ?? 0)} coins
                {selected.result.cosmetic ? ` + ${cosmeticName(selected.result.cosmetic)}` : ''}
              </div>
              <button onClick={handleClaim} className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-sm rounded-lg flex items-center justify-center gap-2">
                <Gift className="w-4 h-4" /> CLAIM PRIZE
              </button>
            </div>
          )}

          <span className="text-[11px] font-bold uppercase text-slate-400 mb-2">
            {status === 'registering' ? 'Bracket opens when the cup starts' : `Live Bracket · ${table.length} posted`}
          </span>
          <div className="space-y-2 mb-5 flex-1 overflow-y-auto max-h-64 pr-1">
            {visibleRows.map((s) => (
              <div
                key={`${s.name}-${s.rank}`}
                className={`flex items-center justify-between p-2 rounded-lg border text-xs ${
                  s.isUser ? 'border-cyan-500/50 bg-cyan-950/20 text-cyan-300 font-bold' : 'border-[#1e202f] bg-[#161826] text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`w-6 font-mono text-center font-black ${s.rank === 1 ? 'text-amber-400' : 'text-slate-500'}`}>#{s.rank}</span>
                  <AvatarView avatar={botRowAvatar(s)} size={28} animate={false} />
                  <span className="truncate max-w-[120px]">{s.name}</span>
                </div>
                <span className="font-mono font-bold text-white">{s.score} PTS</span>
              </div>
            ))}
            {status !== 'registering' && table.length === 0 && <p className="text-xs text-slate-500">No runs posted yet — be the first.</p>}
          </div>

          <button
            onClick={handleAction}
            disabled={actionDisabled}
            data-testid="cup-action"
            className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-extrabold text-sm rounded-xl shadow-lg shadow-cyan-500/20 transition-transform active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:active:scale-100"
          >
            <Trophy className="w-4 h-4" /> {actionLabel}
          </button>
        </div>
      </div>

      {activeGame && <GameModal gameId={activeGame.gameId} mode="tournament" tournamentId={activeGame.id} onClose={() => setActiveGame(null)} />}
    </div>
  );
}
