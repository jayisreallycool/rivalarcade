// Plays Canopy Swing with a simple tap-tap bot: tap to let go when it would work, tap to grab.
// APP_URL=http://localhost:3000 node tests/swing-bot.cjs
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
  let actions = 0;
  const seen = new Set();
  await p.mouse.move(195, 500);
  while (Date.now() - t0 < 300000) {
    if (await p.locator('[data-testid=match-results]').count()) break;
    const st = await p.evaluate(() => document.querySelector('[data-testid=game-surface] canvas')?.dataset.shot);
    const stage = await p.locator('[data-testid=swing-stage]').innerText().catch(() => '');
    if (stage && !seen.has(stage)) { seen.add(stage); await p.screenshot({ path: `${OUT}/stage-${stage}.png` }); }
    if (st === 'release') {
      await p.mouse.click(195, 500);
      actions++;
      if (actions === 3) await p.screenshot({ path: `${OUT}/1-fly.png` });
    }
    await p.waitForTimeout(30);
  }
  const score = await p.locator('[data-testid=your-score]').innerText().catch(() => '?');
  await p.screenshot({ path: `${OUT}/9-end.png` });
  console.log(JSON.stringify({ secs: ((Date.now() - t0) / 1000).toFixed(0), actions, stages: [...seen], score, errs: errs.slice(0, 3) }));
  await b.close();
})();
