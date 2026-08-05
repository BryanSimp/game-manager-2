import { seedDemo } from "../src/services/demo-seed.js";

/**
 * CLI wrapper around `seedDemo()`.
 *
 * The seed itself lives in `src/services/demo-seed.ts` so the admin page can
 * run it too — this is the same job, from a terminal, for a first install or
 * a server where clicking through the UI isn't convenient.
 *
 *   pnpm db:seed-demo
 */
const state = await seedDemo();
for (const line of state.log) console.log(line);

if (state.error) {
  console.error(`\nSeeding failed: ${state.error}`);
  process.exit(1);
}
console.log("\nDemo ready. Visit /demo — signed out, view-only.");
process.exit(0);
