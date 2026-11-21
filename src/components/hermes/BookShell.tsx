import { useMemo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BOOK_META, BOOK_SECTIONS, type BookSection } from "@/content/book";
import manifest from "@/content/book_section_manifest.json";
import { verifiedNumbers } from "@/engine/verify";
import { useMcCache, useSim } from "@/lib/hermes/store";
import { cn } from "@/lib/utils";
import { BookBody } from "./BookRenderer";

export function useVerified() {
  const mc = useMcCache((s) => s.results);
  const engine = useSim((s) => s.engine);
  useSim((s) => Math.floor(s.version / 20));
  const g1 = engine?.trades.filter((t) => t.agent === "G1") ?? [];
  return useMemo(
    () =>
      verifiedNumbers({
        mc,
        g1HitRate: g1.length ? g1.filter((t) => t.net.gt(0)).length / g1.length : null,
        g1Trades: g1.length,
        goldEventsPerYear: 24,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mc, g1.length],
  );
}

const m = manifest as Record<string, { number: number; status: string; module: string | null }>;
export function StatusBadge({ slug }: { slug: string }) {
  const s = m[slug];
  if (!s) return null;
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase",
        s.status.startsWith("Implemented") ? "border-pos/40 text-pos" : "border-line-1 text-ink-2",
      )}
    >
      {s.status}
    </span>
  );
}

export function BookLayout({
  active,
  children,
  aside,
}: {
  active: string | null;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,720px)] min-[1440px]:grid-cols-[260px_minmax(0,720px)_260px]">
      <nav className="lg:sticky lg:top-4 lg:self-start" aria-label="Book sections">
        <Link to="/book" className="t-label mb-3 block hover:text-ink-0">
          Strategy Book
        </Link>
        <ol className="space-y-1">
          {BOOK_SECTIONS.map((s) => (
            <li key={s.slug}>
              <Link
                to="/book/$slug"
                params={{ slug: s.slug }}
                className={cn(
                  "block rounded-md px-3 py-2 transition-colors",
                  active === s.slug
                    ? "bg-surface-2 text-ink-0"
                    : "text-ink-2 hover:bg-surface-1 hover:text-ink-0",
                )}
              >
                <div className="flex gap-2 text-[13px]">
                  <span className="t-num text-gold-500">{s.number}</span>
                  <span className="leading-5">{s.title}</span>
                </div>
                <div className="mt-0.5 pl-5 text-[11px] leading-4 text-ink-3">{s.summary}</div>
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      <article className="min-w-0">{children}</article>
      <aside className="hidden min-[1440px]:block">{aside}</aside>
    </div>
  );
}

export function SectionView({ s }: { s: BookSection }) {
  const verified = useVerified();
  const keys = [...s.body.matchAll(/\{\{v:([\w.]+)\|/g)].map((x) => x[1]!);
  return (
    <BookLayout
      active={s.slug}
      aside={
        <div className="sticky top-4 space-y-4 text-[12px]">
          <div className="t-label">Margin notes</div>
          <div className="rounded-lg border border-line-0 p-3">
            <div className="t-label mb-1">Engine module</div>
            <div className="t-mono text-ink-1">{s.engineModule ?? "reference only"}</div>
          </div>
          {keys.length > 0 && (
            <div className="rounded-lg border border-line-0 p-3">
              <div className="t-label mb-2">Verified in code</div>
              <ul className="space-y-1.5">
                {keys.map((k) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span className="t-mono truncate text-ink-2">{k}</span>
                    <span className="t-num shrink-0 text-gold-300">
                      {verified[k]?.value.split(" · ")[0]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
    >
      <header id={s.slug} className="mb-6">
        <div className="mb-2 flex items-center gap-3">
          <span className="t-num text-gold-500">§{s.number}</span>
          <StatusBadge slug={s.slug} />
        </div>
        <h1 className="font-display text-[34px] leading-[42px] font-semibold tracking-[-0.02em] text-ink-0">
          <a
            href={`#${s.slug}`}
            className="hover:underline decoration-line-gold underline-offset-8"
          >
            {s.title}
          </a>
        </h1>
      </header>
      <BookBody md={s.body} verified={verified} dropcap />
      <div className="mt-10 flex justify-between border-t border-line-0 pt-4 text-[13px]">
        {BOOK_SECTIONS[s.number - 2] ? (
          <Link
            to="/book/$slug"
            params={{ slug: BOOK_SECTIONS[s.number - 2]!.slug }}
            className="text-ink-2 hover:text-gold-400"
          >
            ← §{s.number - 1} {BOOK_SECTIONS[s.number - 2]!.title}
          </Link>
        ) : (
          <span />
        )}
        {BOOK_SECTIONS[s.number] ? (
          <Link
            to="/book/$slug"
            params={{ slug: BOOK_SECTIONS[s.number]!.slug }}
            className="text-ink-2 hover:text-gold-400"
          >
            §{s.number + 1} {BOOK_SECTIONS[s.number]!.title} →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </BookLayout>
  );
}

export { BOOK_META };
