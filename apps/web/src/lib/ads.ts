/**
 * Ad service boundary. Components only ever talk to the `AdService`
 * interface; `MockAdService` is the placeholder implementation until a real
 * ad network (or a house-ad backend) is wired in — swap the `adService`
 * export and nothing else changes.
 *
 * Premium gating does NOT live here. Components decide whether to request an
 * ad at all (via useIsPremium in lib/premium.ts); the service only fills
 * slots. Keeping the gate in the components means a future provider can't
 * accidentally serve — or track — a premium user.
 */

export interface AdCreative {
  id: string;
  headline: string;
  body: string;
  /** call-to-action button label */
  cta: string;
  href: string;
}

export interface AdService {
  /** Creative for a named banner slot. `null` = no fill → render nothing. */
  getBanner(slot: string): Promise<AdCreative | null>;
  /** Full-screen creative. `null` = no fill → the interstitial is skipped. */
  getInterstitial(): Promise<AdCreative | null>;
  trackImpression(creativeId: string): void;
  trackClick(creativeId: string): void;
}

// House placeholders, clearly labelled as such — nothing here calls out to an
// ad network, so the free tier currently shows ads without any tracking.
const PLACEHOLDERS: AdCreative[] = [
  {
    id: "house-placeholder-1",
    headline: "Your ad could be here",
    body: "Placeholder creative served by MockAdService.",
    cta: "Learn more",
    href: "https://example.com",
  },
  {
    id: "house-placeholder-2",
    headline: "Ads keep the free tier free",
    body: "Placeholder creative served by MockAdService.",
    cta: "Learn more",
    href: "https://example.com",
  },
];

class MockAdService implements AdService {
  private pick(seed: string): AdCreative {
    // deterministic per slot so a page doesn't reshuffle on every render,
    // but different slots still show different creatives
    let hash = 0;
    for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return PLACEHOLDERS[Math.abs(hash) % PLACEHOLDERS.length]!;
  }

  async getBanner(slot: string): Promise<AdCreative | null> {
    return this.pick(`banner:${slot}`);
  }

  async getInterstitial(): Promise<AdCreative | null> {
    return this.pick("interstitial");
  }

  trackImpression(creativeId: string): void {
    console.debug("[ads] impression", creativeId);
  }

  trackClick(creativeId: string): void {
    console.debug("[ads] click", creativeId);
  }
}

export const adService: AdService = new MockAdService();
