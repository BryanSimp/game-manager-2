import Fastify from "fastify";
import cors from "@fastify/cors";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";
import { env } from "./env.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

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
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: (user as { role?: string }).role ?? "user",
      createdAt: user.createdAt,
    };
  });

  return app;
}
