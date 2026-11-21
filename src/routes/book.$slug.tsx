import { createFileRoute, notFound } from "@tanstack/react-router";
import { BOOK_SECTIONS } from "@/content/book";
import { SectionView } from "@/components/hermes/BookShell";

export const Route = createFileRoute("/book/$slug")({
  loader: ({ params }) => {
    const s = BOOK_SECTIONS.find((x) => x.slug === params.slug);
    if (!s) throw notFound();
    return { slug: s.slug, title: s.title, summary: s.summary };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} — Strategy Book` },
          { name: "description", content: loaderData.summary },
          { property: "og:title", content: `${loaderData.title} — HermesAgents Strategy Book` },
          { property: "og:description", content: loaderData.summary },
          { property: "og:type", content: "article" },
          { name: "twitter:card", content: "summary_large_image" },
        ]
      : [{ title: "Section unavailable — Strategy Book" }, { name: "robots", content: "noindex" }],
  }),
  component: BookSectionPage,
});

function BookSectionPage() {
  const { slug } = Route.useLoaderData();
  const s = BOOK_SECTIONS.find((x) => x.slug === slug)!;
  return <SectionView s={s} />;
}
