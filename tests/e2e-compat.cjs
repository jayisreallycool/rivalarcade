// Mobile compatibility: every 3D game starts on each quality tier and in safe mode,
// a lost GPU context falls back (safe mode → 2D edition) with the stake refunded,
// and devices without WebGL get the lite edition.
// Usage: APP_URL=http://localhost:3000 node tests/e2e-compat.cjs
const { chromium } = require('playwright');
const assert = require('assert');
const URL = process.env.APP_URL || 'http://localhost:3000';
const OUT = 'tests/artifacts/compat';
const GAMES = ['dunk-rush', 'neon-dash', 'cyber-reflex', 'gem-surge', 'brick-blitz'];
const GPU = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

async function startGame(p, id, mode = 'practice', stake) {
  await p.click(`[data-testid=tile-${id}]`);
  if (stake !== undefined) await p.click(`[data-testid=stake-${stake}]`);
  await p.click(`[data-testid=mode-${mode}]`);
  await p.waitForSelector('text=TAP TO PLAY', { timeout: 30000 });
  await p.click('text=TAP TO PLAY');
  await p.waitForTimeout(3200);
}

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: GPU });
  let failures = 0;
  const check = (cond, msg) => {
    console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
    if (!cond) failures++;
  };

  // 1. Every game, every tier + safe mode: renders, no page errors, no shader errors.
  for (const tier of ['low', 'medium', 'high', 'safe']) {
    const ctx = await b.newContext(phone);
    await ctx.addInitScript((t) => {
      if (t === 'safe') sessionStorage.setItem('ra.safe3d', '1');
      else localStorage.setItem('ra.quality', t);
    }, tier);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => /error|failure/i.test(m.type() + m.text()) && m.type() !== 'log' && errs.push(m.text()));
    await p.goto(URL);
    await p.waitForTimeout(800);
    for (const g of GAMES) {
      await startGame(p, g);
      const ok = (await p.locator('[data-testid=game-shell]').count()) > 0 && !(await p.locator('[data-testid=game-error]').count());
      if (g === 'gem-surge' || g === 'dunk-rush') await p.screenshot({ path: `${OUT}/${tier}-${g}.png` });
      check(ok, `${tier}: ${g} running`);
      await p.click('[aria-label="Close match"]');
      await p.waitForTimeout(400);
    }
    check(errs.length === 0, `${tier}: no errors ${errs.length ? JSON.stringify(errs.slice(0, 3)) : ''}`);
    await ctx.close();
  }

  // 2. GPU context lost mid-game → safe-mode retry, stake refunded; lost again → lite (2D) edition.
  {
    const ctx = await b.newContext(phone);
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForTimeout(800);
    const coins = () => p.evaluate(() => JSON.parse(localStorage.getItem('rival_arcade_user_state_v3')).stats.coins);
    const before = await coins();
    await startGame(p, 'dunk-rush', 'blitz', 25);
    check((await coins()) === before - 25, 'stake charged at GO');
    const lose = () => p.evaluate(() => document.querySelector('[data-testid=game-surface] canvas')?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext());
    await lose();
    await p.waitForSelector('[data-testid=compat-notice]', { timeout: 8000 }).catch(() => {});
    check(await p.evaluate(() => sessionStorage.getItem('ra.safe3d') === '1'), 'context loss → safe mode');
    check((await coins()) === before, 'stake refunded after GPU failure');
    await p.waitForSelector('text=TAP TO PLAY', { timeout: 20000 });
    check(true, 'game restarted in safe mode');
    await p.click('text=TAP TO PLAY');
    await p.waitForTimeout(3200);
    await lose();
    await p.waitForSelector('[data-testid=lite-edition]', { timeout: 10000 }).catch(() => {});
    check((await p.locator('[data-testid=lite-edition]').count()) > 0, 'second failure → lite (2D) edition');
    await p.screenshot({ path: `${OUT}/lite-fallback.png` });
    await ctx.close();
  }

  // 3. No WebGL at all → lite edition straight away, Brick Blitz still runs (canvas).
  {
    const nb = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
    const p = await (await nb.newContext(phone)).newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(URL);
    await p.waitForTimeout(800);
    await p.click('[data-testid=tile-neon-dash]');
    await p.click('[data-testid=mode-practice]');
    await p.waitForSelector('[data-testid=lite-edition]', { timeout: 10000 }).catch(() => {});
    check((await p.locator('[data-testid=lite-edition]').count()) > 0, 'no WebGL → lite edition');
    await p.click('[aria-label="Close match"]');
    await startGame(p, 'brick-blitz');
    check((await p.locator('[data-testid=game-shell]').count()) > 0, 'no WebGL → Brick Blitz runs');
    check(errs.length === 0, 'no WebGL: no page errors');
    await nb.close();
  }

  await b.close();
  console.log(failures ? `\n${failures} compatibility check(s) failed` : '\ncompat e2e passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
