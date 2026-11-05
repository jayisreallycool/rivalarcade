'use client';

import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import type { AvatarConfig } from '@/lib/avatar-types';
import type { MatchMode, RunStats } from '@/lib/game-types';
import { userStore, usd, timeLeft, useUserStore, type ServerMatch } from '@/lib/user-store';
import { TEST_AUTH } from '@/lib/client/auth';
import { findItem } from '@/lib/cosmetics-catalog';
import AvatarView from '@/components/avatar/AvatarView';
import { sound } from '@/lib/sound';
import { Coins, Zap, Trophy, Crown, RotateCcw, ArrowRight, Hourglass, ShieldAlert } from 'lucide-react';
import type { PracticeResult } from './GameModal';

/** Follow one match record until it settles: Firestore live updates, with polling as backup. */
function useMatch(contestId: string | null) {
  const [m, setM] = useState<ServerMatch | null>(null);
  const uid = useUserStore().session?.uid;
  useEffect(() => {
    if (!contestId || !uid) return;
    let dead = false;
    let off = () => {};
    const poll = async () => {
      try {
        const { match } = await userStore.call<{ match: ServerMatch | null }>('match', { id: contestId });
        if (!dead && match) setM(match);
        if (match?.status === 'settled' || match?.status === 'cancelled') void userStore.refresh();
      } catch {
        /* retry next tick */
      }
    };
    void poll();
    const t = setInterval(poll, TEST_AUTH ? 1500 : 8000);
    if (!TEST_AUTH) {
      void (async () => {
        const { getApps } = await import('firebase/app');
        const { getFirestore, doc, onSnapshot } = await import('firebase/firestore');
        if (dead || !getApps()[0]) return;
        off = onSnapshot(doc(getFirestore(getApps()[0]), 'users', uid, 'matches', contestId), (s) => {
          if (s.exists()) {
            setM(s.data() as ServerMatch);
            if (['settled', 'cancelled'].includes((s.data() as ServerMatch).status)) void userStore.refresh();
          }
        }, () => {});
      })();
    }
    return () => {
      dead = true;
      clearInterval(t);
      off();
    };
  }, [contestId, uid]);
  return m;
}

const money = (m: { currency: 'coins' | 'usd' }, n: number) => (m.currency === 'usd' ? usd(n) : `${n.toLocaleString()} coins`);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

function Stat({ icon, label, value, tone = 'text-white', testid }: { icon: React.ReactNode; label: string; value: string; tone?: string; testid?: string }) {
  return (
    <div className="flex flex-col items-center p-3 bg-[#181a27] rounded-xl border border-[#242738]">
      {icon}
      <span className="text-[10px] uppercase text-slate-400 mt-1">{label}</span>
      <span className={`text-sm font-black ${tone}`} data-testid={testid}>
        {value}
      </span>
    </div>
  );
}

