// Human-facing descriptions may come from older backends or tool catalogs.
// Keep actual command names intact.
export function screenText(text: string): string {
  return text.replace(/Open (?:Dots|Duet)/g, "Chief of Noumenon")
    .replace(/an ACP agent/gi, "a custom command engine")
    .replace(/ACP agent/gi, "Custom command engine")
    .replace(/per-agent/gi, "per-bot")
    .replace(/(?<![\w-])agents\b/gi, "bots")
    .replace(/(?<![\w-])agent\b/gi, "bot");
}
