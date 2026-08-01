import { useQuery } from "@tanstack/react-query";
import type { CategoryView } from "@gm/shared";
import { api } from "./api.js";

/**
 * Built-in and custom categories, resolved by the server. Shared query key so
 * every screen reads one cached copy and they all update together after an
 * edit.
 */
export function useCategories(): CategoryView[] | undefined {
  const query = useQuery({ queryKey: ["categories"], queryFn: () => api.getCategories() });
  return query.data;
}
