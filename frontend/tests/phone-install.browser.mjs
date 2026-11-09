// The real service worker and fragment pairing, with all API calls intercepted.
import assert from 'node:assert/strict';
import { chromium } from '../../desktop/node_modules/playwright/index.mjs';
const origin = process.env.CONTROL_ROOM_URL || 'http://127.0.0.1:3935';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-background-networking'] });
let checks = 0;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let pairs = 0;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const path = url.pathname.slice(7);
    let body = [];
    if (path === '/auth/status') body = { configured: true, owner_configured: true, desktop: false };
    if (path === '/auth/session') body = { kind: 'browser', scopes: ['chat'], csrf_token: 'fixture', user_id: null };
    if (path === '/auth/pair') {
      pairs++;
      assert.equal(route.request().postDataJSON().code, 'FAKE-ONLY');
      body = { session: { kind: 'browser', scopes: ['chat'], csrf_token: 'fixture', user_id: null }, token: null };
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`${origin}/pair/#code=FAKE-ONLY`);
  await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/chat');
  assert.equal(pairs, 1);
  assert.equal(new URL(page.url()).hash, '');
  checks++; console.log('PASS one fragment exchange, no passphrase, code removed from address');
  await page.goto(`${origin}/login/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat());
  assert.deepEqual(cached, ['/offline.html']);
  checks++; console.log('PASS only public offline explanation cached after pairing and chat');
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { name: 'Your computer is out of reach' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks++; console.log('PASS offline phone page, honest connection message and no sideways scroll');
  await context.close();
  console.log(`${checks} browser checks passed, 0 failed`);
} finally { await browser.close(); }
