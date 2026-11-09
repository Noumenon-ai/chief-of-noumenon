"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api";
import type { ChatCardItem } from "@/lib/transcript";
import { useT } from "@/lib/use-i18n";
import { useSession } from "@/components/AuthGate";
import { UserMessage } from "./items";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LocalApps, type AppConnection, type LocalCatalog } from "@/components/LocalApps";
import { appDescription } from "@/lib/local-apps-catalog";

export function ChatCard({ item, threadId, agentId, running }: { item: ChatCardItem; threadId: number; agentId?: number; running: boolean }) {
  const t = useT();
  const { session } = useSession();
  const admin = session?.scopes.includes("admin");
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<AppConnection | null>(null);
  const [level, setLevel] = useState("read");
  const [description, setDescription] = useState("");
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const lastAttempt = useRef<{ choice: number | null; label: string } | null>(null);
  const onConnected = useCallback((connection: AppConnection) => { setAccount(connection); setOpen(false); }, []);
  useEffect(() => {
    if (item.cardKind !== "connect" || item.answer || !admin) return;
    let live = true;
    request<LocalCatalog>("/integrations/connector").then(catalog => {
      if (!live) return;
      const app = catalog.providers.find(p => p.service === item.provider);
      if (!app) { setError(t("This app is unavailable.")); return; }
      setAvailable(true); setDescription(appDescription(app)); setError("");
      setAccount(catalog.connections.find(c => c.service === app.service && ["active", "added"].includes(c.status)) || null);
    }).catch(() => { if (live) setError(t("Could not load the app. Retry.")); });
    return () => { live = false; };
  }, [item.cardKind, item.provider, item.answer, admin, retry, t]);
  const answer = async (choice: number | null, label: string) => {
    if (lock.current || item.answer || answered || running) return;
    lastAttempt.current = { choice, label };
    lock.current = true; setBusy(true); setError("");
    try {
      if (item.cardKind === "connect") {
        if (!account || !agentId || !available) throw new Error("Unavailable");
        const grants = await request<Record<string, string>>(`/integrations/connector/grants/${agentId}`);
        await request(`/integrations/connector/grants/${agentId}`, { method: "PUT", body: JSON.stringify({ ...grants, [account.id]: level }) });
      }
      await request(`/threads/${threadId}/cards/${item.cardId}`, { method: "POST", body: JSON.stringify({ choice, ...(account ? { connection_id: account.id } : {}), ...(item.cardKind === "brief" ? { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}) }) });
      setAnswered(label);
    } catch { setError(t("Could not save your answer. Check the app and engine, then retry.")); }
    finally { setBusy(false); lock.current = false; }
  };
  const receipt = item.answer || answered;
  if (receipt && item.cardKind === "welcome" && receipt !== "Dismissed" && receipt !== t("Dismissed")) return <UserMessage item={{ kind: "user", key: item.key, turnId: null, text: t(receipt), attachments: [] }} threadId={threadId} />;
  if (receipt) return <p className="rounded-field border border-line px-3 py-2 text-sm" data-testid="answered-card">{item.cardKind === "connect" ? t("Connected") : t(receipt)}</p>;
  const choices = item.cardKind === "welcome" ? [t("Connect Gmail"), t("Set up a daily brief"), t("Just chat")] : item.cardKind === "brief" ? [t("Every morning at 8"), t("Not now")] : item.options;
  const disabled = busy || running || (item.cardKind !== "question" && !admin);
  return <article className="chat-choice-card space-y-3 rounded-card border border-line bg-surface p-4" aria-label={t(item.cardKind === "connect" ? "Connect app" : item.cardKind === "brief" ? "A daily brief" : item.cardKind === "welcome" ? "Welcome" : "Chat question")} data-testid={`chat-${item.cardKind}`}>
    {item.cardKind === "welcome" && <>
      <h2 className="font-semibold">{t("Hello, I’m {name}.", { name: item.name })}</h2>
      <p className="text-sm">{t("I can help plan your day, summarize a PDF, or draft a reply. What would you like to do first?")}</p>
    </>}
    {item.cardKind === "question" && <h2 dir="auto" className="break-words font-semibold">{item.question}</h2>}
    {item.cardKind === "brief" && <>
      <h2 className="font-semibold">{t("A daily brief")}</h2>
      <p className="text-sm">{t("A read-only summary of your day, every morning at 8 in your time zone. Gmail and Calendar are included once connected and allowed for this bot.")}</p>
    </>}
    {item.cardKind === "connect" ? <>
      <h2 className="font-semibold">{item.name}</h2>
      <p className="text-sm text-muted">{t(description)}</p>
      <p className="text-sm">{t("Bots read freely and ask before changing anything.")}</p>
      {item.brief && <p className="text-sm">{t("Your brief will cover this app once connected and allowed for this bot.")}</p>}
      {account ? <>
        <p className="text-sm">{t("Connected")} · {account.connectionName}</p>
        <label className="block text-sm">{t("Access for this bot")}<select value={level} disabled={disabled} onChange={e => setLevel(e.target.value)} className="mt-2 min-h-11 w-full rounded-field border border-line bg-surface px-3"><option value="read">{t("Read only")}</option><option value="act">{t("Read and ask to act")}</option></select></label>
        <Button variant="primary" disabled={disabled} onClick={() => void answer(null, t("Connected"))}>{t("Save access and continue")}</Button>
      </> : <Button variant="primary" disabled={disabled || !available} onClick={() => setOpen(true)}>{t("Connect")}</Button>}
      <Dialog focusFirstField open={open} onOpenChange={setOpen} title={`${t("Connect")} ${item.name}`}><LocalApps onlyProvider={item.provider} onConnected={onConnected} onCancel={() => setOpen(false)} /></Dialog>
    </> : <>
      <div className="space-y-2">{choices.map((option, index) => <button type="button" key={index} disabled={disabled} onClick={() => void answer(index, option)} className="flex min-h-11 w-full items-start gap-3 rounded-field border border-line px-3 py-3 text-start text-sm hover:bg-hover disabled:opacity-50"><span className="font-mono" aria-hidden="true">{String.fromCharCode(65 + index)}</span><span dir="auto" className="min-w-0 break-words">{option}</span></button>)}</div>
      {item.cardKind === "question" && <p className="text-sm text-muted">{t("or answer below")}</p>}
      {item.cardKind === "welcome" && <div className="flex justify-end border-t border-line pt-2"><Button size="sm" className="text-xs text-muted" variant="ghost" disabled={disabled} onClick={() => void answer(-1, t("Dismissed"))}>{t("Dismiss")}</Button></div>}
    </>}
    {!admin && item.cardKind !== "question" && <p className="text-sm">{t("Open this card in your owner browser.")}</p>}
    {error && <div role="alert" className="text-sm text-danger">{error}<Button type="button" disabled={busy} onClick={() => { if (lastAttempt.current) void answer(lastAttempt.current.choice, lastAttempt.current.label); else { setRetry(value => value + 1); setError(""); } }}>{t("Retry")}</Button></div>}
  </article>;
}
