import { useEffect, useRef } from "react";
import { adsenseClientId, adsenseEnabled, loadAdSenseScript, pushAdSlot } from "../../lib/adsense.js";
import { useIsPremium } from "../../lib/premium.js";

export type AdSlotFormat = "vertical" | "horizontal" | "rectangle" | "auto";

export interface AdSlotProps {
  /**
   * AdSense `data-ad-slot` id for this placement, from the ad unit you create
   * in the AdSense dashboard. Until one is set the slot renders its
   * placeholder: a manual `<ins>` with no slot id never fills, and AdSense
   * logs an error for it, so a half-configured unit is worse than none.
   */
  slotId?: string;
  format?: AdSlotFormat;
  /** Reserved height in px. Set it to what the unit will actually be: a slot
   * that grows after load pushes content down and hurts CLS. */
  minHeight?: number;
  className?: string;
}

/**
 * One ad placement on a public page.
 *
 * Renders a real AdSense `<ins>` once the publisher id and this slot's id are
 * both known, and a labelled, correctly-sized placeholder until then — so the
 * layout you review before approval is the layout that serves ads after it.
 *
 * The premium rule here is the *inverse* of the in-app `AdBanner`, and
 * deliberately so. AdBanner hides whenever premium is unknown, because an
 * unknown there means "session still resolving" and a paying user must never
 * see an ad flash. On a public page unknown means "signed out" — the normal
 * case, and the entire audience these pages are monetised for. So this hides
 * only on a confirmed premium session.
 */
export function AdSlot({ slotId, format = "auto", minHeight = 250, className = "" }: AdSlotProps) {
  const isPremium = useIsPremium();
  const insRef = useRef<HTMLModElement>(null);
  const pushed = useRef(false);
  const hidden = isPremium === true;
  const canServe = adsenseEnabled() && !!slotId;

  useEffect(() => {
    if (hidden || !canServe || pushed.current) return;
    // Guard against StrictMode's double-invoke: AdSense throws if the same
    // <ins> is pushed twice, and the second push would leave the slot blank.
    pushed.current = true;
    loadAdSenseScript();
    pushAdSlot();
  }, [hidden, canServe]);

  if (hidden) return null;

  // An unconfigured slot renders nothing outside dev. The placeholder below
  // is a development aid, and prerendering turned it into a liability:
  // `scripts/prerender.mjs` bakes these pages into static HTML, so "Reserved —
  // awaiting an AdSense unit id" became crawlable text on every public URL. A
  // reviewer reading a 700-word article framed by four captioned empty boxes
  // is being shown a site built for ads rather than for readers, which is the
  // judgement we're trying to reverse.
  //
  // SSR is checked as well as PROD because the prerenderer runs through Vite's
  // dev-mode SSR runner, where PROD is false — the snapshot would otherwise
  // contradict the bundle shipping beside it.
  if (!canServe && (import.meta.env.PROD || import.meta.env.SSR)) return null;

  if (canServe) {
    return (
      <div className={className} aria-label="Advertisement" role="complementary">
        <ins
          ref={insRef}
          className="adsbygoogle block"
          style={{ display: "block", minHeight }}
          data-ad-client={adsenseClientId()}
          data-ad-slot={slotId}
          data-ad-format={format}
          data-full-width-responsive="true"
        />
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-4 text-center ${className}`}
      style={{ minHeight }}
      aria-label="Advertisement placeholder"
      role="complementary"
    >
      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
        Advertisement
      </span>
      <p className="mt-2 text-xs text-zinc-600">
        {adsenseEnabled() ? "Reserved — awaiting an AdSense unit id" : "Reserved ad space"}
      </p>
    </div>
  );
}
