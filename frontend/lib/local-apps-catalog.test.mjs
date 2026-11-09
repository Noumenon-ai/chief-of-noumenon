import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appDescription, appColor, compareApps, preferredAuth, credentialLabel } from './local-apps-catalog.ts';
import { isGoogle, googleSteps } from './google-setup.ts';
test('mainstream apps lead, followed by names, independent of catalog order', () => {
  const apps = ['zzz', 'agentmail', 'github', 'gmail', 'google-calendar', 'airtable'].map(service => ({service, displayName: service}));
  assert.deepEqual(apps.sort(compareApps).map(p => p.service), ['gmail', 'google-calendar', 'github', 'agentmail', 'airtable', 'zzz']);
});
test('generated descriptions never advertise action counts or unsupported abilities', () => {
  for (const description of ['Work with 102 actions', 'programmable AI email inbox', 'automated agents', 'Connected apps platform']) {
    assert.equal(appDescription({service: 'unknown', category: 'Email', description}), 'Connect your account and choose which bots may use it.');
  }
  assert.equal(appDescription({service: 'google-calendar'}), appDescription({service: 'googlecalendar'}));
});
test('tiles use stable shared contrast-tested identity colours', () => {
  const services = ['gmail','googlecalendar','github','slack','notion','outlook'];
  assert.ok(new Set(services.map(appColor)).size >= 4);
  for (const service of services) assert.match(appColor(service), /^var\(--identity-(?:[1-9]|10)\)$/);
  assert.equal(appColor('google-calendar'), appColor('googlecalendar'));
});
test('browser sign-in wins over keys, with plain credential labels and Google guidance', () => {
  assert.equal(preferredAuth(['api_key','oauth2'], true), 'oauth2');
  assert.equal(preferredAuth(['api_key','oauth2'], false), 'oauth2');
  assert.equal(preferredAuth(['api_key'], true), 'oauth2');
  assert.equal(preferredAuth(['api_key'], false), 'api_key');
  assert.equal(preferredAuth(['no_auth', 'api_key'], false), 'no_auth');
  assert.equal(credentialLabel({key: 'token', label: 'Bearer Token'}, 'Example'), 'Example access token');
  assert.equal(credentialLabel({key: 'apiKey', label: 'api key'}, 'Example'), 'Example account key');
  assert.equal(credentialLabel({key: 'privateKey', label: 'Integration secret'}, 'Notion'), 'Integration secret');
  for (const service of ['gmail','googlecalendar','googledrive','googlesheets','googledocs','youtube','google_analytics','google_bigquery','google_search_console']) {
    assert.ok(isGoogle(service));
    assert.equal(googleSteps(service).length, 6);
    assert.ok(googleSteps(service).every(([,url]) => new URL(url).origin === 'https://console.cloud.google.com'));
  }
  assert.equal(isGoogle('unknown'), false);
});
