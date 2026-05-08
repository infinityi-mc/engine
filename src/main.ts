import { createContainer } from "./bootstrap/container";
import { jsonResponse } from "./shared/http/json-response";
import { Router } from "./shared/http/router";
import { registerSystemRoutes } from "./modules/system/infrastructure/http/system-routes";
import { registerServerRoutes } from "./modules/server/infrastructure/http/server-routes";
import { registerMinecraftRoutes } from "./modules/minecraft/infrastructure/http/minecraft-routes";

const port = Number(Bun.env.PORT ?? 3000);
const hostname = Bun.env.HOST ?? "localhost";
const container = createContainer();
const router = new Router();
const link = (url: string, text: string) =>
  `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;

router.get("/health", () => jsonResponse({ status: "ok" }));
registerSystemRoutes(
  router,
  container.commandBus,
  container.queryBus,
  container.guard,
  container.logger,
);
registerServerRoutes(
  router,
  container.commandBus,
  container.queryBus,
  container.guard,
  container.logger,
);
registerMinecraftRoutes(
  router,
  container.commandBus,
  container.queryBus,
  container.guard,
  container.logger,
);

// Reconcile server instances from PID files (crash recovery)
container.serverProcess.reconcile(container.serverRegistry).catch((error) => {
  container.logger.error("server.reconcile_failed", {
    error: error instanceof Error ? error.message : String(error),
  });
});

const server = Bun.serve({
  hostname,
  port,
  fetch: (request) => router.handle(request),
});

const serverUrl = `http://${server.hostname}:${server.port}`;

container.logger.info(`Server started on ${link(serverUrl, serverUrl)}`);
