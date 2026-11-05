// Shared e2e helpers. The app must run with the local test backend:
//   RA_TEST_BACKEND=memory NEXT_PUBLIC_RA_TEST_AUTH=1 CASH_MODE=test npm run build && npm start
// (text codes are always 123456; no Firebase / Stripe calls are made).
let seq = Math.floor(Math.random() * 9e5);
const nextPhone = () => `555${String(1000000 + ++seq).slice(-7)}`;

/** Sign up (or sign in) with a phone number and finish the profile. Returns { phone, name }. */
async function login(page, url, opts = {}) {
  const phone = opts.phone ?? nextPhone();
  const name = opts.name ?? `P${phone.slice(-6)}`;
  await page.goto(url);
  await page.waitForSelector('[data-testid=phone-input]', { timeout: 30000 });
  await page.fill('[data-testid=phone-input]', phone);
  await page.click('[data-testid=send-code]');
  await page.waitForSelector('[data-testid=code-input]');
  await page.fill('[data-testid=code-input]', '123456');
  await page.waitForSelector('[data-testid=username-input], [data-testid=lobby]', { timeout: 20000 });
  if (await page.locator('[data-testid=username-input]').count()) {
    await page.fill('[data-testid=username-input]', name);
    await page.selectOption('[data-testid=dob-month]', '4');
    await page.selectOption('[data-testid=dob-day]', '2');
    await page.selectOption('[data-testid=dob-year]', opts.year ?? '1995');
    await page.click('[data-testid=create-player]');
  }
  await page.waitForSelector('[data-testid=lobby]', { timeout: 20000 });
  return { phone, name };
}

/** Call the game server as the signed-in page user. */
function rpc(page, fn, args = {}) {
  return page.evaluate(
    async ([fn, args]) => {
      const s = JSON.parse(localStorage.getItem('ra_test_session'));
      const r = await fetch('/api/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer test.${s.uid}.${s.phone ?? 'none'}`, ...(localStorage.getItem('ra_test_geo') ? { 'x-ra-test-geo': localStorage.getItem('ra_test_geo') } : {}) },
        body: JSON.stringify({ fn, args }),
      });
      return { status: r.status, ...(await r.json()) };
    },
    [fn, args],
  );
}

module.exports = { login, rpc, nextPhone };
