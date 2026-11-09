// Browser-only convenience. Blocked or invalid storage falls back to live state.
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export const computerPanelKey = (botId: number) => `od-computer-panel-${botId}`;

export function readComputerPanel(storage: () => StorageLike, botId: number): boolean | undefined {
  try {
    const value = storage().getItem(computerPanelKey(botId));
    return value === "open" ? true : value === "closed" ? false : undefined;
  } catch {
    return undefined;
  }
}

export function writeComputerPanel(storage: () => StorageLike, botId: number, open: boolean): boolean {
  try {
    storage().setItem(computerPanelKey(botId), open ? "open" : "closed");
    return true;
  } catch {
    return false;
  }
}

export function computerPanelOpen(choice: boolean | undefined, state?: string | null): boolean {
  return choice ?? state === "running";
}
