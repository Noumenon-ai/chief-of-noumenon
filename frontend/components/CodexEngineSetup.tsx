"use client";

import { api } from "@/lib/api";
import { EngineSignOut } from "./EngineSignOut";
import { Button } from "@/components/ui/Button";

export function CodexEngineSetup({ onChanged, signedIn }: { onChanged: () => void; signedIn: boolean | null }) {
  if (signedIn) return <EngineSignOut label="Codex" disabled={false} onPendingChange={() => {}} onSignOut={api.logoutCodexEngine} onChanged={onChanged} />;
  return <div className="space-y-2">
    <p className="text-sm text-muted">Install Codex from OpenAI, run <code>codex login</code> in a terminal, and sign in there. Then press Refresh.</p>
    <Button onClick={onChanged}>Refresh</Button>
    {signedIn && <EngineSignOut label="Codex" disabled={false} onPendingChange={() => {}} onSignOut={api.logoutCodexEngine} onChanged={onChanged} />}
  </div>;
}
