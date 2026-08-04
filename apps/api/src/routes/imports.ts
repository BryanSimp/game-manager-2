import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { saveUploadedImage } from "../services/images.js";
import { enqueueOcrImport } from "../services/queue.js";
import { extractTitles } from "../services/noise-filter.js";
import { importRateLimit } from "../plugins/rate-limits.js";

const textImportSchema = z.object({
  source: z.literal("text_paste"),
  text: z.string().min(1).max(100_000),
});

function jobToJson(job: typeof schema.importJobs.$inferSelect) {
  return {
    id: job.id,
    source: job.source,
    status: job.status,
    error: job.error,
    createdAt: job.createdAt,
  };
}

export function registerImportRoutes(app: FastifyInstance): void {
  // Image import: multipart file + source field (screenshot | shelf_photo)
  app.post("/api/imports", { config: importRateLimit }, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    if (request.isMultipart()) {
      const file = await request.file();
      if (!file) return reply.status(400).send({ message: "No image uploaded" });
      const sourceField = file.fields.source;
      const sourceValue =
        sourceField && "value" in sourceField ? String(sourceField.value) : "screenshot";
      const source = sourceValue === "shelf_photo" ? "shelf_photo" : "screenshot";

      // the mimetype header is not consulted — saveUploadedImage sniffs the bytes
      const buffer = await file.toBuffer();
      const imageId = await saveUploadedImage(buffer, "shelf_photo", user.id);
      if (!imageId) {
        return reply
          .status(400)
          .send({ message: "That file isn't a valid image — PNG, JPEG, WebP, or AVIF only" });
      }
      const [job] = await db
        .insert(schema.importJobs)
        .values({ userId: user.id, source, imageId })
        .returning();
      if (!job) return reply.status(500).send({ message: "Failed to create import job" });
      await enqueueOcrImport(job.id);
      reply.status(201);
      return jobToJson(job);
    }

    // JSON body: text paste routed through the same pipeline
    const parsed = textImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const titles = extractTitles(parsed.data.text);
    if (titles.length === 0) {
      return reply.status(400).send({ message: "No titles found in the pasted text" });
    }
    const [job] = await db
      .insert(schema.importJobs)
      .values({ userId: user.id, source: "text_paste" })
      .returning();
    if (!job) return reply.status(500).send({ message: "Failed to create import job" });
    await db.insert(schema.importItems).values(
      titles.map((title, i) => ({
        jobId: job.id,
        position: i,
        rawText: title,
        cleanedTitle: title,
      })),
    );
    await enqueueOcrImport(job.id);
    reply.status(201);
    return jobToJson(job);
  });

  app.get("/api/imports", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const jobs = await db
      .select()
      .from(schema.importJobs)
      .where(eq(schema.importJobs.userId, user.id))
      .orderBy(desc(schema.importJobs.createdAt))
      .limit(10);
    return jobs.map(jobToJson);
  });

  app.get<{ Params: { id: string } }>("/api/imports/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [job] = await db
      .select()
      .from(schema.importJobs)
      .where(and(eq(schema.importJobs.id, request.params.id), eq(schema.importJobs.userId, user.id)));
    if (!job) return reply.status(404).send({ message: "Import not found" });
    const items = await db
      .select()
      .from(schema.importItems)
      .where(eq(schema.importItems.jobId, job.id))
      .orderBy(asc(schema.importItems.position));
    return {
      ...jobToJson(job),
      items: items.map((it) => ({
        id: it.id,
        rawText: it.rawText,
        cleanedTitle: it.cleanedTitle,
        candidates: it.candidates ?? [],
        confidence: it.confidence,
        resolution: it.resolution,
      })),
    };
  });

  app.patch<{ Params: { id: string } }>("/api/imports/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const body = z.object({ status: z.literal("done") }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ message: "Invalid status" });
    const updated = await db
      .update(schema.importJobs)
      .set({ status: "done", updatedAt: new Date() })
      .where(and(eq(schema.importJobs.id, request.params.id), eq(schema.importJobs.userId, user.id)))
      .returning({ id: schema.importJobs.id });
    if (updated.length === 0) return reply.status(404).send({ message: "Import not found" });
    return { ok: true };
  });
}
