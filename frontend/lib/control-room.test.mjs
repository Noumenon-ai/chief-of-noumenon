import assert from "node:assert/strict";
import { test } from "node:test";
import { appendTranscript, channelSnapshot, recordingProblem } from "./control-room.ts";

test("voice appends to the draft for review and never erases typed text", () => {
  assert.equal(appendTranscript("Typed message ", " שלום "), "Typed message\nשלום");
  assert.equal(appendTranscript("", " hello "), "hello");
  assert.equal(appendTranscript("Keep this", " "), "Keep this");
});
test("insecure and unsupported recording have actionable explanations", () => {
  assert.match(recordingProblem(false, false), /HTTPS/);
  assert.match(recordingProblem(true, false), /cannot record/);
  assert.equal(recordingProblem(true, true), null);
});
test("rail previews come from the latest real turn and waiting outranks activity", () => {
  assert.deepEqual(channelSnapshot({ turns: [{ prompt_text: "hello", result: "reply" }], active_turn_id: 4 }, 1), { preview: "reply", working: true, waiting: true });
  assert.equal(channelSnapshot({ turns: [{ prompt_text: "new message", result: null }], active_turn_id: 4 }, 0).preview, "new message");
  assert.deepEqual(channelSnapshot({ turns: [], active_turn_id: null }, 0), { preview: "", working: false, waiting: false });
});

import { approvalTitle, channelOrder, engineName, previewText, receiptLabel, relativeReceipt, waitingNotification } from "./control-room.ts";
import { mergeReceipts } from "./transcript-view.ts";
test("engine labels use human names and local model names", () => {
  assert.equal(engineName("claude"), "Claude");
  assert.equal(engineName("codex", "default"), "Codex");
  assert.equal(engineName("openai_compat", "Qwen 3"), "Qwen 3");
  assert.equal(engineName("openai_compat"), "Local model");
});
test("previews remove Markdown while retaining the words", () => {
  assert.equal(previewText("**Done**: `apps_search` found [the page](https://example.org).\n> Next"), "Done: apps_search found the page. Next");
  assert.equal(channelSnapshot({ turns: [{ result: "`hello` **world**" }], active_turn_id: null }, 0).preview, "hello world");
});
test("lead comes first, then recent activity; archived bots and chats do not affect selection", () => {
  const agents = [1, 2, 3, 4].map(id => ({ id, name: `Bot ${id}`, archived_at: id === 4 ? "2026-01-01" : null }));
  const threads = [{ agent_id: 3, updated_at: "2026-10-01", archived_at: null }, { agent_id: 2, updated_at: "2026-11-01", archived_at: null }, { agent_id: 1, updated_at: "2026-11-02", archived_at: "2026-11-02" }];
  assert.deepEqual(channelOrder(agents, threads, 1).map(a => a.id), [1, 2, 3]);
  assert.deepEqual(channelOrder(agents, threads, null).map(a => a.id), [2, 3, 1]);
  assert.deepEqual(channelOrder([], threads, 1), []);
});
test("receipts label tools and show paths relative to the bot folder", () => {
  assert.equal(receiptLabel("mcp__computer__browser_open"), "Opened page in browser");
  assert.equal(receiptLabel("Write"), "Write file");
  assert.equal(relativeReceipt("/host/bots/chief/src/main.ts", "/host/bots/chief"), "src/main.ts");
  assert.equal(relativeReceipt("/elsewhere/private/file.txt", "/host/bots/chief"), "file.txt");
  assert.equal(relativeReceipt("https://example.org/page"), "https://example.org/page");
});
test("one receipt per approved call, matching each repeated call only once and preserving other turns", () => {
  const call = (key, turnId = 1) => ({ kind: "tool", key, turnId, name: "Write", input: { path: "file.txt" } });
  const approval = (key, status = "denied") => ({ kind: "approval", key, turnId: 1, tool: "Write", input: { path: "file.txt" }, status });
  assert.deepEqual(mergeReceipts([call("a"), approval("b"), call("c"), approval("d", "pending"), call("e", 2)]).map(x => x.key), ["b", "d", "e"]);
  assert.equal(mergeReceipts([call("a"), { ...approval("b"), input: { path: "other.txt" } }]).length, 2);
});
test("only waiting notifications use the signal", () => {
  assert.equal(waitingNotification("needs_you"), true);
  assert.equal(waitingNotification("needs_input"), true);
  assert.equal(waitingNotification("routine_needs_input"), true);
  assert.equal(waitingNotification("approval_requested"), true);
  assert.equal(waitingNotification("routine_completed"), false);
  assert.equal(waitingNotification("failed"), false);
});

