import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";
import { env } from "./env.js";
import multipart from "@fastify/multipart";
import { registerSanitizer } from "./plugins/sanitize.js";
import { IMAGE_UPLOAD_LIMIT } from "./services/image-pipeline.js";
import { registerLibraryRoutes } from "./routes/library.js";
import { registerGameRoutes } from "./routes/games.js";
import { registerImageRoutes } from "./routes/images.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerTagRoutes } from "./routes/tags.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { registerPreferenceRoutes } from "./routes/preferences.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerConsoleRoutes } from "./routes/consoles.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerLookupRoutes } from "./routes/lookup.js";
import { registerChecklistRoutes } from "./routes/checklists.js";
import { registerSteamRoutes } from "./routes/steam.js";
import { registerFriendRoutes } from "./routes/friends.js";
import { registerCategoryRoutes } from "./routes/categories.js";
import { registerAuthRecoveryRoutes } from "./routes/auth-recovery.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerContactRoutes } from "./routes/contact.js";
import { logEvent } from "./services/analytics.js";

export async function buildServer() {
  // trustProxy: the API is only reachable through Traefik (prod) or the Vite
  // proxy (dev), so X-Forwarded-For is honest — without this, rate limiting
  // would key every visitor to the proxy's IP and share one bucket.
  const app = Fastify({ logger: true, trustProxy: true });

  // Activity telemetry: onResponse fires after the reply has gone out, and
  // logEvent is an in-memory push (batched insert on a timer), so this adds
  // nothing to request latency. Only authenticated traffic is recorded —
  // routes resolve the user anyway and stash it on request.sessionUser.
  app.addHook("onResponse", (request, reply, done) => {
    const user = request.sessionUser;
    const route = request.routeOptions?.url;
    if (user && route && route !== "/api/health" && reply.statusCode < 500) {
      logEvent("activity", user.id, {
        route,
        method: request.method,
        status: reply.statusCode,
      });
    }
    done();
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Per-IP flood ceiling on everything. Generous because legit browsing is
  // chatty (a library page fans out into one image request per cover); the
  // expensive routes (wiki scraper, uploads, OCR imports, barcode lookups)
  // carry much tighter per-route configs where they're registered.
  await app.register(rateLimit, {
    global: true,
    max: 1000,
    timeWindow: "1 minute",
  });

  // Strip active HTML (script/iframe/on*=/javascript:) out of user-submitted
  // text before any handler sees it — see plugins/sanitize.ts.
  registerSanitizer(app);

  // Mount better-auth: translate Fastify request -> Fetch Request -> auth.handler
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, env.BETTER_AUTH_URL);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value == null) continue;
        headers.append(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const fetchRequest = new Request(url, {
        method: request.method,
        headers,
        body:
          request.method !== "GET" && request.body != null
            ? JSON.stringify(request.body)
            : undefined,
      });
      const response = await auth.handler(fetchRequest);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.send(response.body ? await response.text() : null);
    },
  });

  app.get("/api/health", async () => ({
    status: "ok" as const,
    version: "0.1.0",
    time: new Date().toISOString(),
  }));

  app.get("/api/me", async (request, reply) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) {
      return reply.status(401).send({ message: "Not authenticated" });
    }
    const { user } = session;
    request.sessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: (user as { role?: string }).role ?? "user",
    };
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: (user as { role?: string }).role ?? "user",
      isPremium: (user as { isPremium?: boolean }).isPremium ?? false,
      createdAt: user.createdAt,
    };
  });

  await app.register(multipart, {
    limits: { fileSize: IMAGE_UPLOAD_LIMIT, files: 1 },
  });

  registerLibraryRoutes(app);
  registerGameRoutes(app);
  registerImageRoutes(app);
  registerAdminRoutes(app);
  registerTagRoutes(app);
  registerUploadRoutes(app);
  registerPreferenceRoutes(app);
  registerDashboardRoutes(app);
  registerImportRoutes(app);
  registerConsoleRoutes(app);
  registerCollectionRoutes(app);
  registerLookupRoutes(app);
  registerChecklistRoutes(app);
  registerSteamRoutes(app);
  registerFriendRoutes(app);
  registerCategoryRoutes(app);
  registerAuthRecoveryRoutes(app);
  registerAnalyticsRoutes(app);
  registerContactRoutes(app);

  return app;
}
