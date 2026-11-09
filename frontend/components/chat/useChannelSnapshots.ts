"use client";
import { useEffect, useState } from "react";
import { api, request, type Thread } from "@/lib/api";
import { channelSnapshot, type ChannelSnapshot } from "@/lib/control-room";

export function useChannelSnapshots(threads: Thread[] | null) {
  const [snapshots, setSnapshots] = useState<Record<number, ChannelSnapshot>>({});
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      const next: Record<number, ChannelSnapshot> = {};
      // Bounded batches; each status comes from this chat, never inferred from another bot.
      const current = (threads ?? []).filter(t => !t.archived_at);
      for (let i = 0; i < current.length && active; i += 4) {
        await Promise.all(current.slice(i, i + 4).map(async thread => {
          try {
            const [detail, approvals] = await Promise.all([api.getThread(thread.id), request<unknown[]>(`/threads/${thread.id}/approvals?status=pending`)]);
            next[thread.id] = channelSnapshot(detail, approvals.length);
          } catch { next[thread.id] = { preview: "Could not refresh this chat", working: false, waiting: false, error: true }; }
        }));
      }
      if (active) setSnapshots(next);
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [threads]);
  return snapshots;
}
