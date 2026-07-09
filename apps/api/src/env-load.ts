import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

/**
 * Loads .env from the app dir or the repo root, whichever exists.
 * In Docker, env vars come from compose and no file is needed.
 */
export function loadEnv(): void {
  for (const candidate of [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ]) {
    if (existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
  }
}
