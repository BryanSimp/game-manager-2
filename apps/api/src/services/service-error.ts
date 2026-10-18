import type { FastifyReply } from "fastify";

/**
 * A write refused for a reason the caller can act on — bad input, not
 * yours, already taken. Thrown by the service functions that a web route
 * and an MCP write tool both call (`services/tags.ts`, `collections.ts`,
 * `game-links.ts`, `time-to-beat.ts`), so the two can't drift on what they
 * accept: the route sends it as `status` with `{ message }`, exactly the
 * reply it used to build inline, and the tool reports the message to the
 * model as an error result.
 */
export class ServiceError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 502,
    message: string,
  ) {
    super(message);
  }
}

/** Send a ServiceError the way the routes always have; anything else rethrows. */
export function replyWithServiceError(reply: FastifyReply, err: unknown) {
  if (err instanceof ServiceError) return reply.status(err.status).send({ message: err.message });
  throw err;
}

/** Postgres unique-violation, however deeply drizzle has wrapped it. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === "23505") return true;
  }
  return false;
}
