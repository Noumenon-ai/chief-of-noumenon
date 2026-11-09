// What a pairing code or a paired device may do, in words (docs/AUTH.md). No runtime imports, so node tests can load it.

export type PairingScope = "admin" | "chat" | "files" | "manage" | "assistant";

/** The pairing-code choices in the order the Access menu lists them. */
export const PAIRING_CHOICES: { value: PairingScope; label: string }[] = [
  { value: "assistant", label: "Assistant (chat and tasks; cannot approve)" },
  { value: "chat", label: "Chat only" },
  { value: "files", label: "Chat and files (open files the bot made)" },
  { value: "manage", label: "Chat, files and bots (create and edit bots, open files)" },
  { value: "admin", label: "Full access (settings, devices)" },
];

function describe(admin: boolean, files: boolean, manage: boolean): string {
  if (admin) return "full access";
  if (manage) return "chat, files and bots";
  return files ? "chat and files" : "chat only";
}

/** Short form for a code just created, for example "Chat and files". */
export function codeAccess(scope: PairingScope): string {
  if (scope === "assistant") return "Assistant (cannot approve)";
  const text = describe(scope === "admin", scope === "files", scope === "manage");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** For a device or browser row, from the scopes the server reports. */
export function deviceAccess(scopes: string[]): string {
  if (scopes.includes("assistant")) return "assistant (cannot approve)";
  return describe(scopes.includes("admin"), scopes.includes("files"), scopes.includes("manage"));
}
