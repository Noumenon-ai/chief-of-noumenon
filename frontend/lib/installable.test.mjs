import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import qrcode from 'qrcode-generator';

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('home screen manifest uses product icons and opens chat standalone', () => {
  assert.equal(manifest.name, 'Chief of Noumenon');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './chat/');
  for (const icon of manifest.icons) {
    const bytes = readFileSync(new URL('../public/' + icon.src, import.meta.url));
    assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
  }
});

test('QR encoder handles long private DNS addresses locally', () => {
  const qr = qrcode(0, 'M');
  qr.addData('https://' + 'computer-'.repeat(6) + '.example.ts.net:10000/pair#code=ABCD-EFGH');
  qr.make();
  assert.ok(qr.getModuleCount() > 21);
  assert.equal(qr.isDark(0, 0), true);
});

function harness() {
  const events = {};
  const writes = [];
  const fetches = [];
  const cache = { put: async (...args) => writes.push(args) };
  const context = { URL, Response, self: { registration: { scope: 'https://chief.test/' }, addEventListener: (name, fn) => { events[name] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => [], match: async () => new Response('offline explanation') },
    fetch: async (request) => { fetches.push(request); return new Response('public offline'); } };
  vm.runInNewContext(worker, context);
  return { context, events, writes, fetches };
}

test('service worker caches only the public offline explanation', async () => {
  const h = harness();
  let pending;
  h.events.install({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0][0], 'https://chief.test/offline.html');
  assert.deepEqual(h.fetches, ['https://chief.test/offline.html']);
});

test('service worker never intercepts API, attachments, audio, files or non-navigation requests', () => {
  const h = harness();
  for (const path of ['api/v1/threads', 'api/v1/threads/1/attachments/a', 'attachments/a', 'files/raw', 'voice/audio', 'chat/files/raw', 'download/a']) {
    for (const mode of ['navigate', 'cors']) h.events.fetch({ request: { url: `https://chief.test/${path}`, method: 'GET', mode }, respondWith: () => assert.fail(path) });
  }
  for (const method of ['POST', 'PUT', 'DELETE']) h.events.fetch({ request: { url: 'https://chief.test/chat/', method, mode: 'navigate' }, respondWith: () => assert.fail(method) });
  assert.equal(h.fetches.length, 0);
  assert.equal(h.writes.length, 0);
});

test('offline navigation explains connection loss without storing chat', async () => {
  const h = harness();
  h.context.fetch = async () => { throw new Error('offline'); };
  let pending;
  h.events.fetch({ request: { url: 'https://chief.test/chat/?thread=1', method: 'GET', mode: 'navigate' }, respondWith: promise => { pending = promise; } });
  assert.equal(await (await pending).text(), 'offline explanation');
  assert.equal(h.writes.length, 0);
});
