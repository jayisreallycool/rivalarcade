// Triumph-style mode flows on a phone viewport: Arena, Blitz, Streak with stakes, plus a 3D game in Arena.
// Usage: APP_URL=http://localhost:3000 node tests/e2e-modes.cjs
const { chromium } = require('playwright');
const assert = require('assert');
const URL = process.env.APP_URL || 'http://localhost:3000';
const OUT = 'tests/artifacts';

const playBricks = async (p, secs) => {
  const s = await p.$('[data-testid=game-surface]');
  const box = await s.boundingBox();
  const end = Date.now() + secs * 1000;
  while (Date.now() < end && !(await p.$('[data-testid=results-modal]'))) {
    await p.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
    await p.mouse.down();
    await p.mouse.move(box.x + 40 + Math.random() * (box.width - 80), box.y + box.height * (0.25 + Math.random() * 0.3), { steps: 3 });
    await p.mouse.up();
    await p.waitForTimeout(600);
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // fast-forward
    await p.waitForTimeout(1500);
  }
};
const stats = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('rival_arcade_user_state_v3')).stats);

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await p.addInitScript(() => localStorage.setItem('ra.quality', 'low'));
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/lobby.png` });

  for (const mode of ['arena', 'blitz', 'streak']) {
    await p.click('[data-testid=tile-brick-blitz]');
    await p.click('[data-testid=stake-50]');
    await p.click(`[data-testid=mode-${mode}]`);
    await p.waitForSelector('text=TAP TO PLAY', { timeout: 15000 });
    assert(await p.$('[data-testid=stake-line]'), `${mode}: stake line on ready card`);
    await p.screenshot({ path: `${OUT}/${mode}-ready.png` });
    const before = await stats(p);
    await p.click('text=TAP TO PLAY');
    await p.waitForTimeout(3000);
    const charged = await stats(p);
    assert.strictEqual(charged.coins, before.coins - 50, `${mode}: entry charged at GO`);
    if (mode === 'arena') assert(await p.$('[data-testid=arena-board]'), 'arena live board');
    if (mode === 'blitz') assert(await p.$('[data-testid=blitz-coins]'), 'blitz coin counter');
    if (mode === 'streak') assert(await p.$('[data-testid=streak-round]'), 'streak round dots');
    await p.screenshot({ path: `${OUT}/${mode}-play.png` });
    await playBricks(p, 120);
    await p.waitForSelector('[data-testid=results-modal]', { timeout: 30000 });
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${OUT}/${mode}-results.png` });
    const header = await p.textContent('[data-testid=results-header]');
    let after;
    if (mode === 'streak' && header.includes('CLEARED')) {
      // Next round must not charge again.
      await p.click('text=ROUND 2');
      await p.waitForSelector('text=TAP TO PLAY');
      await p.screenshot({ path: `${OUT}/streak-r2-ready.png` });
      await p.click('text=TAP TO PLAY');
      await p.waitForTimeout(3000);
      assert.strictEqual((await stats(p)).coins, charged.coins, 'streak round 2 is free');
      await p.click('[aria-label="Close match"]');
      after = await stats(p);
      console.log(`  ${mode}: ${header} → left during round 2`);
    } else {
      await p.click('text=/Continue|Leave streak/');
      after = await stats(p);
      console.log(`  ${mode}: ${header}`);
    }
    console.log(`    coins ${before.coins} → ${after.coins}, crowns ${before.crowns} → ${after.crowns}`);
    await p.waitForTimeout(400);
  }

  // A 3D game in Live Arena: mode extras reach the shared shell.
  await p.click('[data-testid=tile-dunk-rush]');
  await p.click('[data-testid=stake-0]');
  await p.click('[data-testid=mode-arena]');
  await p.waitForSelector('text=TAP TO PLAY', { timeout: 20000 });
  assert(await p.$('[data-testid=arena-lobby]'), 'arena lobby list on ready card');
  await p.click('text=TAP TO PLAY');
  await p.waitForTimeout(5000);
  assert(await p.$('[data-testid=arena-board]'), 'arena board in 3D game');
  await p.screenshot({ path: `${OUT}/dunk-arena.png` });
  await p.click('[aria-label="Close match"]');
  await p.waitForTimeout(400);

  assert.deepStrictEqual(errs, []);
  console.log('mode e2e passed');
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
