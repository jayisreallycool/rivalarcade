// "Novice player" bots for each game on a phone viewport. Checks the opening is easy
// (dunk shots go in, the runner survives, bricks don't flatten you) and records scores.
// Usage: APP_URL=http://localhost:3000 node tests/playtest.cjs
const { chromium } = require('playwright');
const URL = process.env.APP_URL || 'http://localhost:3000';
const OUT = 'tests/artifacts/playtest';
const GAMES = (process.env.GAMES || 'dunk-rush,neon-dash,brick-blitz,gem-surge,cyber-reflex').split(',');
const rnd = (a, b) => a + Math.random() * (b - a);

async function open(p, id) {
  await p.click(`[data-testid=tile-${id}]`);
  await p.click('[data-testid=mode-practice]');
  await p.waitForSelector('text=TAP TO PLAY', { timeout: 30000 });
  await p.click('text=TAP TO PLAY');
  await p.waitForTimeout(2700);
  const box = await (await p.$('[data-testid=game-surface]')).boundingBox();
  return box;
}
const score = async (p) => Number(((await p.textContent('[data-testid=hud-score]')) || '0').replace(/\D/g, ''));
const done = async (p) => !!(await p.$('[data-testid=results-modal]'));
const swipe = async (p, x0, y0, x1, y1, steps = 5) => {
  await p.mouse.move(x0, y0);
  await p.mouse.down();
  await p.mouse.move(x1, y1, { steps });
  await p.mouse.up();
};

