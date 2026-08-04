import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adService } from "../../lib/ads.js";
import { useIsPremium } from "../../lib/premium.js";

/**
 * Full-screen interstitial, controlled by the caller (`open` / `onClose`).
 * A countdown gates the close button so the creative gets its dwell time.
 *
 * Premium users — and the not-yet-known state, and a no-fill from the ad
 * service — are let straight through: `onClose` fires immediately, so a flow
 * that shows an interstitial ("add complete", "import finished") never stalls
 * waiting on an ad that will not render.
 */
export function AdInterstitial({
  open,
  onClose,
  dismissAfterSeconds = 5,
}: {
  open: boolean;
  onClose: () => void;
  dismissAfterSeconds?: number;
}) {
  const isPremium = useIsPremium();
  const free = isPremium === false;
  const [remaining, setRemaining] = useState(dismissAfterSeconds);

  const adQuery = useQuery({
    queryKey: ["ads", "interstitial"],
    queryFn: () => adService.getInterstitial(),
    enabled: free && open,
    // refetch on every showing — an interstitial is a one-shot placement
    staleTime: 0,
    gcTime: 0,
  });
  const ad = adQuery.data ?? null;

  // premium (or unknown) passes straight through; so does a no-fill
  useEffect(() => {
    if (open && !free) onClose();
  }, [open, free, onClose]);
  useEffect(() => {
    if (open && free && adQuery.isSuccess && !adQuery.data) onClose();
  }, [open, free, adQuery.isSuccess, adQuery.data, onClose]);

  useEffect(() => {
    if (!open || !free) return;
    setRemaining(dismissAfterSeconds);
    const timer = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [open, free, dismissAfterSeconds]);

  useEffect(() => {
    if (open && free && ad) adService.trackImpression(ad.id);
  }, [open, free, ad]);

  if (!open || !free || !ad) return null;

  const canClose = remaining <= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-300 uppercase">
            Advertisement
          </span>
          <button
            onClick={onClose}
            disabled={!canClose}
            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:enabled:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {canClose ? "Close ✕" : `Close in ${remaining}s`}
          </button>
        </div>
        <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-700 bg-zinc-950/60 p-6 text-center">
          <p className="text-base font-semibold text-zinc-100">{ad.headline}</p>
          <p className="mt-1 text-sm text-zinc-400">{ad.body}</p>
          <a
            href={ad.href}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={() => adService.trackClick(ad.id)}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {ad.cta}
          </a>
        </div>
        <p className="mt-3 text-center text-xs text-zinc-600">
          Premium accounts don't see ads.
        </p>
      </div>
    </div>
  );
}
