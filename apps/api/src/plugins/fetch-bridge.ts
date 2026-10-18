import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Fastify ⇄ Fetch, for handlers written against the web-standard
 * `Request`/`Response` (the MCP SDK's transport, better-auth's metadata
 * helpers). The better-auth mount in `server.ts` does the same translation
 * inline; this is the reusable form.
 *
 * The body is re-serialised from Fastify's parsed JSON, because Fastify has
 * already consumed the stream — callers that can take a parsed body (the MCP
 * transport's `parsedBody`) should pass `request.body` alongside instead.
 */
export function toFetchRequest(request: FastifyRequest, baseUrl: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value == null) continue;
    headers.append(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(new URL(request.url, baseUrl), {
    method: request.method,
    headers,
    body:
      request.method !== "GET" && request.method !== "HEAD" && request.body != null
        ? JSON.stringify(request.body)
        : undefined,
  });
}

/** Copy a Fetch `Response` onto the Fastify reply. */
export async function sendFetchResponse(reply: FastifyReply, response: Response) {
  reply.status(response.status);
  response.headers.forEach((value, key) => reply.header(key, value));
  return reply.send(response.body ? await response.text() : null);
}
