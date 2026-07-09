import { z } from "zod";
import { loadEnv } from "./env-load.js";

loadEnv();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be a real secret (openssl rand -base64 32)"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
  ALLOW_REGISTRATION: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default("0.0.0.0"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  IMAGE_DIR: z.string().default("./data/images"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