const bots = {
  // Rough flicks: random length (20–55% of the screen) and a sloppy sideways lean.
  async 'dunk-rush'(p, b) {
    const log = [];
    const t0 = Date.now();
    for (let i = 0; i < 12; i++) {
      const before = await score(p);
      const len = b.height * rnd(0.2, 0.55);
      const x0 = b.x + b.width / 2;
      const y0 = b.y + b.height * 0.83;
      await swipe(p, x0, y0, x0 + len * rnd(-0.25, 0.25), y0 - len, 6);
      await p.waitForTimeout(1500);
      log.push((await score(p)) > before ? 1 : 0);
      if (i === 3) await p.screenshot({ path: `${OUT}/dunk-shot.png` });
    }
    return { firstShots: log.join(''), makes: log.reduce((a, b) => a + b, 0), secs: Math.round((Date.now() - t0) / 1000) };
  },
  // A novice who reacts to what's ahead ~300ms late and misreads 1 hazard in 5.
  async 'neon-dash'(p, b) {
    if (await p.evaluate(() => !!window.__dash)) {
      const t0 = Date.now();
      const cx = b.x + b.width / 2, cy = b.y + b.height * 0.6;
      const handled = new Set();
      while (!(await done(p)) && Date.now() - t0 < 120000) {
        const st = await p.evaluate(() => ({ lane: window.__dash.sim.currentLane, speed: window.__dash.sim.speed, obs: window.__dash.obstacles() }));
        const ahead = st.obs.filter((o) => o.type !== 'crystal' && o.lane === st.lane && o.z < -1 && o.z > -st.speed * 1.0).sort((a, b) => b.z - a.z)[0];
        if (ahead) {
          const key = `${ahead.lane}:${Math.round(ahead.z / 4)}:${ahead.type}`;
          if (!handled.has(ahead.type + Math.round(ahead.z))) {
            handled.add(ahead.type + Math.round(ahead.z));
            void key;
            await p.waitForTimeout(300); // human reaction
            if (Math.random() < 0.8) {
              const blocked = new Set(st.obs.filter((o) => o.type !== 'crystal' && Math.abs(o.z - ahead.z) < 3).map((o) => o.lane));
              const free = [0, 1, 2].filter((l) => !blocked.has(l)).sort((a, c) => Math.abs(a - st.lane) - Math.abs(c - st.lane))[0];
              if (free !== undefined && Math.abs(free - st.lane) === 1) await swipe(p, cx, cy, cx + (free > st.lane ? 70 : -70), cy, 3);
              else if (ahead.type === 'spike') await swipe(p, cx, cy, cx, cy - 70, 3);
              else await swipe(p, cx, cy, cx, cy + 70, 3);
            }
          }
        }
        await p.waitForTimeout(60);
      }
      const txt = await p.textContent('[data-testid=results-modal]');
      return { gameSecs: 60, finished: txt.includes('Full-run'), breakdown: txt.replace(/\s+/g, ' ').match(/SCORE BREAKDOWN(.*)Total/)?.[1] };
    }
    const t0 = Date.now();
    let shots = 0;
    while (!(await done(p)) && Date.now() - t0 < 70000) {
      const cx = b.x + b.width / 2, cy = b.y + b.height * 0.6;
      const dir = Math.floor(Math.random() * 4);
      const d = [[-60, 0], [60, 0], [0, -60], [0, 60]][dir];
      await swipe(p, cx, cy, cx + d[0], cy + d[1], 3);
      await p.waitForTimeout(rnd(500, 900));
      if (++shots === 20) await p.screenshot({ path: `${OUT}/dash-mid.png` });
    }
    return { survivedSecs: Math.round((Date.now() - t0) / 1000), finished: await p.$eval('[data-testid=results-modal]', (e) => e.innerText.includes('Full-run')).catch(() => false) };
  },
  async 'brick-blitz'(p, b) {
    const t0 = Date.now();
    let shots = 0;
    while (!(await done(p)) && Date.now() - t0 < 100000) {
      await swipe(p, b.x + b.width / 2, b.y + b.height * 0.8, b.x + rnd(40, b.width - 40), b.y + b.height * rnd(0.25, 0.55), 3);
      await p.waitForTimeout(500);
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await p.waitForTimeout(1500);
      shots++;
    }
    return { survivedSecs: Math.round((Date.now() - t0) / 1000), shots };
  },
  async 'gem-surge'(p, b) {
    const t0 = Date.now();
    while (!(await done(p)) && Date.now() - t0 < 70000) {
      const x = b.x + b.width * rnd(0.25, 0.75), y = b.y + b.height * rnd(0.2, 0.45);
      const d = [[45, 0], [-45, 0], [0, 45], [0, -45]][Math.floor(Math.random() * 4)];
      await swipe(p, x, y, x + d[0], y + d[1], 3);
      await p.waitForTimeout(450);
    }
    await p.screenshot({ path: `${OUT}/gem-end.png` });
    return {};
  },
  async 'cyber-reflex'(p, b) {
    const t0 = Date.now();
    while (!(await done(p)) && Date.now() - t0 < 50000) {
      await p.mouse.click(b.x + b.width * rnd(0.15, 0.85), b.y + b.height * rnd(0.3, 0.75));
      await p.waitForTimeout(250);
      if (Date.now() - t0 > 5000 && Date.now() - t0 < 5300) await p.screenshot({ path: `${OUT}/reflex-early.png` });
      if (Date.now() - t0 > 30000 && Date.now() - t0 < 30300) await p.screenshot({ path: `${OUT}/reflex-late.png` });
    }
    return {};
  },
};

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('ra.quality', 'low'));
  await p.goto(URL + (URL.includes('?') ? '&' : '?') + 'debug');
  await p.waitForTimeout(800);
  for (const g of GAMES) {
    const box = await open(p, g);
    const r = await bots[g](p, box);
    console.log('  ', g, 'bot:', JSON.stringify(r));
    await p.waitForSelector('[data-testid=results-modal]', { timeout: 180000 });
    const final = Number((await p.textContent('[data-testid=results-modal] .text-cyan-300.tabular-nums').catch(() => '0')).replace(/\D/g, '')) || null;
    await p.screenshot({ path: `${OUT}/${g}-results.png` });
    console.log(g, JSON.stringify({ ...r, final, header: (await p.textContent('[data-testid=results-header]')).trim() }));
    await p.click('text=/Continue/');
    await p.waitForTimeout(500);
  }
  console.log(errs.length ? errs : 'no page errors');
  await b.close();
})();
