// Renders a product image for every cosmetic item into public/items/<id>.webp.
// Needs the app running (npm run build && npm start).  Usage:
//   APP_URL=http://localhost:3000 node scripts/render-items.cjs [id1,id2…]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const URL = process.env.APP_URL || 'http://localhost:3000';
const only = process.argv[2];
const OUT = path.join(__dirname, '..', 'public', 'items');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  p.on('pageerror', (e) => console.error('page error:', e.message));
  await p.goto(`${URL}/item-lab${only ? `?only=${only}` : ''}`);
  await p.waitForFunction(() => window.__itemsDone === true, null, { timeout: 600000 });
  const items = await p.evaluate(() => window.__items || {});
  let n = 0;
  for (const [id, url] of Object.entries(items)) {
    fs.writeFileSync(path.join(OUT, `${id}.webp`), Buffer.from(url.split(',')[1], 'base64'));
    n++;
  }
  if (process.env.SHEET) await p.screenshot({ path: process.env.SHEET, fullPage: true });
  console.log(`wrote ${n} item images to public/items`);
  await b.close();
  if (!n) process.exit(1);
})();
