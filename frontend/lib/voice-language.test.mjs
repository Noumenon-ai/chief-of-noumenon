import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadVoiceLanguage, saveVoiceLanguage, voiceLanguageName } from './voice-language.ts';

const settings = { languages: ['he', 'en'], default: 'auto' };
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('voice defaults to Auto and remembers the choice on this device', () => {
  const device = memory();
  assert.equal(loadVoiceLanguage(settings, device), 'auto');
  for (const choice of ['he', 'en', 'auto']) {
    saveVoiceLanguage(choice, device);
    assert.equal(loadVoiceLanguage(settings, device), choice);
    assert.equal(loadVoiceLanguage(settings, memory()), 'auto');
  }
});

test('removed or invalid languages revert to the server default', () => {
  const device = memory();
  saveVoiceLanguage('fr', device);
  assert.equal(loadVoiceLanguage(settings, device), 'auto');
  saveVoiceLanguage('he', device);
  assert.equal(loadVoiceLanguage({ ...settings, languages: ['en'] }, device), 'auto');
});

test('missing, inaccessible or full storage never breaks recording', () => {
  const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } };
  assert.equal(loadVoiceLanguage(settings, broken), 'auto');
  assert.equal(loadVoiceLanguage(settings, null), 'auto');
  assert.doesNotThrow(() => saveVoiceLanguage('he', broken));
  assert.doesNotThrow(() => saveVoiceLanguage('he', null));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('denied'); } });
  try {
    assert.equal(loadVoiceLanguage(settings), 'auto');
    assert.doesNotThrow(() => saveVoiceLanguage('he'));
  } finally { delete globalThis.localStorage; }
});

test('voice language names are native to the spoken language', () => {
  assert.equal(voiceLanguageName('he'), 'עברית');
  assert.equal(voiceLanguageName('en'), 'English');
  assert.equal(voiceLanguageName('fr'), 'français');
});
