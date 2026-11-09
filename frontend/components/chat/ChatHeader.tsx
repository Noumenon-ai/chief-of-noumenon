"use client";

import { withBase } from "@/lib/paths";
import { BarChart3, CalendarDays, Folder, MoreHorizontal, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { Agent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/use-i18n";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/IconButton";
import { Menu, MenuItem } from "@/components/ui/Menu";


// The strip above a conversation: what it is (agent and title), how it runs (engine and model,
// approval mode, computer), and a few quiet icon buttons. Everything else lives in the sidebar
// or opens in a panel. On a phone the secondary buttons fold into one menu.
export function ChatHeader({
  title,
  origin,
  agent,
  onOpenSidebar,
  engine,
  computer,
  onApprovals,
  onFiles,
  onUsage,
  onToday,
  onEditAgent,
  onDeleteAgent,
  usageHint,
  trailing,
  computerButton,
  status,
}: {
  title: string;
  origin?: string;
  // The conversation's agent, for the avatar; null for a plain chat.
  agent: Pick<Agent, "id" | "name"> | null;
  // Present when the sidebar is a drawer: the button that opens it.
  onOpenSidebar?: () => void;
  // Only on a new chat: pick the agent it starts with.
  engine?: { label: string; onClick: () => void; disabled: boolean };
  computer?: { text: string; hint: string; onClick: () => void };
  approvalMode?: { label: string; hint: string };
  onApprovals?: () => void;
  onFiles?: () => void;
  onUsage?: () => void;
  onToday?: () => void;
  onEditAgent?: () => void;
  onDeleteAgent?: () => void;
  usageHint?: string;
  // The notification bell and anything else that sits at the far right.
  trailing?: ReactNode;
  computerButton?: ReactNode;
  // Short text such as "Reconnecting…" or the engine's version.
  status?: { text: string; warn?: boolean } | null;
}) {
  const t = useT();
  type Action = { key: string; label: string; icon: ReactNode; run: () => void; hint?: string };
  const secondary: Action[] = [];
  if (onApprovals) secondary.push({ key: "approvals", label: t("header.approvals"), icon: <ShieldCheck size={18} />, run: onApprovals });
  if (onFiles) secondary.push({ key: "files", label: t("header.files"), icon: <Folder size={18} />, run: onFiles });
  if (onUsage) secondary.push({ key: "usage", label: t("header.usage"), icon: <BarChart3 size={18} />, run: onUsage, hint: usageHint });
  if (onToday) secondary.push({ key: "today", label: t("header.today"), icon: <CalendarDays size={18} />, run: onToday, hint: t("header.todayHint") });

  return (
    <header className="chat-heading">

      <div className="chat-heading-identity">
        {agent && <Avatar agentId={agent.id} name={agent.name} size="md" />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold" title={title}>{agent?.name ?? title}</h1>
          <p className="truncate text-[11px] text-muted">
            {engine && <span>{engine.label}</span>}
            {status?.warn && <span className={cn("ms-2", "text-warning")}>{status.text}</span>}
          </p>
        </div>
      </div>
      {origin === "telegram" && <span className="telegram-label">Telegram</span>}
      {computerButton}
      <Menu trigger={<IconButton label={t("header.more")}><MoreHorizontal size={18} /></IconButton>}>
        <MenuItem onSelect={() => window.location.assign(withBase("/settings/"))}>{t("palette.settings")}</MenuItem>
        <MenuItem onSelect={() => window.location.assign(withBase("/settings/phone/"))}>{t("phone.title")}</MenuItem>
        {agent && onEditAgent && <MenuItem onSelect={onEditAgent}>{t("rail.editBot")}<span className="sr-only"> · {agent.name}</span></MenuItem>}
        {agent && onDeleteAgent && <MenuItem danger onSelect={onDeleteAgent}>{t("rail.deleteBot")}<span className="sr-only"> · {agent.name}</span></MenuItem>}
        {onOpenSidebar && <MenuItem onSelect={onOpenSidebar}>{t("header.allTools")}</MenuItem>}
        {computer && <MenuItem onSelect={computer.onClick}>{computer.text}</MenuItem>}
        {engine && <MenuItem disabled={engine.disabled} onSelect={engine.onClick}>{t("header.engine")} · {engine.label}</MenuItem>}
        {secondary.map(item => <MenuItem key={item.key} onSelect={item.run} icon={item.icon}>{item.label}</MenuItem>)}
      </Menu>
      {trailing}
    </header>
  );
}
