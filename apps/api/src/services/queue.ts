import { PgBoss } from "pg-boss";
import { env } from "../env.js";

export const OCR_IMPORT_QUEUE = "ocr-import";

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss({ connectionString: env.DATABASE_URL });
  boss.on("error", (err: Error) => console.error("pg-boss error:", err));
  await boss.start();
  await boss.createQueue(OCR_IMPORT_QUEUE);
  return boss;
}

export async function enqueueOcrImport(jobId: string): Promise<void> {
  const b = await getBoss();
  await b.send(OCR_IMPORT_QUEUE, { jobId }, { retryLimit: 1, expireInSeconds: 600 });
}
