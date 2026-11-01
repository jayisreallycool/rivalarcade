// End-to-end browser test. Start the app first (npm run build && npm start), then: npm run test:e2e
// Needs Playwright with Chromium available (npx playwright install chromium).
// End-to-end test of RivalArcade. node e2e.js <outdir> [port]
const { chromium } = require('playwright');
const S = process.argv[2] || 'tests/artifacts';
require('fs').mkdirSync(S, { recursive: true });
const URL = process.env.APP_URL || `http://localhost:${process.argv[3] || 3000}`;
const GL = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const KEY = 'rival_arcade_user_state_v3';

const results = [];
const consoleErrors = [];
async function step(name, fn, page) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message.split('\n')[0] });
    console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
    if (page) await page.screenshot({ path: `${S}/fail-${name.replace(/\W+/g, '_')}.png` }).catch(() => {});
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const state = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const watch = (page, label) => {
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] PAGEERROR ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/GL Driver Message|GPU stall|React DevTools/.test(t)) return;
    consoleErrors.push(`[${label}] ${t.slice(0, 200)}`);
  });
};
// Old tab names → new Triumph-style bottom bar (+ segment inside the page).
const NAV_MAP = { Games: ['Play'], Arena: ['Leagues', 'cups'], Rankings: ['Leagues', 'rankings'], Wardrobe: ['Profile', 'wardrobe'], Pass: ['Rewards'], Profile: ['Profile', 'profile'], Results: ['Results'] };
const nav = async (page, label) => {
  const [tab, seg] = NAV_MAP[label] ?? [label];
  await page.locator('nav button', { hasText: tab }).click();
  if (seg) await page.locator(`[data-testid="seg-${seg}"]`).click();
};
async function waitResults(page, timeout = 150000) {
  // Steer randomly so runner games end naturally; timed games just run out.
  const keys = ['ArrowLeft', 'ArrowRight'];
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.locator('[data-testid="results-modal"]').count()) return;
    await page.keyboard.press(keys[Math.floor(Math.random() * 2)]).catch(() => {});
    await page.waitForTimeout(600);
  }
  throw new Error('results modal never appeared');
}

