import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { getSetting, setSetting } from "./settings.js";
import { saveUploadedImage } from "./images.js";
import { similarity } from "./noise-filter.js";
import { logScrape } from "./analytics.js";

/**
 * Real retail box-front scans from the libretro-thumbnails archive
 * (github.com/libretro-thumbnails). Free, no API key; per-platform repos of
 * PNGs named in No-Intro style ("Legend of Zelda, The - Ocarina of Time (USA).png").
 * Modern platforms without scan archives fall back to the synthesized case.
 */
const LIBRETRO_REPOS: Record<string, string> = {
  NES: "Nintendo_-_Nintendo_Entertainment_System",
  "Super Nintendo": "Nintendo_-_Super_Nintendo_Entertainment_System",
  "Nintendo 64": "Nintendo_-_Nintendo_64",
  GameCube: "Nintendo_-_GameCube",
  Wii: "Nintendo_-_Wii",
  "Wii U": "Nintendo_-_Wii_U",
  // no libretro archive for Switch/PS4/PS5/Xbox One+ — those use the
  // synthesized banner case, which mirrors the real modern box design
  "Game Boy": "Nintendo_-_Game_Boy",
  "Game Boy Color": "Nintendo_-_Game_Boy_Color",
  "Game Boy Advance": "Nintendo_-_Game_Boy_Advance",
  "Nintendo DS": "Nintendo_-_Nintendo_DS",
  "Nintendo 3DS": "Nintendo_-_Nintendo_3DS",
  PlayStation: "Sony_-_PlayStation",
  "PlayStation 2": "Sony_-_PlayStation_2",
  "PlayStation 3": "Sony_-_PlayStation_3",
  PSP: "Sony_-_PlayStation_Portable",
  "PS Vita": "Sony_-_PlayStation_Vita",
  Xbox: "Microsoft_-_Xbox",
  "Xbox 360": "Microsoft_-_Xbox_360",
  "Sega Master System": "Sega_-_Master_System_-_Mark_III",
  "Sega Genesis": "Sega_-_Mega_Drive_-_Genesis",
  "Sega Saturn": "Sega_-_Saturn",
  "Sega Dreamcast": "Sega_-_Dreamcast",
  "Sega Game Gear": "Sega_-_Game_Gear",
};

const INDEX_TTL_MS = 30 * 24 * 3600 * 1000; // refresh the file list monthly
const MATCH_THRESHOLD = 0.8;

const inFlight = new Set<string>();

export function boxArtSupported(platformName: string): boolean {
  return platformName in LIBRETRO_REPOS;
}

/** "Legend of Zelda, The - Ocarina of Time (USA) (Rev B).png" → comparable title */
function normalizeFileName(file: string): string {
  let name = file.replace(/\.png$/i, "");
  name = name.replace(/\s*[([][^)\]]*[)\]]/g, ""); // drop region/rev groups
  name = name.replace(/, (The|A|An)(\s|$|( - ))/i, (_m, art, tail) => ` ${tail ?? ""}`.trimStart());
  // No-Intro moves the article: handle "Title, The - Subtitle" → "The Title - Subtitle"
  const commaThe = /^(.*?), (The|A|An)( - .*)?$/i.exec(name);
  if (commaThe) name = `${commaThe[2]} ${commaThe[1]}${commaThe[3] ?? ""}`;
  return normalizeTitle(name);
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface IndexCache {
  fetchedAt: number;
  files: string[];
}

async function getIndex(repo: string): Promise<string[] | null> {
  const key = `boxart_idx_${repo}`;
  const cached = await getSetting(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as IndexCache;
      if (Date.now() - parsed.fetchedAt < INDEX_TTL_MS) return parsed.files;
    } catch {
      /* refetch */
    }
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/libretro-thumbnails/${repo}/git/trees/master?recursive=1`,
      { headers: { "user-agent": "game-manager-2", accept: "application/vnd.github+json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tree: Array<{ path: string }> };
    const files = data.tree
      .filter((t) => t.path.startsWith("Named_Boxarts/") && t.path.toLowerCase().endsWith(".png"))
      .map((t) => t.path.slice("Named_Boxarts/".length));
    await setSetting(key, JSON.stringify({ fetchedAt: Date.now(), files } satisfies IndexCache));
    return files;
  } catch {
    return null;
  }
}

/** Cached lookup: returns the local image URL, or null. */
export async function getBoxArtImageId(gameId: string, platformId: string): Promise<string | null> {
  const [row] = await db
    .select({ imageId: schema.gameBoxArt.imageId })
    .from(schema.gameBoxArt)
    .where(and(eq(schema.gameBoxArt.gameId, gameId), eq(schema.gameBoxArt.platformId, platformId)));
  return row?.imageId ?? null;
}

/**
 * Fire-and-forget: find + cache the real box scan for a game on a platform.
 * Safe to call repeatedly — misses are recorded so we don't refetch.
 */
export async function ensureBoxArt(
  gameId: string,
  platformId: string,
  title: string,
  platformName: string,
): Promise<void> {
  const repo = LIBRETRO_REPOS[platformName];
  if (!repo) return;
  const key = `${gameId}:${platformId}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const [existing] = await db
      .select({ source: schema.gameBoxArt.source })
      .from(schema.gameBoxArt)
      .where(and(eq(schema.gameBoxArt.gameId, gameId), eq(schema.gameBoxArt.platformId, platformId)));
    if (existing) return;

    const files = await getIndex(repo);
    if (!files || files.length === 0) {
      logScrape("boxart", false, `index unavailable: ${repo}`);
      return; // try again next time
    }

    const wanted = normalizeTitle(title);
    let bestFile: string | null = null;
    let bestScore = 0;
    for (const file of files) {
      const score = similarity(wanted, normalizeFileName(file));
      if (score > bestScore) {
        bestScore = score;
        bestFile = file;
      }
    }

    if (!bestFile || bestScore < MATCH_THRESHOLD) {
      logScrape("boxart", false, `no matching scan: ${title} (${platformName})`);
      await db
        .insert(schema.gameBoxArt)
        .values({ gameId, platformId, imageId: null, source: "miss" })
        .onConflictDoNothing();
      return;
    }

    const imageId = await downloadScan(repo, bestFile);
    logScrape("boxart", imageId !== null, imageId ? undefined : `download failed: ${bestFile}`);
    await db
      .insert(schema.gameBoxArt)
      .values({ gameId, platformId, imageId, source: imageId ? "libretro" : "miss" })
      .onConflictDoNothing();
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Download a scan, following libretro's dedup pointers: some entries are tiny
 * text files whose body is just the filename of the canonical scan
 * ("...(USA).png" → "...(Europe) (En,Fr,De).png").
 */
async function downloadScan(repo: string, file: string, depth = 0): Promise<string | null> {
  if (depth > 2) return null;
  try {
    const url = `https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/Named_Boxarts/${encodeURIComponent(file)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") ?? "";
    if (mime.startsWith("image/")) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 128) return null; // not a real image
      const imageId = await saveUploadedImage(buffer, mime, "cover", null);
      // PNG IHDR carries dimensions — stored so boxes can match the scan's aspect
      if (buffer.length > 24 && buffer.readUInt32BE(12) === 0x49484452) {
        await db
          .update(schema.images)
          .set({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) })
          .where(eq(schema.images.id, imageId));
      }
      return imageId;
    }
    // pointer file → follow the referenced filename
    const body = (await res.text()).trim();
    if (/^[^\n]{1,300}\.png$/i.test(body) && body !== file) {
      return downloadScan(repo, body, depth + 1);
    }
    return null;
  } catch {
    return null;
  }
}
