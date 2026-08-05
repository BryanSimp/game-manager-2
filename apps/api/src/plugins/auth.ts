import type { FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { demoUser, isDemoEditRequest, isDemoRequest } from "../services/demo.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /**
   * True when this is the seeded demo account rather than a signed-in
   * person. Routes don't check it — `server.ts` already refuses anything
   * that isn't a read — but the activity log does, so a tour of the demo
   * doesn't land in the DAU chart as a user.
   */
  isDemo?: boolean;
  /**
   * True when an admin is curating the demo library through the normal UI:
   * the id is the demo account's, the role is still theirs. Writes are
   * allowed — the view-only hook keys on the tour's header, not this one.
   */
  demoEdit?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Resolved by getSessionUser so the post-response activity log knows who acted. */
    sessionUser?: SessionUser;
  }
}

export async function getSessionUser(request: FastifyRequest): Promise<SessionUser | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!session) {
    // No session, but the caller asked for the demo tour: hand back the
    // seeded account so every route serves it without knowing it's a demo.
    // A real session always wins, so signing in ends the tour naturally.
    if (isDemoRequest(request.headers)) {
      const demo = await demoUser();
      if (demo) {
        const demoSessionUser: SessionUser = { ...demo, role: "user", isDemo: true };
        request.sessionUser = demoSessionUser;
        return demoSessionUser;
      }
    }
    return null;
  }
  const { user } = session;
  const role = (user as { role?: string }).role ?? "user";

  /*
   * Admin curating the demo: act as the demo account, keep the admin's own
   * role. The id is what every route files data under, so the edits land on
   * the demo library; the role is a fact about the person holding the
   * session, so `requireAdmin` still passes and the admin pages stay
   * reachable while editing.
   *
   * Gated on `role === "admin"` — from anyone else the header does nothing,
   * which is the only thing standing between it and an account takeover.
   */
  if (role === "admin" && isDemoEditRequest(request.headers)) {
    const demo = await demoUser();
    if (demo) {
      const editing: SessionUser = { ...demo, role, isDemo: true, demoEdit: true };
      request.sessionUser = editing;
      return editing;
    }
  }

  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
  };
  request.sessionUser = sessionUser;
  return sessionUser;
}

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionUser | null> {
  const user = await getSessionUser(request);
  if (!user) {
    reply.status(401).send({ message: "Not authenticated" });
    return null;
  }
  return user;
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionUser | null> {
  const user = await requireUser(request, reply);
  if (!user) return null;
  if (user.role !== "admin") {
    reply.status(403).send({ message: "Admin access required" });
    return null;
  }
  return user;
}
