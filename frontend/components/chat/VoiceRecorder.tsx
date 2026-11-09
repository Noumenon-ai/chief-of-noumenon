"use client";
import { browserSpeechLanguage, createBrowserSpeech, showBrowserSpeechPrivacy, type BrowserSpeechSession, type SpeechHost } from "@/lib/browser-speech";
import { Mic, Square } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { request } from "@/lib/api";
import { recordingProblem } from "@/lib/control-room";
import { useT } from "@/lib/use-i18n";
import { loadVoiceLanguage, saveVoiceLanguage, voiceLanguageName, type VoiceSettings } from "@/lib/voice-language";

import { createVoiceSession, type VoicePhase, type VoiceSession } from "@/lib/voice-session";

export type VoiceRecorderHandle = { stopAndSend: () => void };

const LIMIT = 20 * 1024 * 1024;

// Unmounting (including changing chats) stops capture and discards its result.
export function VoiceRecorder({ ref, draft, onDraft, onFinal, onPhase, disabled }: {
  ref: Ref<VoiceRecorderHandle>;
  draft: string;
  onDraft: (text: string) => void;
  onFinal: (text: string, send: boolean) => void;
  onPhase: (phase: VoicePhase) => void;
  disabled: boolean;
}) {
  const t = useT();
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings | null>(null);
  const [language, setLanguage] = useState("auto");
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [privacyNotice, setPrivacyNotice] = useState(false);
  const [usingBrowser, setUsingBrowser] = useState(false);
  const browserSession = useRef<BrowserSpeechSession | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const session = useRef<VoiceSession | null>(null);
  const stopCapture = useRef<(send?: boolean) => void>(() => {});
  const clearTimers = useRef<() => void>(() => {});
  const busy = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ draft, onDraft, onFinal, onPhase });
  useEffect(() => { callbacks.current = { draft, onDraft, onFinal, onPhase }; }, [draft, onDraft, onFinal, onPhase]);
  const changePhase = (next: VoicePhase) => {
    setPhase(next);
    callbacks.current.onPhase(next);
  };
  useImperativeHandle(ref, () => ({ stopAndSend: () => stopCapture.current(true) }), []);
  useEffect(() => {
    const controller = new AbortController();
    void request<{ voice?: VoiceSettings | null }>("/local/status", { signal: controller.signal }).then(result => {
      if (controller.signal.aborted || !result.voice) return;
      setVoiceSettings(result.voice);
      setLanguage(loadVoiceLanguage(result.voice));
    }).catch(() => { /* Auto remains available if settings cannot be read. */ });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      browserSession.current?.dispose();
      session.current?.dispose();
      clearTimers.current();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const recordLocally = async (initialDraft = callbacks.current.draft, sendOnStart = false) => {
    setUsingBrowser(false);
    const problem = recordingProblem(window.isSecureContext, !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
    if (problem) { busy.current = false; changePhase("idle"); setNotice(problem); return; }
    busy.current = true;
    changePhase("starting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const capture = new MediaRecorder(media);
      recorder.current = capture;
      const chunks: Blob[] = [];
      let size = 0;
      let failed = false;
      const current = createVoiceSession({
        draft: initialDraft,
        transcribe: (audio, signal) => request<{ text: string }>(`/voice/transcribe?language=${encodeURIComponent(language)}`, {
          method: "POST", body: audio,
          headers: { "Content-Type": capture.mimeType || "application/octet-stream" }, signal,
        }),
        onDraft: text => callbacks.current.onDraft(text),
        onFinal: (text, send) => callbacks.current.onFinal(text, send),
        onNotice: setNotice,
      });
      session.current = current;
      const snapshot = () => new Blob(chunks, { type: capture.mimeType });
      const stop = (send = false) => {
        if (!current.stop(send)) return;
        clearTimers.current();
        changePhase("transcribing");
        if (capture.state === "recording") capture.stop();
      };
      stopCapture.current = stop;
      capture.ondataavailable = event => {
        if (!mounted.current || failed) return;
        size += event.data.size;
        if (size > LIMIT) {
          failed = true;
          current.fail("The recording reached 20 MB. Record a shorter message.");
          // fail has already ended the session, but capture still needs stopping.
          clearTimers.current();
          if (capture.state === "recording") capture.stop();
        } else if (event.data.size) { chunks.push(event.data); }
      };
      capture.onerror = () => {
        failed = true;
        clearTimers.current();
        if (mounted.current) current.fail("The microphone stopped unexpectedly. Try recording again.");
        if (capture.state === "recording") capture.stop();
        media.getTracks().forEach(track => track.stop());
        // MediaRecorder follows an error with stop. Keep this session busy
        // until that event, so its cleanup cannot interrupt a new recording.
      };
      capture.onstop = async () => {
        clearTimers.current();
        media.getTracks().forEach(track => track.stop());
        if (!mounted.current) { chunks.length = 0; return; }
        if (!failed) {
          // Capture can also end by itself, which always leaves an editable draft.
          current.stop();
          changePhase("transcribing");
          await current.finish(snapshot());
        }
        chunks.length = 0;
        if (mounted.current) { busy.current = false; changePhase("idle"); }
      };
      capture.start(250);
      const previewTimer = setInterval(() => { void current.preview(snapshot()); }, 1500);
      const limitTimer = setTimeout(() => stop(), 20 * 60 * 1000);
      clearTimers.current = () => { clearInterval(previewTimer); clearTimeout(limitTimer); };
      changePhase("recording");
      if (sendOnStart) stop(true);
    } catch (error) {
      session.current?.dispose();
      clearTimers.current();
      stream.current?.getTracks().forEach(track => track.stop());
      if (!mounted.current) return;
      busy.current = false;
      changePhase("idle");
      setNotice(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow it in browser settings, or type your message."
        : "The microphone could not be opened. Check that it is connected and available.");
    }
  };
  const record = () => {
    if (phase === "recording") { stopCapture.current(); return; }
    if (busy.current) return;
    setNotice(null);
    const current = createBrowserSpeech({
      enabled: voiceSettings?.browser_speech === true,
      host: window as SpeechHost,
      continuous: !/Android/i.test(navigator.userAgent),
      language: browserSpeechLanguage(voiceSettings?.languages ?? [], language, navigator.language),
      draft: callbacks.current.draft,
      onDraft: text => callbacks.current.onDraft(text),
      onFinal: (text, send) => callbacks.current.onFinal(text, send),
      onNotice: setNotice,
      onPhase: next => { if (next === "idle") busy.current = false; changePhase(next); },
      onFallback: (text, send) => { void recordLocally(text, send); },
    });
    if (!current) { void recordLocally(); return; }
    busy.current = true;
    setUsingBrowser(true);
    browserSession.current = current;
    stopCapture.current = send => current.stop(send);
    if (showBrowserSpeechPrivacy()) setPrivacyNotice(true);
    current.start();
  };
  const label = t(phase === "recording" ? "voice.stop" : phase === "starting" ? "voice.opening" : phase === "transcribing" ? usingBrowser ? "voice.finishing" : "voice.transcribing" : "voice.record");
  return <><div className="voice-recorder">
    {(voiceSettings?.languages.length ?? 0) > 1 && <select aria-label={t("voice.language")} title={t("voice.language")} value={language} disabled={disabled || phase !== "idle" || !voiceSettings} onChange={event => {
      setLanguage(event.target.value);
      saveVoiceLanguage(event.target.value);
    }}>
      <option value="auto">{t("voice.auto")}</option>
      {voiceSettings?.languages.map(code => <option key={code} value={code} lang={code}>{voiceLanguageName(code)}</option>)}
    </select>}
    <button type="button" aria-label={label} title={label} aria-pressed={phase === "recording"} disabled={(disabled && phase !== "recording") || phase === "starting" || phase === "transcribing"} onClick={() => void record()}>
    {phase === "recording" ? <Square size={18} /> : <Mic size={18} />}
  </button>{(notice || phase !== "idle") && <span role="status">{notice ? t(notice) : phase === "recording" ? t("voice.recording") : label}</span>}</div>
    {privacyNotice && <p role="note" className="mx-2 mt-14 mb-2 text-xs text-muted">{t("voice.browserPrivacy")}</p>}</>;
}
