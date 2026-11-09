"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { applyEvent, emptyTranscript, type Transcript } from "@/lib/transcript";

export type Connection = "idle" | "connecting" | "live" | "reconnecting" | "failed";

export type ThreadStream = {
  threadId: number | null;
  transcript: Transcript;
  connection: Connection;
  // Set only when the connection failed for good (the thread does not exist, access refused).
  error: string | null;
};

function initial(threadId: number | null): ThreadStream {
  return {
    threadId,
    transcript: emptyTranscript(),
    connection: threadId === null ? "idle" : "connecting",
    error: null,
  };
}

// Twice the server keepalive (15 s) plus slack.
const STALL_MS = 35_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

// One stream per open thread: the server replays every stored event from the
// start and then goes live, so loading history and following live updates are
// the same thing. After any drop it reconnects from the last event seen, so
// nothing is missed and nothing is shown twice.
export function useThreadStream(threadId: number | null): ThreadStream {
  const [state, setState] = useState<ThreadStream>(() => initial(threadId));

  useEffect(() => {
    if (threadId === null) return;
    const controller = new AbortController();
    let transcript = emptyTranscript();

    const publish = (patch: Partial<ThreadStream>) =>
      setState((prev) => ({
        ...(prev.threadId === threadId ? prev : initial(threadId)),
        ...patch,
        threadId,
      }));

    // A phone that sleeps, switches apps or changes network can leave the
    // stream open but dead: no error, no bytes. The server sends a keepalive
    // every 15 s, so silence longer than STALL_MS means the stream is gone.
    // Coming back to the page or the network also reconnects at once.
    let attempt: AbortController | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStall = () => { if (stallTimer !== null) clearTimeout(stallTimer); stallTimer = null; };
    const armStall = () => { clearStall(); stallTimer = setTimeout(() => attempt?.abort(), STALL_MS); };
    let quick = false;
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      quick = true;
      attempt?.abort();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    controller.signal.addEventListener("abort", () => {
      clearStall();
      attempt?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
    }, { once: true });

    (async () => {
      let delay = 500;
      while (!controller.signal.aborted) {
        attempt = new AbortController();
        quick = false;
        armStall();
        try {
          await api.streamThread(
            threadId,
            transcript.lastSeq === 0 ? null : transcript.lastSeq,
            (event) => {
              const next = applyEvent(transcript, event);
              if (next === transcript) return;
              transcript = next;
              publish({ transcript });
            },
            attempt.signal,
            () => {
              delay = 500;
              publish({ connection: "live", error: null });
            },
            armStall
          );
        } catch (err) {
          if (controller.signal.aborted) return;
          // Not worth retrying: the thread is not there, or access is refused.
          if (err instanceof ApiError && [400, 403, 404].includes(err.status)) {
            publish({
              connection: "failed",
              error: err.status === 404 ? "This conversation was not found." : err.message,
            });
            return;
          }
        }
        clearStall();
        if (controller.signal.aborted) return;
        publish({ connection: "reconnecting" });
        if (quick) { delay = 500; continue; }
        await sleep(delay, controller.signal);
        delay = Math.min(delay * 2, 8000);
      }
    })();

    return () => controller.abort();
  }, [threadId]);

  return state.threadId === threadId ? state : initial(threadId);
}
