import { Link } from "@tanstack/react-router";
import { MarketingLayout } from "../components/marketing/MarketingLayout.js";
import { GuideCard } from "../components/marketing/GuidesHub.js";
import { GUIDES } from "../lib/guides.js";
import { SITE_URL, useSeo } from "../lib/seo.js";

/** Index of every guide — the hub a crawler follows to reach the articles. */
export function GuidesPage() {
  useSeo({
    title: "Gaming guides — backlogs, imports, collecting and progress tracking",
    description:
      "Practical guides on organising a game backlog, optimising a Steam library, cataloguing physical games, building play-order collections and tracking mission progress. Free to read, no account needed.",
    path: "/guides",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Gaming guides",
      url: `${SITE_URL}/guides`,
      hasPart: GUIDES.map((guide) => ({
        "@type": "Article",
        headline: guide.title,
        description: guide.excerpt,
        url: `${SITE_URL}/guides/${guide.slug}`,
        dateModified: guide.updated,
      })),
    },
  });

  return (
    <MarketingLayout>
      <header className="max-w-3xl">
        <p className="text-xs font-semibold tracking-widest text-indigo-400 uppercase">
          Gaming guides
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">
          Guides for people with too many games
        </h1>
        <p className="mt-4 text-base leading-7 text-zinc-400">
          Everything here is about the same problem from different angles: modern gamers own far
          more than they can play, and no storefront is built to help with that. These guides
          cover the practical side — how to organise a backlog you will actually finish, how to
          import a large collection without typing it in, how to catalogue physical games
          properly, and how to track progress in a way that means something.
        </p>
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          No account is needed to read any of them.
        </p>
      </header>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {GUIDES.map((guide) => (
          <div key={guide.slug} className="relative">
            <GuideCard guide={guide} />
          </div>
        ))}
      </div>

      <section className="mt-14 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-bold tracking-tight text-zinc-100">
          Want the tool these guides describe?
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Game Manager does the mechanical parts: importing your library, tracking mission-level
          progress, and estimating how long your backlog will really take. It's free to use.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            to="/register"
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            Get started free
          </Link>
          <Link
            to="/welcome"
            className="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800"
          >
            See what it does
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
