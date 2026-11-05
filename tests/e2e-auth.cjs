// End-to-end: real accounts, real PvP between two players, practice, cups, store, wallet.
// Start the app with the local test backend first (see tests/helpers.cjs), then:
//   APP_URL=http://localhost:3000 node tests/e2e-auth.cjs
const { chromium } = require('playwright');
const { login, rpc, nextPhone } = require('./helpers.cjs');
const URL = process.env.APP_URL || 'http://localhost:3000';
const OUT = 'tests/artifacts/live';
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const phoneCtx = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };

let failures = 0;
async function step(name, fn, page) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
    if (page) await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_').slice(0, 60)}.png` }).catch(() => {});
  }
}
const expect = (c, m) => {
  if (!c) throw new Error(m);
};
const watch = (page, errs, label) => {
  page.on('pageerror', (e) => errs.push(`[${label}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/GL Driver|GPU stall|favicon|401|409|402|403|Failed to load resource/.test(m.text()) && errs.push(`[${label}] ${m.text().slice(0, 160)}`));
};
const me = (page) => rpc(page, 'me').then((r) => r.me);

/** Open a game from the lobby in a mode, get to the ready card and press play. */
async function openMatch(page, game, mode, opts = {}) {
  await page.click('nav button:has-text("Play")');
  await page.click(`[data-testid=tile-${game}]`);
  if (opts.currency) await page.click(`[data-testid=currency-${opts.currency}]`);
  if (opts.stake !== undefined) await page.click(`[data-testid=stake-${opts.stake}]`);
  await page.click(`[data-testid=mode-${mode}]`);
  await page.waitForSelector('text=TAP TO PLAY', { timeout: 30000 });
}
/** Finish the run with a chosen score through the test hook (server still times + judges it). */
async function finishWith(page, score, waitMs = 2500) {
  await page.evaluate((s) => localStorage.setItem('ra_test_score', String(s)), score);
  await page.waitForTimeout(waitMs);
  await page.click('[data-testid=test-finish]', { force: true });
  await page.waitForSelector('[data-testid=match-results]', { timeout: 20000 });
}

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: GL });
  const errs = [];

  // ---------------------------------------------------------------- sign-in
  const ctxA = await browser.newContext(phoneCtx);
  const a = await ctxA.newPage();
  watch(a, errs, 'A');
  let A;
  await step('sign-in screen: phone + Google, bad number and wrong code are explained', async () => {
    await a.goto(URL);
    await a.waitForSelector('[data-testid=auth-gate]', { timeout: 30000 });
    expect(await a.locator('[data-testid=google-signin]').isVisible(), 'no Google button');
    await a.screenshot({ path: `${OUT}/01-signin.png` });
    await a.fill('[data-testid=phone-input]', '555');
    await a.click('[data-testid=send-code]');
    await a.waitForSelector('text=10-digit');
    const phone = nextPhone();
    await a.fill('[data-testid=phone-input]', phone);
    expect((await a.inputValue('[data-testid=phone-input]')).startsWith('('), 'phone not formatted');
    await a.click('[data-testid=send-code]');
    await a.waitForSelector('[data-testid=code-input]');
    expect(await a.locator('text=Resend code in').count(), 'no resend timer');
    await a.fill('[data-testid=code-input]', '000000');
    await a.waitForSelector('text=That code isn’t right');
    await a.screenshot({ path: `${OUT}/02-code.png` });
    await a.fill('[data-testid=code-input]', '123456');
    await a.waitForSelector('[data-testid=username-input]', { timeout: 15000 });
    A = { phone };
  }, a);

  await step('profile setup: validates name and age, then 850 welcome coins', async () => {
    await a.fill('[data-testid=username-input]', 'ab');
    await a.click('[data-testid=create-player]');
    await a.waitForSelector('text=3–16');
    A.name = `Ace${A.phone.slice(-5)}`;
    await a.fill('[data-testid=username-input]', A.name);
    await a.click('[data-testid=create-player]');
    await a.waitForSelector('text=date of birth');
    await a.selectOption('[data-testid=dob-month]', '6');
    await a.selectOption('[data-testid=dob-day]', '15');
    await a.selectOption('[data-testid=dob-year]', '1994');
    await a.screenshot({ path: `${OUT}/03-profile.png` });
    await a.click('[data-testid=create-player]');
    await a.waitForSelector('[data-testid=lobby]', { timeout: 20000 });
    expect((await me(a)).coins === 850, 'welcome coins');
    await a.waitForFunction(() => document.querySelector('[data-testid=hdr-coins]')?.textContent.includes('850'));
    await a.screenshot({ path: `${OUT}/04-lobby.png` });
  }, a);

  await step('session survives reload; no mock players anywhere', async () => {
    await a.reload();
    await a.waitForSelector('[data-testid=lobby]', { timeout: 30000 });
    await a.click('nav button:has-text("Leagues")');
    await a.click('[data-testid=seg-rankings]');
    await a.waitForSelector('[data-testid=rankings]');
    await a.waitForTimeout(800);
    const body = await a.locator('[data-testid=rankings]').innerText();
    expect(!/PhantomZero|Viper_X|GhostJumper|PrismQueen/.test(body), 'mock leaderboard data still present');
    await a.click('nav button:has-text("Results")');
    await a.waitForSelector('text=No matches here yet');
  }, a);

  // ---------------------------------------------------------------- one account per phone, Google + phone
  const ctxG = await browser.newContext(phoneCtx);
  const g = await ctxG.newPage();
  watch(g, errs, 'G');
  await step('Google sign-in must add a phone; a phone already in use is refused', async () => {
    await g.goto(URL);
    await g.waitForSelector('[data-testid=google-signin]', { timeout: 30000 });
    await g.click('[data-testid=google-signin]');
    await g.waitForSelector('text=Add your mobile number');
    await g.fill('[data-testid=phone-input]', A.phone);
    await g.click('[data-testid=send-code]');
    await g.fill('[data-testid=code-input]', '123456');
    await g.waitForSelector('[data-testid=auth-error]', { timeout: 15000 });
    expect(await g.locator('text=already has an account').count(), 'phone reuse not explained');
    await g.screenshot({ path: `${OUT}/05-phone-in-use.png` });
    await g.click('button:has-text("Sign out")');
    await g.waitForSelector('[data-testid=google-signin]');
    await g.click('[data-testid=google-signin]');
    await g.fill('[data-testid=phone-input]', nextPhone());
    await g.click('[data-testid=send-code]');
    await g.fill('[data-testid=code-input]', '123456');
    await g.waitForSelector('[data-testid=username-input]', { timeout: 15000 });
  }, g);
  await ctxG.close();

  // ---------------------------------------------------------------- practice (real run)
  await step('solo practice: a real 60s Dunk Rush run → server-timed, scored results with coins', async () => {
    await openMatch(a, 'dunk-rush', 'practice');
    await a.click('text=TAP TO PLAY');
    // The clock runs out on its own; the server checks the run really took the full minute.
    await a.waitForSelector('[data-testid=match-results]', { timeout: 300000 });
    expect(!(await a.locator('[data-testid=run-flagged]').count()), 'honest run was flagged');
    expect((await a.locator('[data-testid=coins-delta]').innerText()).startsWith('+'), 'no practice coins');
    expect(await a.locator('text=PRACTICE COMPLETE').count(), 'practice header');
    await a.screenshot({ path: `${OUT}/06-practice.png` });
    await a.click('[data-testid=results-continue]');
    const h = await rpc(a, 'history');
    expect(h.matches.length === 1 && h.matches[0].kind === 'practice', 'practice not recorded on server');
  }, a);

  await step('impossible score is rejected by the server (anti-cheat)', async () => {
    await openMatch(a, 'brick-blitz', 'practice');
    await finishWith(a, 4900, 500);
    await a.waitForSelector('[data-testid=run-flagged]');
    await a.click('[data-testid=results-continue]');
    expect((await me(a)).underReview, 'account not held for review');
  }, a);

  // ---------------------------------------------------------------- async 1v1 between two real players
  const ctxB = await browser.newContext(phoneCtx);
  const b = await ctxB.newPage();
  watch(b, errs, 'B');
  let B;
  await step('async 1v1 for coins: A plays and waits; B is matched, plays; both see the settled result', async () => {
    B = await login(b, URL);
    await openMatch(a, 'canopy-swing', 'duel', { stake: 25 });
    expect((await me(a)).coins < 850, 'entry not charged on join');
    await a.click('text=TAP TO PLAY');
    await finishWith(a, 5);
    await a.waitForSelector('[data-testid=waiting-opponent]');
    await a.screenshot({ path: `${OUT}/07-waiting.png` });
    await openMatch(b, 'canopy-swing', 'duel', { stake: 25 });
    await b.click('text=TAP TO PLAY');
    await finishWith(b, 3);
    await b.waitForSelector('text=DEFEAT', { timeout: 15000 });
    expect((await b.locator('[data-testid=opponent-name]').innerText()).includes('Ace'), 'B does not see A');
    await a.waitForSelector('text=VICTORY', { timeout: 15000 });
    expect((await a.locator('[data-testid=opponent-name]').innerText()) === B.name, 'A does not see B');
    await a.screenshot({ path: `${OUT}/08-victory.png` });
    const ma = await me(a);
    const mb = await me(b);
    expect(ma.rating > 1200 && mb.rating < 1200, 'Elo not applied');
    expect(mb.coins === 850 - 25, `B coins ${mb.coins}`);
    await a.click('[data-testid=results-continue]');
    await b.click('[data-testid=results-continue]');
  }, a);

  await step('results tab lists the match; leaderboard shows both real players', async () => {
    await a.click('nav button:has-text("Results")');
    await a.waitForSelector('[data-result=win]');
    await a.click('nav button:has-text("Leagues")');
    await a.click('[data-testid=seg-rankings]');
    await a.waitForSelector(`[data-testid=rank-row]:has-text("${B.name}")`);
    expect((await a.locator('[data-testid=rank-row]').count()) >= 2, 'leaderboard rows');
    await a.screenshot({ path: `${OUT}/09-rankings.png` });
  }, a);

  await step('joined-but-unplayed 1v1 can be resumed from Results', async () => {
    const j = await rpc(b, 'joinContest', { kind: 'h2h', gameId: 'brick-blitz', currency: 'coins', entry: 0 });
    expect(j.contestId, 'join failed');
    await b.click('nav button:has-text("Results")');
    await b.waitForSelector('text=PLAY NOW');
    await b.click('[data-testid=result-row]:has-text("PLAY NOW")');
    await b.waitForSelector('text=TAP TO PLAY', { timeout: 30000 });
    await b.click('[aria-label="Close match"]');
    await b.waitForSelector('[data-testid=confirm-leave]');
    await b.click('text=Keep playing');
    await finishWith(b, 2, 500);
    await b.waitForSelector('[data-testid=waiting-opponent]');
    await b.click('[data-testid=results-continue]');
  }, b);

  // ---------------------------------------------------------------- cups
  await step('cups: real field, same seed, run counted on standings', async () => {
    await b.click('nav button:has-text("Leagues")');
    await b.waitForSelector('[data-testid=cups]', { timeout: 20000 });
    await b.click('[data-testid=cup-neon-gp]');
    await b.click('[data-testid=cup-action]');
    await b.waitForSelector('text=TAP TO PLAY', { timeout: 30000 });
    await b.click('text=TAP TO PLAY');
    await b.evaluate(() => localStorage.setItem('ra_test_score', '0'));
    await b.waitForTimeout(800);
    await b.click('[data-testid=test-finish]', { force: true });
    await b.waitForSelector('text=Results are final when the cup closes');
    await b.click('[data-testid=results-continue]');
    await b.waitForSelector('text=RUN SUBMITTED · RESULTS AT CLOSE');
    await b.screenshot({ path: `${OUT}/10-cup.png` });
  }, b);

  // ---------------------------------------------------------------- store & wardrobe persist on the server
  await step('store purchase is charged by the server and survives reload', async () => {
    const before = (await me(b)).coins;
    await b.click('nav button:has-text("Profile")');
    await b.click('[data-testid=seg-wardrobe]');
    await b.getByRole('button', { name: 'Tops', exact: true }).click();
    const cards = b.locator('[data-state=locked]');
    let bought = null;
    for (let i = 0; i < (await cards.count()) && !bought; i++) {
      const cost = Number((await cards.nth(i).locator('span.text-amber-400').first().innerText()).replace(/\D/g, ''));
      if (cost <= before) {
        bought = { id: (await cards.nth(i).getAttribute('data-testid')).replace('wardrobe-item-', ''), cost };
        await cards.nth(i).locator('button:has-text("UNLOCK")').click();
      }
    }
    expect(bought, 'nothing affordable');
    await b.waitForTimeout(1500);
    const after = await me(b);
    expect(after.inventory.includes(bought.id) && after.coins === before - bought.cost, 'purchase not on server');
    await b.reload();
    await b.waitForSelector('[data-testid=lobby]', { timeout: 30000 });
    expect((await me(b)).avatar.shirtId === bought.id, 'equipped shirt not saved');
  }, b);

  // ---------------------------------------------------------------- cash (test mode)
  await step('cash: blocked state refused; allowed state plays a $1 1v1 with real balances', async () => {
    await a.evaluate(() => localStorage.setItem('ra_test_geo', 'US-AZ'));
    await b.evaluate(() => localStorage.setItem('ra_test_geo', 'US-CA'));
    await rpc(a, '__test', { credit: 500 });
    await rpc(b, '__test', { credit: 500 });
    let r = await rpc(a, 'joinContest', { kind: 'h2h', gameId: 'brick-blitz', currency: 'usd', entry: 100 });
    expect(r.error === 'region_blocked', `blocked state: ${JSON.stringify(r)}`);
    await a.reload();
    await a.waitForSelector('[data-testid=lobby]', { timeout: 30000 });
    await a.click('[data-testid=tile-brick-blitz]');
    await a.click('[data-testid=currency-usd]');
    await a.waitForSelector('[data-testid=cash-blocked]');
    await a.screenshot({ path: `${OUT}/11-cash-blocked.png` });
    await a.keyboard.press('Escape');
    await a.evaluate(() => localStorage.setItem('ra_test_geo', 'US-CA'));
    // A is under review (the cheat attempt above), so B plays a new player C.
    const ctxC = await browser.newContext(phoneCtx);
    const c = await ctxC.newPage();
    watch(c, errs, 'C');
    await login(c, URL);
    await c.evaluate(() => localStorage.setItem('ra_test_geo', 'US-NY'));
    await rpc(c, '__test', { credit: 500 });
    await b.reload();
    await b.waitForSelector('[data-testid=hdr-cash]', { timeout: 30000 });
    await openMatch(b, 'brick-blitz', 'duel', { currency: 'usd', stake: 100 });
    await b.click('text=TAP TO PLAY');
    await finishWith(b, 4);
    await c.reload();
    await c.waitForSelector('[data-testid=lobby]', { timeout: 30000 });
    await openMatch(c, 'brick-blitz', 'duel', { currency: 'usd', stake: 100 });
    await c.click('text=TAP TO PLAY');
    await finishWith(c, 2);
    await c.waitForSelector('text=DEFEAT', { timeout: 15000 });
    await b.waitForSelector('text=VICTORY', { timeout: 15000 });
    expect((await me(b)).cashCents === 500 - 100 + 180, `B cash ${(await me(b)).cashCents}`);
    expect((await me(c)).cashCents === 400, 'C cash');
    await b.click('[data-testid=results-continue]');
    await ctxC.close();
  }, b);

  await step('wallet: balances, history, ID + payout steps, limits and a break from paid play', async () => {
    await b.click('nav button:has-text("Profile")');
    await b.click('[data-testid=seg-wallet]');
    await b.waitForSelector('[data-testid=wallet]');
    expect((await b.locator('[data-testid=cash-balance]').innerText()) === '$5.80', 'wallet cash');
    await b.waitForSelector('[data-testid=ledger] >> text=Prize');
    expect(await b.locator('[data-testid=withdraw]').isDisabled(), 'withdraw enabled without ID');
    await b.screenshot({ path: `${OUT}/12-wallet.png`, fullPage: true });
    await b.click('[data-testid=self-exclude]');
    await b.waitForSelector('[data-testid=excluded]');
    const r = await rpc(b, 'joinContest', { kind: 'h2h', gameId: 'brick-blitz', currency: 'coins', entry: 25 });
    expect(r.error === 'self_excluded', 'self-exclusion not enforced');
  }, b);

  await step('no horizontal overflow on any tab (phone)', async () => {
    for (const t of ['Results', 'Leagues', 'Play', 'Rewards', 'Profile']) {
      await b.click(`nav button:has-text("${t}")`);
      await b.waitForTimeout(400);
      const w = await b.evaluate(() => document.documentElement.scrollWidth);
      expect(w <= 391, `${t} overflows: ${w}`);
    }
  }, b);

  await step('sign out returns to the sign-in screen', async () => {
    await b.click('nav button:has-text("Profile")');
    await b.click('[data-testid=seg-profile]');
    await b.click('[data-testid=signout]');
    await b.click('[data-testid=confirm-signout]');
    await b.waitForSelector('[data-testid=phone-input]');
  }, b);

  await step('no page errors', async () => expect(errs.length === 0, errs.slice(0, 4).join(' | ')));

  await browser.close();
  console.log(failures ? `\n${failures} live e2e step(s) failed` : '\nlive e2e passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
