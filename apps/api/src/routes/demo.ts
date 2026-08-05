import type { FastifyInstance } from "fastify";
import type { DemoAdminView } from "@gm/shared";
import { requireAdmin } from "../plugins/auth.js";
import { igdbConfigured } from "../services/igdb.js";
import { demoSeedState, demoStats, removeDemo, seedDemo } from "../services/demo-seed.js";

/**
 * Admin management of the demo library.
 *
 * Two things an admin needs and had no way to do: build the sample library
 * without shell access to the server, and change what's in it afterwards.
 * The first is this route pair. The second isn't here at all — "edit the
 * demo" is a header (`x-gm-demo-edit`, see services/demo.ts) that makes the
 * whole app act on the demo account, so curating the tour uses the same
 * Library, Collections and Progress screens it's showing off. A bespoke
 * demo-content editor would be twenty screens that rot.
 */
export function registerDemoAdminRoutes(app: FastifyInstance): void {
  app.get("/api/admin/demo", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const [stats, igdb] = await Promise.all([demoStats(), igdbConfigured()]);
    const view: DemoAdminView = {
      stats,
      seed: demoSeedState(),
      /** the seed produces grey boxes without it, and says so on the page */
      igdbConfigured: igdb,
    };
    return view;
  });

  /**
   * Build or rebuild the demo. Returns as soon as the job is running rather
   * than holding the request open: two dozen IGDB lookups behind a ~3 req/s
   * throttle is a minute or so, well past any sensible browser timeout. The
   * page polls `GET /api/admin/demo` for progress.
   */
  app.post("/api/admin/demo/seed", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    if (demoSeedState().running) {
      return reply.status(409).send({ message: "A rebuild is already running" });
    }
    // deliberately not awaited — seedDemo owns its own error handling and
    // records failures in the state the page is polling
    void seedDemo();
    reply.status(202);
    return { started: true };
  });

  app.delete("/api/admin/demo", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    if (demoSeedState().running) {
      return reply.status(409).send({ message: "A rebuild is running — wait for it to finish" });
    }
    const removed = await removeDemo();
    return { ok: true, removed };
  });
}
