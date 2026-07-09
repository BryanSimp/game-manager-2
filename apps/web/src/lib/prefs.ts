import { useQuery } from "@tanstack/react-query";
import type { Preferences } from "@gm/shared";
import { api } from "./api.js";

export function usePreferences(): Preferences | undefined {
  const { data } = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.getPreferences(),
    staleTime: 60_000,
  });
  return data;
}
