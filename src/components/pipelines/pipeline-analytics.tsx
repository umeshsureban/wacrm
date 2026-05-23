"use client";

import { useMemo } from "react";
import type { Deal, PipelineStage } from "@/types";
import {
  DollarSign,
  TrendingUp,
  Target,
  BarChart3,
  Trophy,
  XCircle,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatGroupedCurrency } from "@/lib/format-currency";

interface PipelineAnalyticsProps {
  stages: PipelineStage[];
  deals: Deal[];
}

/**
 * Weighted pipeline value: value × per-stage probability.
 * First stage ≈ 10%, stages interpolate up to 90% before the final stage,
 * final stage (Won) = 100%. Lost deals excluded.
 */
function computeStageProbability(
  stage: PipelineStage,
  sortedStages: PipelineStage[],
): number {
  const n = sortedStages.length;
  if (n <= 1) return 1;
  const index = sortedStages.findIndex((s) => s.id === stage.id);
  if (index < 0) return 0;
  if (index === n - 1) return 1;
  const slots = n - 1;
  if (slots <= 1) return 0.1;
  const t = index / (slots - 1);
  return 0.1 + t * (0.9 - 0.1);
}

export function PipelineAnalytics({ stages, deals }: PipelineAnalyticsProps) {
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const stats = useMemo(() => {
    const active = deals.filter((d) => d.status !== "lost");
    const openDeals = active.filter((d) => d.status !== "won");

    const totalCount = active.length;

    // Per-currency totals
    const totalByCur = new Map<string, number>();
    const countByCur = new Map<string, number>();
    for (const d of active) {
      const cur = d.currency || "USD";
      totalByCur.set(cur, (totalByCur.get(cur) ?? 0) + Number(d.value || 0));
      countByCur.set(cur, (countByCur.get(cur) ?? 0) + 1);
    }

    const avgByCur = new Map<string, number>();
    for (const [cur, total] of totalByCur) {
      avgByCur.set(cur, total / (countByCur.get(cur) ?? 1));
    }

    const stageById = new Map(sortedStages.map((s) => [s.id, s]));
    const weightedByCur = new Map<string, number>();
    for (const d of openDeals) {
      const stage = stageById.get(d.stage_id);
      if (!stage) continue;
      const prob = computeStageProbability(stage, sortedStages);
      const cur = d.currency || "USD";
      weightedByCur.set(
        cur,
        (weightedByCur.get(cur) ?? 0) + Number(d.value || 0) * prob,
      );
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = (d: Deal) => {
      const ts = d.updated_at ?? d.created_at;
      return ts ? new Date(ts) >= monthStart : false;
    };
    const wonThisMonth = deals.filter(
      (d) => d.status === "won" && thisMonth(d),
    ).length;
    const lostThisMonth = deals.filter(
      (d) => d.status === "lost" && thisMonth(d),
    ).length;

    return {
      totalCount,
      totalValueLabel: formatGroupedCurrency(totalByCur),
      avgValueLabel: formatGroupedCurrency(avgByCur),
      weightedValueLabel: formatGroupedCurrency(weightedByCur),
      wonThisMonth,
      lostThisMonth,
    };
  }, [deals, sortedStages]);

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:grid-cols-3 xl:grid-cols-6">
        <Metric
          icon={<BarChart3 className="h-4 w-4 text-slate-400" />}
          label="Total Deals"
          value={String(stats.totalCount)}
          tooltip="Count of every deal in this pipeline that isn't marked as Lost. Won deals are still included."
        />
        <Metric
          icon={<DollarSign className="h-4 w-4 text-violet-400" />}
          label="Pipeline Value"
          value={stats.totalValueLabel}
          tooltip="Sum of deal values in this pipeline, excluding deals marked as Lost."
        />
        <Metric
          icon={<Target className="h-4 w-4 text-blue-400" />}
          label="Avg Deal Size"
          value={stats.avgValueLabel}
          tooltip="Pipeline Value divided by Total Deals — the average value of a single non-lost deal."
        />
        <Metric
          icon={<TrendingUp className="h-4 w-4 text-purple-400" />}
          label="Weighted Value"
          value={stats.weightedValueLabel}
          tooltip="Expected revenue: each open deal's value × its stage probability. First stage ≈ 10%, stages progress up to 90%, Won = 100%. Lost deals are excluded."
        />
        <Metric
          icon={<Trophy className="h-4 w-4 text-violet-400" />}
          label="Won This Month"
          value={String(stats.wonThisMonth)}
          tooltip="Deals marked as Won since the first day of the current month."
        />
        <Metric
          icon={<XCircle className="h-4 w-4 text-red-400" />}
          label="Lost This Month"
          value={String(stats.lostThisMonth)}
          tooltip="Deals marked as Lost since the first day of the current month."
        />
      </div>
    </TooltipProvider>
  );
}

function Metric({
  icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip: string;
}) {
  return (
    <div className="rounded-lg bg-slate-800/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {icon}
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`How ${label} is calculated`}
                className="ml-auto text-slate-500 hover:text-slate-300 focus:outline-none"
              />
            }
          >
            <Info className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
    </div>
  );
}
