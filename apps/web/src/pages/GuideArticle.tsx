import { Link, useParams } from "@tanstack/react-router";
import { MarketingLayout } from "../components/marketing/MarketingLayout.js";
import { AdSlot } from "../components/marketing/AdSlot.js";
import { GuideCard } from "../components/marketing/GuidesHub.js";
import { GUIDES, guideBySlug } from "../lib/guides.js";
import { SITE_NAME, SITE_URL, useSeo } from "../lib/seo.js";

function formatUpdated(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Unknown slug. Kept in-app rather than a redirect so the URL a stale link
 *  points at still explains itself — and marked noindex so it can't be
 *  indexed as thin content. */
function GuideNotFound({ slug }: { slug: string }) {
  useSeo({
    title: "Guide not found",
    description: "That guide doesn't exist. Browse the full list of Game Manager gaming guides.",
    path: `/guides/${slug}`,
    noIndex: true,
  });

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-2xl py-12 text-center">
        <h1 className="text-2xl font-bold text-zinc-100">We couldn't find that guide</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          The link may be out of date. Everything we've published is listed on the guides page.
        </p>
        <Link
          to="/guides"
          className="mt-6 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          Browse all guides
        </Link>
      </div>
    </MarketingLayout>
  );
}

export function GuideArticlePage() {
  const { slug } = useParams({ from: "/guides/$slug" });
  const guide = guideBySlug(slug);

  if (!guide) return <GuideNotFound slug={slug} />;
  return <GuideArticle key={guide.slug} />;
}

/** Split out so the hooks below only ever run with a guide in hand. */
function GuideArticle() {
  const { slug } = useParams({ from: "/guides/$slug" });
  const guide = guideBySlug(slug)!;
  const related = GUIDES.filter((g) => g.slug !== guide.slug).slice(0, 3);

  useSeo({
    title: guide.title,
    description: guide.excerpt,
    path: `/guides/${guide.slug}`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: guide.title,
        description: guide.excerpt,
        articleSection: guide.category,
        dateModified: guide.updated,
        mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/guides/${guide.slug}` },
        publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guides` },
          {
            "@type": "ListItem",
            position: 3,
            name: guide.title,
            item: `${SITE_URL}/guides/${guide.slug}`,
          },
        ],
      },
    ],
  });

  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl">
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-500">
          <Link to="/welcome" className="hover:text-zinc-300">
            Home
          </Link>
          <span className="mx-2" aria-hidden="true">
            /
          </span>
          <Link to="/guides" className="hover:text-zinc-300">
            Guides
          </Link>
        </nav>

        <header className="mt-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-indigo-950 px-2 py-0.5 font-medium text-indigo-300">
              {guide.category}
            </span>
            <span className="text-zinc-500">{guide.readMinutes} min read</span>
            <span className="text-zinc-600" aria-hidden="true">
              ·
            </span>
            <span className="text-zinc-500">
              Updated <time dateTime={guide.updated}>{formatUpdated(guide.updated)}</time>
            </span>
          </div>

          <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">
            {guide.title}
          </h1>

          <div className="mt-5 space-y-4 border-l-2 border-indigo-800 pl-4">
            {guide.intro.map((para, i) => (
              <p key={i} className="text-base leading-7 text-zinc-300">
                {para}
              </p>
            ))}
          </div>
        </header>

        {guide.sections.map((section, index) => (
          <section key={section.heading} className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
              {section.heading}
            </h2>
            <div className="mt-3 space-y-4">
              {section.paragraphs.map((para, i) => (
                <p key={i} className="text-base leading-7 text-zinc-400">
                  {para}
                </p>
              ))}
            </div>
            {section.bullets && (
              <ul className="mt-4 space-y-2">
                {section.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2.5 text-base leading-7 text-zinc-400">
                    <span aria-hidden="true" className="shrink-0 text-indigo-500">
                      •
                    </span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* One in-article unit, roughly mid-page. AdSense wants ads inside
                the content flow, not only in rails — but one, not three. */}
            {index === 1 && <AdSlot format="rectangle" minHeight={280} className="mt-10" />}
          </section>
        ))}

        <aside className="mt-12 rounded-2xl border border-indigo-900/60 bg-indigo-950/20 p-6">
          <h2 className="text-lg font-semibold text-zinc-100">
            Game Manager does this part for you
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Import your Steam library, catalogue physical games by barcode, and track story
            progress mission by mission — free, on web and mobile.
          </p>
          <Link
            to="/register"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            Create a free account
          </Link>
        </aside>
      </article>

      <section className="mx-auto mt-14 max-w-3xl" aria-labelledby="related-heading">
        <h2 id="related-heading" className="text-lg font-semibold text-zinc-100">
          Keep reading
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {related.map((item) => (
            <div key={item.slug} className="relative">
              <GuideCard guide={item} />
            </div>
          ))}
        </div>
      </section>
    </MarketingLayout>
  );
}
