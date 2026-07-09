import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { env } from "../env.js";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

async function main() {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool);
  console.log(`Applying migrations from ${migrationsFolder}…`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
