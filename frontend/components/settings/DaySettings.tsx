"use client";
import { useT as useUiText } from "@/lib/use-i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { request, api, type Agent } from "@/lib/api";
import { SettingsCard } from "./SettingsCard";
import { Button } from "@/components/ui/Button";
import { Field, Input, CONTROL } from "@/components/ui/Input";
import { Banner } from "@/components/ui/Banner";

type Preferences = { timezone: string; quiet_enabled: boolean; location: string; israel: boolean };
type Routine = { id: number; name: string; agent_id: number; enabled: boolean; time: string; kind: string };
type Reminder = { id: string; body: string; time_label: string; status: string };
export function DaySettings() {
  const tx = useUiText();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [bots, setBots] = useState<Agent[]>([]);
  const [bot, setBot] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const [p, r, m, a, team] = await Promise.all([request<Preferences>("/chief/preferences"), request<Routine[]>("/chief/routines"), request<Reminder[]>("/chief/reminders"), api.listAgents(), request<{ team: { lead_agent_id: number | null } }>("/team")]);
      setPrefs(p); setRoutines(r); setReminders(m); setBots(a.filter(bot => !bot.archived_at));
      setBot(current => current || String(a.find(bot => bot.id === team.team?.lead_agent_id)?.id || a.find(bot => !bot.archived_at)?.id || "")); setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Day settings could not be loaded."); }
  }
  useEffect(() => {
    let live = true;
    Promise.all([request<Preferences>("/chief/preferences"), request<Routine[]>("/chief/routines"), request<Reminder[]>("/chief/reminders"), api.listAgents(), request<{ team: { lead_agent_id: number | null } }>("/team")])
      .then(([p, r, m, a, team]) => { if (live) { setPrefs(p); setRoutines(r); setReminders(m); setBots(a.filter(bot => !bot.archived_at)); setBot(String(a.find(bot => bot.id === team.team?.lead_agent_id)?.id || a.find(bot => !bot.archived_at)?.id || "")); } })
      .catch(err => { if (live) setError(err instanceof Error ? err.message : "Day settings could not be loaded."); });
    return () => { live = false; };
  }, []);
  async function act(work: () => Promise<unknown>, message: string) {
    setBusy(true); setError(""); setSuccess("");
    try { await work(); await load(); setSuccess(message); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save. Try again."); }
    finally { setBusy(false); }
  }
  return <SettingsCard title={tx("Your day")} description={tx("Personal reminders, read-only briefs and optional quiet hours.")}>
    <div className="space-y-5" data-testid="day-settings">
      {error && <Banner tone="danger">{error} <button className="underline" onClick={() => void load()}>{tx("Retry")}</button></Banner>}
      {success && <p role="status" className="text-sm">{tx(success)}</p>}
      {!prefs && !error && <p role="status">{tx("Reading day settings…")}</p>}
      {prefs && <>
        <div id="setting-day"><Field label={tx("Time zone")} hint={tx("Choose the place whose local time you use.")}>{props => <select {...props} className={CONTROL} value={prefs.timezone} onChange={e => setPrefs({ ...prefs, timezone: e.target.value })}>{[...new Set([prefs.timezone, "UTC", ...Intl.supportedValuesOf("timeZone")])].sort().map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}</select>}</Field></div>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={prefs.quiet_enabled} onChange={e => setPrefs({ ...prefs, quiet_enabled: e.target.checked })} />{tx("Shabbat and Yom Tov quiet")}</label>
        <p className="text-sm text-muted">{tx("Off by default. Holds non-urgent notifications and scheduled routines from 14:00 on the eve until midnight after the last day, then sends one notification summary. Urgent mail, approvals and work you start remain available. These broad offline times are not religious guidance.")}</p>
        <Field label={tx("Location")} hint={tx("City or region; set its time zone above. No location lookup is sent.")}>{props => <Input {...props} value={prefs.location} onChange={e => setPrefs({ ...prefs, location: e.target.value })} />}</Field>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={prefs.israel} onChange={e => setPrefs({ ...prefs, israel: e.target.checked })} />{tx("Use Israel holiday days")}</label>
        <Button className="min-h-11" disabled={busy} onClick={() => void act(() => request("/chief/preferences", { method: "PUT", body: JSON.stringify(prefs) }), "Day preferences saved.")}>{tx("Save day preferences")}</Button>
        <hr className="border-line" />
        <h3 className="font-semibold">{tx("Briefs and inbox triage")}</h3>
        <p className="text-sm text-muted">{tx("Add Morning brief, Evening brief and Gmail triage for a bot. Each starts off.")}{" "}<Link className="underline" href="/apps/">{tx("Grant its accounts on Apps")}</Link>{tx(". Triage sends Telegram alerts only for urgent mail.")}</p>
        {bots.length ? <Field label={tx("Briefing bot")}>{props => <select {...props} className={CONTROL} value={bot} onChange={e => setBot(e.target.value)}>{bots.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}</Field> : <p>{tx("No bots yet. Open first run to create Chief.")}</p>}
        <Button className="min-h-11" disabled={busy || !bot} onClick={() => void act(() => request("/chief/routines", { method: "POST", body: JSON.stringify({ agent_id: Number(bot) }) }), "Read-only routines added. Turn on the ones you want below.")}>{tx("Add day routines")}</Button>
        {!routines.length && <p className="text-sm text-muted">{tx("No day routines added yet.")}</p>}
        {routines.map(r => <div key={r.id} className="space-y-2 rounded-card border border-line p-3">
          <h4 className="font-medium">{r.name} · {bots.find(a => a.id === r.agent_id)?.name || tx("Bot")}</h4>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={r.enabled} onChange={e => setRoutines(rows => rows.map(row => row.id === r.id ? { ...row, enabled: e.target.checked } : row))} />{tx("Enabled")}</label>
          <Field label={`${r.name} time`}>{props => <Input {...props} type="time" value={r.time} onChange={e => setRoutines(rows => rows.map(row => row.id === r.id ? { ...row, time: e.target.value } : row))} />}</Field>
          <Button className="min-h-11" disabled={busy} onClick={() => void act(() => request(`/chief/routines/${r.id}`, { method: "PUT", body: JSON.stringify({ enabled: r.enabled, time: r.time }) }), `${r.name} saved.`)}>{tx("Save")}{" "}{r.name}</Button>
        </div>)}
        <hr className="border-line" /><h3 className="font-semibold">{tx("Reminders")}</h3>
        <p className="text-sm text-muted">{tx("Ask in the app chat, or enter one here. Morning is 09:00; evening is 18:00. Unclear times ask a question.")}</p>
        <Field label={tx("Reminder")} hint={tx("remind me tomorrow morning to call the dentist / תזכיר לי מחר בבוקר לקבוע תור לרופא שיניים")}>{props => <Input {...props} dir="auto" value={text} onChange={e => setText(e.target.value)} />}</Field>
        <Button className="min-h-11" disabled={busy || !text.trim()} onClick={() => void act(async () => {
          const result = await request<{ question?: string; time_label?: string }>("/chief/reminders", { method: "POST", body: JSON.stringify({ text }) });
          if (result.question) throw new Error(result.question);
          setText("");
        }, "Reminder created. Its exact time is shown below.")}>{tx("Create reminder")}</Button>
        {!reminders.some(r => r.status === "pending") && <p className="text-sm text-muted">{tx("No pending reminders.")}</p>}
        {reminders.filter(r => r.status === "pending").map(r => <div key={r.id} className="space-y-2 rounded-card border border-line p-3"><p dir="auto">{r.body}</p><p className="text-xs text-muted">{r.time_label}</p><Button className="min-h-11" disabled={busy} onClick={() => void act(() => request(`/chief/reminders/${r.id}`, { method: "DELETE" }), "Reminder cancelled.")}>{tx("Cancel reminder")}</Button></div>)}
      </>}
    </div>
  </SettingsCard>;
}
