import { buildServer } from "./server.js";
import { env } from "./env.js";
import { startOcrWorker } from "./jobs/ocr-import.js";

const app = await buildServer();

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  // in-process job worker (pg-boss rides on the same Postgres)
  await startOcrWorker();
  app.log.info("OCR import worker started");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
