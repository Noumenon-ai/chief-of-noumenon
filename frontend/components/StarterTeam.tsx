"use client";
import Link from "next/link";
import { useT } from "@/lib/use-i18n";
import { useState } from "react";
import { request } from "@/lib/api";
import { Button } from "@/components/ui/Button";

export function StarterTeam() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function add() {
    setBusy(true); setError("");
    try {
      await request("/chief/starter-team", { method: "POST" });
      setDone(true);
      window.dispatchEvent(new Event("chief:team-added"));
    } catch (err) { setError(err instanceof Error ? err.message : "The starter team could not be added. Try again."); }
    finally { setBusy(false); }
  }
  return <div className="starter-team space-y-2 text-xs">
    {done ? <div role="status">{t("Team ready.")} <Link href="/apps/" className="underline">{t("Choose app access")}</Link> {t("for Inbox (Gmail), Calendar (Google Calendar), Research (sources) and Builder (GitHub). Existing bots were kept.")}</div>
      : <Button variant="ghost" size="sm" aria-label={t("Add the starter team")} className="h-auto min-h-11 flex-col items-start gap-0 whitespace-normal px-1 py-1 text-start text-xs" loading={busy} onClick={() => void add()}><span>{t("Add the starter team")}</span><span data-starter-members className="text-[10px] leading-3 font-normal text-muted">{t("Inbox, Calendar, Research and Builder")}</span></Button>}
    {error && <p role="alert" className="text-danger">{t(error)}</p>}
  </div>;
}