function Breakdown({ rows, total }: { rows?: RunStats['breakdown']; total: number }) {
  if (!rows?.length) return null;
  return (
    <div className="w-full mt-3 rounded-xl bg-[#0a0b12] border border-[#1e202f] p-3 text-xs" data-testid="score-breakdown">
      <div className="text-[10px] font-black tracking-widest text-slate-500 mb-1.5">SCORE BREAKDOWN</div>
      {rows.map((b) => (
        <div key={b.label} className="flex items-center justify-between py-0.5">
          <span className="text-slate-400">{b.label}</span>
          <span className="font-mono font-bold tabular-nums text-white">
            {b.points > 0 ? '+' : ''}
            {b.points.toLocaleString()}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-[#1e202f]">
        <span className="text-slate-300 font-bold">Total</span>
        <span className="font-mono font-black text-cyan-300 tabular-nums">{total.toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function ResultScreen(props: {
  gameName: string;
  mode: MatchMode;
  practice: PracticeResult | null;
  contest: { contestId: string; score: number; flagged: string | null; breakdown?: RunStats['breakdown'] } | null;
  avatar: AvatarConfig;
  username: string;
  best: number;
  onAgain: () => void;
  onClose: () => void;
}) {
  const { gameName, mode, practice, contest, avatar, username, best, onAgain, onClose } = props;
  const m = useMatch(contest?.contestId ?? null);
  const settled = m?.status === 'settled';
  const cancelled = m?.status === 'cancelled';
  const tie = settled && m.kind === 'h2h' && m.opponents[0]?.score === m.score;
  const won = settled && !tie && m.rank === 1;
  const inMoney = settled && m.payout > 0;
  const celebrated = useRef(false);

  useEffect(() => {
    if (celebrated.current || !(won || (inMoney && m?.kind !== 'h2h'))) return;
    celebrated.current = true;
    sound.playWin();
    try {
      confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 }, colors: ['#00f0ff', '#ffb800', '#ff0055', '#10b981'] });
    } catch {
      /* cosmetic */
    }
  }, [won, inMoney, m?.kind]);

  const flagged = practice?.flagged ?? contest?.flagged ?? null;
  const score = practice?.score ?? contest?.score ?? 0;
  const header = practice
    ? { text: 'PRACTICE COMPLETE', cls: 'bg-slate-800 text-slate-200' }
    : !m || (!settled && !cancelled)
      ? { text: mode === 'tournament' ? 'RUN SUBMITTED' : 'SCORE LOCKED IN', cls: 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white' }
      : cancelled
        ? { text: 'NO OPPONENT · REFUNDED', cls: 'bg-slate-700 text-white' }
        : tie
          ? { text: 'MATCH TIED', cls: 'bg-slate-700 text-white' }
          : m.kind === 'h2h'
            ? won
              ? { text: '🏆 VICTORY!', cls: 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-black' }
              : { text: 'DEFEAT', cls: 'bg-gradient-to-r from-red-600 to-rose-700 text-white' }
            : { text: `${ordinal(m.rank ?? m.size)} PLACE${inMoney ? ' · IN THE MONEY' : ''}`, cls: inMoney ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-black' : 'bg-gradient-to-r from-red-600 to-rose-700 text-white' };

  const opp = m?.opponents.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
  const net = m ? m.payout - m.entry : 0;

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(ellipse_at_top,#172040_0%,#06070d_65%)] flex items-start sm:items-center justify-center px-4 py-8" data-testid="match-results">
      <div className="w-full max-w-sm rounded-3xl overflow-hidden bg-[#10111c] border border-[#23263a] shadow-2xl">
        <div className={`py-4 text-center text-lg font-black tracking-wide ${header.cls}`} data-testid="result-headline">
          {header.text}
        </div>
        <div className="p-5 flex flex-col items-center">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-4 text-center">
            {gameName} · {mode === 'practice' ? 'Solo Practice' : mode === 'duel' ? '1v1 Head-to-Head' : mode === 'arena' ? 'Live Arena' : (m?.title ?? 'Cup')}
          </div>

          {flagged && flagged !== null && (
            <p className="w-full flex gap-2 items-start text-xs text-amber-200 bg-amber-950/40 border border-amber-700/40 rounded-lg px-3 py-2 mb-3" data-testid="run-flagged">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              {flagged.startsWith('review:') ? 'This score is unusually high, so it’s being reviewed before any prize is paid.' : 'This run didn’t pass our fair-play checks and scored 0.'}
            </p>
          )}

          <div className="flex items-end justify-center gap-6 w-full">
            <div className="flex flex-col items-center text-center">
              <AvatarView avatar={avatar} size={92} action={won ? 'celebrate' : 'idle'} animate />
              <span className="font-bold text-sm text-cyan-400 mt-1">{username}</span>
              <div className="text-3xl font-black text-white mt-1 tabular-nums" data-testid="your-score">
                {score.toLocaleString()}
              </div>
            </div>
            {m && m.kind === 'h2h' && (
              <>
                <span className="text-xs font-black text-slate-500 tracking-widest italic pb-10">VS</span>
                <div className="flex flex-col items-center text-center">
                  {settled && opp ? (
                    <>
                      <AvatarView avatar={opp.avatar ?? avatar} size={92} action={!won && !tie ? 'celebrate' : 'idle'} animate />
                      <span className="font-bold text-sm text-slate-300 mt-1" data-testid="opponent-name">
                        {opp.username}
                      </span>
                      <div className="text-3xl font-black text-slate-300 mt-1 tabular-nums">{(opp.score ?? 0).toLocaleString()}</div>
                    </>
                  ) : (
                    <>
                      <div className="w-[92px] h-[92px] rounded-full bg-white/5 border border-dashed border-white/15 flex items-center justify-center">
                        <Hourglass className="w-8 h-8 text-slate-500 animate-pulse" />
                      </div>
                      <span className="font-bold text-sm text-slate-400 mt-1">{cancelled ? 'No opponent' : 'Rival'}</span>
                      <div className="text-3xl font-black text-slate-600 mt-1">?</div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {m && !settled && !cancelled && (
            <div className="w-full mt-4 rounded-xl bg-cyan-500/10 border border-cyan-400/20 p-3 text-center" data-testid="waiting-opponent">
              <p className="text-sm font-bold text-cyan-100">{m.kind === 'cup' ? 'Results are final when the cup closes.' : m.kind === 'h2h' ? 'Waiting for your rival to play…' : 'Waiting for the arena to finish…'}</p>
              <p className="text-[11px] text-slate-400 mt-1">You can leave — it settles automatically{m.closesAt ? ` (within ${timeLeft(m.closesAt)})` : ''}. Find it in History.</p>
            </div>
          )}

          {settled && m.kind !== 'h2h' && (
            <div className="w-full mt-3 rounded-xl bg-[#0a0b12] border border-[#1e202f] p-2" data-testid="field-results">
              {[{ uid: 'you', username: `${username} (you)`, score: m.score, rank: m.rank }, ...m.opponents]
                .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                .map((r) => (
                  <div key={r.uid} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${r.uid === 'you' ? 'bg-cyan-500/15 text-cyan-200 font-black' : 'text-slate-300'}`}>
                    <span className={`w-6 text-center font-black ${(r.rank ?? 9) <= 3 ? 'text-amber-400' : 'text-slate-600'}`}>{r.rank}</span>
                    <span className="flex-1 truncate">{r.username}</span>
                    <span className="font-mono tabular-nums">{(r.score ?? 0).toLocaleString()}</span>
                  </div>
                ))}
            </div>
          )}

          {settled && m.prizeItem && (
            <p className="mt-3 text-sm font-black text-amber-300 text-center" data-testid="prize-item">
              🎁 You won {findItem(m.prizeItem)?.name ?? 'a cup prize'}!
            </p>
          )}

          <Breakdown rows={practice?.breakdown ?? contest?.breakdown} total={score} />

          <div className="w-full grid grid-cols-3 gap-2 my-4">
            {practice ? (
              <>
                <Stat icon={<Coins className="w-4 h-4 text-amber-400" />} label="Coins" value={`+${practice.coins}`} tone="text-amber-400" testid="coins-delta" />
                <Stat icon={<Zap className="w-4 h-4 text-cyan-400" />} label="Season XP" value={`+${practice.xp}`} tone="text-cyan-400" />
                <Stat icon={<Trophy className="w-4 h-4 text-amber-400" />} label="Best" value={String(Math.max(score, best))} />
              </>
            ) : (
              <>
                <Stat
                  icon={m?.kind === 'h2h' ? <Trophy className="w-4 h-4 text-amber-400" /> : <Crown className="w-4 h-4 text-amber-400" />}
                  label={m?.kind === 'h2h' ? 'Skill Rating' : 'Crowns'}
                  value={!settled ? '…' : m.kind === 'h2h' ? (m.ratingDelta > 0 ? `+${m.ratingDelta}` : String(m.ratingDelta)) : `+${m.crowns}`}
                  tone={settled && (m.kind === 'h2h' ? m.ratingDelta : m.crowns) > 0 ? 'text-emerald-400' : settled && m.ratingDelta < 0 ? 'text-rose-400' : 'text-slate-300'}
                  testid="rating-delta"
                />
                <Stat
                  icon={<Coins className="w-4 h-4 text-amber-400" />}
                  label={m?.currency === 'usd' ? 'Cash' : 'Coins'}
                  value={!m || (!settled && !cancelled) ? '…' : cancelled ? 'Refunded' : m.entry > 0 ? `${net >= 0 ? '+' : '−'}${money(m, Math.abs(net)).replace(' coins', '')}` : `+${m.payout}`}
                  tone={settled && net < 0 && m.entry > 0 ? 'text-rose-400' : 'text-amber-400'}
                  testid="coins-delta"
                />
                <Stat icon={<Zap className="w-4 h-4 text-cyan-400" />} label="Season XP" value={m ? `+${m.xp + (won ? 60 : 0)}` : '…'} tone="text-cyan-400" />
              </>
            )}
          </div>

          <div className="w-full flex items-center gap-3">
            <button onClick={onAgain} className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#1e202f] text-slate-200 font-bold text-sm rounded-xl border border-[#32364e] active:scale-95" data-testid="play-again">
              <RotateCcw className="w-4 h-4 text-amber-400" /> {mode === 'tournament' ? 'Back to cups' : mode === 'practice' ? 'Play again' : 'New match'}
            </button>
            <button onClick={onClose} className="flex-1 flex items-center justify-center gap-2 py-3 bg-cyan-500 text-black font-extrabold text-sm rounded-xl active:scale-95" data-testid="results-continue">
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

