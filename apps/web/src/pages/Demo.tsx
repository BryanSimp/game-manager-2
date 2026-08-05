import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { startDemo } from "../lib/demo.js";

/**
 * `/demo` — the door into the tour.
 *
 * All it does is flip the flag and hand over to the library. It's a page
 * rather than a button handler so the tour has a URL: it can be linked from
 * the marketing nav, the hero and the closing CTA without three copies of
 * the same effect, and someone who bookmarks it lands back in the demo.
 *
 * The query cache is cleared on the way in for the same reason `Exit demo`
 * clears it on the way out — a signed-in user who follows a demo link must
 * not see their own library rendered under a Demo banner, or vice versa.
 */
export function DemoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    startDemo();
    queryClient.clear();
    setReady(true);
    // replace: Back should return to the landing page, not bounce through
    // this redirect and straight back into the demo
    navigate({ to: "/", replace: true });
  }, [navigate, queryClient]);

  return (
    <main className="flex min-h-screen items-center justify-center text-zinc-500">
      {ready ? "Opening the demo…" : "Loading…"}
    </main>
  );
}