(async () => {
  const browser = await chromium.launch({ args: GL });

  // ------------------------------------------------------------ desktop main flow
  console.log('\nDESKTOP 1280×900');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Software-rendered CI browsers are slow; the low tier keeps game time close to real time.
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('ra.quality')) localStorage.setItem('ra.quality', 'low');
    } catch {}
  });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.clock.install({ time: new Date() });
  await page.goto(URL);
  await page.waitForTimeout(1200);

  await step('fresh account loads with starter state', async () => {
    const st = await state(page);
    expect(st && st.stats.coins === 850, `coins ${st?.stats.coins}`);
    expect(st.quests.length === 4, `quests ${st.quests.length}`);
    expect(st.tournaments.length === 4, `tournaments ${st.tournaments.length}`);
    expect(await page.locator('[data-testid="hdr-crowns"]').isVisible() && await page.locator('[data-testid="tile-brick-blitz"]').isVisible(), 'lobby missing');
  }, page);

  await step('every tab renders', async () => {
    const checks = [
      ['Arena', 'ARENA TOURNAMENTS'],
      ['Wardrobe', 'LIVE PREVIEW'],
      ['Rankings', 'GLOBAL RANKINGS'],
      ['Pass', 'RIVAL PASS PROGRESSION'],
      ['Profile', 'PERSONAL HIGH SCORES'],
      ['Results', 'Best streak'],
      ['Games', 'Popular'],
    ];
    for (const [tab, text] of checks) {
      await nav(page, tab);
      await page.getByText(text).first().waitFor({ timeout: 5000 });
    }
  }, page);

  await step('practice run → results → rewards recorded', async () => {
    const before = await state(page);
    await page.locator('[data-testid="tile-neon-dash"]').click();
    await page.locator('[data-testid="mode-practice"]').click();
    await page.locator('[data-testid="game-modal"] button:has-text("TAP TO PLAY")').waitFor({ timeout: 15000 });
    expect(!(await page.locator('[data-testid="rival-bar"]').count()), 'practice should have no rival bar');
    await page.locator('[data-testid="game-modal"] button:has-text("TAP TO PLAY")').click();
    await waitResults(page);
    const header = await page.locator('[data-testid="results-header"]').innerText();
    expect(/PRACTICE/.test(header), header);
    const after = await state(page);
    expect(after.stats.coins > before.stats.coins, 'no coins awarded');
    expect(after.matchHistory[0].mode === 'practice' && after.matchHistory[0].at > 0, 'history not recorded');
    expect((after.recentScores['neon-dash'] || []).length === 1, 'recent score not tracked');
  }, page);

  await step('Play Again remounts a fresh game', async () => {
    await page.locator('[data-testid="results-modal"] button:has-text("Play Again")').click();
    await page.locator('[data-testid="game-modal"] button:has-text("TAP TO PLAY")').waitFor({ timeout: 8000 });
    expect(!(await page.locator('[data-testid="results-modal"]').count()), 'results still shown');
    await page.locator('button[aria-label="Close match"]').click();
    expect(!(await page.locator('[data-testid="game-modal"]').count()), 'modal did not close');
  }, page);

  await step('ranked duel: matchmaking, rival bar, seeded match, Elo applied', async () => {
    const before = await state(page);
    await page.locator('[data-testid="tile-neon-dash"]').click();
    await page.locator('[data-testid="stake-0"]').click();
    await page.locator('[data-testid="mode-duel"]').click();
    await page.getByText('FINDING YOUR RIVAL').waitFor();
    await page.locator('[data-testid="vs-card"]').waitFor({ timeout: 25000 });
    expect(await page.locator('[data-testid="rival-bar"]').isVisible(), 'rival bar missing');
    expect(/SEED [0-9A-F]{4}-[0-9A-F]{4}/.test(await page.locator('[data-testid="game-modal"]').innerText()), 'seed code missing');
    await page.locator('[data-testid="game-modal"] button:has-text("TAP TO PLAY")').click();
    await waitResults(page);
    const header = await page.locator('[data-testid="results-header"]').innerText();
    const after = await state(page);
    const delta = after.stats.rating - before.stats.rating;
    expect(/VICTORY|DEFEAT|TIED/.test(header), header);
    if (/VICTORY/.test(header)) expect(delta > 0 && after.stats.wins === before.stats.wins + 1, `win delta ${delta}`);
    if (/DEFEAT/.test(header)) expect(delta < 0 && after.stats.losses === before.stats.losses + 1 && after.stats.streak === 0, `loss delta ${delta}`);
    expect(after.stats.totalMatches === before.stats.totalMatches + 1, 'match count');
    const shown = await page.locator('[data-testid="rating-delta"]').innerText();
    expect(Number(shown.replace('+', '')) === delta, `UI delta ${shown} vs ${delta}`);
    console.log(`      (${header.trim()}, rating ${before.stats.rating} → ${after.stats.rating})`);
  }, page);

  await step('New Duel finds a new opponent', async () => {
    await page.locator('[data-testid="results-modal"] button:has-text("New Duel")').click();
    await page.getByText('FINDING YOUR RIVAL').waitFor({ timeout: 5000 });
    await page.locator('[data-testid="vs-card"]').waitFor({ timeout: 25000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(!(await page.locator('[data-testid="game-modal"]').count()), 'Esc did not close');
  }, page);

  await step('tournament: free entry, run submitted, ranked in bracket', async () => {
    await nav(page, 'Arena');
    await page.locator('[data-testid="cup-neon-gp"]').click();
    const action = page.locator('[data-testid="cup-action"]');
    expect(/ENTER & PLAY · FREE/.test(await action.innerText()), await action.innerText());
    await action.click();
    await page.locator('[data-testid="game-modal"] button:has-text("TAP TO PLAY")').waitFor({ timeout: 15000 });
    expect(await page.locator('[data-testid="rival-bar"]').isVisible(), 'tournament rival bar missing');
    await page.locator('[data-testid="game-modal"] button:has-text("TAP TO PLAY")').click();
    await waitResults(page);
    const header = await page.locator('[data-testid="results-header"]').innerText();
    expect(/RANK #\d+/.test(header), header);
    await page.locator('[data-testid="results-modal"] button:has-text("Continue")').click();
    await page.waitForTimeout(500);
    const st = await state(page);
    const t = st.tournaments.find((x) => x.templateId === 'neon-gp');
    expect(t.entered && t.userBest !== null && t.attempts === 1, JSON.stringify({ e: t.entered, b: t.userBest, a: t.attempts }));
    expect(await page.locator('[data-testid="cup-details"]').getByText('(You)').count(), 'user not in bracket');
    expect(/PLAY ANOTHER RUN/.test(await action.innerText()), 'action should offer another run');
  }, page);

  await step('tournament: paid entry deducts coins once', async () => {
    const before = (await state(page)).stats.coins;
    await page.locator('[data-testid="cup-dunk-shootout"]').click();
    await page.locator('[data-testid="cup-action"]').click();
    await page.waitForTimeout(500);
    const after = (await state(page)).stats.coins;
    expect(before - after === 100, `deducted ${before - after}`);
    if (await page.locator('[data-testid="game-modal"]').count()) await page.locator('button[aria-label="Close match"]').click();
    await page.locator('[data-testid="cup-action"]').click(); // second click = play, not pay again
    await page.waitForTimeout(400);
    if (await page.locator('[data-testid="game-modal"]').count()) await page.locator('button[aria-label="Close match"]').click();
    expect((await state(page)).stats.coins === after, 'charged twice');
  }, page);

  await step('tournament: registering cup cannot be played yet', async () => {
    await page.locator('[data-testid="cup-reflex-major"]').click();
    const action = page.locator('[data-testid="cup-action"]');
    expect(/REGISTER/.test(await action.innerText()), await action.innerText());
    await action.click();
    await page.waitForTimeout(300);
    expect(/REGISTERED · STARTS IN/.test(await action.innerText()), await action.innerText());
    expect(await action.isDisabled(), 'should be disabled until start');
    expect(!(await page.locator('[data-testid="game-modal"]').count()), 'game opened before start');
  }, page);

  await step('tournament: cup closes → settles → prize claimed → next cup scheduled', async () => {
    const before = await state(page);
    const cup = before.tournaments.find((x) => x.templateId === 'neon-gp');
    await page.clock.fastForward(Math.ceil((cup.endsAt - Date.now()) / 1000 + 5) * 1000);
    await page.locator('[data-testid="cup-neon-gp"]').click();
    await page.locator('[data-testid="cup-result"]').waitFor({ timeout: 8000 });
    const settled = (await state(page)).tournaments.find((x) => x.id === cup.id).result;
    expect(settled && !settled.claimed, 'not settled');
    await page.locator('[data-testid="cup-result"] button:has-text("CLAIM PRIZE")').click();
    await page.waitForTimeout(600);
    const after = await state(page);
    const gained = after.stats.coins - before.stats.coins;
    expect(gained === settled.coins + (settled.cosmeticAsCoins || 0), `gained ${gained} expected ${settled.coins}`);
    const next = after.tournaments.find((x) => x.templateId === 'neon-gp');
    expect(next.id !== cup.id && !next.entered, 'next cup not scheduled');
    if (settled.rank === 1) expect(after.stats.tournamentsWon === before.stats.tournamentsWon + 1, 'win not counted');
    console.log(`      (placed #${settled.rank}/${settled.total}, +${gained} coins)`);
  }, page);

  await step('wardrobe: equip owned, locked preview not saved, unlock purchase', async () => {
    await nav(page, 'Wardrobe');
    await page.getByRole('button', { name: 'Tops' }).click();
    const lockedCard = page.locator('div.cursor-pointer', { has: page.locator('button:has-text("UNLOCK")') }).first();
    const before = await state(page);
    await lockedCard.click();
    await page.locator('[data-testid="locked-preview-note"]').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: /SAVE APPEARANCE/ }).click();
    await page.waitForTimeout(300);
    const afterSave = await state(page);
    expect(afterSave.avatar.shirtId === before.avatar.shirtId, `locked shirt saved: ${afterSave.avatar.shirtId}`);
    const owned = page.locator('div.cursor-pointer', { hasText: 'Click to Equip' }).first();
    if (await owned.count()) {
      await owned.click();
      await page.getByText(/Equipped /).first().waitFor({ timeout: 3000 });
    }
    // Buy the cheapest locked item we can afford
    const coins = afterSave.stats.coins;
    const cards = page.locator('div.cursor-pointer', { has: page.locator('button:has-text("UNLOCK")') });
    let bought = false;
    for (let i = 0; i < (await cards.count()); i++) {
      const cost = Number((await cards.nth(i).locator('span.text-amber-400').first().innerText()).replace(/\D/g, ''));
      if (cost <= coins) {
        await cards.nth(i).locator('button:has-text("UNLOCK")').click();
        await page.getByText(/Unlocked & equipped/).waitFor({ timeout: 3000 });
        const st = await state(page);
        expect(st.stats.coins === coins - cost, `coins ${st.stats.coins} != ${coins - cost}`);
        bought = true;
        break;
      }
    }
    expect(bought, 'could not afford any item to test purchase');
  }, page);

  await step('season pass: claim free tier, activate VIP, claim VIP cosmetic', async () => {
    await nav(page, 'Pass');
    const before = await state(page);
    const claim = page.locator('button:has-text("Claim")').first();
    await claim.click();
    await page.waitForTimeout(300);
    const mid = await state(page);
    expect(mid.claimedFreeTiers.length === before.claimedFreeTiers.length + 1, 'free tier not claimed');
    await page.locator('button:has-text("UNLOCK VIP PASS")').click();
    await page.getByText('VIP PASS ACTIVE').waitFor();
    await page.locator('button.bg-amber-400:has-text("Claim")').first().click();
    await page.waitForTimeout(300);
    const after = await state(page);
    expect(after.claimedVipTiers.includes(1) && after.inventory.includes('eyewear_pixel_shades'), 'VIP reward missing');
  }, page);

  await step('profile: rename (valid + invalid), quests + live reset countdown', async () => {
    await nav(page, 'Profile');
    await page.getByRole('button', { name: 'Edit name' }).click();
    const input = page.getByRole('textbox', { name: 'Player name' });
    await input.fill('!!!');
    await input.press('Enter');
    await page.getByText(/Use letters, numbers/).waitFor({ timeout: 3000 });
    await input.fill('NeonTester');
    await input.press('Enter');
    await page.waitForTimeout(300);
    expect((await state(page)).username === 'NeonTester', 'rename failed');
    expect(/Resets in \d/.test(await page.locator('[data-testid="quest-reset"]').innerText()), 'countdown missing');
    const quests = (await state(page)).quests;
    expect(quests.length === 4 && quests.some((q) => q.id === 'duel-wins'), 'quests wrong');
  }, page);

  await step('settings: graphics quality + sound toggle sync with header', async () => {
    await page.locator('[data-testid="settings"] button', { hasText: 'low' }).click();
    expect((await page.evaluate(() => localStorage.getItem('ra.quality'))) === 'low', 'quality not saved');
    await page.locator('[data-testid="settings"] button', { hasText: 'auto' }).click();
    expect((await page.evaluate(() => localStorage.getItem('ra.quality'))) === null, 'auto not saved');
    const sw = page.getByRole('switch', { name: 'Sound effects' });
    const was = await sw.getAttribute('aria-checked');
    await sw.click();
    const now = await sw.getAttribute('aria-checked');
    expect(was !== now, 'switch did not toggle');
    const saved = await page.evaluate(() => localStorage.getItem('rival_audio_enabled'));
    expect(saved === String(now === 'true'), `sound setting not saved: switch=${now} stored=${saved}`);
    await sw.click(); // restore
  }, page);

  await step('progress persists across reload', async () => {
    const before = await state(page);
    await page.reload();
    await page.waitForTimeout(1000);
    const after = await state(page);
    expect(after.username === 'NeonTester' && after.stats.coins === before.stats.coins && after.inventory.length === before.inventory.length, 'state lost on reload');
    await nav(page, 'Profile');
    expect(await page.getByText('NeonTester').first().isVisible(), 'name not rendered after reload');
  }, page);

  await step('match history shows real times and labels', async () => {
    await nav(page, 'Rankings');
    await page.getByRole('button', { name: 'My Match History' }).click();
    const text = await page.locator('main').innerText();
    expect(/Practice run/.test(text) && /(Just now|\dm ago)/.test(text), 'history labels missing');
    expect(!/1970|NaN/.test(text), 'bad dates');
  }, page);

  await step('reset progress returns to a fresh account', async () => {
    await nav(page, 'Profile');
    await page.locator('[data-testid="settings"] button', { hasText: 'Reset' }).click();
    await page.getByRole('button', { name: 'Yes, reset' }).click();
    await page.waitForTimeout(400);
    const st = await state(page);
    expect(st.stats.coins === 850 && st.username === 'ApexRival' && st.matchHistory.length === 3, 'reset incomplete');
  }, page);

  await ctx.close();

  // ------------------------------------------------------------ mobile layout
  console.log('\nMOBILE 390×844');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const m = await mctx.newPage();
  watch(m, 'mobile');
  await m.goto(URL);
  await m.waitForTimeout(1000);
  await step('no horizontal overflow on any tab', async () => {
    const bad = [];
    for (const tab of ['Play', 'Results', 'Leagues', 'Rewards', 'Profile']) {
      await m.locator('nav button', { hasText: tab }).tap();
      await m.waitForTimeout(400);
      const [sw, cw] = await m.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      if (sw > cw + 1) bad.push(`${tab}: ${sw}>${cw}`);
      await m.screenshot({ path: `${S}/m-${tab}.png` });
    }
    expect(!bad.length, bad.join(', '));
  }, m);
  await step('touch practice run works on mobile', async () => {
    await m.locator('nav button', { hasText: 'Play' }).tap();
    await m.locator('[data-testid="tile-dunk-rush"]').tap(); // Dunk Rush (touch drag shooting)
    await m.locator('[data-testid="mode-practice"]').tap();
    await m.locator('[data-testid="game-modal"] button:has-text("TAP TO PLAY")').tap({ timeout: 15000 });
    await m.waitForTimeout(2800); // 3-2-1 countdown
    const vp = m.locator('[data-testid="game-surface"]').first();
    const box = await vp.boundingBox();
    for (let i = 0; i < 3; i++) {
      await m.mouse.move(box.x + box.width / 2, box.y + box.height * 0.83);
      await m.mouse.down();
      await m.mouse.move(box.x + box.width / 2, box.y + box.height * 0.47, { steps: 6 });
      await m.mouse.up();
      await m.waitForTimeout(1500);
    }
    expect(await m.locator('[data-testid="game-modal"]').isVisible(), 'modal gone');
    const sc = Number((await m.locator('[data-testid="hud-score"]').innerText()).replace(/\D/g, ''));
    expect(sc > 0, 'flick shots never scored');
    await m.screenshot({ path: `${S}/m-dunk.png` });
    await m.locator('button[aria-label="Close match"]').tap();
  }, m);
  await mctx.close();
  await browser.close();

  // ------------------------------------------------------------ no-WebGL fallback
  console.log('\nNO WEBGL');
  const nb = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
  const np = await (await nb.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  watch(np, 'nowebgl');
  await np.goto(URL);
  await np.waitForTimeout(800);
  await step('explains 3D requirement without WebGL (no crash, no 2D edition)', async () => {
    await np.locator('[data-testid="tile-neon-dash"]').click();
    await np.locator('[data-testid="mode-practice"]').click();
    await np.locator('[data-testid="no-3d"]').waitFor({ timeout: 8000 });
    await np.waitForTimeout(1500);
    expect(!(await np.getByText('Application error').count()), 'crashed');
    await np.screenshot({ path: `${S}/nowebgl.png` });
  }, np);
  await nb.close();

  // ------------------------------------------------------------ summary
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (consoleErrors.length) console.log('Console errors:\n  ' + [...new Set(consoleErrors)].slice(0, 15).join('\n  '));
  else console.log('Console errors: none');
  process.exit(failed.length ? 1 : 0);
})();
