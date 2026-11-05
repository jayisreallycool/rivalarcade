import { AppError, type ContestKind, type Currency, type Engine } from './engine';

export const int = (v: unknown, name = 'value') => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new AppError(`bad_${name}`);
  return n;
};
export const str = (v: unknown, name = 'value', max = 200) => {
  if (typeof v !== 'string' || !v || v.length > max) throw new AppError(`bad_${name}`);
  return v;
};

export interface DispatchOpts {
  region?: string | null;
  country?: string | null;
  cashEnabled?: boolean;
}

/** Every game call the app makes (shared by the server API and the on-device guest mode). Undefined = not a game call. */
export async function gameDispatch(eng: Engine, uid: string, fn: string, args: Record<string, unknown>, opts: DispatchOpts): Promise<unknown> {
  switch (fn) {
      case 'completeProfile':
        await eng.completeProfile(uid, str(args.username, 'username', 16), str(args.dob, 'dob', 10), args.avatar);
        return ({ ok: true });
      case 'setUsername':
        await eng.setUsername(uid, str(args.username, 'username', 16));
        return ({ ok: true });
      case 'saveAvatar':
        await eng.saveAvatar(uid, args.avatar);
        return ({ ok: true });
      case 'buyItem':
        return ({ coins: await eng.buyItem(uid, str(args.itemId, 'item', 64)) });
      case 'registerDevice':
        return ({ n: await eng.registerDevice(uid, str(args.hash, 'device', 128)) });
      case 'setLimits':
        await eng.setLimits(uid, args.dailyDepositCents == null ? null : int(args.dailyDepositCents, 'limit'), int(args.selfExcludeDays ?? 0, 'days'));
        return ({ ok: true });

      case 'startPractice':
        return (await eng.startPractice(uid, str(args.gameId, 'game', 32)));
      case 'submitPractice':
        return (await eng.submitPractice(uid, str(args.runToken, 'run', 64), int(args.score, 'score'), args.stats));
      case 'joinContest': {
        const currency = (args.currency === 'usd' ? 'usd' : 'coins') as Currency;
        return (await eng.joinContest(uid, str(args.kind, 'kind', 8) as ContestKind, str(args.gameId, 'game', 32), currency, int(args.entry, 'entry'), opts));
      }
      case 'joinCup':
        await eng.joinCup(uid, str(args.contestId, 'contest', 80), opts);
        return ({ ok: true });
      case 'startContestRun':
        return (await eng.startContestRun(uid, str(args.contestId, 'contest', 80)));
      case 'submitContestScore':
        return (await eng.submitContestScore(uid, str(args.runToken, 'run', 64), int(args.score, 'score'), args.stats));
      case 'match':
        return ({ match: await eng.match(uid, str(args.id, 'id', 80)) });
      case 'history':
        return ({ matches: await eng.history(uid) });
      case 'ledger':
        return ({ rows: await eng.ledger(uid) });
      case 'leaderboard':
        return ({ rows: await eng.leaderboard() });
      case 'cups':
        return ({ cups: await eng.cups(uid) });
      case 'claimQuest':
        return (await eng.claimQuest(uid, str(args.questId, 'quest', 40)));
      case 'claimSeason':
        return (await eng.claimSeason(uid, int(args.tier, 'tier'), !!args.vip));
      case 'activateVip':
        await eng.activateVip(uid);
        return ({ ok: true });

    default:
      return undefined;
  }
}
