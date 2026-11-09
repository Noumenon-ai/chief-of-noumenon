"use client";
import { StarterTeam } from "@/components/StarterTeam";
import Link from "next/link";
import { MessageSquare, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import type { Agent, Thread } from "@/lib/api";
import type { ChannelSnapshot } from "@/lib/control-room";
import { channelOrder, engineName, hasStarterTeam } from "@/lib/control-room";
import { identityVar } from "@/lib/identity";
import { agentTarget } from "@/lib/sidebar";
import { Avatar } from "@/components/ui/Avatar";
import { useT } from "@/lib/use-i18n";

export function BotRail({ agents, threads, selected, snapshots, onNew, leadAgentId, onNewAgent, onEditAgent, onDeleteAgent }: {
  agents: Agent[] | null; threads: Thread[] | null; selected: number | null;
  snapshots: Record<number, ChannelSnapshot>; onNew: (id?: number) => void; leadAgentId: number | null;
  onNewAgent?: () => void; onEditAgent?: (agent: Agent) => void; onDeleteAgent?: (agent: Agent) => void;
}) {
  const t = useT();
  return <nav className="bot-rail" aria-label={t("rail.yourBots")}>
    <div className="rail-heading"><span>{t("rail.yourBots")}</span></div>
    {onNewAgent && <button type="button" className="rail-add" aria-label={t("rail.addBot")} disabled={!onNewAgent} onClick={onNewAgent}><Plus size={18} aria-hidden="true" /><span className="rail-add-desktop">{t("rail.addBot")}</span><span className="rail-add-phone">{t("rail.add")}</span></button>}
    <div className="bot-channels">
      {agents === null && <p role="status">{t("common.loading")}</p>}
      {agents?.length === 0 && <p className="rail-empty">{t("sidebar.noAgentsTitle")}</p>}
      {channelOrder(agents, threads, leadAgentId).map(agent => {
        const target = agentTarget(threads, agent.id);
        const chats = (threads ?? []).filter(thread => thread.agent_id === agent.id && !thread.archived_at);
        const state = chats.some(thread => snapshots[thread.id]?.waiting) ? "waiting" : chats.some(thread => snapshots[thread.id]?.working) ? "working" : "idle";
        const preview = target.kind === "thread" ? snapshots[target.id]?.preview : "";
        const content = <><span className={`channel-avatar ${state}`}><Avatar agentId={agent.id} name={agent.name} /></span><span className="channel-copy"><strong dir="auto">{agent.name}</strong><span className="channel-model">{engineName(agent.provider, agent.model)}</span>{preview && <span className="channel-preview" dir="auto">{preview}</span>}</span>{state !== "idle" && <span className={`channel-light ${state}`} aria-label={state === "waiting" ? t("status.waiting") : t("status.working")} />}</>;
        return <div className="bot-channel-group" key={agent.id} style={{ "--bot-color": identityVar(agent.id) } as CSSProperties}>
          {target.kind === "thread" ? <Link className="bot-channel" aria-current={selected === agent.id ? "page" : undefined} href={`/chat?thread=${target.id}`}>{content}</Link> : <button className="bot-channel" aria-pressed={selected === agent.id} onClick={() => onNew(agent.id)}>{content}</button>}
          {selected === agent.id && <div className="channel-controls">
            <details className="channel-chats"><summary title={t(chats.length === 1 ? "rail.oneChat" : "rail.chats", { n: chats.length })}><span className="channel-count-full">{t(chats.length === 1 ? "rail.oneChat" : "rail.chats", { n: chats.length })}</span><span className="channel-count-compact" aria-label={t(chats.length === 1 ? "rail.oneChat" : "rail.chats", { n: chats.length })}><MessageSquare size={11} aria-hidden="true" />{chats.length}</span></summary><button onClick={() => onNew(agent.id)}>{t("shell.newChat")}</button>{chats.map(chat => <Link key={chat.id} href={`/chat?thread=${chat.id}`}>{chat.title || t("sidebar.untitled")}{chat.origin === "telegram" ? " · Telegram" : ""}</Link>)}</details>
            <div className="channel-actions">
              {onEditAgent && <button aria-label={t("rail.editNamed", { name: agent.name })} onClick={() => onEditAgent(agent)}>{t("common.edit")}</button>}
              {onDeleteAgent && <button className="channel-delete" aria-label={t("rail.deleteNamed", { name: agent.name })} onClick={() => onDeleteAgent(agent)}>{t("common.delete")}</button>}
            </div>
          </div>}
        </div>;
      })}
      {agents !== null && !hasStarterTeam(agents) && <StarterTeam />}
    </div>
  </nav>;
}
