export type VoiceSettings = { languages: string[]; default: "auto"; browser_speech: boolean };
const KEY = "open-duet:voice-language";
type Store = Pick<Storage, "getItem" | "setItem">;

function defaultStore(): Store | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

export function loadVoiceLanguage(settings: VoiceSettings, store: Store | null = defaultStore()): string {
  try {
    const saved = store?.getItem(KEY);
    return saved && (saved === "auto" || settings.languages.includes(saved)) ? saved : settings.default;
  } catch { return settings.default; }
}

export function saveVoiceLanguage(language: string, store: Store | null = defaultStore()): void {
  try { store?.setItem(KEY, language); } catch { /* Storage can be blocked or full. */ }
}

export function voiceLanguageName(code: string): string {
  if (code === "he") return "עברית";
  if (code === "en") return "English";
  try { return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code; }
  catch { return code; }
}
