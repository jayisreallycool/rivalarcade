'use client';

import React, { useEffect, useState } from 'react';
import { userStore, useUserStore, usd, errorText } from '@/lib/user-store';
import { ShieldCheck, Banknote, ArrowDownToLine, ArrowUpFromLine, IdCard, PauseCircle, Coins, Loader2, CheckCircle2 } from 'lucide-react';

interface LedgerRow {
  currency: 'coins' | 'usd';
  amount: number;
  balanceAfter: number;
  kind: string;
  ref: string;
  at: number;
}

const KIND: Record<string, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  withdrawal_reversal: 'Withdrawal returned',
  entry: 'Match entry',
  prize: 'Prize',
  refund: 'Refund',
  reward: 'Reward',
  purchase: 'Purchase',
  signup_bonus: 'Welcome bonus',
};

/** Cash balance, deposits (Stripe Checkout), ID check, payouts, history and play limits. */
export default function WalletView() {
  const s = useUserStore();
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [amount, setAmount] = useState(2000);
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [limit, setLimit] = useState('');

  const load = () =>
    userStore
      .call<{ rows: LedgerRow[] }>('ledger')
      .then((r) => setRows(r.rows))
      .catch(() => setRows([]));
  useEffect(() => {
    void load();
  }, [s.cashCents, s.stats.coins]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const a = s.account;
  const cashOn = s.cash.mode !== 'off';
  const card = 'rounded-2xl bg-[#12131d] border border-[#242738] p-4';
  const btn = 'h-11 px-4 rounded-xl font-black text-sm flex items-center justify-center gap-2 disabled:opacity-40';
  const excluded = a.selfExcludedUntil && a.selfExcludedUntil > Date.now();

  return (
    <div className="w-full max-w-3xl mx-auto p-4 space-y-4" data-testid="wallet">
      <div className="grid grid-cols-2 gap-3">
        <div className={`${card} bg-gradient-to-br from-emerald-500/15 to-transparent`}>
          <div className="text-[10px] font-black tracking-widest text-emerald-300">CASH</div>
          <div className="text-3xl font-black text-white tabular-nums mt-1" data-testid="cash-balance">
            {usd(s.cashCents)}
          </div>
          <div className="text-[10px] text-white/40 mt-1">{s.cash.mode === 'test' ? 'Test mode — no real money moves' : 'Withdrawable after ID check'}</div>
        </div>
        <div className={`${card} bg-gradient-to-br from-amber-500/15 to-transparent`}>
          <div className="text-[10px] font-black tracking-widest text-amber-300">RIVAL COINS</div>
          <div className="text-3xl font-black text-white tabular-nums mt-1 flex items-center gap-2">
            <Coins className="w-6 h-6 text-amber-400" /> {s.stats.coins.toLocaleString()}
          </div>
          <div className="text-[10px] text-white/40 mt-1">Virtual · no cash value</div>
        </div>
      </div>

      {msg && (
        <p role="status" className={`text-sm font-bold text-center rounded-xl px-3 py-2 ${msg.ok ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200'}`} data-testid="wallet-msg">
          {msg.text}
        </p>
      )}

      {!cashOn ? (
        <div className={card}>
          <p className="text-sm text-white font-bold">Cash games are coming soon.</p>
          <p className="text-xs text-slate-400 mt-1">Play for Rival Coins in 1v1s, arenas and cups in the meantime.</p>
        </div>
      ) : !s.cash.allowed || !a.adult ? (
        <div className={card} data-testid="cash-unavailable">
          <p className="text-sm text-white font-bold">{!a.adult ? 'Cash games are 18+.' : 'Cash games aren’t available where you are.'}</p>
          <p className="text-xs text-slate-400 mt-1">{!a.adult ? 'You can keep playing for Rival Coins.' : `Paid contests are restricted in some states${s.cash.region ? ` (detected: ${s.cash.region.replace('US-', '')})` : ''}. Coins play is open everywhere.`}</p>
        </div>
      ) : (
        <>
          <div className={card}>
            <div className="flex items-center gap-2 text-white font-black mb-3">
              <ArrowDownToLine className="w-4 h-4 text-emerald-300" /> Add cash
            </div>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[500, 1000, 2000, 5000].map((c) => (
                <button key={c} onClick={() => setAmount(c)} className={`h-11 rounded-xl text-sm font-black border ${amount === c ? 'bg-emerald-400 text-black border-emerald-300' : 'bg-white/5 text-white border-white/10'}`}>
                  {usd(c)}
                </button>
              ))}
            </div>
            <button disabled={!!busy || !!excluded} onClick={() => run('deposit', () => userStore.openUrl('deposit', { cents: amount }))} className={`${btn} w-full bg-emerald-400 text-black`} data-testid="deposit">
              {busy === 'deposit' && <Loader2 className="w-4 h-4 animate-spin" />} Deposit {usd(amount)} with card
            </button>
            <p className="text-[10px] text-white/35 mt-2 text-center">Secure checkout by Stripe. Daily limit {usd(Math.min(50000, a.depositLimitCents ?? 50000))}.</p>
          </div>

          <div className={card}>
            <div className="flex items-center gap-2 text-white font-black mb-3">
              <ArrowUpFromLine className="w-4 h-4 text-cyan-300" /> Withdraw
            </div>
            <div className="space-y-2 mb-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-300">
                  <IdCard className="w-4 h-4" /> ID verification
                </span>
                {a.kycStatus === 'verified' ? (
                  <span className="text-emerald-300 font-black flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> Verified
                  </span>
                ) : (
                  <button disabled={!!busy} onClick={() => run('kyc', () => userStore.openUrl('kycStart'))} className="text-cyan-300 font-black text-xs" data-testid="kyc-start">
                    {a.kycStatus === 'pending' ? 'Pending · retry' : a.kycStatus === 'rejected' ? 'Try again' : 'Verify ID'}
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-300">
                  <Banknote className="w-4 h-4" /> Payout account
                </span>
                {a.payoutsEnabled ? (
                  <span className="text-emerald-300 font-black flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> Ready
                  </span>
                ) : (
                  <button disabled={!!busy} onClick={() => run('payouts', () => userStore.openUrl('payoutsOnboard'))} className="text-cyan-300 font-black text-xs" data-testid="payouts-setup">
                    Set up
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center h-11 rounded-xl bg-white/5 border border-white/10 px-3">
                <span className="text-white/50 font-bold">$</span>
                <input value={out} onChange={(e) => setOut(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))} inputMode="decimal" placeholder="0.00" className="flex-1 bg-transparent outline-none text-white font-bold px-1" aria-label="Withdraw amount" />
              </div>
              <button
                disabled={!!busy || a.kycStatus !== 'verified' || !a.payoutsEnabled || a.underReview}
                onClick={() => {
                  const cents = Math.round(parseFloat(out || '0') * 100);
                  void run('withdraw', () => userStore.withdraw(cents), `Sent ${usd(cents)} to your payout account.`).then(() => setOut(''));
                }}
                className={`${btn} bg-cyan-400 text-black`}
                data-testid="withdraw"
              >
                {busy === 'withdraw' && <Loader2 className="w-4 h-4 animate-spin" />} Withdraw
              </button>
            </div>
            <p className="text-[10px] text-white/35 mt-2">Minimum {usd(s.cash.minWithdrawalCents)}. {a.underReview ? 'Your account is under review — withdrawals are paused.' : 'Paid to your bank by Stripe, usually in 2–3 business days.'}</p>
          </div>
        </>
      )}

      <div className={card}>
        <div className="flex items-center gap-2 text-white font-black mb-2">
          <ShieldCheck className="w-4 h-4 text-amber-300" /> Play limits
        </div>
        {excluded ? (
          <p className="text-sm text-amber-200" data-testid="excluded">
            Paid play is paused until {new Date(a.selfExcludedUntil!).toLocaleDateString()}.
          </p>
        ) : (
          <>
            <div className="flex gap-2 mb-2">
              <div className="flex-1 flex items-center h-11 rounded-xl bg-white/5 border border-white/10 px-3">
                <span className="text-white/50 font-bold">$</span>
                <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder={a.depositLimitCents != null ? String(a.depositLimitCents / 100) : 'Daily deposit limit'} className="flex-1 bg-transparent outline-none text-white font-bold px-1" aria-label="Daily deposit limit" />
              </div>
              <button disabled={!limit || !!busy} onClick={() => run('limit', () => userStore.setLimits(Number(limit) * 100, 0), 'Deposit limit saved.').then(() => setLimit(''))} className={`${btn} bg-white/10 text-white`}>
                Set limit
              </button>
            </div>
            <button disabled={!!busy} onClick={() => run('pause', () => userStore.setLimits(null, 7), 'Paid play paused for 7 days.')} className="text-xs font-bold text-amber-300 flex items-center gap-1" data-testid="self-exclude">
              <PauseCircle className="w-4 h-4" /> Take a 7-day break from paid play
            </button>
            <p className="text-[10px] text-white/35 mt-2">Limits can be lowered any time. Need help? Call 1-800-GAMBLER.</p>
          </>
        )}
      </div>

      <div className={card}>
        <div className="text-white font-black mb-2">History</div>
        {rows === null ? (
          <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-500">No transactions yet.</p>
        ) : (
          <div className="divide-y divide-white/5" data-testid="ledger">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="text-slate-200 font-bold">{KIND[r.kind] ?? r.kind}</div>
                  <div className="text-[10px] text-slate-500">{new Date(r.at).toLocaleString()}</div>
                </div>
                <div className={`font-mono font-black tabular-nums ${r.amount >= 0 ? 'text-emerald-300' : 'text-slate-300'}`}>
                  {r.amount >= 0 ? '+' : '−'}
                  {r.currency === 'usd' ? usd(Math.abs(r.amount)) : `${Math.abs(r.amount).toLocaleString()} coins`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
