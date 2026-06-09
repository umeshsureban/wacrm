"use client"

import { GitBranch } from 'lucide-react'
import type { PipelineDonutData } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'
import { formatGroupedCurrency } from '@/lib/format-currency'

interface PipelineDonutProps {
  data: PipelineDonutData | null
  loading: boolean
}

export function PipelineDonut({ data, loading }: PipelineDonutProps) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900">
      <header className="border-b border-slate-800 px-5 py-4">
        <h2 className="text-sm font-semibold text-white">Pipeline Value</h2>
        <p className="mt-0.5 text-xs text-slate-500">Open deals by stage</p>
      </header>

      <div className="flex flex-1 flex-col p-5">
        {loading || !data ? (
          <Skeleton className="h-56 w-full" />
        ) : data.stages.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="No open deals yet"
            hint="Create deals in Pipelines to see stage breakdowns here."
          />
        ) : (
          <BarChart data={data} />
        )}
      </div>
    </section>
  )
}

function BarChart({ data }: { data: PipelineDonutData }) {
  // Collect unique currencies across all stages, preserving insertion order
  const currencies = Array.from(
    new Set(data.stages.flatMap((s) => Object.keys(s.valueByCurrency)))
  )

  return (
    <div className="flex flex-col gap-6">
      {currencies.map((cur) => {
        const rows = data.stages
          .filter((s) => (s.valueByCurrency[cur] ?? 0) > 0)
          .sort((a, b) => (b.valueByCurrency[cur] ?? 0) - (a.valueByCurrency[cur] ?? 0))

        const maxVal = rows[0]?.valueByCurrency[cur] ?? 1
        const curTotal = data.totalByCurrency[cur] ?? 0

        return (
          <div key={cur}>
            {/* Currency group header */}
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {cur}
              </span>
              <span className="text-xs font-semibold text-slate-300 tabular-nums">
                {formatGroupedCurrency(new Map([[cur, curTotal]]))}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {rows.map((s) => {
                const val = s.valueByCurrency[cur] ?? 0
                const pct = Math.max(4, Math.round((val / maxVal) * 100))
                return (
                  <div key={s.id}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: s.color }}
                        />
                        <span className="truncate text-slate-300">{s.name}</span>
                        <span className="shrink-0 text-slate-600 tabular-nums">
                          {s.dealCount} deal{s.dealCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <span className="shrink-0 font-medium tabular-nums text-slate-200">
                        {formatGroupedCurrency(new Map([[cur, val]]))}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full transition-[width] duration-500 ease-out"
                        style={{ width: `${pct}%`, background: s.color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
