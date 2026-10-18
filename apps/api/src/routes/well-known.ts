import type { FastifyInstance } from "fastify";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "../auth.js";
import { env } from "../env.js";
import { sendFetchResponse, toFetchRequest } from "../plugins/fetch-bridge.js";
import { protectedResourceMetadata } from "../services/oauth.js";

/**
 * OAuth discovery, the two documents an MCP client reads before it can sign
 * anyone in:
 *
 *  - **Protected-resource metadata** (RFC 9728): "`/api/mcp` is a resource,
 *    and this is the server that issues tokens for it." A 401 from
 *    `/api/mcp` points here.
 *  - **Authorization-server metadata** (RFC 8414): where to register, where
 *    to send the user, where to swap a code for a token. better-auth builds
 *    it; this only gives it an address at the root.
 *
 * Both live outside `/api`, so they need routing of their own:
 * `PathPrefix(/.well-known/oauth-)` on the API's Traefik router in
 * `deploy/docker-compose.prod.yml`, a matching `location` in
 * `deploy/nginx.selfhost.conf`, and the Vite proxy in dev. Each is served at
 * the bare path *and* the path-inserted form (`…/oauth-protected-resource/
 * api/mcp`, `…/oauth-authorization-server/api/auth`), because clients differ
 * in which they try first.
 *
 * Public and cacheable: they describe the server, not anyone's account.
 */
const authServerMetadata = oauthProviderAuthServerMetadata(auth, {
  headers: { "access-control-allow-origin": "*" },
});

export function registerWellKnownRoutes(app: FastifyInstance): void {
  for (const url of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/api/mcp",
  ]) {
    app.get(url, async (_request, reply) => {
      reply.header("access-control-allow-origin", "*");
      reply.header("cache-control", "public, max-age=3600");
      return protectedResourceMetadata();
    });
  }

  for (const url of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/api/auth",
  ]) {
    app.get(url, async (request, reply) =>
      sendFetchResponse(reply, await authServerMetadata(toFetchRequest(request, env.BETTER_AUTH_URL))),
    );
  }
}
