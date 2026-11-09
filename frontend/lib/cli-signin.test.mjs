import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Codex setup directs sign-in to the official CLI and refreshes detection', () => {
  const source = readFileSync(new URL('../components/CodexEngineSetup.tsx', import.meta.url), 'utf8');
  assert.match(source, /Install Codex from OpenAI/);
  assert.match(source, /<code>codex login<\/code>/);
  assert.match(source, /onClick=\{onChanged\}>Refresh/);
  assert.doesNotMatch(source, /authorization_url|user_code|startCodexLogin|setInterval/);
});

test('API client has no Codex sign-in endpoints and retains sign-out and API key configuration', () => {
  const source = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\/engines\/codex\/login|CodexLoginOperation/);
  assert.match(source, /logoutCodexEngine/);
  assert.match(source, /saveEngineConfig/);
  assert.match(source, /api_key\?: string/);
});

import { receiptLabel } from './control-room.ts';
for (const [tool, label] of [['read', 'Read file'], ['write', 'Write file'], ['edit', 'Edit file'],
  ['shell', 'Run command'], ['glob', 'Find files'], ['grep', 'Search files']]) {
  test(`brokered ${tool} receipt retains a plain label`, () => {
    assert.equal(receiptLabel(`api__${tool}`), label);
    assert.equal(receiptLabel(`mcp__bot_files__${tool}`), label);
  });
}