test("merged receipts retain the actual execution outcome and output", () => {
  const tool = { kind: "tool", key: "call", turnId: 1, name: "Write", input: {}, state: "error", output: "Disk full" };
  const approval = { kind: "approval", key: "approval", turnId: 1, tool: "Write", input: {}, status: "allowed" };
  const [merged] = mergeReceipts([tool, approval]);
  assert.equal(merged.status, "allowed");
  assert.deepEqual(merged.toolResult, tool);
});

test("approval titles say what the bot wants in plain words", () => {
  assert.equal(approvalTitle("Write", "Chief"), "Chief wants to write a file");
  assert.equal(approvalTitle("Bash", "Chief"), "Chief wants to run a command");
  assert.equal(approvalTitle("mcp__computer__browser_open", "Builder"), "Builder wants to open a page in its browser");
  assert.equal(approvalTitle("mcp__composio__apps_run", "Inbox"), "Inbox wants to use a connected app");
  assert.ok(!approvalTitle("mcp__x__odd_tool", "Chief").includes("mcp__"));
});

import { hasStarterTeam, greetingKey } from "./control-room.ts";
test("starter action hides only when all four active specialists exist", () => {
  const team = ["Inbox", "Calendar", "Research", "Builder"].map(name => ({ name, archived_at: null }));
  assert.equal(hasStarterTeam(null), false);
  assert.equal(hasStarterTeam([]), false);
  assert.equal(hasStarterTeam(team.slice(1)), false);
  assert.equal(hasStarterTeam(team.map(a => a.name === "Inbox" ? { ...a, archived_at: "2026-11-04" } : a)), false);
  assert.equal(hasStarterTeam(team), true);
  assert.equal(hasStarterTeam([...team, { name: "Chief", archived_at: null }]), true);
});
test("greetings follow the local hour at morning, afternoon and evening boundaries", () => {
  for (const hour of [0, 8, 11]) assert.equal(greetingKey(hour), "chat.goodMorning");
  for (const hour of [12, 17]) assert.equal(greetingKey(hour), "chat.goodAfternoon");
  for (const hour of [18, 23]) assert.equal(greetingKey(hour), "chat.goodEvening");
});

const { chatStarters } = await import('./control-room.ts');
const { translate } = await import('./i18n.ts');

test('chat suggestions use one real active bot name and exclude the open bot', () => {
  const bots = [
    { id: 1, name: 'Chief', archived_at: null },
    { id: 2, name: 'Research', archived_at: '2026-01-01' },
    { id: 3, name: 'Calendar', archived_at: null },
    { id: 4, name: 'Builder', archived_at: null },
  ];
  const starters = chatStarters(bots, 1);
  assert.deepEqual(starters.map(s => s.key), ['chat.starterReminder', 'chat.starterPdf', 'chat.starterBot']);
  assert.equal(translate('en', starters[2].key, starters[2].params), 'Ask Calendar to look into...');
  assert.match(translate('he', starters[2].key, starters[2].params), /Calendar/);
});

test('Research casing is preserved only when that other bot actually exists', () => {
  for (const name of ['Research', 'research', 'RESEARCH']) {
    const bots = [{ id: 1, name, archived_at: null }];
    assert.equal(chatStarters(bots, 2)[2].params.name, name);
    assert.equal(chatStarters(bots, 1)[2].key, 'chat.starterReply');
  }
  assert.equal(chatStarters([], null)[2].key, 'chat.starterReply');
  assert.equal(translate('en', 'chat.starterReply'), 'Draft a reply to...');
  assert.notEqual(translate('he', 'chat.starterReply'), translate('en', 'chat.starterReply'));
});
