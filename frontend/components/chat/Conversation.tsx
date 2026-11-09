"use client";

import { DateDivider } from "./items";

import { ArrowDown } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatReactionReply, isLatestAssistantMessage, loadThreadReactions, saveThreadReaction, type ReactionKind, type ReactionsMap } from "@/lib/reactions";
import type { Transcript, TranscriptItem } from "@/lib/transcript";
import { announcement, groupToolRuns, mergeReceipts } from "@/lib/transcript-view";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useT } from "@/lib/use-i18n";
import { chatStarters, type StarterBot, greetingKey } from "@/lib/control-room";
import { request } from "@/lib/api";
import { workingPhase } from "@/lib/working-status";
import { WorkingStatus } from "./WorkingStatus";
import {
  ApprovalCard,
  AssistantMessage,
  SessionReset,
  RecalledChip,
  CompactedMarker,
  EngineSwitched,
  ToolRun,
  ToolStep,
  type Remembered,
  TurnEnd,
  UserMessage,
} from "./items";

import { ChatCard } from "./ChatCard";
import { NeedsYouCard } from "./NeedsYouCard";
import { RoutineChangeCard } from "./RoutineChangeCard";
import { DelegationCard, AgentCreatedCard, TeamNoticeCard, TeamSetupCard } from "./TeamCards";

const STICK_DISTANCE_PX = 80;

function findDateDividerItemKeys(items: readonly { key: string; [k: string]: unknown }[]): Set<string> {
  let lastDateKey: string | null = null;
  const dividerKeys = new Set<string>();
  for (const item of items) {
    const ts = "ts" in item && typeof item.ts === "string" ? item.ts : null;
    if (ts) {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) {
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (dateKey !== lastDateKey) {
          lastDateKey = dateKey;
          dividerKeys.add(item.key);
        }
      }
    }
  }
  return dividerKeys;
}




// Says the few things worth hearing (an approval waiting, a finished answer, a failure) once,
// in a visually hidden polite region. The transcript itself is not live: it would be re-read on
// every tool update.
function Announcer({ items }: { items: Transcript["items"] }) {
  const [text, setText] = useState("");
  const spoken = useRef<string | null>(null);
  useEffect(() => {
    const next = announcement(items);
    if (next && next.key !== spoken.current) {
      // The first look at a conversation is history, not news: remember it without speaking.
      if (spoken.current !== null) setText(next.text);
      spoken.current = next.key;
    } else if (!next && spoken.current === null) {
      spoken.current = "";
    }
  }, [items]);
  return <div role="status" aria-live="polite" className="sr-only">{text}</div>;
}

