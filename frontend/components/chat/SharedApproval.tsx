"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { SharedApproval as Approval } from "@/lib/collaboration";
import { ApprovalCard } from "./items";

export function SharedApproval({ approval, onChanged }: { approval: Approval; onChanged: () => void }) {
  const answeringNow = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = async (decision: "allow" | "deny") => {
    if (answeringNow.current) return;
    answeringNow.current = true;
    setBusy(true); setError(null);
    try { await api.answerThreadApproval(approval.thread_id, approval.id, decision); onChanged(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not answer this approval."); onChanged(); }
    finally { answeringNow.current = false; setBusy(false); }
  };
  return <ApprovalCard item={{ kind: "approval", key: approval.id, turnId: approval.turn_id, approvalId: approval.id, tool: approval.tool, approvalKind: approval.kind ?? "other", summary: approval.summary ?? approval.tool, input: approval.input, status: approval.status, resolvedBy: "", ruleId: null }} answering={busy} error={error} onAnswer={(decision) => void answer(decision)} />;
}
