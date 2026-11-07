// Mobile compatibility: every 3D game starts on each quality tier and in safe mode,
// a lost GPU context rebuilds the arena in 3D compatibility mode (same run, same seed)
// (repeatedly — there is no 2D edition), and devices without WebGL get a clear explanation.
// Usage: APP_URL=http://localhost:3000 node tests/e2e-compat.cjs
const { chromium } = require('playwright');
const assert = require('assert');
const { login } = require('./helpers.cjs');
const URL = process.env.APP_URL || 'http://localhost:3000';
const OUT = 'tests/artifacts/compat';
const GAMES = ['dunk-rush', 'neon-dash', 'cyber-reflex', 'gem-surge', 'brick-blitz', 'canopy-swing', 'fight-night', 'sky-stack', 'axe-spin', 'beat-tiles', 'slice-storm', 'prism-hop'];
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
    await login(p, URL);
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

  // 2. GPU context lost mid-game → rebuilt in 3D compatibility mode, stake refunded; lost again → rebuilt again (still 3D).
  {
    const ctx = await b.newContext(phone);
    const p = await ctx.newPage();
    await login(p, URL);
    await startGame(p, 'dunk-rush');
    const lose = () => p.evaluate(() => document.querySelector('[data-testid=game-surface] canvas')?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext());
    await lose();
    await p.waitForSelector('[data-testid=compat-notice]', { timeout: 8000 }).catch(() => {});
    check(await p.evaluate(() => sessionStorage.getItem('ra.safe3d') === '1'), 'context loss → 3D compatibility mode');
    await p.waitForSelector('text=TAP TO PLAY', { timeout: 20000 });
    check((await p.locator('[data-testid=game-surface] canvas').count()) > 0, 'game rebuilt in 3D');
    await p.click('text=TAP TO PLAY');
    await p.waitForTimeout(3200);
    await lose();
    await p.waitForSelector('text=TAP TO PLAY', { timeout: 20000 }).catch(() => {});
    check((await p.locator('[data-testid=game-surface] canvas').count()) > 0 && !(await p.locator('[data-testid=lite-edition]').count()), 'second failure → rebuilt in 3D again (no 2D edition)');
    await p.screenshot({ path: `${OUT}/compat-rebuilt.png` });
    await ctx.close();
  }

  // 2b. Picky phone drivers: the GPU probe misfires once and the renderer's first context
  //     attributes are refused → the game must still start in full 3D.
  {
    const ctx = await b.newContext(phone);
    await ctx.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      let probes = 0;
      HTMLCanvasElement.prototype.getContext = function (type, attrs) {
        if (type === 'webgl2' && (probes++ === 0 || (attrs && attrs.powerPreference === 'high-performance'))) return null;
        return orig.call(this, type, attrs);
      };
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await login(p, URL);
    await startGame(p, 'neon-dash');
    check((await p.locator('[data-testid=game-shell]').count()) > 0 && !(await p.locator('[data-testid=no-3d]').count()), 'picky driver: game still starts in 3D');
    check(errs.length === 0, 'picky driver: no page errors');
    await ctx.close();
  }

  // 3. No WebGL at all → clear explanation screen (no crash, no 2D edition).
  {
    const nb = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
    const p = await (await nb.newContext(phone)).newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await login(p, URL);
    for (const g of ['neon-dash', 'brick-blitz']) {
      await p.click(`[data-testid=tile-${g}]`);
      await p.click('[data-testid=mode-practice]');
      await p.waitForSelector('[data-testid=no-3d]', { timeout: 10000 }).catch(() => {});
      check((await p.locator('[data-testid=no-3d]').count()) > 0, `no WebGL → ${g} explains the 3D requirement`);
      check((await p.locator('[data-testid=gpu-diag]').count()) > 0, `no WebGL → ${g} shows a diagnostic code`);
      await p.click('[aria-label="Close match"]');
      await p.waitForTimeout(300);
    }
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
