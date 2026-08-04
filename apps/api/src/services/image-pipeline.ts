import sharp from "sharp";

/**
 * One gate every stored image passes through, whether uploaded by a user or
 * downloaded from an allowlisted host. The client's Content-Type header and
 * the file's extension are never trusted — the bytes decide:
 *
 *  1. magic-byte sniff: only PNG / JPEG / WebP / AVIF get past the front door
 *  2. full decode + re-encode through sharp: strips EXIF/XMP/ICC metadata
 *     (GPS coordinates in a shelf photo don't belong on a public server) and
 *     destroys polyglot files — a "PNG" that is also valid HTML/JS comes out
 *     the other side as pixels only
 *  3. pixel cap: a decompression bomb (tiny file, enormous canvas) is
 *     rejected by sharp before it can allocate the canvas
 *
 * `.rotate()` (no args) applies the EXIF orientation *before* the metadata is
 * dropped, so phone photos don't come out sideways.
 */

/** Upload ceiling, enforced by @fastify/multipart at the transport level. */
export const IMAGE_UPLOAD_LIMIT = 5 * 1024 * 1024;

/** Remote covers/logos are fetched server-side; cap those downloads too. */
export const REMOTE_IMAGE_LIMIT = 20 * 1024 * 1024;

/** 8K squared is far beyond any cover art; bigger smells like a bomb. */
const MAX_PIXELS = 8192 * 8192;

export type SanitizedImage = { data: Buffer; ext: string; mime: string };

function isPng(b: Buffer): boolean {
  return (
    b.length > 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  );
}

function isJpeg(b: Buffer): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isWebp(b: Buffer): boolean {
  return (
    b.length > 12 &&
    b.toString("latin1", 0, 4) === "RIFF" &&
    b.toString("latin1", 8, 12) === "WEBP"
  );
}

function isAvif(b: Buffer): boolean {
  if (b.length < 12 || b.toString("latin1", 4, 8) !== "ftyp") return false;
  const brand = b.toString("latin1", 8, 12);
  return brand === "avif" || brand === "avis";
}

export function detectImageType(buffer: Buffer): "png" | "jpeg" | "webp" | "avif" | null {
  if (isPng(buffer)) return "png";
  if (isJpeg(buffer)) return "jpeg";
  if (isWebp(buffer)) return "webp";
  if (isAvif(buffer)) return "avif";
  return null;
}

/**
 * Validate + launder an image. Returns null for anything that isn't a real
 * decodable PNG/JPEG/WebP/AVIF (wrong bytes, corrupt file, pixel bomb).
 *
 * Output format follows input, except AVIF → JPEG: AVIF *encoding* is seconds
 * of CPU per image (unkind to a home server), and JPEG is the one format every
 * downstream consumer — browsers, tesseract, Claude vision — can read.
 */
export async function sanitizeImage(buffer: Buffer): Promise<SanitizedImage | null> {
  const type = detectImageType(buffer);
  if (!type) return null;
  try {
    const img = sharp(buffer, { limitInputPixels: MAX_PIXELS }).rotate();
    let data: Buffer;
    let ext: string;
    let mime: string;
    if (type === "png") {
      data = await img.png().toBuffer();
      ext = "png";
      mime = "image/png";
    } else if (type === "webp") {
      data = await img.webp({ quality: 90 }).toBuffer();
      ext = "webp";
      mime = "image/webp";
    } else {
      data = await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      ext = "jpg";
      mime = "image/jpeg";
    }
    return { data, ext, mime };
  } catch {
    return null;
  }
}
