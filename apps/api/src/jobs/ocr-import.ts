import { asc, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { getImageRecord, imagePath } from "../services/images.js";
import { extractTitles } from "../services/noise-filter.js";
import { matchTitle } from "../services/matcher.js";
import { resolveProvider, runOcr } from "../services/ocr.js";
import { getBoss, OCR_IMPORT_QUEUE } from "../services/queue.js";
import { logScrape } from "../services/analytics.js";

async function setStatus(
  jobId: string,
  status: "pending" | "ocr" | "matching" | "review" | "done" | "failed",
  error?: string,
): Promise<void> {
  await db
    .update(schema.importJobs)
    .set({ status, error: error ?? null, updatedAt: new Date() })
    .where(eq(schema.importJobs.id, jobId));
}

export async function processImportJob(jobId: string): Promise<void> {
  const [job] = await db
    .select()
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId));
  if (!job) return;

  try {
    if (job.source === "text_paste" || job.source === "steam") {
      // these jobs arrive with items pre-created — skip straight to matching
      await setStatus(jobId, "matching");
    } else {
      if (!job.imageId) throw new Error("Import job has no image");
      const image = await getImageRecord(job.imageId);
      if (!image) throw new Error("Uploaded image not found");

      await setStatus(jobId, "ocr");
      const provider = await resolveProvider(job.source);
      const text = await runOcr(imagePath(image.filename), image.mime, provider);
      const titles = extractTitles(text);
      if (titles.length === 0) {
        throw new Error(
          provider === "tesseract"
            ? "No game titles found. For photos of physical shelves, configure the Claude vision provider (ANTHROPIC_API_KEY) — plain OCR can't read spines well."
            : "No game titles found in this image",
        );
      }
      await db.insert(schema.importItems).values(
        titles.map((title, i) => ({
          jobId,
          position: i,
          rawText: title,
          cleanedTitle: title,
        })),
      );
      await setStatus(jobId, "matching");
    }

    const items = await db
      .select()
      .from(schema.importItems)
      .where(eq(schema.importItems.jobId, jobId))
      .orderBy(asc(schema.importItems.position));

    for (const item of items) {
      const result = await matchTitle(item.cleanedTitle);
      await db
        .update(schema.importItems)
        .set({
          candidates: result.candidates,
          confidence: result.confidence,
          // when a junk-prefix fallback won, keep the better title for manual adds
          cleanedTitle: result.query,
          resolution: result.candidates.length > 0 && result.confidence >= 0.55 ? "auto" : "pending",
        })
        .where(eq(schema.importItems.id, item.id));
    }

    await setStatus(jobId, "review");
    logScrape("ocr", true, job.source);
  } catch (err) {
    logScrape("ocr", false, err instanceof Error ? err.message : "Import failed");
    await setStatus(jobId, "failed", err instanceof Error ? err.message : "Import failed");
  }
}

/** Register the pg-boss worker. Runs in-process with the API. */
export async function startOcrWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.work<{ jobId: string }>(
    OCR_IMPORT_QUEUE,
    async (jobs: Array<{ data: { jobId: string } }>) => {
      for (const job of jobs) {
        await processImportJob(job.data.jobId);
      }
    },
  );
}
