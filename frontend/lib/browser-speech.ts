import { appendTranscript } from "./control-room.ts";
import type { VoicePhase } from "./voice-session.ts";

// The Web Speech API is not included in TypeScript's DOM library.
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
export type SpeechHost = {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
// Remounting the recorder for another thread must not retry a broken service.
// A full page reload gets a new window and can try the browser again.
const unavailable = new WeakSet<SpeechHost>();
const PRIVACY_KEY = "open-duet:browser-speech-notice";

export function showBrowserSpeechPrivacy(): boolean {
  try {
    if (localStorage.getItem(PRIVACY_KEY)) return false;
    localStorage.setItem(PRIVACY_KEY, "1");
  } catch { /* Recording still works when device storage is unavailable. */ }
  return true;
}

export function browserSpeechLanguage(languages: string[], selected: string, deviceLanguage: string): string {
  const language = languages.length === 1 ? languages[0] : selected;
  if (language === "auto" || (languages.length > 0 && !languages.includes(language))) return deviceLanguage;
  return language === "en" ? "en-US" : language;
}

export function createBrowserSpeech(options: {
  enabled: boolean;
  host: SpeechHost;
  language: string;
  draft: string;
  onDraft: (text: string) => void;
  onFinal: (text: string, send: boolean) => void;
  onNotice: (text: string | null) => void;
  onPhase: (phase: VoicePhase) => void;
  onFallback: (draft: string, send: boolean) => void;
  // Android Chrome repeats earlier words across results in continuous mode,
  // so there each utterance is its own recognition and listening restarts.
  continuous?: boolean;
}) {
  if (!options.enabled || unavailable.has(options.host)) return null;
  const Constructor = options.host.SpeechRecognition ?? options.host.webkitSpeechRecognition;
  if (!Constructor) return null;
  let phase: "new" | "listening" | "ending" | "done" = "new";
  let recognition: Recognition | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gathered = "";
  let live = "";
  let send = false;
  const speech = () => [gathered, live].filter(Boolean).join(" ").trim();
  const draft = () => speech() ? appendTranscript(options.draft, speech()) : options.draft;
  const detach = () => {
    const old = recognition;
    recognition = null;
    if (old) {
      old.onresult = old.onerror = old.onend = null;
      try { old.abort(); } catch { /* It may already have ended. */ }
    }
  };
  const dispose = () => {
    phase = "done";
    clearTimeout(timer);
    detach();
  };
  const finish = () => {
    if (phase === "done") return;
    dispose();
    if (speech()) {
      options.onFinal(draft(), send);
      options.onNotice(send ? null : "Added to your draft. Read it before sending.");
    } else {
      options.onDraft(options.draft);
      options.onNotice("No speech was heard. Try again or type your message.");
    }
    options.onPhase("idle");
  };
  const fail = (error: string) => {
    if (phase === "done") return;
    if (error === "no-speech") return; // The following end event restarts listening.
    dispose();
    if (["network", "audio-capture", "language-not-supported"].includes(error)) {
      unavailable.add(options.host);
      options.onNotice("voice.browserFallback");
      options.onFallback(draft(), send);
    } else {
      options.onDraft(draft());
      options.onNotice(["not-allowed", "service-not-allowed"].includes(error)
        ? "Microphone permission was denied. Allow it in browser settings, or type your message."
        : "The microphone stopped unexpectedly. Try recording again.");
      options.onPhase("idle");
    }
  };
  const listen = () => {
    if (phase !== "listening") return;
    try {
      const current = new Constructor();
      recognition = current;
      current.continuous = options.continuous ?? true;
      current.interimResults = true;
      current.lang = options.language;
      current.onresult = event => {
        if (recognition !== current || phase === "done") return;
        // Results are a complete snapshot for this recognition, including finals.
        // Replace the previous snapshot; appending would duplicate interim words.
        live = Array.from(event.results, result => result[0]?.transcript.trim() ?? "").filter(Boolean).join(" ");
        options.onDraft(draft());
      };
      current.onerror = event => { if (recognition === current) fail(event.error); };
      current.onend = () => {
        if (recognition !== current || phase === "done") return;
        if (phase === "ending") { finish(); return; }
        gathered = speech();
        live = "";
        detach();
        timer = setTimeout(listen, 100);
      };
      current.start();
    } catch (error) {
      fail(error instanceof Error && ["NotAllowedError", "SecurityError"].includes(error.name) ? "not-allowed" : "audio-capture");
    }
  };
  return {
    start() {
      if (phase !== "new") return;
      phase = "listening";
      options.onPhase("recording");
      listen();
    },
    stop(shouldSend = false) {
      if (phase !== "listening") return;
      phase = "ending";
      send = shouldSend;
      clearTimeout(timer);
      options.onPhase("transcribing");
      if (!recognition) { finish(); return; }
      // stop requests a final result. abort is reserved for disposal/timeout.
      timer = setTimeout(finish, 1500);
      try { recognition.stop(); } catch { finish(); }
    },
    dispose,
  };
}

export type BrowserSpeechSession = NonNullable<ReturnType<typeof createBrowserSpeech>>;
