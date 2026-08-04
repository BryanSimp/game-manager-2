import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { REMOTE_IMAGE_LIMIT, sanitizeImage } from "./image-pipeline.js";

export async function ensureImageDir(): Promise<void> {
  await mkdir(env.IMAGE_DIR, { recursive: true });
}

export function imagePath(filename: string): string {
  return join(env.IMAGE_DIR, filename);
}

/**
 * Every stored image — uploaded or fetched — goes through
 * `sanitizeImage` (magic-byte check, metadata strip, re-encode), and is
 * stored under its DB row's uuid, never a client-supplied name.
 */
async function persistImage(
  buffer: Buffer,
  kind: "cover" | "custom_cover" | "shelf_photo" | "background" | "console_logo",
  ownerUserId: string | null,
): Promise<string | null> {
  const clean = await sanitizeImage(buffer);
  if (!clean) return null;
  await ensureImageDir();
  const [row] = await db
    .insert(schema.images)
    .values({ kind, filename: "pending", mime: clean.mime, ownerUserId })
    .returning({ id: schema.images.id });
  if (!row) return null;
  const filename = `${row.id}.${clean.ext}`;
  await writeFile(imagePath(filename), clean.data);
  await db.update(schema.images).set({ filename }).where(eq(schema.images.id, row.id));
  return row.id;
}

/**
 * Download a remote image (e.g. an IGDB cover) into the image volume and
 * record it. Returns the image row id, or null on failure — covers are
 * best-effort, the remote coverUrl remains as fallback. The download is
 * size-capped and the bytes are validated like any upload: allowlisted hosts
 * still serve user-picked content.
 */
export async function cacheRemoteImage(
  url: string,
  kind: "cover" | "background" | "custom_cover" | "console_logo",
  ownerUserId?: string,
): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > REMOTE_IMAGE_LIMIT) return null;

    const chunks: Uint8Array[] = [];
    let received = 0;
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength;
      if (received > REMOTE_IMAGE_LIMIT) return null;
      chunks.push(chunk);
    }
    return await persistImage(Buffer.concat(chunks), kind, ownerUserId ?? null);
  } catch {
    return null;
  }
}

/**
 * Persist an uploaded image buffer (e.g. a custom cover). Returns null when
 * the bytes aren't a real PNG/JPEG/WebP/AVIF — the mimetype the client
 * claimed is irrelevant.
 */
export async function saveUploadedImage(
  buffer: Buffer,
  kind: "cover" | "custom_cover" | "shelf_photo" | "background" | "console_logo",
  ownerUserId: string | null,
): Promise<string | null> {
  return persistImage(buffer, kind, ownerUserId);
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
