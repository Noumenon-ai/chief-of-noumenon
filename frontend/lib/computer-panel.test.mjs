import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computerPanelKey, computerPanelOpen, readComputerPanel, writeComputerPanel } from './computer-panel.ts';

test('only running computers open automatically; explicit choices win across state changes', () => {
  for (const state of [null, undefined, 'stopped', 'starting', 'error', 'running']) {
    assert.equal(computerPanelOpen(undefined, state), state === 'running');
    assert.equal(computerPanelOpen(true, state), true);
    assert.equal(computerPanelOpen(false, state), false);
  }
});
test('choices survive reads and are isolated by bot', () => {
  const data = new Map();
  const storage = () => ({ getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) });
  assert.equal(readComputerPanel(storage, 1), undefined);
  assert.equal(writeComputerPanel(storage, 1, false), true);
  assert.equal(writeComputerPanel(storage, 2, true), true);
  assert.equal(readComputerPanel(storage, 1), false);
  assert.equal(readComputerPanel(storage, 2), true);
  data.set(computerPanelKey(3), 'invalid');
  assert.equal(readComputerPanel(storage, 3), undefined);
});
test('blocked storage getters and methods remain usable without persistence', () => {
  const blocked = () => { throw new Error('Blocked'); };
  for (const storage of [blocked, () => ({ getItem: blocked, setItem: blocked })]) {
    assert.equal(readComputerPanel(storage, 1), undefined);
    assert.equal(writeComputerPanel(storage, 1, true), false);
    assert.equal(computerPanelOpen(readComputerPanel(storage, 1), 'running'), true);
  }
});
