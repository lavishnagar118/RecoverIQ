import { app } from "./app.js";
import { env } from "./config/env.js";
import { closeMongo } from "./config/mongo.js";

const server = app.listen(env.port, () => {
  console.log(`[recoveriq] backend listening on port ${env.port}`);
});

const shutdown = (signal: NodeJS.Signals) => {
  console.log(`[recoveriq] received ${signal}; shutting down`);

  server.close(async (error) => {
    if (error) {
      console.error("[recoveriq] failed to close HTTP server", error);
      process.exit(1);
    }

    try {
      await closeMongo();
      process.exit(0);
    } catch (closeError) {
      console.error("[recoveriq] failed to close MongoDB client", closeError);
      process.exit(1);
    }
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
