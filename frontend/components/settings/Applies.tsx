export function Applies({ when }: { when: string }) {
  if (!["restart", "after restart"].includes(when.trim().toLowerCase())) return null;
  return <p className="text-xs text-muted">Restart the app for this change to take effect.</p>;
}
