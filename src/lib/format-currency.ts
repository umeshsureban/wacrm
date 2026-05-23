export function groupByCurrency(
  deals: { value: number | null; currency?: string | null }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of deals) {
    const cur = d.currency || "USD";
    map.set(cur, (map.get(cur) ?? 0) + Number(d.value ?? 0));
  }
  return map;
}

export function formatGroupedCurrency(groups: Map<string, number>): string {
  if (groups.size === 0) return formatOne(0, "USD");
  return Array.from(groups.entries())
    .map(([cur, total]) => formatOne(total, cur))
    .join(" · ");
}

function formatOne(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