// The transcript, oldest first. It follows new content only while the person is
// at the bottom: scrolling up to read leaves the view where it is, and a button brings
// them back.
export function Conversation({
  workspace,
  computerId,
  onTakeOver,
  transcript,
  answering,
  approvalErrors,
  onAnswer,
  onReactionReply,
  sendingReactionReplyDisabled,
  remembered = {},
  undoneRules = [],
  onUndo,
  threadId = null,
  workspacePath = null,
  emptyHint,
  emptyAction,
  onStarter,
  agent = null,
  loading = false,
}: {
  workspace?: string | null;
  computerId?: number | null;
  onTakeOver?: () => void;
  // The conversation the transcript belongs to: attachments are fetched from it.
  threadId?: number | null;
  workspacePath?: string | null;
  // What to say when there is nothing yet (depends on whether an engine is ready).
  emptyHint?: string;
  onStarter?: (text: string) => void;
  // Shown under the hint, e.g. a button that opens the engine sign-in.
  emptyAction?: { label: string; onClick: () => void };
  // Who the conversation is with, for the empty state; null for a plain chat.
  agent?: { id: number; name: string } | null;
  // The conversation is still being fetched: show placeholders instead of the empty state.
  loading?: boolean;
  transcript: Transcript;
  answering: string | null;
  approvalErrors: Record<string, string>;
  onAnswer: (approvalId: string, decision: "allow" | "deny", remember?: boolean) => void;
  onReactionReply: (message: string) => Promise<boolean>;
  sendingReactionReplyDisabled: boolean;
  // "Always allow" outcomes by approval id, from answers given on this page.
  remembered?: Record<string, Remembered>;
  undoneRules?: number[];
  onUndo?: (ruleId: number) => void;
}) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);

  const follow = () => {
    const el = scroller.current;
    if (!el || !stuck.current) return;
    const cards = el.querySelectorAll<HTMLElement>(".approval-waiting");
    const card = cards[cards.length - 1];
    if (card) el.scrollTop += card.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom + 16;
    else el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(() => { follow(); }, [transcript.items, transcript.typing, transcript.runningTurnId]);
  useLayoutEffect(() => {
    stuck.current = true;
    follow();
  }, [threadId]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !el.firstElementChild) return;
    const observer = new ResizeObserver(follow);
    observer.observe(el);
    observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_DISTANCE_PX;
    setAway((previous) => (previous === !stuck.current ? previous : !stuck.current));
  };

  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    stuck.current = true;
    follow();
    setAway(false);
  };

  const [threadReactions, setThreadReactions] = useState<{ id: number | null | undefined; map: ReactionsMap }>(() => ({
    id: threadId,
    map: loadThreadReactions(threadId),
  }));

  const reactions = threadReactions.id === threadId ? threadReactions.map : loadThreadReactions(threadId);

  const reactionBusy = useRef(false);
  const handleReact = async (itemKey: string, reaction: ReactionKind) => {
    if (reactionBusy.current) return;
    if (reactions[itemKey] === reaction) {
      const next = saveThreadReaction(threadId, itemKey, null);
      setThreadReactions({ id: threadId, map: next });
      return;
    }
    reactionBusy.current = true;
    let sent = false;
    try { sent = await onReactionReply(formatReactionReply(reaction)); } finally { reactionBusy.current = false; }
    if (!sent) return;
    const next = saveThreadReaction(threadId, itemKey, reaction);
    setThreadReactions({ id: threadId, map: next });
  };

  const working = transcript.runningTurnId !== null && !transcript.typing;
  const waitingOnYou = transcript.items.some((i) => i.kind === "approval" && i.status === "pending");
  const empty = transcript.items.length === 0 && transcript.typing === null && !loading;
  const showSkeleton = loading && transcript.items.length === 0 && transcript.typing === null;
  const [starterBots, setStarterBots] = useState<{ agentId: number; bots: StarterBot[] } | null>(null);
  const agentId = agent?.id;
  useEffect(() => {
    if (!empty || agentId === undefined) return;
    const controller = new AbortController();
    void request<StarterBot[]>("/agents", { signal: controller.signal }).then(bots => {
      if (!controller.signal.aborted) setStarterBots({ agentId, bots });
    }).catch(() => { /* Generic suggestions remain useful when bots cannot be read. */ });
    return () => controller.abort();
  }, [empty, agentId]);
  const groupedItems = groupToolRuns(mergeReceipts(transcript.items));
  const dividerKeys = findDateDividerItemKeys(groupedItems);
  const starters = chatStarters(starterBots && starterBots.agentId === agentId ? starterBots.bots : [], agentId ?? null);
  return (
    <div className="conversation-frame relative flex min-h-0 flex-1 flex-col">
      <Announcer items={transcript.items} />
      <div ref={scroller} onScroll={onScroll} className="conversation-scroller min-h-0 flex-1 overflow-y-auto">
        <div role="log" aria-live="off" aria-label={t("chat.conversation")} className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
          {showSkeleton && (
            <div role="status" aria-busy="true" className="flex flex-col gap-5 py-2">
              <span className="sr-only">{t("chat.loading")}</span>
              <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
              <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
            </div>
          )}
          {empty && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Avatar agentId={agent?.id ?? null} name={agent?.name} size="lg" />
              <p className="text-lg font-semibold">{agent ? t(greetingKey(new Date().getHours()), { name: agent.name }) : t("chat.emptyPrompt")}</p>
              {agent && onStarter && <div className="chat-starters">
                {starters.map(({ key, params }) => <button key={key} onClick={() => onStarter(t(key, params))}>{t(key, params)}</button>)}
              </div>}
              {emptyHint && <p className="max-w-md text-sm text-muted">{emptyHint}</p>}
              {emptyAction && <Button variant="primary" onClick={emptyAction.onClick}>{emptyAction.label}</Button>}
              <p className="max-w-md text-xs text-faint">
                {t("chat.historyHint")}
              </p>
            </div>
          )}

          {groupedItems.map((item) => {
            const ts = "ts" in item && typeof item.ts === "string" ? item.ts : null;
            let node: React.ReactNode = null;
            switch (item.kind) {
              case "chat_card":
                node = threadId !== null ? <ChatCard key={item.key} item={item} threadId={threadId} agentId={agent?.id} running={transcript.runningTurnId !== null} /> : null; break;
              case "needs_you":
                node = <NeedsYouCard key={item.key} item={item} />; break;
              case "team_job":
                node = <DelegationCard key={item.key} item={item} />; break;
              case "team_notice":
                node = <TeamNoticeCard key={item.key} item={item} />; break;
              case "team_setup":
                node = <TeamSetupCard key={item.key} item={item} />; break;
              case "routine_change":
                node = <RoutineChangeCard key={item.key} item={item} />; break;
              case "agent_created":
                node = <AgentCreatedCard key={item.key} item={item} />; break;
              case "tool_run":
                node = <ToolRun workspace={workspace} key={item.key} tools={item.tools as Extract<TranscriptItem, { kind: "tool" }>[]} />; break;
              case "user":
                node = <UserMessage key={item.key} item={item} threadId={threadId} />; break;
              case "assistant": {
                const canReplyToMessage = !item.incomplete && isLatestAssistantMessage(item.key, transcript.items);
                node = (
                  <AssistantMessage
                    key={item.key}
                    text={item.text} threadId={threadId} workspacePath={workspacePath}
                    incomplete={item.incomplete}
                    ts={item.ts}
                    reaction={reactions[item.key] ?? null}
                    onReact={canReplyToMessage ? (r) => { void handleReact(item.key, r); } : undefined}
                    disabled={answering !== null || sendingReactionReplyDisabled}
                  />
                );
                break;
              }
              case "tool":
                node = <ToolStep workspace={workspace} key={item.key} item={item} />; break;
              case "approval":
                node = (
                  <ApprovalCard
                    workspace={workspace}
                    botName={agent?.name}
                    computerId={computerId}
                    onTakeOver={onTakeOver}
                    key={item.key}
                    item={item}
                    answering={answering === item.approvalId}
                    error={approvalErrors[item.approvalId] ?? null}
                    onAnswer={(decision, remember) => onAnswer(item.approvalId, decision, remember)}
                    remembered={remembered[item.approvalId]}
                    undoneRules={undoneRules}
                    onUndo={onUndo}
                  />
                ); break;
              case "turn_end":
                node = <TurnEnd key={item.key} item={item} />; break;
              case "session_reset":
                node = <SessionReset key={item.key} item={item} />; break;
              case "recalled":
                node = <RecalledChip key={item.key} item={item} />; break;
              case "compacted":
                node = <CompactedMarker key={item.key} item={item} />; break;
              case "engine_switched":
                node = <EngineSwitched key={item.key} item={item} />; break;
            }
            return <Fragment key={item.key}>{dividerKeys.has(item.key) && ts && <DateDivider ts={ts} />}{node}</Fragment>;
          })}

          {transcript.typing !== null && transcript.typing !== "" && <AssistantMessage text={transcript.typing} live />}

          {transcript.runningTurnId !== null && (working || waitingOnYou) && (
            <WorkingStatus key={transcript.runningTurnId} phase={workingPhase(transcript.items)} turnId={transcript.runningTurnId} />
          )}
        </div>
      </div>
      {away && (
        <button
          type="button"
          onClick={jumpToLatest}
          aria-label={waitingOnYou ? "Waiting for you" : t("chat.jumpLatest")}
          title={t("chat.jumpLatest")}
          className={`conversation-jump ${waitingOnYou ? "waiting" : ""}`}
        >
          <ArrowDown size={16} aria-hidden="true" />{waitingOnYou ? "Waiting for you" : t("chat.jumpLatest")}
        </button>
      )}
    </div>
  );
}
