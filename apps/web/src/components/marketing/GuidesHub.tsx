import { Link } from "@tanstack/react-router";
import { GUIDES, type Guide } from "../../lib/guides.js";
import { SectionHeading } from "./MarketingLayout.js";

function formatUpdated(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** One article card. Links to the full guide — the card is a summary, never
 *  the whole article, so each guide has a real page of its own to index. */
export function GuideCard({ guide }: { guide: Guide }) {
  return (
    <article className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 transition hover:border-zinc-700 hover:bg-zinc-900">
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded bg-indigo-950 px-2 py-0.5 font-medium text-indigo-300">
          {guide.category}
        </span>
        <span className="text-zinc-500">{guide.readMinutes} min read</span>
      </div>

      <h3 className="mt-3 text-base font-semibold text-zinc-100">
        <Link to="/guides/$slug" params={{ slug: guide.slug }} className="hover:text-white">
          {/* stretched-link: the whole card is the hit area, but only the
              heading is the accessible link */}
          <span className="absolute inset-0" aria-hidden="true" />
          {guide.title}
        </Link>
      </h3>

      <p className="mt-2 flex-1 text-sm leading-6 text-zinc-400">{guide.excerpt}</p>

      <p className="mt-4 text-xs text-zinc-500">Updated {formatUpdated(guide.updated)}</p>
    </article>
  );
}

/**
 * The Gaming Guides grid.
 *
 * On the landing page this is the section that gives a crawler something to
 * follow: every card links to a full article at its own URL, and those
 * articles are the site's actual indexable content. A card that linked
 * nowhere would look the same and be worth nothing.
 */
export function GuidesHub({ limit }: { limit?: number }) {
  const guides = limit ? GUIDES.slice(0, limit) : GUIDES;

  return (
    <section aria-labelledby="guides-heading">
      <SectionHeading
        id="guides"
        eyebrow="Gaming guides"
        title="Guides for people with too many games"
        blurb="Practical writing on backlogs, imports, collecting and progress tracking. No sign-up required to read any of it."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {guides.map((guide) => (
          // relative here is what the card's stretched-link overlay anchors to
          <div key={guide.slug} className="relative">
            <GuideCard guide={guide} />
          </div>
        ))}
      </div>

      {limit && limit < GUIDES.length && (
        <div className="mt-6">
          <Link
            to="/guides"
            className="inline-block rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800"
          >
            Read all {GUIDES.length} guides
          </Link>
        </div>
      )}
    </section>
  );
}
