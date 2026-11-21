import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDownUp, Copy, FlaskConical, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Verified } from "@/engine/verify";
import { cn } from "@/lib/utils";

type Block =
  | { k: "p"; text: string }
  | { k: "h3"; text: string }
  | { k: "ol"; items: string[] }
  | { k: "ul"; items: string[] }
  | { k: "table"; head: string[]; rows: string[][] }
  | { k: "warn"; title: string; items: string[] }
  | { k: "code"; lang: string; meta: string; text: string };

export function parseBook(md: string): Block[] {
  const lines = md.split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (!l.trim()) {
      i++;
      continue;
    }
    if (l.startsWith(":::warning")) {
      const title = l.replace(":::warning", "").trim();
      const items: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith(":::")) {
        if (lines[i]!.startsWith("- ")) items.push(lines[i]!.slice(2));
        i++;
      }
      i++;
      out.push({ k: "warn", title, items });
      continue;
    }
    if (l.startsWith("```")) {
      const [lang = "", ...meta] = l.slice(3).split(" ");
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) buf.push(lines[i++]!);
      i++;
      out.push({ k: "code", lang, meta: meta.join(" "), text: buf.join("\n") });
      continue;
    }
    if (l.startsWith("### ")) {
      out.push({ k: "h3", text: l.slice(4) });
      i++;
      continue;
    }
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) {
        const cells = lines[i]!.split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
        i++;
      }
      out.push({ k: "table", head: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    if (/^\d+\. /.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i]!))
        items.push(lines[i++]!.replace(/^\d+\. /, ""));
      out.push({ k: "ol", items });
      continue;
    }
    if (l.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) items.push(lines[i++]!.slice(2));
      out.push({ k: "ul", items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(\||- |\d+\. |```|:::|### )/.test(lines[i]!))
      buf.push(lines[i++]!);
    out.push({ k: "p", text: buf.join(" ") });
  }
  return out;
}

export function Inline({
  text,
  verified,
}: {
  text: string;
  verified: Record<string, Verified>;
}): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\{\{v:([\w.]+)\|([^}]+)\}\}|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      const v = verified[m[1]];
      parts.push(
        <Tooltip key={n++}>
          <TooltipTrigger asChild>
            <span className="t-num cursor-help rounded-sm border-b border-dotted border-line-gold px-0.5 text-[0.92em] text-gold-300">
              {m[2]}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm border border-line-1 bg-surface-1 font-sans text-ink-0">
            <div className="t-label mb-1 text-gold-400">Verified in code · live</div>
            <div className="t-num text-[15px]">{v?.value ?? "—"}</div>
            <div className="t-mono mt-1 text-[11px] text-ink-1">{v?.formula}</div>
            <div className="t-mono text-[11px] text-ink-2">{v?.inputs}</div>
          </TooltipContent>
        </Tooltip>,
      );
    } else if (m[3]) parts.push(<strong key={n++}>{m[3]}</strong>);
    else if (m[4]) parts.push(<em key={n++}>{m[4]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function SortTable({
  head,
  rows,
  verified,
}: {
  head: string[];
  rows: string[][];
  verified: Record<string, Verified>;
}) {
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const num = (s: string) =>
      parseFloat(
        s
          .replace(/\{\{v:[\w.]+\|/, "")
          .replace(/[^\d.−-]/g, "")
          .replace("−", "-"),
      );
    return [...rows].sort((a, b) => {
      const x = a[sort.i] ?? "";
      const y = b[sort.i] ?? "";
      const nx = num(x);
      const ny = num(y);
      return (Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y)) * sort.dir;
    });
  }, [rows, sort]);
  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-line-0 font-sans">
      <table className="w-full text-left text-[13px] leading-5">
        <thead className="bg-surface-2">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="t-label px-3 py-2">
                <button
                  onClick={() =>
                    setSort((s) => (s?.i === i ? { i, dir: s.dir === 1 ? -1 : 1 } : { i, dir: 1 }))
                  }
                  className="inline-flex items-center gap-1 hover:text-ink-0"
                >
                  {h} <ArrowDownUp className="size-3 opacity-50" />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className="border-t border-line-0 odd:bg-surface-2/40">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={cn(
                    "px-3 py-2 align-top text-ink-1",
                    /^[\d.,%×+−\- ]+$/.test(c) && "t-num",
                  )}
                >
                  <Inline text={c} verified={verified} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BookBody({
  md,
  verified,
  dropcap,
}: {
  md: string;
  verified: Record<string, Verified>;
  dropcap?: boolean;
}) {
  const blocks = useMemo(() => parseBook(md), [md]);
  let firstP = true;
  return (
    <div className="book-prose">
      {blocks.map((b, i) => {
        switch (b.k) {
          case "p": {
            const cap = dropcap && firstP;
            firstP = false;
            return (
              <p key={i} className={cn("my-4", cap && "book-dropcap")}>
                <Inline text={b.text} verified={verified} />
              </p>
            );
          }
          case "h3":
            return (
              <h3
                key={i}
                id={b.text.toLowerCase().replace(/\W+/g, "-")}
                className="mt-8 mb-2 font-display text-[20px] font-semibold text-ink-0"
              >
                {b.text}
              </h3>
            );
          case "ol":
            return (
              <ol
                key={i}
                className="my-4 list-decimal space-y-2 pl-6 marker:font-mono marker:text-[13px] marker:text-gold-500"
              >
                {b.items.map((t, j) => (
                  <li key={j} id={`rule-${j + 1}`}>
                    <Inline text={t} verified={verified} />
                  </li>
                ))}
              </ol>
            );
          case "ul":
            return (
              <ul key={i} className="my-4 list-disc space-y-2 pl-6 marker:text-gold-600">
                {b.items.map((t, j) => (
                  <li key={j}>
                    <Inline text={t} verified={verified} />
                  </li>
                ))}
              </ul>
            );
          case "table":
            return <SortTable key={i} head={b.head} rows={b.rows} verified={verified} />;
          case "warn":
            return (
              <div
                key={i}
                id="do-not-copy"
                className="my-6 rounded-lg border-2 border-breach/70 bg-breach/5 p-5 font-sans"
              >
                <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-neg uppercase">
                  <AlertTriangle className="size-4" /> {b.title}
                </div>
                <div className="space-y-3 text-[14px] leading-6 text-ink-1">
                  {b.items.map((t, j) => (
                    <p key={j}>
                      <Inline text={t} verified={verified} />
                    </p>
                  ))}
                </div>
              </div>
            );
          case "code": {
            const agent = /agent=(G\d)/.exec(b.meta)?.[1];
            return (
              <div
                key={i}
                className="my-6 overflow-hidden rounded-lg border border-line-1 bg-surface-0 font-sans"
              >
                <div className="flex items-center justify-between border-b border-line-0 px-3 py-1.5">
                  <span className="t-label">Engine rule card {agent ? `· ${agent}` : ""}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(b.text).then(() => toast.success("Copied"))
                      }
                      className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-ink-2 hover:bg-surface-3 hover:text-ink-0"
                    >
                      <Copy className="size-3" /> Copy
                    </button>
                    {agent && (
                      <Link
                        to="/backtest"
                        search={{ agent }}
                        className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-gold-400 hover:bg-surface-3"
                      >
                        <FlaskConical className="size-3" /> Open in Backtest Studio
                      </Link>
                    )}
                  </div>
                </div>
                <pre className="overflow-x-auto p-4 text-[12.5px] leading-6">
                  {b.text.split("\n").map((line, j) => {
                    const m = /^(\w+)(\s+)(.*)$/.exec(line);
                    return (
                      <Fragment key={j}>
                        {m ? (
                          <>
                            <span className="font-mono font-semibold text-gold-400">{m[1]}</span>
                            <span>{m[2]}</span>
                            <span className="font-mono text-ink-1">
                              {m[3]!.split(/(\d+(?:\.\d+)?%?)/).map((s, k) =>
                                k % 2 ? (
                                  <span key={k} className="text-info">
                                    {s}
                                  </span>
                                ) : (
                                  s
                                ),
                              )}
                            </span>
                          </>
                        ) : (
                          <span className="font-mono text-ink-1">{line}</span>
                        )}
                        {"\n"}
                      </Fragment>
                    );
                  })}
                </pre>
              </div>
            );
          }
        }
        return null;
      })}
    </div>
  );
}
