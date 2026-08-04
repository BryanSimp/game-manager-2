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
  useEffect(() => {
    const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
    const url = `${SITE_URL}${path}`;

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
    set(meta("robots", created), "content", noIndex ? "noindex, nofollow" : "index, follow");

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
