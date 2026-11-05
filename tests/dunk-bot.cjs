// Dunk Rush shooting check: computes the "right" flick for each spot and confirms good flicks
// score while sloppy ones miss. Guest build: APP_URL=http://localhost:3000 node tests/dunk-bot.cjs
const { chromium } = require('playwright');
const URL = process.env.APP_URL || 'http://localhost:3000';
const OUT = 'tests/artifacts/dunk';
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL);
  await p.waitForSelector('[data-testid=lobby]', { timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.click('[data-testid=tile-dunk-rush]');
  await p.click('[data-testid=mode-practice]');
  await p.waitForSelector('text=TAP TO PLAY', { timeout: 30000 });
  await p.click('text=TAP TO PLAY');
  await p.waitForTimeout(3400);
  const box = await p.locator('[data-testid=game-surface]').boundingBox();
  const H = box.height;
  const score = async () => Number((await p.locator('[data-testid=game-shell] .tabular-nums').first().innerText().catch(() => '0')).replace(/\D/g, '') || 0);
  const flick = async (up, dx, ms) => {
    const x0 = box.x + box.width / 2, y0 = box.y + H * 0.8;
    await p.mouse.move(x0, y0);
    await p.mouse.down();
    const steps = Math.max(4, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      await p.mouse.move(x0 + (dx * i) / steps, y0 - (up * i) / steps);
      await p.waitForTimeout(ms / steps);
    }
    await p.mouse.up();
  };
  const log = [];
  for (let i = 0; i < 10; i++) {
    const zone = await p.locator('[data-testid=dunk-zone]').innerText();
    const dist = Number(zone.match(/([\d.]+)m/)[1]);
    const before = await score();
    const sloppy = i % 3 === 2;
    const power = ((dist - 0.0) / 6) * (sloppy ? 1.25 : 1);
    if (i === 0) { const x0 = box.x + box.width / 2, y0 = box.y + H * 0.8; await p.mouse.move(x0, y0); await p.mouse.down(); for (let k = 1; k <= 8; k++) { await p.mouse.move(x0, y0 - (power * 0.36 * H * k) / 8); await p.waitForTimeout(40); } await p.screenshot({ path: `${OUT}/aim.png` }); await p.mouse.move(x0, y0); await p.mouse.up(); await p.waitForTimeout(600); }
    await flick(power * 0.36 * H, 0, 380);
    await p.waitForTimeout(3600);
    const after = await score();
    const ls = await p.evaluate(() => document.querySelector('[data-testid=game-surface] canvas')?.dataset.lastShot);
    log.push(`${zone} ${sloppy ? 'long' : 'good'} → ${after > before ? 'MADE' : 'miss'} ${ls}`);
    if (i === 4) await p.screenshot({ path: `${OUT}/mid.png` });
  }
  console.log(log.join('\n'), '\nerrors:', errs.slice(0, 2));
  await b.close();
})();
