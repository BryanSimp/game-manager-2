import { buildServer } from "./server.js";
import { env } from "./env.js";

const app = await buildServer();

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
