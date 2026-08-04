import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";
import { authClient } from "./auth.js";

/**
 * Global premium state. Rides the same ["me"] query the Shell issues, so any
 * number of callers share one fetch and one cache entry.
 *
 * Returns `null` while the answer is unknown (loading, signed out). Ad
 * components treat unknown as premium and render nothing — a paying user must
 * never see an ad flash while the query resolves; a free user seeing one
 * banner a beat late costs nothing.
 */
export function useIsPremium(): boolean | null {
  const { data: session } = authClient.useSession();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), enabled: !!session });
  if (!session || me.data === undefined) return null;
  return me.data.isPremium;
}
