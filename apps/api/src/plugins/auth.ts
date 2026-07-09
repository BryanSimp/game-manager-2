import type { FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export async function getSessionUser(request: FastifyRequest): Promise<SessionUser | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!session) return null;
  const { user } = session;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: (user as { role?: string }).role ?? "user",
  };
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
