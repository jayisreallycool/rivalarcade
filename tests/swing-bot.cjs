// Plays Canopy Swing with a simple "tap on the gold laser" bot; screenshots + how far it gets.
const { chromium } = require('playwright');
const { login } = require('./helpers.cjs');
const URL = process.env.APP_URL || 'http://localhost:3000';
const OUT = 'tests/artifacts/swing';
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL);
  await p.waitForSelector('[data-testid=lobby], [data-testid=phone-input]', { timeout: 30000 });
  if (await p.locator('[data-testid=phone-input]').count()) await login(p, URL);
  await p.waitForTimeout(1500);
  await p.click('[data-testid=tile-canopy-swing]');
  await p.click('[data-testid=mode-practice]');
  await p.waitForSelector('text=TAP TO PLAY', { timeout: 30000 });
  await p.screenshot({ path: `${OUT}/0-ready.png` });
  await p.click('text=TAP TO PLAY');
  await p.waitForTimeout(3300);
  const t0 = Date.now();
  let shots = 0, lastShot = 0, seen = new Set();
  const greedy = Number(process.env.GREEDY ?? 0.7); // chance to wait for perfect
  while (Date.now() - t0 < 600000) {
    if (await p.locator('[data-testid=match-results]').count()) break;
    const st = await p.evaluate(() => document.querySelector('[data-testid=game-surface] canvas')?.dataset.shot);
    const stage = await p.locator('[data-testid=swing-stage]').innerText().catch(() => '');
    if (!seen.has(stage)) { seen.add(stage); await p.screenshot({ path: `${OUT}/stage-${stage}.png` }); }
    if ((st === 'release' || st === 'perfect' || (st === 'range' && Math.random() > greedy)) && Date.now() - lastShot > 250) {
      await p.mouse.click(195, 500);
      shots++; lastShot = Date.now();
      if (shots === 3) await p.screenshot({ path: `${OUT}/1-shot.png` });
    }
    await p.waitForTimeout(40);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const vines = await p.locator('text=/branches/').first().innerText().catch(() => '?');
  await p.screenshot({ path: `${OUT}/9-end.png` });
  console.log(JSON.stringify({ secs, shots, stages: [...seen], vines, errs: errs.slice(0, 3) }));
  await b.close();
})();
