"use client";
import { useT } from "@/lib/use-i18n";

import { Select } from "@/components/ui/Select";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ApiError, type Agent } from "@/lib/api";
import { localDateTime } from "@/lib/planner";
import { planner, type WorkItem, type WorkRun, type WorkRunInput, type WorkEvent } from "@/lib/planner-api";
import { browserTimezone } from "@/lib/routines";
import { EmptyPanel, ErrorState, LoadingState } from "./PanelState";

const control = "w-full rounded-field border border-line bg-surface px-3 py-2 text-sm";
const activeStates = ["scheduled", "queued", "claimed", "running", "needs_input"];
const message = (error: unknown) => error instanceof Error ? error.message : "Could not load task execution.";

export function WorkExecutionPanel({ item, agents, onClose, onOpenThread, onReview }: {
  item: WorkItem; agents: Agent[]; onClose: () => void; onOpenThread: () => void; onReview: () => Promise<void>;
}) {
  const tx = useT();
  const submitting = useRef(false);
  const id = useId();
  const [runs, setRuns] = useState<WorkRun[] | null>(null);
  const [events, setEvents] = useState<WorkEvent[]>([]);
  const [agentId, setAgentId] = useState(item.agent_id ?? agents[0]?.id ?? 0);
  const [prompt, setPrompt] = useState(`${item.title}\n\n${item.description}`.trim());
  const [mode, setMode] = useState<WorkRunInput["approval_mode"]>("ask");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<WorkRunInput | null>(null);
  const [retrying, setRetrying] = useState(false);
  const timezone = browserTimezone();
  useEffect(() => {
    let live = true;
    const load = async () => {
      try { const [result, history] = await Promise.all([planner.runs(item.id), planner.events(item.id)]); if (live) { setRuns(result); setEvents(history); } }
      catch (err) { if (live) setError(message(err)); }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => { live = false; clearInterval(timer); };
  }, [item.id]);
  const active = runs?.some(run => activeStates.includes(run.state));
  const refresh = async () => setRuns(await planner.runs(item.id));

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || busy) return;
    setError(null);
    let scheduled: string | null = null;
    if (!pending && when) {
      const date = new Date(when);
      if (!Number.isFinite(date.getTime()) || localDateTime(date.toISOString()) !== when || date.getTime() <= Date.now()) {
        setError(tx("Choose a future local time that exists on this date.")); return;
      }
      scheduled = date.toISOString();
    }
    const data = pending ?? { revision: item.revision, idempotency_key: crypto.randomUUID(), agent_id: agentId,
      prompt, approval_mode: mode, scheduled_for: scheduled };
    submitting.current = true;
    setPending(data); setBusy(true);
    try {
      const saved = await planner.start(item.id, data);
      setRuns(current => [saved, ...(current ?? []).filter(run => run.id !== saved.id)]);
      setPending(null); setRetrying(false);
      await refresh().catch(err => setError(message(err)));
    } catch (err) {
      // A lost response may have committed. Keep its exact request/key so
      // retrying the request never launches another attempt.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) setPending(null);
      setError(message(err));
    } finally { submitting.current = false; setBusy(false); }
  }
  async function cancel(run: WorkRun) {
    setBusy(true); setError(null);
    try { await planner.cancelRun(item.id, run.id); await refresh(); }
    catch (err) { setError(message(err)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Dialog open title={tx("Bot work · {title}", { title: item.title })} description={tx("Start or schedule an explicit attempt and review its history.")} size="wide"
    onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <div className="space-y-5">
      <p className="text-sm text-muted">{tx("Assignment, deadlines, and workflow columns do not start work. Each attempt uses a new conversation. Successful work stays in its current column until you review it.")}</p>
      {error && <ErrorState message={error} />}
      {runs === null ? <LoadingState rows={3} /> : <>
        {(!active || pending) && !item.archived && <form onSubmit={event => void start(event)} className="space-y-3 rounded-field border border-line p-3">
          <h3 className="font-medium">{tx(retrying ? "Review a new attempt" : "Start with bot")}</h3>
          {retrying && <p className="text-sm text-warning">{tx("Earlier work may be partly done. Check its conversation and adjust the prompt before trying again.")}</p>}
          <fieldset disabled={busy || !!pending} className="space-y-3">
            <label htmlFor={`${id}-agent`} className="block text-sm">{tx("Bot")}<Select id={`${id}-agent`} required className={control} value={agentId} onChange={event => setAgentId(Number(event.target.value))}>
                <option value={0} disabled>{tx("Choose a bot")}</option>
                {agents.filter(agent => !agent.archived_at).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </Select></label>
            <label htmlFor={`${id}-prompt`} className="block text-sm">{tx("Exact task prompt")}<textarea id={`${id}-prompt`} required maxLength={20000} rows={5} className={control} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
            <label htmlFor={`${id}-mode`} className="block text-sm">{tx("Approval mode")}<Select id={`${id}-mode`} className={control} value={mode} onChange={event => setMode(event.target.value as WorkRunInput["approval_mode"])}>
                <option value="ask">{tx("Ask")}</option><option value="accept_edits">{tx("Accept edits")}</option><option value="plan">{tx("Plan")}</option>
              </Select></label>
            <p className="text-xs text-muted">{tx("The stricter of this mode and the bot’s saved mode applies. Review approvals in the execution conversation.")}</p>
            <label htmlFor={`${id}-when`} className="block text-sm">{tx("Run once at ·")}{timezone}{tx("(leave empty to start now)")}<input id={`${id}-when`} type="datetime-local" className={control} value={when} onChange={event => setWhen(event.target.value)} /></label>
          </fieldset>
          <p className="text-sm">{when ? `This confirms one scheduled attempt in ${timezone}.` : "This starts bot work now, or queues it while the bot is busy."}</p>
          {pending && !busy && <p className="text-sm text-warning">{tx("The previous request may have reached the server. Retry the same request to recover its receipt.")}</p>}
          <Button type="submit" variant="primary" loading={busy} disabled={!agentId || !prompt.trim()}>{pending ? "Retry same request" : when ? "Confirm scheduled run" : "Confirm and start now"}</Button>
        </form>}
        {item.archived && <p className="text-sm text-muted">{tx("Restore this task to start another attempt.")}</p>}
        <div className="space-y-3" aria-live="polite">
          <h3 className="font-medium">{tx("Attempts")}</h3>
          {runs.length === 0 && <EmptyPanel title={tx("No bot work yet")} description={tx("Start an attempt above to see its history here.")} />}
          {runs.map(run => <article key={run.id} className="space-y-2 rounded-field border border-line p-3 text-sm">
            <p className="font-medium">{tx("Attempt")}{run.attempt} · {tx(run.state === "needs_input" ? "Waiting for approval" : run.state)}</p>
            <p className="text-xs text-muted">{agents.find(agent => agent.id === run.agent_id)?.name ?? tx("Bot #{id}", { id: run.agent_id })} · {tx(run.approval_mode)} · {new Date(run.scheduled_for ?? run.created_at).toLocaleString()}</p>
            {run.state === "queued" && <p className="text-muted">{tx("Waiting for the executor or for the bot to become available.")}</p>}
            {run.state === "interrupted" && <p className="text-warning">{tx("Work was interrupted and will not replay automatically. Inspect its conversation before starting a new attempt.")}</p>}
            {run.result && <p className="whitespace-pre-wrap break-words">{run.result}</p>}
            {run.error && <p className="whitespace-pre-wrap text-danger">{run.error}</p>}
            <details><summary className="cursor-pointer text-muted">{tx("Approved prompt")}</summary><pre className="whitespace-pre-wrap break-words py-2 font-sans">{run.prompt}</pre></details>
            <div className="flex flex-wrap items-center gap-3">
              {run.thread_id && <Link className="text-accent underline" href={`/chat?thread=${run.thread_id}`} onClick={onOpenThread}>{tx("Open execution conversation")}</Link>}
              {activeStates.includes(run.state) && <Button size="sm" disabled={busy} onClick={() => void cancel(run)}>{tx(run.state === "scheduled" || run.state === "queued" ? "Cancel" : "Stop")}</Button>}
              {!active && !item.archived && ["failed", "cancelled", "interrupted", "missed", "skipped"].includes(run.state) && <Button size="sm" disabled={busy || !!pending} onClick={() => { setAgentId(run.agent_id); setPrompt(run.prompt); setMode(run.approval_mode); setWhen(""); setRetrying(true); }}>{tx("Prepare retry")}</Button>}
              {run.state === "completed" && <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await onReview(); } catch (err) { setError(message(err)); } finally { submitting.current = false; setBusy(false); } }}>{tx("Move to Review")}</Button>}
            </div>
          </article>)}
        </div>
        <details><summary className="cursor-pointer text-sm text-muted">{tx("Task activity (latest 500 events)")}</summary>
          <ol className="mt-2 space-y-1 text-xs text-muted">{events.map(event => <li key={event.id}>
            {new Date(event.created_at).toLocaleString()} · {event.actor} · {event.kind.replaceAll("_", " ")}{event.detail ? ` · ${event.detail}` : ""}
          </li>)}</ol>
        </details>
      </>}
      <div className="flex justify-end"><Button disabled={busy} onClick={onClose}>{tx("Close")}</Button></div>
    </div>
  </Dialog>;
}
