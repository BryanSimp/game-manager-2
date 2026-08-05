import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";

/**
 * "See a demo" — the way into the tour, from anywhere on the public site.
 *
 * It hides itself when the server has no seeded demo. Self-hosters get the
 * same build as gamesmanager.app and most of them will never run
 * `db:seed-demo`, so an always-visible button would be an always-broken one
 * on every instance but ours.
 */
export function useDemoAvailable(): boolean {
  const status = useQuery({
    queryKey: ["demo-status"],
    queryFn: () => api.demoStatus(),
    // it changes when someone runs a seed script, i.e. approximately never
    staleTime: 5 * 60_000,
    retry: false,
  });
  return status.data?.available ?? false;
}

export function DemoButton({ className, label = "Try the demo" }: { className: string; label?: string }) {
  const available = useDemoAvailable();
  if (!available) return null;
  return (
    <Link to="/demo" className={className}>
      {label}
    </Link>
  );
}
