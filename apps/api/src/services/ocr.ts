import { readFile } from "node:fs/promises";
import { getSetting } from "./settings.js";

/**
 * Pluggable OCR: turns an image into raw text lines.
 * - "tesseract": tesseract.js (WASM) — free, local, good for clean library
 *   screenshots. Poor on photos of physical game spines.
 * - "anthropic": Claude vision — reads shelf photos, angled spines, and messy
 *   layouts far better. Needs ANTHROPIC_API_KEY.
 * Provider is chosen per-source: shelf photos prefer anthropic when available.
 */
export type OcrProvider = "tesseract" | "anthropic";

export async function resolveProvider(source: "screenshot" | "shelf_photo"): Promise<OcrProvider> {
  const configured =
    (await getSetting("ocr_provider")) || process.env.OCR_PROVIDER || "tesseract";
  const anthropicAvailable = !!process.env.ANTHROPIC_API_KEY;
  if (configured === "anthropic" && anthropicAvailable) return "anthropic";
  // shelf photos are barely readable by tesseract — auto-upgrade if possible
  if (source === "shelf_photo" && anthropicAvailable) return "anthropic";
  return "tesseract";
}

export async function runOcr(
  imagePath: string,
  mime: string,
  provider: OcrProvider,
): Promise<string> {
  if (provider === "anthropic") return anthropicOcr(imagePath, mime);
  return tesseractOcr(imagePath);
}

async function tesseractOcr(imagePath: string): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(imagePath);
    return text;
  } finally {
    await worker.terminate();
  }
}

const VISION_PROMPT = `This image shows video games — either a screenshot of a digital game library/launcher or a photo of physical game boxes on a shelf.

List every distinct game title you can identify, one per line. Rules:
- Output ONLY game titles, one per line — no numbering, no commentary, no headers.
- Ignore launcher UI text (Install, Update queued, Play, friend lists, prices).
- Ignore platform logos/labels (Nintendo Switch, PS5, XBOX) unless part of the title.
- Read spines carefully, including vertical text.
- Use the game's proper title (fix obvious truncations, e.g. "BOTW" on a spine is "The Legend of Zelda: Breath of the Wild" only when unambiguous).
- If you cannot identify any games, output nothing.`;

async function anthropicOcr(imagePath: string, mime: string): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const data = (await readFile(imagePath)).toString("base64");
  const mediaType = (
    ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime) ? mime : "image/jpeg"
  ) as "image/jpeg" | "image/png" | "image/webp" | "image/gif";

  const model = process.env.OCR_ANTHROPIC_MODEL || "claude-opus-4-8";
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data } },
          { type: "text", text: VISION_PROMPT },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("Vision model declined to process this image");
  }
  return response.content
    .filter((b): b is { type: "text"; text: string } & typeof b => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
