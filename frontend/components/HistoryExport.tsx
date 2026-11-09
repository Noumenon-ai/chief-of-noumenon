"use client";
import { useT as useUiText } from "@/lib/use-i18n";

import { useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

// Same base as lib/api.ts; the export is a ZIP, which request() cannot read.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function HistoryExport() {
  const tx = useUiText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const working = useRef(false);

  async function exportHistory() {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/history/export`, { credentials: "include" });
      if (!res.ok) {
        let message = "Could not export your history. Try again.";
        try {
          const detail = (await res.json())?.detail;
          if (typeof detail?.message === "string") message = detail.message;
          else if (typeof detail === "string") message = detail;
        } catch { /* not JSON */ }
        throw new Error(message);
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `open-dots-history-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(tx("Export saved to your downloads."));
    } catch {
      setError(tx("Could not export your history. Try again."));
    } finally {
      setBusy(false); working.current = false;
    }
  }

  return <section className="space-y-3 rounded-lg border border-line p-5">
    <h3 className="font-semibold">{tx("Your history")}</h3>
    <p className="text-xs text-muted">{tx("Save a copy of your bots, conversations and attachment names to a ZIP file. It never includes engine sign-ins, your account sign-in or attached files, and it stays on this computer.")}</p>
    {error && <Banner tone="danger">{error}</Banner>}
        <Button loading={busy} onClick={() => void exportHistory()}>{busy ? tx("Preparing…") : tx("Export my history")}</Button>
  </section>;
}
