import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { adService } from "../../lib/ads.js";
import { useIsPremium } from "../../lib/premium.js";

/**
 * Inline banner slot. Premium — or premium-not-yet-known — renders nothing at
 * all (no reserved space, no ad request). Free renders the creative the ad
 * service fills the slot with.
 */
export function AdBanner({ slot, className = "" }: { slot: string; className?: string }) {
  const isPremium = useIsPremium();
  const free = isPremium === false;

  const { data: ad } = useQuery({
    queryKey: ["ads", "banner", slot],
    queryFn: () => adService.getBanner(slot),
    enabled: free,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (free && ad) adService.trackImpression(ad.id);
  }, [free, ad]);

  if (!free || !ad) return null;

  return (
    <div
      className={`rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 p-3 ${className}`}
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-300 uppercase">
          Ad
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-200">{ad.headline}</p>
          <p className="truncate text-xs text-zinc-500">{ad.body}</p>
        </div>
        <a
          href={ad.href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={() => adService.trackClick(ad.id)}
          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
        >
          {ad.cta}
        </a>
      </div>
    </div>
  );
}
