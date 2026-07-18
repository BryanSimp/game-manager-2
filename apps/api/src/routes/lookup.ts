import type { FastifyInstance } from "fastify";
import { requireUser } from "../plugins/auth.js";
import { lookupUpc } from "../services/upc.js";

export function registerLookupRoutes(app: FastifyInstance): void {
  app.get<{ Params: { code: string } }>(
    "/api/lookup/barcode/:code",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const code = request.params.code.replace(/\D/g, "");
      if (code.length < 8 || code.length > 14) {
        return reply.status(400).send({ message: "Invalid barcode" });
      }

      try {
        return await lookupUpc(code);
      } catch (err) {
        request.log.warn({ err, code }, "UPC lookup failed");
        const message = err instanceof Error ? err.message : "UPC lookup failed";
        return reply.status(502).send({ message });
      }
    },
  );
}
