"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function TelegramSettings() {
  const [status, setStatus] = useState("Checking optional alerts…");
  useEffect(() => {
    let live = true;
    api.getTelegramSettings().then(prefs => {
      if (live) setStatus(prefs.enabled ? "Telegram alerts are configured. Keep the owner poller running on your server." : "Telegram is off. You can use everything in the website without it. To add alerts later, follow docs/TELEGRAM.md on your server.");
    }).catch(() => { if (live) setStatus("Could not check Telegram alerts. Try reopening this page."); });
    return () => { live = false; };
  }, []);
  return <div className="space-y-2"><p className="text-sm" role="status">{status}</p><p className="text-sm text-muted">Optional alerts for approvals, hand-offs, reminders, briefs and urgent mail. Allow and Deny work here; chat happens in the website.</p></div>;
}
