"use client";

import { useT } from "@/lib/use-i18n";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Agent,
  type Engine,
  type Workflow,
  type WorkflowRun,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { WorkflowCanvas } from "./WorkflowCanvas";

interface WorkflowsPanelProps {
  agents: Agent[];
  engines?: Engine[];
  onClose: () => void;
}

export function WorkflowsPanel({ agents, engines = [], onClose }: WorkflowsPanelProps) {
  const t = useT();
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [wfs, rList] = await Promise.all([
        api.listWorkflows(),
        api.listAllWorkflowRuns(50),
      ]);

      setWorkflows(wfs);
      setSelectedWorkflowId((prev) => wfs.some((workflow) => workflow.id === prev) ? prev : wfs[0]?.id ?? null);
      setError(null);
      setRuns(rList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      await loadData();
    })();
    const interval = setInterval(() => {
      void api.listAllWorkflowRuns(50).then((fresh) => {
        if (active) setRuns(fresh);
      }).catch(() => {});
    }, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [loadData]);

  const activeWorkflow = workflows?.find((w) => w.id === selectedWorkflowId) || workflows?.[0];

  const handleCreateWorkflow = async () => {
    try {
      const newWf = await api.createWorkflow({
        name: t("Untitled workflow"),
        description: t("New visual automation workflow"),
        trigger_type: "manual",
        steps: [
          { id: "trigger_1", name: t("Trigger"), type: "trigger", trigger_type: "manual", next_step_id: "step_1", x: 60, y: 140 },
          { id: "step_1", name: t("Bot action"), type: "agent", agent_id: agents.find(bot => !bot.archived_at)?.id, prompt: "", approval_mode: "ask", next_step_id: null, x: 440, y: 140 },
        ],
      });
      setWorkflows((prev) => (prev ? [newWf, ...prev] : [newWf]));
      setSelectedWorkflowId(newWf.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUpdateWorkflow = async (partial: Partial<Workflow>) => {
    if (!activeWorkflow) return;
    try {
      const updated = await api.updateWorkflow(activeWorkflow.id, partial);
      setWorkflows((prev) =>
        prev ? prev.map((w) => (w.id === updated.id ? updated : w)) : [updated]
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunWorkflow = async () => {
    if (!activeWorkflow) return;
    try {
      await api.startWorkflowRun(activeWorkflow.id, {
        message: "Interactive manual run from visual canvas",
      });
      const freshRuns = await api.listAllWorkflowRuns(50);
      setRuns(freshRuns);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading && !workflows) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface text-ink">
        <div className="flex flex-col items-center gap-3">
          <span className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-muted">{t("Loading visual workflow canvas...")}</span>
        </div>
      </div>
    );
  }

  if (error && !workflows) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface text-ink p-4">
        <div className="rounded-2xl border border-danger bg-inset p-6 max-w-md flex flex-col gap-4 text-center">
          <span className="text-danger font-semibold text-sm">{t("Failed to load workflows")}</span>
          <p className="text-xs text-muted">{error}</p>
          <button
            type="button"
            onClick={loadData}
            className="px-4 py-2 bg-hover hover:bg-hover rounded-xl text-xs font-semibold"
          >
            {t("Retry")}</button>
        </div>
      </div>
    );
  }

  if (!activeWorkflow) return <Dialog open onOpenChange={onClose} title={t("Workflows")}>
    <p>{t("No workflows yet. Create one to connect steps and choose a trigger.")}</p>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <Button onClick={() => void handleCreateWorkflow()}>{t("New workflow")}</Button>
  </Dialog>;

  return (
    <>
    {error && <div role="alert" className="fixed top-16 inset-x-4 z-50 rounded-card border border-danger bg-surface p-3 text-danger">{error}<Button onClick={() => setError(null)}>{t("Dismiss")}</Button></div>}
    <WorkflowCanvas
      workflow={activeWorkflow}
      workflows={workflows || []}
      agents={agents}
      engines={engines}
      runs={runs}
      onSelectWorkflow={(id) => setSelectedWorkflowId(id)}
      onCreateWorkflow={handleCreateWorkflow}
      onUpdateWorkflow={handleUpdateWorkflow}
      onRunWorkflow={handleRunWorkflow}
      onClose={onClose}
      onRefreshRuns={loadData}
    />
    </>
  );
}
