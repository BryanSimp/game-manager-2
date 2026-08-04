/**
 * Google AdSense wiring for the public marketing pages.
 *
 * Nothing here runs until `VITE_ADSENSE_CLIENT` is set at build time (the
 * `ca-pub-…` id). Without it every ad slot renders a labelled placeholder
 * instead, which is what you want while the site is still waiting on AdSense
 * approval — the layout is identical, so approving the account and rebuilding
 * with the id is the only step left.
 *
 * Deliberately separate from lib/ads.ts: that one is the in-app house-ad
 * service for signed-in free users. This one is third-party ad code on public
 * pages. Keeping them apart means the AdSense script is never loaded inside
 * the authenticated app, where it would see library contents.
 */

const CLIENT_ID: string = import.meta.env.VITE_ADSENSE_CLIENT || "";

const SCRIPT_SRC = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

export function adsenseClientId(): string {
  return CLIENT_ID;
}

export function adsenseEnabled(): boolean {
  return CLIENT_ID.startsWith("ca-pub-");
}

/**
 * Appends the AdSense loader once per document. Idempotent — every slot calls
 * it, only the first one does anything.
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
