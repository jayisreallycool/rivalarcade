// Visual check: each 3D game mid-play on a phone viewport at a given quality tier.
// Usage: APP_URL=http://localhost:3000 QUALITY=high OUT=tests/artifacts/before node tests/shots.cjs
const { chromium } = require('playwright');
const URL = process.env.APP_URL || 'http://localhost:3000';
const OUT = process.env.OUT || 'tests/artifacts/shots';
const Q = process.env.QUALITY || 'high';
const GAMES = (process.env.GAMES || 'dunk-rush,neon-dash,cyber-reflex,gem-surge,brick-blitz').split(',');

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.addInitScript((q) => localStorage.setItem('ra.quality', q), Q);
  await p.goto(URL);
  await p.waitForTimeout(800);
  for (const g of GAMES) {
    await p.click(`[data-testid=tile-${g}]`);
    await p.click('[data-testid=mode-practice]');
    await p.waitForSelector('text=TAP TO PLAY', { timeout: 30000 });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/${g}-ready.png` });
    await p.click('text=TAP TO PLAY');
    await p.waitForTimeout(4500);
    await p.screenshot({ path: `${OUT}/${g}-play.png` });
    await p.click('[aria-label="Close match"]');
    await p.waitForTimeout(500);
  }
  console.log(errs.length ? errs : 'no errors');
  await b.close();
})();
