// Extra end-to-end checks: save migration, quest claim, tournament win. Same setup as e2e.cjs.
const { chromium } = require('playwright');
const KEY = 'rival_arcade_user_state_v3';
const ok = (c, m) => { if (!c) throw new Error(m); };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const errs = [];
  const fresh = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); return [c, p]; };
  const st = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);

  // 1. Legacy v2 save migrates
  {
    const [c, p] = await fresh();
    await p.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.clear();
      localStorage.setItem('rival_arcade_user_state_v2', JSON.stringify({
        username: 'OldTimer', avatar: { hairStyleId: 'hair_afro_puff' }, inventory: ['hair_afro_puff', 'shirt_starter_jersey'],
        stats: { coins: 4321, rating: 1650, wins: 40, losses: 10, xp: 900 },
        quests: [{ id: 'q1', title: 'Warmup Lap', progress: 0, target: 1000, completed: false, claimed: false }],
        matchHistory: [{ id: 'old', gameId: 'neon-dash', gameName: 'Neon Dash', mode: 'duel', date: '10 mins ago', playerScore: 1, opponentScore: 0, opponentName: 'X', opponentAvatar: {}, result: 'win', ratingDelta: 5, coinsEarned: 1 }],
        seasonXp: 500, seasonTier: 1, isVip: false, claimedFreeTiers: [1], claimedVipTiers: [],
      }));
    });
    await p.goto((process.env.APP_URL || 'http://localhost:3000')); await p.waitForTimeout(1200);
    const s = await st(p);
    ok(s.version === 3 && s.username === 'OldTimer' && s.stats.coins === 4321, 'core fields lost');
    ok(s.stats.tier === 'Diamond' && s.stats.level === 4 && s.seasonTier === 3, `derived fields wrong ${s.stats.tier} ${s.stats.level} ${s.seasonTier}`);
    ok(s.avatar.hairStyleId === 'hair_afro_puff' && s.avatar.shirtId, 'avatar not merged with defaults');
    ok(s.quests.length === 4 && s.quests[0].id !== 'q1', 'old quests not replaced');
    ok(s.tournaments.length === 4, 'tournaments not created');
    await p.locator('nav button', { hasText: 'Profile' }).click();
    ok(await p.getByText('OldTimer').first().isVisible(), 'name not shown');
    console.log('  ✓ legacy v2 save migrates (name, coins, rating tier, avatar, new quests, cups)');
    await c.close();
  }

  // 2. Completed quest can be claimed in the UI
  {
    const [c, p] = await fresh();
    await p.goto((process.env.APP_URL || 'http://localhost:3000')); await p.waitForTimeout(800);
    await p.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); s.quests[0].progress = s.quests[0].target; s.quests[0].completed = true; localStorage.setItem(k, JSON.stringify(s)); }, KEY);
    await p.reload(); await p.waitForTimeout(800);
    const before = await st(p); const q = before.quests[0];
    await p.locator('nav button', { hasText: 'Profile' }).click();
    await p.locator(`[data-testid="claim-${q.id}"]`).click(); await p.waitForTimeout(300);
    const after = await st(p);
    ok(after.stats.coins === before.stats.coins + q.rewardCoins && after.seasonXp === before.seasonXp + q.rewardXp && after.quests[0].claimed, 'quest reward wrong');
    ok(!(await p.locator(`[data-testid="claim-${q.id}"]`).count()), 'claim button still shown');
    console.log(`  ✓ completed quest claimed (+${q.rewardCoins} coins, +${q.rewardXp} XP)`);
    await c.close();
  }

  // 3. Winning a cup pays 50% of the pool + exclusive cosmetic + win counter
  {
    const [c, p] = await fresh();
    await p.clock.install({ time: new Date() });
    await p.goto((process.env.APP_URL || 'http://localhost:3000')); await p.waitForTimeout(800);
    const cup = await p.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); const t = s.tournaments.find((x) => x.templateId === 'gem-flash'); t.entered = true; t.userBest = 10_000_000; t.attempts = 1; localStorage.setItem(k, JSON.stringify(s)); return t; }, KEY);
    await p.reload(); await p.waitForTimeout(800);
    const before = await st(p);
    await p.clock.fastForward(cup.endsAt - Date.now() + 5000);
    await p.locator('nav button', { hasText: 'Leagues' }).click();
    await p.locator('[data-testid="cup-gem-flash"]').click();
    await p.locator('[data-testid="cup-result"]').waitFor({ timeout: 8000 });
    const card = await p.locator('[data-testid="cup-result"]').innerText();
    ok(/#1/.test(card), card);
    await p.locator('[data-testid="cup-result"] button').click(); await p.waitForTimeout(500);
    const after = await st(p);
    ok(after.stats.coins - before.stats.coins === Math.round(cup.prizePoolCoins * 0.5), `paid ${after.stats.coins - before.stats.coins}`);
    ok(after.inventory.includes(cup.prizeCosmetic), 'prize cosmetic missing');
    ok(after.stats.tournamentsWon === before.stats.tournamentsWon + 1 && after.stats.trophies === before.stats.trophies + 50, 'win not counted');
    console.log(`  ✓ cup win pays ${Math.round(cup.prizePoolCoins * 0.5)} coins + ${cup.prizeCosmetic} + win/trophies`);
    await c.close();
  }
  console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'no page errors');
  await b.close();
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
