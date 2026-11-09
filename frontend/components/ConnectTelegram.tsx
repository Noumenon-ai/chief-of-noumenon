"use client";
import { Button, Card } from "./Card";

// Preserve old Boat identities so their tasks stay readable. New identities are local.
export function ConnectTelegram({ userId, onLinked, onReset }: {
  userId: string | null;
  onLinked: (identity: { link_code: string } | { guest: true }) => void;
  onReset: () => void;
  variant?: "legacy" | "settings";
}) {
  return <Card step={1} title="Task history">
    {userId ? <><p className="text-sm text-muted">Your existing task history is available.</p><Button onClick={onReset}>Disconnect task history</Button></> :
      <><p className="text-sm text-muted">Create a local task identity to use the older Boat tasks. Telegram alerts are optional and are set up separately in Settings.</p><Button onClick={() => onLinked({ guest: true })}>Continue to tasks</Button></>}
  </Card>;
}
