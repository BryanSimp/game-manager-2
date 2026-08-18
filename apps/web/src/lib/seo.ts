import { useEffect } from "react";

/**
 * Per-route document metadata for the public marketing pages.
 *
 * This is a client-rendered SPA, so there is no server-rendered <head>:
 * everything here is written into the live document on mount. Googlebot
 * renders JavaScript before indexing, so it picks these up — but crawlers that
 * don't (most social-preview scrapers) only ever see the static defaults in
 * index.html. That's why index.html carries a full, honest set of fallback
 * tags rather than an empty shell.
 *
 * Every tag written here is removed or restored on unmount, so navigating from
 * a guide back to the landing page can't leave the guide's description behind.
 */

export const SITE_NAME = "Game Manager";
export const SITE_URL = "https://gamesmanager.app";

export interface SeoInput {
  /** Page title, without the site-name suffix — this adds it. */
  title: string;
  description: string;
  /** Path (e.g. "/guides"), resolved against SITE_URL. */
  path: string;
  /** Schema.org payload rendered as an ld+json script. */
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
  /** `noindex` for pages that shouldn't be in the index at all. */
  noIndex?: boolean;
}

/**
 * What the route being statically rendered asked for, if any.
 *
 * `useSeo` works by mutating `document` from an effect, and during a
 * build-time render there is neither a document to mutate nor an effect to run
 * — so under SSR the hook records its input here instead and
 * `scripts/prerender.mjs` writes the tags into the emitted HTML. That is most
 * of the point of prerendering: the per-page title, description and canonical
 * that Googlebot only sees by executing JavaScript are exactly the ones an ad
 * crawler never executes, which is why every URL used to serve the landing
 * page's `<head>` and a canonical pointing at `/`.
 *
 * Recording during render rather than in an effect makes `useSeo` impure under
 * SSR. That is confined to the build, where the prerenderer renders one route
 * and calls `takeSeo()` before starting the next.
 */
let ssrSeo: SeoInput | null = null;

/** Reads and clears the SEO recorded by the last static render. */
export function takeSeo(): SeoInput | null {
  const captured = ssrSeo;
  ssrSeo = null;
  return captured;
}

/** The final tag values for a route: title suffixed, path resolved to a URL. */
export interface ResolvedSeo {
  title: string;
  description: string;
  url: string;
  robots: string;
  jsonLd: Record<string, unknown> | Array<Record<string, unknown>> | null;
}

/**
 * Turns a route's SEO input into the values that go on the page.
 *
 * Shared by the hook and by the prerenderer so the static HTML and the
 * runtime-patched head can't drift — the failure that mattered here was
 * precisely a `<head>` that said one thing before JavaScript ran and another
 * after.
 */
export function resolveSeo(input: SeoInput): ResolvedSeo {
  return {
    title: input.title.includes(SITE_NAME) ? input.title : `${input.title} | ${SITE_NAME}`,
    description: input.description,
    url: `${SITE_URL}${input.path}`,
    robots: input.noIndex ? "noindex, nofollow" : "index, follow",
    jsonLd: input.jsonLd ?? null,
  };
}

/** Finds a meta/link tag or creates it, remembering which ones we created. */
function upsert(
  selector: string,
  create: () => HTMLElement,
  created: HTMLElement[],
): HTMLElement {
  const existing = document.head.querySelector<HTMLElement>(selector);
  if (existing) return existing;
  const el = create();
  document.head.appendChild(el);
  created.push(el);
  return el;
}

function meta(name: string, created: HTMLElement[]): HTMLMetaElement {
  return upsert(
    `meta[name="${name}"]`,
    () => {
      const el = document.createElement("meta");
      el.setAttribute("name", name);
      return el;
    },
    created,
  ) as HTMLMetaElement;
}

function property(prop: string, created: HTMLElement[]): HTMLMetaElement {
  return upsert(
    `meta[property="${prop}"]`,
    () => {
      const el = document.createElement("meta");
      el.setAttribute("property", prop);
      return el;
    },
    created,
  ) as HTMLMetaElement;
}

export function useSeo({ title, description, path, jsonLd, noIndex }: SeoInput): void {
  // Build-time render: no document, no effects. Record and let the
  // prerenderer emit these into the static HTML. Vite replaces this with
  // `false` in the client build, so the branch is dead code in the browser.
  if (import.meta.env.SSR) ssrSeo = { title, description, path, jsonLd, noIndex };

  useEffect(() => {
    const { title: fullTitle, url, robots } = resolveSeo({ title, description, path, noIndex });

    // Snapshot what we're about to overwrite so unmount can put it back.
    const previousTitle = document.title;
    const created: HTMLElement[] = [];
    const restore: Array<() => void> = [];

    function set(el: HTMLElement, attr: string, value: string) {
      const had = el.hasAttribute(attr);
      const before = el.getAttribute(attr);
      restore.push(() => {
        if (had && before !== null) el.setAttribute(attr, before);
        else el.removeAttribute(attr);
      });
      el.setAttribute(attr, value);
    }

    document.title = fullTitle;
    set(meta("description", created), "content", description);
    set(meta("robots", created), "content", robots);

    const canonical = upsert(
      'link[rel="canonical"]',
      () => {
        const el = document.createElement("link");
        el.setAttribute("rel", "canonical");
        return el;
      },
      created,
    );
    set(canonical, "href", url);

    set(property("og:title", created), "content", fullTitle);
    set(property("og:description", created), "content", description);
    set(property("og:url", created), "content", url);
    set(property("og:type", created), "content", "website");
    set(property("og:site_name", created), "content", SITE_NAME);
    set(meta("twitter:card", created), "content", "summary_large_image");
    set(meta("twitter:title", created), "content", fullTitle);
    set(meta("twitter:description", created), "content", description);

    // Drop any structured data already in the head before adding ours.
    //
    // Every other tag here is upserted, so the prerendered value is simply
    // overwritten — but JSON-LD is appended, and the prerendered block sits in
    // <head> where `createRoot` never reaches. Left alone it survives every
    // client-side navigation, so a visitor who landed on /guides and clicked
    // through to an article would be carrying that article's schema *and* the
    // hub's ItemList. Anything still marked `data-seo="route"` at mount is by
    // definition stale: a route unmounting removes its own first.
    for (const stale of document.head.querySelectorAll('script[data-seo="route"]')) {
      stale.remove();
    }

    // Structured data is always ours, so it's created and torn down whole
    // rather than patched — two pages must never merge their schemas.
    let ldScript: HTMLScriptElement | null = null;
    if (jsonLd) {
      ldScript = document.createElement("script");
      ldScript.type = "application/ld+json";
      ldScript.dataset.seo = "route";
      ldScript.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(ldScript);
    }

    return () => {
      document.title = previousTitle;
      for (const undo of restore.reverse()) undo();
      for (const el of created) el.remove();
      ldScript?.remove();
    };
  }, [title, description, path, noIndex, JSON.stringify(jsonLd ?? null)]);
}

/** Schema.org description of the product itself — used on the landing page. */
export function softwareApplicationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: "GameApplication",
    operatingSystem: "Web, iOS, Android",
    description:
      "Game Manager is a self-hosted game library manager that syncs your Steam " +
      "library, catalogues physical and digital games across every console you own, " +
      "tracks mission-by-mission story progress, and estimates the time left to beat " +
      "your backlog.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free tier, ad-supported.",
    },
  };
}

/** FAQPage schema — the landing page's FAQ is the source for both. */
export function faqJsonLd(items: Array<{ question: string; answer: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
