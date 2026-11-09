import { appendTranscript } from "./control-room.ts";

export type VoicePhase = "idle" | "starting" | "recording" | "transcribing";

// A session owns one recording's draft and request queue. Full audio snapshots
// always include the container header; a busy preview tick is simply skipped.
export function createVoiceSession(options: {
  draft: string;
  transcribe: (audio: Blob, signal: AbortSignal) => Promise<{ text: string }>;
  onDraft: (text: string) => void;
  onFinal: (text: string, send: boolean) => void;
  onNotice: (text: string | null) => void;
}) {
  let phase: "recording" | "ending" | "done" | "disposed" = "recording";
  let pending: Promise<void> | null = null;
  let final: Promise<void> | null = null;
  let send = false;
  let sequence = 0;
  let shown = 0;
  const controller = new AbortController();
  const active = () => phase !== "disposed";
  const message = (error: unknown) => error instanceof Error ? error.message : "Transcription failed. Try again or type your message.";

  return {
    preview(audio: Blob): Promise<void> | null {
      if (phase !== "recording" || pending || !audio.size) return null;
      const revision = ++sequence;
      pending = (async () => {
        try {
          const result = await options.transcribe(audio, controller.signal);
          if (phase !== "recording" || revision <= shown) return;
          shown = revision;
          if (result.text.trim()) {
            options.onDraft(appendTranscript(options.draft, result.text));
            options.onNotice(null);
          }
        } catch (error) {
          if (phase === "recording") options.onNotice(message(error));
        } finally { pending = null; }
      })();
      return pending;
    },
    stop(shouldSend = false): boolean {
      if (phase !== "recording") return false;
      phase = "ending";
      send = shouldSend;
      return true;
    },
    finish(audio: Blob): Promise<void> {
      if (final) return final;
      if (phase !== "ending") return Promise.resolve();
      final = (async () => {
        // Let an existing request finish before starting the final one. Its
        // result is already stale because stop changed the phase synchronously.
        await pending;
        if (!active()) return;
        try {
          const result = await options.transcribe(audio, controller.signal);
          if (!active()) return;
          if (!result.text.trim()) throw new Error("No speech was heard. Try again or type your message.");
          phase = "done";
          options.onFinal(appendTranscript(options.draft, result.text), send);
          options.onNotice(send ? null : "Added to your draft. Read it before sending.");
        } catch (error) {
          if (!active()) return;
          phase = "done";
          options.onDraft(options.draft);
          options.onNotice(message(error));
        }
      })();
      return final;
    },
    fail(notice: string) {
      if (!active()) return;
      phase = "disposed";
      controller.abort();
      options.onDraft(options.draft);
      options.onNotice(notice);
    },
    dispose() {
      phase = "disposed";
      controller.abort();
    },
  };
}

export type VoiceSession = ReturnType<typeof createVoiceSession>;
