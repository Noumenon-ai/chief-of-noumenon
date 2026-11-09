import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserSpeechLanguage, createBrowserSpeech, showBrowserSpeechPrivacy } from './browser-speech.ts';

function fixture(overrides = {}) {
  const instances = [], drafts = [], finals = [], notices = [], phases = [], fallbacks = [];
  class Recognition {
    constructor() { instances.push(this); }
    start() { this.started = true; }
    stop() { this.stops = (this.stops ?? 0) + 1; }
    abort() { this.aborted = true; }
    result(...texts) { this.onresult?.({ results: texts.map((text, i) => Object.assign([{ transcript: text }], { isFinal: i < texts.length - 1 })) }); }
    end() { this.onend?.(); }
    error(error) { this.onerror?.({ error }); }
  }
  const host = { webkitSpeechRecognition: Recognition };
  const options = { enabled: true, host, language: 'en-US', draft: 'Typed first  ',
    onDraft: text => drafts.push(text), onFinal: (text, send) => finals.push({ text, send }),
    onNotice: text => notices.push(text), onPhase: phase => phases.push(phase),
    onFallback: (draft, send) => fallbacks.push({ draft, send }), ...overrides };
  const session = createBrowserSpeech(options);
  return { session, options, instances, drafts, finals, notices, phases, fallbacks };
}

test('live results replace interim words and retain finals without duplicates', () => {
  const f = fixture(); f.session.start();
  const r = f.instances[0];
  assert.equal(r.continuous, true); assert.equal(r.interimResults, true); assert.equal(r.lang, 'en-US');
  r.result('Hello'); r.result('Hello world'); r.result('Hello world.', 'Next'); r.result('Hello world.', 'Next sentence.');
  assert.deepEqual(f.drafts, ['Typed first\nHello', 'Typed first\nHello world', 'Typed first\nHello world. Next', 'Typed first\nHello world. Next sentence.']);
  f.session.dispose();
});

test('an end without stop restarts and keeps earlier text, ignoring old results', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.session.start();
  const r = f.instances[0], late = r.onresult;
  r.result('First sentence.'); r.end();
  t.mock.timers.tick(100);
  assert.equal(f.instances.length, 2);
  f.instances[1].result('Second sentence.');
  late({ results: [[{ transcript: 'stale' }]] });
  assert.equal(f.drafts.at(-1), 'Typed first\nFirst sentence. Second sentence.');
  assert.deepEqual(f.phases, ['recording']);
  f.session.dispose();
});

test('Send waits for the final result and sends exactly once', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.session.start();
  const r = f.instances[0]; r.result('Interim');
  f.session.stop(true); f.session.stop(true);
  assert.deepEqual(f.finals, []); assert.equal(r.stops, 1);
  assert.equal(f.phases.at(-1), 'transcribing');
  r.result('Final words.'); r.end(); r.end();
  t.mock.timers.tick(1500);
  assert.deepEqual(f.finals, [{ text: 'Typed first\nFinal words.', send: true }]);
  assert.equal(f.phases.at(-1), 'idle');
});

test('stop is bounded by 1.5 seconds even if the browser never ends', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.session.start();
  const r = f.instances[0], late = r.onresult; r.result('Heard words');
  f.session.stop(true); t.mock.timers.tick(1499); assert.equal(f.finals.length, 0);
  t.mock.timers.tick(1); assert.equal(f.finals.length, 1); assert.equal(r.aborted, true);
  late({ results: [[{ transcript: 'too late' }]] });
  assert.equal(f.drafts.at(-1), 'Typed first\nHeard words');
});

test('mic stop keeps editable text without sending or restarting', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.session.start(); f.instances[0].result('Dictation');
  f.session.stop(); f.instances[0].end(); t.mock.timers.tick(2000);
  assert.deepEqual(f.finals, [{ text: 'Typed first\nDictation', send: false }]);
  assert.equal(f.instances.length, 1);
});

test('Send during the silence restart gap sends accumulated words once', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.session.start(); f.instances[0].result('Dictation'); f.instances[0].end();
  f.session.stop(true); t.mock.timers.tick(2000);
  assert.deepEqual(f.finals, [{ text: 'Typed first\nDictation', send: true }]);
  assert.equal(f.instances.length, 1);
});

