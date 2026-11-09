import type { ThreadDetail } from "./api";

export type ChannelSnapshot = { preview: string; working: boolean; waiting: boolean; error?: boolean };
export function channelSnapshot(thread: ThreadDetail, pending: number): ChannelSnapshot {
  const latest = thread.turns.at(-1);
  return { preview: previewText(latest?.result || latest?.prompt_text || ""), working: thread.active_turn_id !== null, waiting: pending > 0 };
}

export function appendTranscript(draft: string, text: string): string {
  return [draft.trimEnd(), text.trim()].filter(Boolean).join("\n");
}

export function recordingProblem(secure: boolean, supported: boolean): string | null {
  if (!secure) return "Microphone recording needs HTTPS or localhost. Open this app on a secure page.";
  if (!supported) return "This browser cannot record audio. Type your message instead.";
  return null;
}

// Shared presentation rules; provider identifiers never serve as display names.
export function engineName(provider: string, model?: string | null): string {
  const names: Record<string, string> = { claude: "Claude", codex: "Codex", openai: "OpenAI", openai_compat: "Local model", ollama: "Ollama" };
  if (provider === "openai_compat" || provider === "ollama") return model && model !== "default" ? model : names[provider];
  return names[provider] ?? provider.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
export function previewText(text: string): string {
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*>#|~]/g, "").replace(/(?<!\w)_{1,2}|_{1,2}(?!\w)/g, "").replace(/^\s*[-+]\s+/gm, "").replace(/\s+/g, " ").trim();
}
export function channelOrder<T extends { id: number; archived_at: string | null; name: string }>(agents: readonly T[] | null, threads: readonly { agent_id?: number | null; updated_at: string; archived_at: string | null }[] | null, lead: number | null): T[] {
  const activity = new Map<number, number>();
  for (const thread of threads ?? []) if (thread.agent_id && !thread.archived_at) activity.set(thread.agent_id, Math.max(activity.get(thread.agent_id) ?? 0, Date.parse(thread.updated_at) || 0));
  return (agents ?? []).filter(a => !a.archived_at).sort((a, b) => Number(b.id === lead) - Number(a.id === lead) || (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0) || a.name.localeCompare(b.name));
}
export function approvalTitle(tool: string, bot: string): string {
  const name = tool.split("__").at(-1)!.toLowerCase();
  const actions: Record<string, string> = { write: "write a file", write_file: "write a file", edit: "edit a file", multiedit: "edit a file", bash: "run a command", exec: "run a command", commandexecution: "run a command", apps_run: "use a connected app", browser_open: "open a page in its browser", shell: "run a command" };
  return `${bot} wants to ${actions[name] ?? `use ${receiptLabel(tool)}`}`;
}
export function receiptLabel(tool: string): string {
  const name = tool.split("__").at(-1)!.toLowerCase();
  const labels: Record<string, string> = { browser_open: "Opened page in browser", browser_action: "Used browser", browser_snapshot: "Read browser page", screenshot: "Captured screen", write: "Write file", edit: "Edit file", read: "Read file", bash: "Run command", exec: "Run command", shell: "Run command", glob: "Find files", grep: "Search files", apps_search: "Searched apps", apps_run: "Used app", handoff: "Computer hand-off" };
  return labels[name] ?? name.replace(/[_-]/g, " ").replace(/^./, c => c.toUpperCase());
}
export function relativeReceipt(text: string, workspace?: string | null): string {
  const base = workspace?.replace(/[\\/]+$/, "");
  const local = base ? text.split(base + "/").join("").split(base + "\\").join("") : text;
  // Outside the bot folder, show only the file name; host paths belong in Advanced.
  return local.replace(/mcp__[\w]+/g, receiptLabel).replace(/(?<![\w/])(?:[A-Za-z]:[\\/]|\/(?!\/))(?:[^\s"'<>:,{}\[\]\\/]+[\\/])+([^\s"'<>:,{}\[\]\\/]+)/g, (path, name, offset, source) => /https?:\/$/.test(source.slice(0, offset)) ? path : name);
}
export function waitingNotification(kind: string): boolean {
  return ["needs_you", "needs_input", "routine_needs_input", "approval_requested", "approval", "handoff"].includes(kind);
}

// These are the active specialist names created (or kept) by starter_team.py.
export function hasStarterTeam(agents: readonly { name: string; archived_at: string | null }[] | null): boolean {
  return ["Inbox", "Calendar", "Research", "Builder"].every(name => agents?.some(agent => agent.name === name && !agent.archived_at));
}

export function greetingKey(hour: number): "chat.goodMorning" | "chat.goodAfternoon" | "chat.goodEvening" {
  return hour < 12 ? "chat.goodMorning" : hour < 18 ? "chat.goodAfternoon" : "chat.goodEvening";
}

export function readableModel(value: string): string {
  return value.replace(/^(claude|codex)\//, "").replace(/^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/i, (_, name, major, minor) => `Claude ${name[0].toUpperCase() + name.slice(1)} ${major}.${minor}`);
}

export type StarterBot = { id: number; name: string; archived_at: string | null };
export function chatStarters(bots: readonly StarterBot[], openId: number | null) {
  const other = bots.find(bot => bot.id !== openId && !bot.archived_at && bot.name.trim());
  return [
    { key: "chat.starterReminder" },
    { key: "chat.starterPdf" },
    other ? { key: "chat.starterBot", params: { name: other.name } } : { key: "chat.starterReply" },
  ];
}
