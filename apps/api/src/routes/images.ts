import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { getImageRecord, imagePath } from "../services/images.js";

export function registerImageRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>("/api/images/:id", async (request, reply) => {
    const record = await getImageRecord(request.params.id);
    if (!record) return reply.status(404).send({ message: "Image not found" });
    reply.header("content-type", record.mime);
    reply.header("cache-control", "public, max-age=31536000, immutable");
    return reply.send(createReadStream(imagePath(record.filename)));
  });
}
