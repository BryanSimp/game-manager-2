import { useQuery } from "@tanstack/react-query";
import type { Preferences } from "@gm/shared";
import { api } from "./api";

/**
 * Display preferences, shared with the web app. Mobile only reads them, but
 * honouring them keeps a card looking the same on both.
 */
export function usePreferences(): Preferences | undefined {
  const { data } = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.getPreferences(),
    staleTime: 60_000,
  });
  return data;
}

export function useBadgeOpacity(): number {
  return usePreferences()?.badgeOpacity ?? 100;
}
