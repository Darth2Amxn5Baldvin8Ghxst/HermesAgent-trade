import { createFileRoute, Link } from "@tanstack/react-router";
import { BOOK_META, BOOK_SECTIONS } from "@/content/book";
import { BookLayout, StatusBadge } from "@/components/hermes/BookShell";

export const Route = createFileRoute("/book/")({
  head: () => ({
    meta: [
      { title: "Strategy Book — HermesAgents" },
      {
        name: "description",
        content:
          "The Sonic-class gold strategy book: four agents, a shared risk gateway, the overseer and a ten-step validation gate.",
      },
      { property: "og:title", content: "Strategy Book — HermesAgents" },
      {
        property: "og:description",
        content: "Copy Sonic's trading profile, not its product — the full living strategy book.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BookIndex,
});

function BookIndex() {
  return (
    <BookLayout active={null}>
      <div className="t-label mb-3">{BOOK_META.dateLine}</div>
      <h1 className="font-display text-[40px] leading-[48px] font-semibold tracking-[-0.02em]">
        {BOOK_META.title}
      </h1>
      <p className="book-prose book-dropcap mt-6">{BOOK_META.abstract}</p>
      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {BOOK_SECTIONS.map((s) => (
          <Link
            key={s.slug}
            to="/book/$slug"
            params={{ slug: s.slug }}
            className="card-t block p-4 transition-colors hover:border-line-gold"
          >
            <div className="flex items-center justify-between">
              <span className="t-num text-gold-500">§{s.number}</span>
              <StatusBadge slug={s.slug} />
            </div>
            <div className="mt-2 font-display text-[16px] font-semibold leading-6">{s.title}</div>
            <div className="mt-1 text-[12px] leading-5 text-ink-2">{s.summary}</div>
          </Link>
        ))}
      </div>
    </BookLayout>
  );
}
