"use client";

import { useT } from "@/lib/use-i18n";
import Link from "next/link";
import { readableModel } from "@/lib/control-room";
import { useEffect, useState } from "react";
import { api, ApiError, type UsageSummary, type UsageTotals } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { EmptyPanel, ErrorState, LoadingState } from "./PanelState";
import { currentMonth, formatCost, formatTokens, shiftMonth } from "@/lib/everyday";

function Row({ group, link }: { group: UsageTotals; link?: string }) {
  return (
    <tr className="border-t border-line">
      <td className="max-w-56 truncate py-1.5 pr-3">
        {link ? <Link href={link} className="hover:underline">{readableModel(group.label)}</Link> : readableModel(group.label)}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{group.turns}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{formatTokens(group.input_tokens)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{formatTokens(group.output_tokens)}</td>
      <td className="py-1.5 text-right tabular-nums" title={group.unreported_turns ? `${group.unreported_turns} turn(s) reported nothing` : undefined}>
        {formatCost(group.cost_usd)}
        {group.cost_usd !== null && group.unreported_turns > 0 ? "*" : ""}
      </td>
    </tr>
  );
}

function Table({ title, groups, linkFor }: { title: string; groups: UsageTotals[]; linkFor?: (g: UsageTotals) => string | undefined }) {
  const t = useT();
  if (groups.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[460px] text-xs">
        <thead className="text-muted">
          <tr>
            <th className="py-1 text-left font-normal">{t("audit.name")}</th>
            <th className="py-1 pl-3 text-right font-normal whitespace-nowrap">{t("audit.turns")}</th>
            <th className="py-1 pl-3 text-right font-normal whitespace-nowrap">{t("audit.input")}</th>
            <th className="py-1 pl-3 text-right font-normal whitespace-nowrap">{t("audit.output")}</th>
            <th className="py-1 pl-3 text-right font-normal whitespace-nowrap">{t("audit.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Row key={group.key} group={group} link={linkFor?.(group)} />
          ))}
        </tbody>
      </table></div>
    </section>
  );
}

// Tokens and cost for a month, exactly as engines reported them (docs/EVERYDAY.md).
export function UsageView() {
  const t = useT();
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    api
      .getUsage(month)
      .then((value) => {
        if (!alive) return;
        setSummary(value);
        setError(null);
      })
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Could not reach the backend."));
    return () => {
      alive = false;
    };
  }, [month, reload]);

  const exportCsv = async () => {
    setCsvError(null);
    try {
      const text = await api.usageCsv(month);
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `chief-of-noumenon-usage-${month}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast(`Exported ${month} as CSV`);
    } catch (err) {
      setCsvError(err instanceof ApiError ? err.message : "Could not export.");
    }
  };

  const shown = summary?.month === month ? summary : null;
  const total = shown?.total;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("audit.previousMonth")} className="cursor-pointer rounded px-3 py-1 text-sm hover:bg-hover">‹</button>
        <span className="text-sm tabular-nums">{month}</span>
        <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= currentMonth()} aria-label={t("audit.nextMonth")} className="cursor-pointer rounded px-3 py-1 text-sm hover:bg-hover disabled:opacity-40">›</button>
      </div>
      <div className="space-y-5">
          {error && <ErrorState message={error} onRetry={() => { setError(null); setReload((n) => n + 1); }} />}
          {!error && !shown && <LoadingState rows={4} />}
          {total && total.turns === 0 && <EmptyPanel title={`No finished turns in ${month}`} description="Usage appears here once a bot finishes a turn." />}
          {total && total.turns > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><p className="text-xs text-muted">{t("audit.turns")}</p><p className="text-lg tabular-nums">{total.turns}</p></div>
                <div>
                  <p className="text-xs text-muted">{t("audit.inputTokens")}</p>
                  <p className="text-lg tabular-nums">{formatTokens(total.input_tokens)}</p>
                  {total.cache_read_input_tokens + total.cache_creation_input_tokens > 0 && (
                    <p className="text-[11px] text-muted">
                      + {formatTokens(total.cache_read_input_tokens + total.cache_creation_input_tokens)} cached
                    </p>
                  )}
                </div>
                <div><p className="text-xs text-muted">{t("audit.outputTokens")}</p><p className="text-lg tabular-nums">{formatTokens(total.output_tokens)}</p></div>
                <div><p className="text-xs text-muted">{t("audit.cost")}</p><p className="text-lg tabular-nums">{formatCost(total.cost_usd)}</p></div>
              </div>
              <p className="text-xs text-muted">
                Token counts are reported by the engine. Costs are estimates of API-equivalent usage; subscription engines do not charge this amount per message. Days and months are in UTC.
                {total.unreported_turns > 0 &&
                  ` ${total.unreported_turns} of ${total.turns} turns reported no usage, so they are not in these totals (marked * where a cost is shown).`}
              </p>
              <Table title={t("audit.byConversation")} groups={shown.by_thread} linkFor={(g) => (g.thread_id ? `/chat?thread=${g.thread_id}` : undefined)} />
              <Table title={t("audit.byEngine")} groups={shown.by_engine} />
              <Table title={t("audit.byDay")} groups={shown.by_day} />
            </>
          )}
          {shown?.helper && shown.helper.calls > 0 && (
            <section aria-label="Helper model">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Helper model</h3>
              <p className="mb-1 text-xs text-muted">
                {shown.helper.calls} call{shown.helper.calls === 1 ? "" : "s"} written for bots whose own engine cannot
                write them
                {shown.helper.failed > 0 && ` (${shown.helper.failed} failed)`}. Tokens only where the engine reported them.
              </p>
              <ul className="space-y-0.5 text-xs">
                {shown.helper.groups.map((g) => (
                  <li key={`${g.engine}/${g.model}/${g.job}/${g.agent}`} className="flex flex-wrap gap-x-3">
                    <span>{g.agent || "a bot"}</span>
                    <span className="text-muted">{g.job === "compaction" ? "summaries" : "memory upkeep"}</span>
                    <span className="text-muted">{g.engine}{g.model ? ` · ${g.model}` : ""}</span>
                    <span className="tabular-nums">{g.calls} call{g.calls === 1 ? "" : "s"}</span>
                    {g.input_tokens + g.output_tokens > 0 && (
                      <span className="tabular-nums text-muted">
                        {formatTokens(g.input_tokens)} in · {formatTokens(g.output_tokens)} out
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => void exportCsv()}>Export {month} as CSV</Button>
            {csvError && <span role="alert" className="text-xs text-danger">{csvError}</span>}
          </div>
      </div>
    </div>
  );
}
