import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";

export async function ensureImageDir(): Promise<void> {
  await mkdir(env.IMAGE_DIR, { recursive: true });
}

export function imagePath(filename: string): string {
  return join(env.IMAGE_DIR, filename);
}

/**
 * Download a remote image (e.g. an IGDB cover) into the image volume and
 * record it. Returns the image row id, or null on failure — covers are
 * best-effort, the remote coverUrl remains as fallback.
 */
export async function cacheRemoteImage(
  url: string,
  kind: "cover" | "background",
): Promise<string | null> {
  try {
    await ensureImageDir();
    const res = await fetch(url);
    if (!res.ok || !res.body) return null;
    const mime = res.headers.get("content-type") ?? "image/jpeg";
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";

    const [row] = await db
      .insert(schema.images)
      .values({ kind, filename: "pending", mime })
      .returning({ id: schema.images.id });
    if (!row) return null;

    const filename = `${row.id}.${ext}`;
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      createWriteStream(imagePath(filename)),
    );
    await db
      .update(schema.images)
      .set({ filename })
      .where(eq(schema.images.id, row.id));
    return row.id;
  } catch {
    return null;
  }
}

export async function getImageRecord(id: string) {
  const [row] = await db.select().from(schema.images).where(eq(schema.images.id, id));
  if (!row || row.filename === "pending") return null;
  try {
    await stat(imagePath(row.filename));
  } catch {
    return null;
  }
  return row;
}
