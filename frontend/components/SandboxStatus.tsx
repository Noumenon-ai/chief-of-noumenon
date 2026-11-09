"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/use-i18n";
import { api } from "@/lib/api";

export function SandboxStatus({ problemsOnly = false }: { problemsOnly?: boolean }) {
  const tx = useT();
  const [protected_, setProtected] = useState<boolean | null>(null);
  const [status, setStatus] = useState("Checking turn sandbox protection…");
  useEffect(() => {
    let live = true;
    api.getSandboxStatus().then(value => {
      if (live) setProtected(value.protected);
      if (live) setStatus(value.protected ? "Sandbox on: bot tools run separated from the rest of this computer." : value.reason || "Turn sandbox unavailable. Engine tools are not isolated.");
    }).catch(() => { if (live) setStatus("Turn sandbox protection could not be verified."); });
    return () => { live = false; };
  }, []);
  if (problemsOnly && (protected_ === true || status.startsWith("Checking"))) return null;
  return <p role="status" className={problemsOnly ? "sandbox-problem m-3 rounded-field border border-line p-3 text-xs text-muted" : "text-xs text-muted"}>{tx(status)}</p>;
}
