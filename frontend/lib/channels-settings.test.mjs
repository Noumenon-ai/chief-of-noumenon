import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL("../components/ConnectTelegram.tsx", import.meta.url), "utf8");
const channels = readFileSync(new URL("../components/settings/ChannelsSettings.tsx", import.meta.url), "utf8");

test("Channels Settings describes optional alerts without selecting a chat bot", () => {
  assert.match(channels, /<TelegramSettings/);
  const ownerChannel = readFileSync(new URL("../components/TelegramSettings.tsx", import.meta.url), "utf8");
  assert.match(ownerChannel, /Telegram is off/);
  assert.match(ownerChannel, /without it/);
  assert.match(ownerChannel, /Allow and Deny/);
  assert.doesNotMatch(ownerChannel, /Default lead bot|setTelegramSettings/);
  assert.doesNotMatch(channels, /setIdentity|ConnectTelegram/);
});

test("legacy task identity stays local and does not offer an unusable Telegram link flow", () => {
  assert.match(component, /onLinked\(\{ guest: true \}\)/);
  assert.match(component, /existing task history/);
  assert.match(component, /onClick=\{onReset\}/);
  assert.doesNotMatch(component, /createLinkCode|waitingForLink|\/link |same account\/history/);
});

test("Channels has no hosted task link and legacy tasks redirects to chat", () => {
  assert.doesNotMatch(channels, /Boat|boat|href="\/tasks\/"/);
  const tasks = readFileSync(new URL("../app/tasks/page.tsx", import.meta.url), "utf8");
  assert.match(tasks, /router.replace\("\/chat\/"\)/);
  assert.doesNotMatch(tasks, /getProviders|SubmitTask/);
});
