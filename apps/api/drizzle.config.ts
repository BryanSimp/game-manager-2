import { defineConfig } from "drizzle-kit";
import { loadEnv } from "./src/env-load.js";

loadEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://gm:gm_dev_password@localhost:5432/gamemanager",
  },
});
