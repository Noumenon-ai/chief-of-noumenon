"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/api";
import { SettingsCard } from "./SettingsCard";
import { Button } from "@/components/ui/Button";
import { Field, Textarea, CONTROL } from "@/components/ui/Input";
import { Banner } from "@/components/ui/Banner";

type Draft = { id: string; text: string; networks: string[]; kind: "draft" | "saved_post" };
type Review = { lengths: Record<string, { characters: number; budget: number; over_budget: boolean }>; link_count: number; near_duplicates: { id: string; kind: string }[]; privacy_alert: boolean; privacy_preview: string };
export function PostDraftSettings() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [text, setText] = useState("");
  const [network, setNetwork] = useState("X");
  const [kind, setKind] = useState<Draft["kind"]>("draft");
  const [id, setId] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    request<Draft[]>("/chief/post-drafts").then(d => { if (live) { setDrafts(d); setError(""); } }).catch(() => { if (live) setError("Post drafts could not be loaded."); });
    return () => { live = false; };
  }, [attempt]);
  async function act(work: () => Promise<void>, message: string) {
    setBusy(true); setError(""); setStatus("");
    try { await work(); setStatus(message); }
    catch { setError("Draft action failed. Your text is still here; try again."); }
    finally { setBusy(false); }
  }
  const body = { text, networks: [network], kind };
  return <SettingsCard title="Post drafts" description="Edit, check and copy. Nothing here publishes, comments or replies. Only text you save here is compared; no network timeline is read.">
    <div data-testid="post-drafts" className="space-y-4">
      <p className="text-sm text-muted">Posting requires your own provider account, connected Apps and an approval card. X requires your own API credits.</p>
      {error && <Banner tone="danger">{error} <Button disabled={busy} onClick={() => setAttempt(v => v + 1)}>Retry drafts</Button></Banner>}
      {status && <p role="status">{status}</p>}
      {!drafts && !error && <p role="status">Reading saved drafts…</p>}
      {drafts && <>
        {!drafts.length && <p className="text-muted">No drafts saved yet.</p>}
        {drafts.map(d => <div className="rounded-card border border-line p-3 space-y-2" key={d.id}><p className="text-xs text-muted">{d.networks.join(", ")} · {d.kind === "saved_post" ? "Saved post" : "Draft"}</p><p dir="auto" className="whitespace-pre-wrap break-words">{d.text}</p><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { setId(d.id); setText(d.text); setNetwork(d.networks[0]); setKind(d.kind); setReview(null); setStatus(""); }}>Edit draft</Button><Button disabled={busy} onClick={() => void act(async () => { await navigator.clipboard.writeText(d.text); }, "Draft copied. Nothing was published.")}>Copy draft</Button><Button disabled={busy} onClick={() => void act(async () => { await request(`/chief/post-drafts/${d.id}`, { method: "DELETE" }); setDrafts(drafts.filter(v => v.id !== d.id)); if (id === d.id) { setId(null); setReview(null); } }, "Saved text removed.")}>Remove draft</Button></div></div>)}
        <Field label="Draft text">{p => <Textarea {...p} dir="auto" maxLength={10000} rows={5} value={text} onChange={e => { setText(e.target.value); setReview(null); }} />}</Field>
        <Field label="Draft network">{p => <select {...p} className={CONTROL} value={network} onChange={e => { setNetwork(e.target.value); setReview(null); }}>{["X", "LinkedIn", "Bluesky", "Mastodon"].map(n => <option key={n}>{n}</option>)}</select>}</Field>
        <Field label="Save as">{p => <select {...p} className={CONTROL} value={kind} onChange={e => setKind(e.target.value as Draft["kind"])}><option value="draft">Draft</option><option value="saved_post">Previously published text, saved for comparison</option></select>}</Field>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !text.trim()} onClick={() => void act(async () => { setReview(await request<Review>("/chief/post-drafts/check", { method: "POST", body: JSON.stringify(body) })); }, "Draft checked. Nothing was published.")}>Check draft</Button><Button disabled={busy || !text.trim()} onClick={() => void act(async () => { const d = await request<Draft>(id ? `/chief/post-drafts/${id}` : "/chief/post-drafts", { method: id ? "PUT" : "POST", body: JSON.stringify(body) }); setDrafts([...drafts.filter(v => v.id !== d.id), d]); setId(d.id); }, "Draft saved.")}>Save draft</Button>{id && <Button onClick={() => { setId(null); setText(""); setReview(null); }}>New draft</Button>}</div>
        {review && <div className="rounded-card border border-line p-3 space-y-2" role="status">{Object.entries(review.lengths).map(([n, v]) => <p key={n}>{n}: {v.characters} / {v.budget} editing budget{v.over_budget ? " — over budget" : ""}</p>)}<p className="text-xs text-muted">Estimates; provider and account limits can differ.</p><p>{review.link_count} links · {review.near_duplicates.filter(d => d.id !== id).length} similar saved texts</p><p>{review.privacy_alert ? "Privacy warning: review addresses, links and numbers before copying." : "No privacy pattern detected. Review before copying."}</p><p dir="auto" className="break-words whitespace-pre-wrap">{review.privacy_preview}</p></div>}
      </>}
    </div>
  </SettingsCard>;
}
