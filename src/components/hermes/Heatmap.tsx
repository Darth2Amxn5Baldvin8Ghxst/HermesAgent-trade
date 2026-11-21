import { cn } from "@/lib/utils";

/** Plateau heatmap: x = param A, y = param B, cell = metric; plateau cells outlined in gold. */
export function Heatmap({
  valuesA,
  valuesB,
  grid,
  plateau,
  paramA,
  paramB,
  selected,
  onSelect,
  small = false,
  fmt = (v: number) => v.toFixed(2),
}: {
  valuesA: number[];
  valuesB: number[];
  grid: number[][];
  plateau: boolean[][];
  paramA: string;
  paramB: string;
  selected?: [number, number] | null;
  onSelect?: (i: number, j: number) => void;
  small?: boolean;
  fmt?: (v: number) => string;
}) {
  const flat = grid.flat().filter(Number.isFinite);
  const lo = Math.min(...flat, 0);
  const hi = Math.max(...flat, 0);
  const color = (v: number) => {
    if (!Number.isFinite(v)) return "var(--surface-3)";
    if (v >= 0)
      return `color-mix(in srgb, var(--pos) ${Math.round((hi > 0 ? v / hi : 0) * 70) + 8}%, var(--surface-2))`;
    return `color-mix(in srgb, var(--neg) ${Math.round((lo < 0 ? v / lo : 0) * 70) + 8}%, var(--surface-2))`;
  };
  return (
    <div className="inline-block">
      {!small && <div className="t-label mb-1 pl-14">{paramB} →</div>}
      <div className="flex">
        {!small && (
          <div className="t-label flex w-6 items-center [writing-mode:vertical-rl] rotate-180">
            {paramA} →
          </div>
        )}
        <table className="border-separate border-spacing-1">
          {!small && (
            <thead>
              <tr>
                <th />
                {valuesB.map((b) => (
                  <th key={b} className="t-num px-1 text-[10px] font-normal text-ink-2">
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {valuesA.map((a, i) => (
              <tr key={a}>
                {!small && <td className="t-num pr-1 text-right text-[10px] text-ink-2">{a}</td>}
                {valuesB.map((b, j) => {
                  const v = grid[i]?.[j] ?? NaN;
                  const on = plateau[i]?.[j];
                  const sel = selected?.[0] === i && selected?.[1] === j;
                  return (
                    <td key={b} className="p-0">
                      <button
                        type="button"
                        disabled={!onSelect}
                        onClick={() => onSelect?.(i, j)}
                        className={cn(
                          "t-num grid place-items-center rounded-[4px] border text-ink-0",
                          small ? "size-5 text-[0px]" : "h-10 w-16 text-[11px]",
                          on ? "border-gold-400" : "border-transparent",
                          sel && "ring-2 ring-ink-0",
                        )}
                        style={{ background: color(v) }}
                        title={`${paramA}=${a}, ${paramB}=${b}: ${fmt(v)}${on ? " · plateau" : ""}`}
                      >
                        {small ? "" : fmt(v)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
