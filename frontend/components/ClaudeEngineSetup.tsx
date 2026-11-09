"use client";

import { api } from "@/lib/api";
import { EngineSignOut } from "./EngineSignOut";
import { Button } from "@/components/ui/Button";

export function ClaudeEngineSetup({ onChanged, signedIn }: { onChanged: () => void; signedIn: boolean | null }) {
  if (signedIn) return <EngineSignOut label="Claude" disabled={false} onPendingChange={() => {}} onSignOut={api.logoutClaudeEngine} onChanged={onChanged} />;
  return <div className="space-y-2">
    <p className="text-sm text-muted">Install Claude Code from Anthropic, run <code>claude</code> in a terminal, and sign in there. Then press Refresh.</p>
    <Button onClick={onChanged}>Refresh</Button>
    {signedIn && <EngineSignOut label="Claude" disabled={false} onPendingChange={() => {}} onSignOut={api.logoutClaudeEngine} onChanged={onChanged} />}
  </div>;
}
