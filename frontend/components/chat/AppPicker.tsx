"use client";

import Link from "next/link";
import { useT } from "@/lib/use-i18n";
import { useEffect, useState } from "react";
import { request } from "@/lib/api";
import type { LocalCatalog, AppConnection } from "@/components/LocalApps";

export function AppPicker({ value, onChange, expanded = false, onClose }: { value: string; onChange: (text: string) => void; expanded?: boolean; onClose?: () => void }) {
  const t = useT();
  const match = value.match(/(?:^|\s)@app(?:\s+([\w-]*))?$/i);
  const [accounts, setAccounts] = useState<AppConnection[]>([]);
  const [error, setError] = useState("");
  const [dismissedValue, setDismissedValue] = useState<string | null>(null);
  const open = expanded || Boolean(match && value !== dismissedValue);
  useEffect(() => {
    if (!open) return;
    let active = true;
    request<LocalCatalog>("/integrations/connector").then(data => { if (active) { setAccounts(data.connections); setError(""); } })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [open]);
  if (!open) return null;
  const query = match?.[1]?.toLowerCase() ?? "";
  return <div className="app-picker m-2 max-h-48 overflow-y-auto rounded-md border border-line p-2 text-sm" aria-label="Choose a connected app">
    <button type="button" className="mb-2 min-h-11 underline" onClick={() => { setDismissedValue(value); onClose?.(); }}>{t("common.close")}</button>
    {!accounts.length && !error && <p className="mb-2">{t("composer.noApps")}</p>}
    {error && <p role="status">{error}</p>}
    {accounts.filter(c => `${c.service} ${c.connectionName}`.toLowerCase().includes(query)).slice(0, 20).map(c => <button className="block w-full cursor-pointer rounded p-2 text-left hover:bg-hover" type="button" key={c.id} onClick={() => { const mention = `${c.service} account ${c.connectionName} (connection_id: ${c.id}) `; onChange(match ? value.replace(/@app(?:\s+[\w-]*)?$/i, mention) : `${value}${value ? " " : ""}${mention}`); onClose?.(); }}>{c.service} · {c.connectionName}</button>)}
    <Link href="/apps/" className="inline-flex min-h-11 items-center underline">{t("composer.connectApp")}</Link>
    <p className="text-xs text-muted">{t("composer.appAccess")}</p>
  </div>;
}
