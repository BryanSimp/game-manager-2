import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/**
 * Display preferences, shared with the web app. Mobile only reads them —
 * badge opacity is the one that matters here, so a badge looks the same on
 * both apps.
 */
export function useBadgeOpacity(): number {
  const { data } = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.getPreferences(),
    staleTime: 60_000,
  });
  return data?.badgeOpacity ?? 100;
}
