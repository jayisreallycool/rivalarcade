// Guest mode (no sign-in): the app opens straight to the lobby; practice, store and progress
// work on-device; real-player modes are locked. Run against a build WITHOUT Firebase keys:
//   npm run build && npm start   →   APP_URL=http://localhost:3000 node tests/e2e-guest.cjs
const { chromium } = require('playwright');
const URL = process.env.APP_URL || 'http://localhost:3000';
const OUT = 'tests/artifacts/guest';
let failures = 0;
const ok = (c, m) => {
  console.log(`  ${c ? '✓' : '✗'} ${m}`);
  if (!c) failures++;
};
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL);
  await p.waitForSelector('[data-testid=lobby]', { timeout: 30000 });
  ok(!(await p.locator('[data-testid=auth-gate]').count()), 'no sign-in screen');
  ok(await p.locator('[data-testid=guest-banner]').isVisible(), 'guest banner shown');
  await p.waitForFunction(() => document.querySelector('[data-testid=hdr-coins]')?.textContent.includes('850'));
  ok(true, 'guest starts with 850 welcome coins');
  await p.screenshot({ path: `${OUT}/lobby.png` });
  await p.click('[data-testid=tile-canopy-swing]');
  ok(await p.locator('[data-testid=mode-duel]').isDisabled(), '1v1 locked for guests');
  await p.click('[data-testid=mode-practice]');
  await p.waitForSelector('text=TAP TO PLAY', { timeout: 30000 });
  await p.click('text=TAP TO PLAY');
  // never tap: the rope frays and you drop into the river
  await p.waitForSelector('[data-testid=match-results]', { timeout: 90000 }).catch(() => {});
  ok(await p.locator('text=PRACTICE COMPLETE').count(), 'practice run completes on device');
  await p.screenshot({ path: `${OUT}/practice.png` });
  await p.click('[data-testid=results-continue]').catch(() => {});
  await p.click('nav button:has-text("Leagues")');
  ok(await p.locator('[data-testid=cups-guest]').isVisible(), 'cups explain they need sign-in');
  await p.click('nav button:has-text("Results")');
  await p.waitForSelector('[data-result=practice]');
  ok(true, 'run listed in Results');
  await p.reload();
  await p.waitForSelector('[data-testid=lobby]', { timeout: 30000 });
  await p.click('nav button:has-text("Results")');
  ok((await p.locator('[data-result=practice]').count()) === 1, 'progress survives reload');
  ok(errs.length === 0, `no page errors ${errs.slice(0, 2).join(' | ')}`);
  await b.close();
  console.log(failures ? `\n${failures} guest check(s) failed` : '\nguest e2e passed');
  process.exit(failures ? 1 : 0);
})();