test('no speech restarts while listening, but Send never sends preexisting text alone', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.session.start(); f.instances[0].error('no-speech'); f.instances[0].end();
  assert.deepEqual(f.notices, []); t.mock.timers.tick(100);
  assert.equal(f.instances.length, 2);
  f.session.stop(true); f.instances[1].error('no-speech'); f.instances[1].end();
  assert.deepEqual(f.finals, []); assert.equal(f.drafts.at(-1), 'Typed first  ');
  assert.equal(f.notices.at(-1), 'No speech was heard. Try again or type your message.');
});

for (const error of ['network', 'audio-capture', 'language-not-supported']) {
  test(`${error} falls back for this recording and later recordings on this page`, () => {
    const f = fixture(); f.session.start(); f.instances[0].result('Already heard');
    f.instances[0].error(error);
    assert.deepEqual(f.fallbacks, [{ draft: 'Typed first\nAlready heard', send: false }]);
    assert.equal(f.notices.at(-1), 'voice.browserFallback'); assert.equal(f.instances[0].aborted, true);
    assert.equal(createBrowserSpeech(f.options), null);
    assert.equal(f.instances.length, 1); assert.deepEqual(f.finals, []);
  });
}
for (const error of ['not-allowed', 'service-not-allowed']) {
  test(`${error} explains permission without falling back or restarting`, t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(); f.session.start(); f.instances[0].error(error); f.instances[0].end();
    t.mock.timers.tick(2000);
    assert.match(f.notices.at(-1), /^Microphone permission was denied/);
    assert.equal(f.phases.at(-1), 'idle'); assert.deepEqual(f.fallbacks, []); assert.equal(f.instances.length, 1);
  });
}

test('disabled setting never accesses or constructs recognition; missing API uses local recording', () => {
  const host = { get SpeechRecognition() { assert.fail('must not access browser speech'); } };
  assert.equal(fixture({ enabled: false, host }).session, null);
  assert.equal(fixture({ host: {} }).session, null);
});

test('unmount drops late results, final sends and scheduled restarts', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const stopping of [true, false]) {
    const f = fixture(); f.session.start();
    const r = f.instances[0], lateResult = r.onresult, lateEnd = r.onend;
    if (stopping) f.session.stop(true); else r.end();
    f.session.dispose(); lateResult({ results: [[{ transcript: 'late words' }]] }); lateEnd();
    t.mock.timers.tick(2000);
    assert.deepEqual(f.drafts, []); assert.deepEqual(f.finals, []); assert.equal(f.instances.length, 1);
  }
});

test('language respects single allowed language, selected language and device Auto', () => {
  assert.equal(browserSpeechLanguage(['en'], 'auto', 'he-IL'), 'en-US');
  assert.equal(browserSpeechLanguage(['he', 'en'], 'en', 'he-IL'), 'en-US');
  assert.equal(browserSpeechLanguage(['he', 'en'], 'he', 'en-US'), 'he');
  assert.equal(browserSpeechLanguage(['he', 'en'], 'auto', 'he-IL'), 'he-IL');
  assert.equal(browserSpeechLanguage(['he', 'en'], 'fr', 'en-US'), 'en-US');
  assert.equal(browserSpeechLanguage([], 'auto', 'fr-FR'), 'fr-FR');
});

test('privacy notice is remembered on device and blocked storage is safe', () => {
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key), setItem: (key, value) => values.set(key, value),
  } });
  try {
    assert.equal(showBrowserSpeechPrivacy(), true); assert.equal(showBrowserSpeechPrivacy(), false);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('blocked'); } });
    assert.equal(showBrowserSpeechPrivacy(), true);
  } finally { delete globalThis.localStorage; }
});

test('single-utterance mode for Android restarts and keeps each utterance once', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture({ continuous: false }); f.session.start();
  const r = f.instances[0];
  assert.equal(r.continuous, false);
  r.result('Call the dentist'); r.end();
  t.mock.timers.tick(100);
  const r2 = f.instances[1];
  assert.equal(r2.continuous, false);
  r2.result('tomorrow at nine');
  f.session.stop(true); r2.end();
  assert.deepEqual(f.finals, [{ text: 'Typed first\nCall the dentist tomorrow at nine', send: true }]);
});
