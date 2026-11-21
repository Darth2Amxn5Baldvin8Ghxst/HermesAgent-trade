import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, Table2, ImageDown, ClipboardCopy } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toCsv } from "@/lib/hermes/format";

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("t-label", className)}>{children}</div>;
}

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClass,
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  bodyClass?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("panel flex min-w-0 flex-col", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line-0 px-4 py-2.5">
          <div className="t-label text-ink-1">{title}</div>
          <div className="flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className={cn("min-h-0 flex-1 p-4", bodyClass)}>{children}</div>
    </section>
  );
}

/** A number whose hover tooltip shows the formula and its current inputs (spec §9). */
export function Num({
  value,
  formula,
  inputs,
  className,
  flash = true,
}: {
  value: string;
  formula?: string;
  inputs?: string;
  className?: string;
  flash?: boolean;
}) {
  const prev = useRef(value);
  const [cls, setCls] = useState("");
  useEffect(() => {
    if (!flash || prev.current === value) return;
    const up =
      parseFloat(value.replace(/[^\d.−-]/g, "").replace("−", "-")) >=
      parseFloat(prev.current.replace(/[^\d.−-]/g, "").replace("−", "-"));
    prev.current = value;
    setCls(up ? "flash-pos" : "flash-neg");
    const t = setTimeout(() => setCls(""), 420);
    return () => clearTimeout(t);
  }, [value, flash]);
  const body = (
    <span className={cn("t-num rounded-sm px-0.5 transition-colors", cls, className)}>{value}</span>
  );
  if (!formula) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help decoration-line-1 decoration-dotted underline-offset-4 hover:underline">
          {body}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs border border-line-1 bg-surface-1 text-ink-0">
        <div className="t-label mb-1 text-gold-400">Formula</div>
        <div className="t-mono text-[12px]">{formula}</div>
        {inputs && (
          <>
            <div className="t-label mt-2 mb-1">Inputs</div>
            <div className="t-mono text-[12px] text-ink-1">{inputs}</div>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

const PILL: Record<string, string> = {
  RESEARCH: "border-line-1 text-ink-1",
  SHADOW: "border-info/40 text-info",
  PROBATION: "border-warn/40 text-warn",
  LIVE: "border-pos/40 text-pos",
  HALTED: "border-breach/50 text-neg",
  PASS: "border-pos/40 text-pos",
  FAIL: "border-breach/50 text-neg",
  PASSED: "border-pos/40 text-pos",
  FAILED: "border-breach/50 text-neg",
  IN_PROGRESS: "border-line-gold text-gold-400",
  LOCKED: "border-line-0 text-ink-3",
  OK: "border-pos/40 text-pos",
  ARMED: "border-breach/60 text-neg",
  ACCEPTED: "border-info/40 text-info",
  FILLED: "border-pos/40 text-pos",
  REJECTED: "border-breach/50 text-neg",
  EXPIRED: "border-line-1 text-ink-2",
  CANCELLED: "border-line-1 text-ink-2",
};
export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium uppercase tracking-[0.06em]",
        PILL[status] ?? "border-line-1 text-ink-1",
        className,
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (data.length < 2)
    return <svg width={width} height={height} className={className} aria-hidden="true" />;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const r = hi - lo || 1;
  const pts = data
    .map(
      (v, i) =>
        `${((i / (data.length - 1)) * width).toFixed(1)},${(height - ((v - lo) / r) * (height - 2) - 1).toFixed(1)}`,
    )
    .join(" ");
  const up = data[data.length - 1]! >= data[0]!;
  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={up ? "var(--pos)" : "var(--neg)"}
        strokeWidth="1.25"
      />
    </svg>
  );
}

async function nodeToPng(node: HTMLElement, name: string): Promise<void> {
  const canvas = node.querySelector("canvas");
  let url: string;
  if (canvas) url = canvas.toDataURL("image/png");
  else {
    const svg =
      node.querySelector("svg.recharts-surface, svg[data-chart]") ?? node.querySelector("svg");
    if (!svg) throw new Error("No chart to export");
    const clone = svg.cloneNode(true) as SVGElement;
    const { width, height } = svg.getBoundingClientRect();
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    const style = getComputedStyle(document.documentElement);
    let xml = new XMLSerializer().serializeToString(clone);
    xml = xml.replace(
      /var\(--([\w-]+)\)/g,
      (_, v: string) => style.getPropertyValue(`--${v}`).trim() || "#888",
    );
    const img = new Image();
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("render failed"));
      img.src = src;
    });
    const c = document.createElement("canvas");
    c.width = width * 2;
    c.height = height * 2;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = style.getPropertyValue("--surface-1").trim() || "#0e1013";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    url = c.toDataURL("image/png");
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.png`;
  a.click();
}

/** Chart card with the mandatory overflow: View as table, Download PNG, Copy data as CSV. */
export function ChartCard({
  title,
  data,
  children,
  className,
  actions,
  name,
}: {
  title: ReactNode;
  data: Record<string, unknown>[];
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  name: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Panel
      title={title}
      className={className}
      actions={
        <>
          {actions}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="rounded-md p-1 text-ink-2 hover:bg-surface-3 hover:text-ink-0"
              aria-label="Chart options"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-line-1 bg-surface-1">
              <DropdownMenuItem onClick={() => setAsTable((v) => !v)}>
                <Table2 className="size-4" /> {asTable ? "View as chart" : "View as table"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  ref.current &&
                  nodeToPng(ref.current, name).catch((e: unknown) =>
                    toast.error(e instanceof Error ? e.message : "Export failed"),
                  )
                }
              >
                <ImageDown className="size-4" /> Download PNG
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  navigator.clipboard.writeText(toCsv(data)).then(
                    () => toast.success(`${data.length} rows copied as CSV`),
                    () => toast.error("Clipboard unavailable"),
                  )
                }
              >
                <ClipboardCopy className="size-4" /> Copy data as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <div ref={ref} className="h-full">
        {asTable ? <DataTable rows={data} /> : children}
      </div>
    </Panel>
  );
}

export function DataTable({ rows, max = 500 }: { rows: Record<string, unknown>[]; max?: number }) {
  if (!rows.length) return <div className="t-label py-6 text-center">No data</div>;
  const keys = Object.keys(rows[0]!);
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-left">
        <thead className="sticky top-0 bg-surface-1">
          <tr>
            {keys.map((k) => (
              <th key={k} className="t-label px-2 py-1.5">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-line-0 odd:bg-surface-2/40">
              {keys.map((k) => (
                <td key={k} className="t-mono whitespace-nowrap px-2 py-1 text-[12px] text-ink-1">
                  {typeof r[k] === "number"
                    ? (r[k] as number).toLocaleString("en-US", { maximumFractionDigits: 6 })
                    : String(r[k] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] font-semibold leading-9 tracking-[-0.01em] text-ink-0">
          {title}
        </h1>
        {sub && <p className="mt-1 max-w-3xl text-ink-2">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  formula,
  inputs,
  tone,
}: {
  label: string;
  value: string;
  formula?: string;
  inputs?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className={cn("mt-1 text-[18px]", tone)}>
        <Num value={value} {...(formula ? { formula } : {})} {...(inputs ? { inputs } : {})} />
      </div>
    </div>
  );
}
