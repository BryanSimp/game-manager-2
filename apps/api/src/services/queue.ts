import { PgBoss } from "pg-boss";
import { env } from "../env.js";

export const OCR_IMPORT_QUEUE = "ocr-import";
export const STEAM_IMPORT_QUEUE = "steam-import";
export const STEAM_SYNC_QUEUE = "steam-sync";

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss({ connectionString: env.DATABASE_URL });
  boss.on("error", (err: Error) => console.error("pg-boss error:", err));
  await boss.start();
  await boss.createQueue(OCR_IMPORT_QUEUE);
  await boss.createQueue(STEAM_IMPORT_QUEUE);
  await boss.createQueue(STEAM_SYNC_QUEUE);
  return boss;
}

export async function enqueueOcrImport(jobId: string): Promise<void> {
  const b = await getBoss();
  await b.send(OCR_IMPORT_QUEUE, { jobId }, { retryLimit: 1, expireInSeconds: 600 });
}

export async function enqueueSteamImport(userId: string): Promise<void> {
  const b = await getBoss();
  // singletonKey: one import per user at a time
  await b.send(
    STEAM_IMPORT_QUEUE,
    { userId },
    { retryLimit: 0, expireInSeconds: 1800, singletonKey: `import-${userId}` },
  );
}

export async function enqueueSteamSync(userId: string): Promise<void> {
  const b = await getBoss();
  await b.send(
    STEAM_SYNC_QUEUE,
    { userId },
    { retryLimit: 0, expireInSeconds: 3600, singletonKey: `sync-${userId}` },
  );
}