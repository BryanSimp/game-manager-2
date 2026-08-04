import { z } from "zod";
import { loadEnv } from "./env-load.js";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
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
  // Password-reset email delivery (DB settings take precedence — see services/email.ts)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  // Where the public contact form delivers. Falls back to the `contact_email`
  // setting, then to the first admin's own address, so it works unconfigured.
  CONTACT_EMAIL: z.string().email().optional(),
  // Public origin of the web app, used to build reset links. Defaults to the
  // first CORS origin (the web app in dev), then BETTER_AUTH_URL (prod is
  // same-origin behind Traefik, so that's already the site).
  APP_URL: z.string().url().optional(),
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
