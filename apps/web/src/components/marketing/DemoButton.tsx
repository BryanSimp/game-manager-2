import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";

/**
 * "Try the demo" — the way into the tour, from anywhere on the public site.
 *
 * Always rendered. It used to hide itself when the server had no seeded
 * demo, which sounded careful and was actually a trap: an admin who hadn't
 * run the seed yet saw no button, no explanation, and nothing to click
 * towards fixing it. `/demo` explains an unseeded server perfectly well —
 * that's a better place for the bad news than an invisible control.
 */
export function useDemoAvailable(): boolean {
  const status = useQuery({
    queryKey: ["demo-status"],
    queryFn: () => api.demoStatus(),
    // it changes when someone seeds the demo, i.e. approximately never
    staleTime: 5 * 60_000,
    retry: false,
  });
  return status.data?.available ?? false;
}

export function DemoButton({
  className,
  label = "Try the demo",
}: {
  className: string;
  label?: string;
}) {
  return (
    <Link to="/demo" className={className}>
      {label}
    </Link>
  );
}
