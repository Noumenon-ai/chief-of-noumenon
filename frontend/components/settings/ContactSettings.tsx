"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/api";
import type { LocalCatalog } from "@/components/LocalApps";
import { SettingsCard } from "./SettingsCard";
import { Button } from "@/components/ui/Button";
import { Field, Input, CONTROL } from "@/components/ui/Input";
import { Banner } from "@/components/ui/Banner";

type Contact = { name: string; address: string; aliases: string[]; connection_id: string };
const blank: Contact = { name: "", address: "", aliases: [], connection_id: "" };
export function ContactSettings() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [accounts, setAccounts] = useState<LocalCatalog["connections"]>([]);
  const [draft, setDraft] = useState<Contact>(blank);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    request<Contact[]>("/chief/contact-aliases").then(c => { if (live) { setContacts(c); setError(""); } }).catch(() => { if (live) setError("Contact aliases could not be loaded."); });
    request<LocalCatalog>("/integrations/connector").then(c => { if (live) setAccounts(c.connections.filter(a => ["hubspot", "front"].includes(a.service))); }).catch(() => { if (live) setAccounts([]); });
    return () => { live = false; };
  }, [attempt]);
  async function save(next: Contact[]) {
    setBusy(true); setError(""); setStatus("");
    try { await request("/chief/contact-aliases", { method: "PUT", body: JSON.stringify({ contacts: next }) }); setContacts(next); setDraft(blank); setEditing(null); setStatus("Contact aliases saved."); }
    catch { setError("Contact aliases could not be saved. Check the address and try again."); }
    finally { setBusy(false); }
  }
  return <SettingsCard title="Contact aliases" description="Names and nicknames in English or Hebrew. Bots can read an alias only when they have access to its contact account.">
    <div data-testid="contact-settings" className="space-y-4">
      {error && <Banner tone="danger">{error} <Button disabled={busy} onClick={() => setAttempt(v => v + 1)}>Retry aliases</Button></Banner>}
      {status && <p role="status">{status}</p>}
      {!contacts && !error && <p role="status">Reading contact aliases…</p>}
      {contacts && <>
        {!contacts.length && <p className="text-muted">No contact aliases saved.</p>}
        {contacts.map((c, i) => <div key={i} className="rounded-card border border-line p-3 space-y-2 break-words"><p dir="auto">{c.name} · {c.address}</p><p dir="auto" className="text-muted">{c.aliases.join(", ")}</p><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { setDraft(c); setEditing(i); setStatus(""); }}>Edit {c.name}</Button><Button disabled={busy} onClick={() => void save(contacts.filter((_, n) => n !== i))}>Remove {c.name}</Button></div></div>)}
        {!accounts.length && <p className="text-muted">Connect a HubSpot or Front account on Apps to add aliases. Saved aliases can still be removed.</p>}
        <Field label="Contact name">{p => <Input {...p} dir="auto" maxLength={120} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />}</Field>
        <Field label="Contact email address">{p => <Input {...p} type="email" dir="ltr" maxLength={254} value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} />}</Field>
        <Field label="Nicknames" hint="Separate nicknames with commas.">{p => <Input {...p} dir="auto" value={draft.aliases.join(",")} onChange={e => setDraft({ ...draft, aliases: e.target.value.split(",") })} />}</Field>
        <Field label="Contact account">{p => <select {...p} className={CONTROL} value={draft.connection_id} onChange={e => setDraft({ ...draft, connection_id: e.target.value })}><option value="">Choose an account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.service} / {a.connectionName}</option>)}</select>}</Field>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !draft.name.trim() || !draft.address || !draft.connection_id || !accounts.some(a => a.id === draft.connection_id)} onClick={() => { const value = { ...draft, aliases: draft.aliases.map(s => s.trim()).filter(Boolean) }; void save(editing === null ? [...contacts, value] : contacts.map((c, i) => i === editing ? value : c)); }}>Save alias</Button>{editing !== null && <Button onClick={() => { setEditing(null); setDraft(blank); }}>Cancel alias edit</Button>}</div>
      </>}
    </div>
  </SettingsCard>;
}
