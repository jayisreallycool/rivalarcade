// Screens of the app shell on a phone: lobby, chip filter, mode sheet, every tab.
const { chromium } = require('playwright');
const URL = process.env.APP_URL || 'http://localhost:3000';
const OUT = process.env.OUT || 'tests/artifacts/ui';
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(URL);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/1-play.png` });
  await p.mouse.wheel(0, 500);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/2-play-scrolled.png` });
  await p.click('[data-testid=chip-puzzle]');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/3-chip-puzzle.png` });
  await p.click('[data-testid=chip-all]');
  await p.click('[data-testid=tile-dunk-rush]');
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/4-sheet.png` });
  await p.keyboard.press('Escape');
  for (const [i, t] of ['Results', 'Leagues', 'Rewards', 'Profile'].entries()) {
    await p.locator('nav button', { hasText: t }).click();
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${5 + i}-${t.toLowerCase()}.png` });
  }
  const [sw, cw] = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  console.log('overflow', sw > cw + 1 ? `${sw}>${cw}` : 'none');
  console.log(errs.length ? errs : 'no errors');
  await b.close();
})();
