/**
 * Google AdSense wiring for the public marketing pages.
 *
 * The loader itself lives in index.html's <head>, because that's where
 * Google's snippet is meant to go and where site verification and Auto ads
 * look for it. This module is about the *units* we place ourselves: it holds
 * the publisher id, and gives components a safe way to hand a slot to
 * AdSense once one exists.
 *
 * Deliberately separate from lib/ads.ts: that one is the in-app house-ad
 * service for signed-in free users. This one is third-party ad code. They
 * stay apart so the two systems can never be confused for one another.
 *
 * NOTE: because the site tag is in index.html, it loads on every page —
 * including the signed-in app. Ad *units* are still only placed on the public
 * marketing pages (AdSlot is used nowhere else), so what appears inside the
 * app is governed by the Auto ads setting in the AdSense dashboard. Leaving
 * Auto ads off keeps ads to the placements in this repo, which is what the
 * premium tier's "no ads" promise assumes.
 */

/**
 * Publisher id. Public by design — it's in the page source of every AdSense
 * site — so it lives in the repo rather than an env file. `VITE_ADSENSE_CLIENT`
 * overrides it for a fork; setting it to an empty string disables our units.
 *
 * Must match the `client=` in index.html's script tag.
 */
const DEFAULT_CLIENT_ID = "ca-pub-8120053686454465";

const CLIENT_ID: string = (import.meta.env.VITE_ADSENSE_CLIENT ?? DEFAULT_CLIENT_ID).trim();

const SCRIPT_SRC = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * `data-ad-slot` ids for the placements this site defines, in one place so
 * wiring them up is a single edit here rather than a hunt through components.
 *
 * Each one comes from an ad unit created in the AdSense dashboard, which is
 * only possible once the site is approved — so they start empty, and every
 * slot renders its placeholder until its id is filled in. Partial is fine:
 * a slot with an id serves, the rest keep waiting.
 *
 * Suggested unit types:
 *   railLeft / railRight  — Display, vertical (300×600 half-page works well)
 *   contentMobile         — Display, horizontal/responsive
 *   guideInArticle        — In-article
 */
export const AD_SLOTS = {
  railLeft: "",
  railRight: "",
  contentMobile: "",
  guideInArticle: "",
} as const;

export function adsenseClientId(): string {
  return CLIENT_ID;
}

export function adsenseEnabled(): boolean {
  return CLIENT_ID.startsWith("ca-pub-");
}

/**
 * Safety net for the site tag. index.html normally has it already, so this is
 * a no-op — it exists so a slot still works if that tag is ever removed or a
 * page is served from a different shell. Idempotent either way.
 */
export function loadAdSenseScript(): void {
  if (!adsenseEnabled()) return;
  if (document.querySelector(`script[src^="${SCRIPT_SRC}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `${SCRIPT_SRC}?client=${encodeURIComponent(CLIENT_ID)}`;
  document.head.appendChild(script);
}

/**
 * Asks AdSense to fill the most recently rendered `<ins>`. Throws inside
 * AdSense's own code if a slot is pushed twice, so callers must push exactly
 * once per mounted slot.
 */
export function pushAdSlot(): void {
  if (!adsenseEnabled()) return;
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch {
    // A duplicate push or a blocked script must never take the page down —
    // the slot just stays empty.
  }
}
