import { useEffect, useRef } from "react";
import { adsenseClientId, adsenseEnabled, loadAdSenseScript, pushAdSlot } from "../../lib/adsense.js";
import { useIsPremium } from "../../lib/premium.js";

export type AdSlotFormat = "vertical" | "horizontal" | "rectangle" | "auto";

export interface AdSlotProps {
  /**
   * AdSense `data-ad-slot` id for this placement. Left undefined until the
   * units are created in the AdSense dashboard — the slot still reserves its
   * space and renders the placeholder.
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
 * Renders a real AdSense `<ins>` when `VITE_ADSENSE_CLIENT` is configured, and
 * a labelled, correctly-sized placeholder when it isn't — so the layout you
 * review before approval is the layout that serves ads after it.
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

  useEffect(() => {
    if (hidden || !adsenseEnabled() || pushed.current) return;
    // Guard against StrictMode's double-invoke: AdSense throws if the same
    // <ins> is pushed twice, and the second push would leave the slot blank.
    pushed.current = true;
    loadAdSenseScript();
    pushAdSlot();
  }, [hidden]);

  if (hidden) return null;

  if (adsenseEnabled()) {
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
        Reserved ad space
        {slotId ? ` · slot ${slotId}` : ""}
      </p>
    </div>
  );
}
