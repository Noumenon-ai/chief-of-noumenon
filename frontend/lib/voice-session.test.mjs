import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceSession } from './voice-session.ts';

function setup(draft = 'Keep my words ') {
  const requests = [], drafts = [], finals = [], notices = [];
  const session = createVoiceSession({
    draft,
    transcribe: (audio, signal) => new Promise((resolve, reject) => requests.push({ audio, signal, resolve, reject })),
    onDraft: text => drafts.push(text),
    onFinal: (text, send) => finals.push({ text, send }),
    onNotice: text => notices.push(text),
  });
  return { session, requests, drafts, finals, notices };
}
const audio = (...chunks) => new Blob(chunks, { type: 'audio/webm' });

test('live refresh replaces the prior draft, uses complete snapshots and skips busy ticks', async () => {
  const { session, requests, drafts } = setup();
  const first = session.preview(audio('header', 'one'));
  assert.equal(session.preview(audio('header', 'one', 'two')), null);
  assert.equal(requests.length, 1);
  requests[0].resolve({ text: 'first guess' });
  await first;
  const second = session.preview(audio('header', 'one', 'two', 'three'));
  assert.equal(await requests[1].audio.text(), 'headeronetwothree');
  requests[1].resolve({ text: 'corrected words' });
  await second;
  assert.deepEqual(drafts, ['Keep my words\nfirst guess', 'Keep my words\ncorrected words']);
});

test('Send drops the late preview, waits for it and sends the final text exactly once', async () => {
  const { session, requests, drafts, finals } = setup();
  const preview = session.preview(audio('header', 'one'));
  assert.equal(session.stop(true), true);
  assert.equal(session.stop(true), false);
  assert.equal(session.stop(false), false);
  const done = session.finish(audio('header', 'one', 'last'));
  assert.equal(session.finish(audio('duplicate')), done);
  assert.equal(requests.length, 1);
  requests[0].resolve({ text: 'stale guess' });
  await preview;
  assert.deepEqual(drafts, []);
  assert.equal(requests.length, 2);
  assert.equal(await requests[1].audio.text(), 'headeronelast');
  requests[1].resolve({ text: 'Final words' });
  await done;
  assert.deepEqual(finals, [{ text: 'Keep my words\nFinal words', send: true }]);
  assert.equal(session.preview(audio('late')), null);
  await session.finish(audio('duplicate'));
  assert.equal(finals.length, 1);
});

test('stopping with the microphone leaves the final draft for editing', async () => {
  const { session, requests, finals } = setup('');
  session.stop();
  const done = session.finish(audio('header', 'last'));
  await Promise.resolve();
  requests[0].resolve({ text: 'Editable words' });
  await done;
  assert.deepEqual(finals, [{ text: 'Editable words', send: false }]);
});

for (const problem of ['Preparing voice model, try again in a minute', 'Transcription failed', '']) {
  test(`final failure preserves typed text and sends nothing: ${problem || 'no speech'}`, async () => {
    const { session, requests, drafts, finals, notices } = setup();
    const preview = session.preview(audio('header'));
    requests[0].resolve({ text: 'Draft voice' });
    await preview;
    session.stop(true);
    const done = session.finish(audio('header', 'last'));
    await Promise.resolve();
    if (problem) requests[1].reject(new Error(problem));
    else requests[1].resolve({ text: ' ' });
    await done;
    assert.equal(drafts.at(-1), 'Keep my words ');
    assert.deepEqual(finals, []);
    assert.equal(notices.at(-1), problem || 'No speech was heard. Try again or type your message.');
  });
}

for (const ending of ['preview', 'final']) {
  test(`leaving the chat aborts and ignores a late ${ending} reply`, async () => {
    const { session, requests, drafts, finals, notices } = setup();
    let done;
    if (ending === 'preview') done = session.preview(audio('header'));
    else { session.stop(true); done = session.finish(audio('header')); await Promise.resolve(); }
    session.dispose();
    assert.equal(requests[0].signal.aborted, true);
    requests[0].resolve({ text: 'stale' });
    await done;
    assert.deepEqual([drafts, finals, notices], [[], [], []]);
  });
}

test('capture failure restores the original and invalidates the preview', async () => {
  const { session, requests, drafts, finals, notices } = setup();
  const preview = session.preview(audio('header'));
  session.fail('The microphone stopped unexpectedly. Try recording again.');
  requests[0].resolve({ text: 'stale' });
  await preview;
  assert.deepEqual(drafts, ['Keep my words ']);
  assert.deepEqual(finals, []);
  assert.match(notices[0], /microphone stopped/);
});

test('a failed live request leaves the session able to transcribe the final recording', async () => {
  const { session, requests, finals } = setup();
  const preview = session.preview(audio('header'));
  requests[0].reject(new Error('Preparing voice model, try again in a minute'));
  await preview;
  session.stop(true);
  const done = session.finish(audio('header', 'last'));
  await Promise.resolve();
  requests[1].resolve({ text: 'Ready now' });
  await done;
  assert.deepEqual(finals, [{ text: 'Keep my words\nReady now', send: true }]);
});

test('a final transcript identical to the live draft still sends once', async () => {
  const { session, requests, finals } = setup('');
  const preview = session.preview(audio('header'));
  requests[0].resolve({ text: 'Same words' });
  await preview;
  session.stop(true);
  const done = session.finish(audio('header', 'last'));
  await Promise.resolve();
  requests[1].resolve({ text: 'Same words' });
  await done;
  assert.deepEqual(finals, [{ text: 'Same words', send: true }]);
});

test('leaving while the final request is queued drops both requests and sends nothing', async () => {
  const { session, requests, drafts, finals } = setup();
  session.preview(audio('header'));
  session.stop(true);
  const done = session.finish(audio('header', 'last'));
  session.dispose();
  requests[0].resolve({ text: 'stale' });
  await done;
  assert.equal(requests.length, 1);
  assert.deepEqual([drafts, finals], [[], []]);
});
